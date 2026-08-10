'use client'

import type { Candidate } from '@safe-vanity-blockie/core'
import { useMemo, useState } from 'react'
import { ConfigForm } from '../components/ConfigForm'
import { FacePicker } from '../components/FacePicker'
import { MiningView } from '../components/MiningView'
import { SecurityNotice } from '../components/SecurityNotice'
import { DEFAULT_FACE_FILTERS, type FaceFilters, type MineConfig } from '../lib/config'
import { faceSpecFromSelection } from '../lib/face-selection'

export default function Page() {
  const [config, setConfig] = useState<MineConfig | undefined>()
  const [mouths, setMouths] = useState<string[]>(['smile', 'frown', 'neutral', 'open', 'small'])
  const [filters, setFilters] = useState<FaceFilters>(DEFAULT_FACE_FILTERS)
  const [selected, setSelected] = useState<Candidate | undefined>()

  // Memoised so a re-render (e.g. from mining progress updates) does not hand MiningView a new
  // FaceSpec object and restart the run — only an actual change to the accepted expressions
  // should do that.
  const faceSpec = useMemo(() => faceSpecFromSelection(mouths), [mouths])

  return (
    <>
      <SecurityNotice />
      {config ? (
        <>
          <pre>{JSON.stringify(config, null, 2)}</pre>
          <FacePicker
            value={mouths}
            onChange={setMouths}
            filters={filters}
            onFiltersChange={setFilters}
          />
          <MiningView config={config} faceSpec={faceSpec} filters={filters} onSelect={setSelected} />
          {selected && (
            <p>
              Selected saltNonce {selected.saltNonce} for {selected.address}.
            </p>
          )}
        </>
      ) : (
        <ConfigForm onSubmit={setConfig} />
      )}
    </>
  )
}
