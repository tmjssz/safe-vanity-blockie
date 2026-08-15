'use client'

import type { FaceFilters } from '../lib/config'
import { FacePicker } from './FacePicker'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

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
