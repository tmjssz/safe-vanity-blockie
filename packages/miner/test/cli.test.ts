import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { type Candidate, getTemplate, selectReported } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import {
  activeFilterFlags,
  buildProgressBlock,
  createInterruptHandler,
  resolveFaceSpec,
  writeOutputFile,
} from '../src/cli.js'
import { asciiFor } from '../src/report.js'

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

  // What the browser app's "Run on your machine" command hands over for a narrowed selection:
  // the builtins name one expression or all five, and nothing in between.
  it('resolves a comma-separated list of expressions, as --owners lists its addresses', () => {
    const spec = resolveFaceSpec('smile,open')
    expect(spec.name).toBe('smile,open')
    expect(spec.regions[0].alternatives.map((alternative) => alternative.name)).toEqual([
      'smile',
      'open',
    ])
  })

  it('rejects an unknown name that is not a file path', () => {
    expect(() => resolveFaceSpec('grin')).toThrow(/unknown target "grin"/)
    expect(() => resolveFaceSpec('smile,grin')).toThrow(/unknown target "smile,grin"/)
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

describe('buildProgressBlock', () => {
  const progress = (best: Candidate[]) => ({
    scanned: 1_000_000,
    elapsedMs: 65_000,
    rate: 1_500_000,
    best,
  })

  const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
    saltNonce: '1885506',
    address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
    score: 120,
    maxScore: 133,
    twoColor: true,
    contrast: 157,
    regions: { mouth: 'small' },
    ...overrides,
  })

  const selection = { twoColor: false, minContrast: 0, minMatch: 0, keep: 5 }

  it('is a single status line before any candidate exists', () => {
    const block = buildProgressBlock(progress([]), selection, 5)
    expect(block).toHaveLength(1)
    expect(block[0]).toContain('no candidates yet')
  })

  it('draws the labelled result strip above the status line once a best exists', () => {
    const block = buildProgressBlock(progress([candidate()]), selection, 5)
    // blank + label row + 8 face rows + saltNonce caption + blank + status line
    expect(block).toHaveLength(13)
    expect(block[1]).toContain('#1 90.2%')
    expect(block[10]).toContain('1885506')
    expect(block[12]).toContain('best 90.2%')
  })

  it('pads the images with blank lines so they stand apart from the surrounding output', () => {
    const block = buildProgressBlock(progress([candidate()]), selection, 5)
    expect(block[0].trim()).toBe('')
    expect(block[block.length - 2].trim()).toBe('')
  })

  it('adds no padding when there is nothing to draw', () => {
    const block = buildProgressBlock(progress([]), selection, 5)
    expect(block).toHaveLength(1)
    expect(block[0].trim()).not.toBe('')
  })

  it('shows up to five results side by side, the same as the final report', () => {
    const many = [1, 2, 3, 4, 5, 6].map((n) =>
      candidate({ address: '0x' + String(n).repeat(40), score: 130 - n }),
    )
    const block = buildProgressBlock(progress(many), selection, 5)
    expect(block[1]).toContain('#5')
    expect(block[1]).not.toContain('#6')
  })

  it('applies the same filters as the final report, so the live view matches the result', () => {
    const threeColour = candidate({ address: '0x' + 'a'.repeat(40), score: 125, twoColor: false })
    const twoColour = candidate({ address: '0x' + 'b'.repeat(40), score: 120, twoColor: true })
    const block = buildProgressBlock(
      progress([threeColour, twoColour]),
      { twoColor: true, minContrast: 0, keep: 5 },
      5,
    )
    expect(block[1]).toContain('#1 90.2%')
    expect(block[1]).not.toContain('94.0%')
    expect(block[block.length - 1]).toContain('best 90.2%')
  })

  it('applies the match floor live too, so a strict --min-match is not a surprise at the end', () => {
    const close = candidate({ address: '0x' + 'a'.repeat(40), score: 128 })
    const distant = candidate({ address: '0x' + 'b'.repeat(40), score: 100 })
    const block = buildProgressBlock(
      progress([close, distant]),
      { twoColor: false, minContrast: 0, minMatch: 90, keep: 5 },
      5,
    )
    expect(block[1]).toContain('#1 96.2%')
    expect(block[1]).not.toContain('75.2%')
  })

  it('renders the same face the final report prints for that address', () => {
    const address = '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5'
    const block = buildProgressBlock(progress([candidate({ address })]), selection, 5)
    expect(block.slice(2, 10).map((line) => line.trim())).toEqual(
      asciiFor(address).map((line) => line.trim()),
    )
  })

  it('includes elapsed time and rate in the status line', () => {
    const block = buildProgressBlock(progress([candidate()]), selection, 5)
    const status = block[block.length - 1]
    expect(status).toContain('1m 05s')
    expect(status).toContain('1.50M/s')
  })
})

// The one list of "which flags are excluding things", so the two messages that name them cannot
// come to name different sets — and so adding a filter cannot leave one of them silently stale.
describe('activeFilterFlags', () => {
  it('names only the flags that are actually constraining something', () => {
    expect(activeFilterFlags({ twoColor: true, minContrast: 0, minMatch: 0 })).toEqual([
      '--two-color',
    ])
    expect(activeFilterFlags({ twoColor: false, minContrast: 150, minMatch: 0 })).toEqual([
      '--min-contrast',
    ])
    expect(activeFilterFlags({ twoColor: false, minContrast: 0, minMatch: 90 })).toEqual([
      '--min-match',
    ])
  })

  it('names every active flag, in the order the help text lists them', () => {
    expect(activeFilterFlags({ twoColor: true, minContrast: 150, minMatch: 90 })).toEqual([
      '--two-color',
      '--min-contrast',
      '--min-match',
    ])
  })

  it('is empty when nothing is being filtered', () => {
    expect(activeFilterFlags({ twoColor: false, minContrast: 0, minMatch: 0 })).toEqual([])
  })
})

describe('createInterruptHandler', () => {
  /** A handler wired to recording callbacks, with the clock under the test's control. */
  const setup = (graceMs?: number) => {
    const calls: string[] = []
    let clock = 1_000
    const handler = createInterruptHandler({
      onStop: () => calls.push('stop'),
      onForceQuit: () => calls.push('force-quit'),
      graceMs,
      now: () => clock,
    })
    return { calls, handler, advance: (ms: number) => (clock += ms) }
  }

  it('stops the run gracefully on the first interrupt', () => {
    const { calls, handler } = setup()
    handler()
    expect(calls).toEqual(['stop'])
  })

  // One Ctrl+C reaches the CLI twice under `npm run` / `npx`: the terminal signals the whole
  // foreground process group, and the launcher forwards the signal it received to its child on
  // top of that. Counting signals read that duplicate as "quit and discard", so a single
  // keypress threw away the results the same keypress had just promised to keep.
  it('ignores a duplicate signal from one keypress rather than discarding the results', () => {
    const { calls, handler, advance } = setup()
    handler()
    advance(3)
    handler()
    expect(calls).toEqual(['stop'])
  })

  it('force-quits when a second interrupt follows the notice deliberately', () => {
    const { calls, handler, advance } = setup()
    handler()
    advance(2_000)
    handler()
    expect(calls).toEqual(['stop', 'force-quit'])
  })

  // The window is measured from the first interrupt, so a stream of duplicates cannot keep
  // pushing the force-quit out of reach of someone escaping a wedged run.
  it('measures the window from the first interrupt, not the last ignored one', () => {
    const { calls, handler, advance } = setup(1_000)
    handler()
    for (let i = 0; i < 5; i++) {
      advance(150)
      handler()
    }
    expect(calls).toEqual(['stop'])
    advance(300)
    handler()
    expect(calls).toEqual(['stop', 'force-quit'])
  })
})

describe('writeOutputFile', () => {
  // The default --out is a bare filename, and a run is often started from a directory the reader
  // is no longer in by the time they go looking (or from a launcher that chose the cwd for them).
  // A relative name in the report leaves them guessing which directory it was relative to.
  it('reports the absolute path even when written to a relative one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svb-out-'))
    const previous = process.cwd()
    process.chdir(dir)
    try {
      const result = writeOutputFile('safe-vanity-blockie-20260828-113042Z.json', '{"ok":true}')
      expect(result.ok).toBe(true)
      expect(isAbsolute(result.message.replace('Wrote ', ''))).toBe(true)
      expect(result.message).toBe(
        `Wrote ${join(process.cwd(), 'safe-vanity-blockie-20260828-113042Z.json')}`,
      )
      expect(readFileSync('safe-vanity-blockie-20260828-113042Z.json', 'utf8')).toBe('{"ok":true}')
    } finally {
      process.chdir(previous)
    }
  })

  it('leaves an absolute path as given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svb-out-'))
    const path = join(dir, 'results.json')
    expect(writeOutputFile(path, '{}').message).toBe(`Wrote ${path}`)
  })

  // A bad --out must not cost a multi-hour run its report, so a failure is reported rather than
  // thrown -- and it names the absolute path too, since that is what makes the reason obvious.
  it('reports a failed write without throwing, naming the absolute path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svb-out-'))
    const path = join(dir, 'no-such-directory', 'results.json')
    const result = writeOutputFile(path, '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain(`could not write ${path}`)
    expect(result.message).toMatch(/ENOENT/)
  })
})
