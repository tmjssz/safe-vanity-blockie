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

const candidate = (address: string, score: number, twoColor = true, contrast = 150) => ({
  saltNonce: '1',
  address,
  score,
  maxScore: 133,
  twoColor,
  contrast,
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
  retain: 40,
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

  // The web can render "nothing matches these filters"; core's fallback (show everything rather
  // than nothing) would instead hand back the full unfiltered list, which reads as a filter that
  // was ignored. The count of what the filters removed has to survive too — with the fallback on,
  // core reports droppedCount 0 in exactly this case.
  it('reports no candidates at all, and the real drop count, when the filters exclude everything', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() =>
      instances[0].emit({
        type: 'progress',
        scanned: 10,
        candidates: [candidate('0xa', 125, false), candidate('0xb', 120, false)],
      }),
    )

    await waitFor(() => {
      expect(result.current.state.candidates).toEqual([])
      expect(result.current.state.droppedCount).toBe(2)
    })
  })

  // The status bar cannot read the head of `candidates`: that list is the filtered one, so a
  // contrast floor nothing clears empties it and the bar would announce "No candidates yet" over
  // an empty state explaining that plenty had been found. Retention is score-ranked and blind to
  // the filters, so the head of the board is the honest best-so-far — and its size is the honest
  // "how many has this run found", which is not the number of cards on screen.
  it('reports the best retained candidate, and how many it is holding, whatever the filters exclude', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() =>
      instances[0].emit({
        type: 'progress',
        scanned: 10,
        candidates: [candidate('0xa', 125, true, 150), candidate('0xb', 120, true, 140)],
      }),
    )
    act(() => result.current.setFilters({ twoColor: true, minContrast: 300 }))

    expect(result.current.state.candidates).toEqual([])
    expect(result.current.state.bestOverall?.address).toBe('0xa')
  })

  // A three-colour result can outscore every two-colour one; the board keeps it either way, so
  // "the best found" means the best the run has retained, not the best the filters would allow.
  it('takes the best retained candidate by score alone, not by the filters', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() =>
      instances[0].emit({
        type: 'progress',
        scanned: 10,
        candidates: [candidate('0xa', 130, false), candidate('0xb', 120, true)],
      }),
    )

    await waitFor(() => expect(result.current.state.bestOverall?.address).toBe('0xa'))
    expect(result.current.state.candidates.map((entry) => entry.address)).toEqual(['0xb'])
  })

  // "No matches" is far more useful as "no matches — the best contrast found so far is 143", since
  // the contrast floor is the control the user is about to move. It has to be measured over the
  // candidates the *other* filters accept, or a three-colour result with huge contrast would
  // advertise a floor that still matches nothing.
  it('reports the best contrast among candidates the other filters accept', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() =>
      instances[0].emit({
        type: 'progress',
        scanned: 10,
        candidates: [
          candidate('0xa', 125, false, 400),
          candidate('0xb', 120, true, 143),
          candidate('0xc', 119, true, 120),
        ],
      }),
    )
    act(() => result.current.setFilters({ twoColor: true, minContrast: 300 }))

    expect(result.current.state.candidates).toEqual([])
    expect(result.current.state.bestContrast).toBe(143)
  })

  it('leaves the best contrast unreported while results are still matching', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() =>
      instances[0].emit({
        type: 'progress',
        scanned: 10,
        candidates: [candidate('0xb', 120, true, 143)],
      }),
    )

    await waitFor(() => expect(result.current.state.candidates).toHaveLength(1))
    expect(result.current.state.bestContrast).toBeUndefined()
  })

  // Retention and display used to be the same number times twenty: `keep` was the display slice,
  // and the pool retained 20x it. They are separate concerns — retention has to be deep because it
  // is score-ranked and filter-blind, while the grid simply shows everything that survives the
  // filters — so the hook takes retention and nothing else.
  it('retains what it is told to and displays every survivor, with no display slice of its own', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start({ ...startInput, retain: 50 }))

    const found = Array.from({ length: 30 }, (_, index) => candidate(`0x${index}`, 200 - index))
    act(() => instances[0].emit({ type: 'progress', scanned: 10, candidates: found }))

    await waitFor(() => expect(result.current.state.candidates).toHaveLength(30))
  })

  it('gives each worker the retention size, which is what keep means across that boundary', () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start({ ...startInput, retain: 250 }))

    const request = instances[0].posted[0]
    if (request.type !== 'start') throw new Error('expected a start request')
    expect(request.input.keep).toBe(250)
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
  describe('the display order', () => {
    const addresses = (result: { current: ReturnType<typeof useMiner> }) =>
      result.current.state.candidates.map((entry) => entry.address)

    // Three candidates whose score order, contrast order and arrival order all differ, so no two
    // sorts below can agree by accident.
    const first = candidate('0xa', 130, true, 100)
    const second = candidate('0xb', 120, true, 400)
    const third = candidate('0xc', 125, true, 250)

    const withAll = () => {
      const { result } = renderHook(() => useMiner())
      act(() => result.current.start(startInput))
      // Emitted in separate messages, because arrival order is the one thing a single batch
      // cannot express.
      act(() => instances[0].emit({ type: 'progress', scanned: 10, candidates: [first] }))
      act(() => instances[0].emit({ type: 'progress', scanned: 20, candidates: [second] }))
      act(() => instances[0].emit({ type: 'progress', scanned: 30, candidates: [third] }))
      return result
    }

    it('ranks by the leaderboard order until asked otherwise', () => {
      expect(addresses(withAll())).toEqual(['0xa', '0xc', '0xb'])
    })

    it('ranks by contrast, highest first', () => {
      const result = withAll()
      act(() => result.current.setSort('contrast'))
      expect(addresses(result)).toEqual(['0xb', '0xc', '0xa'])
    })

    // What "newest" has to mean here: the board is score-ranked and keeps the best 200, so the
    // only order that answers "what just turned up?" is the order things entered it. A saltNonce
    // cannot stand in for it — the workers scan disjoint ranges in parallel, so a high nonce is
    // not a late find.
    it('ranks by arrival, most recent first', () => {
      const result = withAll()
      act(() => result.current.setSort('newest'))
      expect(addresses(result)).toEqual(['0xc', '0xb', '0xa'])
    })

    it('keeps arrival order stable as later candidates land', () => {
      const result = withAll()
      act(() => result.current.setSort('newest'))
      act(() =>
        instances[1].emit({
          type: 'progress',
          scanned: 40,
          candidates: [candidate('0xd', 121, true, 111)],
        }),
      )
      expect(addresses(result)).toEqual(['0xd', '0xc', '0xb', '0xa'])
    })

    // Same reasoning as the filters: ordering is a display concern, and re-ordering an
    // already-mined board must not cost a nonce of progress.
    it('reorders without restarting the workers', () => {
      const result = withAll()
      const posted = instances.map((worker) => worker.posted.length)

      act(() => result.current.setSort('contrast'))

      expect(instances).toHaveLength(2)
      expect(instances.map((worker) => worker.posted.length)).toEqual(posted)
      expect(instances.some((worker) => worker.terminated)).toBe(false)
      expect(result.current.state.running).toBe(true)
    })

    // Everything in one worker message turned up at the same moment, so there is no arrival order
    // to read between them — and the board's order within a batch is score order, which would be
    // a made-up sequence if it were treated as one.
    it('leaves candidates that arrived together in leaderboard order', () => {
      const { result } = renderHook(() => useMiner())
      act(() => result.current.start(startInput))
      act(() =>
        instances[0].emit({
          type: 'progress',
          scanned: 10,
          candidates: [candidate('0xlow', 100, true, 400), candidate('0xhigh', 130, true, 100)],
        }),
      )
      act(() => result.current.setSort('newest'))

      expect(addresses(result)).toEqual(['0xhigh', '0xlow'])
    })

    it('starts a fresh run over, rather than carrying the old arrival numbers into it', () => {
      const result = withAll()
      act(() => result.current.setSort('newest'))
      act(() => result.current.start(startInput))
      act(() =>
        instances[2].emit({
          type: 'progress',
          scanned: 10,
          candidates: [candidate('0xe', 100, true, 100)],
        }),
      )
      act(() =>
        instances[2].emit({
          type: 'progress',
          scanned: 20,
          candidates: [candidate('0xf', 99, true, 100)],
        }),
      )
      // Nothing from the previous run is on the board, and the new finds are numbered from
      // scratch rather than sorting below rows that no longer exist.
      expect(addresses(result)).toEqual(['0xf', '0xe'])
    })
  })

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
