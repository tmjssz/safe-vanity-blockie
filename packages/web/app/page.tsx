'use client'

import type { Candidate } from '@safe-vanity-blockie/core'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfigSection } from '../components/ConfigSection'
import { DeployDialog } from '../components/DeployDialog'
import { FaceSection } from '../components/FaceSection'
import { MINING_STATUS_BAR_SLOT_ID } from '../components/MiningStatusBar'
import { MiningView } from '../components/MiningView'
import { SecurityNotice } from '../components/SecurityNotice'
import { Alert, AlertDescription } from '../components/ui/alert'
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
  // The candidate whose deploy dialog is open. Clicking any result card sets it; closing the
  // dialog clears it, which unmounts the dialog entirely.
  const [selected, setSelected] = useState<Candidate | undefined>()
  // True only while a deploy transaction is in flight. Opening a candidate's deploy dialog
  // deliberately does NOT pause mining (design spec, behaviour rule 3): the wallet confirmation
  // is the one moment a user must read an address carefully, so that — not merely looking at a
  // result — is what stops the machine.
  const [deploying, setDeploying] = useState(false)
  const [linkCandidateError, setLinkCandidateError] = useState<string | undefined>()
  // Distinct from `selected`: once the reconstruction attempt has settled (either way), the app
  // must never go back to "awaiting" it, even after the user later clears `selected` by closing
  // the deploy dialog — that used to re-derive `awaitingLinkCandidate` from `!selected` alone,
  // which flipped back to true and left mining paused forever with no candidate and no way out.
  const [linkCandidateSettled, setLinkCandidateSettled] = useState(false)
  // Set by "Start over": from that point the decoded link is gone for good — its owners no
  // longer prefill the form, its saltNonce is no longer waited on, and its error is no longer
  // reported. Anything less would leave the reconstruction that belongs to the *previous*
  // config able to reach the new one.
  const [linkDismissed, setLinkDismissed] = useState(false)

  // Memoised so a re-render does not hand MiningView a new FaceSpec object and restart the run —
  // only an actual change to the accepted expressions should do that.
  const faceSpec = useMemo(() => faceSpecFromSelection(mouths), [mouths])

  const linked = linkDismissed ? undefined : linkResult?.config
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
        // `cancelled` guards the RESULT, never the settling. The attempt is one-shot (the ref
        // above makes sure a cancelled one is never replaced), so once this promise resolves
        // there is nothing left to wait for, whether or not the inputs moved underneath it —
        // and `awaitingLinkCandidate` below holds mining paused until something says so. This
        // used to be inside the guard, so changing the face mid-reconstruction (the Face section
        // stays live, and keccak's wasm init takes real time) left mining paused forever with
        // no candidate, no dialog to close and no way back short of a reload.
        if (!cancelled) setSelected(candidate)
        setLinkCandidateSettled(true)
      })
      .catch((error: unknown) => {
        // Same split: a cancelled attempt's failure is not worth reporting — the user changed
        // the inputs it was derived from — but it has still stopped being pending.
        if (!cancelled) {
          setLinkCandidateError(error instanceof Error ? error.message : String(error))
        }
        setLinkCandidateSettled(true)
      })
    return () => {
      cancelled = true
    }
  }, [linked, constantsForLink.data, faceSpec])

  // Kept paused (not unmounted) while a link candidate is still being reconstructed, so it
  // never spins up workers just to have them stopped again a moment later once `selected` is
  // set. Falls through to normal mining if reconstruction errors, or the constants fetch itself
  // fails — the latter is reported by `linkConstantsError` below, NOT left to MiningView. Both
  // components run their own uncached useSafeConstants, so they can disagree: if this one is
  // rate-limited while MiningView's succeeds, mining starts perfectly normally and the shared
  // saltNonce — the entire payload of the link — is dropped with nothing on screen to say so.
  // Gated on `linkCandidateSettled`, not `!selected`: the attempt resolving (any way at all,
  // including one whose result was discarded as stale) is what ends the "awaiting" state,
  // permanently — not whatever the user does with `selected` next.
  const awaitingLinkCandidate =
    Boolean(linked?.saltNonce) && !linkCandidateSettled && !constantsForLink.error
  const linkConstantsError = linked?.saltNonce ? constantsForLink.error : undefined

  // Configure is locked once submitted because owners, threshold, Safe version and chain are
  // exactly the inputs the address is derived from: editing one silently invalidates every
  // result on screen. So the only way back is this — an explicit, confirmed reset that throws
  // the run away rather than pretending it survived.
  const startOver = useCallback(() => {
    setConfig(undefined)
    setSelected(undefined)
    // The deploy dialog's own `finally` normally clears this, but a reset must never be able to
    // leave a dismissed deploy holding mining paused.
    setDeploying(false)
    setLinkCandidateError(undefined)
    setLinkDismissed(true)
  }, [])

  return (
    <>
      {/* `contents` keeps this wrapper out of the layout entirely, so the sticky bar MiningView
          portals in here sticks to the top of the page rather than to a one-bar-tall box. */}
      <div id={MINING_STATUS_BAR_SLOT_ID} className="contents" />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <SecurityNotice />

        {!config && !linkDismissed && linkResult?.error && (
          <Alert variant="destructive">
            <AlertDescription>
              This share link could not be used: {linkResult.error}
            </AlertDescription>
          </Alert>
        )}

        <ConfigSection
          config={config}
          initial={initial}
          onSubmit={setConfig}
          onStartOver={startOver}
        />

        {config && (
          <>
            <FaceSection
              mouths={mouths}
              filters={filters}
              onMouthsChange={setMouths}
              onFiltersChange={setFilters}
            />

            {linkCandidateError && (
              <Alert variant="destructive">
                <AlertDescription>
                  This link&rsquo;s saltNonce could not be reconstructed: {linkCandidateError}
                </AlertDescription>
              </Alert>
            )}

            {linkConstantsError && (
              <Alert variant="destructive">
                <AlertDescription>
                  This link&rsquo;s saltNonce could not be reconstructed — Safe constants could
                  not be read: {linkConstantsError}
                </AlertDescription>
              </Alert>
            )}

            {/* Mining and the deploy transaction never run at once: the one screen where a user
                must read an address carefully should not sit under a grid still re-sorting
                itself. Opening a result's dialog is not that moment, so the leaderboard keeps
                updating until a deploy is actually initiated — and MiningView stays mounted
                throughout, so closing the dialog puts a live, clickable grid straight back in
                front of the user. */}
            <MiningView
              config={config}
              faceSpec={faceSpec}
              filters={filters}
              paused={deploying || awaitingLinkCandidate}
              onSelect={setSelected}
            />

            {/* Rendered (and so unmounted) with the selection rather than kept mounted and merely
                hidden: closing while a send is in flight therefore loses the *inline* status, and
                the toast mirror in DeployDialog — mounted in app/layout.tsx, outside every
                subtree that can unmount here — is what carries the outcome instead.

                `key` guards a path that does not currently exist, and is kept deliberately as
                defence-in-depth. What it prevents is a completed deploy of one candidate leaving
                its "Safe deployed at 0x…" status and permanently disabled button rendered above a
                DIFFERENT candidate's address — which needs `selected` to change from one
                candidate to another with no unmount in between, and nothing can do that today:

                  - every user route out of the dialog runs `onOpenChange(false)` below, which
                    clears `selected` and unmounts it; a modal overlay is what stops a second card
                    from being clicked while one is open;
                  - the link-candidate effect above is the only other `setSelected` caller, and it
                    cannot land on an open dialog: `awaitingLinkCandidate` holds MiningView paused
                    for precisely the window in which that effect can resolve, so the grid has no
                    candidates and there is no card to click, hence nothing for `selected` to be
                    already set to. `linkCandidateAttempted` then makes it one-shot.

                So this is one `setSelected` caller away from mattering, and it costs nothing.
                Deleting it does not fail anything a user can currently do — see the regression
                test in test/page.test.tsx, which drives the swap through a mocked MiningView. */}
            {selected && (
              <DeployDialog
                key={selected.address}
                open
                candidate={selected}
                config={config}
                onOpenChange={(next) => {
                  if (next) return
                  setSelected(undefined)
                  // Belt and braces, and the only remaining place it can be done: the deploy
                  // sequence's own `finally` clears this, but if the dialog is dismissed while a
                  // wallet prompt is still open, nothing else would hand mining back until (or
                  // unless) that promise settles — and `paused` here is a HOST pause, which the
                  // status bar's own Resume deliberately cannot clear.
                  setDeploying(false)
                }}
                onDeployStart={() => setDeploying(true)}
                onDeploySettled={() => setDeploying(false)}
              />
            )}
          </>
        )}
      </div>
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
