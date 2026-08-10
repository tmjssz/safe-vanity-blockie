'use client'

import { useState } from 'react'
import { ConfigForm } from '../components/ConfigForm'
import { FacePicker } from '../components/FacePicker'
import { SecurityNotice } from '../components/SecurityNotice'
import { DEFAULT_FACE_FILTERS, type FaceFilters, type MineConfig } from '../lib/config'

export default function Page() {
  const [config, setConfig] = useState<MineConfig | undefined>()
  const [mouths, setMouths] = useState<string[]>(['smile', 'frown', 'neutral', 'open', 'small'])
  const [filters, setFilters] = useState<FaceFilters>(DEFAULT_FACE_FILTERS)

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
        </>
      ) : (
        <ConfigForm onSubmit={setConfig} />
      )}
    </>
  )
}
