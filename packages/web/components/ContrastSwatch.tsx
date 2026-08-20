import { contrastPairForDistance, rgbCss } from '../lib/contrast-preview'
import { cn } from '../lib/utils'

export interface ContrastSwatchProps {
  /** The RGB distance to depict — a `minContrast` filter value, or a candidate's own contrast. */
  distance: number
  /**
   * Sizes the pair. The two halves split whatever they are given, so this is the whole swatch:
   * `h-4 w-8` for the two 16px squares beside the filter slider, a fraction of that on a tile.
   */
  className?: string
}

/**
 * The two colours a contrast value stands for, side by side.
 *
 * Extracted from the contrast slider's own preview so the results grid can draw the same thing:
 * the number alone means nothing to anyone who has not internalised RGB distance, and a generic
 * contrast glyph says only "this figure is about contrast". The pair says what the figure looks
 * like — and it is the shape the user has already read while setting the filter, so a tile's
 * "· 157" and the slider's "157" now show the same picture.
 *
 * Always decorative: two grey rectangles say nothing to a screen reader, and both call sites state
 * the number in text beside them.
 */
export function ContrastSwatch({ distance, className }: ContrastSwatchProps) {
  // Greys, and that is forced rather than chosen — see lib/contrast-preview for why no coloured
  // axis can hold an exact pair all the way to 442.
  const [dark, light] = contrastPairForDistance(distance)

  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 overflow-hidden rounded-sm border', className)}
    >
      <span
        data-slot="contrast-swatch"
        className="h-full flex-1"
        style={{ backgroundColor: rgbCss(dark) }}
      />
      <span
        data-slot="contrast-swatch"
        className="h-full flex-1"
        style={{ backgroundColor: rgbCss(light) }}
      />
    </span>
  )
}
