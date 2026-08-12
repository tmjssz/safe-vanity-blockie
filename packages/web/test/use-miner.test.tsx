import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMiner } from '../lib/use-miner'
import type { WorkerEvent, WorkerRequest } from '../lib/worker-protocol'

const instances: FakeWorker[] = []

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  posted: WorkerRequest[] = []
  terminated = false

  constructor() {
    instances.push(this)
  }

  postMessage(request: WorkerRequest) {
    this.posted.push(request)
  }

  terminate() {
    this.terminated = true
  }

  emit(event: WorkerEvent) {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>)
  }

  emitError(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }

  emitMessageError() {
    this.onmessageerror?.({} as MessageEvent)
  }
}

const candidate = (address: string, score: number, twoColor = true) => ({
  saltNonce: '1',
  address,
  score,
  maxScore: 133,
  twoColor,
  contrast: 150,
  regions: { mouth: 'smile' },
})

const startInput = {
  constantsHex: {
    initializerHash: '0x' + '11'.repeat(32),
    factory: '0x' + '22'.repeat(20),
    initCodeHash: '0x' + '33'.repeat(32),
  },
  faceSpec: { name: 'x', fixed: [], regions: [] },
  workers: 2,
  keep: 4,
  twoColor: true,
  minContrast: 0,
} as unknown as Parameters<ReturnType<typeof useMiner>['start']>[0]

beforeEach(() => {
  instances.length = 0
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useMiner', () => {
  it('spawns one worker per requested thread and starts each on a disjoint range', () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    expect(instances).toHaveLength(2)
    const starts = instances.map((worker) => {
      const request = worker.posted[0]
      if (request.type !== 'start') throw new Error('expected a start request')
      return request.input.start
    })
    expect(new Set(starts).size).toBe(2)
    expect(result.current.state.running).toBe(true)
  })

  it('aggregates scanned counts across workers', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() => instances[0].emit({ type: 'progress', scanned: 1_000, candidates: [] }))
    act(() => instances[1].emit({ type: 'progress', scanned: 2_500, candidates: [] }))

    await waitFor(() => expect(result.current.state.scanned).toBe(3_500))
  })

  it('applies the same filters the results view uses, so the live view matches', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() =>
      instances[0].emit({
        type: 'progress',
        scanned: 10,
        candidates: [candidate('0xa', 125, false), candidate('0xb', 120, true)],
      }),
    )

    await waitFor(() => {
      expect(result.current.state.candidates.map((entry) => entry.address)).toEqual(['0xb'])
      expect(result.current.state.droppedCount).toBe(1)
    })
  })

  it('stops every worker and clears running when asked', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))
    act(() => result.current.stop())

    for (const worker of instances) {
      expect(worker.posted.some((request) => request.type === 'stop')).toBe(true)
    }
    act(() => instances[0].emit({ type: 'done', scanned: 10, candidates: [] }))
    act(() => instances[1].emit({ type: 'done', scanned: 10, candidates: [] }))
    await waitFor(() => expect(result.current.state.running).toBe(false))
  })

  it('surfaces a worker error rather than hanging', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))
    act(() => instances[0].emit({ type: 'error', message: 'wasm failed to load' }))
    await waitFor(() => expect(result.current.state.error).toMatch(/wasm failed to load/))
  })

  it('surfaces a worker failing to load or run at all, via onerror, rather than hanging forever', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))
    act(() => instances[0].emitError('worker chunk failed to load'))

    await waitFor(() => {
      expect(result.current.state.error).toMatch(/worker chunk failed to load/)
      expect(result.current.state.running).toBe(false)
    })
    // A worker that can no longer be trusted is torn down, not left running in the background.
    expect(instances.every((worker) => worker.terminated)).toBe(true)
  })

  it('surfaces an undeserialisable message via onmessageerror, rather than hanging forever', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))
    act(() => instances[0].emitMessageError())

    await waitFor(() => {
      expect(result.current.state.error).toBeDefined()
      expect(result.current.state.running).toBe(false)
    })
  })

  it('ignores an onerror from a superseded run', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))
    const staleWorker = instances[0]

    act(() => result.current.start({ ...startInput, workers: 3 } as typeof startInput))
    act(() => staleWorker.emitError('stale failure'))

    expect(result.current.state.error).toBeUndefined()
  })

  it('setFilters re-publishes from the existing leaderboard without restarting workers', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() =>
      instances[0].emit({
        type: 'progress',
        scanned: 10,
        candidates: [candidate('0xa', 125, false), candidate('0xb', 120, true)],
      }),
    )
    await waitFor(() => {
      expect(result.current.state.candidates.map((entry) => entry.address)).toEqual(['0xb'])
    })

    act(() => result.current.setFilters({ twoColor: false, minContrast: 0 }))

    expect(result.current.state.candidates.map((entry) => entry.address).sort()).toEqual([
      '0xa',
      '0xb',
    ])
    // No worker was touched — this is a display-only re-filter of candidates already mined.
    expect(instances).toHaveLength(2)
    expect(instances.every((worker) => !worker.terminated)).toBe(true)
    // Progress is preserved, not reset.
    expect(result.current.state.scanned).toBe(10)
  })

  // The elapsed clock stops when *scanning* stops, and stop() is not the only thing that stops
  // scanning: every path that sets `running: false` ends the run just as finally. Without a stamp
  // on those paths the clock stands still only until something re-publishes — a filter change,
  // say — at which point it silently absorbs however long the user spent reading the error, and
  // the rate collapses by the same factor.
  describe('elapsed time after a run ends without stop()', () => {
    const ranFor = (ms: number) => {
      const hook = renderHook(() => useMiner())
      act(() => hook.result.current.start(startInput))
      act(() => vi.advanceTimersByTime(ms))
      act(() => instances[0].emit({ type: 'progress', scanned: 1_000, candidates: [] }))
      expect(hook.result.current.state.elapsedMs).toBe(ms)
      return hook
    }

    const endings: [string, () => void][] = [
      [
        'a worker reporting an error',
        () => instances[0].emit({ type: 'error', message: 'wasm failed to load' }),
      ],
      [
        'a worker failing to start at all',
        () => instances[0].emitError('worker chunk failed to load'),
      ],
      ['an unreadable message from a worker', () => instances[0].emitMessageError()],
    ]

    for (const [description, end] of endings) {
      it(`stops the clock at ${description}, not at whatever happens next`, () => {
        vi.useFakeTimers()
        const { result } = ranFor(12_000)

        act(end)
        expect(result.current.state.running).toBe(false)

        // The user reads the error, thinks for five minutes, then nudges the contrast filter.
        act(() => vi.advanceTimersByTime(300_000))
        act(() => result.current.setFilters({ twoColor: false, minContrast: 0 }))

        expect(result.current.state.elapsedMs).toBe(12_000)
        expect(result.current.state.rate).toBeCloseTo(1_000 / 12, 5)
      })
    }

    it('stops the clock when the last worker finishes its range', () => {
      vi.useFakeTimers()
      const { result } = ranFor(12_000)

      act(() => instances[0].emit({ type: 'done', scanned: 1_000, candidates: [] }))
      act(() => instances[1].emit({ type: 'done', scanned: 0, candidates: [] }))
      expect(result.current.state.running).toBe(false)

      act(() => vi.advanceTimersByTime(300_000))
      act(() => result.current.setFilters({ twoColor: false, minContrast: 0 }))

      expect(result.current.state.elapsedMs).toBe(12_000)
    })

    // The stamp must still describe the moment scanning ended, not the moment the component was
    // torn down or the user got round to pressing Pause.
    it('does not let a later stop() walk the stamp forward', () => {
      vi.useFakeTimers()
      const { result } = ranFor(12_000)

      act(() => instances[0].emitError('worker chunk failed to load'))
      act(() => vi.advanceTimersByTime(300_000))
      act(() => result.current.stop())
      act(() => result.current.setFilters({ twoColor: false, minContrast: 0 }))

      expect(result.current.state.elapsedMs).toBe(12_000)
    })

    // …and a resume after a failed run still bills only the mining either side of it.
    it('carries only the active time into a resumed run', () => {
      vi.useFakeTimers()
      const { result } = ranFor(12_000)

      act(() => instances[0].emitError('worker chunk failed to load'))
      act(() => vi.advanceTimersByTime(300_000))
      act(() => result.current.start({ ...startInput, resume: true, start: 1_000 }))
      act(() => vi.advanceTimersByTime(3_000))
      act(() => instances[2].emit({ type: 'progress', scanned: 10, candidates: [] }))

      expect(result.current.state.elapsedMs).toBe(15_000)
    })
  })

  it('ignores a message from a superseded run, so a stale worker cannot corrupt the new one', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))
    const staleWorker = instances[0]

    const secondRunInput = {
      ...startInput,
      workers: 3,
    } as unknown as Parameters<ReturnType<typeof useMiner>['start']>[0]
    act(() => result.current.start(secondRunInput))

    // terminate() does not un-queue a message the old worker already dispatched — this
    // simulates that message arriving after the new run has already replaced the refs it
    // would write into.
    act(() =>
      staleWorker.emit({
        type: 'progress',
        scanned: 999_999,
        candidates: [candidate('0xstale', 999)],
      }),
    )

    await waitFor(() => {
      expect(result.current.state.scanned).toBe(0)
      expect(result.current.state.candidates).toEqual([])
    })
  })
})
