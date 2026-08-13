import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '../app/page'
import { decodeConfigParam, encodeConfigParam } from '../lib/deep-link'

// Drives the real Page end to end, mocking only the heavy children and the wallet/RPC boundary.
//
// One thing to know before reading the `key` regression test below: it is deliberately NOT a
// reproduction of anything a user can currently do. Handing the dialog a second candidate with no
// unmount in between would leave the first candidate's `status`/`completed` state rendered above
// the second one's address, and `key={selected.address}` is what prevents that — but see the
// comment in page.tsx: no code path reaches that state today. The test exists so the guard cannot
// be deleted as dead weight, and it drives the swap through the mocked MiningView, which is
// exactly why it can reach a state the real one cannot.

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
  historySync,
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
  // The address bar, as the App Router presents it to useSearchParams(). It is a subscribable
  // store rather than a bare `{ current }` because the page now WRITES the URL as well as
  // reading it: a mock that only ever returned whatever a test assigned would hide the feedback
  // loop this whole change has to survive (a written `?config=` coming straight back in as a
  // "share link"). Tests still assign `searchParamsRef.current` exactly as before; the setter
  // additionally puts window.location in step, because the page's popstate reconciliation reads
  // location directly and in a browser the two can never disagree.
  ...(() => {
    const listeners = new Set<() => void>()
    let params = new URLSearchParams()
    const publish = (next: URLSearchParams) => {
      params = next
      for (const listener of listeners) listener()
    }
    return {
      historySync: {
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        // Identity is stable between writes, which useSyncExternalStore requires.
        snapshot: () => params,
        fromLocation: () => publish(new URLSearchParams(window.location.search)),
      },
      searchParamsRef: {
        get current() {
          return params
        },
        set current(next: URLSearchParams) {
          const query = next.toString()
          window.history.replaceState(null, '', query ? `/?${query}` : '/')
          publish(next)
        },
      },
    }
  })(),
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
  useConnect: () => ({ connect: vi.fn(), connectors: [], isPending: false }),
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

// The App Router patches window.history.pushState/replaceState so that a client-side URL write is
// reflected by useSearchParams() — dist/client/components/app-router.js hands the new URL to
// ACTION_RESTORE before delegating to the native method. jsdom does not, so the two lines below
// stand in for that patch, and useSearchParams() is a real subscription rather than a snapshot.
// Without this the suite would be testing a page whose URL writes it cannot see, which is
// precisely the half that can go wrong.
const nativePushState = window.history.pushState.bind(window.history)
window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
  nativePushState(data, unused, url)
  historySync.fromLocation()
}) as typeof window.history.pushState
window.addEventListener('popstate', () => historySync.fromLocation())

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSearchParams: () => useSyncExternalStore(historySync.subscribe, historySync.snapshot),
  }
})

/**
 * Drives a real history traversal and waits for the popstate it queues. jsdom implements
 * same-document back/forward as a task, so nothing about it is observable in the turn that asks
 * for it — and the page's own close/reopen hangs off exactly that event.
 */
async function traverse(go: () => void) {
  const before = window.location.href
  await act(async () => {
    go()
    for (let attempt = 0; attempt < 50 && window.location.href === before; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    // One more turn so the popstate listeners (the page's, and the searchParams mirror above)
    // have run before any assertion.
    await new Promise((resolve) => setTimeout(resolve, 1))
  })
}

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
// leaderboard. That is what puts the user straight back on a live grid when the deploy dialog
// closes, with every card still openable.
//
// Its two buttons stand in for "the page is handed a candidate". A real card click is one way;
// the link-candidate reconstruction in page.tsx setting `selected` from an effect is another,
// and that one can fire while a dialog is already open — the path the `key` guards.
const miningViewPropsRef = {
  current: undefined as
    | { paused?: boolean; onSelect: (candidate: unknown) => void }
    | undefined,
}
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

// The one SafeSetup every loadSafeConstants call in this suite resolves to. Hoisted out of
// beforeEach so a test can derive the same candidate the page will, from the same constants,
// instead of hardcoding an address the deriver would have to be trusted to reproduce.
const SAFE_SETUP = {
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
}

beforeEach(() => {
  searchParamsRef.current = new URLSearchParams()
  linkCandidateOverride.current = undefined
  loadSafeConstantsMock.mockReset().mockResolvedValue(SAFE_SETUP)
  buildDeploymentPlanMock.mockReset()
  sendTransactionMock.mockReset().mockResolvedValue('0xhash')
  waitForTransactionReceiptMock.mockReset().mockResolvedValue({ status: 'success' })
  getSafeAddressFromDeploymentTxMock.mockReset()
  toastErrorSpy.mockClear()
  toastSuccessSpy.mockClear()
})

// Clicking a result opens the dialog directly — there is no intermediate panel or trigger left.
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
  it('opens the deploy dialog on a result click, in one step, with everything in it', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'select-a' }))

    // One click, no intermediate panel and no second trigger: the dialog is open and carries the
    // address, the saltNonce, the share link and the button that spends the gas.
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(CANDIDATE_A.address)
    expect(dialog.textContent).toContain(CANDIDATE_A.saltNonce)
    expect(screen.getByRole('textbox', { name: /share link/i })).toBeDefined()
    expect(deployButton()).toBeDefined()
    // The two-step flow's own controls are gone with it.
    expect(screen.queryByRole('button', { name: /deploy this safe…/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /back to mining/i })).toBeNull()
  })

  // The headline of the URL/history work: the address bar has to name the result that is open,
  // and it has to be a history ENTRY — a silent replace would put the link in the bar but leave
  // Back doing something else entirely.
  it('puts the open result in the address bar as a history entry, and Back closes the dialog', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(window.location.search).toBe('')

    await user.click(screen.getByRole('button', { name: 'select-a' }))

    // Not "a URL containing the saltNonce": the *same* link the dialog renders, character for
    // character. Two encoders that agree today are two encoders that can drift tomorrow, and the
    // one in the bar is the one users copy.
    const shared = (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value
    expect(window.location.href).toBe(shared)

    await traverse(() => window.history.back())

    // Back closes the dialog and takes the URL with it. A Back that left either behind would be
    // worse than never having touched the URL.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.search).toBe('')
  })

  // Trap 1. `awaitingLinkCandidate` is `Boolean(linkSaltNonce) && !linkCandidateSettled &&
  // !constantsForLink.error`, and on an ordinary mining session `linkCandidateSettled` is false
  // forever. So a `?config=` carrying a saltNonce arriving in the URL — which is exactly what
  // opening a dialog now does, and which the App Router's patched pushState feeds straight back
  // into useSearchParams() — would make that expression true: the full-screen resolving overlay
  // over the dialog that caused it, and mining paused behind it, until a reload.
  it('does not read its own URL write back as a share link: no spinner over the dialog, no pause', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))

    expect(window.location.search).toContain('config=')
    expect(spinner()).toBeNull()
    expect(screen.getByText('running')).toBeDefined()
    // Nor the RPC read that resolving a link would start: the page's own useSafeConstants is the
    // only caller of this before a deploy is clicked (MiningView is mocked).
    expect(loadSafeConstantsMock).not.toHaveBeenCalled()
    // And the reconstruction never ran, so nothing could have replaced what is on screen.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)

    // Still true after Back and Forward, which is where the same state is re-derived.
    await traverse(() => window.history.back())
    expect(spinner()).toBeNull()
    expect(screen.getByText('running')).toBeDefined()
    await traverse(() => window.history.forward())
    expect(spinner()).toBeNull()
    expect(screen.getByText('running')).toBeDefined()
    expect(loadSafeConstantsMock).not.toHaveBeenCalled()
  })

  it('reopens the result on Forward, with the config its address came from', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const shared = (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value

    await traverse(() => window.history.back())
    expect(screen.queryByRole('dialog')).toBeNull()

    await traverse(() => window.history.forward())

    // The same candidate, and the same share link — the selection is restored from the entry
    // rather than reconstructed out of the URL, so the candidate/config pairing is the original.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(
      (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value,
    ).toBe(shared)
    expect(window.location.href).toBe(shared)
  })

  // The headline of this change: closing the dialog by hand is a FORWARD step, not a rewind. The
  // base URL is pushed, so the dialog's own URL stays behind the user and Back reopens it — the
  // open dialog is a navigable state rather than a transient one. (It was a `history.back()`
  // before, which consumed the entry: Back from the closed dialog reached whatever was before it
  // and the result could only be got back with Forward.)
  it('pushes the base URL when the dialog is closed by hand, and Back reopens the same result', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(window.location.search).toContain('config=')
    const shared = (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value

    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).toBeNull()

    await traverse(() => window.history.back())

    // The same result, from the entry the close left behind — and the same paired config, so the
    // share link the reopened dialog renders is the original character for character.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(
      (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value,
    ).toBe(shared)
    expect(window.location.href).toBe(shared)

    // And Forward from there is the close again: base URL, no dialog.
    await traverse(() => window.history.forward())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.search).toBe('')
  })

  // Closing is a synchronous push now, so the gap this used to guard — a card clicked while the
  // close's `history.back()` was still traversing, whose entry the traversal would then pop — no
  // longer exists, and `backInFlight`/`deferredPush` went with it. The sequence is still worth
  // driving with nothing awaited in between: two pushes land back to back, and the second one has
  // to be the one the address bar and the dialog both describe.
  it('opens the next result cleanly when a card is clicked straight after a close', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))

    // fireEvent, so nothing is awaited between the two: this is the gap, driven deliberately.
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    fireEvent.click(screen.getByText('select-b'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(CANDIDATE_B.address)
    expect(window.location.href).toBe(
      (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value,
    )
  })

  it('closes the dialog and resumes mining when Back is pressed while the wallet prompt is open', async () => {
    const release = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()

    await traverse(() => window.history.back())

    // Same contract as the footer's "Close and keep waiting": the dialog goes, the toast mirror
    // carries the outcome, and mining is handed back rather than left paused by a host that is
    // no longer on screen.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('running')).toBeDefined()
    expect(window.location.search).toBe('')

    await release()
  })

  it('keeps mining while a result is inspected, and pauses only while a deploy is in flight', async () => {
    const release = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(screen.getByText('running')).toBeDefined()

    // Opening the dialog is NOT the trigger: the leaderboard keeps updating while the user reads
    // a result. MiningView is never unmounted either, so its rows stay live underneath.
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(screen.getByText('running')).toBeDefined()
    expect(screen.getByTestId('mining-view')).toBeDefined()

    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()

    // …and it resumes as soon as the attempt settles, whichever way it settles.
    await release()
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())

    // Closing the dialog leaves mining running rather than stranding it paused, and puts the
    // grid back in front of the user.
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('running')).toBeDefined()
    expect(screen.getByTestId('mining-view')).toBeDefined()
  })

  // The "Back to mining" button used to carry this belt-and-braces clear; closing the dialog is
  // the only way out now. Without `setDeploying(false)` in `onOpenChange`, dismissing while the
  // wallet prompt is still open leaves mining paused by the HOST — which the status bar's own
  // Resume cannot clear — with nothing left on screen able to hand it back.
  it('resumes mining when the dialog is dismissed while the wallet prompt is still open', async () => {
    const release = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()

    // The one dismissal left live while busy — deliberate, and relabelled so it never reads as
    // "cancel the deployment".
    await user.click(screen.getByRole('button', { name: /close and keep waiting/i }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('running')).toBeDefined()
    expect(screen.queryByText('paused')).toBeNull()

    await release()
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
    await user.click(deployButton())

    expect(
      await screen.findByText(new RegExp(`Safe deployed at ${CANDIDATE_A.address}`, 'i')),
    ).toBeDefined()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(true)

    // Hands the page candidate B while the dialog is still mounted — no close, so React reuses
    // the element position and only `key={selected.address}` forces a fresh instance.
    //
    // NOT a reachable sequence: the real MiningView cannot call `onSelect` from behind a modal
    // overlay, and the only other `setSelected` caller (the link-candidate effect) runs in a
    // window where `awaitingLinkCandidate` has left the grid empty, so no dialog can be open to
    // swap underneath. The mock can make the call the real component cannot, which is the whole
    // point: it pins the guard so nobody deletes it as redundant, without pretending the hole is
    // currently open. fireEvent rather than userEvent because the modal sets `pointer-events:
    // none` on the rest of the body — a real click is precisely what this is not.
    fireEvent.click(screen.getByText('select-b'))

    // The dialog now shows candidate B, and nothing of candidate A's deploy survives: not the
    // success status naming A's address, and not the permanently disabled button.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_B.address)
    expect(screen.queryByText(CANDIDATE_A.address)).toBeNull()
    expect(screen.queryByText(/Safe deployed at/i)).toBeNull()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('opens a clean dialog when a second result is clicked after closing the first', async () => {
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
    await user.click(deployButton())
    expect(
      await screen.findByText(new RegExp(`Safe deployed at ${CANDIDATE_A.address}`, 'i')),
    ).toBeDefined()

    // Escape is allowed once the sequence has settled — and closing clears the selection, so the
    // grid underneath is immediately clickable again.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'select-b' }))

    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_B.address)
    expect(screen.queryByText(/Safe deployed at/i)).toBeNull()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false)
  })

  // The headline behaviour: a link is an invitation to look at ONE specific Safe. Opening it used
  // to land on the ordinary starting screen — form prefilled, no result, no dialog — because the
  // candidate was derived from the *submitted* config, which does not exist until the recipient
  // submits. It now derives from the link's own config, which carries everything the address needs.
  // And it does that without mining: clicking someone's link must not spin up five to eight
  // workers at full CPU unasked.
  it('opens the deploy dialog on the candidate a link names, with no submit and no mining', async () => {
    const { candidateFromSaltNonce } = await vi.importActual<typeof import('../lib/deep-link')>(
      '../lib/deep-link',
    )
    const { ALL_MOUTH_NAMES, faceSpecFromSelection } = await import('../lib/face-selection')
    const expected = await candidateFromSaltNonce(
      SAFE_SETUP.constants,
      '12345',
      faceSpecFromSelection(ALL_MOUTH_NAMES),
    )
    // Deliberately NOT the owners the mocked ConfigForm submits: every constants read below can
    // therefore be attributed to one config or the other.
    const LINK_OWNERS = ['0x' + '33'.repeat(20)]
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(expected.address))
    getSafeAddressFromDeploymentTxMock.mockReturnValue(expected.address)

    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: LINK_OWNERS,
        threshold: 1,
        safeVersion: CONFIG.safeVersion,
        chainId: CONFIG.chainId,
        saltNonce: '12345',
      }),
    })

    render(<Page />)
    const user = userEvent.setup()

    // No submit anywhere above this line.
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(expected.address)
    expect(dialog.textContent).toContain('12345')
    // Everything the dialog carries for a mined result carries here too, including a link that
    // reproduces this same address.
    expect(screen.getByRole('textbox', { name: /share link/i })).toBeDefined()
    expect(deployButton()).toBeDefined()
    expect(screen.queryByText(/could not be reconstructed/i)).toBeNull()

    // Nothing is mining: MiningView is not mounted at all, and the Configure form is still
    // sitting there unsubmitted for a recipient who wants to start their own search. `hidden`
    // because the dialog is modal and Radix aria-hides the page behind it — the form is there,
    // and is what the recipient meets when they close the dialog.
    expect(screen.queryByTestId('mining-view')).toBeNull()
    expect(screen.getByRole('button', { name: 'submit-config', hidden: true })).toBeDefined()
    // …and not the locked "1 owner · threshold 1 · …" summary, which would mean it had been
    // submitted and a search started on the recipient's behalf.
    expect(screen.queryByText(/1 owner/i)).toBeNull()

    // Deploying from here has to work, and has to work with the LINK's config — this is the one
    // path on which the dialog's config did not come from the page's submitted state, and it is
    // the path nothing else in this suite drives. A refactor that reached for the page's `config`
    // anywhere in the deploy branch would leave every rendered detail above correct and build the
    // plan from something else entirely.
    await user.click(deployButton())

    expect(
      await screen.findByText(new RegExp(`Safe deployed at ${expected.address}`, 'i')),
    ).toBeDefined()
    // The dialog's own independent constants re-read asked about the link's Safe, not the
    // recipient's — `toHaveBeenLastCalledWith`, so this is the deploy path's read and not the
    // page's earlier one.
    expect(loadSafeConstantsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        owners: LINK_OWNERS,
        threshold: 1,
        safeVersion: CONFIG.safeVersion,
      }),
    )
    expect(buildDeploymentPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ saltNonce: '12345', chainId: CONFIG.chainId }),
    )
    // And the last-resort guard never had anything to catch.
    expect(screen.queryByText(/does not match the selected candidate/i)).toBeNull()
  })

  // Resolving a link is a real wait — an RPC round trip for the constants, then keccak's wasm
  // init — and until it finishes the page has nothing on it but a prefilled form. These three pin
  // the whole window and all three of its exits: it is `awaitingLinkCandidate` that is on screen,
  // which is the same flag that holds mining, so there is no second source of truth to drift.
  const linkParams = () =>
    new URLSearchParams({
      config: encodeConfigParam({
        owners: CONFIG.owners,
        threshold: CONFIG.threshold,
        safeVersion: CONFIG.safeVersion,
        chainId: CONFIG.chainId,
        saltNonce: '12345',
      }),
    })
  const spinner = () => screen.queryByRole('status', { name: /share link/i })

  it('shows a spinner naming what it is waiting for while a share link resolves, until the dialog is up', async () => {
    let started = 0
    let resolveCandidate: (candidate: unknown) => void = () => {}
    linkCandidateOverride.current = () => {
      started++
      return new Promise((resolve) => {
        resolveCandidate = resolve
      })
    }
    searchParamsRef.current = linkParams()

    render(<Page />)

    // Present from the first paint — before the constants read has even been dispatched — and it
    // says what is being waited on rather than spinning anonymously.
    expect(spinner()).not.toBeNull()
    expect(spinner()?.textContent).toMatch(/share link/i)
    expect(screen.queryByRole('dialog')).toBeNull()

    // Still there once the constants have landed and the derivation itself is running: the wait
    // this covers is both halves, not just the RPC.
    await waitFor(() => expect(started).toBe(1))
    expect(spinner()).not.toBeNull()

    await act(async () => {
      resolveCandidate(CANDIDATE_A)
    })

    // It hands over to the dialog, and does not linger behind it.
    expect(await screen.findByRole('dialog')).toBeDefined()
    expect(spinner()).toBeNull()
  })

  it('replaces the share-link spinner with the failure when the reconstruction rejects', async () => {
    let started = 0
    let rejectCandidate: (error: Error) => void = () => {}
    linkCandidateOverride.current = () => {
      started++
      return new Promise((_, reject) => {
        rejectCandidate = reject
      })
    }
    searchParamsRef.current = linkParams()

    render(<Page />)
    expect(spinner()).not.toBeNull()
    await waitFor(() => expect(started).toBe(1))

    await act(async () => {
      rejectCandidate(new Error('keccak refused to load'))
    })

    // A spinner that outlives the failure is worse than no spinner: it promises a result that is
    // never coming, next to the alert saying so.
    expect(await screen.findByText(/could not be reconstructed/i)).toBeDefined()
    expect(spinner()).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('replaces the share-link spinner with the failure when the constants read fails', async () => {
    let rejectConstants: (error: Error) => void = () => {}
    loadSafeConstantsMock.mockReset().mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectConstants = reject
        }),
    )
    searchParamsRef.current = linkParams()

    render(<Page />)
    expect(spinner()).not.toBeNull()

    await act(async () => {
      rejectConstants(new Error('rate limited by the public RPC'))
    })

    expect(await screen.findByText(/rate limited by the public RPC/)).toBeDefined()
    expect(spinner()).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows no share-link spinner on the ordinary no-link path', async () => {
    render(<Page />)
    expect(spinner()).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(spinner()).toBeNull()
  })

  // The recipient can submit the prefilled form (or an edited one) while the reconstruction is
  // still in flight — the constants read is a real network round trip. The resolving overlay
  // swallows pointer events for that window, but it deliberately traps no focus and marks nothing
  // inert, so a keyboard submit still lands; this stays a reachable sequence, not a hypothetical.
  // Whatever they submit, the candidate on screen has to stay the one the LINK names: it is the
  // link's saltNonce, and only the link's own owners/threshold/version/chain reproduce the address
  // it was mined for.
  it("derives the link candidate from the link's own config, never from one submitted underneath it", async () => {
    const LINK_OWNERS = ['0x' + '33'.repeat(20)]
    const LINK_SETUP = {
      ...SAFE_SETUP,
      constants: {
        initializerHash: new Uint8Array(32).fill(7),
        factory: new Uint8Array(20).fill(7),
        initCodeHash: new Uint8Array(32).fill(7),
      },
    }
    const { candidateFromSaltNonce } = await vi.importActual<typeof import('../lib/deep-link')>(
      '../lib/deep-link',
    )
    const { ALL_MOUTH_NAMES, faceSpecFromSelection } = await import('../lib/face-selection')
    const faceSpec = faceSpecFromSelection(ALL_MOUTH_NAMES)
    const fromLink = await candidateFromSaltNonce(LINK_SETUP.constants, '12345', faceSpec)
    const fromSubmitted = await candidateFromSaltNonce(SAFE_SETUP.constants, '12345', faceSpec)
    // Different constants, different address — otherwise this test could not tell them apart.
    expect(fromLink.address).not.toBe(fromSubmitted.address)

    // Held open so the submit below lands *during* the reconstruction, which is the ordering that
    // used to be able to feed it the wrong config's constants.
    let releaseLinkConstants: (setup: unknown) => void = () => {}
    loadSafeConstantsMock.mockReset().mockImplementation(({ owners }: { owners: string[] }) =>
      owners[0] === LINK_OWNERS[0]
        ? new Promise((resolve) => {
            releaseLinkConstants = resolve
          })
        : Promise.resolve(SAFE_SETUP),
    )

    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: LINK_OWNERS,
        threshold: 1,
        safeVersion: CONFIG.safeVersion,
        chainId: CONFIG.chainId,
        saltNonce: '12345',
      }),
    })

    render(<Page />)
    const user = userEvent.setup()

    // The mocked ConfigForm submits CONFIG — a different set of owners from the link's, exactly
    // as a recipient who edits the prefilled form would.
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await waitFor(() => expect(screen.getByText('paused')).toBeDefined())

    await act(async () => {
      releaseLinkConstants(LINK_SETUP)
    })

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(fromLink.address)
    expect(dialog.textContent).not.toContain(fromSubmitted.address)
    // And the recipient's own search is handed back the moment the reconstruction settles.
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
  })

  // The config the dialog deploys with and the config the address on it was derived from are the
  // same object, by construction. This is the state that puts the two in tension: a link candidate
  // on screen, a DIFFERENT config submitted and mining underneath it.
  //
  // That state is reachable by a real user — the test above walks straight into it by submitting
  // *during* the reconstruction (by keyboard: the overlay takes the pointer route but not focus),
  // before any dialog exists. Only this particular ORDERING (submit after the dialog is already
  // up) is out of reach, because the dialog is modal
  // and the form behind it takes no clicks; userEvent refuses one outright, which is why fireEvent
  // is used here, as in the `key` test above. So the modal is not what makes any of this safe, and
  // nothing here may rest on it: the pairing of candidate and config is the whole guarantee.
  // DeployDialog's `plan.address !== candidate.address` refusal would catch a drift after the
  // fact, at the wallet step; nothing should ever get that far.
  it('keeps the deploy dialog on the config its address came from when a different one is submitted underneath it', async () => {
    const LINK_OWNERS = ['0x' + '33'.repeat(20)]
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: LINK_OWNERS,
        threshold: 1,
        safeVersion: CONFIG.safeVersion,
        chainId: CONFIG.chainId,
        saltNonce: '12345',
      }),
    })

    render(<Page />)
    const dialog = await screen.findByRole('dialog')
    const address = dialog.textContent

    const sharedConfig = () => {
      const url = (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value
      return decodeConfigParam(new URL(url, 'http://localhost').searchParams.get('config') ?? '')
        .config
    }
    expect(sharedConfig()?.owners).toEqual(LINK_OWNERS)

    fireEvent.click(screen.getByText('submit-config'))

    // The recipient's own search is now running on THEIR config…
    await waitFor(() => expect(screen.getByTestId('mining-view')).toBeDefined())
    // …and the dialog has not moved: same address, and a share link that still names the link's
    // config — the one that produced that address, and the one a deploy from here would use.
    expect(screen.getByRole('dialog').textContent).toBe(address)
    expect(sharedConfig()?.owners).toEqual(LINK_OWNERS)
    expect(sharedConfig()?.owners).not.toEqual(CONFIG.owners)
    expect(sharedConfig()?.saltNonce).toBe('12345')
    // …and it says so on screen, which is the point of the dialog naming its config at all: this
    // is the state where the Configure card behind it summarises the recipient's owners while
    // the dialog would deploy the sender's. The owners on screen are the link's.
    expect(screen.getByText(LINK_OWNERS[0] as string)).toBeDefined()
    expect(screen.queryByText(CONFIG.owners[0] as string)).toBeNull()

    // And a deploy started from this mixed state acts on the link's config too — the rendered
    // link and the config the plan is built from are the same thing, which is exactly what a
    // "read `config` instead of `selection.config` at deploy time" refactor would separate:
    // everything asserted above would still pass while this read used the recipient's owners.
    const shownAddress = (address ?? '').match(/0x[0-9a-fA-F]{40}/)?.[0]
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(shownAddress ?? ''))
    getSafeAddressFromDeploymentTxMock.mockReturnValue(shownAddress)
    fireEvent.click(deployButton())

    expect(
      await screen.findByText(new RegExp(`Safe deployed at ${shownAddress}`, 'i')),
    ).toBeDefined()
    expect(loadSafeConstantsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ owners: LINK_OWNERS }),
    )
    expect(screen.queryByText(/does not match the selected candidate/i)).toBeNull()
  })

  it('NEW-1 regression: a share-link user who closes the deploy dialog is not stranded paused forever', async () => {
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

    // The link candidate reconstructs and gets selected automatically, with no submit at all —
    // the reconstruction now runs off the link's own config, so the dialog is already open.
    await screen.findByRole('dialog')
    expect(screen.queryByText(/could not be reconstructed/i)).toBeNull()

    // Closing it is the moment this test exists for: `awaitingLinkCandidate` used to be derived
    // from `!selected`, so clearing the selection here flipped it back to true — and every search
    // the recipient started afterwards was paused before it began, with no candidate and no way
    // out. The mocked ConfigForm ignores `initial` and always submits the same CONFIG, but that's
    // enough: what matters is that the URL carried a saltNonce.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())

    // Initiating the deploy — here on a hand-picked card from the recipient's own search, since
    // that is what exists after the link dialog has been closed — is what pauses mining, and it
    // resumes once the attempt settles. (Deploying the LINK's candidate is covered by the headline
    // test above, which does it on the dialog the link itself opened.)
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(screen.getByText('running')).toBeDefined()
    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()
    await release()
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())

    // Closing the dialog must leave mining running, not paused — and must not print the
    // reconstruction-failed alert or otherwise re-enter an "awaiting the link candidate" limbo.
    await user.keyboard('{Escape}')

    expect(screen.getByText('running')).toBeDefined()
    expect(screen.queryByText('paused')).toBeNull()
    expect(screen.queryByText(/could not be reconstructed/i)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // A recipient is already standing on the URL that names the open dialog, so there is nothing to
  // push: a second, identical entry would be a duplicate the URL cannot even show. The link they
  // were sent is also left exactly as they received it rather than rewritten to this app's
  // canonical encoding of the same config.
  it('leaves the address bar alone when the dialog was opened by the link already in it', async () => {
    searchParamsRef.current = linkParams()
    const received = window.location.href

    render(<Page />)
    const user = userEvent.setup()
    await screen.findByRole('dialog')

    expect(window.location.href).toBe(received)

    // Closing pushes the base URL over the link's own entry rather than reaching for one this
    // page never pushed — a `history.back()` here would have walked the recipient off the app
    // entirely, in a fresh tab off the front of the stack.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // The subtle case of the forward-close model, and the one entry that has no `WrittenEntry` to
  // restore from: the link's own. It was put in the stack by whoever opened the link, so it is not
  // in `writtenSelections` — and a recipient who closes their dialog is now exactly one Back away
  // from it. Landing there must reopen the sender's result, from the pair reconstructed once at
  // mount, and must not be mistaken for a share link arriving *now*: that would latch, drop the
  // full-screen resolving overlay over the dialog and pause mining behind it.
  it("reopens a share link's own dialog when Back returns to the URL the page was loaded on", async () => {
    searchParamsRef.current = linkParams()
    const received = window.location.href

    render(<Page />)
    const user = userEvent.setup()
    const address = (await screen.findByRole('dialog')).textContent

    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))

    await traverse(() => window.history.back())

    expect(window.location.href).toBe(received)
    // The sender's candidate, and the same share link — not a second reconstruction, and not a
    // config re-derived from the URL.
    expect(screen.getByRole('dialog').textContent).toBe(address)
    expect(
      (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value,
    ).toBe(received)
    // Not latched as an incoming link: no overlay over the dialog, and no second constants read
    // for a reconstruction that already happened. (One call, from the mount.)
    expect(spinner()).toBeNull()
    expect(loadSafeConstantsMock).toHaveBeenCalledTimes(1)

    // Forward is the close again, and closing again pushes over it — so the result stays one
    // Back away however many times the user does this.
    await traverse(() => window.history.forward())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.search).toBe('')
  })

  // "Start over" puts the link out of reach for good — the prefill, the saltNonce, its errors. The
  // held selection its own history entry restores from has to go with it, or Back would put the
  // sender's dialog, with a live Deploy button, back on a page that has just been reset.
  it("does not reopen a share link's dialog on Back after \"Start over\"", async () => {
    searchParamsRef.current = linkParams()
    const received = window.location.href

    render(<Page />)
    const user = userEvent.setup()
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: /start over…/i }))
    await user.click(screen.getByRole('button', { name: /^start over$/i }))

    await traverse(() => window.history.back())

    expect(window.location.href).toBe(received)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Still the latched link param, so it is not read as one arriving now: no overlay, and the
    // page stays the unlocked starting screen the reset left.
    expect(spinner()).toBeNull()
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
  })

  // The whole stack, in the session where `linkCandidateSettled` is true and a link's saltNonce is
  // sitting in the latch: the link's entry, the base entry its close pushed, the recipient's own
  // result, and the base entry that close pushed. Walking back through all four must not restart
  // anything — the reconstruction is one-shot and already spent — and must not pause the search
  // the recipient started.
  it('walks back through a link session entry by entry, reopening each dialog on the way', async () => {
    searchParamsRef.current = linkParams()
    const linkUrl = window.location.href

    render(<Page />)
    const user = userEvent.setup()

    const linkAddress = (await screen.findByRole('dialog')).textContent
    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())

    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const minedUrl = (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement)
      .value
    expect(window.location.href).toBe(minedUrl)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))

    // Back onto the mined result: its own entry, restored from the map.
    await traverse(() => window.history.back())
    expect(window.location.href).toBe(minedUrl)
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)

    // Back again onto the base entry the LINK's close pushed: nothing open.
    await traverse(() => window.history.back())
    expect(window.location.search).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()

    // And once more onto the link's own entry, which reopens the sender's result — a different
    // candidate from the recipient's, restored from a different place.
    await traverse(() => window.history.back())
    expect(window.location.href).toBe(linkUrl)
    expect(screen.getByRole('dialog').textContent).toBe(linkAddress)
    expect(screen.queryByText(CANDIDATE_A.address)).toBeNull()

    // Nothing about any of that re-entered the "resolving a share link" state, and the
    // recipient's own search kept running throughout.
    expect(spinner()).toBeNull()
    expect(screen.getByText('running')).toBeDefined()
    expect(screen.queryByText(/could not be reconstructed/i)).toBeNull()
  })

  // The same session, on the one result the link itself names. `pushSelectionUrl` builds its param
  // from `{...config, saltNonce}` and `validateMineConfig` emits exactly the four fields the link
  // carries, so a recipient who submits the prefilled form unchanged re-encodes the sender's string
  // byte for byte — and selecting that result while standing on the link's URL takes the "already
  // standing on this URL" early return. Nothing is pushed there, so nothing may be registered
  // either: registering would hand the LINK's own history entry a selection this page never put
  // there, and Back onto it would then restore the recipient's mined candidate over the sender's.
  //
  // The one ordering that reaches the early return with a card click is this one — submitting and
  // selecting while the link's dialog is still up, before any close has pushed the base URL over
  // it. fireEvent, and only reachable through the mocked MiningView, exactly as in the `key` test
  // above: what is being pinned is `pushSelectionUrl`'s bookkeeping, not the route to it.
  it("does not claim the link's own entry as one it pushed when a mined result re-encodes to it", async () => {
    // Byte-identical to what pushSelectionUrl will build for CANDIDATE_A under the submitted
    // CONFIG, which is the whole premise: same fields, same order, same encoder.
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({ ...CONFIG, saltNonce: CANDIDATE_A.saltNonce }),
    })
    const linkUrl = window.location.href

    render(<Page />)
    const user = userEvent.setup()

    // The link opens its own dialog on ITS candidate — derived from the link's config, so a real
    // address rather than the mock's 0xaa… That difference is what makes the assertion below able
    // to tell the two apart at all.
    const linkAddress = (await screen.findByRole('dialog')).textContent
    expect(linkAddress).not.toContain(CANDIDATE_A.address)

    fireEvent.click(screen.getByText('submit-config'))
    await waitFor(() => expect(screen.getByTestId('mining-view')).toBeDefined())

    // The grid surfaces the result the link named. The address bar already says exactly this, so
    // nothing is pushed — the entry underneath is still the link's own, and stays unclaimed.
    fireEvent.click(screen.getByText('select-a'))
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(window.location.href).toBe(linkUrl)

    // Closing pushes the base URL over the link's entry, as it does for any dialog.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).toBeNull()

    // And Back lands on the link's own entry, which restores the LINK's candidate. If that param
    // had been registered as app-written on the early return, the map would win here and the
    // sender's dialog would come back showing the recipient's mined result instead.
    await traverse(() => window.history.back())
    expect(window.location.href).toBe(linkUrl)
    expect(screen.getByRole('dialog').textContent).toBe(linkAddress)
    expect(screen.getByRole('dialog').textContent).not.toContain(CANDIDATE_A.address)
    expect(spinner()).toBeNull()
  })

  // The same sequence carried one step further — open, close, open, close with nothing awaited
  // between them, which used to be the window where a deferred push could outlive the dialog it
  // named and leave a result in the address bar with nothing on screen. Kept as the pin on that
  // outcome: however fast the pushes come, the bar ends up bare when nothing is open, and the
  // entry bookkeeping comes out of it straight enough for the next open/close to behave.
  it('leaves the address bar bare after a rapid open, close, open, close', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))

    // fireEvent throughout: nothing is awaited between these three, which is what keeps them all
    // inside the window before the back traversal lands.
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    fireEvent.click(screen.getByText('select-b'))
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })

    // Nothing is open, so nothing may be named: the URL is back to the bare page.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.search).toBe('')

    // And the entry bookkeeping came out of it straight: opening a result still pushes its own
    // entry, and closing it still pushes the bare page over that one.
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(window.location.href).toBe(
      (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value,
    )
    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // "Start over" throws the run away. Its history entries outlive it — a pushed entry cannot be
  // removed except by pushing over it, which removes the wrong end — so a discarded result's URL
  // stays reachable, and what must not come back is the dialog: a live Deploy button for a result
  // mined under a config that is no longer submitted, on a page whose Configure form is unlocked
  // and empty. It is Back that reaches it now rather than Forward, because closing pushed the base
  // URL over it instead of rewinding onto it.
  //
  // Deliberately NOT done by clearing `writtenSelections`: those params would stop being recognised
  // as the app's own writes, and landing on one would latch it as an incoming share link — the
  // resolving overlay over the page, and mining paused behind it. They stay in the map, marked dead.
  it('does not reopen a discarded result when Back reaches its URL after "Start over"', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const discarded = window.location.href
    expect(discarded).toContain('config=')

    // Closing leaves the entry behind the user rather than deleting it.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))

    await user.click(screen.getByRole('button', { name: /start over…/i }))
    await user.click(screen.getByRole('button', { name: /^start over$/i }))
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
    // The reset pushed nothing: the bar was already bare, and stacking a second base entry would
    // put a dead step between the user and the history they actually walked.
    expect(window.location.search).toBe('')

    await traverse(() => window.history.back())

    // The URL is reachable — nothing can un-push it — but the run it belonged to is gone.
    expect(window.location.href).toBe(discarded)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Still the app's own param, so it is not mistaken for a share link arriving now: no
    // resolving overlay, and the page stays the unlocked starting screen it was reset to.
    expect(spinner()).toBeNull()
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
    expect(screen.queryByTestId('mining-view')).toBeNull()

    // And the reset survives a Forward and a second Back across the same entry.
    await traverse(() => window.history.forward())
    await traverse(() => window.history.back())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(spinner()).toBeNull()
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

  // S1(b). Every route out of here — "Start over", closing the dialog, or the page itself going
  // away — unmounts DeployDialog and with it the inline status/error. Unmounting the page stands
  // in for all of them. The toast is the only channel that outlives them, and the dialog now
  // unmounting on close (rather than being rendered-but-hidden by a panel) is exactly why it has
  // to be.
  it('S1: a terminal deploy error still reaches the user after the deploy dialog unmounts', async () => {
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_A.address))
    const releaseReceipt = pendingReceipt()

    const { unmount } = render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
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
    await user.click(deployButton())

    // `sendDispatched` is set before the await precisely so this branch survives a throw from
    // inside sendTransaction, where gas may already have been committed.
    const message = await screen.findByText(/may already have been broadcast/i)
    expect(message.textContent).toContain('the wallet never answered')
  })

  it('seeds the default expression selection from ALL_MOUTH_NAMES, not a hardcoded list', async () => {
    const { ALL_MOUTH_NAMES } = await import('../lib/face-selection')

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    expect(facePickerPropsRef.current?.value).toEqual(ALL_MOUTH_NAMES)
  })

  // The grid holds up to 200 memoised cards, each an inline blockie, and re-renders several times
  // a second while mining. That memo only pays for itself while the callback threaded down to the
  // cards is the same function on every render — `setSelected`, a state setter, is. Swapping it
  // for `onSelect={(candidate) => setSelected(candidate)}` here would leave every other test in
  // this repo green while turning the memo into 200 wasted comparisons per publish, which the
  // comment on ResultCard warns is worse than no memo at all.
  it('hands MiningView a callback that survives a re-render, so the card memo keeps working', async () => {
    const { ALL_MOUTH_NAMES } = await import('../lib/face-selection')

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    const first = miningViewPropsRef.current?.onSelect
    expect(first).toBeTypeOf('function')

    // Anything that re-renders the page will do; changing the accepted expressions is the one a
    // user reaches for most often, and it re-renders the whole page by design.
    act(() => {
      facePickerPropsRef.current?.onChange(ALL_MOUTH_NAMES.slice(0, 1))
    })

    expect(miningViewPropsRef.current?.onSelect).toBe(first)
  })
})
