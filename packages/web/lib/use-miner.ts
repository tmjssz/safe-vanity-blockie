'use client'

import {
  type Candidate,
  type FaceSpec,
  Leaderboard,
  scorePercent,
  selectReported,
} from '@safe-vanity-blockie/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  nextStartFrom,
  planWorkerRanges,
  WORKER_BLOCK,
  type WorkerEvent,
  type WorkerRequest,
} from './worker-protocol'

export interface StartMiningInput {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  workers: number
  /**
   * How many candidates the leaderboard keeps, and the only size this hook has: everything
   * retained that survives the filters is reported, so there is no display cap riding on this
   * number. Retention is score-ranked and blind to the two-colour, contrast and match filters,
   * which are applied afterwards, so it has to be far deeper than a user would ever look at — a
   * strict filter has nothing left to choose from. It is also what `keep` means to a worker (see
   * the start request below): the worker's own retention, never a display count.
   */
  retain: number
  twoColor: boolean
  minContrast: number
  minMatch: number
  start?: number
  /**
   * Continues the existing run instead of starting a fresh one: keeps the current leaderboard
   * and cumulative scanned/elapsed totals rather than discarding them, and expects `start` to be
   * the resume point (normally the previous run's `nextStart`) so nothing already covered gets
   * rescanned. Ignored (treated as a fresh start) if there is no existing board to resume — e.g.
   * the very first call.
   */
  resume?: boolean
}

export interface MinerState {
  running: boolean
  scanned: number
  elapsedMs: number
  rate: number
  candidates: Candidate[]
  droppedCount: number
  /**
   * The best candidate the run has retained, ranked by score alone and blind to the filters —
   * the head of the leaderboard rather than of `candidates`. The status bar reads this: with the
   * fallback off, a contrast floor nothing clears empties `candidates`, and a bar deriving its
   * best score from that list would answer a filter change with "No candidates yet" directly
   * above an empty state explaining that hundreds had been found and excluded. It is also the
   * one live signal of how well the search is going, which must not go out with the filters.
   */
  bestOverall?: Candidate
  /**
   * The highest contrast among retained candidates that pass every filter *except* the contrast
   * floor — i.e. how close the search has come to satisfying it. Reported only when nothing is
   * being shown, since that is the only time it says anything the grid does not already show, and
   * undefined when not even the two-colour filter leaves a candidate to measure.
   */
  bestContrast?: number
  error?: string
  nextStart: number
}

const IDLE: MinerState = {
  running: false,
  scanned: 0,
  elapsedMs: 0,
  rate: 0,
  candidates: [],
  droppedCount: 0,
  nextStart: 0,
}

/**
 * The instant the current segment's active mining ends: the moment scanning was stopped if it has
 * been stopped since the segment began, otherwise now. Everything that measures elapsed time reads
 * this rather than `Date.now()` directly, so wall-clock time spent paused counts for nothing — a
 * pause must neither inflate the elapsed total when the run resumes nor let a re-publish during
 * the pause (a filter change, a late `done` message) tick the clock forward.
 *
 * A `stoppedAt` older than `startedAt` — including the initial 0 — means this segment has not been
 * stopped, so it is still running and ends now.
 */
function activeUntil(startedAt: number, stoppedAt: number): number {
  return stoppedAt >= startedAt ? stoppedAt : Date.now()
}

export interface LiveFilters {
  twoColor: boolean
  minContrast: number
  /** Percentage floor on the match score, 0-100. 0 filters nothing. */
  minMatch: number
}

/**
 * How the grid orders what it shows. A display concern in the same sense the filters are: the
 * leaderboard is score-ranked and untouched by either, so re-ordering costs no mining progress.
 *
 * - `best`     the leaderboard's own ranking (score, then two-colour, then contrast)
 * - `newest`   most recently accepted onto the board first
 * - `contrast` highest colour contrast first
 */
export type ResultSort = 'best' | 'newest' | 'contrast'

/**
 * Orders the reported list for display.
 *
 * `reported` arrives in leaderboard order, and every arm below is a stable sort over it, so ties
 * fall back to the ranking the user would otherwise be looking at rather than to an arbitrary
 * order that shuffles between publishes.
 *
 * `newest` reads arrival numbers rather than saltNonces. A nonce cannot stand in for a discovery
 * time: the workers scan disjoint ranges in parallel, so a high nonce is not a late find.
 */
function orderForDisplay(
  reported: Candidate[],
  sort: ResultSort,
  arrival: Map<string, number>,
): Candidate[] {
  if (sort === 'best') return reported
  if (sort === 'contrast') return [...reported].sort((a, b) => b.contrast - a.contrast)
  return [...reported].sort((a, b) => (arrival.get(b.address) ?? 0) - (arrival.get(a.address) ?? 0))
}

/**
 * How close the retained pool came to clearing the contrast floor. Measured over the candidates
 * the *other* filters accept — a three-colour result with enormous contrast would otherwise
 * advertise a floor that still matches nothing once two-colour is on, and so would one the match
 * floor is rejecting anyway. Undefined when no candidate survives those other filters at all,
 * because then contrast is not what is excluding things.
 */
function bestContrastOf(candidates: Candidate[], filters: LiveFilters): number | undefined {
  let best: number | undefined
  for (const candidate of candidates) {
    if (filters.twoColor && !candidate.twoColor) continue
    if (scorePercent(candidate.score, candidate.maxScore) < filters.minMatch) continue
    if (best === undefined || candidate.contrast > best) best = candidate.contrast
  }
  return best
}

export function useMiner(): {
  state: MinerState
  start: (input: StartMiningInput) => void
  stop: () => void
  setFilters: (filters: LiveFilters) => void
  setSort: (sort: ResultSort) => void
} {
  const [state, setState] = useState<MinerState>(IDLE)
  const workersRef = useRef<Worker[]>([])
  const scannedRef = useRef<number[]>([])
  const boardRef = useRef<Leaderboard | undefined>(undefined)
  const startedAtRef = useRef(0)
  // When scanning last stopped, so that a pause is not billed as active mining time. 0 (or any
  // stamp older than the current segment's start) means "no stop since this segment began" — a
  // start() with no intervening stop(), e.g. a config change while still running.
  const stoppedAtRef = useRef(0)
  const liveRef = useRef(0)
  // Cumulative scanned count / active-mining time from segments before the current one. A
  // "segment" ends whenever start() is called again (pause or a fresh run); on resume these
  // fold the ending segment's numbers in instead of losing them, so pausing to inspect a result
  // and resuming does not reset the displayed scanned count or rate back to zero. Reset to 0 on
  // a genuinely fresh start.
  const priorScannedRef = useRef(0)
  const priorElapsedRef = useRef(0)
  // Filters are a display concern: retention (StartMiningInput.retain above) is
  // score-ranked and filter-blind, so re-filtering never needs to touch the worker pool or
  // discard mining progress. `publish` (defined fresh inside every start()) reads this ref
  // rather than a value captured by the start() closure, so `setFilters` below can change what
  // gets shown without restarting anything.
  const filtersRef = useRef<LiveFilters>({ twoColor: true, minContrast: 0, minMatch: 0 })
  // Read by `publish` for the same reason the filters are: a re-order must not restart anything.
  const sortRef = useRef<ResultSort>('best')
  // Which batch of arrivals each retained address came in on, which is the only thing that can
  // answer "what just turned up?": the board is score-ranked and keeps the best `retain`, so
  // neither its order nor a candidate's saltNonce carries a discovery time. Numbers are assigned
  // in `publish` and pruned to the board's current contents there — an evicted address cannot
  // come back within a run, because the ranges already scanned are never scanned again.
  const arrivalRef = useRef(new Map<string, number>())
  const arrivalSeqRef = useRef(0)
  const publishRef = useRef<() => void>(() => {})
  // Bumped at the top of every start() and captured per-worker below. terminate() does not
  // un-queue a message a worker already dispatched, so a stale message can still arrive after
  // teardown; the handler compares its captured run id against this ref and bails out rather
  // than merge a candidate mined under a superseded config's constantsHex/faceSpec.
  const runIdRef = useRef(0)

  const teardown = useCallback(() => {
    for (const worker of workersRef.current) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    workersRef.current = []
  }, [])

  useEffect(() => teardown, [teardown])

  /**
   * Marks the moment scanning stopped. Called from every path that ends a segment — stop(), a
   * worker error, a worker that never ran, an unreadable message, and the last worker finishing
   * its range — because the elapsed clock must stop when mining stops, not when the user next
   * touches something that re-publishes.
   *
   * Only the first stop of a segment counts: a later stop() (the effect cleanup on unmount, say,
   * or Pause pressed long after a run already died) must not walk the stamp forward across the
   * idle time it exists to exclude.
   */
  const markStopped = useCallback(() => {
    if (stoppedAtRef.current < startedAtRef.current) stoppedAtRef.current = Date.now()
  }, [])

  const start = useCallback(
    (input: StartMiningInput) => {
      // Only a real resume of an existing run preserves anything — a `resume: true` with no
      // prior board (e.g. the very first call) is indistinguishable from a fresh start.
      const resuming = Boolean(input.resume) && boardRef.current !== undefined

      teardown()

      runIdRef.current += 1
      const runId = runIdRef.current

      const retain = input.retain
      const from = input.start ?? 0
      const ranges = planWorkerRanges(from, input.workers, WORKER_BLOCK)

      if (resuming) {
        // Fold the segment that just ended into the running totals instead of discarding them.
        // `boardRef.current` is left as-is (same Leaderboard instance, same entries).
        priorScannedRef.current += scannedRef.current.reduce((a, b) => a + b, 0)
        priorElapsedRef.current +=
          activeUntil(startedAtRef.current, stoppedAtRef.current) - startedAtRef.current
      } else {
        boardRef.current = new Leaderboard(retain)
        // With the board, because they name its rows: carried over, a fresh run's first finds
        // would sort below results that no longer exist.
        arrivalRef.current = new Map()
        arrivalSeqRef.current = 0
        priorScannedRef.current = 0
        priorElapsedRef.current = 0
      }

      scannedRef.current = new Array(input.workers).fill(0)
      startedAtRef.current = Date.now()
      // The stamp belonged to the segment just folded in; the new segment is running.
      stoppedAtRef.current = 0
      liveRef.current = input.workers
      filtersRef.current = {
        twoColor: input.twoColor,
        minContrast: input.minContrast,
        minMatch: input.minMatch,
      }
      setState((previous) =>
        resuming ? { ...previous, running: true, error: undefined } : { ...IDLE, running: true },
      )

      const publish = () => {
        const board = boardRef.current
        if (!board) return
        const scanned = priorScannedRef.current + scannedRef.current.reduce((a, b) => a + b, 0)
        const elapsedMs = Math.max(
          1,
          priorElapsedRef.current +
            (activeUntil(startedAtRef.current, stoppedAtRef.current) - startedAtRef.current),
        )
        const entries = board.entries()
        const arrival = arrivalRef.current
        // One number per batch of arrivals, not per candidate: everything in a single worker
        // message turned up at the same moment, and the board's own order within it is score
        // order, which is not an arrival order at all. Sharing a number leaves the stable sort in
        // orderForDisplay to fall back to the leaderboard ranking among them — so "newest" reads
        // as "the batch that just landed, best first" rather than inventing a sequence.
        let batch: number | undefined
        for (const entry of entries) {
          if (arrival.has(entry.address)) continue
          batch ??= ++arrivalSeqRef.current
          arrival.set(entry.address, batch)
        }
        // Keeps the map the size of the board rather than of everything the run ever accepted.
        if (arrival.size > entries.length) {
          const kept = new Set(entries.map((entry) => entry.address))
          for (const address of arrival.keys()) if (!kept.has(address)) arrival.delete(address)
        }
        const { reported, droppedCount } = selectReported(entries, {
          twoColor: filtersRef.current.twoColor,
          minContrast: filtersRef.current.minContrast,
          minMatch: filtersRef.current.minMatch,
          // The board holds at most `retain`, so this cap never binds: everything kept that
          // survives the filters is shown, and the grid scrolls.
          keep: retain,
          // The grid says "nothing matches these filters" for itself. Core's default — show the
          // unfiltered list rather than nothing — would make the filter look ignored instead.
          fallbackWhenEmpty: false,
        })
        setState((previous) => ({
          ...previous,
          scanned,
          elapsedMs,
          rate: (scanned / elapsedMs) * 1000,
          candidates: orderForDisplay(reported, sortRef.current, arrival),
          droppedCount,
          // Both read off `entries`, not off `reported`: the board is score-ranked and the
          // filters never touch it, so these two stay true and steady while the grid empties.
          bestOverall: entries[0],
          // Only worth computing when there is nothing to show — it exists to turn "no matches"
          // into "no matches; the best contrast found so far is 143", and it is the one number
          // that tells the user where to put the slider.
          bestContrast:
            reported.length === 0 ? bestContrastOf(entries, filtersRef.current) : undefined,
          nextStart: nextStartFrom(from, WORKER_BLOCK, scannedRef.current),
        }))
      }
      publishRef.current = publish

      workersRef.current = ranges.map((range, index) => {
        const worker = new Worker(new URL('../workers/mine.worker.ts', import.meta.url), {
          type: 'module',
        })
        worker.onmessage = (message: MessageEvent<WorkerEvent>) => {
          if (runIdRef.current !== runId) return
          const event = message.data
          if (event.type === 'error') {
            markStopped()
            setState((previous) => ({ ...previous, running: false, error: event.message }))
            teardown()
            return
          }
          scannedRef.current[index] = event.scanned
          boardRef.current?.merge(event.candidates)
          publish()
          if (event.type === 'done') {
            liveRef.current -= 1
            if (liveRef.current <= 0) {
              // The range is exhausted: this is the end of the run, and the clock stops here
              // rather than wherever the next re-publish happens to fall.
              markStopped()
              setState((previous) => ({ ...previous, running: false }))
            }
          }
        }
        // Covers a failure to run the worker module at all — a 404 on the worker chunk after a
        // redeploy, a host CSP blocking worker-src, WASM blocked — none of which reach the
        // internal try/catch in mine.worker.ts because the handler itself never starts. Without
        // this, no message ever arrives, `running` stays true forever, and the UI sits at
        // "0 nonces" with no explanation.
        worker.onerror = (event: ErrorEvent) => {
          if (runIdRef.current !== runId) return
          markStopped()
          setState((previous) => ({
            ...previous,
            running: false,
            error: `Worker failed to start: ${event.message || 'unknown error'}. Reload the page. If this persists, your browser or network may be blocking the mining worker or its WASM.`,
          }))
          teardown()
        }
        // Fires when a posted message cannot be deserialised on the other side — treated the
        // same way as onerror since either one means this worker can no longer be trusted to
        // report progress.
        worker.onmessageerror = () => {
          if (runIdRef.current !== runId) return
          markStopped()
          setState((previous) => ({
            ...previous,
            running: false,
            error: 'A message from the mining worker could not be read. Reload the page to retry.',
          }))
          teardown()
        }
        const request: WorkerRequest = {
          type: 'start',
          input: {
            constantsHex: input.constantsHex,
            faceSpec: input.faceSpec,
            start: range.start,
            count: range.count,
            keep: retain,
          },
        }
        worker.postMessage(request)
        return worker
      })
    },
    [markStopped, teardown],
  )

  const stop = useCallback(() => {
    // Record when scanning stopped before telling the workers, so the elapsed clock stops here
    // and the pause that follows is not counted as mining time (see activeUntil).
    markStopped()
    const request: WorkerRequest = { type: 'stop' }
    for (const worker of workersRef.current) worker.postMessage(request)
  }, [markStopped])

  const setFilters = useCallback((filters: LiveFilters) => {
    filtersRef.current = filters
    publishRef.current()
  }, [])

  const setSort = useCallback((sort: ResultSort) => {
    sortRef.current = sort
    publishRef.current()
  }, [])

  return { state, start, stop, setFilters, setSort }
}
