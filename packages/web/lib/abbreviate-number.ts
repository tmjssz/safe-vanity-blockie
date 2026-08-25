/**
 * A count or a rate, short enough to sit on one line of the status bar.
 *
 * The bar's nonce count runs into eleven digits within a minute of a run starting, and it
 * re-renders several times a second: at full width it is both the widest thing on the row and
 * the one that reflows it. Abbreviated it is four characters that never change width, and the
 * exact figure is a tooltip away on the same element (see MiningStatusBar).
 *
 * One decimal, always, including "1.0M": a suffix that sometimes carries a decimal and
 * sometimes does not is a number whose width changes as it grows, which is the thing this
 * exists to stop. `decimals` raises that for a figure whose width is not the problem — the
 * rate takes two, because at one it would read a frozen "1.0M/s" from 1.00M/s to 1.04M/s.
 */
const UNITS = [
  { threshold: 1e12, suffix: 'T' },
  { threshold: 1e9, suffix: 'B' },
  { threshold: 1e6, suffix: 'M' },
  { threshold: 1e3, suffix: 'K' },
] as const

export function abbreviateNumber(value: number, decimals = 1): string {
  // The rate is `(scanned / elapsedMs) * 1000`, which is NaN or Infinity on a tick where no
  // time has passed yet. Neither is a speed, and both render as literal text.
  const safe = Number.isFinite(value) && value > 0 ? value : 0

  for (const { threshold, suffix } of UNITS) {
    // Largest unit first, against the unrounded value less half of the last digit that gets
    // printed one unit DOWN. That slack is exactly the set of values which would otherwise
    // render a mantissa that has outgrown its own suffix: 999,950 is 999.95K, printed at one
    // decimal as "1000.0K", so it belongs to M. Nothing wider gets in — comparing the value
    // already rounded at this unit would let 950,000 through as "1.0M", a 5% overstatement
    // sitting next to a tooltip reading 950,000.
    if (safe >= threshold - threshold / (2000 * 10 ** decimals)) {
      return `${(safe / threshold).toFixed(decimals)}${suffix}`
    }
  }
  // Under a thousand, so it fits as it is. Ungrouped, because three digits do not need
  // separators and "900" is what the eye expects beside "1.3K".
  return String(Math.round(safe))
}
