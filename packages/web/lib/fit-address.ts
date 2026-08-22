/**
 * The fewest characters kept on each side of the ellipsis. Four is the tail the mining status bar
 * and the wallet chip keep, so however cramped a tile gets, an address still ends the way it does
 * everywhere else in the app — and four is about the point below which a hex string stops being
 * recognisable at all.
 *
 * It is a floor, not a target: a row narrower than `MIN_HALF_LENGTH * 2 + 1` characters clips
 * rather than shrinking further, because a symmetric abbreviation is the thing being protected
 * here and going below this would make it useless in both directions at once.
 */
export const MIN_HALF_LENGTH = 4

/**
 * As much of `address` as `budget` characters can hold, shortened down the middle.
 *
 * The two sides are always the SAME length. That is the whole point of the function: an
 * abbreviation whose halves differ reads as an address that has been damaged rather than
 * shortened, and the eye compares prefixes across a grid of tiles by their shape. Two halves and
 * an ellipsis being an odd number of characters, an even budget therefore has one to spare, and it
 * goes unspent: a budget of 21 and a budget of 22 both produce ten-and-ten, because eleven-and-ten
 * is not what was asked for.
 *
 * `budget` is a character count, which is what makes this callable from a test and from the
 * measuring hook alike: it is the caller's job to know how many characters fit (see
 * use-fitted-address), and this function's job to spend them evenly. A budget that covers the
 * whole address returns it untouched — with a monospace row and a wide enough tile, nothing is
 * hidden at all. A budget of 0 or a negative one is a row too narrow for any abbreviation worth
 * rendering, and falls through to the floor above rather than to an empty string; a budget that is
 * not a finite number is a measurement that did not happen, and shortens nothing.
 */
export function fitAddress(address: string, budget: number): string {
  if (!Number.isFinite(budget) || budget >= address.length) return address
  // One character of the budget goes to the ellipsis itself; the rest is split evenly, and the odd
  // one out is spent on neither side.
  const half = Math.max(MIN_HALF_LENGTH, Math.floor((budget - 1) / 2))
  // Two halves plus an ellipsis can be longer than the address they abbreviate — for a 42-character
  // address that is any budget from 41 up, and for the floor it is any address of 9 or fewer. The
  // address itself is the shorter string then, and always the better one.
  if (half * 2 + 1 >= address.length) return address
  return `${address.slice(0, half)}…${address.slice(-half)}`
}
