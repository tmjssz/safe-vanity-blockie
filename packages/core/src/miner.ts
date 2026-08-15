import { createAddressDeriver, type SafeConstants } from './address.js'
import { bloDataInto, bloImage } from './blo.js'
import type { Keccak256 } from './keccak.js'
import { colorContrast, describeMatch, isTwoColor, makeScorer } from './scoring.js'
import type { CompiledFace } from './types.js'

export interface Candidate {
  /** Decimal string: a saltNonce is a uint256 and may exceed 2^53. */
  saltNonce: string
  address: string
  score: number
  maxScore: number
  twoColor: boolean
  contrast: number
  /** Winning alternative per region, e.g. `{ mouth: 'smile' }`. */
  regions: Record<string, string>
}

/** Ranking from spec §5.6: score desc, two-colour first, contrast desc, then saltNonce for stability. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.twoColor !== b.twoColor) return a.twoColor ? -1 : 1
  if (a.contrast !== b.contrast) return b.contrast - a.contrast
  if (a.saltNonce === b.saltNonce) return 0
  return a.saltNonce.length - b.saltNonce.length || (a.saltNonce < b.saltNonce ? -1 : 1)
}

export class Leaderboard {
  readonly capacity: number
  private items: Candidate[] = []
  private seen = new Set<string>()

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Leaderboard capacity must be a positive integer, got ${capacity}`)
    }
    this.capacity = capacity
  }

  /** Score a candidate must reach to be worth building. -1 until the board is full. */
  get threshold(): number {
    return this.items.length < this.capacity ? -1 : this.items[this.items.length - 1].score
  }

  offer(candidate: Candidate): boolean {
    if (this.seen.has(candidate.address)) return false
    if (this.items.length >= this.capacity && candidate.score < this.threshold) return false
    this.seen.add(candidate.address)
    this.items.push(candidate)
    this.items.sort(compareCandidates)
    if (this.items.length > this.capacity) this.items.length = this.capacity
    this.seen = new Set(this.items.map((item) => item.address))
    return true
  }

  merge(candidates: Candidate[]): void {
    for (const candidate of candidates) this.offer(candidate)
  }

  entries(): Candidate[] {
    return this.items.slice()
  }
}

export interface MineOptions {
  start: number
  count: number
  /** Leaderboard size. Default 20. */
  keep?: number
  /** Iterations between onProgress callbacks. Default 250_000. */
  chunkSize?: number
  /** Return false to stop early. `scanned` is cumulative for this call. */
  // biome-ignore lint/suspicious/noConfusingVoidType: deliberate union with void so callers may return nothing; narrowing to `boolean | undefined` breaks consumers of the published package whose callback bodies infer a `void` return.
  onProgress?: (scanned: number, best: Candidate[]) => boolean | void
}

export interface MineResult {
  scanned: number
  candidates: Candidate[]
}

export function createMiner(
  constants: SafeConstants,
  face: CompiledFace,
  keccak256: Keccak256,
): { mine(options: MineOptions): MineResult } {
  const deriver = createAddressDeriver(constants, keccak256)
  const score = makeScorer(face)

  /** Off the hot path — only runs when a candidate reaches the leaderboard. */
  function buildCandidate(nonce: number, address: string, value: number): Candidate {
    const { data, colors } = bloImage(address)
    return {
      saltNonce: String(nonce),
      address,
      score: value,
      maxScore: face.maxScore,
      twoColor: isTwoColor(data),
      contrast: Math.round(colorContrast(colors[0], colors[1])),
      regions: describeMatch(face, data).regions,
    }
  }

  return {
    mine(options: MineOptions): MineResult {
      const chunkSize = options.chunkSize ?? 250_000
      if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
        throw new Error(`chunkSize must be a positive integer, got ${chunkSize}`)
      }
      // keep is validated by the Leaderboard constructor below.
      const board = new Leaderboard(options.keep ?? 20)
      // Allocated once for the whole run; the hot loop allocates nothing else.
      const data = new Uint8Array(32)
      const rseed = new Uint32Array(4)
      let scanned = 0

      while (scanned < options.count) {
        const from = options.start + scanned
        const to = from + Math.min(chunkSize, options.count - scanned)
        for (let nonce = from; nonce < to; nonce++) {
          const address = deriver.derive(nonce)
          bloDataInto(address, data, rseed)
          const value = score(data)
          if (value >= board.threshold) board.offer(buildCandidate(nonce, address, value))
        }
        scanned = to - options.start
        if (options.onProgress?.(scanned, board.entries()) === false) break
      }

      return { scanned, candidates: board.entries() }
    },
  }
}
