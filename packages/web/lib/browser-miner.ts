import {
  type Candidate,
  compileFace,
  createKeccak256,
  createMiner,
  type FaceSpec,
  hexToBytes,
  Leaderboard,
} from '@safe-vanity-blockie/core'

/**
 * Nonces per synchronous burst. Measured at roughly 200k nonces/s per worker, this is ~250ms of
 * work — consistent with the ~184ms stop latency observed in practice — short enough that a
 * stop message is acted on promptly and the worker stays responsive, long enough that the
 * per-slice overhead is negligible.
 */
export const SLICE_SIZE = 50_000

export interface BrowserMineOptions {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  start: number
  count: number
  keep: number
  sliceSize?: number
  onSlice?: (progress: { scanned: number; candidates: Candidate[] }) => void
  shouldStop?: () => boolean
  /** Overridable for tests; defaults to a macrotask, which lets postMessage be delivered. */
  yieldToEventLoop?: () => Promise<void>
}

export interface BrowserMineResult {
  scanned: number
  candidates: Candidate[]
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Mines a range in bounded synchronous slices, awaiting a macrotask between them.
 *
 * core's mine() is synchronous by design — that is what makes it fast — so a worker running
 * one long call never drains its message queue. The Node CLI solves this with a
 * SharedArrayBuffer flag and Atomics; in a browser that would require cross-origin isolation
 * (COOP/COEP), which breaks wallet popups and injected providers. Slicing achieves the same
 * responsiveness with no headers and no shared memory.
 */
export async function runBrowserMiner(options: BrowserMineOptions): Promise<BrowserMineResult> {
  const constants = {
    initializerHash: hexToBytes(options.constantsHex.initializerHash),
    factory: hexToBytes(options.constantsHex.factory),
    initCodeHash: hexToBytes(options.constantsHex.initCodeHash),
  }
  const keccak256 = await createKeccak256()
  const miner = createMiner(constants, compileFace(options.faceSpec), keccak256)
  const yieldToEventLoop = options.yieldToEventLoop ?? macrotask
  const sliceSize = Math.max(1, options.sliceSize ?? SLICE_SIZE)

  // mine() returns a fresh leaderboard per call, so the run-long board lives here and each
  // slice is merged into it. merge() dedupes by address, so this is idempotent.
  const board = new Leaderboard(options.keep)
  let scanned = 0

  while (scanned < options.count) {
    const sliceCount = Math.min(sliceSize, options.count - scanned)
    const slice = miner.mine({
      start: options.start + scanned,
      count: sliceCount,
      keep: options.keep,
    })
    board.merge(slice.candidates)
    scanned += slice.scanned

    options.onSlice?.({ scanned, candidates: board.entries() })
    await yieldToEventLoop()
    if (options.shouldStop?.()) break
  }

  return { scanned, candidates: board.entries() }
}
