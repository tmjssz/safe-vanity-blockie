import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RootLayout from '../app/layout'
import Page from '../app/page'
import { decodeConfigParam, encodeConfigParam } from '../lib/deep-link'

// Drives the real Page end to end, mocking only the heavy children and the wallet/RPC boundary.
//
// One thing to know before reading the `key` regression test below: it reproduces a state that is
// still reachable, but no longer with a mouse. Handing the dialog a second candidate with no
// unmount in between leaves the first candidate's `status`/`completed` state rendered above the
// second one's address, and `key={selected.address}` is what prevents that. Under the modal it was
// unreachable outright — an overlay lay over the whole page, and everything behind it was
// `aria-hidden` as well as unclickable. Between then and now the dialog was non-modal with nothing
// over the page and a card click walked straight in. The backdrop (see DeployDialog) takes that
// back: it covers the grid, so a mouse click there lands on the backdrop and closes the dialog.
// Tab was never a route either — Radix keeps `loop` on for a non-modal dialog, so focus cycles
// inside it (measured in a browser, 120 presses). What is left is the accessibility tree: nothing
// behind is `aria-hidden` or `inert`, so a card can still be focused and activated, and "swaps to
// another result when a card behind the open dialog is activated without a pointer" walks that
// path. This one keeps driving it through the mocked MiningView because it needs the swap to land
// on a dialog whose deploy has already COMPLETED, which is the state whose leftovers matter.

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
    current: undefined as { value: string[]; onChange: (names: string[]) => void } | undefined,
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
// `Toaster` too, since the header test below renders the layout that mounts it: layout.test.tsx
// is where the real renderer is exercised, and it is deliberately unmocked there.
vi.mock('sonner', () => ({
  toast: { error: toastErrorSpy, success: toastSuccessSpy },
  Toaster: () => null,
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

// Only the header test renders the layout, and it is about where a control ends up, not about
// wagmi's connector discovery, a QueryClient or the wallet button's own hooks (which reach for
// more of wagmi than the mock above provides). ConnectButton has its own suite.
vi.mock('../app/providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../components/ConnectButton', () => ({
  ConnectButton: () => <button type="button">connect</button>,
}))

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
// ACTION_RESTORE before delegating to the native method. jsdom does not, so the lines below stand
// in for that patch, and useSearchParams() is a real subscription rather than a snapshot. Without
// this the suite would be testing a page whose URL writes it cannot see, which is precisely the
// half that can go wrong.
//
// BOTH methods, as the App Router patches both: the page replaces rather than pushes when a chain
// switch carries an open selection onto another chain (see `replaceSelectionUrl`), and a stand-in
// that only mirrored pushes would leave useSearchParams() describing the pre-switch URL — a
// disagreement production does not have.
const nativePushState = window.history.pushState.bind(window.history)
window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
  nativePushState(data, unused, url)
  historySync.fromLocation()
}) as typeof window.history.pushState
const nativeReplaceState = window.history.replaceState.bind(window.history)
window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
  nativeReplaceState(data, unused, url)
  historySync.fromLocation()
}) as typeof window.history.replaceState
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
// `chainId` arrives as a prop now (the field itself is in the header) and the real form puts it
// into the config it submits, so the mock does too: a test that switches the chain before
// submitting must get a config for the chain it chose, exactly as the app does.
vi.mock('../components/ConfigForm', () => ({
  ConfigForm: ({
    initial,
    chainId,
    onSubmit,
  }: {
    initial?: { owners?: string[]; threshold?: number; safeVersion?: string }
    chainId: number
    onSubmit: (config: unknown) => void
  }) => (
    <button
      type="button"
      data-initial={initial ? JSON.stringify(initial) : ''}
      onClick={() => onSubmit({ ...CONFIG, chainId })}
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

/**
 * Opens the Filter card, which mounts collapsed once a config is submitted. Radix unmounts a
 * closed panel, so FacePicker is not rendered and `facePickerPropsRef` holds nothing until this
 * runs. Every test that reaches for the picker goes through the header first, exactly as a user
 * does. Named by the card's own <h2>, which is where the trigger gets its accessible name.
 */
async function openFilterCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^filter$/i }))
}

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
    | {
        config?: { chainId: number }
        paused?: boolean
        onPauseToggle?: () => void
        onStartOver?: () => void
        onAdjustFilters?: () => void
        onSelect: (candidate: unknown) => void
      }
    | undefined,
}
vi.mock('../components/MiningView', () => ({
  MiningView: (props: {
    config?: { chainId: number }
    paused?: boolean
    onPauseToggle?: () => void
    onStartOver?: () => void
    onAdjustFilters?: () => void
    onSelect: (candidate: unknown) => void
  }) => {
    miningViewPropsRef.current = props
    return (
      <div data-testid="mining-view" data-chain={props.config?.chainId}>
        <p>{props.paused ? 'paused' : 'running'}</p>
        {/* Stands in for the status bar's Pause/Resume, which the real MiningView renders. The
            state behind it lives in the page now, so this is how a test reaches it. */}
        <button type="button" onClick={() => props.onPauseToggle?.()}>
          toggle-mining
        </button>
        <button type="button" onClick={() => props.onStartOver?.()}>
          start-over
        </button>
        {/* Stands in for the results grid's "Adjust filters", which the real MiningView renders
            inside its empty state. What it asks for belongs to the page: the Filter card. */}
        <button type="button" onClick={() => props.onAdjustFilters?.()}>
          adjust-filters
        </button>
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
  // Restores the hoisted implementation above (connected, on chain 1) after any test that has
  // pointed the wallet somewhere else — vi.fn(impl).mockReset() puts `impl` back.
  useAccountMock.mockReset()
  searchParamsRef.current = new URLSearchParams()
  // Cleared between tests, which matters more than it used to: the Filter card mounts collapsed
  // and Radix unmounts a closed panel, so a test that forgets to open it would otherwise be
  // handed the PREVIOUS test's picker callbacks and pass against them.
  facePickerPropsRef.current = undefined
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
const deployButton = () => screen.getByRole('button', { name: /^deploy safe$/i })

/**
 * The share link the open dialog carries, read off the anchor that holds it now: the labelled
 * input the dialog used to render is gone, and the href is both what a click copies and what is
 * left when the clipboard is unavailable. See DeployDialog.
 */
/**
 * The open dialog's subtitle: on a post-submit screen, the outcome's own words.
 *
 * Read through `aria-describedby` rather than by text, because the dialog keeps an sr-only live
 * region carrying the same words — that is how an outcome is announced across a swap that replaces
 * every visible part of the dialog — so a plain text query matches twice.
 */
const dialogReason = () => {
  const id = screen.getByRole('dialog').getAttribute('aria-describedby') as string
  return document.getElementById(id)?.textContent ?? ''
}

/** The success screen's headline, by role: the same words are in the live region. */
const deployed = () => screen.queryByRole('heading', { name: /^safe deployed$/i })

const shareLinkAnchor = () => screen.getByRole('link', { name: /copy share link/i })
const shareLink = () => shareLinkAnchor().getAttribute('href') as string

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

/** Opens the header's chain picker and chooses a chain by name. */
async function chooseChain(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: /^chain$/i }))
  await user.click(await screen.findByRole('option', { name }))
}

/**
 * The chain the header currently reads — Radix renders the trigger as a combobox. No
 * `{ hidden: true }`: it used to need one because an open deploy dialog was modal and aria-hid
 * the page behind it, so the header was readable but not reachable. The dialog is non-modal now,
 * the header is in the accessibility tree whether or not a result is open, and this queries it as
 * a user's screen reader would find it.
 */
const shownChain = () => screen.getByRole('combobox', { name: /^chain$/i }).textContent

describe('Page', () => {
  // The headline of this change: the chain is no longer one of the Configure card's fields. It
  // lives in the page header, beside the wallet button and the theme toggle, and it is there
  // before anything is submitted — a user picks the chain they are on, not a form field they
  // fill in once and then have to "Start over" to touch.
  it('puts the chain selector in the page header, not in the Configure form', async () => {
    render(
      <RootLayout>
        <Page />
      </RootLayout>,
    )

    const header = await screen.findByRole('banner')
    const chain = screen.getByRole('combobox', { name: /^chain$/i })
    expect(header.contains(chain)).toBe(true)
    // Visible from the start, with the default chain already named on it.
    expect(chain.textContent).toContain('Ethereum')
  })

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
    expect(shareLinkAnchor()).toBeDefined()
    expect(deployButton()).toBeDefined()
    // The two-step flow's own controls are gone with it.
    expect(screen.queryByRole('button', { name: /deploy this safe/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /back to mining/i })).toBeNull()
  })

  // A block comment is a comment in an expression position and TEXT in a JSX child position, so
  // wrapping a component's return in a fragment can silently turn a note into a paragraph of source
  // code on the page. It happened once, to the note above the deploy dialog, and nothing caught it:
  // every other assertion in this suite looks for something specific, and stray prose is the
  // absence of nothing. This looks at the whole page instead, with a dialog open over it.
  it('renders none of the app source code onto the page', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(screen.getByRole('dialog')).toBeDefined()

    expect(document.body.textContent ?? '').not.toMatch(/\/\*|\*\//)
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
    const shared = shareLink()
    expect(window.location.href).toBe(shared)

    await traverse(() => window.history.back())

    // Back closes the dialog and takes the URL with it. A Back that left either behind would be
    // worse than never having touched the URL.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.search).toBe('')
  })

  // The same rule `closeSelection` already keeps when it takes `config` back OUT of the bar:
  // everything else there belongs to whoever put it there. Opening a result adds one parameter;
  // it does not move the app to `/`. Under a basePath that was a navigation off the deployment
  // (a 404 on reload, and a share link that 404s for whoever opens it), and on any deployment it
  // silently dropped campaign parameters and the fragment.
  it('adds ?config= to the URL it is on, keeping the path, other params and the fragment', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    act(() => {
      window.history.replaceState(null, '', '/vanity?utm=spring#results')
    })

    await user.click(screen.getByRole('button', { name: 'select-a' }))

    expect(window.location.pathname).toBe('/vanity')
    expect(new URLSearchParams(window.location.search).get('utm')).toBe('spring')
    expect(new URLSearchParams(window.location.search).get('config')).not.toBeNull()
    expect(window.location.hash).toBe('#results')
    // Still the one builder, so the bar and the copyable field are the same string — the property
    // the test above pins, now that there is more in the URL than `config`.
    const shared = shareLink()
    expect(window.location.href).toBe(shared)

    // And closing puts the page back exactly where it was, rather than at the root.
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/vanity?utm=spring#results',
    )
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
    const shared = shareLink()

    await traverse(() => window.history.back())
    expect(screen.queryByRole('dialog')).toBeNull()

    await traverse(() => window.history.forward())

    // The same candidate, and the same share link — the selection is restored from the entry
    // rather than reconstructed out of the URL, so the candidate/config pairing is the original.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(shareLink()).toBe(shared)
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
    const shared = shareLink()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).toBeNull()

    await traverse(() => window.history.back())

    // The same result, from the entry the close left behind — and the same paired config, so the
    // share link the reopened dialog renders is the original character for character.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(shareLink()).toBe(shared)
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
    expect(window.location.href).toBe(shareLink())
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

    // Closing the dialog leaves mining running rather than stranding it paused, and puts the grid
    // back in front of the user. "Close", not "Cancel": the attempt above failed, so what is on
    // screen is the failure screen rather than the form.
    // Scoped to the footer: the dialog's own X is named "Close" too.
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    await user.click(within(footer).getByRole('button', { name: /^close$/i }))
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

  describe('a deploy closed while it is still running', () => {
    /**
     * The header slot the dialog portals its stand-in into. The layout renders it in production;
     * this file renders the page alone, so the group provides it and then asserts the pill lands
     * there rather than merely existing somewhere.
     */
    let slot: HTMLElement

    beforeEach(async () => {
      const { DEPLOY_STATUS_SLOT_ID } = await import('../components/DeployDialog')
      slot = document.createElement('div')
      slot.id = DEPLOY_STATUS_SLOT_ID
      document.body.append(slot)
    })

    // In afterEach rather than at the end of each test: a test that fails before its last line
    // would otherwise leave an element behind whose id shadows the next one's, and the dialog would
    // portal into the wrong one.
    afterEach(() => slot.remove())

    /** Deploys candidate A far enough that a transaction exists, then closes the dialog. */
    async function minimise(user: ReturnType<typeof userEvent.setup>) {
      buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_A.address))
      const release = pendingReceipt()

      await user.click(screen.getByRole('button', { name: 'submit-config' }))
      await user.click(screen.getByRole('button', { name: 'select-a' }))
      await user.click(deployButton())
      await screen.findByRole('heading', { name: /^deploying safe$/i }, { timeout: 5000 })
      await user.click(screen.getByRole('button', { name: /close and keep waiting/i }))
      return release
    }

    // The headline: "Close and keep waiting" was a one-way door. The sequence carried on, the
    // toast eventually reported it, and the dialog that could have shown the transaction was gone.
    it('leaves a way back in the header, and reopens the same deploy with its status', async () => {
      render(<Page />)
      const user = userEvent.setup()

      const release = await minimise(user)
      expect(screen.queryByRole('dialog')).toBeNull()
      // In the header, not merely on the page.
      expect(slot.textContent).toMatch(/confirming/i)

      await user.click(within(slot).getByRole('button'))

      // The same dialog, not a fresh one: the transaction it was waiting on is still on screen.
      expect(await screen.findByRole('dialog')).toBeDefined()
      expect(screen.getByRole('heading', { name: /^deploying safe$/i })).toBeDefined()
      // The hash is middle-truncated on this screen, so what is asserted is that it is still here
      // to be copied rather than the literal string the mock returns.
      expect(screen.getByRole('button', { name: /copy transaction hash/i })).toBeDefined()
      // The header keeps it while the deploy is still running, dialog open or not: it stops being
      // a stand-in and becomes the one place a running deploy is always visible. It drops away when
      // the deploy settles in front of the user — see the dialog's own tests for that half.

      await release(new Error('boom'))
    })

    // The reported bug: the first close worked, and the second one lost the deploy. The page was
    // deciding whether to keep the dialog mounted from its own pause flag, which the FIRST close
    // clears (mining has to be handed back), so the second close read "nothing outstanding" and
    // unmounted the dialog the pill was pointing at.
    it('survives being closed, reopened and closed again', async () => {
      render(<Page />)
      const user = userEvent.setup()

      const release = await minimise(user)
      expect(slot.textContent).toMatch(/confirming/i)

      await user.click(within(slot).getByRole('button'))
      expect(await screen.findByRole('dialog')).toBeDefined()

      await user.click(screen.getByRole('button', { name: /close and keep waiting/i }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(slot.textContent).toMatch(/confirming/i)
      // And it is still the same deploy, with the same transaction still on it.
      await user.click(within(slot).getByRole('button'))
      expect(screen.getByRole('heading', { name: /^deploying safe$/i })).toBeDefined()
      // The hash is middle-truncated on this screen, so what is asserted is that it is still here
      // to be copied rather than the literal string the mock returns.
      expect(screen.getByRole('button', { name: /copy transaction hash/i })).toBeDefined()

      await release(new Error('boom'))
    })

    // The header is where a deploy is visible for as long as it is running, and that starts at the
    // press: a user who scrolls the grid or opens the pattern filter should not have to remember
    // that something is going on.
    it('shows the status from the moment deploy is pressed, with the dialog still open', async () => {
      buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_A.address))
      const release = pendingReceipt()
      render(<Page />)
      const user = userEvent.setup()

      await user.click(screen.getByRole('button', { name: 'submit-config' }))
      await user.click(screen.getByRole('button', { name: 'select-a' }))
      expect(slot.textContent).toBe('')

      await user.click(deployButton())

      await waitFor(() => expect(slot.textContent).toMatch(/deploying|confirming/i))
      expect(screen.getByRole('dialog')).toBeDefined()

      await release(new Error('boom'))
    })

    // A deploy that settles while nobody is looking has to say so where the user last saw it.
    it('reports the outcome on the way back when the deploy settles while it is closed', async () => {
      render(<Page />)
      const user = userEvent.setup()

      const release = await minimise(user)
      await release(new Error('the chain said no'))

      await waitFor(() => expect(slot.textContent).toMatch(/stopped/i))
      await user.click(within(slot).getByRole('button'))
      await screen.findByRole('heading', { name: /^deployment failed$/i })
      expect(dialogReason()).toMatch(/the chain said no/i)
    })

    // Once it has been read there is nothing left to stand in for, and a control in the header
    // offering to reopen a finished deploy is furniture.
    it('takes the way back away once the settled deploy has been closed again', async () => {
      render(<Page />)
      const user = userEvent.setup()

      const release = await minimise(user)
      await release(new Error('the chain said no'))
      await waitFor(() => expect(slot.textContent).toMatch(/stopped/i))

      await user.click(within(slot).getByRole('button'))
      // "Close", not "Close and keep waiting": the deploy has settled, so there is nothing left to
      // wait for. Scoped to the footer, because the dialog's own X is named "Close" too.
      const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
      await user.click(within(footer).getByRole('button', { name: /^close$/i }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(slot.textContent).toBe('')
    })

    // The page already ignores a card activated while a send is in flight. The same rule has to
    // cover this window, or a click on the grid would quietly destroy the state the pill is
    // pointing at — which is worse than the old behaviour, because the pill promised it was there.
    // Refusing was right; refusing SILENTLY was not. A grid that stops responding reads as broken
    // rather than as a rule, so the refusal now says what it is waiting for.
    it('explains itself when a result is activated while a deploy is running', async () => {
      render(<Page />)
      const user = userEvent.setup()

      const release = await minimise(user)
      await user.click(screen.getByRole('button', { name: 'select-b' }))

      const warning = await screen.findByRole('dialog')
      expect(warning.textContent).toMatch(/deploy is already in progress/i)
      // Still A's deploy underneath, and still the only thing in the header.
      expect(slot.textContent).toMatch(/confirming/i)

      // And it offers the thing the user was otherwise denied a route to.
      await user.click(screen.getByRole('button', { name: /view the deploy/i }))
      const deploy = await screen.findByRole('dialog')
      expect(deploy.textContent).toContain(CANDIDATE_A.address)
      expect(deploy.textContent).not.toMatch(/deploy is already in progress/i)

      await release(new Error('boom'))
    })

    // Its own tile offers "View the deploy", so activating it is a request to come back rather than
    // something to refuse: warning a user off the very deploy they are pointing at would be absurd.
    it('reopens the deploy when its own result is activated', async () => {
      render(<Page />)
      const user = userEvent.setup()

      const release = await minimise(user)
      await user.click(screen.getByRole('button', { name: 'select-a' }))

      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toContain(CANDIDATE_A.address)
      expect(dialog.textContent).not.toMatch(/deploy is already in progress/i)

      await release(new Error('boom'))
    })

    it('lets the warning be dismissed without changing anything', async () => {
      render(<Page />)
      const user = userEvent.setup()

      const release = await minimise(user)
      const opened = window.location.href
      await user.click(screen.getByRole('button', { name: 'select-b' }))
      await user.click(screen.getByRole('button', { name: /keep waiting/i }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.href).toBe(opened)
      expect(slot.textContent).toMatch(/confirming/i)

      await release(new Error('boom'))
    })

    // Once it has settled there is nothing left to protect: the outcome has been reported, and a
    // pill that went on wedging the grid would be a finished deploy holding the app hostage.
    it('takes a new result once the outstanding deploy has settled', async () => {
      render(<Page />)
      const user = userEvent.setup()

      const release = await minimise(user)
      await release(new Error('the chain said no'))
      await waitFor(() => expect(slot.textContent).toMatch(/stopped/i))

      await user.click(screen.getByRole('button', { name: 'select-b' }))

      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toContain(CANDIDATE_B.address)
      expect(dialog.textContent).not.toMatch(/deploy is already in progress/i)
      expect(slot.textContent).toBe('')
    })
  })

  // The other half of that dismissal, and the reason `deploying` cannot be a single shared
  // boolean. "Close and keep waiting" leaves the wallet holding A's transaction and hands mining
  // back — deliberately, above — but A's sequence is still running, and its `finally` still calls
  // `onDeploySettled`. If that clears the page's one flag, it clears it for whatever is in flight
  // by the time it lands: B's wallet confirmation resumes the leaderboard underneath it and
  // re-enables the chain selector, so `changeChain` can repoint B's dialog — its description, its
  // share link and its wrong-chain gate — while the transaction the user is reading is already
  // built for the chain it named. A settle may only ever end the deploy that started it.
  it('does not hand mining back when an abandoned deploy settles under a later one', async () => {
    const releaseA = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()
    const chain = () => screen.getByRole('combobox', { name: /^chain$/i }) as HTMLButtonElement

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()

    await user.click(screen.getByRole('button', { name: /close and keep waiting/i }))
    expect(screen.getByText('running')).toBeDefined()

    // Back, rather than straight to another card: closing mid-flight now keeps A's dialog mounted
    // so the header pill can bring it back, and the grid will not take a new result while that
    // deploy is running (see "explains itself when a result is activated while a deploy is
    // running"). A traversal is the route that is left.
    //
    // TWICE, and the first one is not redundant: closing pushed the base URL over A's own entry, so
    // the first Back lands back ON that entry and reopens A — which is the behaviour that entry is
    // for. The second leaves it, unmounting the dialog, which is what makes the attempt below
    // genuinely abandoned and what puts the grid back in play.
    await traverse(() => window.history.back())
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    await traverse(() => window.history.back())
    expect(screen.queryByRole('dialog')).toBeNull()

    const releaseB = pendingDeploy()
    await user.click(screen.getByRole('button', { name: 'select-b' }))
    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()
    expect(chain().disabled).toBe(true)

    // A settles, abandoned. B is still in the wallet's hands, so nothing on screen may move.
    await releaseA()
    expect(screen.getByText('paused')).toBeDefined()
    expect(chain().disabled).toBe(true)

    // And B's own settle still ends B's pause — the token is what distinguishes them, not the
    // page having stopped listening.
    await releaseB()
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
    expect(chain().disabled).toBe(false)
  })

  // Moved here from test/MiningView.test.tsx along with the state it is about. `pausedByUser` is
  // the page's now, because two controls set it — the status bar's Pause and the Configure card's
  // Stop — and the semantics only make sense where both can see it.
  //
  // While the HOST is pausing (a deploy in flight), both controls can only read as "resume", so
  // pressing one is the obvious thing to do. It must not silently arm a second, user-owned pause
  // that outlives the host's: mining would stay stopped once the deploy settled, and the user
  // would have to press again with nothing on screen explaining why the first press did nothing.
  it('does not arm a second pause when resume is pressed while a deploy holds mining', async () => {
    const release = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'toggle-mining' }))

    await release()
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
  })

  it('stops and restarts mining from the one flag both controls share', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(screen.getByText('running')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'toggle-mining' }))
    expect(screen.getByText('paused')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'toggle-mining' }))
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
    await user.click(deployButton())

    expect(
      await screen.findByRole('heading', { name: /^safe deployed$/i }, { timeout: 5000 }),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: /^deploy safe$/i })).toBeNull()

    // Hands the page candidate B while the dialog is still mounted — no close, so React reuses
    // the element position and only `key={selected.address}` forces a fresh instance.
    //
    // A reachable sequence, through the accessibility tree: the dialog is non-modal, so the grid
    // behind the backdrop is neither hidden nor inert and its cards are still real, focusable
    // buttons (see "swaps to another result when a card behind the open dialog is activated
    // without a pointer", which walks in that way). It is driven here through the mocked
    // MiningView because this test needs the swap to land while
    // candidate A's deploy has already COMPLETED — the state whose leftovers are what the `key`
    // prevents from being rendered above another address.
    fireEvent.click(screen.getByText('select-b'))

    // The dialog now shows candidate B, and nothing of candidate A's deploy survives: not the
    // success status naming A's address, and not the permanently disabled button.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_B.address)
    expect(screen.queryByText(CANDIDATE_A.address)).toBeNull()
    expect(deployed()).toBeNull()
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
      await screen.findByRole('heading', { name: /^safe deployed$/i }, { timeout: 5000 }),
    ).toBeDefined()

    // Escape is allowed once the sequence has settled — and closing clears the selection, so the
    // grid underneath is immediately clickable again.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'select-b' }))

    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_B.address)
    expect(deployed()).toBeNull()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false)
  })

  // The headline behaviour: a link is an invitation to look at ONE specific Safe. Opening it used
  // to land on the ordinary starting screen — form prefilled, no result, no dialog — because the
  // candidate was derived from the *submitted* config, which does not exist until the recipient
  // submits. It now derives from the link's own config, which carries everything the address needs.
  // And it does that without mining: clicking someone's link must not spin up five to eight
  // workers at full CPU unasked.
  it('opens the deploy dialog on the candidate a link names, with no submit and no mining', async () => {
    const { candidateFromSaltNonce } =
      await vi.importActual<typeof import('../lib/deep-link')>('../lib/deep-link')
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
    expect(shareLinkAnchor()).toBeDefined()
    expect(deployButton()).toBeDefined()
    expect(screen.queryByText(/could not be reconstructed/i)).toBeNull()

    // Nothing is mining: MiningView is not mounted at all, and the Configure form is still
    // sitting there unsubmitted for a recipient who wants to start their own search — and, since
    // the dialog stopped being modal, reachable rather than merely present. (This asked for it
    // with `{ hidden: true }` while Radix aria-hid the page behind the dialog; dropping that is
    // the stronger query, not a looser one.)
    expect(screen.queryByTestId('mining-view')).toBeNull()
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
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
      await screen.findByRole('heading', { name: /^safe deployed$/i }, { timeout: 5000 }),
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
    expect(
      screen.queryByText(/does not match the selected candidate/i, {
        ignore: '[aria-live] *, [aria-live]',
      }),
    ).toBeNull()
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
    const { candidateFromSaltNonce } =
      await vi.importActual<typeof import('../lib/deep-link')>('../lib/deep-link')
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
  // before any dialog exists. This ORDERING (submit after the dialog is already up) was out of
  // reach while the dialog was modal and the form behind it took no clicks; it is an ordinary
  // click now that it is not. fireEvent is kept because what this test is about is the pairing
  // surviving the submit, not the route to it. The modal never was what made any of this safe,
  // and nothing here rested on it: the pairing of candidate and config is the whole guarantee —
  // which is exactly why removing the modal changed nothing below.
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
      const url = shareLink()
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
      await screen.findByRole('heading', { name: /^safe deployed$/i }, { timeout: 5000 }),
    ).toBeDefined()
    expect(loadSafeConstantsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ owners: LINK_OWNERS }),
    )
    expect(
      screen.queryByText(/does not match the selected candidate/i, {
        ignore: '[aria-live] *, [aria-live]',
      }),
    ).toBeNull()
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
    expect(shareLink()).toBe(received)
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
  it('does not reopen a share link\'s dialog on Back after "Start over"', async () => {
    searchParamsRef.current = linkParams()
    const received = window.location.href

    render(<Page />)
    const user = userEvent.setup()
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'start-over' }))

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
    const minedUrl = shareLink()
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
    expect(window.location.href).toBe(shareLink())
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

    await user.click(screen.getByRole('button', { name: 'start-over' }))
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
    // The card mounts collapsed, and the picker with it, so the "still-live FacePicker" this
    // test is about has to be on screen before it can be touched.
    await openFilterCard(user)
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

  it('prefills the config form and the header chain from a ?config= link, and keeps the mined config on "Start over"', async () => {
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: CONFIG.owners,
        threshold: CONFIG.threshold,
        safeVersion: CONFIG.safeVersion,
        // Deliberately not the default chain: a prefill that quietly kept Ethereum would be
        // invisible to this test if the link named it too.
        chainId: 137,
      }),
    })

    render(<Page />)

    // Every field the Safe address is derived from reaches the screen, or the link cannot
    // reproduce the address it was created for. Three of them go to the form…
    expect(
      JSON.parse(screen.getByRole('button', { name: 'submit-config' }).dataset.initial || '{}'),
    ).toEqual({
      // The array, not a joined string: the form has one field per owner now, so this is what
      // lands in them, entry for entry and in order.
      owners: CONFIG.owners,
      threshold: CONFIG.threshold,
      safeVersion: CONFIG.safeVersion,
    })
    // …and the fourth to the header, which is where the chain is chosen now.
    expect(shownChain()).toContain('Polygon')

    // "Start over" is still a deliberate break with the LINK — its saltNonce, its dialog and its
    // errors are all out of reach afterwards. What changed is what the form comes back holding:
    // it used to come back empty, and now it comes back seeded from the config that was actually
    // being mined. Retyping owner addresses to change one threshold was friction with a real
    // hazard behind it, since every retype of an address is a chance to mine a different Safe by
    // typo. Here the two happen to coincide — the recipient submitted the link's own config.
    await userEvent.click(screen.getByRole('button', { name: 'submit-config' }))
    await userEvent.click(screen.getByRole('button', { name: 'start-over' }))

    expect(
      JSON.parse(screen.getByRole('button', { name: 'submit-config' }).dataset.initial || '{}'),
    ).toEqual({
      owners: CONFIG.owners,
      threshold: CONFIG.threshold,
      safeVersion: CONFIG.safeVersion,
    })
    // The header, though, stays where it is. It is chrome rather than one of Configure's fields,
    // and dropping an unpicked header back to the default would move the user to the OTHER
    // singleton class from the one the link named — quietly, on a screen that has just emptied
    // everything else. Changing chain is what the header is for; a reset is not.
    expect(shownChain()).toContain('Polygon')
  })

  // CONFIG has one owner, so the test above cannot tell an entry being dropped or reordered from
  // it arriving intact. This one carries three, and pins them as an ordered array — the owners are
  // the address-determining input, and a link whose second and third owners swapped on the way to
  // the form reproduces a different Safe under the same blockie the link promised, with nothing on
  // screen to say so. (That the array becomes one FIELD PER OWNER is ConfigForm's and
  // ConfigSection's to prove: this suite mocks the form.)
  it('hands a multi-owner link to the form as an ordered array, entry for entry', async () => {
    const owners = ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20), '0x' + '33'.repeat(20)]
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({ owners, threshold: 2, safeVersion: '1.4.1', chainId: 137 }),
    })

    render(<Page />)

    expect(
      JSON.parse(screen.getByRole('button', { name: 'submit-config' }).dataset.initial || '{}'),
    ).toEqual({ owners, threshold: 2, safeVersion: '1.4.1' })
  })

  // The link is read at RENDER, not seeded once at mount. This subtree reaches its first client
  // render through a Suspense bailout, so useSearchParams() can still be empty then — which is
  // precisely why `linkParamRef` latches "the first `?config=` this mount SEES" rather than
  // capturing the first render's. The form's fields already follow that latch; a missed chain used
  // to read "Ethereum", the other singleton class from every link that names one of the six, so a
  // recipient who submitted mined a different address family from the one they were sent — and,
  // unlike a blank owners field, nothing on screen said so.
  it('follows a link whose ?config= only arrives after the first render, chain included', async () => {
    render(<Page />)
    // The address bar was empty when this rendered, so the header is on its default.
    expect(shownChain()).toContain('Ethereum')

    act(() => {
      searchParamsRef.current = new URLSearchParams({
        config: encodeConfigParam({
          owners: CONFIG.owners,
          threshold: CONFIG.threshold,
          safeVersion: CONFIG.safeVersion,
          chainId: 137,
        }),
      })
    })

    // All four fields the address is derived from adopt the link together — three in the form, the
    // fourth in the header — rather than three of them following it and one staying behind.
    expect(
      JSON.parse(screen.getByRole('button', { name: 'submit-config' }).dataset.initial || '{}'),
    ).toEqual({
      owners: CONFIG.owners,
      threshold: CONFIG.threshold,
      safeVersion: CONFIG.safeVersion,
    })
    expect(shownChain()).toContain('Polygon')

    // And what is actually mined is the chain the link named, not the default it opened on.
    await userEvent.click(screen.getByRole('button', { name: 'submit-config' }))
    // Read off what the run was actually handed rather than off a summary line: the card no
    // longer renders one, and this is the value that decides which Safe gets mined.
    expect(screen.getByTestId('mining-view').getAttribute('data-chain')).toBe('137')
  })

  // A banner carried for the whole run is the fastest way to teach someone it is scenery, so the
  // page itself carries no standing caveat. It is stated where it is actually read instead: the
  // idle Configure card, the About dialog, and the deploy dialog, each asserted in its own suite.
  it('carries no standing phishing caveat, idle or mining', async () => {
    render(<Page />)
    const user = userEvent.setup()

    expect(screen.queryByText(/known phishing vector/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(screen.queryByText(/known phishing vector/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'toggle-mining' }))
    expect(screen.queryByText(/known phishing vector/i)).toBeNull()
  })

  // The Configure card IS the idle state. Once a run starts it is gone entirely rather than
  // locked in place, and the status bar is the only control surface until Start over brings it
  // back. (The confirmation guarding Start over lives in MiningStatusBar, which this mock stands
  // in for, so it is asserted in that component's own suite.)
  it('hides the Configure card for the whole run and restores it on start over', async () => {
    render(<Page />)
    const user = userEvent.setup()

    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
    expect(screen.queryByTestId('mining-view')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    expect(screen.getByTestId('mining-view')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'submit-config' })).toBeNull()

    // Pausing is not a way back to the form: the card stays gone.
    await user.click(screen.getByRole('button', { name: 'toggle-mining' }))
    expect(screen.getByText('paused')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'submit-config' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'start-over' }))
    expect(screen.queryByTestId('mining-view')).toBeNull()
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
  })

  // The card comes back holding what was mined, not empty. Retyping owner addresses to change a
  // threshold is exactly the friction "Start over" used to impose, and every retype of an address
  // is a chance to mine a different Safe by typo.
  // Applying a new face spec starts the search over, and a run that starts must run. MiningView's
  // effect returns early while paused, so without clearing the user's pause the confirmed restart
  // would leave the board wiped and nothing mining — the worst of both.
  it('resumes mining when a face change restarts the search from a pause', async () => {
    const { ALL_MOUTH_NAMES } = await import('../lib/face-selection')
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'toggle-mining' }))
    expect(screen.getByText('paused')).toBeDefined()

    // What FacePicker calls once "Restart the search" is confirmed. The card has to be open for
    // the picker to exist at all, which is also true of the user this stands in for.
    await openFilterCard(user)
    await act(async () => {
      facePickerPropsRef.current?.onChange(ALL_MOUTH_NAMES.slice(0, 2))
    })

    expect(screen.getByText('running')).toBeDefined()
  })

  it('restores the previous config into the form after start over', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'start-over' }))

    const form = screen.getByRole('button', { name: 'submit-config' })
    expect(JSON.parse(form.getAttribute('data-initial') || '{}')).toMatchObject({
      owners: CONFIG.owners,
      threshold: CONFIG.threshold,
      safeVersion: CONFIG.safeVersion,
    })
  })

  // S1(a). Escape, the X and a backdrop click all unmount DialogContent, and every terminal
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
    expect(screen.getByRole('button', { name: /waiting for wallet/i })).toBeDefined()
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

    // Gas is now committed: the transaction is broadcast and only the receipt is outstanding, which
    // is exactly the dialog's pending screen.
    await screen.findByRole('heading', { name: /^deploying safe$/i })

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

    await screen.findByRole('heading', { name: /^deployment failed$/i }, { timeout: 5000 })
    expect(dialogReason()).toContain(CANDIDATE_A.address)
    expect(dialogReason()).toContain(CANDIDATE_B.address)
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

    await screen.findByRole('heading', { name: /^deployment failed$/i }, { timeout: 5000 })
    expect(dialogReason()).toMatch(/Deployment reverted\. Gas was spent\./i)
    expect(dialogReason()).toContain('0xhash')
    expect(deployed()).toBeNull()
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

    await screen.findByRole('heading', { name: /^deployment failed$/i }, { timeout: 5000 })
    expect(dialogReason()).toContain(THIRD)
    expect(dialogReason()).toContain(CANDIDATE_A.address)
    expect(deployed()).toBeNull()
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
    await screen.findByRole('heading', { name: /^deployment failed$/i }, { timeout: 5000 })
    expect(dialogReason()).toMatch(/may already have been broadcast/i)
    expect(dialogReason()).toContain('the wallet never answered')
  })

  it('seeds the default expression selection from ALL_MOUTH_NAMES, not a hardcoded list', async () => {
    const { ALL_MOUTH_NAMES } = await import('../lib/face-selection')

    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await openFilterCard(user)

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
    await openFilterCard(user)
    const first = miningViewPropsRef.current?.onSelect
    expect(first).toBeTypeOf('function')

    // Anything that re-renders the page will do; changing the accepted expressions is the one a
    // user reaches for most often, and it re-renders the whole page by design.
    act(() => {
      facePickerPropsRef.current?.onChange(ALL_MOUTH_NAMES.slice(0, 1))
    })

    expect(miningViewPropsRef.current?.onSelect).toBe(first)
  })

  // The results grid's empty state says to relax a filter; during a run the card holding those
  // filters is collapsed above it. The two live in different subtrees — the page owns the card,
  // MiningView owns the grid — so the request has to travel through the page, and this is the only
  // level at which the whole trip is observable.
  it('opens the collapsed Filter card when the results grid asks for it', async () => {
    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    const card = () => screen.getByRole('button', { name: /^filter$/i })
    expect(card().getAttribute('aria-expanded')).toBe('false')

    await user.click(screen.getByRole('button', { name: 'adjust-filters' }))
    expect(card().getAttribute('aria-expanded')).toBe('true')

    // And again, after the user closes it: the second press of the same button has to work, which
    // a boolean "please open" prop would fail.
    await user.click(card())
    expect(card().getAttribute('aria-expanded')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'adjust-filters' }))
    expect(card().getAttribute('aria-expanded')).toBe('true')
  })

  // The grid's button exists to reveal a card the user cannot see. Once that card is open it would
  // reveal something already on screen — directly below a sentence naming filters the user is
  // looking at — so the page stops offering it, by withholding the handler the button is rendered
  // from at all rather than by teaching the grid about a card in a different subtree.
  it('withholds the empty state\u2019s action while the Filter card is already open', async () => {
    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    const card = () => screen.getByRole('button', { name: /^filter$/i })
    expect(card().getAttribute('aria-expanded')).toBe('false')
    expect(miningViewPropsRef.current?.onAdjustFilters).toBeTypeOf('function')

    // Opened by the card's own header, so this holds however the card came to be open — not only
    // for the button's own press.
    await user.click(card())
    expect(miningViewPropsRef.current?.onAdjustFilters).toBeUndefined()

    await user.click(card())
    expect(miningViewPropsRef.current?.onAdjustFilters).toBeTypeOf('function')
  })

  // And the press itself leaves nothing dangling: the card it opens is the card whose being open
  // withdraws the button, so one click both reveals the filters and retires the control.
  it('retires the action once its own press has opened the card', async () => {
    render(<Page />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'submit-config' }))

    await user.click(screen.getByRole('button', { name: 'adjust-filters' }))
    expect(screen.getByRole('button', { name: /^filter$/i }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    expect(miningViewPropsRef.current?.onAdjustFilters).toBeUndefined()
  })

  // The decoded config a `?config=` link renders, so a test can say what chain the dialog is
  // offering rather than trusting the URL to look right.
  const sharedChainId = () => {
    const url = shareLink()
    return decodeConfigParam(new URL(url, 'http://localhost').searchParams.get('config') ?? '')
      .config?.chainId
  }

  // The point of moving the chain into the header: it is a live control, not a locked field. A
  // switch among the six chains that share a Safe singleton changes nothing about the addresses
  // already found, so the run is left alone — and the config it is mining under, the summary, and
  // the link every result offers all follow the new chain.
  it('switches chain from the header without discarding the run, and mines and shares under the new one', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    const view = screen.getByTestId('mining-view')
    // The locked summary, which reads the submitted config rather than the header.
    expect(screen.getByTestId('mining-view').getAttribute('data-chain')).toBe('11155111')

    await chooseChain(user, /polygon/i)

    // No question, no reset: the Configure card is still locked on the same run, and mining was
    // never handed back to the starting screen.
    expect(screen.queryByRole('dialog')).toBeNull()
    // The SAME element, not merely another one like it. "A MiningView is on screen" is true of a
    // remount too, and a remount is the one thing this feature cannot survive: it takes the worker
    // pool, the leaderboard and the scanned totals with it, for a switch whose whole point is that
    // every address already found is still valid. A `key={config.chainId}` here would do exactly
    // that and leave every other assertion in this file green — and MiningView.chain-switch.test.tsx
    // cannot see it either, because it rerenders the component directly. This is the only place the
    // page's own decision to keep it mounted is pinned.
    expect(screen.getByTestId('mining-view')).toBe(view)
    expect(shownChain()).toContain('Polygon')
    // The submitted config moved with it. Read off MiningView, which is what actually mines it —
    // the Configure card no longer collapses to a summary line that could be read instead.
    expect(screen.getByTestId('mining-view').getAttribute('data-chain')).toBe('137')

    // And a result opened now offers a link for the chain the user is on.
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(sharedChainId()).toBe(137)
    expect(window.location.href).toBe(shareLink())
  })

  // Crossing the mainnet boundary is the one switch that changes every address on screen, so it
  // gets the treatment editing owners gets: asked about first, and then a real reset — not a
  // silently invalidated leaderboard.
  it('asks before a switch that crosses the mainnet boundary, and keeps everything if declined', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const opened = window.location.href
    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))

    await chooseChain(user, /ethereum/i)
    expect(await screen.findByRole('dialog')).toBeDefined()
    await user.click(screen.getByRole('button', { name: /^stay on sepolia$/i }))

    // Declined: still on Sepolia, still mining, and the result's own entry is still live — Back
    // reopens it.
    expect(shownChain()).toContain('Sepolia')
    expect(screen.getByTestId('mining-view')).toBeDefined()
    await traverse(() => window.history.back())
    expect(window.location.href).toBe(opened)
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
  })

  it('resets the run on a confirmed mainnet crossing, exactly as "Start over" does', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const discarded = window.location.href
    expect(discarded).toContain('config=')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))

    await chooseChain(user, /ethereum/i)
    await user.click(screen.getByRole('button', { name: /switch and start over/i }))

    // The run is gone and the chain is the one that was asked for: an unlocked, empty Configure
    // card on Ethereum, nothing mining.
    expect(shownChain()).toContain('Ethereum')
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
    expect(screen.queryByTestId('mining-view')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    // And the discarded run's history entries are retired with it, like any other reset: its URL
    // is still reachable (a push cannot be un-pushed) but it puts no dialog back on a page that
    // has been reset out from under it — and it is still recognised as the app's own write, so no
    // resolving overlay drops over it either.
    await traverse(() => window.history.back())
    expect(window.location.href).toBe(discarded)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(spinner()).toBeNull()
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
  })

  // A history entry names the config it was created under, chain included, and a chain switch does
  // not reach back and repoint it. Landing on one restores the pair that was stored with it — the
  // candidate AND its own config — rather than re-deriving anything against whatever the header
  // says now. That is what keeps the dialog's "deploy this on X" honest: it names the chain the
  // entry was made on, and the wallet gate is checked against the same one.
  it('restores an entry with the chain it was created under, even after the header moved on', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(sharedChainId()).toBe(11155111)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))

    await chooseChain(user, /polygon/i)
    expect(shownChain()).toContain('Polygon')

    await traverse(() => window.history.back())

    // The Sepolia entry, restored as it was stored: same candidate, same config, same link. The
    // header stays where the user put it — the two are allowed to differ, and each says which
    // chain it means.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(sharedChainId()).toBe(11155111)
    expect(screen.getByRole('dialog').textContent).toContain('Sepolia')
    expect(shownChain()).toContain('Polygon')
    // Nothing was re-derived to produce it: the pair came out of the map, not out of the URL.
    expect(loadSafeConstantsMock).not.toHaveBeenCalled()
    expect(spinner()).toBeNull()
  })

  // HEADLINE 1. The chain moved into the header so it could be changed at any time — and until
  // now "any time" excluded the one moment a user most wants it, with a result open in front of
  // them. The deploy dialog was a Radix modal: an overlay over the whole page, focus trapped, and
  // everything outside it `aria-hidden`. The header was there and unusable.
  //
  // `getByRole` without `{ hidden: true }` throughout, deliberately: that is the assertion. It
  // ignores anything inside an `aria-hidden` subtree, so every query below fails while the dialog
  // is modal — and the pointer click fails too, because a modal sets `pointer-events: none` on
  // the rest of the body. Mouse and assistive technology have to reach it, not one or the other.
  //
  // `<Page />` bare rather than inside RootLayout, so the selector renders in place instead of
  // being portaled into the header. What is under test here is what a modal does to everything
  // outside it — aria-hidden and pointer-events, neither of which cares where the control sits —
  // and the header placement itself is pinned by the first test in this file. It is also the only
  // arrangement jsdom will run: rendering the real ChainSelector through the layout's header slot
  // and then updating the page hangs React's commit in this environment, on `main` as much as
  // here (a Radix Select portaled into a node the same root renders). The browser, where z-index
  // and the overlay are the actual obstacle, is covered by the headless run instead.
  it('lets the chain be changed from the header while the deploy dialog stays open', async () => {
    render(<Page />)
    const user = userEvent.setup()

    // Sepolia first, so the switch below is one of the six that costs nothing and asks nothing:
    // what is under test here is reaching the control at all, not the confirmation a mainnet
    // crossing puts in front of it (which has its own test below).
    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(screen.getByRole('dialog')).toBeDefined()

    // The page behind the dialog is still a page: its controls are in the accessibility tree
    // rather than hidden behind an overlay that only a mouse could ever have got past.
    expect(screen.getByRole('button', { name: 'select-b' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: /^chain$/i })).toBeDefined()

    await chooseChain(user, /polygon/i)

    // The header moved, and the dialog is still open on the same result — using the page behind
    // it is not a dismissal.
    expect(shownChain()).toContain('Polygon')
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
  })

  // HEADLINE 2. The consequence of headline 1, and the half that decides whether the guarantee
  // still holds: the header and the open dialog must not be able to disagree about where the gas
  // is spent. A switch among the six non-mainnet chains provably does not change the address
  // (identical factory, identical initializer hash, identical initCodeHash — measured on live
  // RPCs, see lib/config.ts), so the selection is carried across rather than left behind: the
  // config still derives exactly the address on screen, which is what the pairing claims.
  //
  // Everything downstream of `selection.config.chainId` has to come with it, and this drives all
  // four: the description sentence that names where the money goes, the wallet's wrong-chain gate,
  // the copyable share link, and the URL in the address bar.
  it('carries the open selection to the new chain on a same-class switch', async () => {
    // The wallet sits on Polygon throughout. Before the switch the dialog is on Sepolia and so
    // gated behind "Switch network to continue"; after it, the gate has to have opened by itself.
    useAccountMock.mockReturnValue({
      isConnected: true,
      address: '0x' + 'cc'.repeat(20),
      chainId: 137,
    })

    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))

    const address = (screen.getByRole('dialog').textContent ?? '').match(/0x[0-9a-f]{40}/i)?.[0]
    expect(address).toBe(CANDIDATE_A.address)
    expect(sharedChainId()).toBe(11155111)
    // Named after the chain it switches to, which is the config's — see DeployDialog.
    expect(screen.getByRole('button', { name: /^switch to sepolia$/i })).toBeDefined()

    await chooseChain(user, /polygon/i)

    // The address on screen has not moved — it cannot, which is the entire reason this is allowed
    // to happen at all.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    // …and everything that names a chain now names the new one.
    expect(sharedChainId()).toBe(137)
    expect(screen.getByRole('dialog').textContent).toContain('Polygon')
    expect(screen.getByRole('dialog').textContent).not.toContain('Sepolia')
    // The wrong-chain comparison is made against the carried config, so the gate opens and the
    // button that spends the gas appears — on the chain the header is showing.
    expect(screen.queryByRole('button', { name: /switch to/i })).toBeNull()
    expect(deployButton()).toBeDefined()
    // The address bar is still the same string as the copyable link, and both name Polygon: a
    // link copied out of here after the switch has to reproduce what this dialog would deploy.
    expect(window.location.href).toBe(shareLink())
    expect(
      decodeConfigParam(new URLSearchParams(window.location.search).get('config') ?? '').config
        ?.chainId,
    ).toBe(137)

    // The carry CORRECTED the entry the user is standing on rather than stacking a new one on top
    // of it. Back therefore leaves the dialog behind entirely, instead of landing on a Sepolia
    // copy of the same result that the header — which does not move on a traversal — would then
    // contradict.
    await traverse(() => window.history.back())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.search).toBe('')
  })

  // The other half of the carry: what a switch must NOT do. Crossing the mainnet boundary changes
  // the singleton and so every address found, including the one on screen — so it is asked about,
  // and confirming is a real reset. Reachable with the dialog open for the first time now that the
  // header is usable from one, which is why it is driven with the dialog open rather than closed
  // (the closed-dialog version is above).
  it('asks before a mainnet crossing with the dialog open: declining leaves it, confirming clears it', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const opened = window.location.href

    await chooseChain(user, /ethereum/i)

    // Asked, not done. (The confirmation is itself modal, so it is queried by its own text: while
    // it is up it aria-hides the deploy dialog behind it, exactly as intended.)
    expect(await screen.findByText(/switch to ethereum\?/i)).toBeDefined()
    await user.click(screen.getByRole('button', { name: /^stay on sepolia$/i }))

    // Declined leaves everything alone — the chain, the run, and the open dialog with its own
    // config still paired to the candidate on screen.
    expect(shownChain()).toContain('Sepolia')
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(sharedChainId()).toBe(11155111)
    expect(window.location.href).toBe(opened)
    expect(screen.getByTestId('mining-view')).toBeDefined()

    await chooseChain(user, /ethereum/i)
    await user.click(screen.getByRole('button', { name: /switch and start over/i }))

    // Confirmed is the reset "Start over" performs, and it takes the dialog with it: the address
    // it names is not this Safe's address on Ethereum, so it cannot be carried and must not stay.
    expect(shownChain()).toContain('Ethereum')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.search).toBe('')
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()
    expect(screen.queryByTestId('mining-view')).toBeNull()
  })

  /** The dialog's own backdrop; see DeployDialog. Radix renders no overlay for a non-modal one. */
  const backdrop = () =>
    document.querySelector('[data-slot="deploy-dialog-backdrop"]') as HTMLElement | null

  // The dismissal contract, and it is now a contract about WHICH outside thing was touched. The
  // backdrop closes (next test). Everything else outside does not — Radix's `onInteractOutside`
  // fires for the header, for a focus move and for the backdrop alike, so it is refused outright
  // and the backdrop carries the dismissal on its own handler instead. What that protects is the
  // reach the whole non-modal decision exists for: the chain selector in the header, which the
  // backdrop deliberately does not cover.
  //
  // Two routes, both of which really reach the page behind a backdrop that covers it: a focus move
  // onto a card (nothing back there is inert or `aria-hidden`, so an assistive technology can put
  // focus there — Radix's `focusOutside` fires for it), and a pointer event on the mining status
  // text — which in a browser a mouse could not deliver through the backdrop, but which is exactly
  // the DismissableLayer event the header's own click produces, and which does nothing at all when
  // clicked, so a closed dialog could only mean it was read as a dismissal.
  it('does not dismiss the deploy dialog when something outside it other than the backdrop is used, and still closes on Escape', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const opened = window.location.href

    screen.getByRole('button', { name: 'select-b' }).focus()
    expect(screen.getByRole('dialog')).toBeDefined()

    await user.click(screen.getByText('running'))

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(window.location.href).toBe(opened)

    // The deliberate route out is untouched.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // …and the one outside click that IS a dismissal, driven at page level because closing has a
  // second half the dialog cannot see: `closeSelection` pushes the base URL over the entry naming
  // this result, so the address bar never names a dialog that is not on screen. A backdrop click
  // has to be the same route out as Escape and the footer button, not a private one that leaves
  // the URL behind.
  it('closes the deploy dialog on a backdrop click, and takes the URL with it', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(window.location.search).not.toBe('')

    expect(backdrop()).not.toBeNull()
    await user.click(backdrop() as HTMLElement)

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.search).toBe('')
    expect(backdrop()).toBeNull()

    // Closing this way is a push like every other, so the result is still one Back away.
    await traverse(() => window.history.back())
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
  })

  // S1(c). The busy guards, verified against the delivery rather than read off the handlers:
  // non-modal changed how outside interaction reaches the layer (no Radix overlay to swallow it,
  // no `pointer-events: none` on the body) and the backdrop has added one outside click that IS a
  // dismissal — so "an in-flight send cannot be dismissed by accident" has to be re-proved by real
  // clicks, including one on the backdrop, and a real Escape. Losing this dialog mid-send loses
  // the only inline copy of what the wallet is holding, which is why the backdrop is not an
  // exception to the busy rule. The one deliberate, relabelled way out stays live.
  it('S1: neither an outside click, a backdrop click nor Escape can dismiss the deploy dialog while the sequence is in flight', async () => {
    const release = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const opened = window.location.href
    await user.click(deployButton())
    expect(screen.getByRole('button', { name: /waiting for wallet/i })).toBeDefined()

    await user.click(screen.getByText('paused'))
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('button', { name: /waiting for wallet/i })).toBeDefined()

    // The backdrop is still there — it still blocks the page — it just does not dismiss.
    expect(backdrop()).not.toBeNull()
    await user.click(backdrop() as HTMLElement)
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('button', { name: /waiting for wallet/i })).toBeDefined()
    // Nothing was pushed either: a URL moving under a dialog that stayed put would mean
    // `closeSelection` ran halfway.
    expect(window.location.href).toBe(opened)

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('button', { name: /waiting for wallet/i })).toBeDefined()
    // The X is gone for the same window, so the pointer has nothing accidental left either.
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull()

    // …and the deliberate one still works, still saying what it is.
    await user.click(screen.getByRole('button', { name: /close and keep waiting/i }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await release()
  })

  // The chain control is the one thing on the page behind an in-flight send that must NOT be
  // live: the wallet is holding a transaction built for the chain the user read before they
  // confirmed it, and carrying the open selection onto another chain mid-send would repoint the
  // description, the share link and the wrong-chain gate at a chain that transaction is not on —
  // the gate would even swap "Deploying…" for "Switch network to continue". So the selector is
  // held still for exactly that window, and handed back the moment it settles.
  it('holds the chain selector still while a deploy is in flight, and hands it back after', async () => {
    const release = pendingDeploy()
    // On the chain the run is mined for, so the deploy button is offered rather than the
    // wrong-chain gate.
    useAccountMock.mockReturnValue({
      isConnected: true,
      address: '0x' + 'cc'.repeat(20),
      chainId: 11155111,
    })
    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const chain = () => screen.getByRole('combobox', { name: /^chain$/i }) as HTMLButtonElement
    expect(chain().disabled).toBe(false)

    await user.click(deployButton())
    expect(chain().disabled).toBe(true)
    // Still saying which chain the transaction in flight is for.
    expect(shownChain()).toContain('Sepolia')

    await release()
    await waitFor(() => expect(chain().disabled).toBe(false))
    await chooseChain(user, /polygon/i)
    expect(sharedChainId()).toBe(137)
  })

  // The route to the grid that survives the backdrop. The backdrop covers the leaderboard, so a
  // pointer cannot reach a card behind an open dialog — that half is the headless run's to prove,
  // since jsdom does no hit testing and a `user.click` here would pass whatever was on top of what
  // it clicked. Tab is not a way round it either: Radix keeps `loop` on for a non-modal dialog, so
  // focus cycles inside the dialog (both measured in a browser).
  //
  // What the backdrop does NOT do is make anything `aria-hidden` or `inert` — that is what
  // non-modal bought and it is deliberately kept — so a card behind it is still a focusable button
  // that activates on Enter, which is how an assistive technology's virtual cursor reaches it. The
  // focus here is set the way that route sets it, rather than by tabbing to it, because tabbing to
  // it is exactly what does not happen. It swaps the dialog with no unmount in between: the state
  // `key={selection.candidate.address}` exists for. The regression test above pins what the `key`
  // prevents; this pins that the route to it is still open and that the address bar comes along.
  it('swaps to another result when a card behind the open dialog is activated without a pointer, without closing first', async () => {
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const first = window.location.href

    screen.getByRole('button', { name: 'select-b' }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_B.address)
    expect(screen.getByRole('dialog').textContent).not.toContain(CANDIDATE_A.address)
    expect(window.location.href).toBe(shareLink())

    // One push, not a close and an open: Back lands on the first result's own entry rather than
    // on a base URL a dismissal would have pushed in between.
    await traverse(() => window.history.back())
    expect(window.location.href).toBe(first)
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
  })

  // …and the exception to that, which is the whole point of the busy guards. The backdrop has
  // taken the pointer route back, but an activation through the accessibility tree still lands,
  // and would otherwise walk straight around the rule Escape, the X, the backdrop and outside
  // interaction all obey: a send in flight must not lose the one place its outcome can be read
  // inline. A stray activation would swap `selection`, unmount the dialog mid-send through the
  // `key`, and leave a "Gas was spent" message with nowhere to land but a toast on a timer — while
  // the abandoned sequence's `finally` handed mining back and re-enabled the chain selector under a
  // wallet still holding the transaction. So `selectFromGrid`'s `deploying` guard is not made
  // redundant by the backdrop, and this drives it by the route the backdrop leaves open.
  it('ignores a card activated behind the dialog while a send is in flight, and takes it again once settled', async () => {
    const release = pendingDeploy()
    render(<Page />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    const opened = window.location.href
    await user.click(deployButton())
    expect(screen.getByText('paused')).toBeDefined()

    screen.getByRole('button', { name: 'select-b' }).focus()
    await user.keyboard('{Enter}')

    // Nothing moved: the same dialog, the same in-flight sequence, the same URL. In particular
    // mining is still paused and the selector still disabled — an unmount here would have handed
    // both back while the wallet still had the transaction. What HAS changed is that the refusal
    // now says so rather than looking like a dead grid, so the deploy dialog is asserted on by
    // name rather than as "the dialog".
    expect(await screen.findByText(/deploy is already in progress/i)).toBeDefined()
    // Dismissed before the assertions below, as a user would: the warning is modal, so while it is
    // up the deploy dialog behind it is out of the accessibility tree and out of reach of a role
    // query — which is exactly what a modal is for.
    await user.click(screen.getByRole('button', { name: /keep waiting/i }))

    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(screen.getByRole('dialog').textContent).not.toContain(CANDIDATE_B.address)
    expect(screen.getByRole('button', { name: /waiting for wallet/i })).toBeDefined()
    expect(window.location.href).toBe(opened)
    expect(screen.getByText('paused')).toBeDefined()
    expect((screen.getByRole('combobox', { name: /^chain$/i }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    // The moment the attempt settles the grid takes the same activation again — this is a guard
    // for the window, not a new lock on the leaderboard.
    await release()
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
    screen.getByRole('button', { name: 'select-b' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_B.address)
  })

  // The carry keeps the candidate, so without the chain in the `key` it would re-render this
  // dialog rather than replace it — and a finished deploy's `status`/`completed` would come along.
  // This is the flow the dialog's own copy invites ("you can copy the share link and deploy it
  // later, on any chain"), and it is exactly the flow the carry was supposed to unlock: deploy on
  // Sepolia, then switch to Polygon to deploy the same address there.
  it('starts the carried dialog clean, so a finished deploy does not disable the new chain', async () => {
    // The wallet moves with the user, so the wrong-chain gate is out of the way in both halves and
    // what is asserted is the deploy button's own state rather than which button is rendered.
    let walletChain = 11155111
    useAccountMock.mockImplementation(() => ({
      isConnected: true,
      address: '0x' + 'cc'.repeat(20),
      chainId: walletChain,
    }))
    buildDeploymentPlanMock.mockResolvedValue(PLAN_FOR(CANDIDATE_A.address))
    getSafeAddressFromDeploymentTxMock.mockReturnValue(CANDIDATE_A.address)

    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    await user.click(deployButton())

    expect(
      await screen.findByRole('heading', { name: /^safe deployed$/i }, { timeout: 5000 }),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: /^deploy safe$/i })).toBeNull()

    walletChain = 137
    await chooseChain(user, /polygon/i)

    // A fresh dialog on the same address: no Sepolia success line above a Polygon description, and
    // a Deploy button that can actually be pressed.
    expect(screen.getByRole('dialog').textContent).toContain(CANDIDATE_A.address)
    expect(screen.getByRole('dialog').textContent).toContain('Polygon')
    expect(deployed()).toBeNull()
    expect((deployButton() as HTMLButtonElement).disabled).toBe(false)
    expect(sharedChainId()).toBe(137)
  })

  // The window before either a run or a selection exists, and the one the resolving overlay leaves
  // open on purpose: it swallows the pointer but traps no focus, so a keyboard user can reach the
  // header while a link's saltNonce is still being reconstructed. The link's chain is already
  // spoken for there — the address about to appear is derived from it — so a crossing has to be
  // asked about. Unasked, the header would land on the other singleton class and the candidate
  // would arrive paired with a config for the class the header had just left: a `selection` and a
  // run in different classes, which is the one state from which a later same-class switch could
  // carry a `Safe.sol` address onto a `SafeL2.sol` config and offer a share link that reproduces a
  // DIFFERENT address for whoever opened it.
  it('asks about the link being resolved before crossing the boundary out from under it', async () => {
    let resolveCandidate: (candidate: unknown) => void = () => {}
    linkCandidateOverride.current = () =>
      new Promise((resolve) => {
        resolveCandidate = resolve
      })
    // A link on mainnet: any of the six is a crossing from here.
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: CONFIG.owners,
        threshold: CONFIG.threshold,
        safeVersion: CONFIG.safeVersion,
        chainId: 1,
        saltNonce: '12345',
      }),
    })

    render(<Page />)
    const user = userEvent.setup()
    expect(spinner()).not.toBeNull()

    await chooseChain(user, /sepolia/i)

    // Asked, and nothing switched yet. `{ hidden: true }` here and only here: the CONFIRMATION is
    // modal, deliberately and unchanged — it is a blocking question, not a panel to work beside —
    // so while it is up the header behind it is aria-hidden exactly as it should be.
    expect(await screen.findByText(/switch to sepolia\?/i)).toBeDefined()
    expect(screen.getByRole('combobox', { name: /^chain$/i, hidden: true }).textContent).toContain(
      'Ethereum',
    )

    // Declining leaves the link alone: it resolves into its own dialog, on its own chain.
    await user.click(screen.getByRole('button', { name: /^stay on ethereum$/i }))
    await act(async () => {
      resolveCandidate(CANDIDATE_A)
    })
    expect(await screen.findByRole('dialog')).toBeDefined()
    expect(shownChain()).toContain('Ethereum')
    expect(sharedChainId()).toBe(1)
  })

  it('discards the link being resolved when the crossing is confirmed, rather than repairing it later', async () => {
    let resolveCandidate: (candidate: unknown) => void = () => {}
    linkCandidateOverride.current = () =>
      new Promise((resolve) => {
        resolveCandidate = resolve
      })
    searchParamsRef.current = new URLSearchParams({
      config: encodeConfigParam({
        owners: CONFIG.owners,
        threshold: CONFIG.threshold,
        safeVersion: CONFIG.safeVersion,
        chainId: 1,
        saltNonce: '12345',
      }),
    })

    render(<Page />)
    const user = userEvent.setup()

    await chooseChain(user, /sepolia/i)
    await user.click(screen.getByRole('button', { name: /switch and start over/i }))

    // The reset is the one "Start over" performs, and it holds even though the reconstruction was
    // still in flight when it happened: the candidate it produces belongs to a chain the user has
    // left, so it must not open a dialog on the page it lands on.
    await act(async () => {
      resolveCandidate(CANDIDATE_A)
    })
    expect(shownChain()).toContain('Sepolia')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(spinner()).toBeNull()
    expect(screen.getByRole('button', { name: 'submit-config' })).toBeDefined()

    // And the search the recipient starts from here is on the chain they chose, with no trace of
    // the link's own.
    await user.click(screen.getByRole('button', { name: 'submit-config' }))
    await user.click(screen.getByRole('button', { name: 'select-a' }))
    expect(sharedChainId()).toBe(11155111)
  })
})
