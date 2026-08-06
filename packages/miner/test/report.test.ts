import type { Candidate } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import {
  asciiFor,
  buildGalleryHtml,
  buildResultStrip,
  resultColumnsForWidth,
  formatDuration,
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
  elapsedMs: 3_725_000,
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

describe('formatDuration', () => {
  it('renders sub-minute durations in whole seconds', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(999)).toBe('0s')
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(59_999)).toBe('59s')
  })

  it('renders minutes with zero-padded seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 00s')
    expect(formatDuration(125_000)).toBe('2m 05s')
    expect(formatDuration(3_599_000)).toBe('59m 59s')
  })

  it('renders hours with zero-padded minutes and seconds', () => {
    expect(formatDuration(3_600_000)).toBe('1h 00m 00s')
    expect(formatDuration(3_725_000)).toBe('1h 02m 05s')
    expect(formatDuration(45 * 3_600_000 + 61_000)).toBe('45h 01m 01s')
  })

  it('never emits a negative or fractional duration', () => {
    expect(formatDuration(-5000)).toBe('0s')
    expect(formatDuration(1500.7)).toBe('1s')
  })
})

describe('buildGalleryHtml elapsed time', () => {
  it('shows how long the run took', () => {
    const html = buildGalleryHtml(CONFIG, [candidate()])
    expect(html).toContain('1h 02m 05s')
    expect(html).toContain('mining time')
  })
})

describe('buildResultsJson elapsed time', () => {
  it('records elapsedMs in the config', () => {
    const parsed = JSON.parse(buildResultsJson(CONFIG, [candidate()]))
    expect(parsed.config.elapsedMs).toBe(3_725_000)
  })
})

describe('resultColumnsForWidth', () => {
  it('fits as many full-size blockies as the width allows', () => {
    // Each column is 16 characters wide with a 4-character gutter between columns.
    expect(resultColumnsForWidth(96, 5)).toBe(5)
    expect(resultColumnsForWidth(95, 5)).toBe(4)
    expect(resultColumnsForWidth(80, 5)).toBe(4)
    expect(resultColumnsForWidth(75, 5)).toBe(3)
    expect(resultColumnsForWidth(56, 5)).toBe(3)
    expect(resultColumnsForWidth(36, 5)).toBe(2)
    expect(resultColumnsForWidth(16, 5)).toBe(1)
  })

  it('never drops below one column, however narrow the terminal', () => {
    expect(resultColumnsForWidth(5, 5)).toBe(1)
    expect(resultColumnsForWidth(0, 5)).toBe(1)
    expect(resultColumnsForWidth(-40, 5)).toBe(1)
  })

  it('never exceeds the requested maximum, however wide the terminal', () => {
    expect(resultColumnsForWidth(1000, 5)).toBe(5)
    expect(resultColumnsForWidth(1000, 2)).toBe(2)
  })
})

describe('buildResultStrip', () => {
  const entry = (rank: number, score: number): Candidate =>
    candidate({ address: '0x' + String(rank).repeat(40), score })

  it('is empty when there are no results', () => {
    expect(buildResultStrip([], { maxResults: 5, columnsPerRow: 5 })).toEqual([])
  })

  it('renders every result at full size, in one row, labelled from #1', () => {
    const strip = buildResultStrip([entry(1, 120), entry(2, 119)], {
      maxResults: 5,
      columnsPerRow: 5,
    })
    expect(strip).toHaveLength(9)
    expect(strip[0]).toContain('#1 120/133')
    expect(strip[0]).toContain('#2 119/133')
  })

  it('uses the same full-size renderer as the standalone face', () => {
    const address = '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5'
    const strip = buildResultStrip([candidate({ address })], { maxResults: 5, columnsPerRow: 5 })
    expect(strip.slice(1).map((line) => line.trimEnd())).toEqual(
      asciiFor(address).map((line) => line.trimEnd()),
    )
    for (const line of asciiFor(address)) expect(line).toHaveLength(16)
  })

  it('wraps into a grid when the row cannot hold every result', () => {
    const five = [1, 2, 3, 4, 5].map((rank) => entry(rank, 130 - rank))
    const strip = buildResultStrip(five, { maxResults: 5, columnsPerRow: 2 })
    // three grid rows of 9 lines, separated by two blank lines
    expect(strip).toHaveLength(3 * 9 + 2)
    expect(strip[0]).toContain('#1')
    expect(strip[0]).toContain('#2')
    expect(strip[10]).toContain('#3')
    expect(strip[20]).toContain('#5')
  })

  it('never breaks an image across a line, whatever the column count', () => {
    const five = [1, 2, 3, 4, 5].map((rank) => entry(rank, 130 - rank))
    for (const columnsPerRow of [1, 2, 3, 4, 5]) {
      const strip = buildResultStrip(five, { maxResults: 5, columnsPerRow })
      const widest = Math.max(...strip.map((line) => line.length))
      expect(widest).toBeLessThanOrEqual(columnsPerRow * 16 + (columnsPerRow - 1) * 4)
    }
  })

  it('never shows more results than the maximum', () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((rank) => entry(rank, 130 - rank))
    const strip = buildResultStrip(many, { maxResults: 5, columnsPerRow: 5 })
    expect(strip[0]).toContain('#5')
    expect(strip[0]).not.toContain('#6')
  })
})
