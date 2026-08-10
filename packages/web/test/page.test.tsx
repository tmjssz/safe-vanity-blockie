import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '../app/page'

// CRITICAL regression coverage: page.tsx renders `{selected && <DeployPanel .../>}` with no
// `key`. Without a key, choosing a second candidate re-renders the SAME DeployPanel instance,
// so its `status`/`completed` state (from deploying the first candidate) survives underneath a
// blockie and address for the second one — a success message naming one address rendered under
// a card showing another. This drives the real Page end to end (mocking only the heavy
// children and the wallet/RPC boundary) so it fails if the `key={selected.address}` fix is
// ever reverted.

const CONFIG = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }

const CANDIDATE_A = {
  saltNonce: '111',
  address: '0x' + 'aa'.repeat(20),
  score: 100,
  maxScore: 133,
  twoColor: true,
  contrast: 150,
  regions: { mouth: 'smile' },
}
const CANDIDATE_B = {
  saltNonce: '222',
  address: '0x' + 'bb'.repeat(20),
  score: 110,
  maxScore: 133,
  twoColor: true,
  contrast: 160,
  regions: { mouth: 'frown' },
}

const {
  useAccountMock,
  useSwitchChainMock,
  useConnectorClientMock,
  loadSafeConstantsMock,
  buildDeploymentPlanMock,
  sendTransactionMock,
  waitForTransactionReceiptMock,
  getSafeAddressFromDeploymentTxMock,
  facePickerPropsRef,
} = vi.hoisted(() => ({
  useAccountMock: vi.fn(() => ({ isConnected: true, address: '0x' + 'cc'.repeat(20), chainId: 1 })),
  useSwitchChainMock: vi.fn(() => ({ switchChain: vi.fn() })),
  useConnectorClientMock: vi.fn(() => ({
    data: { transport: {}, account: '0x' + 'cc'.repeat(20) },
  })),
  loadSafeConstantsMock: vi.fn(),
  buildDeploymentPlanMock: vi.fn(),
  sendTransactionMock: vi.fn(),
  waitForTransactionReceiptMock: vi.fn(),
  getSafeAddressFromDeploymentTxMock: vi.fn(),
  facePickerPropsRef: { current: undefined as { value: string[] } | undefined },
}))

vi.mock('wagmi', () => ({
  useAccount: useAccountMock,
  useSwitchChain: useSwitchChainMock,
  useConnectorClient: useConnectorClientMock,
  createConfig: vi.fn(() => ({})),
  http: vi.fn(() => ({})),
}))

vi.mock('@safe-vanity-blockie/safe-config', () => ({
  loadSafeConstants: loadSafeConstantsMock,
}))

vi.mock('../lib/deploy', () => ({ buildDeploymentPlan: buildDeploymentPlanMock }))

vi.mock('viem/actions', () => ({ sendTransaction: sendTransactionMock }))

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({ waitForTransactionReceipt: waitForTransactionReceiptMock })),
  http: vi.fn(() => ({})),
}))

vi.mock('@safe-global/protocol-kit', () => ({
  getSafeAddressFromDeploymentTx: getSafeAddressFromDeploymentTxMock,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('../components/ConfigForm', () => ({
  ConfigForm: ({ onSubmit }: { onSubmit: (config: unknown) => void }) => (
    <button type="button" onClick={() => onSubmit(CONFIG)}>
      submit-config
    </button>
  ),
}))

vi.mock('../components/FacePicker', () => ({
  FacePicker: (props: { value: string[] }) => {
    facePickerPropsRef.current = props
    return null
  },
}))

// Mirrors the real MiningView's contract: it stays mounted and its result rows stay visible
// and clickable regardless of `paused` — pausing stops the workers, it does not hide the
// leaderboard. That is what keeps "pick a different result while one is already selected"
// reachable, which is the exact path the DeployPanel `key` fix guards against.
const miningViewPropsRef = { current: undefined as { paused?: boolean } | undefined }
vi.mock('../components/MiningView', () => ({
  MiningView: (props: { paused?: boolean; onSelect: (candidate: unknown) => void }) => {
    miningViewPropsRef.current = props
    return (
      <div data-testid="mining-view">
        <p>{props.paused ? 'paused' : 'running'}</p>
        <button type="button" onClick={() => props.onSelect(CANDIDATE_A)}>
          select-a
        </button>
        <button type="button" onClick={() => props.onSelect(CANDIDATE_B)}>
          select-b
        </button>
      </div>
    )
  },
}))

beforeEach(() => {
  loadSafeConstantsMock.mockReset().mockResolvedValue({
    chainId: 1n,
    constants: {
      initializerHash: new Uint8Array(32),
      factory: new Uint8Array(20),
      initCodeHash: new Uint8Array(32),
    },
    constantsHex: {
      initializerHash: '0x' + '00'.repeat(32),
      factory: '0x' + '00'.repeat(20),
      initCodeHash: '0x' + '00'.repeat(32),
    },
    safeProvider: {},
    safeAccountConfig: { owners: CONFIG.owners, threshold: CONFIG.threshold },
    safeVersion: CONFIG.safeVersion,
  })
  buildDeploymentPlanMock.mockReset()
  sendTransactionMock.mockReset().mockResolvedValue('0xhash')
  waitForTransactionReceiptMock.mockReset().mockResolvedValue({ status: 'success' })
  getSafeAddressFromDeploymentTxMock.mockReset()
})

describe('Page', () => {
  it('pauses mining once a candidate is selected, and resumes it if the user goes back', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(screen.getByText('running')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(screen.getByText('paused')).toBeDefined()
    // MiningView itself is never unmounted: its leaderboard, including the selected row, stays
    // visible and its rows stay clickable (see the next test).
    expect(screen.getByTestId('mining-view')).toBeDefined()

    await user.click(screen.getByRole('button', { name: /back to mining/i }))
    expect(screen.getByText('running')).toBeDefined()
  })

  it('does not carry a previous deploy status/completed state onto a newly selected candidate (missing `key` regression)', async () => {
    buildDeploymentPlanMock.mockResolvedValue({
      address: CANDIDATE_A.address,
      chainId: CONFIG.chainId,
      transaction: { to: '0x' + '22'.repeat(20), value: '0', data: '0x' },
    })
    getSafeAddressFromDeploymentTxMock.mockReturnValue(CANDIDATE_A.address)

    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))

    const deployButton = () => screen.getByRole('button', { name: /^deploy this safe/i })
    await user.click(deployButton())

    expect(
      await screen.findByText(new RegExp(`Safe deployed at ${CANDIDATE_A.address}`, 'i')),
    ).toBeDefined()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(true)

    // Picks candidate B directly from the still-visible leaderboard — no deselect step, exactly
    // the sequence the finding describes: "deploy candidate A successfully, then click 'Use
    // this' on candidate B". This only resets state correctly because of `key={selected.address}`.
    await user.click(screen.getByRole('button', { name: 'select-b' }))

    // The panel now shows candidate B — the old success status naming candidate A's address
    // must be gone, and the deploy button must not be stuck disabled forever.
    expect(screen.queryByText(/Safe deployed at/i)).toBeNull()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(CANDIDATE_B.address)).toBeDefined()
    expect(screen.queryByText(CANDIDATE_A.address)).toBeNull()
  })

  it('seeds the default expression selection from ALL_MOUTH_NAMES, not a hardcoded list', async () => {
    const { ALL_MOUTH_NAMES } = await import('../lib/face-selection')

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    expect(facePickerPropsRef.current?.value).toEqual(ALL_MOUTH_NAMES)
  })
})
