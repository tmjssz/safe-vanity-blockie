'use client'

import type { FaceFilters } from '../lib/config'
import { FacePicker } from './FacePicker'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

export interface FaceSectionProps {
  mouths: string[]
  filters: FaceFilters
  onMouthsChange: (names: string[]) => void
  onFiltersChange: (filters: FaceFilters) => void
}

export function FaceSection({
  mouths,
  filters,
  onMouthsChange,
  onFiltersChange,
}: FaceSectionProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle>Face</CardTitle>
        <Badge variant="secondary">{mouths.join(', ')}</Badge>
      </CardHeader>
      <CardContent>
        {/* Unlike Configure, this never locks: expressions/filters are a scoring concern, not an address concern, so the running search just keeps applying them live — do not "fix" this into locking. */}
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
