import { describe, expect, it } from 'vitest'
import type { Candidate } from '../src/miner.js'
import { filterCandidates, formatScore, selectReported } from '../src/select.js'

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    saltNonce: '1',
    address: '0x' + '11'.repeat(20),
    score: 120,
    maxScore: 133,
    twoColor: true,
    contrast: 150,
    regions: { mouth: 'smile' },
    ...overrides,
  }
}

describe('filterCandidates', () => {
  it('drops three-colour results when two-colour is requested', () => {
    const entries = [candidate({ address: '0xa' }), candidate({ address: '0xb', twoColor: false })]
    expect(filterCandidates(entries, { twoColor: true, minContrast: 0 })).toHaveLength(1)
    expect(filterCandidates(entries, { twoColor: false, minContrast: 0 })).toHaveLength(2)
  })

  it('drops results below the contrast floor', () => {
    const entries = [
      candidate({ address: '0xa', contrast: 200 }),
      candidate({ address: '0xb', contrast: 50 }),
    ]
    expect(filterCandidates(entries, { twoColor: false, minContrast: 150 })).toHaveLength(1)
  })
})

describe('selectReported', () => {
  const options = { twoColor: true, minContrast: 0, keep: 2 }

  it('returns at most keep entries and reports how many were dropped', () => {
    const entries = [
      candidate({ address: '0xa', score: 125, twoColor: false }),
      candidate({ address: '0xb', score: 120 }),
      candidate({ address: '0xc', score: 119 }),
      candidate({ address: '0xd', score: 118 }),
    ]
    const result = selectReported(entries, options)
    expect(result.reported.map((entry) => entry.address)).toEqual(['0xb', '0xc'])
    expect(result.droppedCount).toBe(1)
    expect(result.usedFallback).toBe(false)
  })

  it('falls back to the unfiltered list rather than showing nothing', () => {
    const entries = [candidate({ address: '0xa', twoColor: false })]
    const result = selectReported(entries, options)
    expect(result.reported).toHaveLength(1)
    expect(result.usedFallback).toBe(true)
    expect(result.droppedCount).toBe(0)
  })

  // The CLI wants the fallback (it prints a notice saying so); a UI that can render an explicit
  // "nothing matches these filters" state wants the truth instead, or its filter control looks
  // broken. Opting out must also stop droppedCount pretending nothing was dropped.
  it('reports nothing, and the real drop count, when the caller opts out of the fallback', () => {
    const entries = [
      candidate({ address: '0xa', twoColor: false }),
      candidate({ address: '0xb', twoColor: false }),
    ]
    const result = selectReported(entries, { ...options, fallbackWhenEmpty: false })
    expect(result.reported).toEqual([])
    expect(result.usedFallback).toBe(false)
    expect(result.droppedCount).toBe(2)
  })

  it('is empty for an empty input', () => {
    expect(selectReported([], options)).toEqual({
      reported: [],
      droppedCount: 0,
      usedFallback: false,
    })
  })
})

describe('formatScore', () => {
  it('renders a percentage with one decimal', () => {
    expect(formatScore(133, 133)).toBe('100.0%')
    expect(formatScore(120, 133)).toBe('90.2%')
    expect(formatScore(0, 133)).toBe('0.0%')
  })

  it('does not divide by zero', () => {
    expect(formatScore(0, 0)).toBe('0.0%')
  })
})
