import { describe, expect, it } from 'vitest'
import { abbreviateNumber } from '../lib/abbreviate-number'

describe('abbreviateNumber', () => {
  it('leaves a number below its first unit alone, ungrouped', () => {
    expect(abbreviateNumber(0)).toBe('0')
    expect(abbreviateNumber(7)).toBe('7')
    expect(abbreviateNumber(900)).toBe('900')
  })

  it('abbreviates to one decimal with a unit suffix', () => {
    expect(abbreviateNumber(1_300)).toBe('1.3K')
    expect(abbreviateNumber(83_200_000)).toBe('83.2M')
    expect(abbreviateNumber(4_200_000)).toBe('4.2M')
    expect(abbreviateNumber(1_030_000)).toBe('1.0M')
    expect(abbreviateNumber(60_000_016_650_000)).toBe('60.0T')
  })

  it('uses K, M, B and T in that order', () => {
    expect(abbreviateNumber(2_500)).toBe('2.5K')
    expect(abbreviateNumber(2_500_000)).toBe('2.5M')
    expect(abbreviateNumber(2_500_000_000)).toBe('2.5B')
    expect(abbreviateNumber(2_500_000_000_000)).toBe('2.5T')
  })

  // 999,950 scales to 999.95K, which one decimal rounds to "1000.0K": a figure that has
  // outgrown the unit printed next to it. Choosing the unit from the ROUNDED value is what
  // keeps that from ever being rendered.
  it('promotes a value that rounds past its own unit', () => {
    expect(abbreviateNumber(999_950)).toBe('1.0M')
    expect(abbreviateNumber(999_950_000)).toBe('1.0B')
    expect(abbreviateNumber(999)).toBe('1.0K')
  })

  it('rounds rather than truncating', () => {
    expect(abbreviateNumber(3_749_000)).toBe('3.7M')
    expect(abbreviateNumber(3_750_000)).toBe('3.8M')
  })

  // The rate is `(scanned / elapsedMs) * 1000` in use-miner, so a first tick with a zero
  // elapsed time hands this NaN or Infinity. A counter that reads "NaN/s" or "Infinity/s"
  // is worse than one that reads zero for a frame.
  it('reads zero for a value that is not a finite number', () => {
    expect(abbreviateNumber(Number.NaN)).toBe('0')
    expect(abbreviateNumber(Number.POSITIVE_INFINITY)).toBe('0')
    expect(abbreviateNumber(-5)).toBe('0')
  })
})
