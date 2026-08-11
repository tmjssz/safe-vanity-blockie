'use client'

import { useState } from 'react'
import type { FaceFilters } from '../lib/config'
import { ALL_MOUTH_NAMES } from '../lib/face-selection'
import { TargetPreview } from './TargetPreview'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Label } from './ui/label'

export interface FacePickerProps {
  value: string[]
  onChange: (mouthNames: string[]) => void
  filters: FaceFilters
  onFiltersChange: (filters: FaceFilters) => void
}

export function FacePicker({ value, onChange, filters, onFiltersChange }: FacePickerProps) {
  const [error, setError] = useState<string | undefined>()
  // Local echo of the contrast text: a fully prop-controlled number input fights React's own
  // typed-value reset on every keystroke (there is no state update to feed a new `value` back in
  // sync), which corrupts multi-digit entry. Keeping our own copy — updated on every change and
  // reported upward via onFiltersChange — sidesteps that without weakening the controlled loop.
  const [contrastText, setContrastText] = useState(String(filters.minContrast))

  const toggle = (name: string) => {
    if (value.includes(name)) {
      if (value.length === 1) {
        setError('Keep at least one expression — a face needs a mouth to score against.')
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
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium">Accepted expressions</legend>
      <p className="text-sm text-muted-foreground">
        Each candidate is credited with its best-fitting expression, so accepting more of them finds
        a good face sooner.
      </p>
      <div className="flex flex-col gap-2">
        {ALL_MOUTH_NAMES.map((name) => (
          <div key={name} className="flex items-center gap-2">
            <Checkbox
              id={`mouth-${name}`}
              checked={value.includes(name)}
              onCheckedChange={() => toggle(name)}
            />
            <Label htmlFor={`mouth-${name}`}>{name}</Label>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="two-color-only"
          checked={filters.twoColor}
          onCheckedChange={(checked) => onFiltersChange({ ...filters, twoColor: checked === true })}
        />
        <Label htmlFor="two-color-only">Two colours only</Label>
      </div>
      <p className="text-sm text-muted-foreground">
        A blockie is two-colour only when no cell uses the spot colour. That&rsquo;s the common case
        to want — turning it off makes more candidates qualify, but some will show a third colour.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="min-contrast">Minimum contrast</Label>
        <Input
          id="min-contrast"
          type="number"
          min={0}
          max={442}
          step={1}
          value={contrastText}
          onChange={(event) => {
            const raw = event.target.value
            setContrastText(raw)
            onFiltersChange({ ...filters, minContrast: Number(raw) })
          }}
          className="max-w-32"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        The RGB distance required between the two blockie colours — 0 accepts any pair, 442 is black
        against white.
      </p>

      <div>
        <h3 className="text-sm font-medium">Target patterns</h3>
        <p className="text-sm text-muted-foreground">
          The shape the miner is aiming at for each accepted expression — not a blockie of any real
          address, since none exists yet.
        </p>
        <div className="mt-2 flex flex-wrap gap-4">
          {value.map((name) => (
            <TargetPreview key={name} mouthName={name} />
          ))}
        </div>
      </div>
    </fieldset>
  )
}
