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
 * exists to stop.
 */
const UNITS = [
  { threshold: 1e12, suffix: 'T' },
  { threshold: 1e9, suffix: 'B' },
  { threshold: 1e6, suffix: 'M' },
  { threshold: 1e3, suffix: 'K' },
] as const

export function abbreviateNumber(value: number): string {
  // The rate is `(scanned / elapsedMs) * 1000`, which is NaN or Infinity on a tick where no
  // time has passed yet. Neither is a speed, and both render as literal text.
  const safe = Number.isFinite(value) && value > 0 ? value : 0

  for (const { threshold, suffix } of UNITS) {
    // Largest unit first, and the comparison is against the value ALREADY rounded to one
    // decimal. Rounding afterwards is what would print "1000.0K": 999,950 belongs to M once
    // it is rounded, and this loop reaches M with a rounded 1.0 rather than reaching K with
    // an unrounded 999.95.
    const scaled = Math.round((safe / threshold) * 10) / 10
    if (scaled >= 1) return `${scaled.toFixed(1)}${suffix}`
  }
  // Under a thousand, so it fits as it is. Ungrouped, because three digits do not need
  // separators and "900" is what the eye expects beside "1.3K".
  return String(Math.round(safe))
}
