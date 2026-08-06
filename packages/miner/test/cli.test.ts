import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getTemplate, type Candidate } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { resolveFaceSpec, selectReported } from '../src/cli.js'

function makeCandidate(overrides: Partial<Candidate>): Candidate {
  return {
    saltNonce: '1',
    address: '0x0000000000000000000000000000000000000000',
    score: 100,
    maxScore: 133,
    twoColor: true,
    contrast: 50,
    regions: {},
    ...overrides,
  }
}

describe('resolveFaceSpec', () => {
  it('resolves builtin template names', () => {
    expect(resolveFaceSpec('faces').regions[0].alternatives).toHaveLength(5)
    expect(resolveFaceSpec('smile').regions[0].alternatives).toHaveLength(1)
  })

  it('loads and validates a FaceSpec JSON file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'facespec-'))
    const file = join(dir, 'custom.json')
    writeFileSync(file, JSON.stringify({ ...getTemplate('smile'), name: 'custom' }))
    expect(resolveFaceSpec(file).name).toBe('custom')
  })

  it('reports unreadable files clearly rather than falling back silently', () => {
    expect(() => resolveFaceSpec('./does-not-exist.json')).toThrow(/could not read face spec/)
  })

  it('reports invalid JSON files clearly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'facespec-'))
    const file = join(dir, 'broken.json')
    writeFileSync(file, '{ not json')
    expect(() => resolveFaceSpec(file)).toThrow(/could not parse face spec/)
  })

  it('rejects an unknown name that is not a file path', () => {
    expect(() => resolveFaceSpec('grin')).toThrow(/unknown template "grin"/)
  })
})

describe('selectReported', () => {
  it('never returns more than --keep rows, drops non-two-colour candidates, and reports the drop count', () => {
    // Score-ranked retention (as the pool's Leaderboard does) would keep these 5 regardless of
    // colour; selectReported must then filter by --two-color and only show the survivors.
    const candidates = [
      makeCandidate({ saltNonce: '1', score: 130, twoColor: true }),
      makeCandidate({ saltNonce: '2', score: 125, twoColor: false }),
      makeCandidate({ saltNonce: '3', score: 120, twoColor: true }),
      makeCandidate({ saltNonce: '4', score: 115, twoColor: false }),
      makeCandidate({ saltNonce: '5', score: 110, twoColor: true }),
    ]

    const result = selectReported(candidates, { twoColor: true, minContrast: 0, keep: 2 })

    expect(result.usedFallback).toBe(false)
    expect(result.reported.length).toBeLessThanOrEqual(2)
    expect(result.reported.every((candidate) => candidate.twoColor)).toBe(true)
    expect(result.reported.map((candidate) => candidate.saltNonce)).toEqual(['1', '3'])
    // 2 of the 5 candidates were three-colour and got dropped by the filter.
    expect(result.droppedCount).toBe(2)
  })

  it('falls back to the unfiltered list when filtering removes everything', () => {
    const candidates = [
      makeCandidate({ saltNonce: '1', score: 130, twoColor: false }),
      makeCandidate({ saltNonce: '2', score: 120, twoColor: false }),
      makeCandidate({ saltNonce: '3', score: 110, twoColor: false }),
    ]

    const result = selectReported(candidates, { twoColor: true, minContrast: 0, keep: 20 })

    expect(result.usedFallback).toBe(true)
    expect(result.droppedCount).toBe(0)
    expect(result.reported).toEqual(candidates)
  })

  it('still respects --keep when falling back to the unfiltered list', () => {
    const candidates = [
      makeCandidate({ saltNonce: '1', score: 130, twoColor: false }),
      makeCandidate({ saltNonce: '2', score: 120, twoColor: false }),
      makeCandidate({ saltNonce: '3', score: 110, twoColor: false }),
    ]

    const result = selectReported(candidates, { twoColor: true, minContrast: 0, keep: 2 })

    expect(result.usedFallback).toBe(true)
    expect(result.reported.length).toBe(2)
  })
})
