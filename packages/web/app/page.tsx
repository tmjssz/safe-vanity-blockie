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
import {
  DEFAULT_FACE_FILTERS,
  validateMineConfig,
  type FaceFilters,
  type MineConfig,
} from '../lib/config'
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
  // The candidate whose deploy dialog is open, together with the config its address was derived
  // from. Clicking any result card sets both; closing the dialog clears them, which unmounts the
  // dialog entirely.
  //
  // They travel as one value because the whole guarantee of this app is that the address deployed
  // is the address on the card that was picked, and the dialog derives what it deploys from the
  // config it is handed. Those were necessarily the same object while every candidate came from
  // the submitted config; a link candidate comes from the LINK's config instead, and can now be on
  // screen while a different config is submitted underneath it (see the dialog's own comment
  // below). Pairing them here is what makes that harmless — the dialog cannot be handed a config
  // its candidate did not come from — rather than leaving it to DeployDialog's
  // `plan.address !== candidate.address` refusal, which is a last-resort backstop and should never
  // be the thing that notices.
  const [selection, setSelection] = useState<
    { candidate: Candidate; config: MineConfig } | undefined
  >()
  // True only while a deploy transaction is in flight. Opening a candidate's deploy dialog
  // deliberately does NOT pause mining (design spec, behaviour rule 3): the wallet confirmation
  // is the one moment a user must read an address carefully, so that — not merely looking at a
  // result — is what stops the machine.
  const [deploying, setDeploying] = useState(false)
  const [linkCandidateError, setLinkCandidateError] = useState<string | undefined>()
  // Distinct from `selection`: once the reconstruction attempt has settled (either way), the app
  // must never go back to "awaiting" it, even after the user later clears `selection` by closing
  // the deploy dialog — that used to re-derive `awaitingLinkCandidate` from "nothing selected",
  // which flipped back to true and left mining paused forever with no candidate and no way out.
  // That matters more now, not less: a link recipient meets the dialog before submitting
  // anything, so closing it is the FIRST thing they do, and every search they start afterwards
  // would have been born paused.
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

  // The link's own config as a MineConfig. Owners, threshold, Safe version and chain are all in
  // the link, so the address its saltNonce names is fully determined by the link alone — nothing
  // has to be submitted first, which is exactly what a share link promises. Deriving from the
  // *submitted* config instead is what used to leave a recipient on the ordinary starting screen:
  // `config` is undefined until they submit, so the reconstruction below never ran, and once they
  // did submit it started a fresh search they never asked for.
  //
  // Only built when there is a saltNonce to reconstruct: a link carrying just the four fields is
  // a prefill and nothing more, and must not cost an RPC read for constants no one will use.
  // validateMineConfig re-runs (purely, and cheaply) rather than casting `safeVersion`:
  // decodeConfigParam already applied exactly this validation, so this is the narrowing, not a
  // second opinion — an invalid link has been rejected long before here.
  const linkSaltNonce = linked?.saltNonce
  const linkMineConfig = useMemo(
    () =>
      linked?.saltNonce
        ? validateMineConfig({
            owners: linked.owners,
            threshold: linked.threshold,
            safeVersion: linked.safeVersion,
            chainId: linked.chainId,
          }).config
        : undefined,
    [linked],
  )

  // Spec §8.2: a `?config=…` deep link that carries a mined saltNonce must re-derive and
  // preview the exact blockie, not just restore the form fields. decodeConfigParam has already
  // validated the saltNonce's shape; this reconstructs the Candidate it names, on the main
  // thread, from the link's own constants — never from a submitted config's, which would derive a
  // different address and hand the dialog a saltNonce that no longer names what it displays.
  //
  // Guarded by a ref rather than `!selection` — the latter would fire again and clobber a
  // deliberate "choose a different result" deselection with the same link candidate forever.
  const linkCandidateAttempted = useRef(false)
  const constantsForLink = useSafeConstants(linkMineConfig)
  useEffect(() => {
    if (linkCandidateAttempted.current) return
    if (!linkSaltNonce || !linkMineConfig || !constantsForLink.data) return
    linkCandidateAttempted.current = true
    let cancelled = false
    candidateFromSaltNonce(constantsForLink.data.constants, linkSaltNonce, faceSpec)
      .then((candidate) => {
        // `cancelled` guards the RESULT, never the settling. The attempt is one-shot (the ref
        // above makes sure a cancelled one is never replaced), so once this promise resolves
        // there is nothing left to wait for, whether or not the inputs moved underneath it —
        // and `awaitingLinkCandidate` below holds mining paused until something says so. This
        // used to be inside the guard, so changing the face mid-reconstruction (the Face section
        // stays live, and keccak's wasm init takes real time) left mining paused forever with
        // no candidate, no dialog to close and no way back short of a reload.
        //
        // Paired with the config it was derived from, never with whatever happens to be submitted
        // by the time it lands: this candidate is the link's, and only the link's config
        // reproduces its address.
        if (!cancelled) setSelection({ candidate, config: linkMineConfig })
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
  }, [linkSaltNonce, linkMineConfig, constantsForLink.data, faceSpec])

  // Holds MiningView paused — if it is mounted at all — while a link candidate is still being
  // reconstructed, so it never spins up workers just to have them stopped again a moment later
  // once `selection` is set. On a fresh link load there is nothing submitted and so nothing
  // mounted to pause, and this is inert; it earns its keep for the recipient who submits the
  // prefilled form while the reconstruction is still in flight. Falls through to normal mining if
  // reconstruction errors, or the constants fetch itself fails — the latter is reported by
  // `linkConstantsError` below, NOT left to MiningView. This one reads the LINK's config and
  // MiningView's reads the submitted one, so they are separate uncached fetches that can disagree
  // (and, once the recipient edits the form, are not even asking about the same Safe): if this
  // one is rate-limited while MiningView's succeeds, mining starts perfectly normally and the
  // shared saltNonce — the entire payload of the link — is dropped with nothing on screen to say
  // so. Gated on `linkCandidateSettled`, not `!selection`: the attempt resolving (any way at all,
  // including one whose result was discarded as stale) is what ends the "awaiting" state,
  // permanently — not whatever the user does with `selection` next.
  const awaitingLinkCandidate =
    Boolean(linkSaltNonce) && !linkCandidateSettled && !constantsForLink.error
  const linkConstantsError = linkSaltNonce ? constantsForLink.error : undefined

  // Configure is locked once submitted because owners, threshold, Safe version and chain are
  // exactly the inputs the address is derived from: editing one silently invalidates every
  // result on screen. So the only way back is this — an explicit, confirmed reset that throws
  // the run away rather than pretending it survived.
  const startOver = useCallback(() => {
    setConfig(undefined)
    // Clears the link candidate too, if that is what is open: `linkDismissed` below puts the link
    // out of reach for good, and a dialog still deploying its config would be the one piece of it
    // left reachable after the reset.
    setSelection(undefined)
    // The deploy dialog's own `finally` normally clears this, but a reset must never be able to
    // leave a dismissed deploy holding mining paused.
    setDeploying(false)
    setLinkCandidateError(undefined)
    setLinkDismissed(true)
  }, [])

  // Pairs the clicked card with the config it was mined under, at the moment it is clicked. Stable
  // across everything but a config change, which is what the 200 memoised result cards need from
  // it (a new identity per render turns their memo into 200 wasted comparisons per publish) — and
  // a config change unmounts the run those cards belong to anyway.
  //
  // The `config &&` is a type narrowing, not a branch: MiningView only exists while a config is
  // submitted, so it cannot call this without one.
  const selectFromGrid = useCallback(
    (candidate: Candidate) => {
      if (config) setSelection({ candidate, config })
    },
    [config],
  )

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

        {/* Outside the `config &&` block below, unlike everything else here: reconstructing a
            link's saltNonce no longer waits for a submit, so both of its failure modes happen on
            a page that has one submitted nothing. Gating the reports on a submit would leave a
            recipient looking at an ordinary starting screen with no idea a specific Safe was
            shared with them and no idea it failed — which is the bug this whole path exists to
            fix, wearing a different hat. They stay two separate messages: "the deriver failed"
            and "the chain could not be read" are different things to do something about. */}
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
              This link&rsquo;s saltNonce could not be reconstructed — Safe constants could not be
              read: {linkConstantsError}
            </AlertDescription>
          </Alert>
        )}

        {/* Face, the status bar and the results grid all belong to a search, and a link load has
            not started one — opening someone's link must not spin up five to eight workers at
            full CPU unasked. So before a submit the page is exactly its starting screen (prefilled
            Configure, plus any link failure above) with the shared result's dialog over it, rather
            than a half-mounted search with an empty leaderboard and a status bar reading zero. */}
        {config && (
          <>
            <FaceSection
              mouths={mouths}
              filters={filters}
              onMouthsChange={setMouths}
              onFiltersChange={setFilters}
            />

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
              onSelect={selectFromGrid}
            />
          </>
        )}

        {/* Outside the `config &&` block, and it has to be: a link candidate opens this before
            anything is submitted, which is the entire point of a share link. It deploys
            `selection.config` — the config its address was derived from, which for a link
            candidate is the LINK's, not whatever the recipient may later submit here.

            Rendered (and so unmounted) with the selection rather than kept mounted and merely
            hidden: closing while a send is in flight therefore loses the *inline* status, and
            the toast mirror in DeployDialog — mounted in app/layout.tsx, outside every subtree
            that can unmount here — is what carries the outcome instead.

            `key` guards a path that does not currently exist, and is kept deliberately as
            defence-in-depth. What it prevents is a completed deploy of one candidate leaving
            its "Safe deployed at 0x…" status and permanently disabled button rendered above a
            DIFFERENT candidate's address — which needs `selection` to change from one candidate
            to another with no unmount in between, and nothing can do that today:

              - every user route out of the dialog runs `onOpenChange(false)` below, which
                clears `selection` and unmounts it; a modal overlay is what stops a second card
                from being clicked while one is open;
              - the link-candidate effect above is the only other `setSelection` caller, and it
                cannot land on an open dialog: before a submit there is no MiningView and so no
                card to click at all, and a recipient who submits while it is still in flight
                gets a MiningView held paused by `awaitingLinkCandidate` for precisely that
                window, so the grid has no candidates either. Either way there is nothing for
                `selection` to be already set to, and `linkCandidateAttempted` then makes it
                one-shot.

            So this is one `setSelection` caller away from mattering, and it costs nothing.
            Deleting it does not fail anything a user can currently do — see the regression
            test in test/page.test.tsx, which drives the swap through a mocked MiningView. */}
        {selection && (
          <DeployDialog
            key={selection.candidate.address}
            open
            candidate={selection.candidate}
            config={selection.config}
            onOpenChange={(next) => {
              if (next) return
              setSelection(undefined)
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
