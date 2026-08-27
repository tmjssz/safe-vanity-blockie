'use client'

import type { Candidate } from '@safe-vanity-blockie/core'
import { Loader2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRegisterStartOver } from '../components/AppTitle'
import { ChainSelector, HEADER_CHAIN_SLOT_ID } from '../components/ChainSelector'
import { ConfigSection } from '../components/ConfigSection'
import { type DeployAttempt, DeployDialog } from '../components/DeployDialog'
import { DeployInProgressDialog } from '../components/DeployInProgressDialog'
import type { DeployPhase } from '../components/DeployStatusPill'
import { FaceSection } from '../components/FaceSection'
import { MINING_STATUS_BAR_SLOT_ID } from '../components/MiningStatusBar'
import { MiningView } from '../components/MiningView'
import { Alert, AlertDescription } from '../components/ui/alert'
import {
  chainSwitchDiscardsResults,
  DEFAULT_CHAIN_ID,
  DEFAULT_FACE_FILTERS,
  type FaceFilters,
  type MineConfig,
  type RunOptions,
  validateMineConfig,
} from '../lib/config'
import {
  candidateFromSaltNonce,
  clearedSearchPath,
  decodeConfigParam,
  decodeResumeParams,
  draftSearchPath,
  hasResumeParams,
  shareConfigPath,
} from '../lib/deep-link'
import { ALL_MOUTH_NAMES, faceSpecFromSelection } from '../lib/face-selection'
import { useSafeConstants } from '../lib/use-safe-constants'

/**
 * A candidate and the config its address was derived from, travelling as one value. See the
 * `selection` state below for why they are never apart.
 */
type Selection = { candidate: Candidate; config: MineConfig }

/**
 * A `?config=` this page wrote, and the selection it named — tagged with the run it was written
 * during, so a reset can retire it without the param itself ceasing to be recognised as the app's
 * own. See `writtenSelections` and `runGeneration` below.
 */
type WrittenEntry = { selection: Selection; generation: number }

// useSearchParams() opts this subtree out of static rendering unless it is wrapped in
// Suspense; isolating it in its own component keeps that bailout scoped instead of
// disabling static generation for the whole page.
/**
 * How long the address bar waits behind the form.
 *
 * Long enough that a slider drag or a pasted address is one write rather than dozens, short enough
 * that a reader who edits and immediately reloads does not beat it. It only ever costs the last few
 * hundred milliseconds of typing, and only if the page is reloaded inside that window.
 */
const DRAFT_URL_DEBOUNCE_MS = 300

function HomeContent() {
  const searchParams = useSearchParams()
  const configParam = searchParams.get('config')

  // Every `?config=` this session has written into the address bar, mapped to the selection it
  // names and the run that selection belonged to. One fact — "did this app write it?" — answering
  // two questions, and both matter:
  //
  //   - Reading. A param the app wrote is not a share link to reconstruct. Without this the first
  //     write would be read straight back in as one: `linkSaltNonce` becomes defined while
  //     `linkCandidateSettled` is still false, so `awaitingLinkCandidate` below flips true — the
  //     full-screen resolving overlay drops over the very dialog whose opening caused it, and
  //     mining pauses behind it. That is not hypothetical: the App Router patches
  //     history.pushState precisely so useSearchParams() sees the write (see pushSelectionUrl).
  //   - Navigating. A traversal onto one of these entries has to put back the dialog it names —
  //     and since closing pushes the base URL over it, that traversal is usually Back — and the
  //     selection is already here, so nothing is re-derived, no constants are re-read, and the
  //     candidate/config pairing is restored intact rather than rebuilt out of a URL.
  //
  // Entries are only ever added, never removed — see `runGeneration` for why "Start over" marks
  // them dead instead of clearing them.
  const writtenSelections = useRef<Map<string, WrittenEntry>>(new Map())
  // Which run each written param belongs to. "Start over" bumps this, which retires every entry
  // written before it: a traversal onto one of them still recognises the param as the app's own
  // (question one above, unchanged) but restores nothing (question two), so a discarded run's
  // dialog cannot come back on a page that has been reset out from under it.
  //
  // A counter rather than a `writtenSelections.clear()`, and this is the part to keep: clearing
  // would make those params unrecognisable as self-written, so landing on one would latch it as an
  // incoming share link — `awaitingLinkCandidate` true, the full-screen resolving overlay over the
  // page, mining paused, until a reload. The map has to keep growing for the exclusion to keep
  // working; only the selections behind it expire.
  const runGeneration = useRef(0)

  // The link is an INPUT, and it is read exactly once. Before the address bar became something
  // this page writes, `?config=` could only change by a full navigation — which remounts — and
  // everything below was written against that: a previous review closed a candidate/config race
  // by observing that `linkMineConfig` could not change underneath the reconstruction effect.
  // Latching the first `?config=` this mount sees that the app did not write itself restores that
  // premise as an explicit rule rather than an accident of there being no writer: `linkResult`,
  // `linked`, `initial`, `linkMineConfig` and the constants read below are all as invariant as
  // they ever were, whatever the address bar does for the rest of the session.
  //
  // Latched on first sight rather than captured on the first render: this subtree reaches its
  // first client render through the Suspense bailout above, and taking whatever
  // useSearchParams() held at that instant risks latching an empty one and dropping the link.
  //
  // The resume params are latched in the SAME `if`, off the same searchParams snapshot, so all six
  // values land together or not at all. Read separately they could be read on different renders —
  // and a `start=` that arrived without its `target=` is a search whose expressions silently fell
  // back to all five.
  const linkParamsRef = useRef<{ config: string | null; resume: URLSearchParams } | null>(null)
  // `hasResumeParams` too, not just `configParam`: the address bar is now also where an unsubmitted
  // form is kept, and a visitor who moved a slider before typing an owner has filters to restore
  // with no `config=` to carry them. Insisting on one would drop exactly the state that writing
  // exists to preserve.
  if (
    linkParamsRef.current === null &&
    (configParam || hasResumeParams(searchParams)) &&
    !(configParam && writtenSelections.current.has(configParam))
  ) {
    // Copied, not held: `searchParams` is the App Router's live object, and the latch's whole
    // point is that what it holds cannot change afterwards.
    linkParamsRef.current = { config: configParam, resume: new URLSearchParams(searchParams) }
  }
  const linkParam = linkParamsRef.current?.config ?? null

  // Re-decoding on every render would be wasted work and (for the error case) would not
  // change the outcome anyway, so this is keyed on the one input that can change it — which,
  // since the latch above, changes at most once per mount.
  const linkResult = useMemo(
    () => (linkParam ? decodeConfigParam(linkParam) : undefined),
    [linkParam],
  )

  // Keyed on the latched object, which since the latch above changes at most once per mount.
  //
  // A URL with neither a `config=` nor a resume param latches nothing, which leaves an ordinary
  // visit exactly as it was. It used to require the config specifically; the address bar is now also
  // where an unsubmitted form is kept, and filters can reach it before any owner does.
  //
  // Keyed on the latched query string rather than on `linkParam`: such a URL has no `config=` to key
  // on, and keying on one would leave this memoised against null forever.
  const latchedResume = linkParamsRef.current?.resume.toString() ?? null
  // biome-ignore lint/correctness/useExhaustiveDependencies: `latchedResume` is the trigger and the whole input — it changes exactly once, when the latch above fires, which is the only moment `linkParamsRef.current` becomes readable.
  const resumeResult = useMemo(() => {
    const resume = linkParamsRef.current?.resume
    return resume ? decodeResumeParams(resume) : undefined
  }, [latchedResume])

  const [config, setConfig] = useState<MineConfig | undefined>()
  // Where the search starts. Held here rather than in the form, which is unmounted for the whole
  // run, and deliberately NOT folded into `config`: that object is what `?config=` encodes.
  const [startNonce, setStartNonce] = useState(0)
  // `mouths` and `filters` are declared further down, beside `chainId` — see there for why they are
  // DERIVED rather than seeded, and for why that placement follows `linkedSearch`.
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
  const [selection, setSelection] = useState<Selection | undefined>()
  /**
   * The selection whose dialog has been closed while its deploy was still running.
   *
   * Held as the selection object itself rather than as a boolean, so it cannot outlive what it
   * describes: every other `setSelection` caller hands over a NEWLY BUILT selection, so
   * `minimised !== selection` becomes true on its own and the dialog opens without any of them
   * having to know this exists. The one caller that can hand back an identical object is the
   * popstate reconciliation, which restores what it stored — so that one clears this by hand.
   *
   * What it buys: the dialog stays mounted while it is closed, which is the whole fix. Its
   * `status`, `txHash` and `error` are React state inside it, and unmounting is what used to throw
   * them away — leaving a running deploy with nothing on screen that could ever show it again.
   */
  const [minimised, setMinimised] = useState<Selection | undefined>()
  /**
   * The open dialog's own account of how far its deploy has got, reported by it.
   *
   * This, and not `deploying`, is what decides whether closing may unmount that dialog. The two
   * differ precisely where it matters: `deploying` is a pause, and the first close mid-flight hands
   * it back deliberately — so reading it a second time said "nothing outstanding" and threw away
   * the state of a deploy that was still running. Reset to idle by the dialog itself on mount.
   */
  const [deployPhase, setDeployPhase] = useState<DeployPhase>('idle')
  // Running, as opposed to settled or never started: the window in which closing must keep the
  // dialog alive, because there is an outcome still to come and nowhere else to receive it.
  const deployRunning = deployPhase === 'sending' || deployPhase === 'pending'
  /**
   * Set when the grid was activated during that window, which is when the page has to refuse.
   *
   * A boolean would do — the dialog it opens names the deploy in the way, not the result that was
   * refused — but nothing is lost by holding what the user reached for, and it reads as what
   * happened rather than as a flag.
   */
  const [blockedByDeploy, setBlockedByDeploy] = useState<Candidate | undefined>()
  // True only while a deploy transaction is in flight. Opening a candidate's deploy dialog
  // deliberately does NOT pause mining (design spec, behaviour rule 3): the wallet confirmation
  // is the one moment a user must read an address carefully, so that — not merely looking at a
  // result — is what stops the machine.
  const [deploying, setDeploying] = useState(false)
  // WHICH deploy that flag is being held for, so a settle can be matched against the attempt that
  // set it. A single boolean was not enough, because a deploy can be abandoned while it is still
  // running: "Close and keep waiting" (and Back) unmount the dialog and hand mining back at once
  // while the wallet keeps the transaction, and the sequence underneath still reaches its
  // `finally`. That late settle then landed on whatever was in flight by the time it arrived —
  // open a second result, deploy it, and the first one's settle resumed mining and re-enabled the
  // chain selector in the middle of the second wallet confirmation, where `changeChain` could
  // repoint that dialog's description, share link and wrong-chain gate at a chain the transaction
  // already in the wallet was not built for. Everything the selector is disabled for during a
  // send, walked around by a dialog that is no longer on screen.
  //
  // A ref, not state: nothing renders from it, and it has to be readable by a callback that fires
  // long after the render it was created in. Cleared wherever the flag is cleared for a reason
  // OTHER than an attempt settling, which is what disowns the abandoned one — see `abandonDeploy`.
  const liveDeploy = useRef<DeployAttempt | undefined>(undefined)
  const beginDeploy = useCallback((attempt: DeployAttempt) => {
    liveDeploy.current = attempt
    setDeploying(true)
  }, [])
  const settleDeploy = useCallback((attempt: DeployAttempt) => {
    // A settle from an attempt the page has stopped waiting on says nothing about the one it is
    // waiting on now, and must change nothing at all.
    if (liveDeploy.current !== attempt) return
    liveDeploy.current = undefined
    setDeploying(false)
  }, [])
  // Handing mining back without an attempt having settled: the dialog has gone, so nothing on
  // screen can report that deploy any more (the toast mirror in DeployDialog carries its outcome
  // instead) and holding a HOST pause for it — which the status bar's own Resume cannot clear —
  // would strand the user. Forgetting the attempt is the other half: it is why its eventual
  // settle is a no-op rather than a stray release of whatever came next.
  const abandonDeploy = useCallback(() => {
    liveDeploy.current = undefined
    setDeploying(false)
  }, [])
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
  //
  // One thing does survive it, and deliberately: the chain the header is ON. The header follows
  // the link only until it is dismissed or the user picks something (see `picked` below), and
  // "Start over" pins it where it stands rather than letting this drop it back to the default —
  // which would be a silent move to the other singleton class the moment everything else on
  // screen emptied. Nothing of the link's is reachable through it: it is a number in the chrome
  // the user can change at will, not the decoded config.
  const [linkDismissed, setLinkDismissed] = useState(false)
  // The user's own "stop mining", held here rather than inside MiningView because there are now
  // two controls for it in two different subtrees — the sticky status bar's Pause, and the
  // Configure card's Stop. Two pieces of state would be two things to keep in step; one piece
  // read by both cannot disagree with itself.
  const [pausedByUser, setPausedByUser] = useState(false)
  // The last config actually submitted. It outlives `config`, which "Start over" clears, and is
  // what refills the form when the card comes back — retyping owner addresses to change one
  // threshold is exactly the friction that reset used to impose, and every retype of an address
  // is a chance to mine a different Safe by typo. Safe to treat as the form's contents because
  // the card is unmounted for the whole run: there is no window in which the two can diverge.
  const [lastSubmitted, setLastSubmitted] = useState<MineConfig | undefined>()

  // A rejected resume link pre-fills NOTHING, its valid half included — in BOTH directions. See
  // the alert above: the link is judged as one thing, because half a search is a different search.
  // `linked` here is undefined when the RESUME half errors, even though `config=` decoded fine;
  // `linkedSearch` two lines down is undefined when the CONFIG half errors, even though the resume
  // params decoded fine. Losing either half of that symmetry mines a search the link did not
  // describe while the alert says the link could not be used.
  const linked = linkDismissed || resumeResult?.error ? undefined : linkResult?.config
  // Gated on dismissal and on the CONFIG half's error the same way `linked` above is gated on
  // dismissal and the RESUME half's error: "Start over" throws the link away, and what it carried
  // with it, and a `config=` this app could not decode must not leave the resume params still
  // seeding the form underneath the rejection.
  //
  // A link carrying BOTH kinds is a result link. `resumeSearchPath` cannot produce one (it writes
  // no saltNonce), so this only arises hand-made — and then the resume params are ignored outright
  // rather than half-applied, because a page reconstructing someone's mined address while quietly
  // pre-filling a different search underneath it is worse than either alone.
  const linkedSearch =
    linkDismissed || linkResult?.error || linked?.saltNonce ? undefined : resumeResult?.resume
  // The chain no longer travels with the other three: those are Configure's fields, this is the
  // header's control, so it is answered here instead of in the form. A share link puts the whole
  // config on screen, chain included, or none of it. (A recipient meets the sender's chain, which
  // is the chain the sender's dialog and CLI command name; the address itself would survive any of
  // the six, but nothing here should quietly answer a question the link already answered.)
  //
  // DERIVED from the link, not seeded from it into state. `useState(() => linked?.chainId ?? …)`
  // could only ever see the FIRST client render, and this subtree reaches that through the Suspense
  // bailout above with a useSearchParams() that may still be empty — which is exactly why the link
  // is LATCHED on first sight rather than captured on the first render (see `linkParamsRef`). The
  // form's fields follow that latch, so a late link leaves an obviously blank owners field that a
  // recipient fills in; a chain that missed it read "Ethereum" instead, the other singleton class
  // from every link that names one of the six, and a recipient who submitted then mined a different
  // address family from the one they were sent with nothing on screen to say so. Reading `linked`
  // where it is used removes the schedule question rather than answering it: whenever the link
  // lands, all four fields land together.
  //
  // `picked` is the user's answer, and it outranks the link from the moment there is one — including
  // a pick of the chain the link already named, which is indistinguishable and harmless.
  const [picked, setPicked] = useState<number | undefined>()
  const chainId = picked ?? linked?.chainId ?? DEFAULT_CHAIN_ID

  // DERIVED from the link, not seeded from it — the pattern `chainId` above uses, for the reason
  // spelled out there: a `useState` initialiser only ever sees the FIRST client render, and this
  // subtree reaches that through a Suspense bailout with a useSearchParams() that can still be
  // empty. Anything captured there would drop a link that latched a render later, and the failure
  // is silent: a search mining five expressions where the link named two, with a Filter card
  // reading back exactly what it is doing and no sign that it is not what was asked for.
  //
  // `picked*` is the user's answer, and it outranks the link from the moment there is one —
  // including an answer identical to the link's, which is indistinguishable and harmless.
  const [pickedMouths, setPickedMouths] = useState<string[] | undefined>()
  const mouths = pickedMouths ?? linkedSearch?.mouths ?? ALL_MOUTH_NAMES
  const [pickedFilters, setPickedFilters] = useState<FaceFilters | undefined>()
  const filters = pickedFilters ?? linkedSearch?.filters ?? DEFAULT_FACE_FILTERS

  // Memoised so a re-render does not hand MiningView a new FaceSpec object and restart the run —
  // only an actual change to the accepted expressions should do that.
  const faceSpec = useMemo(() => faceSpecFromSelection(mouths), [mouths])

  // The link wins on arrival; after "Start over" has dismissed it, the discarded run's own config
  // is what the form is seeded from.
  const initial = linked
    ? {
        // The array the link decoded, not a joined string: the form has one field per owner, and
        // re-splitting a flattened list on the way in is a chance for an entry to be dropped or
        // reordered — which is a different Safe address, silently.
        owners: linked.owners,
        threshold: linked.threshold,
        safeVersion: linked.safeVersion,
        // From the link when it named one. `?config=` still does not carry a start nonce and must
        // not — where a search began is not part of what a shared ADDRESS is (see RunOptions) —
        // but the `start=` param beside it exists to carry exactly that, because a resume link's
        // whole purpose is to reproduce a search rather than to present a result. Falls back to
        // what this session last submitted, which is what "Start over" has to hand back.
        start: linkedSearch?.start ?? startNonce,
      }
    : lastSubmitted
      ? {
          owners: lastSubmitted.owners,
          threshold: lastSubmitted.threshold,
          safeVersion: lastSubmitted.safeVersion,
          start: startNonce,
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
  // The selection the link's own `?config=` names, kept for as long as the link is live. That
  // entry was put in the history stack by whoever opened the link, not by this page, so it is not
  // in `writtenSelections` and a traversal back onto it finds nothing to restore there — and
  // closing the link's dialog now leaves the user exactly one Back away from it (the base URL is
  // pushed over it). Without this, that Back would land on the URL of a result with no dialog on
  // screen. Held rather than re-derived: the reconstruction is one-shot and costs an RPC read plus
  // keccak's wasm init, and re-deriving would mean re-pairing a candidate with a config instead of
  // restoring the pair that was made together. Cleared by "Start over", which is what puts the
  // link out of reach for good — the same thing `runGeneration` does for the app's own entries,
  // and equally not a `writtenSelections` edit: the latch has held this param since mount, so
  // dropping the selection cannot make it look like an incoming share link.
  const linkSelection = useRef<Selection | undefined>(undefined)
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
        if (!cancelled) {
          const restored = { candidate, config: linkMineConfig }
          // Recorded as well as shown: this is the only copy of the pair for the link's own
          // history entry, and it has to outlive the dialog being closed (see `linkSelection`).
          linkSelection.current = restored
          setSelection(restored)
        }
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

  // The host's own reasons to hold mining, which are not the user's and must not be cleared by
  // them: a deploy transaction in flight, and a share link still being reconstructed.
  const pausedByHost = deploying || awaitingLinkCandidate
  const miningPaused = pausedByHost || pausedByUser
  // While the host is the one pausing, both controls necessarily read "start"/"Resume" — and the
  // only honest meaning a click can have then is "run as soon as you are allowed to", never "and
  // also pause again on my behalf". Treating it as a plain toggle would set `pausedByUser` from a
  // click that changed nothing on screen, so mining would stay stopped once the host's reason
  // cleared and the user would have to press again with no explanation. This way every click
  // moves toward running. (Moved up from MiningView with the state it reads.)
  const toggleMining = useCallback(() => {
    setPausedByUser((previous) => (pausedByHost ? false : !previous))
  }, [pausedByHost])

  // The results grid's empty state can only tell the user to relax a filter; the card those
  // filters live in is this page's, in a sibling subtree of the grid, so the request travels
  // through here. A counter rather than a boolean because it is an event, not a state: the user
  // may close the card and ask again, and "please open" left true would say nothing the second
  // time. FaceSection acts on the change and ignores the value (see `revealRequest` there).
  const [filterReveals, setFilterReveals] = useState(0)
  const revealFilters = useCallback(() => setFilterReveals((previous) => previous + 1), [])
  // Whether that card is currently showing its controls, reported by the card itself — `mining`,
  // the reveal above and the card's own header all move it, so nothing here could keep an honest
  // copy on its own. It decides one thing: whether the grid's empty state is offered the handler
  // at all, and so whether it draws the button. Offering it over an open card would be a button
  // that reveals what the user is already looking at.
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Both halves of the address bar — opening a result and closing it — are now pushes, and
  // nothing this page does to history is asynchronous. There is no `backInFlight`/`deferredPush`
  // bookkeeping any more, and no `pushedEntry` either: see `closeSelection` below.
  const pushSelectionUrl = useCallback((selection: Selection) => {
    const shared = { ...selection.config, saltNonce: selection.candidate.saltNonce }
    // The URL first, and the registry key read back OUT of it. shareConfigPath is the single place
    // a `?config=` URL is spelled — the dialog's copyable field goes through it too, so the address
    // bar and that field are the same string, which the headline test in test/page.test.tsx pins
    // character for character. This key has to be exactly what useSearchParams() will report once
    // the URL below is written, so it is taken from that URL rather than encoded a second time
    // beside it: two calls agree today only because shareConfigPath happens to call
    // encodeConfigParam, and the day that spelling gains a version marker or a second param, a
    // separately encoded key would stop matching — silently. What breaks then is the self-write
    // exclusion in `writtenSelections`: the app's own write is read back as a share link, and the
    // resolving overlay drops over the dialog that caused it with mining paused behind it.
    //
    // It writes `config` into the URL the page is ON, so opening a result adds a parameter rather
    // than moving the app to `/` — the same rule `closeSelection` keeps when it takes that
    // parameter back out again, and the reason a basePath deployment is not navigated off itself
    // by inspecting a result.
    const path = shareConfigPath(shared)
    const param = new URL(path, window.location.origin).searchParams.get('config') ?? ''
    // The user is already standing on this exact URL — a share link they opened, or a result's
    // entry they traversed back onto. Pushing a second, identical entry would be a duplicate
    // nobody asked for, and the URL cannot even show that it happened.
    if (new URLSearchParams(window.location.search).get('config') === param) return
    // Registered only when a write actually happens, and only for the param actually written.
    // Registering above the early return would claim an entry this page never wrote as one it
    // did: a traversal back onto it would restore this selection over whatever that entry
    // actually names — for a share link's own entry, the sender's candidate replaced by a mined
    // one, and for a retired run's entry, a live Deploy button on a page that has been reset out
    // from under it. The rule is the one the last fix established: bookkeeping is only ever
    // updated on a path where a write actually happened.
    //
    // Recorded BEFORE the write: the render the write provokes must already be able to tell that
    // this param is the app's own and not a share link (see `writtenSelections`).
    writtenSelections.current.set(param, { selection, generation: runGeneration.current })
    // The App Router's patched pushState, deliberately, rather than router.push(): this is a URL
    // change and nothing else — no navigation, no RSC request, no scroll reset, and no re-render
    // of a route tree with five to eight mining workers under it — while the patch is what keeps
    // useSearchParams() reporting the truth afterwards.
    window.history.pushState(null, '', path)
  }, [])

  // The same URL, for a selection that has been carried onto a new chain underneath an open
  // dialog (see `changeChain`). A REPLACE, not a push: the user has not navigated anywhere — they
  // are standing on the entry that names this result and have re-aimed it at another chain, so
  // this is that entry, corrected. Pushing instead would leave the previous entry naming the same
  // candidate on the old chain, and Back onto it would restore a dialog on Sepolia while the
  // header still read Polygon — precisely the disagreement the carry exists to prevent.
  //
  // Only when the bar names THIS selection, which is what `previous` is for. "There is a `?config=`
  // in the bar" would be enough today — the URL and the open dialog are kept in step by everything
  // above — but that is an inherited property, not an enforced one, and what it inherits is the
  // right to overwrite an entry naming something else. Comparing against the param the pre-carry
  // selection encodes to makes the rule the same one as everywhere else here and checks it: a URL
  // is only ever written on a path where there is something to write, and a dialog the address bar
  // does not name does not acquire one because the chain moved. (A hand-made link whose encoding
  // differs byte for byte from this app's own is the one case that then writes nothing — it is
  // also the case where the entry belongs to whoever made it, not to this page.)
  //
  // Registered before the write, and only for the param actually written, for the reasons
  // `pushSelectionUrl` sets out; the entry it replaces keeps its own (now unreachable)
  // registration, since entries are only ever added.
  const replaceSelectionUrl = useCallback((previous: Selection, carried: Selection) => {
    const pathFor = (selection: Selection) =>
      shareConfigPath({ ...selection.config, saltNonce: selection.candidate.saltNonce })
    const paramFor = (path: string) =>
      new URL(path, window.location.origin).searchParams.get('config') ?? ''
    const path = pathFor(carried)
    const param = paramFor(path)
    const named = paramFor(pathFor(previous))
    const current = new URLSearchParams(window.location.search).get('config')
    if (current !== named || current === param) return
    writtenSelections.current.set(param, { selection: carried, generation: runGeneration.current })
    window.history.replaceState(null, '', path)
  }, [])

  // Every route out of the dialog that is a USER ACTION IN THE APP goes through here — the footer
  // button, Escape, the X, a click on the dialog's backdrop, and "Start over" — so that the URL
  // always agrees with what is on screen. (The backdrop is the only outside click in that list.
  // The dialog is non-modal and the backdrop stops at the header, so using the header is not a way
  // out of it, and neither is anything else Radix would call an interaction outside. See
  // DeployDialog.)
  // Closing by pressing the browser's own Back does NOT: the browser has already changed the URL,
  // and the popstate handler below is where that lands. Pushing there would destroy the entry the
  // user had just stepped off and strand them with no way forward.
  //
  // Closing PUSHES the base URL rather than taking the dialog's entry back off with a
  // `history.back()`, which is what this used to do. That reversal is deliberate and requested:
  // the open dialog is a place you can navigate to, so Back from the closed dialog reopens it
  // instead of skipping past it to whatever came before. The old reasoning has not stopped being
  // true — a push cannot remove an entry, so history now grows by two entries per open/close
  // cycle, and a user who inspects six results and then holds Back walks back through all six
  // rather than leaving the page. That is the accepted cost of the dialog being navigable.
  //
  // Conditional on the address bar actually naming a result, which is the same rule as everywhere
  // else here: only write history on a path where there is something to write. "Start over" calls
  // this with no dialog open and, usually, a bare URL — that must not stack up base entries — and
  // a dialog closed on a URL that never named it (nothing pushed, nothing to undo) leaves the bar
  // where it is.
  /**
   * Takes `?config=` back out of the address bar, as a push so the result stays one Back away.
   *
   * Split out of `closeSelection` because minimising needs exactly this half and none of the rest:
   * the dialog is off screen either way, so the bar must stop naming it either way.
   *
   * Only `config` is dropped, rather than reaching for a bare '/': anything else in the bar (a path
   * this app is mounted under, a hash, an analytics param) belongs to whoever put it there and
   * closing a dialog is not the moment to throw it away. Conditional on the bar actually naming a
   * result, which is the same rule as everywhere else here: only write history where there is
   * something to write.
   */
  const dropSelectionUrl = useCallback(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('config')) return
    url.searchParams.delete('config')
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const closeSelection = useCallback(() => {
    setSelection(undefined)
    // With the selection, or a later traversal onto the same stored object would reopen its dialog
    // closed.
    setMinimised(undefined)
    // The dialog that was reporting this is going; its phase describes nothing now.
    setDeployPhase('idle')
    // Belt and braces, and the only remaining place it can be done: the deploy sequence's own
    // `finally` clears this, but if the dialog is dismissed while a wallet prompt is still open,
    // nothing else would hand mining back until (or unless) that promise settles — and `paused`
    // is a HOST pause, which the status bar's own Resume deliberately cannot clear. The dismissed
    // attempt is disowned with it, so its own settle cannot later release a different one.
    abandonDeploy()
    dropSelectionUrl()
  }, [abandonDeploy, dropSelectionUrl])

  // The other half of both pushes above, and the one place a traversal is reconciled. It listens
  // for the traversal itself rather than reacting to a changed useSearchParams(): "Back reopens
  // (or closes) the dialog" must not be subject to how a given Next version routes a traversal
  // into router state, and window.location is the truth under either. (A traversal that Next also
  // reflects is harmless — the param is either the app's own or the latched link's, so nothing
  // downstream of the link latch moves.)
  //
  // It reconciles and never writes. Everything it can land on is an entry that already exists,
  // and the browser has already moved the URL by the time it runs: a push from here would destroy
  // the entry the user just stepped off. This is what makes closing the dialog with the browser's
  // Back different from closing it by hand — it goes through here, not through closeSelection.
  useEffect(() => {
    const onPopState = () => {
      const param = new URLSearchParams(window.location.search).get('config')
      const entry = param ? writtenSelections.current.get(param) : undefined
      // An entry from a retired run restores nothing: "Start over" threw that run away, and its
      // URLs stay reachable (a pushed entry cannot be un-pushed) but must not put its dialog back
      // on a page whose Configure form is now unlocked and empty. The entry itself stays in the
      // map — see `runGeneration` — so the param is still recognised as the app's own here.
      const written =
        entry && entry.generation === runGeneration.current ? entry.selection : undefined
      // The one entry that can name a dialog without being in the map: the share link's own. A
      // recipient who closes their dialog is one Back from it, and it has no `WrittenEntry`
      // because this page did not write it — so without this the URL would say "this result" and
      // the screen would say nothing at all. It restores the pair that was reconstructed once at
      // mount (never a second reconstruction, and never a re-derived config), and it restores
      // nothing after "Start over", which clears `linkSelection` exactly as `runGeneration`
      // retires the app's own entries.
      //
      // Keyed on the LATCHED param, not on "is a `?config=` we don't recognise": the latch is
      // what everything else here keys off too, and this must never be the thing that decides a
      // param is a share link. Nothing about the latch moves when a traversal lands on it —
      // `linkParamsRef` was set at mount and only ever set once — so no overlay drops over the
      // dialog and mining is not paused by arriving back on the URL the session started on.
      // A written entry wins where a link's param and a mined result's encode identically: the
      // app really pushed that one, and it is the newer of the two.
      const restored =
        written ??
        (param && param === linkParamsRef.current?.config ? linkSelection.current : undefined)
      // Whatever the URL names, including nothing: an entry naming a result puts it back — with
      // its own config, the pairing intact — and a base entry closes the dialog.
      setSelection(restored)
      // Cleared by hand here, and only here: this is the one caller that can hand back the very
      // object `minimised` is holding (it restores what it stored), which would otherwise reopen
      // that dialog closed.
      setMinimised(undefined)
      // Same reason as closing by hand, above, and the same disowning: a traversal off a dialog
      // mid-send abandons that attempt exactly as the footer's "Close and keep waiting" does.
      abandonDeploy()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [abandonDeploy])

  // Configure is locked once submitted because owners, threshold and Safe version are inputs the
  // address is derived from that cannot be changed without invalidating every result on screen.
  // So the only way back is this — an explicit, confirmed reset that throws the run away rather
  // than pretending it survived. The fourth such input, the chain, is the exception that now lives
  // in the header: it reaches the address only through which Safe singleton it deploys through, so
  // most switches change nothing and are free, and the one that does change it comes through
  // `changeChain` below — which asks first, and then calls exactly this.
  const startOver = useCallback(() => {
    setConfig(undefined)
    // Retires every `?config=` written for the run being discarded. Their entries survive in the
    // back/forward stack whatever this does — pushing is the only way to remove one, and it removes
    // the wrong end — so Back (and Forward, where the user has traversed) can still land on a
    // discarded result's URL; this is what makes that a bare page rather than a live Deploy button
    // for a result mined under a config nobody is on any more.
    runGeneration.current += 1
    // The link's own entry is retired the same way, and it has to be done here rather than left to
    // `runGeneration`: that entry is not in `writtenSelections`, so nothing else would stop a Back
    // onto it reopening the sender's dialog on a page that has just been reset. Not a
    // `writtenSelections` edit and not a re-latch — see `linkSelection`.
    linkSelection.current = undefined
    // Clears the link candidate too, if that is what is open: `linkDismissed` below puts the link
    // out of reach for good, and a dialog still deploying its config would be the one piece of it
    // left reachable after the reset. Through closeSelection so the address bar is reset with it:
    // a reset that left the discarded result in the URL would leave it one reload away from
    // coming back.
    closeSelection()
    setLinkCandidateError(undefined)
    setLinkDismissed(true)
    // The header keeps the chain it is on, and this is what keeps it there. The chain is chrome,
    // not one of Configure's fields: this reset throws away the run, the form and the link, and
    // since the header FOLLOWS the link until the user picks something (see `picked` above),
    // dismissing the link would otherwise drop an untouched header back to the default — which,
    // for a link naming any of the six, is the singleton class the recipient was not on, arriving
    // unasked in the same instant as everything else disappearing.
    //
    // Functional, and that matters: `changeChain` calls this immediately after `setPicked(next)` on
    // a confirmed mainnet crossing, so `chainId` in this closure is still the PRE-switch chain — a
    // plain `setPicked(chainId)` would undo the switch the user just confirmed. Queued updates see
    // each other, so `previous` is that `next` and the pick stands.
    setPicked((previous) => previous ?? chainId)
    // Nothing is running to be paused any more, and the next run must not inherit a stop the
    // user asked of the one before it.
    setPausedByUser(false)

    // Everything else goes back to what a first visit holds. This used to hand the config, the
    // checkpoint and the search back to the form on the grounds that they were answers the user had
    // given and would rather not retype — a real argument, and the reason the old comment here said
    // `startNonce` was deliberately NOT reset.
    //
    // It is the wrong trade now that the app name in the header is the only route back. That reads
    // as "take me to the beginning", and a beginning that arrives holding the previous run's owners,
    // floors and resume point is not one. Keeping them also made the address bar impossible to
    // clear: the draft writer puts whatever the form holds straight back, so a reset that left the
    // answers in place would have watched its own cleared URL repopulate a few hundred milliseconds
    // later.
    setLastSubmitted(undefined)
    setStartNonce(0)
    // To `undefined`, not to the defaults: these are the "user picked something" halves of derived
    // values, and clearing them is what lets `mouths` and `filters` fall back through a dismissed
    // link to the app's own defaults. Writing the defaults in would look identical today and stop
    // being identical the moment a default changes.
    setPickedMouths(undefined)
    setPickedFilters(undefined)
    // So the writer has nothing left to put back, and its next write comes from a form that has
    // just been rebuilt empty.
    setFormDraft(undefined)
    // And this is what rebuilds it, for the reset that arrives while it is already on screen. See
    // `formGeneration`. A no-op during a run, where the form is unmounted and mounts empty anyway.
    setFormGeneration((generation) => generation + 1)
    // And the address bar itself, immediately rather than on the writer's next tick: a URL still
    // describing the discarded run is one reload away from restoring it, and the reset has to be
    // true the instant it is asked for.
    //
    // Through `clearedSearchPath`, which deletes the six params this app owns and leaves the rest
    // of the query alone. This used to rebuild the URL from the path and fragment, which took a
    // deployment's `utm_*` or anything else appended to the link with it — and the comment here
    // claimed to be following the same rule as every other writer in this file while doing the one
    // thing none of them do.
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', clearedSearchPath())
    }
  }, [chainId, closeSelection])

  /**
   * Makes the app title a control on the idle screen too, standing for the same reset MiningView
   * registers during a run.
   *
   * Gated on there being no run, because MiningView registers the run's own entry with the count
   * that has to be confirmed, and only one entry is live at a time. The two swap over on submit and
   * on reset; whichever registers last wins, and neither can blank the other on its way out (see
   * StartOverProvider).
   *
   * A count of zero, which is the honest number: nothing has been mined on this screen, so there is
   * nothing to lose that a confirmation could protect. The dialog's own rule turns that into an
   * immediate reset with no question asked, the same as pressing it during a run that has not found
   * anything yet.
   */
  useRegisterStartOver(0, startOver, !config)

  // Starting a search. With a run already on screen this is a RESTART, and the results below
  // belong to the config that produced them — so the old run is discarded exactly as "Start over"
  // discards it, history entries and share link included, rather than leaving a leaderboard of
  // Safes mined for a config nobody is on any more. The form only submits when it is idle or when
  // its fields have been edited away from the run (a plain resume goes through `toggleMining`
  // instead), so this cannot fire on a press that was only meant to continue.
  /**
   * What the Configure form currently holds, as it reports it (see ConfigForm's `onDraftChange`).
   *
   * Held here rather than in the form because the other half of the draft — the expressions and the
   * colour filters — is page state, and one writer has to see all of it. Two writers on one address
   * bar would each drop the other's params.
   */
  const [formDraft, setFormDraft] = useState<{ config?: MineConfig; start: number } | undefined>()

  /**
   * Bumped by `startOver`, and used as the Configure card's `key` — which is to say: the reset
   * remounts the form.
   *
   * Clearing the state above is not enough on its own. ConfigForm seeds from `initial` exactly once
   * and then guards that with its own `seeded`/`edited` refs, deliberately, so that a link's
   * prefill cannot come back and overwrite what the user has since typed. The consequence is that
   * handing it `initial === undefined` later does nothing at all: the owner rows, the threshold and
   * the checkpoint field are the form's own state by then, and nothing outside it can put them back.
   *
   * A reset from a run never needed this, which is why it was never here: the form was unmounted for
   * the whole run and a fresh mount is empty for free. Resetting from the idle screen is the case
   * where the form is already on screen and has to be emptied while the user watches, so the reset
   * throws the instance away instead of trying to talk it back to its defaults field by field.
   */
  const [formGeneration, setFormGeneration] = useState(0)

  /**
   * Keeps the address bar in step with the start screen, so a reload does not cost the reader their
   * work.
   *
   * Idle only, and that boundary is the point. Once a run exists the URL belongs to the share and
   * selection machinery (`pushSelectionUrl`, `shareConfigPath`), and a draft writer racing it would
   * be two things editing one address bar with different ideas of what belongs in it. A link
   * candidate can open a dialog before anything is submitted, so `selection` is checked too.
   *
   * `replaceState`, never push: a history entry per keystroke would make Back mean "one character
   * ago" rather than "the page before this one". Debounced, so a slider drag writes once at the end
   * of it rather than forty times through it.
   *
   * Deliberately NOT recorded in `writtenSelections`. That set answers "did this page write this
   * `config=` as a SELECTION?", and these writes are not selections; recording them would make a
   * traversal onto one try to restore a dialog that never existed.
   */
  /**
   * Where the URL's contents come from: the form while it is on screen, the run once one exists.
   *
   * They are the same four facts either way, and only the source moves. On the start screen the form
   * is the only place owners, threshold, version and the checkpoint live; once Start is pressed the
   * form unmounts and the run holds them, unchanged for its whole life. The expressions and the
   * filters are page state throughout and are read directly below, which is what lets a change to
   * either reach the URL mid-run as readily as it does before one.
   */
  const urlDraft = config ? { config, start: startNonce } : formDraft

  useEffect(() => {
    // `linked?.saltNonce` is the one that is easy to miss, and the window it guards is wide. A
    // result share link's `config=` carries a mined saltNonce, and `draftSearchPath` writes no
    // saltNonce at all — so a URL someone was sent to show one address would have that address
    // stripped out of it a few hundred milliseconds after it loaded, before the dialog naming it
    // had even opened, because reconstructing the candidate costs an RPC read and keccak's wasm
    // init while this waits only on a timer. The dialog would still appear (the link is latched),
    // and a reload would then find nothing. That URL is not a draft; it is somebody's shared
    // result, and this has no business editing it.
    // No longer stops once a run exists. The expressions and the filters stay editable for the whole
    // of one, and a reader who narrows them mid-run has changed what is being mined just as
    // decisively as they would have before pressing Start.
    //
    // `selection` still stops it, and has to: an open result dialog means `pushSelectionUrl` owns
    // the address bar, and two writers with different ideas of what belongs in `config=` would take
    // turns overwriting each other.
    if (selection || linked?.saltNonce || !urlDraft) return
    const timer = setTimeout(() => {
      const path = draftSearchPath({
        config: urlDraft.config,
        target: faceSpec.name,
        filters,
        start: urlDraft.start,
      })
      // Only when it would actually change something: React re-runs this for reasons that have
      // nothing to do with the URL, and a replaceState that rewrites the same string is work the
      // browser does for nothing.
      if (path !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(null, '', path)
      }
    }, DRAFT_URL_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [selection, linked?.saltNonce, urlDraft, faceSpec.name, filters])

  const submitConfig = useCallback((next: MineConfig, run: RunOptions) => {
    setLastSubmitted(next)
    setStartNonce(run.start)
    setConfig(next)
    // A fresh run is never born stopped, whatever the previous one was left at.
    setPausedByUser(false)
  }, [])

  // Applying a new set of accepted expressions. FacePicker only calls this once the user has
  // confirmed the restart it causes — a new face spec is a different run, so the leaderboard is
  // discarded and the search begins again.
  //
  // Clearing the user's pause is what makes that restart actually happen. MiningView's effect
  // returns early while paused, so a confirmed "restart the search" from a paused run would
  // otherwise wipe the board and start nothing: the cost paid, none of the benefit, and a status
  // bar reading Resume over an empty grid with no sign of why.
  const applyMouths = useCallback((next: string[]) => {
    setPickedMouths(next)
    setPausedByUser(false)
  }, [])

  // What a chain switch is measured against: the chain whose addresses are at stake. Normally the
  // submitted config's — the run on screen is what a crossing costs — but before anything is
  // submitted there can still be something to lose, because a share link opens its dialog with no
  // run at all. That result is as chain-bound as any mined one (its address holds on the six and
  // not across the boundary), and now that the header is reachable from an open dialog it can be
  // switched out from under it. So it is the fallback, and there is exactly one such value: it is
  // handed to ChainSelector as the thing to ask about AND read back by `changeChain` as the thing
  // to act on, which is the rule that comment establishes — a question put about one chain must
  // never authorise a reset carried out against another.
  //
  // The third term covers the window before either exists. While a link's saltNonce is still being
  // reconstructed there is no `config` and no `selection` yet, but the link's chain is already
  // spoken for: the address about to appear is derived from it. The resolving overlay takes the
  // pointer route to the header and deliberately not the keyboard one, so this is reachable by
  // tabbing to the selector mid-resolution — and without this term nothing would be asked, the
  // header would land on the other singleton class, and the candidate would arrive a moment later
  // paired with a config for the class the header has just left. Everything downstream then has a
  // `selection` whose chain disagrees with the run in a way no later question can catch. Held only
  // while `awaitingLinkCandidate`: once the attempt settles either way, `selection` (or nothing at
  // all) is the truth, and a link that failed to reconstruct has nothing at stake.
  const stakedChainId =
    config?.chainId ??
    selection?.config.chainId ??
    (awaitingLinkCandidate ? linkMineConfig?.chainId : undefined)

  // The header's chain picker, applied. It has already asked the user where asking was required —
  // ChainSelector holds a switch that costs results behind a confirmation, exactly as Configure
  // holds its fields behind "Start over" — so by the time this runs the switch is allowed to
  // happen; what is left is making the page agree with it.
  //
  // The confirmation and the reset are decided from the SAME value, `config.chainId`: the selector
  // is handed it as `runChainId` (it is not the header's chain, which is what it used to ask
  // about), and the branch below reads it again from the same submitted config. What that rules
  // out is the two disagreeing — a run discarded by a branch here that the user was never asked
  // about, because the question had been put to a different chain.
  //
  // Three cases, and the middle one is the whole feature:
  //
  //   - Nothing submitted. There is no run and no results, so the chain is just a setting.
  //   - A run, and the new chain shares its Safe singleton (any two of the six non-mainnet
  //     chains). The factory, the initializer hash and the initCodeHash are byte-identical there,
  //     so every address already on the leaderboard is still that Safe's address on the new chain:
  //     the run continues, the board is kept, and only the chain the config NAMES moves. That new
  //     config object makes useSafeConstants re-read — an honest read, against the new chain's own
  //     RPC — and MiningView keys its restart on the constants' VALUES, so the answer coming back
  //     equal leaves the worker pool untouched (see the comment there; it is the whole hazard).
  //   - A run, and the new chain crosses the mainnet boundary. Different singleton, different
  //     address for every candidate found, so the run cannot come along: this is a reset, and the
  //     same reset "Start over" performs — history entries retired, the link put out of reach, the
  //     dialog closed and the address bar cleared with it.
  //
  // THE OPEN DIALOG COMES WITH IT, and this reverses an earlier decision. It was left behind while
  // the header was unreachable from an open dialog: a modal overlay meant the chain could not move
  // underneath one, so "closing and reopening the card is what moves a result to the new chain"
  // cost nothing. The dialog is non-modal now (see DeployDialog), so the chain moves while a
  // result is on screen, and leaving `selection` where it was would mean the header saying
  // Arbitrum over a dialog still deploying on Polygon — the disagreement this whole control exists
  // to avoid, on the one screen where money is spent.
  //
  // Carrying it is safe for exactly the reason the same-class switch above is: the Safe address
  // does not depend on the chain. Factory and initializer hash are identical everywhere and the
  // initCodeHash takes one of two values, decided by which singleton protocol-kit picks — measured
  // on live RPCs across all seven supported chains (lib/config.ts). So among the six the carried
  // config still derives EXACTLY the address on screen, which is the whole content of the
  // `{ candidate, config }` pairing: the config is not "close enough", it is still the one that
  // produces that candidate. Nothing the dialog shows changes but the chain it names — the
  // address, the saltNonce and the owners are all untouched — and DeployDialog's independent
  // `plan.address !== candidate.address` refusal therefore passes for the right reason rather than
  // by luck. A crossing is never carried: it is caught above and resets, because there the address
  // genuinely would change.
  //
  // Not while a deploy is in flight, and that is what `deploying` gates the selector on rather
  // than this branch quietly skipping: the wallet is holding a transaction built for the chain the
  // user read before they confirmed, and repointing the description, the share link and the
  // wrong-chain gate at a different one mid-send would describe that transaction wrongly (the gate
  // would even replace "Deploying…" with "Switch network to continue"). The control is disabled
  // for those seconds instead, which says so rather than ignoring the user.
  const changeChain = useCallback(
    (next: number) => {
      setPicked(next)
      if (stakedChainId !== undefined && chainSwitchDiscardsResults(stakedChainId, next)) {
        startOver()
        return
      }
      // The carry is allowed only where the measurement that licenses it holds — between two
      // chains of the same singleton class — and it is asked about the OPEN SELECTION's chain
      // rather than the one above, because that is the config being repointed. The two can only
      // differ if a selection and a run ever ended up in different classes, which `stakedChainId`
      // is what prevents: every route that could set one is either same-class by construction (a
      // card click pairs with the submitted config; the carry moves both together; a restored
      // entry belongs to the current generation, and a crossing bumps it) or goes through the
      // question above. So this is defence in depth of the same kind as the dialog's `key` — and
      // if it is ever reached, refusing to carry and resetting is the only honest answer: an
      // address derived under `Safe.sol` is simply not that Safe's address under `SafeL2.sol`, so
      // carrying would leave the dialog offering a share link that reproduces a DIFFERENT address
      // for whoever opens it. That is worse than losing the dialog, and much worse than leaving it
      // to the deploy handler's refusal, which only fires once someone tries to spend gas.
      if (selection && chainSwitchDiscardsResults(selection.config.chainId, next)) {
        startOver()
        return
      }
      if (selection && selection.config.chainId !== next) {
        const carried = {
          candidate: selection.candidate,
          config: { ...selection.config, chainId: next },
        }
        setSelection(carried)
        // The address bar and the copyable link are the same string, and both encode `chainId`:
        // the entry naming this result is corrected in place so a link copied after the switch
        // reproduces what this dialog would now deploy.
        replaceSelectionUrl(selection, carried)
      }
      if (config) setConfig({ ...config, chainId: next })
    },
    [config, selection, stakedChainId, startOver, replaceSelectionUrl],
  )

  // Where the selector is rendered: an element the layout puts in the sticky header. Resolved
  // during the first browser render — the header is committed long before this subtree mounts —
  // with the effect as the fallback for any mounting order that first render cannot see. Same
  // arrangement, and same reasoning, as MiningView's status bar slot; with no slot at all (a bare
  // `<HomeContent />`, as in unit tests) the selector renders in place.
  const [chainSlot, setChainSlot] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.getElementById(HEADER_CHAIN_SLOT_ID),
  )
  useEffect(() => {
    setChainSlot(document.getElementById(HEADER_CHAIN_SLOT_ID))
  }, [])
  const chainSelector = (
    <ChainSelector
      chainId={chainId}
      runChainId={stakedChainId}
      // Held still for exactly as long as a transaction is in the wallet's hands — see
      // `changeChain`. The same window MiningView is paused for, and for the same reason: the one
      // moment a user must read an address, and the chain it is being deployed on, against a
      // surface that is not moving.
      disabled={deploying}
      onSelect={changeChain}
    />
  )

  // Pairs the clicked card with the config it was mined under, at the moment it is clicked. Stable
  // across everything but a config change and the start/end of a deploy, which is what the 200
  // memoised result cards need from it: what would cost them is a NEW IDENTITY PER RENDER, since
  // the grid re-renders several times a second while mining and their memo would then be 200
  // wasted comparisons per publish. A config change unmounts the run those cards belong to anyway,
  // and `deploying` flips exactly twice per deploy — during a window in which nothing is being
  // published, because mining is paused for it.
  //
  // The `config &&` is a type narrowing, not a branch: MiningView only exists while a config is
  // submitted, so it cannot call this without one.
  //
  // Opening a result is also what puts it in the address bar, and the push happens here rather
  // than in an effect on `selection`: this is the one caller that represents a user asking for a
  // result, which is what deserves a history entry. The link-candidate reconstruction and the
  // popstate restore below both set `selection` too, and neither should push — one is already on
  // its URL, the other IS a history navigation.
  //
  // Inert while a deploy is in flight, and this is the same guard DeployDialog spends `busy` on:
  // Escape, the X, interaction outside and the backdrop's own click are all refused for that
  // window precisely so a send cannot lose the one place its outcome can be read inline. The
  // backdrop has taken the pointer route to the grid back, but a card behind it is still focusable
  // and still activates on Enter (see the `key` note below), so this would otherwise walk around
  // that guard by the one route that is left: an activation swaps `selection`, the `key` unmounts
  // the dialog mid-send, and a "Deployment reverted. Gas was spent." that should have stayed on
  // screen survives only as a toast on a timer. Worse, the abandoned sequence's `finally` still
  // fires `onDeploySettled`, which would hand mining back and re-enable the chain selector while
  // the wallet is still holding a transaction the new dialog knows nothing about.
  //
  // Kept even though the backdrop now covers the grid: a guard that is cheap, that is the page's
  // own rule about its own dialog, and that does not depend on a stacking context staying right is
  // worth more than the line it costs — and it is the only thing standing in that remaining route.
  //
  // A no-op activation rather than a disabled grid: the cards' contract is that they stay visible
  // and clickable whatever MiningView's `paused` says (that is what puts a live leaderboard back
  // in front of the user the instant a dialog closes), so this is the page's rule about its own
  // dialog, made where the page can see both. The window is seconds long and the dialog in front
  // of the user says what is happening in it.
  const selectFromGrid = useCallback(
    (candidate: Candidate) => {
      if (!config) return
      // Keyed on the deploy's own phase rather than on `deploying`, which is a pause and is handed
      // back the moment the dialog is closed: a deploy that is still running has to keep the grid
      // out whether its dialog is on screen or behind the header pill, because a swap here unmounts
      // the component holding its status while a wallet still has the transaction.
      //
      // And it says so. Refusing was always right; refusing in silence made a working rule look
      // like a broken grid.
      if (deployRunning) {
        // The tile that IS the running deploy offers to view it, not to start one, so activating it
        // is a request to come back rather than something to refuse.
        if (candidate.address === selection?.candidate.address) {
          setMinimised(undefined)
          return
        }
        setBlockedByDeploy(candidate)
        return
      }
      // Named `opened` rather than `selection`: the state of that name is read above, and a local
      // const would shadow it for this whole block.
      const opened = { candidate, config }
      setSelection(opened)
      pushSelectionUrl(opened)
    },
    [config, deployRunning, selection, pushSelectionUrl],
  )

  return (
    <>
      {chainSlot ? createPortal(chainSelector, chainSlot) : chainSelector}

      {/* The whole wait a link recipient sits through — the constants RPC round trip, then
          keccak's wasm init and the derivation — happens with nothing else on the page but a
          prefilled form, so without this the app looks like it did nothing with the link at all.

          Driven by `awaitingLinkCandidate` itself rather than a second flag: that is already
          exactly "a link named a saltNonce and its reconstruction has not settled", it is true
          from the first paint (before the constants read has even been dispatched), and it is the
          same value that holds mining over the same window — one source of truth, so the overlay
          cannot outlive what it describes. It yields to both failures for free, which is the
          property that matters most: `linkCandidateError` is only ever set together with
          `linkCandidateSettled`, and a constants failure is the `!constantsForLink.error` term, so
          this and either alert below are mutually exclusive by construction rather than by
          sequencing. Both those alerts therefore render underneath a cleared overlay, never behind
          a live one. On the ordinary no-link path `linkSaltNonce` is undefined and this never
          mounts at all — and it stays undefined however many results the address bar goes on to
          name, because the link is latched from the first `?config=` this page did not write
          itself. Without that latch, opening a dialog would drop this overlay over it.

          `z-60` because it has to cover the sticky header (z-50 in app/layout.tsx), the mining
          status bar (z-40 in MiningStatusBar) and the deploy dialog's backdrop (z-45) rather than
          slide under them — and `inset-0`, unlike that backdrop, which stops at the header on
          purpose: nothing is usable while a link resolves, including the chain. It also swallows
          pointer events over the whole viewport, which is the point of an overlay rather than an
          inline spinner: submitting the form halfway through resolving a link is not something to
          invite. It deliberately does NOT trap focus or mark anything inert — a keyboard user can
          still reach the form behind it, and that state is safe on its own terms (the candidate
          and the config it was derived from are paired, see `selection` above), so paying for a
          focus trap and its escape hatches to prevent it would be the wrong trade.

          No visible caption, by request. The name is `sr-only`: a bare spinning box announces
          nothing at all to a screen reader, and `role="status"` takes its name from the author
          rather than from its contents, so `aria-labelledby` points at that hidden span — one
          string, doing both jobs. */}
      {awaitingLinkCandidate && (
        <div
          role="status"
          aria-labelledby="link-candidate-status"
          className="fixed inset-0 z-60 flex items-center justify-center bg-background/60 backdrop-blur-sm"
        >
          <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden="true" />
          <span id="link-candidate-status" className="sr-only">
            Resolving this share link…
          </span>
        </div>
      )}

      {/* `contents` keeps this wrapper out of the layout entirely, so the sticky bar MiningView
          portals in here sticks to the top of the page rather than to a one-bar-tall box. */}
      <div id={MINING_STATUS_BAR_SLOT_ID} className="contents" />
      {/* `flex-1` claims main's leftover height, which is what gives the idle card somewhere to
          be centred in. It costs nothing once a run is on screen: the content is taller than the
          viewport by then, so there is no leftover height to distribute. */}
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        {!config && !linkDismissed && (linkResult?.error || resumeResult?.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {/* One alert for both halves of one link, but not one message: a hand-made or
                  mangled link can have an invalid `config=` AND an invalid resume param at once
                  (an email client wrapping a long `config=` mid-blob is enough, since the five
                  resume params sit after it), and showing only one would have the reader fix that
                  fault and meet the other on the next load. Both errors render, joined, when both
                  are populated. */}
              This share link could not be used:{' '}
              {[linkResult?.error, resumeResult?.error].filter(Boolean).join(' ')}
            </AlertDescription>
          </Alert>
        )}

        {/* The idle state, and only the idle state. Submitting unmounts it for the whole run —
            owners, threshold and version derive the address every result was mined for, so there
            is nothing to do with them until the run is thrown away, and a locked copy of the form
            is a large piece of furniture saying so. "Start over" in the status bar brings it
            back, holding the config it was mining. */}
        {/* `my-auto` rather than `justify-center` on the parent: auto margins centre the card in
            whatever space is left over, and collapse to zero when there is none — so a short
            viewport, or a link error sitting above it, pushes the card back to normal flow
            instead of centring it off the top of the page where it cannot be scrolled to. */}
        {!config && (
          <div className="my-auto w-full">
            {/* The search travels with the config now: the Filter card sits above this form's
                Advanced disclosure (see ConfigForm), which is what puts the expressions and the
                floors in front of a link's recipient BEFORE they press Start. It is offered on
                every visit, not only for a link — anyone may narrow the target before the first
                nonce is tried — and `linkNarrowedFilters` decides only whether that card arrives
                open, which is the one thing a link has an opinion about. */}
            <ConfigSection
              // Throwing the instance away is how "Start over" empties a form that is already on
              // screen; see `formGeneration`.
              key={formGeneration}
              initial={initial}
              chainId={chainId}
              onSubmit={submitConfig}
              onDraftChange={setFormDraft}
              mouths={mouths}
              filters={filters}
              onMouthsChange={applyMouths}
              onFiltersChange={setPickedFilters}
              linkNarrowedFilters={linkedSearch?.narrowsFilters}
            />
          </div>
        )}

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
              This link&rsquo;s saltNonce could not be reconstructed. Safe constants could not be
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
            {/* No standing phishing caveat here. A banner that is on screen for the whole run is
                the fastest way to teach someone it is scenery, and the caveat is already carried
                where it is actually read: the idle Configure card, the About dialog, and the
                deploy dialog, where the address is confirmed and money is spent. */}
            <FaceSection
              mouths={mouths}
              filters={filters}
              // Reaching this render means a config was submitted, so a run exists: the card
              // starts collapsed, summarising itself in one row rather than putting six hundred
              // pixels of controls between the user and the results they are waiting for. One
              // press of its header opens it, and that choice then holds for the session.
              mining
              // Which is what makes the results grid's "Adjust filters" worth having: the card it
              // opens is collapsed for the whole run until someone asks for it.
              revealRequest={filterReveals}
              onOpenChange={setFiltersOpen}
              onMouthsChange={applyMouths}
              onFiltersChange={setPickedFilters}
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
              paused={miningPaused}
              onPauseToggle={toggleMining}
              onStartOver={startOver}
              // Only while it is actually running: a settled deploy's tile is an ordinary result
              // again, and a spinner over it would say work was still happening.
              deployingAddress={deployRunning ? selection?.candidate.address : undefined}
              // Withheld while the card is open, which is what takes the button out of the empty
              // state: there is nothing left for it to reveal, and the grid's rule is that no
              // handler means no button. Dropping the handler rather than passing a flag keeps the
              // grid ignorant of a card in a subtree it cannot see.
              onAdjustFilters={filtersOpen ? undefined : revealFilters}
              onSelect={selectFromGrid}
              startFrom={startNonce}
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

            `key` is defence against a state that is now reachable only through the accessibility
            tree. What it prevents is a completed (or in-flight) deploy of one candidate leaving
            its "Safe deployed at 0x…" status and permanently disabled button rendered above a
            DIFFERENT candidate's address — which needs `selection` to change from one candidate to
            another with no unmount in between. Under the modal that was unreachable outright: an
            overlay lay over the grid and everything behind it was `aria-hidden` as well as
            unclickable. Between then and now the dialog was non-modal with nothing over the page,
            and a mouse click on a card walked straight into it. The backdrop (see DeployDialog)
            takes that back — it covers the grid, so a click there lands on the backdrop and closes
            the dialog instead — and the route it does NOT take back is the one that was never
            open: Radix keeps `loop` on for a non-modal dialog, so Tab cycles inside the dialog and
            has never reached the grid (measured in a browser, 120 presses).

            What is left is a real route, and the reason this stays: nothing behind the backdrop is
            `aria-hidden`, `inert` or pointer-events-none — deliberately, that is what non-modal
            bought — so an assistive technology's virtual cursor can focus a card and activate it,
            running `selectFromGrid` straight into this element position with the previous
            candidate's dialog still mounted. Verified in a browser, not assumed: focusing a card
            behind an open dialog and pressing Enter swaps it. Every other `setSelection` caller
            stays as it was — `onOpenChange(false)` clears and unmounts; the link-candidate effect
            is one-shot and runs in a window where the grid is empty; the popstate reconciliation
            hands over either `undefined` or the selection its entry names.

            So it is still not a guard against a hypothetical: the regression test in
            test/page.test.tsx pins the state it protects, and the "card behind the open dialog is
            activated without a pointer" test walks in by the route that is left.

            THE CHAIN IS PART OF THE KEY for the same reason the address is, and it is the carry in
            `changeChain` that makes it so. That carry keeps the candidate, so without the second
            half it would re-render this component rather than replace it — and `status`, `error`
            and `completed` would come along. The flow that breaks is the one the carry exists to
            unlock, and it is the one the dialog's own copy invites: deploy on Sepolia, read "Safe
            deployed at 0x…", then switch to Polygon to deploy the same address there. The dialog
            would read "spends gas on Polygon" above a success line for a Sepolia deployment, with
            the Deploy button permanently disabled by `completed` and nothing on screen to say why.
            A remount is the whole fix: none of those three values describes anything that is still
            true after the chain moves, and there is nothing in this component worth preserving
            across one — no fetch, no accumulated input, and never an in-flight send, since a carry
            cannot happen while one is (the selector is disabled for exactly that window). */}
        {/* Why nothing happened. Rendered whenever the grid was refused, and it outlives nothing:
            the deploy it names is the open selection, so dismissing it changes no state at all. */}
        <DeployInProgressDialog
          open={blockedByDeploy !== undefined && selection !== undefined}
          address={selection?.candidate.address ?? ''}
          onOpenChange={(next) => {
            if (!next) setBlockedByDeploy(undefined)
          }}
          onView={() => {
            setBlockedByDeploy(undefined)
            // Straight to the deploy the refusal was about, whether it was behind the pill or
            // already on screen.
            setMinimised(undefined)
          }}
        />
        {selection && (
          <DeployDialog
            key={`${selection.candidate.address}:${selection.config.chainId}`}
            open={minimised !== selection}
            candidate={selection.candidate}
            config={selection.config}
            onOpenChange={(next) => {
              if (next) {
                // The header pill, asking for the dialog it stands in for back.
                setMinimised(undefined)
                return
              }
              if (deployRunning) {
                // A deploy is still running and nothing can recall it, so this is not a close but
                // a step back from it: the selection stays, which keeps THIS component mounted and
                // its status, transaction and outcome with it, and the pill it portals into the
                // header is what brings it back. Mining is still handed over and the URL still
                // stops naming a dialog that is not on screen — both of those are about what the
                // user can see and do now, and neither is what was being thrown away.
                setMinimised(selection)
                abandonDeploy()
                dropSelectionUrl()
                return
              }
              // Nothing outstanding: clears the selection, hands mining back and pushes the base
              // URL over the one naming this result, so the address bar never names a dialog that
              // is no longer on screen — and this result stays one Back away.
              closeSelection()
            }}
            onDeployStart={beginDeploy}
            onDeploySettled={settleDeploy}
            onPhaseChange={setDeployPhase}
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
