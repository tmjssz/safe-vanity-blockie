import { Worker } from 'node:worker_threads'
import { type Candidate, type FaceSpec, Leaderboard } from '@safe-vanity-blockie/core'
import type { WorkerInput, WorkerMessage } from './worker.js'

/**
 * Block size handed to each worker when the run is unbounded. Large enough that a worker never
 * reaches the next worker's territory (at 3M nonces/s that is ~4 days per worker).
 */
export const WORKER_BLOCK = 1_000_000_000_000

export interface PoolProgress {
  scanned: number
  elapsedMs: number
  /** Nonces per second, aggregated across workers. */
  rate: number
  best: Candidate[]
}

export interface PoolOptions {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  start: number
  workers: number
  /** Stride between worker ranges, and the most nonces any one worker scans. */
  perWorker: number
  /**
   * Cap on the nonces scanned across all workers. `perWorker * workers` rounds up when the
   * budget does not divide evenly, so without this the run would overshoot the caller's limit;
   * the trailing workers get short ranges instead. Unbounded when omitted.
   */
  totalCount?: number
  keep: number
  chunkSize?: number
  workerUrl?: URL
  onProgress?: (progress: PoolProgress) => void
}

export interface PoolResult {
  scanned: number
  scannedPerWorker: number[]
  candidates: Candidate[]
  /**
   * Safe `--start` for a follow-up run with the same worker count and perWorker value: the
   * highest end position (`start + index * perWorker + scanned`) any worker reached, so a
   * follow-up run never rescans anything this run covered. On full completion this equals
   * `start + totalCount` (or `start + workers * perWorker` when uncapped). After an early stop
   * it may SKIP unscanned gaps left by slower workers — the guarantee is no-rescan, not full
   * coverage.
   */
  nextStart: number
  /** Wall-clock time this pool spent mining, in milliseconds. */
  elapsedMs: number
}

export function createPool(options: PoolOptions): {
  run(): Promise<PoolResult>
  stop(): void
} {
  const stopFlag = new SharedArrayBuffer(4)
  const stopView = new Int32Array(stopFlag)
  const workerUrl = options.workerUrl ?? new URL('./worker.js', import.meta.url)

  function stop(): void {
    Atomics.store(stopView, 0, 1)
  }

  async function run(): Promise<PoolResult> {
    const startedAt = Date.now()
    const board = new Leaderboard(options.keep)
    const scannedPerWorker = new Array<number>(options.workers).fill(0)

    const emitProgress = () => {
      if (!options.onProgress) return
      const scanned = scannedPerWorker.reduce((a, b) => a + b, 0)
      const elapsedMs = Math.max(1, Date.now() - startedAt)
      options.onProgress({
        scanned,
        elapsedMs,
        rate: (scanned / elapsedMs) * 1000,
        best: board.entries(),
      })
    }

    const workers: Worker[] = []

    // Ranges stay `perWorker` apart whatever the cap does to the counts, so they never overlap
    // and nextStart's `index * perWorker + scanned` arithmetic below still holds.
    const countFor = (index: number): number =>
      options.totalCount === undefined
        ? options.perWorker
        : Math.max(0, Math.min(options.perWorker, options.totalCount - index * options.perWorker))

    const runs = Array.from({ length: options.workers }, (_, index) => {
      const input: WorkerInput = {
        constantsHex: options.constantsHex,
        faceSpec: options.faceSpec,
        start: options.start + index * options.perWorker,
        count: countFor(index),
        keep: options.keep,
        chunkSize: options.chunkSize ?? 250_000,
        stopFlag,
      }

      return new Promise<void>((resolve, reject) => {
        const worker = new Worker(workerUrl, { workerData: input })
        workers.push(worker)
        worker.on('message', (message: WorkerMessage) => {
          if (message.type === 'error') {
            reject(new Error(`worker ${index} failed: ${message.message}`))
            return
          }
          scannedPerWorker[index] = message.scanned
          board.merge(message.candidates)
          if (message.type === 'progress') emitProgress()
        })
        worker.on('error', reject)
        worker.on('exit', (code) => {
          if (code !== 0) reject(new Error(`worker ${index} exited with code ${code}`))
          else resolve()
        })
      })
    })

    try {
      await Promise.all(runs)
    } finally {
      stop()
      // On the happy path every worker has already exited by the time Promise.all resolves, so
      // these are no-ops. On the error path they stop survivors immediately instead of leaving
      // them mining until their next chunk boundary notices the stop flag.
      for (const worker of workers) void worker.terminate()
    }

    const scanned = scannedPerWorker.reduce((a, b) => a + b, 0)
    // Workers the cap left with an empty range are excluded: they were never assigned territory,
    // so treating their range start as "reached" would push nextStart past unscanned nonces.
    const ends = scannedPerWorker
      .map((scanned, index) => (countFor(index) === 0 ? 0 : index * options.perWorker + scanned))
      .concat(0)
    return {
      scanned,
      elapsedMs: Date.now() - startedAt,
      scannedPerWorker,
      candidates: board.entries(),
      nextStart: options.start + Math.max(...ends),
    }
  }

  return { run, stop }
}
