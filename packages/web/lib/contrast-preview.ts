export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * The largest distance the contrast filter can ask for: black against white, which is
 * `sqrt(255² × 3)`. The slider is capped at 442, the rounded-up whole number above it.
 */
export const MAX_RGB_DISTANCE = Math.sqrt(3 * 255 ** 2)

/** Euclidean distance in RGB space, the same measure the miner filters candidates by. */
export function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/**
 * Two colours exactly `distance` apart, for the swatch pair beside the contrast slider.
 *
 * They are greys, and that is forced rather than chosen. The pair has to be exact at every value
 * the slider can produce, and the gamut does not allow that for a coloured axis: moving both
 * colours apart along, say, red-versus-cyan runs one of them out of range at about 360, well
 * below the 442 the scale goes to. The achromatic axis is the *only* direction where a pair
 * centred on mid-grey stays inside 0..255 all the way to the top — and there the two ends are
 * black and white, which is exactly what the scale's own anchor label promises.
 *
 * Both colours move symmetrically away from mid-grey, so the swatches vary in the one dimension
 * the slider controls and nothing else.
 */
export function contrastPairForDistance(distance: number): [Rgb, Rgb] {
  const clamped = Math.min(Math.max(distance, 0), MAX_RGB_DISTANCE)
  // Splitting the distance across three equal channels means each channel moves by
  // `distance / (2 · √3)` from the midpoint, since the Euclidean distance of an equal move in
  // three channels is `√3` times the per-channel move.
  const offset = clamped / (2 * Math.sqrt(3))
  // Clamped rather than trusted: at the very top of the scale the offset lands a floating-point
  // hair past 127.5, which rounds to -0 and would leave the swatch carrying `rgb(-0 -0 -0)`.
  // `Math.max` also collapses -0 to 0. Doing it here makes "always in gamut" a property of this
  // function rather than of the arithmetic happening to come out exact.
  const channel = (value: number) => Math.min(255, Math.max(0, Math.round(value)))
  const dark = channel(127.5 - offset)
  const light = channel(127.5 + offset)
  return [
    { r: dark, g: dark, b: dark },
    { r: light, g: light, b: light },
  ]
}

/** `rgb(…)` for inline styling, since these values are computed rather than themed. */
export function rgbCss({ r, g, b }: Rgb): string {
  return `rgb(${r} ${g} ${b})`
}
