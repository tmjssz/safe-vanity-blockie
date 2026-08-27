import { cn } from '../lib/utils'

/**
 * The dots on both axes. 12 units wide with a 1.4 radius, so the ink spans 1.1 to 10.9 — a hair
 * under 11 of the 12, which is what keeps the glyph optically the same weight as the lucide icons
 * it sits among rather than a size larger.
 */
const STOPS = [2.5, 6, 9.5] as const

/**
 * A 3x3 grid of dots, checkered between two tones: the corners and the centre in the text's own
 * colour, the four edge-centres muted.
 *
 * It stands for the accepted expressions in a collapsed summary. A smiling face was the obvious
 * glyph and the wrong one — it drew one expression to label a chip whose whole job is to say how
 * many are accepted, so a chip reading "smile, frown" carried a picture of only the first. A grid
 * of cells says "a pattern over a grid", which is what an expression IS here: the miner scores a
 * blockie's 8x8 against a target, and every expression is one arrangement of those cells.
 *
 * Two tones rather than one because a single-tone grid of nine identical dots reads as a texture or
 * a drag handle. The checker gives it a figure — something arranged rather than merely repeated —
 * at a size where a real mouth shape would be mud.
 *
 * Both tones come from theme tokens and neither is written as a hex: the bright dots inherit
 * `currentColor`, so they are whatever the text beside them is, and the muted ones take
 * `fill-muted-foreground`. Light mode therefore needs nothing added, and a chip that changes its
 * text colour takes the glyph with it.
 *
 * Decorative, always: `aria-hidden` is set here rather than asked of callers, because the chip text
 * beside it carries the meaning in every place this can sensibly appear, and an aria-hidden a new
 * call site can forget is one that will be forgotten.
 */
export function ExpressionsGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      // `shrink-0` for the same reason every icon in a Badge carries it: the chip is a flex row and
      // a squeezed circle is more obviously wrong than clipped text.
      className={cn('shrink-0', className)}
    >
      {STOPS.map((cy, row) =>
        STOPS.map((cx, column) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r={1.4}
            // The checker: both indices even is a corner or the centre, which are the bright five.
            // Read off the indices rather than listed as coordinates so the pattern cannot be
            // half-applied by a later edit to STOPS.
            className={(row + column) % 2 === 0 ? undefined : 'fill-muted-foreground'}
            fill={(row + column) % 2 === 0 ? 'currentColor' : undefined}
          />
        )),
      )}
    </svg>
  )
}
