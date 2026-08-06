import { Worker } from 'node:worker_threads'
import { Leaderboard, type Candidate, type FaceSpec } from '@safe-vanity-blockie/core'
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
  /** Nonces assigned to each worker; also the stride between worker ranges. */
  perWorker: number
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
   * Safe `--start` for a follow-up run with the same worker count and perWorker value:
   * start + max(scannedPerWorker) can never overlap any range this run covered.
   */
  nextStart: number
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

    const runs = Array.from({ length: options.workers }, (_, index) => {
      const input: WorkerInput = {
        constantsHex: options.constantsHex,
        faceSpec: options.faceSpec,
        start: options.start + index * options.perWorker,
        count: options.perWorker,
        keep: options.keep,
        chunkSize: options.chunkSize ?? 250_000,
        stopFlag,
      }

      return new Promise<void>((resolve, reject) => {
        const worker = new Worker(workerUrl, { workerData: input })
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
    }

    const scanned = scannedPerWorker.reduce((a, b) => a + b, 0)
    return {
      scanned,
      scannedPerWorker,
      candidates: board.entries(),
      nextStart: options.start + Math.max(...scannedPerWorker),
    }
  }

  return { run, stop }
}
