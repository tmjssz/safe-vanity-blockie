import { describe, expect, it } from 'vitest'
import {
  CONTRAST_MAX,
  contrastPairForDistance,
  MAX_RGB_DISTANCE,
  rgbDistance,
} from '../lib/contrast-preview'

describe('contrastPairForDistance', () => {
  // The swatches exist to answer "how different is 120, really?". A pair that only approximated
  // the number would answer a different question than the one beside it.
  it('produces a pair at exactly the distance asked for', () => {
    for (const distance of [0, 1, 37, 120, 255, 400, 441]) {
      const [a, b] = contrastPairForDistance(distance)
      // Within half a step: the channels are 8-bit integers, so an arbitrary distance is not
      // always exactly representable.
      expect(Math.abs(rgbDistance(a, b) - distance)).toBeLessThan(1)
    }
  })

  it('shows no difference at all at zero', () => {
    const [a, b] = contrastPairForDistance(0)
    expect(a).toEqual(b)
  })

  // The scale's own anchor label promises this, so the swatches have to deliver it rather than
  // stopping at a dark grey and a light one.
  it('reaches black and white at the top of the scale', () => {
    const [a, b] = contrastPairForDistance(MAX_RGB_DISTANCE)
    expect(a).toEqual({ r: 0, g: 0, b: 0 })
    expect(b).toEqual({ r: 255, g: 255, b: 255 })
  })

  // Every channel stays 0..255 across the whole range: a pair that clipped would silently stop
  // matching the number it is drawn beside.
  it('never leaves the gamut anywhere on the scale', () => {
    for (let distance = 0; distance <= MAX_RGB_DISTANCE; distance += 1) {
      for (const colour of contrastPairForDistance(distance)) {
        for (const channel of [colour.r, colour.g, colour.b]) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(255)
          expect(Number.isInteger(channel)).toBe(true)
        }
      }
    }
  })

  it('separates the pair monotonically as the distance grows', () => {
    let previous = -1
    for (let distance = 0; distance <= MAX_RGB_DISTANCE; distance += 7) {
      const [a, b] = contrastPairForDistance(distance)
      const spread = b.r - a.r
      expect(spread).toBeGreaterThanOrEqual(previous)
      previous = spread
    }
  })

  // The slider is clamped to 0..442, but a helper that answers nonsense for out-of-range input
  // is a helper that fails silently the day the range changes.
  it('clamps input outside the scale rather than leaving the gamut', () => {
    expect(contrastPairForDistance(-50)).toEqual(contrastPairForDistance(0))
    expect(contrastPairForDistance(9999)).toEqual(contrastPairForDistance(MAX_RGB_DISTANCE))
  })
})

// The contrast slider's ceiling, and now also the bound a `min-contrast=` link param is validated
// against (see lib/deep-link). It lives beside MAX_RGB_DISTANCE rather than in either consumer
// precisely so the slider's top and the link's limit cannot come to disagree — a link rejected at
// a value the slider will happily produce is a link the app refuses to read back from itself.
describe('CONTRAST_MAX', () => {
  it('is MAX_RGB_DISTANCE rounded up to a whole number a label can carry', () => {
    expect(CONTRAST_MAX).toBe(Math.ceil(MAX_RGB_DISTANCE))
    expect(CONTRAST_MAX).toBe(442)
    expect(Number.isInteger(CONTRAST_MAX)).toBe(true)
  })
})
