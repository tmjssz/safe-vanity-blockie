'use client'

import { Check } from 'lucide-react'
import { useState } from 'react'
import type { FaceFilters } from '../lib/config'
import { ALL_MOUTH_NAMES } from '../lib/face-selection'
import { cn } from '../lib/utils'
import { TargetPreview } from './TargetPreview'
import { Badge } from './ui/badge'
import { Label } from './ui/label'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'

export interface FacePickerProps {
  value: string[]
  onChange: (mouthNames: string[]) => void
  filters: FaceFilters
  onFiltersChange: (filters: FaceFilters) => void
}

export function FacePicker({ value, onChange, filters, onFiltersChange }: FacePickerProps) {
  const [error, setError] = useState<string | undefined>()

  const toggle = (name: string) => {
    if (value.includes(name)) {
      if (value.length === 1) {
        setError('Keep at least one expression: a face needs a mouth to score against.')
        return
      }
      setError(undefined)
      onChange(value.filter((entry) => entry !== name))
      return
    }
    setError(undefined)
    onChange([...value, name])
  }

  return (
    <div className="space-y-4">
      {/* One heading for the group: the previews *are* the control now, so the old
          "Accepted expressions" legend and the separate "Target patterns" h3 described the same
          thing twice. h3 nests correctly under the card's h2 title. */}
      <h3 id="accepted-expressions" className="text-sm font-medium">
        Accepted expressions
      </h3>
      <p className="text-sm text-muted-foreground">
        Each candidate is credited with its best-fitting expression, so accepting more of them finds
        a good face sooner.
      </p>
      <p className="text-sm text-muted-foreground">
        Click a shape to accept or reject that expression. Each is what the miner is aiming at, not
        a blockie of any real address, since none exists yet.
      </p>
      {/* A wrapping row: five 64px previews fit side by side on a wide card and reflow to two or
          three per line on a phone, rather than forcing the card to scroll sideways. */}
      <div role="group" aria-labelledby="accepted-expressions" className="flex flex-wrap gap-2">
        {ALL_MOUTH_NAMES.map((name) => {
          const selected = value.includes(name)
          return (
            // role="checkbox" on a real <button> is what Radix's own Checkbox renders, so this
            // stays a toggle for assistive tech — and its accessible name is the caption below
            // the preview, which is why the preview itself is decorative here.
            <button
              key={name}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => toggle(name)}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-2 rounded-lg p-1.5 transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                // Ring plus a filled, ticked caption — the same pairing a selected ResultCard
                // uses — so the accepted set is legible without relying on colour alone.
                selected ? 'ring-2 ring-primary' : 'opacity-60 hover:opacity-100',
              )}
            >
              <TargetPreview mouthName={name} decorative />
              <Badge variant={selected ? 'default' : 'outline'} className="gap-1">
                {selected && (
                  <Check data-slot="expression-selected-mark" className="size-3" aria-hidden />
                )}
                {name}
              </Badge>
            </button>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Switch
          id="two-color-only"
          checked={filters.twoColor}
          onCheckedChange={(checked) => onFiltersChange({ ...filters, twoColor: checked })}
        />
        <Label htmlFor="two-color-only">Two colours only</Label>
      </div>
      <p className="text-sm text-muted-foreground">
        A blockie is two-colour only when no cell uses the spot colour. That&rsquo;s the common case
        to want. Turning it off makes more candidates qualify, but some will show a third colour.
      </p>

      <div className="flex max-w-xs flex-col gap-1.5">
        <div className="flex items-center justify-between gap-4">
          {/* Radix puts role="slider" on the thumb, so the name comes from aria-labelledby
              rather than a <label for>, which cannot address a thumb. */}
          <span id="min-contrast-label" className="text-sm font-medium">
            Minimum contrast
          </span>
          {/* A slider with no readout is unusable for a value this precise. */}
          <span
            data-testid="min-contrast-value"
            className="font-mono text-sm tabular-nums text-muted-foreground"
          >
            {filters.minContrast}
          </span>
        </div>
        {/* Fully controlled from `filters.minContrast` — no local echo. The number input this
            replaced needed one to survive multi-digit typing; a slider has no such failure mode,
            and the echo could only ever drift from what the miner filters by. */}
        <Slider
          aria-labelledby="min-contrast-label"
          min={0}
          max={442}
          step={1}
          value={[filters.minContrast]}
          onValueChange={([next]) => onFiltersChange({ ...filters, minContrast: next })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        The RGB distance required between the two blockie colours. 0 accepts any pair, 442 is black
        against white.
      </p>
    </div>
  )
}
