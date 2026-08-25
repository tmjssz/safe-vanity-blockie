import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MiningView } from '../components/MiningView'
import { DEFAULT_FACE_FILTERS } from '../lib/config'
import { WORKER_BLOCK, type WorkerEvent, type WorkerRequest } from '../lib/worker-protocol'

// NEW-2 regression coverage: unlike MiningView.test.tsx (which mocks useMiner entirely, so it
// cannot see whether a real leaderboard survives a pause/resume cycle), this exercises the real
// useMiner hook against a fake Worker — the actual bug ("mine for ten minutes, pause to inspect
// a result, go back to mining, and the grid empties while workers re-scan ground already
// covered") only shows up in the real interaction between MiningView's pause/resume wiring and
// useMiner's start().

const CONFIG = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }
const FACE_SPEC_A = { name: 'a', fixed: [], regions: [] }
const FACE_SPEC_B = { name: 'b', fixed: [], regions: [] }

const STABLE_CONSTANTS_DATA = {
  constantsHex: { initializerHash: '0x1', factory: '0x2', initCodeHash: '0x3' },
}

// Each result card is one button, named after the result it opens ("Deploy 90.2% match 0x70e9…").
const resultCards = () => screen.getAllByRole('button', { name: /deploy .* match/i })
const noResultCards = () => screen.queryAllByRole('button', { name: /deploy .* match/i })

const CANDIDATE = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

vi.mock('../lib/use-safe-constants.js', () => ({
  useSafeConstants: () => ({ loading: false, data: STABLE_CONSTANTS_DATA }),
}))

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
}

function startInputOf(worker: FakeWorker) {
  const request = worker.posted[0]
  if (request?.type !== 'start') throw new Error('expected a start request')
  return request.input
}

beforeEach(() => {
  instances.length = 0
  vi.stubGlobal('Worker', FakeWorker)
  // A single worker (one core is left for the UI) keeps range/index arithmetic trivial to reason
  // about in these tests. The case that turns on more than one worker overrides this itself.
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MiningView + useMiner integration (pause/resume)', () => {
  it('preserves the leaderboard and continues from the resume point, instead of resetting to zero', () => {
    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(instances).toHaveLength(1)
    expect(startInputOf(instances[0]).start).toBe(0)

    // Mine some ground and find a candidate.
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(resultCards()).toHaveLength(1)

    // Pause (a deploy in flight, in the real app) — the worker is told to stop but not
    // terminated, and the leaderboard/scanned count must not be touched.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(instances[0].posted.some((request) => request.type === 'stop')).toBe(true)
    expect(instances[0].terminated).toBe(false)
    expect(resultCards()).toHaveLength(1)

    // Resume (closing the deploy dialog) — same config/faceSpec, so this must continue the
    // same run: a fresh worker pool (teardown always happens) but picking up from the resume
    // point, not from zero, and keeping what was already found.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(instances[0].terminated).toBe(true)
    expect(instances).toHaveLength(2)
    // The resume point is the previous run's nextStart (highest end position reached), not 0.
    expect(startInputOf(instances[1]).start).toBeGreaterThan(0)
    expect(startInputOf(instances[1]).start).toBe(500)
    // The candidate found before pausing is still there — the board was not thrown away.
    expect(resultCards()).toHaveLength(1)

    // The displayed scanned count also carries over rather than resetting to zero: emitting more
    // progress from the new worker should report a cumulative total, not just the new segment.
    act(() => instances[1].emit({ type: 'progress', scanned: 200, candidates: [CANDIDATE] }))
    // Under a thousand the bar prints the figure as it is, so this is still 700 rather than
    // "0.7K".
    expect(document.querySelector('[data-slot="stat-scanned"]')?.textContent).toBe('700 checked')
  })

  // The status bar now shows the elapsed time, which turned a long-standing accounting bug into
  // something a user can watch happen: stop() recorded nothing, so the resuming start() folded
  // the whole wall-clock duration of the pause into "active mining time". Two seconds of mining
  // either side of a two-minute pause is four seconds of mining, not 2m 04s.
  it('does not bill the time spent paused as mining time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    act(() => vi.advanceTimersByTime(2_000))
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(document.querySelector('[data-slot="stat-elapsed"]')?.textContent).toBe('2s')

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    // A long look at a candidate before going back to mining.
    act(() => vi.advanceTimersByTime(120_000))

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    act(() => vi.advanceTimersByTime(2_000))
    act(() => instances[1].emit({ type: 'progress', scanned: 200, candidates: [CANDIDATE] }))

    // The whole point: two seconds of mining either side of a two-minute pause is four seconds
    // of mining, not 2m 04s.
    expect(document.querySelector('[data-slot="stat-elapsed"]')?.textContent).toBe('4s')
  })

  it('holds the clock still while paused, even if a filter change re-publishes mid-pause', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    act(() => vi.advanceTimersByTime(3_000))
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(document.querySelector('[data-slot="stat-elapsed"]')?.textContent).toBe('3s')

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    act(() => vi.advanceTimersByTime(90_000))

    // The Face card never locks, so the contrast filter can be dragged while paused — that
    // re-publishes from the existing leaderboard, and the clock must not jump when it does.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={{ twoColor: true, minContrast: 120, minMatch: 0 }}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    // The clock did not move across ninety seconds of pause and a filter change mid-pause.
    expect(document.querySelector('[data-slot="stat-scanned"]')?.textContent).toBe(
      '500 checked in 3s',
    )
  })

  // The failure this pins is the whole screen contradicting itself: drag the contrast floor past
  // every result and the grid says "162 candidates have been found so far and all of them were
  // excluded", while the bar two rows above it says "No candidates yet". The bar's best result has
  // to come from the retained board, which the filters never touch, so it stays true and steady
  // while the grid below it is empty.
  it('keeps the bar reporting the best result found when the filters empty the grid', () => {
    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(resultCards()).toHaveLength(1)
    // The card carries the same percentage, so this is deliberately not a unique match yet.
    expect(screen.getAllByText('90.2%').length).toBeGreaterThan(0)

    // CANDIDATE's contrast is 157, so this floor excludes it — and everything else on the board.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={{ twoColor: true, minContrast: 442, minMatch: 0 }}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(noResultCards()).toHaveLength(0)
    expect(screen.getByTestId('no-matches').textContent).toMatch(/no result matches/i)
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.getByText(/best result/i)).toBeDefined()
    expect(screen.queryByText(/no candidates yet/i)).toBeNull()
    // The heading's badge counts the cards, so it empties with the grid — while the bar above,
    // reading the untouched board, goes on reporting the best result the run has found.
    expect(screen.getByTestId('results-count').textContent).toBe('0 results shown')
  })

  it('starts a genuinely new run from zero, without carrying over the previous board, when the face spec changes', () => {
    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(resultCards()).toHaveLength(1)

    // A different accepted-expressions selection produces a different FaceSpec object — this is
    // "a changed config or face spec", not a pause/resume of the same run, so it must reset.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_B as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(instances).toHaveLength(2)
    expect(startInputOf(instances[1]).start).toBe(0)
    expect(noResultCards()).toHaveLength(0)
    expect(document.querySelector('[data-slot="stat-scanned"]')?.textContent).toBe('0 checked')
  })

  it('starting fresh after being paused (rather than resumed) also does not carry over the board', () => {
    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    // While paused, the accepted expressions change (FacePicker is still visible/usable while a
    // deploy is in flight) — a genuinely different run, even though it will only actually start
    // once un-paused.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_B as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_B as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const lastWorker = instances.at(-1)
    if (!lastWorker) throw new Error('expected a worker to have started')
    expect(startInputOf(lastWorker).start).toBe(0)
    expect(noResultCards()).toHaveLength(0)
  })

  // The configured start reaches the workers, which is the whole point: without this the field
  // is a number the app collects and throws away.
  it('starts a fresh run from the configured nonce', () => {
    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        startFrom={41_200_000_000}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(startInputOf(instances[0]).start).toBe(41_200_000_000)
  })

  // A resume is measured from where the run REACHED, never from where it was told to begin. With
  // `startFrom` winning here, every pause would rescan the ground since the configured start.
  it('resumes from the run’s own progress, not from the configured start', () => {
    const view = (paused: boolean) => (
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={paused}
        startFrom={41_200_000_000}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    const { rerender } = render(view(false))
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    rerender(view(true))
    rerender(view(false))
    expect(instances).toHaveLength(2)
    expect(startInputOf(instances[1]).start).toBe(41_200_000_500)
  })

  // Every other case here runs one worker, where the block offset in `nextStartFrom` is always
  // 0 × WORKER_BLOCK and a resume point collapses to start + scanned — the one width at which the
  // geometry cannot be seen. Two workers is where it bites: the blocks lie side by side, so the
  // resume point is decided by the LAST block's start and not by the biggest scanned count. Drop
  // that offset and the follow-up run's first worker walks straight back into ground the second
  // worker already covered, which is the whole thing the resume point promises not to do.
  it('carries the last worker’s block offset into the resumed run, not just the scanned total', () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 3, configurable: true })
    const view = (paused: boolean) => (
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={paused}
        startFrom={41_200_000_000}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    const { rerender } = render(view(false))
    expect(instances).toHaveLength(2)
    expect(startInputOf(instances[0]).start).toBe(41_200_000_000)
    expect(startInputOf(instances[1]).start).toBe(41_200_000_000 + WORKER_BLOCK)

    // The second worker reports LESS ground than the first, deliberately: it is the one whose
    // block sits higher, so it is the one that decides the resume point.
    act(() => instances[0].emit({ type: 'progress', scanned: 900, candidates: [CANDIDATE] }))
    act(() => instances[1].emit({ type: 'progress', scanned: 400, candidates: [] }))
    // The count beside the checkpoint on the bar is the two workers' work added up, and is
    // nowhere near it: the gap the checkpoint popover's copy exists to explain.
    expect(document.querySelector('[data-slot="stat-scanned"]')?.textContent).toBe('1.3K checked')

    rerender(view(true))
    rerender(view(false))

    // A fresh pool of two, picking up past the far end of the higher block — not at
    // 41,200,000,900, which is where a resume point built from the scanned total alone would put
    // it, and which would hand worker 0 a block overlapping the one just abandoned.
    expect(instances).toHaveLength(4)
    expect(startInputOf(instances[2]).start).toBe(41_200_000_000 + WORKER_BLOCK + 400)
    expect(startInputOf(instances[3]).start).toBe(41_200_000_000 + 2 * WORKER_BLOCK + 400)
  })
})
