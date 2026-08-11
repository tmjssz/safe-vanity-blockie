'use client'

import { useState } from 'react'
import type { FaceFilters } from '../lib/config'
import { ALL_MOUTH_NAMES } from '../lib/face-selection'
import { TargetPreview } from './TargetPreview'

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
    <fieldset>
      <legend>Accepted expressions</legend>
      <p className="hint">
        Each candidate is credited with its best-fitting expression, so accepting more of them
        finds a good face sooner.
      </p>
      {ALL_MOUTH_NAMES.map((name) => (
        <label key={name}>
          <input
            type="checkbox"
            checked={value.includes(name)}
            onChange={() => toggle(name)}
            aria-label={name}
          />
          {name}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}

      <label>
        <input
          type="checkbox"
          checked={filters.twoColor}
          onChange={(event) =>
            onFiltersChange({ ...filters, twoColor: event.target.checked })
          }
        />
        Two colours only
      </label>
      <p className="hint">
        A blockie is two-colour only when no cell uses the spot colour. That&rsquo;s the common
        case to want — turning it off makes more candidates qualify, but some will show a third
        colour.
      </p>

      <label htmlFor="min-contrast">Minimum contrast</label>
      <input
        id="min-contrast"
        type="number"
        min={0}
        max={442}
        step={1}
        value={filters.minContrast}
        onChange={(event) =>
          onFiltersChange({ ...filters, minContrast: Number(event.target.value) })
        }
      />
      <p className="hint">
        The RGB distance required between the two blockie colours — 0 accepts any pair, 442 is
        black against white.
      </p>

      <div>
        <h3>Target patterns</h3>
        <p className="hint">
          The shape the miner is aiming at for each accepted expression — not a blockie of any
          real address, since none exists yet.
        </p>
        {value.map((name) => (
          <TargetPreview key={name} mouthName={name} />
        ))}
      </div>
    </fieldset>
  )
}
