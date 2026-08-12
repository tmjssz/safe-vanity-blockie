import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '../app/page'
import { encodeConfigParam } from '../lib/deep-link'

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
  searchParamsRef,
  linkCandidateOverride,
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
  facePickerPropsRef: {
    current: undefined as
      | { value: string[]; onChange: (names: string[]) => void }
      | undefined,
  },
  searchParamsRef: { current: new URLSearchParams() },
  // Lets one test replace candidateFromSaltNonce with a promise it controls. Left undefined by
  // default so every other test — NEW-1 in particular — keeps exercising the real deriver.
  linkCandidateOverride: { current: undefined as (() => Promise<unknown>) | undefined },
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
  // `../lib/config`'s validateMineConfig (exercised by decodeConfigParam, in the NEW-1 test
  // below) reads this directly — an empty set means nothing this suite's chain IDs collide with.
  ZKSYNC_CHAIN_IDS: new Set(),
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
  useSearchParams: () => searchParamsRef.current,
}))

// Partial mock: everything (encodeConfigParam, decodeConfigParam, and candidateFromSaltNonce
// itself) stays real unless a test installs an override, so the share-link tests keep driving
// the actual deriver. lib/ is off limits, so the seam has to be here at the module boundary.
vi.mock('../lib/deep-link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/deep-link')>()
  return {
    ...actual,
    candidateFromSaltNonce: (...args: Parameters<typeof actual.candidateFromSaltNonce>) =>
      (linkCandidateOverride.current?.() ?? actual.candidateFromSaltNonce(...args)) as ReturnType<
        typeof actual.candidateFromSaltNonce
      >,
  }
})

vi.mock('../components/ConfigForm', () => ({
  ConfigForm: ({ onSubmit }: { onSubmit: (config: unknown) => void }) => (
    <button type="button" onClick={() => onSubmit(CONFIG)}>
      submit-config
    </button>
  ),
}))

vi.mock('../components/FacePicker', () => ({
  // `onChange` is captured as well as `value`: the Face section never locks, so a test needs to
  // be able to change the expression at an arbitrary moment, exactly as a user can.
  FacePicker: (props: { value: string[]; onChange: (names: string[]) => void }) => {
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
  searchParamsRef.current = new URLSearchParams()
  linkCandidateOverride.current = undefined
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

// The deploy button now lives in a dialog; the panel only carries the trigger that opens it.
const deployTrigger = () => screen.getByRole('button', { name: /deploy this safe…/i })
const deployButton = () => screen.getByRole('button', { name: /^deploy this safe$/i })

/**
 * Makes `buildDeploymentPlan` hang until the returned callback releases it, so the window in
 * which mining is paused is observable at all — every step of the real sequence is mocked and
 * would otherwise settle within a tick or two of the click.
 */
function pendingDeploy() {
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<never>((_, rejectPlan) => {
    reject = rejectPlan
  })
  // The component attaches its own await; this handler only stops an early rejection from being
  // reported as unhandled.
  promise.catch(() => {})
  buildDeploymentPlanMock.mockReturnValue(promise)
  return async () => {
    await act(async () => {
      reject(new Error('wallet rejected the request'))
    })
  }
}

describe('Page', () => {
  it('keeps mining while a result is inspected, and pauses only while a deploy is in flight', async () => {
    const release = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(screen.getByText('running')).toBeDefined()

    // Selecting a candidate is NOT the trigger any more: the leaderboard keeps updating while
    // the user reads a result. MiningView is never unmounted either, so its rows stay visible
    // and clickable (see the next test).
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(screen.getByText('running')).toBeDefined()
    expect(screen.getByTestId('mining-view')).toBeDefined()

    // Neither is opening the dialog — only initiating the transaction.
    await user.click(deployTrigger())
    expect(screen.getByText('running')).toBeDefined()

    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()

    // …and it resumes as soon as the attempt settles, whichever way it settles.
    await release()
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())

    // Leaving the deploy step keeps mining running rather than stranding it paused.
    await user.keyboard('{Escape}')
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

    await user.click(deployTrigger())
    await user.click(deployButton())

    expect(
      await screen.findByText(new RegExp(`Safe deployed at ${CANDIDATE_A.address}`, 'i')),
    ).toBeDefined()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(true)

    // Picks candidate B directly from the still-visible leaderboard — no deselect step, exactly
    // the sequence the finding describes: "deploy candidate A successfully, then click 'Use
    // this' on candidate B". This only resets state correctly because of `key={selected.address}`.
    // The dialog has to be dismissed first only because it is modal; the leaderboard underneath
    // it is unchanged and still carries both rows.
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'select-b' }))

    // The panel now shows candidate B, and nothing of candidate A's deploy survives.
    expect(screen.getByText(CANDIDATE_B.address)).toBeDefined()
    expect(screen.queryByText(CANDIDATE_A.address)).toBeNull()

    // Reopening the dialog is what proves it: the old success status naming candidate A's
    // address must be gone, and the deploy button must not be stuck disabled forever.
    await user.click(deployTrigger())
    expect(screen.queryByText(/Safe deployed at/i)).toBeNull()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('NEW-1 regression: a share-link user who clicks "Back to mining" is not stranded paused forever', async () => {
    const release = pendingDeploy()
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: CONFIG.owners,
        threshold: CONFIG.threshold,
        safeVersion: CONFIG.safeVersion,
        chainId: CONFIG.chainId,
        saltNonce: '12345',
      }),
    })

    render(<Page />)
    const user = userEvent.setup()

    // The mocked ConfigForm ignores `initial` and always submits the same CONFIG, but that's
    // enough: what matters here is that the URL carried a saltNonce.
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    // The link candidate reconstructs and gets selected automatically — DeployPanel appears
    // without ever clicking a "select" button, and mining keeps running while it is inspected.
    await screen.findByRole('button', { name: /deploy this safe…/i })
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
    expect(screen.queryByText(/could not be reconstructed/i)).toBeNull()

    // Initiating the deploy is what pauses mining, even on this path where the candidate was
    // never picked by hand — and it resumes once the attempt settles.
    await user.click(deployTrigger())
    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()
    await release()
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
    await user.keyboard('{Escape}')

    // Clicking "Back to mining" must leave mining running, not paused — and must not print the
    // reconstruction-failed alert or otherwise re-enter an "awaiting the link candidate" limbo.
    await user.click(screen.getByRole('button', { name: /back to mining/i }))

    expect(screen.getByText('running')).toBeDefined()
    expect(screen.queryByText('paused')).toBeNull()
    expect(screen.queryByText(/could not be reconstructed/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /deploy this safe…/i })).toBeNull()
  })

  it('NEW-2 regression: changing the face while a link candidate is still reconstructing does not strand mining paused', async () => {
    const { ALL_MOUTH_NAMES } = await import('../lib/face-selection')
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: CONFIG.owners,
        threshold: CONFIG.threshold,
        safeVersion: CONFIG.safeVersion,
        chainId: CONFIG.chainId,
        saltNonce: '12345',
      }),
    })

    // Stands in for the real reconstruction, which awaits keccak's wasm instantiation and so
    // takes tens to hundreds of ms — long enough for a user to touch the still-live FacePicker.
    let resolveCandidate: (candidate: unknown) => void = () => {}
    linkCandidateOverride.current = () =>
      new Promise((resolve) => {
        resolveCandidate = resolve
      })

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    // Mining is deliberately held paused while the saltNonce is re-derived, rather than
    // spinning up workers just to stop them again a moment later.
    await waitFor(() => expect(screen.getByText('paused')).toBeDefined())

    // The Face section never locks, so this is a normal thing to do mid-flight. It hands
    // MiningView a new faceSpec, which re-runs the reconstruction effect: its cleanup cancels
    // the attempt in flight, and the `linkCandidateAttempted` ref stops a replacement one from
    // ever being started. Nothing else will ever end the "awaiting" state.
    act(() => {
      facePickerPropsRef.current?.onChange(ALL_MOUTH_NAMES.slice(0, 1))
    })

    await act(async () => {
      resolveCandidate(CANDIDATE_A)
    })

    // The cancelled result is correctly discarded — but the attempt has still settled, so
    // mining must be handed back. Otherwise `paused` is stuck true with no candidate, no "Back
    // to mining" button and no way to restart short of reloading the page.
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
    expect(screen.queryByText('paused')).toBeNull()
    expect(screen.queryByText(/could not be reconstructed/i)).toBeNull()
  })

  it('locks the config once submitted and restores the form when starting over', async () => {
    render(<Page />)

    // Before submitting, the config form is present.
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'submit-config' }))

    // Once submitted the form is replaced by a locked summary.
    expect(screen.queryByRole('button', { name: 'submit-config' })).toBeNull()
    expect(screen.getByText(/1 owner/i)).toBeDefined()

    // Starting over asks first, and only resets once confirmed.
    await userEvent.click(screen.getByRole('button', { name: /start over…/i }))
    expect(screen.queryByRole('button', { name: 'submit-config' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^start over$/i }))
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
    expect(screen.queryByText(/1 owner/i)).toBeNull()
  })

  it('seeds the default expression selection from ALL_MOUTH_NAMES, not a hardcoded list', async () => {
    const { ALL_MOUTH_NAMES } = await import('../lib/face-selection')

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    expect(facePickerPropsRef.current?.value).toEqual(ALL_MOUTH_NAMES)
  })
})
