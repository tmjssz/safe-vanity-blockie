'use client'

import { useState } from 'react'
import { ALL_MOUTH_NAMES } from '../lib/face-selection'

export interface FacePickerProps {
  value: string[]
  onChange: (mouthNames: string[]) => void
}

export function FacePicker({ value, onChange }: FacePickerProps) {
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
    </fieldset>
  )
}
