'use client'

import type { Candidate, FaceSpec } from '@safe-vanity-blockie/core'
import { useEffect, useRef, useState } from 'react'
import type { FaceFilters, MineConfig } from '../lib/config'
import { useMiner } from '../lib/use-miner'
import { useSafeConstants } from '../lib/use-safe-constants'
import { chainById } from '../lib/wagmi'
import { CliHandoff } from './CliHandoff'
import { ResultCard } from './ResultCard'

const DISPLAY_COUNT = 8

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
  onSelect: (candidate: Candidate) => void
}

export function MiningView({
  config,
  faceSpec,
  filters,
  paused = false,
  onSelect,
}: MiningViewProps) {
  const constants = useSafeConstants(config)
  const { state, start, stop, setFilters } = useMiner()
  const [workers] = useState(() => Math.max(1, (navigator.hardwareConcurrency || 4) - 1))
  const { twoColor, minContrast } = filters

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

  if (constants.loading) return <p>Reading Safe constants…</p>
  if (constants.error) return <p role="alert">Could not read Safe constants: {constants.error}</p>

  return (
    <section>
      <p>
        {state.scanned.toLocaleString('en-US')} nonces · {Math.round(state.rate / 1000)}k/s ·{' '}
        {workers} workers
        {state.droppedCount > 0 && ` · ${state.droppedCount} filtered out`}
      </p>
      <CliHandoff
        config={config}
        rpcUrl={chainById(config.chainId).rpcUrls.default.http[0]}
        filters={filters}
      />
      <button type="button" onClick={state.running ? stop : () => undefined}>
        {state.running ? 'Stop' : 'Stopped'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      <div className="grid">
        {state.candidates.map((candidate) => (
          <ResultCard key={candidate.address} candidate={candidate} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}
