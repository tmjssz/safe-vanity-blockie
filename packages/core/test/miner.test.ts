import { beforeAll, describe, expect, it } from 'vitest'
import { bloData } from '../src/blo.js'
import { createAddressDeriver } from '../src/address.js'
import { hexToBytes } from '../src/hex.js'
import { createKeccak256, type Keccak256 } from '../src/keccak.js'
import { Leaderboard, compareCandidates, createMiner, type Candidate } from '../src/miner.js'
import { compileFace, makeScorer } from '../src/scoring.js'
import { getTemplate } from '../src/templates.js'

const CONSTANTS = {
  initializerHash: hexToBytes('0x' + '11'.repeat(32)),
  factory: hexToBytes('0x' + '22'.repeat(20)),
  initCodeHash: hexToBytes('0x' + '33'.repeat(32)),
}
const FACE = compileFace(getTemplate('faces'))

let keccak256: Keccak256

beforeAll(async () => {
  keccak256 = await createKeccak256()
})

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    saltNonce: '1',
    address: '0x' + '00'.repeat(20),
    score: 100,
    maxScore: 133,
    twoColor: true,
    contrast: 100,
    regions: { mouth: 'smile' },
    ...overrides,
  }
}

describe('Leaderboard', () => {
  it('ranks by score desc, then two-colour first, then contrast desc', () => {
    const board = new Leaderboard(5)
    board.offer(candidate({ address: '0xa', score: 120, twoColor: true, contrast: 50 }))
    board.offer(candidate({ address: '0xb', score: 131, twoColor: false, contrast: 300 }))
    board.offer(candidate({ address: '0xc', score: 131, twoColor: true, contrast: 100 }))
    board.offer(candidate({ address: '0xd', score: 131, twoColor: true, contrast: 250 }))
    expect(board.entries().map((entry) => entry.address)).toEqual(['0xd', '0xc', '0xb', '0xa'])
  })

  it('never exceeds capacity and reports the score to beat', () => {
    const board = new Leaderboard(3)
    expect(board.threshold).toBe(-1)
    for (const score of [100, 110, 120, 130]) {
      board.offer(candidate({ address: `0x${score}`, score }))
    }
    expect(board.entries()).toHaveLength(3)
    expect(board.entries().map((entry) => entry.score)).toEqual([130, 120, 110])
    expect(board.threshold).toBe(110)
    expect(board.offer(candidate({ address: '0xlow', score: 100 }))).toBe(false)
  })

  it('dedupes by address', () => {
    const board = new Leaderboard(5)
    expect(board.offer(candidate({ address: '0xsame', score: 120 }))).toBe(true)
    expect(board.offer(candidate({ address: '0xsame', score: 120 }))).toBe(false)
    expect(board.entries()).toHaveLength(1)
  })

  it('merges another run and re-ranks', () => {
    const board = new Leaderboard(3)
    board.offer(candidate({ address: '0xa', score: 100 }))
    board.merge([candidate({ address: '0xb', score: 130 }), candidate({ address: '0xa', score: 100 })])
    expect(board.entries().map((entry) => entry.address)).toEqual(['0xb', '0xa'])
  })

  it('compareCandidates is a total order with a stable saltNonce tiebreak', () => {
    const a = candidate({ address: '0xa', saltNonce: '1' })
    const b = candidate({ address: '0xb', saltNonce: '2' })
    expect(compareCandidates(a, b)).toBeLessThan(0)
    expect(compareCandidates(b, a)).toBeGreaterThan(0)
    expect(compareCandidates(a, a)).toBe(0)
  })
})

describe('createMiner', () => {
  it('agrees with a naive single-nonce loop over the same range', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const result = miner.mine({ start: 0, count: 5000, keep: 5 })

    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    const score = makeScorer(FACE)
    let bestScore = -1
    let bestNonce = -1
    for (let nonce = 0; nonce < 5000; nonce++) {
      const value = score(bloData(deriver.derive(nonce)))
      if (value > bestScore) {
        bestScore = value
        bestNonce = nonce
      }
    }

    expect(result.scanned).toBe(5000)
    expect(result.candidates[0].score).toBe(bestScore)
    expect(result.candidates[0].saltNonce).toBe(String(bestNonce))
    expect(result.candidates[0].address).toBe(deriver.derive(bestNonce))
  })

  it('is deterministic and honours keep', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const first = miner.mine({ start: 1000, count: 3000, keep: 7 })
    const second = miner.mine({ start: 1000, count: 3000, keep: 7 })
    expect(first.candidates).toEqual(second.candidates)
    expect(first.candidates.length).toBeLessThanOrEqual(7)
  })

  it('produces self-consistent candidate metadata', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const score = makeScorer(FACE)
    for (const entry of miner.mine({ start: 0, count: 3000, keep: 10 }).candidates) {
      expect(entry.address).toMatch(/^0x[0-9a-f]{40}$/)
      expect(entry.maxScore).toBe(133)
      expect(entry.score).toBe(score(bloData(entry.address)))
      expect(entry.score).toBeLessThanOrEqual(entry.maxScore)
      expect(Object.keys(entry.regions)).toEqual(['mouth'])
    }
  })

  it('reports cumulative progress and stops when onProgress returns false', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const seen: number[] = []
    const result = miner.mine({
      start: 0,
      count: 10_000,
      chunkSize: 1000,
      onProgress: (scanned) => {
        seen.push(scanned)
        return seen.length < 3
      },
    })
    expect(seen).toEqual([1000, 2000, 3000])
    expect(result.scanned).toBe(3000)
  })

  it('covers exactly the requested range', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const whole = miner.mine({ start: 0, count: 4000, keep: 3 })
    const firstHalf = miner.mine({ start: 0, count: 2000, keep: 3 })
    const secondHalf = miner.mine({ start: 2000, count: 2000, keep: 3 })
    const board = new Leaderboard(3)
    board.merge(firstHalf.candidates)
    board.merge(secondHalf.candidates)
    expect(board.entries()).toEqual(whole.candidates)
  })
})
