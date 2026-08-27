'use client'

import type { FaceFilters } from '../lib/config'
import { ColorFilters } from './ColorFilters'
import { ExpressionPicker } from './ExpressionPicker'

export interface FacePickerProps {
  value: string[]
  onChange: (mouthNames: string[]) => void
  filters: FaceFilters
  onFiltersChange: (filters: FaceFilters) => void
  /** Whether there is a run for an apply to restart. Passed through; see ExpressionPicker. */
  live?: boolean
}

/**
 * The expressions and the colour filters side by side, which is how the results page shows them.
 *
 * Only the layout is left here. Both halves became components of their own when the expressions
 * moved out to be a section of Configure on the start screen, where they are always visible and the
 * three colour constraints sit behind a disclosure. This composition is what the results page still
 * wants: there the card is wide, both halves are equally reachable mid-run, and the expressions'
 * restart warning is the thing that tells them apart rather than their placement.
 */
export function FacePicker({
  value,
  onChange,
  filters,
  onFiltersChange,
  live = true,
}: FacePickerProps) {
  return (
    // A CONTAINER, so the split below can be asked of the space this card actually has rather
    // than of the window. It exists only to be that query's subject: an element cannot be its own
    // container, so the grid has to be a descendant of this.
    <div className="@container">
      {/* Two columns on a wide card: the tiles need the room, the two colour controls do not. They
          stack on a narrow one with the expressions first, because that is the filter people come
          here to change. `1.4fr` rather than an even split so five tiles fill their column instead
          of leaving half of it empty, which is what a single full-width row of them did.

          `@4xl` (896px) rather than the `lg:` this used to be, and the change from a viewport
          breakpoint to a container one is the point. This card is rendered at two very different
          widths — about 1072px inside the results page's card, and about 472px inside Configure's
          card on the start screen — and `lg:` cannot tell them apart: it fires on a
          wide desktop whatever the box around it is doing, which put two columns into 472px and
          left both of them too narrow to read. A container query asks the only question that
          actually decides the answer.

          896px is chosen to sit above every narrow case and below the results page's 1072px, so
          that page keeps exactly the layout it had. The one place the two rules disagree is a
          window between roughly 928 and 1024px wide, where `lg:` gave one column and this gives
          two; at that width there is room for two, so this is the better answer rather than a
          regression to accept. */}
      <div data-slot="picker-columns" className="grid gap-x-10 gap-y-6 @4xl:grid-cols-[1.4fr_1fr]">
        <ExpressionPicker value={value} onChange={onChange} live={live} />
        <ColorFilters filters={filters} onFiltersChange={onFiltersChange} />
      </div>
    </div>
  )
}
