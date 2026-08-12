'use client'

import { ChevronDown } from 'lucide-react'
import type { FaceFilters } from '../lib/config'
import { FacePicker } from './FacePicker'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

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
    // Collapsible, but `defaultOpen`: the picker is ~600px of checkboxes, filters, three
    // explanatory paragraphs and up to five previews, and it used to sit between the caveat and
    // the results for the entire session — the one place the spec's "a layout that grows
    // unreadable as results accumulate" survived. Starting open keeps it discoverable; the
    // summary badge stays in the header so the collapsed state still says what is accepted.
    <Collapsible defaultOpen>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Face</CardTitle>
          <CardAction>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{mouths.join(', ')}</Badge>
              <CollapsibleTrigger asChild>
                {/* Radix puts data-state on the trigger itself, so the chevron is rotated from
                    the parent rather than from any state this component has to hold. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2 [&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-180"
                >
                  <ChevronDown />
                  <span className="sr-only">Show or hide the face options</span>
                </Button>
              </CollapsibleTrigger>
            </div>
          </CardAction>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            {/* Unlike Configure, this never locks: expressions/filters are a scoring concern, not an address concern, so the running search just keeps applying them live — do not "fix" this into locking. */}
            <FacePicker
              value={mouths}
              onChange={onMouthsChange}
              filters={filters}
              onFiltersChange={onFiltersChange}
            />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
