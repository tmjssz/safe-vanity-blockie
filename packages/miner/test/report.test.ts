import type { Candidate } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import {
  buildGalleryHtml,
  buildResultsJson,
  filterCandidates,
  formatLeaderboard,
  renderAscii,
  type ResultConfig,
} from '../src/report.js'

const CONFIG: ResultConfig = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1',
  chainId: '1',
  target: 'faces',
  maxScore: 133,
  start: 0,
  scanned: 100000,
  nextStart: 25000,
  workers: 4,
  perWorker: 25000,
  generatedAt: '2026-08-06T00:00:00.000Z',
  isL1SafeSingleton: false,
  selfCheck: 'passed',
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    saltNonce: '5254976178',
    address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    score: 131,
    maxScore: 133,
    twoColor: true,
    contrast: 170,
    regions: { mouth: 'small' },
    ...overrides,
  }
}

describe('renderAscii', () => {
  it('renders 8 rows of 8 mirrored cells', () => {
    const data = new Uint8Array(32)
    data[0] = 1 // row 0, col 0 -> mirrors to col 7
    const lines = renderAscii(data)
    expect(lines).toHaveLength(8)
    expect(lines[0]).toBe('██            ██')
    expect(lines[1]).toBe('                ')
  })

  it('distinguishes the spot colour from the main colour', () => {
    const data = new Uint8Array(32)
    data[1] = 2
    expect(renderAscii(data)[0]).toContain('▒▒')
  })
})

describe('filterCandidates', () => {
  it('drops non-two-colour results when two-colour is requested', () => {
    const entries = [candidate({ address: '0xa' }), candidate({ address: '0xb', twoColor: false })]
    expect(filterCandidates(entries, { twoColor: true, minContrast: 0 })).toHaveLength(1)
    expect(filterCandidates(entries, { twoColor: false, minContrast: 0 })).toHaveLength(2)
  })

  it('drops results below the contrast floor', () => {
    const entries = [candidate({ address: '0xa', contrast: 200 }), candidate({ address: '0xb', contrast: 50 })]
    expect(filterCandidates(entries, { twoColor: false, minContrast: 150 })).toHaveLength(1)
  })
})

describe('buildResultsJson', () => {
  it('emits config plus results with saltNonce as a string', () => {
    const parsed = JSON.parse(buildResultsJson(CONFIG, [candidate()]))
    expect(parsed.config).toMatchObject({
      chainId: '1',
      safeVersion: '1.4.1',
      maxScore: 133,
      isL1SafeSingleton: false,
      selfCheck: 'passed',
    })
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0]).toEqual({
      saltNonce: '5254976178',
      address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      score: 131,
      max: 133,
      twoColor: true,
      contrast: 170,
      mouth: 'small',
    })
  })

  it('keeps huge saltNonces exact', () => {
    const huge = '18446744073709551616'
    const parsed = JSON.parse(buildResultsJson(CONFIG, [candidate({ saltNonce: huge })]))
    expect(parsed.results[0].saltNonce).toBe(huge)
  })

  it('never lets an untrusted region name shadow a fixed result field', () => {
    const entry = candidate({
      regions: { saltNonce: 'smile', address: 'frown', score: 'neutral' },
    })
    const parsed = JSON.parse(buildResultsJson(CONFIG, [entry]))
    expect(parsed.results[0].saltNonce).toBe(entry.saltNonce)
    expect(parsed.results[0].address).toBe(entry.address)
    expect(parsed.results[0].score).toBe(entry.score)
  })
})

describe('buildGalleryHtml', () => {
  it('produces a self-contained page with one real blo svg per result', () => {
    const html = buildGalleryHtml(CONFIG, [candidate(), candidate({ address: '0x' + '11'.repeat(20) })])
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/<script|https?:\/\/[^"]*\.(js|css)/)
    expect(html.match(/<svg /g)).toHaveLength(2)
    expect(html).toContain('5254976178')
    expect(html).toContain('cosmetic')
  })

  it('reports the L1 singleton flag and the self-check outcome', () => {
    const html = buildGalleryHtml({ ...CONFIG, isL1SafeSingleton: true, selfCheck: 'failed' }, [candidate()])
    expect(html).toContain('<dt>L1 singleton</dt><dd>yes</dd>')
    expect(html).toContain('<dt>self-check</dt><dd>failed</dd>')
  })

  it('escapes text that comes from the config', () => {
    const html = buildGalleryHtml({ ...CONFIG, target: '<img src=x onerror=alert(1)>' }, [candidate()])
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})

describe('formatLeaderboard', () => {
  it('renders one line per candidate up to the limit', () => {
    const entries = [candidate({ address: '0xa' }), candidate({ address: '0xb' }), candidate({ address: '0xc' })]
    const lines = formatLeaderboard(entries, 2).trim().split('\n')
    expect(lines.filter((line) => line.includes('0x'))).toHaveLength(2)
    expect(lines[0]).toMatch(/score/i)
  })
})
