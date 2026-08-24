import type { Candidate, FaceSpec } from '@safe-vanity-blockie/core'

export interface BrowserWorkerInput {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  start: number
  count: number
  keep: number
  sliceSize?: number
}

export type WorkerRequest = { type: 'start'; input: BrowserWorkerInput } | { type: 'stop' }

export type WorkerEvent =
  | { type: 'progress'; scanned: number; candidates: Candidate[] }
  | { type: 'done'; scanned: number; candidates: Candidate[] }
  | { type: 'error'; message: string }

/**
 * Block size handed to each worker on an unbounded run. Large enough that a worker never
 * reaches the next worker's territory.
 *
 * packages/miner/src/pool.ts carries the same number, independently, and since the resume point is
 * copied out of this app and pasted into that CLI's `--start` the two are a numeric contract rather
 * than a coincidence: the block width is what decides how much ground a stopped run leaves behind,
 * so a browser and a CLI disagreeing about it means a handed-over search whose gap neither tool can
 * state. Deliberately not hoisted into a shared package — the CLI does not depend on the web app,
 * and giving it one to keep a constant in step would be the larger cost — so anyone changing this
 * changes both.
 */
export const WORKER_BLOCK = 1_000_000_000_000

/** Worker w gets [start + w*perWorker, +perWorker) — disjoint and gapless. */
export function planWorkerRanges(
  start: number,
  workers: number,
  perWorker: number,
): { start: number; count: number }[] {
  return Array.from({ length: workers }, (_, index) => ({
    start: start + index * perWorker,
    count: perWorker,
  }))
}

/**
 * The highest END position any worker reached. A follow-up run from here never rescans
 * anything this run covered. Note the guarantee is no-rescan, not full coverage: after an
 * early stop the unfinished tails of slower workers are skipped.
 *
 * Taking max(scannedPerWorker) without the positional offset is WRONG — it compares each new
 * worker only against the old worker of the same index, so new worker 0 lands inside old
 * worker 1's range.
 */
export function nextStartFrom(
  start: number,
  perWorker: number,
  scannedPerWorker: number[],
): number {
  if (scannedPerWorker.length === 0) return start
  return start + Math.max(...scannedPerWorker.map((scanned, index) => index * perWorker + scanned))
}
