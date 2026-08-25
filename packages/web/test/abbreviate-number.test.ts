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
  // outgrown the unit printed next to it. Promoting exactly the values that round up into the
  // next unit is what keeps that from ever being rendered.
  it('promotes a value that rounds past its own unit', () => {
    expect(abbreviateNumber(999_950)).toBe('1.0M')
    expect(abbreviateNumber(999_950_000)).toBe('1.0B')
    expect(abbreviateNumber(999.95)).toBe('1.0K')
  })

  // The other half of the same rule, and the one that keeps the figure honest: promotion is
  // worth a rounding step, not 5% of a unit. A bar reading "1.0M checked" whose own tooltip
  // reads "952,300 nonces checked" is the bar contradicting itself.
  it('leaves a value that has not reached the next unit in its own', () => {
    expect(abbreviateNumber(950_000)).toBe('950.0K')
    expect(abbreviateNumber(952_300)).toBe('952.3K')
    expect(abbreviateNumber(999_949)).toBe('999.9K')
    expect(abbreviateNumber(999)).toBe('999')
  })

  // The nonce count is on the bar to stop changing width, so it takes one decimal whatever it
  // reads. The rate is the one live figure on the bar, and at one decimal it would sit frozen
  // at "1.0M/s" across every speed from 1.00M/s to 1.04M/s.
  it('takes the number of decimals it is asked for', () => {
    expect(abbreviateNumber(1_030_000, 2)).toBe('1.03M')
    expect(abbreviateNumber(1_049_000, 2)).toBe('1.05M')
    expect(abbreviateNumber(83_200_000, 2)).toBe('83.20M')
  })

  // The promotion rule is stated in printed digits, so it has to move with them: at two
  // decimals "1000.00K" only appears from 999,995 up, and 999,950 is still a K.
  it('promotes at the precision it is printing', () => {
    expect(abbreviateNumber(999_995, 2)).toBe('1.00M')
    expect(abbreviateNumber(999_950, 2)).toBe('999.95K')
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
