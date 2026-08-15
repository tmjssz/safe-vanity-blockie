'use client'

import {
  type Candidate,
  type FaceSpec,
  Leaderboard,
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

/**
 * Retention is score-ranked and blind to the two-colour and contrast filters, which are
 * applied for display — so retain far more than we show, or filtering has nothing left.
 */
const RETENTION_MULTIPLIER = 20
const MIN_RETENTION = 200

export interface StartMiningInput {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  workers: number
  keep: number
  twoColor: boolean
  minContrast: number
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

export interface LiveFilters {
  twoColor: boolean
  minContrast: number
}

export function useMiner(): {
  state: MinerState
  start: (input: StartMiningInput) => void
  stop: () => void
  setFilters: (filters: LiveFilters) => void
} {
  const [state, setState] = useState<MinerState>(IDLE)
  const workersRef = useRef<Worker[]>([])
  const scannedRef = useRef<number[]>([])
  const boardRef = useRef<Leaderboard | undefined>(undefined)
  const startedAtRef = useRef(0)
  const liveRef = useRef(0)
  // Cumulative scanned count / active-mining time from segments before the current one. A
  // "segment" ends whenever start() is called again (pause or a fresh run); on resume these
  // fold the ending segment's numbers in instead of losing them, so pausing to inspect a result
  // and resuming does not reset the displayed scanned count or rate back to zero. Reset to 0 on
  // a genuinely fresh start.
  const priorScannedRef = useRef(0)
  const priorElapsedRef = useRef(0)
  // Filters are a display concern: retention (RETENTION_MULTIPLIER/MIN_RETENTION above) is
  // score-ranked and filter-blind, so re-filtering never needs to touch the worker pool or
  // discard mining progress. `publish` (defined fresh inside every start()) reads this ref
  // rather than a value captured by the start() closure, so `setFilters` below can change what
  // gets shown without restarting anything.
  const filtersRef = useRef<LiveFilters>({ twoColor: true, minContrast: 0 })
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

  const start = useCallback(
    (input: StartMiningInput) => {
      // Only a real resume of an existing run preserves anything — a `resume: true` with no
      // prior board (e.g. the very first call) is indistinguishable from a fresh start.
      const resuming = Boolean(input.resume) && boardRef.current !== undefined

      teardown()

      runIdRef.current += 1
      const runId = runIdRef.current

      const retain = Math.max(input.keep * RETENTION_MULTIPLIER, MIN_RETENTION)
      const from = input.start ?? 0
      const ranges = planWorkerRanges(from, input.workers, WORKER_BLOCK)

      if (resuming) {
        // Fold the segment that just ended into the running totals instead of discarding them.
        // `boardRef.current` is left as-is (same Leaderboard instance, same entries).
        priorScannedRef.current += scannedRef.current.reduce((a, b) => a + b, 0)
        priorElapsedRef.current += Date.now() - startedAtRef.current
      } else {
        boardRef.current = new Leaderboard(retain)
        priorScannedRef.current = 0
        priorElapsedRef.current = 0
      }

      scannedRef.current = new Array(input.workers).fill(0)
      startedAtRef.current = Date.now()
      liveRef.current = input.workers
      filtersRef.current = { twoColor: input.twoColor, minContrast: input.minContrast }
      setState((previous) =>
        resuming ? { ...previous, running: true, error: undefined } : { ...IDLE, running: true },
      )

      const publish = () => {
        const board = boardRef.current
        if (!board) return
        const scanned = priorScannedRef.current + scannedRef.current.reduce((a, b) => a + b, 0)
        const elapsedMs = Math.max(1, priorElapsedRef.current + (Date.now() - startedAtRef.current))
        const { reported, droppedCount } = selectReported(board.entries(), {
          twoColor: filtersRef.current.twoColor,
          minContrast: filtersRef.current.minContrast,
          keep: input.keep,
        })
        setState((previous) => ({
          ...previous,
          scanned,
          elapsedMs,
          rate: (scanned / elapsedMs) * 1000,
          candidates: reported,
          droppedCount,
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
            setState((previous) => ({ ...previous, running: false, error: event.message }))
            teardown()
            return
          }
          scannedRef.current[index] = event.scanned
          boardRef.current?.merge(event.candidates)
          publish()
          if (event.type === 'done') {
            liveRef.current -= 1
            if (liveRef.current <= 0) setState((previous) => ({ ...previous, running: false }))
          }
        }
        // Covers a failure to run the worker module at all — a 404 on the worker chunk after a
        // redeploy, a host CSP blocking worker-src, WASM blocked — none of which reach the
        // internal try/catch in mine.worker.ts because the handler itself never starts. Without
        // this, no message ever arrives, `running` stays true forever, and the UI sits at
        // "0 nonces" with no explanation.
        worker.onerror = (event: ErrorEvent) => {
          if (runIdRef.current !== runId) return
          setState((previous) => ({
            ...previous,
            running: false,
            error: `Worker failed to start: ${event.message || 'unknown error'}. Reload the page — if this persists, your browser or network may be blocking the mining worker or its WASM.`,
          }))
          teardown()
        }
        // Fires when a posted message cannot be deserialised on the other side — treated the
        // same way as onerror since either one means this worker can no longer be trusted to
        // report progress.
        worker.onmessageerror = () => {
          if (runIdRef.current !== runId) return
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
    [teardown],
  )

  const stop = useCallback(() => {
    const request: WorkerRequest = { type: 'stop' }
    for (const worker of workersRef.current) worker.postMessage(request)
  }, [])

  const setFilters = useCallback((filters: LiveFilters) => {
    filtersRef.current = filters
    publishRef.current()
  }, [])

  return { state, start, stop, setFilters }
}
