import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MiningView } from '../components/MiningView'
import { DEFAULT_FACE_FILTERS } from '../lib/config'
import type { WorkerEvent, WorkerRequest } from '../lib/worker-protocol'

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
  if (!request || request.type !== 'start') throw new Error('expected a start request')
  return request.input
}

beforeEach(() => {
  instances.length = 0
  vi.stubGlobal('Worker', FakeWorker)
  // A single worker keeps range/index arithmetic trivial to reason about in these tests.
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2, configurable: true })
})

describe('MiningView + useMiner integration (pause/resume)', () => {
  it('preserves the leaderboard and continues from the resume point, instead of resetting to zero', () => {
    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )
    expect(instances).toHaveLength(1)
    expect(startInputOf(instances[0]).start).toBe(0)

    // Mine some ground and find a candidate.
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(screen.getAllByRole('button', { name: /use this/i })).toHaveLength(1)

    // Pause (selecting a result, in the real app) — the worker is told to stop but not
    // terminated, and the leaderboard/scanned count must not be touched.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onSelect={vi.fn()}
      />,
    )
    expect(instances[0].posted.some((request) => request.type === 'stop')).toBe(true)
    expect(instances[0].terminated).toBe(false)
    expect(screen.getAllByRole('button', { name: /use this/i })).toHaveLength(1)

    // Resume (deselecting, "Back to mining") — same config/faceSpec, so this must continue the
    // same run: a fresh worker pool (teardown always happens) but picking up from the resume
    // point, not from zero, and keeping what was already found.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )

    expect(instances[0].terminated).toBe(true)
    expect(instances).toHaveLength(2)
    // The resume point is the previous run's nextStart (highest end position reached), not 0.
    expect(startInputOf(instances[1]).start).toBeGreaterThan(0)
    expect(startInputOf(instances[1]).start).toBe(500)
    // The candidate found before pausing is still there — the board was not thrown away.
    expect(screen.getAllByRole('button', { name: /use this/i })).toHaveLength(1)

    // The displayed scanned count also carries over rather than resetting to zero: emitting more
    // progress from the new worker should report a cumulative total, not just the new segment.
    act(() => instances[1].emit({ type: 'progress', scanned: 200, candidates: [CANDIDATE] }))
    expect(screen.getByText(/700\s*nonces/)).toBeDefined()
  })

  it('starts a genuinely new run from zero, without carrying over the previous board, when the face spec changes', () => {
    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(screen.getAllByRole('button', { name: /use this/i })).toHaveLength(1)

    // A different accepted-expressions selection produces a different FaceSpec object — this is
    // "a changed config or face spec", not a pause/resume of the same run, so it must reset.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_B as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )

    expect(instances).toHaveLength(2)
    expect(startInputOf(instances[1]).start).toBe(0)
    expect(screen.queryAllByRole('button', { name: /use this/i })).toHaveLength(0)
    expect(screen.getByText(/^0 nonces/)).toBeDefined()
  })

  it('starting fresh after being paused (rather than resumed) also does not carry over the board', () => {
    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_A as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
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
        onSelect={vi.fn()}
      />,
    )

    // While paused, the accepted expressions change (FacePicker is still visible/usable next to
    // a selected result) — a genuinely different run, even though it will only actually start
    // once un-paused.
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_B as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onSelect={vi.fn()}
      />,
    )
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC_B as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )

    const lastWorker = instances.at(-1)
    if (!lastWorker) throw new Error('expected a worker to have started')
    expect(startInputOf(lastWorker).start).toBe(0)
    expect(screen.queryAllByRole('button', { name: /use this/i })).toHaveLength(0)
  })
})
