'use client'

import type { Candidate, FaceSpec } from '@safe-vanity-blockie/core'
import { useEffect, useState } from 'react'
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
  onSelect: (candidate: Candidate) => void
}

export function MiningView({ config, faceSpec, filters, onSelect }: MiningViewProps) {
  const constants = useSafeConstants(config)
  const { state, start, stop, setFilters } = useMiner()
  const [workers] = useState(() => Math.max(1, (navigator.hardwareConcurrency || 4) - 1))
  const { twoColor, minContrast } = filters

  // Restart only on what genuinely invalidates the run in progress. twoColor/minContrast are
  // deliberately excluded: they're a display filter over already-mined candidates, not
  // something that requires re-mining, and restarting on every keystroke in the contrast field
  // would discard all progress found so far (see the effect below, which re-filters instead).
  useEffect(() => {
    if (!constants.data) return
    start({
      constantsHex: constants.data.constantsHex,
      faceSpec,
      workers,
      keep: DISPLAY_COUNT,
      twoColor,
      minContrast,
    })
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constants.data, faceSpec, start, stop, workers])

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
      <CliHandoff config={config} rpcUrl={chainById(config.chainId).rpcUrls.default.http[0]} />
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
