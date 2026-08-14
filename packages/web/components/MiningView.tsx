'use client'

import type { Candidate, FaceSpec } from '@safe-vanity-blockie/core'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import type { FaceFilters, MineConfig } from '../lib/config'
import { useMiner } from '../lib/use-miner'
import { useSafeConstants } from '../lib/use-safe-constants'
import { chainById } from '../lib/wagmi'
import { CliHandoff } from './CliHandoff'
import { MINING_STATUS_BAR_SLOT_ID, type MiningStatus, MiningStatusBar } from './MiningStatusBar'
import { ResultsGrid } from './ResultsGrid'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

/**
 * How many candidates the leaderboard keeps. Every one of them that survives the two-colour and
 * contrast filters is shown — the grid scrolls rather than truncating — so this is a retention
 * size only, not a display cap. It has to be far deeper than anyone would scroll because
 * retention is score-ranked and filter-blind: a strict contrast floor needs a deep pool to find
 * anything in at all. 200 is what this screen has effectively retained all along.
 */
const RETAINED_COUNT = 200

// The status bar has to sit above the caveat and both sections — it is the one thing that must
// stay in view during a long search — but the mining state that feeds it is owned here, next to
// the results. So it is rendered here and portaled into the slot the page mounts at the top
// (MINING_STATUS_BAR_SLOT_ID). That keeps per-tick progress state out of the page, which would
// otherwise re-render Configure, Face and Deploy several times a second for nothing.
//
// If no such element is mounted (a bare `<MiningView />`, as in its unit tests) the bar renders
// in place instead.

export interface MiningViewProps {
  config: MineConfig
  faceSpec: FaceSpec
  filters: FaceFilters
  /**
   * Stops mining without unmounting. The trigger is the deploy step — the transaction itself,
   * not merely clicking a card to open its deploy dialog: confirming in the wallet is the one
   * moment a user must read an address carefully, and the grid above must not keep re-sorting
   * itself underneath it. Inspecting a result leaves mining running. The already-mined
   * leaderboard stays visible and clickable, so closing the dialog puts the user straight back
   * on a live grid with every card still openable. Toggling back to `false` resumes
   * the same run rather than permanently disabling mining: the effect below passes
   * `resume: sameRun`, which continues from `state.nextStart` and keeps both the leaderboard
   * and the cumulative scanned/elapsed totals (see use-miner's start()). A deploy that fails
   * therefore costs the user nothing — results found before it are all still there.
   */
  paused?: boolean
  /**
   * Halts or resumes on the user's behalf. The state behind it lives in the page, because the
   * Configure card offers the same action from a different subtree — see `pausedByUser` there.
   * This component renders one of the two controls; it no longer owns what they both read.
   */
  onPauseToggle: () => void
  /** Called with the candidate whose card was clicked; the page opens the deploy dialog for it. */
  onSelect: (candidate: Candidate) => void
}

export function MiningView({
  config,
  faceSpec,
  filters,
  paused = false,
  onPauseToggle,
  onSelect,
}: MiningViewProps) {
  const constants = useSafeConstants(config)
  const { state, start, stop, setFilters } = useMiner()
  const [workers] = useState(() => Math.max(1, (navigator.hardwareConcurrency || 4) - 1))
  const { twoColor, minContrast } = filters
  // `paused` arrives already merged: the host's reasons (a deploy in flight, a share link being
  // reconstructed) and the user's own stop are combined in the page, which is where the second
  // control for the latter lives. Nothing about pausing is decided here any more.

  // Resolved during the first render in the browser: the page commits the slot element before
  // this component ever mounts (it only appears once a config is submitted), so there is no
  // frame in which the bar renders in the wrong place. The effect is the fallback for any order
  // of mounting that first render cannot see.
  const [statusBarSlot, setStatusBarSlot] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.getElementById(MINING_STATUS_BAR_SLOT_ID),
  )
  useEffect(() => {
    setStatusBarSlot(document.getElementById(MINING_STATUS_BAR_SLOT_ID))
  }, [])

  // The three constants a worker actually mines with, as values. Everything below keys off these
  // rather than off `constants.data`, and that is the whole reason a chain switch is free.
  //
  // `useSafeConstants` re-reads whenever the config object changes, which the header's chain
  // picker does under a live search; for the six chains that share a Safe singleton the read
  // comes back EQUAL IN VALUE but as a new object. Keyed on the object, the effect below would
  // treat that as a different run, tear the pool down and empty a leaderboard whose addresses are
  // every bit as valid as they were — the exact opposite of what switching chains promises. Keyed
  // on the values, the switch does not even re-run the effect: the run is untouched, and a switch
  // that genuinely does change the constants (the mainnet boundary) still restarts, because then
  // these strings really do change.
  //
  // The values are also precisely what is handed to `start()` below — nothing else in `data`
  // reaches a worker — so this is the honest identity of a run, not a cheaper approximation of it.
  const { initializerHash, factory, initCodeHash } = constants.data?.constantsHex ?? {}

  // Identifies "the same run" across a pause/resume cycle: the constants/faceSpec/workers are
  // exactly the inputs that genuinely invalidate a run in progress (see below), so if none of
  // them changed since the last time this effect actually started mining, un-pausing is a
  // resume of that run rather than a fresh one. Left untouched while paused, so a config/face
  // change made while paused (e.g. via FacePicker, still visible next to a selected result) is
  // correctly detected as "different" once mining resumes.
  const runIdentityRef = useRef<{
    initializerHash?: string
    factory?: string
    initCodeHash?: string
    faceSpec: FaceSpec
    workers: number
  } | null>(null)

  // Restart only on what genuinely invalidates the run in progress. twoColor/minContrast are
  // deliberately excluded: they're a display filter over already-mined candidates, not
  // something that requires re-mining, and restarting on every keystroke in the contrast field
  // would discard all progress found so far (see the effect below, which re-filters instead).
  //
  // `paused` toggling to true re-runs this effect, whose cleanup (`stop`) fires for the run that
  // was in progress, then the body returns early instead of starting a new one — so pausing
  // stops the live run without terminating the worker pool. Toggling back to false resumes that
  // same run (continuing from `state.nextStart`, keeping the leaderboard) when nothing else
  // changed, or starts fresh if constants/faceSpec/workers changed while paused.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: twoColor, minContrast, and state.nextStart are deliberately excluded — see the comment above. Adding them restarts the miner and discards progress.
  useEffect(() => {
    if (!constants.data) return
    if (paused) return

    const sameRun =
      runIdentityRef.current !== null &&
      runIdentityRef.current.initializerHash === initializerHash &&
      runIdentityRef.current.factory === factory &&
      runIdentityRef.current.initCodeHash === initCodeHash &&
      runIdentityRef.current.faceSpec === faceSpec &&
      runIdentityRef.current.workers === workers
    runIdentityRef.current = { initializerHash, factory, initCodeHash, faceSpec, workers }

    start({
      constantsHex: constants.data.constantsHex,
      faceSpec,
      workers,
      retain: RETAINED_COUNT,
      twoColor,
      minContrast,
      resume: sameRun,
      start: sameRun ? state.nextStart : undefined,
    })
    return stop
  }, [initializerHash, factory, initCodeHash, faceSpec, start, stop, workers, paused])

  // Applies a filter change to the already-mined leaderboard without touching the worker pool.
  useEffect(() => {
    setFilters({ twoColor, minContrast })
  }, [twoColor, minContrast, setFilters])

  // A worker failure (crash, WASM blocked, unreadable message — see use-miner's onerror /
  // onmessageerror) is transient feedback worth surfacing immediately, but the toast fades on
  // its own timer. The `role="alert"` rendered below stays on screen for as long as the error
  // is current, so the toast is additive, not a replacement for it.
  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  // Whether this component has a run on screen to protect.
  //
  // Both constants states below used to REPLACE everything this component renders, which is right
  // while there is nothing yet and wrong the moment there is. The chain picker can provoke a
  // re-read under a live search — a state that could not exist before, since the config could only
  // change at submit — and these are unauthenticated public RPCs, so a rate-limited read is an
  // ordinary event. Replacing the screen then takes the status bar, the scanned count and every
  // card away and says the search is gone, while the run is in fact completely intact: the
  // leaderboard, the cumulative totals and the resume point are all still in useMiner, and a
  // successful re-read resumes from `state.nextStart` with the board kept. The likely response to
  // a screen that says otherwise is a reload, which is the one thing that really does lose it.
  //
  // `scanned`/`candidates` rather than a "has ever started" ref, because what matters is exactly
  // what a user would lose from the screen: a run that has reported nothing yet has nothing to
  // protect, and the full-screen treatment is still the right one for it.
  const runOnScreen = state.scanned > 0 || state.candidates.length > 0
  if (!runOnScreen) {
    if (constants.loading)
      return <p className="text-sm text-muted-foreground">Reading Safe constants…</p>
    if (constants.error)
      return (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>Could not read Safe constants: {constants.error}</span>
            <Button type="button" variant="outline" size="sm" onClick={constants.reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )
  }

  // `bestOverall`, never `state.candidates[0]`: the bar reports the run, and `candidates` is the
  // filtered view. Reading the head of that list made the bar say "No candidates yet" the moment a
  // contrast floor excluded everything — directly above an empty state explaining that hundreds
  // had been found and excluded — and threw away the only live signal of search quality exactly
  // when the user needs it to decide where to put the slider.
  const status: MiningStatus = {
    running: state.running,
    paused,
    scanned: state.scanned,
    rate: state.rate,
    workers,
    elapsedMs: state.elapsedMs,
    bestScore: state.bestOverall?.score,
    bestMaxScore: state.bestOverall?.maxScore,
  }
  const statusBar = <MiningStatusBar status={status} onPauseToggle={onPauseToggle} />

  return (
    <>
      {statusBarSlot ? createPortal(statusBar, statusBarSlot) : statusBar}
      <section className="flex flex-col gap-4">
        {/* The badge counts the cards below it — what the eye can check — and replaces the muted
            "N filtered out" line that used to sit above the grid. This heading is a bare <h2>, not
            a CardHeader, so a flex row is the right way to put something beside it; CardAction is
            for the grid-based CardHeader.

            Shown only once there is something real to count. While the grid is still looking it
            holds four skeleton placeholders, and a badge reading "0" over four visible boxes is
            the one state in which its claim to count what is on screen would be false — counting
            the placeholders would be worse, since they are not results. `droppedCount` is what
            distinguishes "nothing found yet" from "nothing survived the filters": in the second
            case there are deliberately no cards, the zero is the point, and it says the same thing
            as the empty state directly below it. */}
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Results</h2>
          {(state.candidates.length > 0 || state.droppedCount > 0) && (
            <Badge variant="secondary" data-testid="results-count">
              {state.candidates.length.toLocaleString('en-US')}
              {/* Sighted readers get the number from the heading it sits against. A screen reader
                  meets it as a bare figure, so the unit rides along visually hidden — not as an
                  aria-label, which a <span> in the generic role is not guaranteed to expose. */}
              <span className="sr-only"> results shown</span>
            </Badge>
          )}
        </div>
        {/* The other side of `runOnScreen` above: with a run to protect, a constants failure is
            reported here, INSIDE the results section, so the bar above and every card below it stay
            exactly where they are. It says what was lost (the read, and mining with it) and what
            was not (everything on screen), and it offers the retry — which resumes the same run
            from where it stopped, because nothing about the run was thrown away. */}
        {constants.error && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>
                Could not read Safe constants for this chain: {constants.error}. Mining has stopped,
                but every result below is still here. Retry, or pick a chain that answers.
              </span>
              <Button type="button" variant="outline" size="sm" onClick={constants.reload}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {/* Same window, before it has failed or succeeded: a re-read with no constants left to fall
            back on (i.e. a retry after a failure — an ordinary switch keeps the previous ones and
            never lands here). Inline, for the same reason. */}
        {constants.loading && !constants.data && (
          <p className="text-sm text-muted-foreground">Reading Safe constants…</p>
        )}
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        {/* Above the grid, not below it: it is an alternative to the search that is running, so
            it has to be readable before scrolling past the whole leaderboard — and `filters`
            goes with it so the copied command enforces the same standard as the screen rather
            than the CLI's own defaults. */}
        <CliHandoff
          config={config}
          rpcUrl={chainById(config.chainId).rpcUrls.default.http[0]}
          filters={filters}
        />
        <ResultsGrid
          candidates={state.candidates}
          droppedCount={state.droppedCount}
          mining={state.running}
          filters={filters}
          bestContrast={state.bestContrast}
          onSelect={onSelect}
        />
      </section>
    </>
  )
}
