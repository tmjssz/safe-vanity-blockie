'use client'

import type { FaceFilters } from '../lib/config'
import { FacePicker } from './FacePicker'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from './ui/card'

export interface FaceSectionProps {
  mouths: string[]
  filters: FaceFilters
  onMouthsChange: (names: string[]) => void
  onFiltersChange: (filters: FaceFilters) => void
}

/**
 * What a candidate has to look like to be kept: which face shapes count, and which colour pairs.
 *
 * Named for what it does rather than what it draws. "Face" described the expression tiles alone
 * and left the two colour filters looking like strays in a card about something else.
 *
 * Not collapsible, and with no summary chip in the header. The collapse only ever hid something a
 * reader can scroll past for free, and the chip restated, a few pixels above, what the labelled
 * tiles already say.
 */
export function FaceSection({
  mouths,
  filters,
  onMouthsChange,
  onFiltersChange,
}: FaceSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Pattern filter</CardTitle>
        {/* The one thing a reader has to hold to make sense of the tiles below: accepting more
            expressions widens the target rather than diluting it. It is the whole of a paragraph
            that used to sit in the card body, kept because without it "accept more" reads like a
            trade-off, and reduced to a line because it is a premise, not an instruction. */}
        {/* CardAction rather than CardDescription: the header is a grid whose description row
            sits UNDER the title, and this belongs opposite it. It is prose rather than a control,
            which is the one thing that slot is usually for, but it is the slot that is the
            header's right-hand column. */}
        <CardAction>
          {/* Held to a narrow measure until there is room for the whole line: the header grid
              gives this column whatever it asks for, so unconstrained it would squeeze the title
              on a narrow card, and constrained everywhere it wraps to two lines on a wide one. */}
          <p className="max-w-xs text-sm text-muted-foreground sm:text-right lg:max-w-none">
            Candidates are credited with their best-fitting expression
          </p>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* Unlike Configure, this never locks: none of it is an address concern, so all of it
            stays reachable while mining and the page never unmounts it — do not "fix" this into
            locking.

            The two halves differ in when they take effect, and that is not the same thing. The
            colour filters re-filter candidates already mined, so they apply on the spot. The
            expressions are part of the run's identity, so applying one restarts the search and
            discards the board: those stage behind an Apply button and a warning. */}
        <FacePicker
          value={mouths}
          onChange={onMouthsChange}
          filters={filters}
          onFiltersChange={onFiltersChange}
        />
      </CardContent>
    </Card>
  )
}
