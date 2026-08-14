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
 * The face target and its filters, always open.
 *
 * This was a Collapsible that started open. The collapse was there because the picker is ~600px
 * of checkboxes, filters, explanatory paragraphs and previews sitting between the caveat and the
 * results for a whole session — but the only thing it ever did was hide something the reader can
 * scroll past for free, and it cost a control, a chevron and a piece of state to do it.
 *
 * The header's summary badge went with it. It listed the accepted expressions so the collapsed
 * card still said what was accepted; with nothing to collapse, it was restating a few pixels above
 * the labelled, individually-checked toggles that are the answer.
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
        <CardTitle as="h2">Face</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Unlike Configure, this never locks: expressions/filters are a scoring concern, not an
            address concern, so the running search just keeps applying them live — do not "fix"
            this into locking. */}
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
