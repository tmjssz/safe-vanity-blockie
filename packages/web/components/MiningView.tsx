'use client'

import type { Candidate, FaceSpec } from '@safe-vanity-blockie/core'
import { ArrowDownUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import type { FaceFilters, MineConfig } from '../lib/config'
import { type ResultSort, useMiner } from '../lib/use-miner'
import { useSafeConstants } from '../lib/use-safe-constants'
import { chainById } from '../lib/wagmi'
import { useWorkerCount } from '../lib/worker-count'
import { useRegisterStartOver } from './AppTitle'
import { CliHandoff } from './CliHandoff'
import { MINING_STATUS_BAR_SLOT_ID, type MiningStatus, MiningStatusBar } from './MiningStatusBar'
import { ResultsGrid } from './ResultsGrid'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

/**
 * How many candidates the leaderboard keeps. Every one of them that survives the two-colour,
 * contrast and match filters is shown — the grid scrolls rather than truncating — so this is a
 * retention size only, not a display cap. It has to be far deeper than anyone would scroll because
 * retention is score-ranked and filter-blind: a strict floor needs a deep pool to find anything in
 * at all. 200 is what this screen has effectively retained all along.
 */
const RETAINED_COUNT = 200

/**
 * The orders offered beside the Results heading, and the words for them. Best match leads because
 * it is what the run is for: the leaderboard exists to find the closest face, and any other
 * default would hide that behind an ordering nobody asked for.
 */
const SORT_OPTIONS: { value: ResultSort; label: string }[] = [
  { value: 'best', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
  { value: 'contrast', label: 'Contrast' },
]

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
  /**
   * Throws the run away and brings the Configure card back. Owned by the page, which is what
   * unmounts this component; the bar only asks (and confirms first, when there is something to
   * lose).
   */
  onStartOver: () => void
  /**
   * The Safe currently being deployed, if any, so its tile can say so. Owned by the page, which is
   * where the deploy dialog and its state live.
   */
  deployingAddress?: string
  /**
   * Asks the page to show the filter controls, for the grid's empty state to offer when the
   * filters have excluded everything. Owned by the page for the same reason `onPauseToggle` is:
   * the Filter card lives in a sibling subtree this component cannot reach. Optional, so a bare
   * `<MiningView />` renders a panel that explains itself and offers no button it cannot honour.
   */
  onAdjustFilters?: () => void
  /** Called with the candidate whose card was clicked; the page opens the deploy dialog for it. */
  onSelect: (candidate: Candidate) => void
  /**
   * Where a FRESH run begins. A resume ignores it and continues from `state.nextStart` instead —
   * that is the difference between "where the user asked the search to start" and "how far this
   * search has got", and conflating them makes every pause rescan the ground since the start.
   *
   * It cannot change while this component is mounted: the Configure card that sets it is unmounted
   * for the whole run, and the only route back to it unmounts this. It is in the run identity and
   * the effect deps anyway, because a different start IS a different search, and a value that
   * silently failed to take effect would be worse than a restart nobody can provoke.
   */
  startFrom?: number
}

export function MiningView({
  config,
  faceSpec,
  filters,
  paused = false,
  onPauseToggle,
  onStartOver,
  deployingAddress,
  onAdjustFilters,
  onSelect,
  startFrom = 0,
}: MiningViewProps) {
  const constants = useSafeConstants(config)
  const { state, start, stop, setFilters, setSort } = useMiner()
  // Held here rather than in the hook so the trigger has something to display, and pushed down the
  // same way the filters are. The hook applies it: it holds the arrival numbers "Newest" needs,
  // and re-ordering there costs no mining progress.
  const [sort, setSortMode] = useState<ResultSort>('best')
  const workers = useWorkerCount()
  const { twoColor, minContrast, minMatch } = filters
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

  // Makes the app title in the header the second door back to the Configure card, for exactly as
  // long as this component is mounted — which is exactly as long as there is a run to discard.
  // It is registered from here for the same reason the status bar is rendered from here: the
  // count the confirmation names and the reset it calls both live at this level. Unmounting on
  // "Start over" is what puts the title back to plain text, so neither side keeps a flag.
  useRegisterStartOver(state.candidates.length, onStartOver)

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
    startFrom: number
  } | null>(null)

  // Restart only on what genuinely invalidates the run in progress. twoColor/minContrast/minMatch
  // are deliberately excluded: they're a display filter over already-mined candidates, not
  // something that requires re-mining, and restarting on every step of the contrast or match
  // slider would discard all progress found so far (see the effect below, which re-filters
  // instead).
  //
  // `paused` toggling to true re-runs this effect, whose cleanup (`stop`) fires for the run that
  // was in progress, then the body returns early instead of starting a new one — so pausing
  // stops the live run without terminating the worker pool. Toggling back to false resumes that
  // same run (continuing from `state.nextStart`, keeping the leaderboard) when nothing else
  // changed, or starts fresh if constants/faceSpec/workers changed while paused.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: twoColor, minContrast, minMatch, and state.nextStart are deliberately excluded — see the comment above. Adding them restarts the miner and discards progress.
  useEffect(() => {
    if (!constants.data) return
    if (paused) return

    const sameRun =
      runIdentityRef.current !== null &&
      runIdentityRef.current.initializerHash === initializerHash &&
      runIdentityRef.current.factory === factory &&
      runIdentityRef.current.initCodeHash === initCodeHash &&
      runIdentityRef.current.faceSpec === faceSpec &&
      runIdentityRef.current.workers === workers &&
      runIdentityRef.current.startFrom === startFrom
    runIdentityRef.current = {
      initializerHash,
      factory,
      initCodeHash,
      faceSpec,
      workers,
      startFrom,
    }

    start({
      constantsHex: constants.data.constantsHex,
      faceSpec,
      workers,
      retain: RETAINED_COUNT,
      twoColor,
      minContrast,
      minMatch,
      resume: sameRun,
      // A resume continues from where the run reached; anything else is a fresh run, and a fresh
      // run begins where the user asked. That covers the chain crossing too: it changes the
      // constants, so it takes this branch and restarts at the configured start rather than at 0.
      start: sameRun ? state.nextStart : startFrom,
    })
    return stop
  }, [initializerHash, factory, initCodeHash, faceSpec, start, stop, workers, paused, startFrom])

  // Applies a filter change to the already-mined leaderboard without touching the worker pool.
  useEffect(() => {
    setFilters({ twoColor, minContrast, minMatch })
  }, [twoColor, minContrast, minMatch, setFilters])

  // Same shape, and pushed on mount as well as on a change: the control and the order the grid is
  // actually in cannot be allowed to disagree, and the hook's own default is not this component's
  // to assume.
  useEffect(() => {
    setSort(sort)
  }, [sort, setSort])

  // A worker failure (crash, WASM blocked, unreadable message — see use-miner's onerror /
  // onmessageerror) is transient feedback worth surfacing immediately, but the toast fades on
  // its own timer. The `role="alert"` rendered below stays on screen for as long as the error
  // is current, so the toast is additive, not a replacement for it.
  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  // Hoisted so the loading state below can render the same row. The heading is not a report on
  // the run the way the status bar is — it names the part of the page the results occupy, and
  // that part is there before the first one arrives. Rendering placeholders under nothing at
  // all left the tiles floating unlabelled, and then dropped a title in above them the moment
  // mining started, pushing the whole grid down to make room for it.
  //
  // The badge counts the cards below it — what the eye can check — and replaces the muted
  // "N filtered out" line that used to sit above the grid. This heading is a bare <h2>, not a
  // CardHeader, so a flex row is the right way to put something beside it; CardAction is for the
  // grid-based CardHeader.
  //
  // The badge is shown only once there is something real to count. While the grid is still looking
  // it holds four skeleton placeholders, and a badge reading "0" over four visible boxes is the
  // one state in which its claim to count what is on screen would be false — counting the
  // placeholders would be worse, since they are not results. `droppedCount` is what distinguishes
  // "nothing found yet" from "nothing survived the filters": in the second case there are
  // deliberately no cards, the zero is the point, and it says the same thing as the empty state
  // directly below it.
  const resultsHeading = (
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
      {/* Both controls in the heading row, on the right. The sort belongs to the grid below it
        and nothing else, and the handoff has to be reachable without scrolling past two
        hundred results; a row of their own between the heading and the grid would push the
        first tiles down the screen to say so.

        Shown only once there is something to order — a control that reorders nothing is
        furniture to be read past. */}
      <div className="ml-auto flex items-center gap-2">
        {state.candidates.length > 0 && (
          <>
            {/* "Best match" on its own, sitting beside a heading, reads as a status rather
              than as something to press — so something has to mark it as an order being
              chosen. A glyph rather than the word "Sort:" it replaces: this row is a
              heading, a count, this control and the CLI handoff on one line, and the label
              was the only text on it that named a control instead of saying something. The
              two opposing arrows carry the same meaning at a glance and give the row its
              width back.

              Hidden from assistive tech, which gets the word — and a clearer one — from the
              trigger's own name just below. An icon that replaces a label must not become
              the label: the accessible name was never coming from here. */}
            <ArrowDownUp
              data-slot="results-sort-icon"
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <Select value={sort} onValueChange={(next) => setSortMode(next as ResultSort)}>
              {/* Named rather than captioned, as the chain picker is: there is no room for a
                real field label here, and the trigger already shows the order as its
                value. */}
              <SelectTrigger id="results-sort" size="sm" aria-label="Sort results">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {/* `target` and `filters` go with it so the copied command enforces the same standard as
          the screen rather than the CLI's own defaults — which, for the expressions, means all
          five of them whatever this run was narrowed to. The FaceSpec's name IS its `--target`
          (see lib/face-selection), so the run on screen and the command that reproduces it cannot
          name different targets. */}
        <CliHandoff
          config={config}
          rpcUrl={chainById(config.chainId).rpcUrls.default.http[0]}
          target={faceSpec.name}
          filters={filters}
          // Offered only once something has been scanned, and both halves together: `nextStart`
          // is only a resume point because a worker reported reaching it.
          resume={state.scanned > 0 ? { start: state.nextStart, workers } : undefined}
        />
      </div>
    </div>
  )

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
    // The heading and the placeholders, and nothing else. This was a lone line of text reading
    // "Reading Safe constants…" — the first thing anyone saw on a fresh run — and it named an
    // internal step (an RPC read of factory and singleton addresses) that means nothing to the
    // person waiting and that they cannot act on either way. The placeholders say the one thing
    // worth saying, which is that results are coming and where they will land, and they are the
    // same ones mining shows once it is under way, so the wait is one continuous state rather
    // than a sentence that becomes a grid.
    //
    // The heading comes with them because it titles the part of the page, not the run: without it
    // the tiles sat unlabelled and a title then appeared above them the moment mining began,
    // pushing the grid down. Its badge and sort hide themselves while there is nothing to count or
    // order, so the row is the same row throughout, gaining pieces rather than being replaced.
    //
    // Still no status bar: that one does report the run, and there is no run yet — which is the
    // whole reason this arm exists.
    if (constants.loading)
      return (
        <section className="flex flex-col gap-4">
          {resultsHeading}
          <ResultsGrid
            candidates={[]}
            droppedCount={0}
            mining={false}
            preparing
            filters={filters}
            onSelect={onSelect}
          />
        </section>
      )
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
    nextStart: state.nextStart,
  }
  const statusBar = (
    <MiningStatusBar
      status={status}
      config={config}
      // The same number the Results badge shows, so the confirmation puts exactly what the user
      // can see at stake rather than a different, larger count they have no way to check.
      resultCount={state.candidates.length}
      onPauseToggle={onPauseToggle}
      onStartOver={onStartOver}
    />
  )

  return (
    <>
      {statusBarSlot ? createPortal(statusBar, statusBarSlot) : statusBar}
      <section className="flex flex-col gap-4">
        {resultsHeading}
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
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <ResultsGrid
          candidates={state.candidates}
          droppedCount={state.droppedCount}
          mining={state.running}
          // The re-read window on the retry-after-failure path: a run is on screen, so the early
          // return above does not apply and this grid is what the user is looking at. There used
          // to be a "Reading Safe constants…" line here too; the placeholders replace it, and
          // without them the grid said "No results yet." — a finished search that found nothing,
          // over a run that was about to resume.
          preparing={constants.loading && !constants.data}
          filters={filters}
          bestContrast={state.bestContrast}
          deployingAddress={deployingAddress}
          // Only this grid gets it. The `preparing` grid above hardcodes `droppedCount={0}`, so it
          // cannot reach the empty state the button belongs to — nothing has been scored yet there.
          onAdjustFilters={onAdjustFilters}
          onSelect={onSelect}
        />
      </section>
    </>
  )
}
