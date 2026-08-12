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

const DISPLAY_COUNT = 8

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
   * not merely selecting a candidate: confirming in the wallet is the one moment a user must
   * read an address carefully, and the grid above must not keep re-sorting itself underneath
   * it. Inspecting a result leaves mining running. The already-mined leaderboard stays visible
   * and selectable — including the row that is currently selected — so the "Use this" flow that
   * DeployPanel's `key` fix guards against stays reachable. Toggling back to `false` resumes
   * the same run rather than permanently disabling mining: the effect below passes
   * `resume: sameRun`, which continues from `state.nextStart` and keeps both the leaderboard
   * and the cumulative scanned/elapsed totals (see use-miner's start()). A deploy that fails
   * therefore costs the user nothing — results found before it are all still there.
   */
  paused?: boolean
  /** Highlights the row the deploy panel is currently showing. Purely presentational. */
  selectedAddress?: string
  onSelect: (candidate: Candidate) => void
}

export function MiningView({
  config,
  faceSpec,
  filters,
  paused: pausedByHost = false,
  selectedAddress,
  onSelect,
}: MiningViewProps) {
  const constants = useSafeConstants(config)
  const { state, start, stop, setFilters } = useMiner()
  const [workers] = useState(() => Math.max(1, (navigator.hardwareConcurrency || 4) - 1))
  const { twoColor, minContrast } = filters
  // The status bar's Pause control. Kept here rather than in the page because it is a mining
  // concern, and because it must combine with the host's own reasons to pause (a deploy in
  // flight, a share link still being reconstructed) rather than fight them.
  const [pausedByUser, setPausedByUser] = useState(false)
  const paused = pausedByHost || pausedByUser
  // While the host is the one pausing, the bar necessarily reads "Resume" — and the only honest
  // meaning a click can have then is "run as soon as you are allowed to", never "and also pause
  // again on my behalf". Treating it as a plain toggle would set `pausedByUser` from a click that
  // changed nothing on screen, so mining would stay stopped once the host's reason cleared and
  // the user would have to press Resume a second time with no explanation. Disabling the control
  // instead would be honest but dead; this way the click always moves toward running.
  const togglePause = () => setPausedByUser(pausedByHost ? false : !pausedByUser)

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

  // Identifies "the same run" across a pause/resume cycle: constants/faceSpec/workers are
  // exactly the inputs that genuinely invalidate a run in progress (see below), so if none of
  // them changed since the last time this effect actually started mining, un-pausing is a
  // resume of that run rather than a fresh one. Left untouched while paused, so a config/face
  // change made while paused (e.g. via FacePicker, still visible next to a selected result) is
  // correctly detected as "different" once mining resumes.
  const runIdentityRef = useRef<{ data: unknown; faceSpec: FaceSpec; workers: number } | null>(null)

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
      runIdentityRef.current.data === constants.data &&
      runIdentityRef.current.faceSpec === faceSpec &&
      runIdentityRef.current.workers === workers
    runIdentityRef.current = { data: constants.data, faceSpec, workers }

    start({
      constantsHex: constants.data.constantsHex,
      faceSpec,
      workers,
      keep: DISPLAY_COUNT,
      twoColor,
      minContrast,
      resume: sameRun,
      start: sameRun ? state.nextStart : undefined,
    })
    return stop
  }, [constants.data, faceSpec, start, stop, workers, paused])

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

  if (constants.loading)
    return <p className="text-sm text-muted-foreground">Reading Safe constants…</p>
  if (constants.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not read Safe constants: {constants.error}</AlertDescription>
      </Alert>
    )

  // The board is score-ranked, so the head of it is the best candidate found so far.
  const best = state.candidates[0]
  const status: MiningStatus = {
    running: state.running,
    paused,
    scanned: state.scanned,
    rate: state.rate,
    workers,
    elapsedMs: state.elapsedMs,
    bestScore: best?.score,
    bestMaxScore: best?.maxScore,
  }
  const statusBar = <MiningStatusBar status={status} onPauseToggle={togglePause} />

  return (
    <>
      {statusBarSlot ? createPortal(statusBar, statusBarSlot) : statusBar}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Results</h2>
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <ResultsGrid
          candidates={state.candidates}
          selectedAddress={selectedAddress}
          droppedCount={state.droppedCount}
          mining={state.running}
          onSelect={onSelect}
        />
        <CliHandoff
          config={config}
          rpcUrl={chainById(config.chainId).rpcUrls.default.http[0]}
          filters={filters}
        />
      </section>
    </>
  )
}
