import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MiningView } from '../components/MiningView'
import { DEFAULT_FACE_FILTERS } from '../lib/config'
import { chainById } from '../lib/wagmi'
import type { WorkerEvent, WorkerRequest } from '../lib/worker-protocol'

// The chain moved into the header, so it can change *underneath a running search* — the one
// config field that can. Every other one is locked behind "Start over", which unmounts this
// component entirely, so this is the only in-place config change MiningView can ever see.
//
// The whole promise of that feature is that switching among the six non-mainnet chains keeps the
// run: the factory and the initializer hash are identical on all seven supported chains, and the
// initCodeHash splits only by which singleton protocol-kit picks (Safe.sol on mainnet, SafeL2.sol
// everywhere else) — so for those six the three constants a worker mines with are byte-identical
// and every address on the leaderboard stays exactly as valid as it was.
//
// Unlike MiningView.integration.test.tsx, which stubs useSafeConstants out entirely, this drives
// the REAL hook against a mocked loadSafeConstants. That is deliberate and is the point of the
// file: the hazard lives in the seam between the two — the hook re-reads on a new config object
// and resolves to a NEW SafeSetup object carrying the SAME constants, and a restart effect keyed
// on that object's identity would tear the worker pool down and empty the board for nothing.
// A stubbed hook cannot express "equal in value, new object", so it cannot see the bug.

const OWNERS = ['0x' + '11'.repeat(20)]
const SEPOLIA = { owners: OWNERS, threshold: 1, safeVersion: '1.4.1', chainId: 11155111 }
const POLYGON = { ...SEPOLIA, chainId: 137 }
const MAINNET = { ...SEPOLIA, chainId: 1 }

const FACE_SPEC = { name: 'a', fixed: [], regions: [] }

// The measured split, as constants: the six share one initCodeHash, mainnet has the other.
const L2_INIT_CODE_HASH = '0x' + 'e2'.repeat(32)
const L1_INIT_CODE_HASH = '0x' + '76'.repeat(32)

const CANDIDATE = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

const { loadSafeConstantsMock } = vi.hoisted(() => ({ loadSafeConstantsMock: vi.fn() }))

// The real useSafeConstants runs; only the RPC read underneath it is faked. Every call resolves
// to a freshly built SafeSetup — never a shared literal — because "a new object each time" is
// exactly the condition under test.
vi.mock('@safe-vanity-blockie/safe-config', () => ({
  loadSafeConstants: loadSafeConstantsMock,
  ZKSYNC_CHAIN_IDS: new Set(),
}))

const resultCards = () => screen.getAllByRole('button', { name: /deploy .* match/i })
const noResultCards = () => screen.queryAllByRole('button', { name: /deploy .* match/i })

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

/** The default public RPC MiningView will read a given chain's constants from. */
const rpcUrlOf = (chainId: number) => chainById(chainId).rpcUrls.default.http[0]

// Which chain each constants read was for — the only externally visible sign that a config change
// reached the component at all.
const rpcUrlsAsked = () =>
  loadSafeConstantsMock.mock.calls.map((call) => (call[0] as { rpcUrl: string }).rpcUrl)

beforeEach(() => {
  instances.length = 0
  vi.stubGlobal('Worker', FakeWorker)
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2, configurable: true })
  loadSafeConstantsMock.mockReset().mockImplementation(async (input: { rpcUrl: string }) => ({
    // Deliberately a brand-new object per call, with a per-chain chainId — the constants that
    // matter are equal in value, the SafeSetup wrapping them never is.
    chainId: 1n,
    constants: {
      initializerHash: new Uint8Array(32),
      factory: new Uint8Array(20),
      initCodeHash: new Uint8Array(32),
    },
    constantsHex: {
      initializerHash: '0x' + '11'.repeat(32),
      factory: '0x' + '22'.repeat(20),
      initCodeHash: input.rpcUrl === rpcUrlOf(1) ? L1_INIT_CODE_HASH : L2_INIT_CODE_HASH,
    },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MiningView across a chain switch', () => {
  it('keeps the run, the leaderboard and the scanned count when the chain switches within the six', async () => {
    const { rerender } = render(
      <MiningView
        config={SEPOLIA as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )

    await waitFor(() => expect(instances).toHaveLength(1))
    const worker = instances[0]
    expect(startInputOf(worker).start).toBe(0)

    act(() => worker.emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(resultCards()).toHaveLength(1)
    const addresses = resultCards().map((card) => card.textContent)

    // The header switches Sepolia → Polygon. Same singleton class, so every address on screen is
    // exactly as valid as it was a moment ago.
    rerender(
      <MiningView
        config={POLYGON as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )

    // The switch really did reach this component: the constants are re-read, against the new
    // chain's own RPC. Without this the test could pass on a MiningView that ignored `config`
    // altogether — which would keep the run for entirely the wrong reason.
    await waitFor(() => expect(loadSafeConstantsMock).toHaveBeenCalledTimes(2))
    expect(rpcUrlsAsked()).toEqual([rpcUrlOf(SEPOLIA.chainId), rpcUrlOf(POLYGON.chainId)])

    // And nothing about the run moved. No new worker pool, no stop, no teardown — the effect that
    // starts mining never re-ran at all, because none of the values it depends on changed.
    expect(instances).toHaveLength(1)
    expect(worker.terminated).toBe(false)
    expect(worker.posted.some((request) => request.type === 'stop')).toBe(false)
    // Not even a flicker back to the "Reading Safe constants…" placeholder, which would unmount
    // the grid and the status bar for the length of an RPC round trip.
    expect(screen.queryByText(/reading safe/i)).toBeNull()

    // The board is the same board: same cards, same addresses, nothing re-derived.
    expect(resultCards()).toHaveLength(1)
    expect(resultCards().map((card) => card.textContent)).toEqual(addresses)

    // …and the scanned count keeps climbing from where it was rather than restarting at zero.
    act(() => worker.emit({ type: 'progress', scanned: 900, candidates: [CANDIDATE] }))
    expect(screen.getByText(/900\s*nonces/)).toBeDefined()
  })

  it('does start a fresh run when the switch genuinely changes the constants', async () => {
    const { rerender } = render(
      <MiningView
        config={SEPOLIA as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )
    await waitFor(() => expect(instances).toHaveLength(1))
    act(() => instances[0].emit({ type: 'progress', scanned: 500, candidates: [CANDIDATE] }))
    expect(resultCards()).toHaveLength(1)

    // Mainnet's singleton is Safe.sol, so the initCodeHash — and therefore every address this
    // run has found — is different. The page asks the user before it gets here and discards the
    // run on confirmation; if one ever did reach this component, the run must not be presented as
    // if it survived.
    rerender(
      <MiningView
        config={MAINNET as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )

    await waitFor(() => expect(instances).toHaveLength(2))
    expect(startInputOf(instances[1]).start).toBe(0)
    expect(startInputOf(instances[1]).constantsHex.initCodeHash).toBe(L1_INIT_CODE_HASH)
    expect(noResultCards()).toHaveLength(0)
  })
})
