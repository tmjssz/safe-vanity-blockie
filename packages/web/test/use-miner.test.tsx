import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEvent, WorkerRequest } from '../lib/worker-protocol'
import { useMiner } from '../lib/use-miner'

const instances: FakeWorker[] = []

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null
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
})
