import { describe, expect, it } from 'vitest'
import { formatDuration } from '../lib/format-duration'

// These are the same cases packages/miner/test/report.test.ts pins for its own formatDuration:
// the web UI and the CLI must agree on how long a run has been going, and this package cannot
// depend on @safe-vanity-blockie/miner to share the implementation. If either side changes, the
// two suites disagree and this file is the reminder.
describe('formatDuration', () => {
  it('reports seconds alone under a minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(999)).toBe('0s')
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(59_999)).toBe('59s')
  })

  it('pads the seconds once minutes appear', () => {
    expect(formatDuration(60_000)).toBe('1m 00s')
    expect(formatDuration(125_000)).toBe('2m 05s')
    expect(formatDuration(3_599_000)).toBe('59m 59s')
  })

  it('pads minutes and seconds once hours appear', () => {
    expect(formatDuration(3_600_000)).toBe('1h 00m 00s')
    expect(formatDuration(3_725_000)).toBe('1h 02m 05s')
    expect(formatDuration(45 * 3_600_000 + 61_000)).toBe('45h 01m 01s')
  })

  it('floors fractions and clamps a negative duration to zero', () => {
    expect(formatDuration(-5000)).toBe('0s')
    expect(formatDuration(1500.7)).toBe('1s')
  })
})
