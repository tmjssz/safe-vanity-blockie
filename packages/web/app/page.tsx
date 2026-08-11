'use client'

import type { Candidate } from '@safe-vanity-blockie/core'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ConfigForm } from '../components/ConfigForm'
import { DeployPanel } from '../components/DeployPanel'
import { FacePicker } from '../components/FacePicker'
import { MiningView } from '../components/MiningView'
import { SecurityNotice } from '../components/SecurityNotice'
import { DEFAULT_FACE_FILTERS, type FaceFilters, type MineConfig } from '../lib/config'
import { candidateFromSaltNonce, decodeConfigParam } from '../lib/deep-link'
import { ALL_MOUTH_NAMES, faceSpecFromSelection } from '../lib/face-selection'
import { useSafeConstants } from '../lib/use-safe-constants'

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
  const [mouths, setMouths] = useState<string[]>(ALL_MOUTH_NAMES)
  const [filters, setFilters] = useState<FaceFilters>(DEFAULT_FACE_FILTERS)
  const [selected, setSelected] = useState<Candidate | undefined>()
  // True only while a deploy transaction is in flight. Selecting a candidate deliberately does
  // NOT pause mining any more (design spec, behaviour rule 3): the wallet confirmation is the
  // one moment a user must read an address carefully, so that — not merely looking at a result
  // — is what stops the machine.
  const [deploying, setDeploying] = useState(false)
  const [linkCandidateError, setLinkCandidateError] = useState<string | undefined>()
  // Distinct from `selected`: once the reconstruction attempt has settled (either way), the app
  // must never go back to "awaiting" it, even after the user later clears `selected` by clicking
  // "Back to mining" — that used to re-derive `awaitingLinkCandidate` from `!selected` alone,
  // which flipped back to true and left mining paused forever with no candidate and no way out.
  const [linkCandidateSettled, setLinkCandidateSettled] = useState(false)

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

  // Spec §8.2: a `?config=…` deep link that carries a mined saltNonce must re-derive and
  // preview the exact blockie, not just restore the form fields. decodeConfigParam has already
  // validated the saltNonce's shape; this reconstructs the Candidate it names, on the main
  // thread, once Safe constants for the (possibly user-edited) submitted config are available.
  //
  // Guarded by a ref rather than `!selected` — the latter would fire again and clobber a
  // deliberate "choose a different result" deselection with the same link candidate forever.
  const linkCandidateAttempted = useRef(false)
  const constantsForLink = useSafeConstants(config)
  useEffect(() => {
    if (linkCandidateAttempted.current) return
    if (!linked?.saltNonce || !constantsForLink.data) return
    linkCandidateAttempted.current = true
    let cancelled = false
    candidateFromSaltNonce(constantsForLink.data.constants, linked.saltNonce, faceSpec)
      .then((candidate) => {
        if (!cancelled) {
          setSelected(candidate)
          setLinkCandidateSettled(true)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLinkCandidateError(error instanceof Error ? error.message : String(error))
          setLinkCandidateSettled(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [linked, constantsForLink.data, faceSpec])

  // Kept paused (not unmounted) while a link candidate is still being reconstructed, so it
  // never spins up workers just to have them stopped again a moment later once `selected` is
  // set. Falls through to normal mining if reconstruction errors, or the constants fetch itself
  // fails (in which case MiningView's own useSafeConstants call will surface that same error).
  // Gated on `linkCandidateSettled`, not `!selected`: the attempt resolving (either way) is what
  // ends the "awaiting" state, permanently — not whatever the user does with `selected` next.
  const awaitingLinkCandidate =
    Boolean(linked?.saltNonce) && !linkCandidateSettled && !constantsForLink.error

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
          {linkCandidateError && (
            <p role="alert">
              This link&rsquo;s saltNonce could not be reconstructed: {linkCandidateError}
            </p>
          )}
          {/* Mining and the deploy transaction never run at once: the one screen where a user
              must read an address carefully should not sit under a grid still re-sorting
              itself. Inspecting a result is not that moment, so the leaderboard keeps updating
              until a deploy is actually initiated — and MiningView stays mounted throughout, so
              a different result can always be picked directly. */}
          <MiningView
            config={config}
            faceSpec={faceSpec}
            filters={filters}
            paused={deploying || awaitingLinkCandidate}
            onSelect={setSelected}
          />
          {selected && (
            <>
              <DeployPanel
                key={selected.address}
                config={config}
                candidate={selected}
                onDeployStart={() => setDeploying(true)}
                onDeploySettled={() => setDeploying(false)}
              />
              <button
                type="button"
                onClick={() => {
                  setSelected(undefined)
                  // Belt and braces: the deploy sequence's own `finally` clears this, but if the
                  // panel is dismissed while a wallet prompt is still open, nothing else would
                  // hand mining back until (or unless) that promise settles.
                  setDeploying(false)
                }}
              >
                Back to mining
              </button>
            </>
          )}
        </>
      ) : (
        <>
          {linkResult?.error && (
            <p role="alert">This share link could not be used: {linkResult.error}</p>
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
