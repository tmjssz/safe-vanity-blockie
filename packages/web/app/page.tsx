'use client'

import type { Candidate } from '@safe-vanity-blockie/core'
import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { ConfigForm } from '../components/ConfigForm'
import { DeployPanel } from '../components/DeployPanel'
import { FacePicker } from '../components/FacePicker'
import { MiningView } from '../components/MiningView'
import { SecurityNotice } from '../components/SecurityNotice'
import { DEFAULT_FACE_FILTERS, type FaceFilters, type MineConfig } from '../lib/config'
import { decodeConfigParam } from '../lib/deep-link'
import { faceSpecFromSelection } from '../lib/face-selection'

// useSearchParams() opts this subtree out of static rendering unless it is wrapped in
// Suspense; isolating it in its own component keeps that bailout scoped instead of
// disabling static generation for the whole page.
function HomeContent() {
  const searchParams = useSearchParams()
  const configParam = searchParams.get('config')

  // Re-decoding on every render would be wasted work and (for the error case) would not
  // change the outcome anyway, so this is keyed on the one input that can change it.
  const linkResult = useMemo(
    () => (configParam ? decodeConfigParam(configParam) : undefined),
    [configParam],
  )

  const [config, setConfig] = useState<MineConfig | undefined>()
  const [mouths, setMouths] = useState<string[]>(['smile', 'frown', 'neutral', 'open', 'small'])
  const [filters, setFilters] = useState<FaceFilters>(DEFAULT_FACE_FILTERS)
  const [selected, setSelected] = useState<Candidate | undefined>()

  // Memoised so a re-render (e.g. from mining progress updates) does not hand MiningView a new
  // FaceSpec object and restart the run — only an actual change to the accepted expressions
  // should do that.
  const faceSpec = useMemo(() => faceSpecFromSelection(mouths), [mouths])

  const linked = linkResult?.config
  const initial = linked
    ? {
        owners: linked.owners.join(', '),
        threshold: linked.threshold,
        safeVersion: linked.safeVersion,
        chainId: linked.chainId,
      }
    : undefined

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
          {selected && <DeployPanel config={config} candidate={selected} />}
        </>
      ) : (
        <>
          {linkResult?.error && (
            <p role="alert">
              This share link could not be used: {linkResult.error}
            </p>
          )}
          <ConfigForm initial={initial} onSubmit={setConfig} />
        </>
      )}
    </>
  )
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  )
}
