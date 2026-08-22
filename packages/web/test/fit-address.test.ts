import { describe, expect, it } from 'vitest'
import { fitAddress, MIN_HALF_LENGTH } from '../lib/fit-address'

const ADDRESS = '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5'

/** The two sides of an abbreviation, or undefined for a string that was not abbreviated. */
function halves(fitted: string): { head: string; tail: string } | undefined {
  const parts = fitted.split('…')
  if (parts.length === 1) return undefined
  expect(parts).toHaveLength(2)
  return { head: parts[0], tail: parts[1] }
}

describe('fitAddress', () => {
  it('returns the address untouched when the budget covers it', () => {
    expect(fitAddress(ADDRESS, ADDRESS.length)).toBe(ADDRESS)
    expect(fitAddress(ADDRESS, ADDRESS.length + 20)).toBe(ADDRESS)
    expect(fitAddress(ADDRESS, Number.POSITIVE_INFINITY)).toBe(ADDRESS)
  })

  // The property the whole function exists for, asserted across every budget that abbreviates at
  // all rather than at a couple of hand-picked widths: whatever the row is worth, the two sides of
  // the ellipsis are the same length.
  it('spends the budget evenly, at every width', () => {
    for (let budget = 0; budget <= ADDRESS.length + 4; budget++) {
      const fitted = fitAddress(ADDRESS, budget)
      const split = halves(fitted)
      if (!split) continue
      expect(split.head.length, `budget ${budget}`).toBe(split.tail.length)
      expect(split.head).toBe(ADDRESS.slice(0, split.head.length))
      expect(split.tail).toBe(ADDRESS.slice(-split.tail.length))
    }
  })

  it('never renders more characters than the budget allows', () => {
    for (let budget = MIN_HALF_LENGTH * 2 + 1; budget < ADDRESS.length; budget++) {
      expect(fitAddress(ADDRESS, budget).length, `budget ${budget}`).toBeLessThanOrEqual(budget)
    }
  })

  // Two halves and an ellipsis is an odd number of characters, so an even budget has one left over.
  // It is wasted rather than spent: 21 and 22 both hold ten-and-ten, because eleven-and-ten is not
  // a symmetric abbreviation and is the thing being ruled out.
  it('wastes the odd character instead of lengthening one side', () => {
    expect(fitAddress(ADDRESS, 21)).toBe('0x70e9f0a8…d2e804eed5')
    expect(fitAddress(ADDRESS, 21)).toBe(`${ADDRESS.slice(0, 10)}…${ADDRESS.slice(-10)}`)
    expect(fitAddress(ADDRESS, 22)).toBe(fitAddress(ADDRESS, 21))
    expect(fitAddress(ADDRESS, 23)).toBe(`${ADDRESS.slice(0, 11)}…${ADDRESS.slice(-11)}`)
  })

  // A tile can be narrower than any useful abbreviation. Those budgets land on the floor rather
  // than on an empty row or a single character, and the row's own `truncate` is what keeps the
  // overflow that follows from reaching the layout.
  it('holds the floor for budgets too small to honour', () => {
    const floor = `${ADDRESS.slice(0, MIN_HALF_LENGTH)}…${ADDRESS.slice(-MIN_HALF_LENGTH)}`
    for (const budget of [0, 1, 5, MIN_HALF_LENGTH * 2, -10]) {
      expect(fitAddress(ADDRESS, budget), `budget ${budget}`).toBe(floor)
    }
  })

  // A number that is not a number is not a narrow tile: it is a measurement that did not happen,
  // and shortening an address on the strength of it would be inventing a width. The whole string is
  // the honest answer, and the row clips it.
  it('does not shorten anything on a budget it cannot read', () => {
    expect(fitAddress(ADDRESS, Number.NaN)).toBe(ADDRESS)
  })

  // Two halves and an ellipsis can be longer than what they abbreviate — for the floor, that is any
  // address of nine characters or fewer. The original is the shorter string then, and the better
  // one: an "abbreviation" that adds characters is never worth rendering.
  it('prefers a short address to an abbreviation longer than it', () => {
    expect(fitAddress('0x1234567', 0)).toBe('0x1234567')
    expect(fitAddress('0x12', 0)).toBe('0x12')
    expect(fitAddress('', 0)).toBe('')
  })
})
