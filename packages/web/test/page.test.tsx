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
  toastErrorSpy,
  toastSuccessSpy,
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
  toastErrorSpy: vi.fn(),
  toastSuccessSpy: vi.fn(),
}))

// The deploy dialog's terminal branches mirror themselves into a toast precisely because the
// inline message dies with the component: `<Toaster />` lives in app/layout.tsx, outside every
// subtree that can unmount here. Mocked so those calls are observable.
vi.mock('sonner', () => ({
  toast: { error: toastErrorSpy, success: toastSuccessSpy },
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

// `initial` is exposed as a data attribute rather than as text: the accessible name every other
// test queries by ("submit-config") must not change. It is here because the page's share-link
// prefill is otherwise invisible to this suite — dropping `initial` on the way to ConfigSection
// would leave the whole file green while every `?config=` link silently stopped reproducing the
// address it was made for.
vi.mock('../components/ConfigForm', () => ({
  ConfigForm: ({
    initial,
    onSubmit,
  }: {
    initial?: { owners?: string; threshold?: number; safeVersion?: string; chainId?: number }
    onSubmit: (config: unknown) => void
  }) => (
    <button
      type="button"
      data-initial={initial ? JSON.stringify(initial) : ''}
      onClick={() => onSubmit(CONFIG)}
    >
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
//
// `selectedAddress` is exposed as a data attribute rather than as text, for the same reason
// ConfigForm's `initial` is: the accessible names this file queries by must not change. Without
// it, deleting `selectedAddress={selected?.address}` in page.tsx leaves every test green while
// no result card is ever marked on any path.
const miningViewPropsRef = { current: undefined as { paused?: boolean } | undefined }
vi.mock('../components/MiningView', () => ({
  MiningView: (props: {
    paused?: boolean
    selectedAddress?: string
    onSelect: (candidate: unknown) => void
  }) => {
    miningViewPropsRef.current = props
    return (
      <div data-testid="mining-view" data-selected-address={props.selectedAddress ?? ''}>
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
  toastErrorSpy.mockClear()
  toastSuccessSpy.mockClear()
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

/**
 * Holds the sequence open at the point where the transaction has already been broadcast and only
 * the receipt is outstanding — the window in which gas is spent but nothing is known yet, and so
 * the one where losing the terminal message costs the user the most.
 */
function pendingReceipt() {
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<never>((_, rejectReceipt) => {
    reject = rejectReceipt
  })
  promise.catch(() => {})
  waitForTransactionReceiptMock.mockReturnValue(promise)
  return async (error: Error) => {
    await act(async () => {
      reject(error)
    })
  }
}

const PLAN_FOR = (address: string) => ({
  address,
  chainId: CONFIG.chainId,
  transaction: { to: '0x' + '22'.repeat(20), value: '0', data: '0x' },
})

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

  it('prefills the config form from a ?config= link, and drops that prefill on "Start over"', async () => {
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: CONFIG.owners,
        threshold: CONFIG.threshold,
        safeVersion: CONFIG.safeVersion,
        chainId: CONFIG.chainId,
      }),
    })

    render(<Page />)

    // Every field the Safe address is derived from reaches the form, or the link cannot
    // reproduce the address it was created for.
    expect(
      JSON.parse(screen.getByRole('button', { name: 'submit-config' }).dataset.initial || '{}'),
    ).toEqual({
      owners: CONFIG.owners.join(', '),
      threshold: CONFIG.threshold,
      safeVersion: CONFIG.safeVersion,
      chainId: CONFIG.chainId,
    })

    // "Start over" is a deliberate break with whatever the link asked for, so the form comes
    // back empty rather than re-seeded from it.
    await userEvent.click(screen.getByRole('button', { name: 'submit-config' }))
    await userEvent.click(screen.getByRole('button', { name: /start over…/i }))
    await userEvent.click(screen.getByRole('button', { name: /^start over$/i }))

    expect(screen.getByRole('button', { name: 'submit-config' }).dataset.initial).toBe('')
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

  // S1(a). Escape, the X and an overlay click all unmount DialogContent, and every terminal
  // branch of the deploy sequence then writes to a dead component. The accidental dismissals are
  // blocked outright while the sequence is in flight; only the relabelled footer button remains.
  it('S1: does not let Escape dismiss the deploy dialog while the sequence is in flight', async () => {
    const release = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployTrigger())
    await user.click(deployButton())

    await user.keyboard('{Escape}')

    // Still open: the send may already have reached the wallet, and closing here is what strands
    // the deploy with nowhere to report a hash.
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('button', { name: /deploying…/i })).toBeDefined()
    // …and the way out that is left does not read as "cancel the deployment", because nothing
    // here can recall a transaction the wallet already has.
    expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /close and keep waiting/i })).toBeDefined()

    await release()
  })

  // S1(b). Every route out of here — "Start over", "Back to mining", selecting another card —
  // unmounts DeployPanel and with it the inline status/error. Unmounting the page stands in for
  // all three. The toast is the only channel that outlives them.
  it('S1: a terminal deploy error still reaches the user after the deploy panel unmounts', async () => {
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_A.address))
    const releaseReceipt = pendingReceipt()

    const { unmount } = render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployTrigger())
    await user.click(deployButton())

    // Gas is now committed: the transaction is broadcast and only the receipt is outstanding.
    await screen.findByText(/Sent 0xhash/i)

    unmount()

    await releaseReceipt(new Error('the RPC connection dropped'))

    expect(toastErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Transaction 0xhash was already sent'),
    )
  })

  // S3. The page and MiningView each run their own uncached useSafeConstants, and nothing makes
  // them fail together. When only the page's fetch fails, `awaitingLinkCandidate` is false, the
  // reconstruction never runs, `linkCandidateError` is never set — and the whole payload of the
  // link, the mined saltNonce, is dropped with no message at all.
  it('S3: says so when a link carried a saltNonce and the constants read failed', async () => {
    loadSafeConstantsMock.mockReset().mockRejectedValue(new Error('rate limited by the public RPC'))
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
    await userEvent.click(screen.getByRole('button', { name: 'submit-config' }))

    expect(await screen.findByText(/rate limited by the public RPC/)).toBeDefined()
    // …and it falls through to a normal search rather than sitting paused forever.
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
  })

  // T4. Both share-link alerts were only ever asserted *absent*, which a deleted element also
  // satisfies. These two are the only tests that make either of them render.
  it('T4: explains a `?config=` link it could not decode', () => {
    searchParamsRef.current = new URLSearchParams({ config: 'not-base64' })

    render(<Page />)

    expect(screen.getByText(/this share link could not be used/i)).toBeDefined()
  })

  it('T4: explains a saltNonce that failed to reconstruct, and still starts mining', async () => {
    linkCandidateOverride.current = () => Promise.reject(new Error('keccak refused to load'))
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
    await userEvent.click(screen.getByRole('button', { name: 'submit-config' }))

    const alert = await screen.findByText(/could not be reconstructed/i)
    expect(alert.textContent).toMatch(/keccak refused to load/)
    // Falling through to a normal search is the intended behaviour — but silently is not.
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
  })

  // T2. DeployDialog.test.tsx makes loadSafeConstants reject immediately, so every one of its
  // tests bails out at the first await and none of these guards is ever reached. This suite has
  // the full mock chain, so it is the cheapest place to drive the sequence into each of them.

  it('T2: refuses to send when the deployment plan does not name the selected candidate', async () => {
    // The plan is built from an INDEPENDENT loadSafeConstants re-read inside the dialog; the
    // candidate's address came from the page's own read. Disagreeing constants is exactly what
    // this guard exists to catch, and the consequence of losing it is a transaction deploying a
    // Safe at an address that is not the one on the card the user picked.
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_B.address))

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployTrigger())
    await user.click(deployButton())

    const message = await screen.findByText(/does not match the selected candidate/i)
    expect(message.textContent).toContain(CANDIDATE_A.address)
    expect(message.textContent).toContain(CANDIDATE_B.address)
    // Nothing is spent: the refusal happens before the send, not after it.
    expect(sendTransactionMock).not.toHaveBeenCalled()
  })

  it('T2: reports a reverted deployment as a gas-spent failure, never as a success', async () => {
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_A.address))
    waitForTransactionReceiptMock.mockResolvedValue({ status: 'reverted' })
    getSafeAddressFromDeploymentTxMock.mockReturnValue(CANDIDATE_A.address)

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployTrigger())
    await user.click(deployButton())

    const message = await screen.findByText(/Deployment reverted\. Gas was spent\./i)
    expect(message.textContent).toContain('0xhash')
    expect(screen.queryByText(/Safe deployed at/i)).toBeNull()
  })

  it('T2: cross-checks the receipt logs against the predicted address before claiming success', async () => {
    const THIRD = '0x' + 'dd'.repeat(20)
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_A.address))
    getSafeAddressFromDeploymentTxMock.mockReturnValue(THIRD)

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployTrigger())
    await user.click(deployButton())

    const message = await screen.findByText(/does not match the predicted/i)
    expect(message.textContent).toContain(THIRD)
    expect(message.textContent).toContain(CANDIDATE_A.address)
    expect(screen.queryByText(/Safe deployed at/i)).toBeNull()
  })

  it('T2: warns that the transaction may already be broadcast when the send itself fails', async () => {
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_A.address))
    sendTransactionMock.mockRejectedValue(new Error('the wallet never answered'))

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployTrigger())
    await user.click(deployButton())

    // `sendDispatched` is set before the await precisely so this branch survives a throw from
    // inside sendTransaction, where gas may already have been committed.
    const message = await screen.findByText(/may already have been broadcast/i)
    expect(message.textContent).toContain('the wallet never answered')
  })

  // T3. `selectedAddress` is optional, so deleting it in page.tsx typechecks and no test noticed:
  // the ring and the "Selected" badge are the only things tying the open deploy panel to a row in
  // a grid that keeps re-sorting itself while a result is inspected.
  it('T3: tells MiningView which card the deploy panel is showing', async () => {
    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    expect(screen.getByTestId('mining-view').dataset.selectedAddress).toBe('')

    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(screen.getByTestId('mining-view').dataset.selectedAddress).toBe(CANDIDATE_A.address)

    await user.click(screen.getByRole('button', { name: 'select-b' }))
    expect(screen.getByTestId('mining-view').dataset.selectedAddress).toBe(CANDIDATE_B.address)
  })

  it('seeds the default expression selection from ALL_MOUTH_NAMES, not a hardcoded list', async () => {
    const { ALL_MOUTH_NAMES } = await import('../lib/face-selection')

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    expect(facePickerPropsRef.current?.value).toEqual(ALL_MOUTH_NAMES)
  })
})
