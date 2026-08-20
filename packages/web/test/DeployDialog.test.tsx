import { loadSafeConstants } from '@safe-vanity-blockie/safe-config'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MineConfig } from '../lib/config'
import { decodeConfigParam } from '../lib/deep-link'

const state = vi.hoisted(() => ({
  account: { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 11155111 },
  // The client wagmi hands over once a connector is ready. Undefined is a real, reachable state:
  // connected, but the provider has not answered yet.
  client: { transport: {} } as { transport: object } | undefined,
  // lib/wagmi configures MetaMask alone, so this is a one-element list in production; the empty
  // case below is what the connect button's disabled state exists for.
  connectors: [{ uid: 'metamask', name: 'MetaMask' }] as { uid: string; name: string }[],
  connect: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => state.account,
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useConnect: () => ({ connect: state.connect, connectors: state.connectors, isPending: false }),
  useConnectorClient: () => ({ data: state.client }),
  // The error-rendering test below clicks the deploy button, which dynamically imports
  // ../lib/wagmi for chainById — that module also imports createConfig/http from 'wagmi' at
  // its top level, so the mock needs harmless stand-ins for those or the import itself throws.
  createConfig: vi.fn(() => ({})),
  http: vi.fn(() => ({})),
}))

// Fails fast, before any network or wallet call, so the tests that click "Deploy this Safe"
// never reach sendTransaction or any real RPC — they only exercise the pause/resume callbacks
// and the catch/alert path.
vi.mock('@safe-vanity-blockie/safe-config', () => ({
  loadSafeConstants: vi.fn().mockRejectedValue(new Error('Could not read Safe constants (test).')),
  // Read directly by ../lib/config's validateMineConfig, which the share-link round-trip test
  // below reaches through the real decodeConfigParam. An empty set collides with nothing here.
  ZKSYNC_CHAIN_IDS: new Set(),
}))

vi.mock('../lib/deploy', () => ({
  buildDeploymentPlan: vi.fn(() => new Promise(() => {})),
}))

const candidate = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}
const config = {
  owners: ['0x' + '11'.repeat(20)],
  threshold: 1,
  safeVersion: '1.4.1' as const,
  chainId: 11155111,
}

beforeEach(() => {
  state.account = { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 11155111 }
  state.client = { transport: {} }
  state.connectors = [{ uid: 'metamask', name: 'MetaMask' }]
  state.connect.mockClear()
})

/**
 * Imported inside the helper rather than at the top of the file: the wagmi/safe-config mocks
 * above have to be in place before the component module is evaluated.
 */
async function renderDialog(
  props: {
    onDeployStart?: () => void
    onDeploySettled?: () => void
    onOpenChange?: () => void
    /** Overridden by the config-summary test, which needs owners nothing else here shares. */
    config?: MineConfig
  } = {},
) {
  const { DeployDialog } = await import('../components/DeployDialog')
  return render(
    <DeployDialog
      open
      candidate={candidate}
      config={props.config ?? config}
      onOpenChange={props.onOpenChange ?? vi.fn()}
      onDeployStart={props.onDeployStart ?? vi.fn()}
      onDeploySettled={props.onDeploySettled ?? vi.fn()}
    />,
  )
}

describe('DeployDialog', () => {
  it('repeats the phishing caveat where money is spent', async () => {
    await renderDialog()
    expect(screen.getByText(/cosmetic/i)).toBeDefined()
  })

  // The same warning box the About dialog and the results callout use: amber rather than the
  // default tint, one flowing sentence rather than a title stacked over a description. Met three
  // times in one session, it has to be recognisably one warning rather than three that happen to
  // start with the same words.
  it("draws the caveat as the app's warning box", async () => {
    await renderDialog()
    const note = screen.getByRole('note')
    expect(note.className).toMatch(/amber/)
    expect(note.querySelector('[data-slot="alert-title"]')).toBeNull()
    expect(note.querySelector('strong')?.textContent).toMatch(/a matching identicon is cosmetic/i)
  })

  // Each owner beside the identicon its address produces: this is the screen where a Safe is
  // paid for, and the owner set is what determines control of it. A reader who recognises their
  // own blockie has a check that reading 42 hex characters does not give them.
  it('draws each owner with its own identicon', async () => {
    const senders = {
      owners: ['0x' + '44'.repeat(20), '0x' + '55'.repeat(20)],
      threshold: 2,
      safeVersion: '1.3.0' as const,
      chainId: 137,
    }
    await renderDialog({ config: senders })

    const identicons = document.querySelectorAll('[data-slot="owner-identicon"]')
    expect(identicons).toHaveLength(senders.owners.length)
    for (const node of identicons) {
      expect(node.getAttribute('aria-hidden')).toBe('true')
      expect(node.querySelector('svg')).not.toBeNull()
    }
  })

  // Monospace rather than a badge: it is a version number in a list of values, and the badge made
  // it look like the one field in the block with a state.
  it('sets the Safe version in monospace', async () => {
    await renderDialog({
      config: { owners: [config.owners[0]], threshold: 1, safeVersion: '1.3.0', chainId: 1 },
    })
    const version = screen.getByText('1.3.0')
    expect(version.className).toMatch(/font-mono/)
    expect(version.closest('[data-slot="badge"]')).toBeNull()
  })

  it('shows the address and saltNonce being deployed', async () => {
    await renderDialog()
    expect(screen.getByText(candidate.address)).toBeDefined()
    expect(screen.getByText(/1885506/)).toBeDefined()
  })

  // One line, unbroken, ungrouped and at full strength: this is the screen where an address is
  // compared character by character against a wallet, so it is the thing being read rather than
  // context for something else.
  it('renders the address on one line, in the strongest colour on the card', async () => {
    await renderDialog()
    const line = screen.getByText(candidate.address)
    expect(line.className).toMatch(/font-mono/)
    expect(line.className).toMatch(/text-foreground/)
  })

  // The saltNonce is the other value here worth copying, since it is what reproduces the address;
  // its label stays quiet and the number does not.
  it('sets the saltNonce apart from the words around it', async () => {
    await renderDialog()
    expect(screen.getByText(candidate.saltNonce).className).toMatch(/text-foreground/)
  })

  // Every copy control on this screen is the same control. Making the address's louder than the
  // rest said the button was the important thing, when the address is.
  it('copies the address with the same control as everything else', async () => {
    await renderDialog()
    const address = screen.getByRole('button', { name: /copy safe address/i })
    const nonce = screen.getByRole('button', { name: /copy saltnonce/i })
    expect(address.getAttribute('data-size')).toBe(nonce.getAttribute('data-size'))
    expect(address.getAttribute('data-variant')).toBe(nonce.getAttribute('data-variant'))
  })

  // Three badges of mining trivia sat directly under the address they were competing with, on the
  // one screen where nothing may compete with it.
  it('drops the expression, contrast and colour-count chips', async () => {
    await renderDialog()
    expect(screen.queryByText(/contrast/i)).toBeNull()
    expect(screen.queryByText(/two colours/i)).toBeNull()
    expect(screen.queryByText(/^small$/i)).toBeNull()
  })

  // Singular when there is one of them: "Owners" over a single row, or "1 of 1 signers", is the
  // kind of small wrongness that makes a reader wonder what else here is generated rather than
  // read.
  it('counts owners and signers in the singular when there is one', async () => {
    await renderDialog({
      config: { owners: [config.owners[0]], threshold: 1, safeVersion: '1.4.1', chainId: 11155111 },
    })
    expect(screen.getByText('Owner')).toBeDefined()
    expect(screen.getByText(/1 of 1 signer$/)).toBeDefined()
  })

  // The dialog used to name the address and the saltNonce but never whose Safe it was — and the
  // one state where that matters is reachable: a share-link recipient can submit their own config
  // while the reconstruction is still in flight, ending with the Configure card summarising THEIR
  // owners while this dialog deploys the SENDER's. The `selection: { candidate, config }` pairing
  // already makes that safe; this makes it visible.
  //
  // Rendered with a config that shares nothing with the fixture used everywhere else in this file
  // (nor with the connected account), so the assertions can only pass if the block reads this
  // component's own `config` prop.
  it('names the config it deploys with: owners in full, threshold and Safe version', async () => {
    const senders = {
      owners: ['0x' + '44'.repeat(20), '0x' + '55'.repeat(20)],
      threshold: 2,
      safeVersion: '1.3.0' as const,
      chainId: 137,
    }
    await renderDialog({ config: senders })

    // Every owner, in full: the owner set is what determines control of the Safe, and a count is
    // nothing a user can check against an address they recognise.
    for (const owner of senders.owners) expect(screen.getByText(owner)).toBeDefined()
    expect(screen.getByText(/2 of 2 signers/i)).toBeDefined()
    expect(screen.getByText('1.3.0')).toBeDefined()

    // And nothing of the config this file's other tests use leaked in from anywhere else.
    expect(screen.queryByText(config.owners[0] as string)).toBeNull()
    expect(screen.queryByText('1.4.1')).toBeNull()
  })

  // The chain is not in the list. These three fields are what the ADDRESS is derived from and
  // what cannot change without invalidating it; the chain is neither — the same address is this
  // Safe's address on all six non-mainnet chains, and it is a live header control that can move
  // while this dialog is open, so listing it here would have made it the one line in the block
  // that changes under the reader. Where the money goes is still named, once, in the description
  // above.
  //
  // The block carries no heading of its own any more: it is three labelled rows inside a dialog
  // whose title already says what is being deployed, and "Safe config" was a label for a thing
  // the labels underneath it were already naming.
  it('leaves the chain out of the config block, keeping it in the description', async () => {
    await renderDialog({
      config: {
        owners: ['0x' + '44'.repeat(20)],
        threshold: 1,
        safeVersion: '1.3.0' as const,
        chainId: 137,
      },
    })

    expect(screen.queryByRole('heading', { name: /^safe config$/i })).toBeNull()
    expect(screen.queryByText(/the config this address comes from/i)).toBeNull()
    // Not a row in the list…
    const summary = screen.getByText(/^owner$/i).closest('dl')!
    expect(summary.textContent).not.toMatch(/network/i)
    expect(summary.textContent).not.toMatch(/polygon/i)
    // …but still said, by name and not as id 137, in the sentence about spending gas.
    const description = screen.getByText(/spends gas/i)
    expect(description.textContent).toMatch(/Polygon/)
    expect(screen.queryByText(/137/)).toBeNull()
  })

  // Non-modal, and this is what that has to mean: the page behind stays in the accessibility tree
  // (Radix `hideOthers` would have `aria-hidden` it), nothing is inert, and Radix lays no overlay
  // of its own — the backdrop this component draws is a different element with a different shape
  // (it stops at the header) and a different slot, which is why the query below is specifically
  // for Radix's. Interacting with something outside that is NOT the backdrop is not a dismissal:
  // reaching for the header's chain selector, or moving focus onto something behind, must not
  // throw away the result that reach was for. The backdrop's own click is the exception, three
  // tests below.
  it('leaves the page behind it in the tree, lays no Radix overlay, and does not dismiss on an outside click', async () => {
    const onOpenChange = vi.fn()
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <div>
        <button type="button">behind the dialog</button>
        <DeployDialog
          open
          candidate={candidate}
          config={config}
          onOpenChange={onOpenChange}
          onDeployStart={vi.fn()}
          onDeploySettled={vi.fn()}
        />
      </div>,
    )

    const behind = screen.getByRole('button', { name: /behind the dialog/i })
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()

    await userEvent.click(behind)
    expect(onOpenChange).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  /**
   * The backdrop this dialog draws for itself. Radix renders no overlay at all for a non-modal
   * dialog (`DialogOverlay` returns null), so this is not the shadcn one under another name — it
   * is queried by its own slot, and the assertion above that `[data-slot="dialog-overlay"]` is
   * still absent stays true beside it.
   */
  const backdrop = () =>
    document.querySelector('[data-slot="deploy-dialog-backdrop"]') as HTMLElement | null

  // HEADLINE 1. What the backdrop covers, expressed the only way jsdom can express it: the classes
  // that decide it. `top-14` is the header's own `h-14` in app/layout.tsx — the same relationship
  // MiningStatusBar's `top-14` already depends on — so the covered region starts exactly where the
  // header ends and the header is exempt by construction rather than by a special case. The
  // stacking is asserted as the constraint rather than as a magic number: above the mining status
  // bar (z-40) and page content, below this dialog's own content and the header (both z-50). That
  // the two boxes really do not overlap, and that the class really generates CSS, are checked in
  // the headless run — neither is something jsdom can see.
  it('draws a backdrop over everything below the header, and nothing above it', async () => {
    await renderDialog()

    const element = backdrop()
    expect(element).not.toBeNull()
    const classes = (element as HTMLElement).className.split(/\s+/)

    expect(classes).toContain('fixed')
    expect(classes).toContain('inset-x-0')
    expect(classes).toContain('bottom-0')
    expect(classes).toContain('top-14')
    // Not the full-viewport sheet: that is the resolving overlay's shape, and it covers the header
    // on purpose. This one must not.
    expect(classes).not.toContain('inset-0')

    // The same visual language as that overlay, which is what was asked for.
    expect(classes).toContain('bg-background/60')
    expect(classes).toContain('backdrop-blur-sm')

    const layer = Number(classes.find((name) => /^z-\d+$/.test(name))?.slice(2))
    expect(layer).toBeGreaterThan(40)
    expect(layer).toBeLessThan(50)
  })

  // HEADLINE 2. The backdrop is unambiguously "not the dialog and not the header": there is
  // nothing on it to reach for, so a click on it can only mean "dismiss this". That is what makes
  // it — and only it — a dismissal, while `onInteractOutside` stays refused for everything else
  // (the header above all, which is the whole reason this dialog is non-modal).
  it('closes when the darkened area is clicked', async () => {
    const onOpenChange = vi.fn()
    await renderDialog({ onOpenChange })

    await userEvent.click(backdrop() as HTMLElement)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // HEADLINE 3. …and the exception, which is the same rule Escape and the X already obey. While a
  // send is in flight this dialog is the only place its outcome can be read inline, and closing
  // unmounts it outright, so an accidental dismissal costs the user the status of a transaction
  // the wallet is holding. A backdrop click is exactly that class of accident. The deliberate,
  // relabelled footer button is still the way out.
  it('does not close on a backdrop click while a send is in flight', async () => {
    // Resolves so the sequence gets past the constants read (this file's module mock rejects it by
    // default); ../lib/deploy's buildDeploymentPlan then never settles, so `busy` stays true.
    vi.mocked(loadSafeConstants).mockResolvedValueOnce({} as never)
    const onOpenChange = vi.fn()
    await renderDialog({ onOpenChange })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /^deploy safe$/i }))
    // The busy label the footer's one primary button takes on while the wallet has the request.
    expect(await screen.findByRole('button', { name: /waiting for wallet/i })).toBeDefined()

    // Asserted before the click, and not merely implied by it: "there is nothing to click" would
    // otherwise satisfy "clicking it does not close", and this test would pass on a build with no
    // backdrop at all.
    expect(backdrop()).not.toBeNull()
    await user.click(backdrop() as HTMLElement)
    expect(onOpenChange).not.toHaveBeenCalled()

    // The one route out that says what it is, and it is untouched.
    expect(screen.getByRole('button', { name: /close and keep waiting/i })).toBeDefined()
  })

  it('pauses mining the moment a deploy is initiated', async () => {
    const onDeployStart = vi.fn()
    await renderDialog({ onDeployStart })
    await userEvent.click(screen.getByRole('button', { name: /^deploy safe$/i }))
    expect(onDeployStart).toHaveBeenCalledOnce()
  })

  // The prompt is a button among the footer's actions, not a line of prose further up: connecting
  // is the next thing to do here, and it lands where the deploy button will be once it is done.
  it('asks for a wallet before offering to deploy, and connects when asked', async () => {
    state.account = { isConnected: false, address: undefined as never, chainId: 11155111 }
    await renderDialog()

    const connectButton = screen.getByRole('button', { name: /^connect a wallet$/i })
    expect(screen.queryByRole('button', { name: /^deploy safe$/i })).toBeNull()

    await userEvent.click(connectButton)
    expect(state.connect).toHaveBeenCalledWith({ connector: state.connectors[0] })
  })

  // Nothing to connect with means nothing to click: an enabled button that cannot do anything is
  // worse than a disabled one, since the failure only shows up after the user commits to it.
  it('disables the connect button when there is no connector at all', async () => {
    state.account = { isConnected: false, address: undefined as never, chainId: 11155111 }
    state.connectors = []
    await renderDialog()

    const connectButton = screen.getByRole('button', { name: /^connect a wallet$/i })
    expect((connectButton as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the counterfactual path alongside deploying', async () => {
    await renderDialog()
    expect(screen.getByText(/deploy later instead/i)).toBeDefined()
  })

  // Moved from DeployPanel.test.tsx: the wrong-chain gate now lives here, with the button it
  // gates.
  // Named, not "Switch network to continue": the chain is the one thing about this deploy a user
  // may not have noticed changing, and naming it is the last chance to catch that.
  it('shows the switch-network gate and no deploy button when connected on the wrong chain', async () => {
    state.account = { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 999 }
    await renderDialog()
    expect(screen.getByRole('button', { name: /^switch to sepolia$/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /^deploy safe$/i })).toBeNull()
  })

  // The other half of that gate, moved from DeployPanel.test.tsx's "opens the deploy dialog"
  // test: on the configured chain there must be no switch-network prompt. Without this,
  // loosening the `wrongChain` comparison so BOTH branches render would still pass every other
  // assertion in this suite.
  it('offers only the deploy button when connected on the configured chain', async () => {
    await renderDialog()
    expect(screen.getByRole('button', { name: /^deploy safe$/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /switch to/i })).toBeNull()
  })

  // The state the removed "Waiting for the wallet client…" line reported. It reads as a disabled
  // button rather than a line of prose because that is what it is: the deploy handler returns
  // immediately without a client, so an enabled button here does nothing at all.
  it('disables the deploy button until the wallet client arrives', async () => {
    state.client = undefined
    await renderDialog()

    const deploy = screen.getByRole('button', { name: /connecting to your wallet/i })
    expect((deploy as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/waiting for the wallet client/i)).toBeNull()
  })

  // Moved from DeployPanel.test.tsx, plus the resume half of the pause contract: a deploy that
  // fails must hand mining back, or the user is left staring at a stopped miner.
  // The failure has a screen of its own now rather than an alert under a form: the reason is its
  // subtitle, and the dialog's own live region announces it. Queried through `aria-describedby`
  // because that region deliberately repeats the words, so a text query matches twice.
  //
  // A generous timeout: this waits on a dynamic import plus a rejected promise, and the default
  // 1000ms has been observed to flake under the CPU contention of a full monorepo `pnpm -r test`
  // run (many suites' worker pools competing for cores at once).
  it('turns into the failure screen when the deploy attempt fails, and resumes mining', async () => {
    const onDeploySettled = vi.fn()
    await renderDialog({ onDeploySettled })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^deploy safe$/i }))

    expect(
      await screen.findByRole('heading', { name: /^deployment failed$/i }, { timeout: 5000 }),
    ).toBeDefined()
    const describedBy = screen.getByRole('dialog').getAttribute('aria-describedby') as string
    expect(document.getElementById(describedBy)?.textContent).toMatch(
      /Could not read Safe constants/,
    )
    expect(onDeploySettled).toHaveBeenCalledOnce()
  })

  // The bug this pins: a failure before anything was sent used to leave a spinner and the word
  // "Working…" on screen, because the status panel treated "there is an error" as "there is
  // something in progress". Nothing is in progress — the wallet said no, or the read failed.
  it('stops spinning when a deploy fails before anything was sent', async () => {
    await renderDialog()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^deploy safe$/i }))
    await screen.findByRole('heading', { name: /^deployment failed$/i }, { timeout: 5000 })

    expect(screen.queryByText(/working/i)).toBeNull()
    expect(document.querySelector('.animate-spin')).toBeNull()
  })

  // Nothing was spent, so the way back to the form is a press away — offered rather than assumed,
  // because a screen that silently reverted to a form would lose the reason it failed. Everything
  // the dialog was offering before the attempt is on offer again once it is taken.
  it('offers the way back to the form after a failure that spent nothing', async () => {
    await renderDialog()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^deploy safe$/i }))
    await screen.findByRole('heading', { name: /^deployment failed$/i }, { timeout: 5000 })

    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByRole('heading', { name: /^deploy this safe$/i })).toBeDefined()
    expect(screen.getByText(/^threshold$/i)).toBeDefined()
    expect(screen.getByRole('link', { name: /copy share link/i })).toBeDefined()
    const retry = screen.getByRole('button', { name: /^deploy safe$/i })
    expect((retry as HTMLButtonElement).disabled).toBe(false)
  })

  // Moved from DeployPanel.test.tsx: the panel that used to carry the score, the big blockie and
  // the share link is gone, and this dialog is now the only place any of them can be read.
  it('shows the score as a percentage, not a raw fraction', async () => {
    await renderDialog()
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.queryByText(/120\/133/)).toBeNull()
  })

  // The dialog is where the address is checked character by character, so the identicon has to
  // be big enough to compare against the card that was clicked — the panel's 128, not the 64
  // this dialog used when it sat behind one.
  // The identicon is what a look-alike attack imitates, so it is the one picture in the app worth
  // drawing large: it is compared against the tile that was clicked, and against whatever the
  // wallet shows next.
  it('draws the identicon large enough to compare against a wallet', async () => {
    await renderDialog()
    const blockie = screen.getByRole('img', { name: /identicon/i })
    expect(blockie.querySelector('svg')).not.toBeNull()
    expect(blockie.className).toMatch(/size-24/)
  })

  // A real link rather than a button, and that is load-bearing: clicking it copies, but the href
  // is what is left when the clipboard is unavailable, which is every non-secure origin. The share
  // link is the only way to keep a mined saltNonce without deploying, so a failed copy must not be
  // the end of the road — this is what replaced the selectable input the row used to carry.
  it('keeps the share link reachable without deploying, and without the clipboard', async () => {
    await renderDialog()
    const link = screen.getByRole('link', { name: /copy share link/i }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toMatch(/\?config=/)
    expect(screen.queryByRole('textbox', { name: /share link/i })).toBeNull()
  })

  it('copies the share link on a plain click, rather than following it', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await renderDialog()

    const link = screen.getByRole('link', { name: /copy share link/i })
    // fireEvent, not userEvent: userEvent.setup() replaces navigator.clipboard with its own stub.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(link, click)

    expect(writeText).toHaveBeenCalledWith(link.getAttribute('href'))
    expect(click.defaultPrevented).toBe(true)
  })

  // T1. The whole point of a share link is that it reproduces THIS address, and the only thing
  // that carries the address is the saltNonce. Asserting the button exists, or that the URL
  // contains "/?config=", leaves the entire encode half of the round trip unpinned: drop the
  // saltNonce here and every link silently degrades to "prefills four form fields", with the
  // recipient mining a different face and no error anywhere. So this decodes what the UI
  // actually produced, with the real decoder, and compares it field for field.
  it('T1: builds a share link that decodes back to this config, saltNonce included', async () => {
    await renderDialog()

    const href = screen
      .getByRole('link', { name: /copy share link/i })
      .getAttribute('href') as string
    const param = new URL(href, 'http://localhost').searchParams.get('config')
    expect(param).not.toBeNull()

    const decoded = decodeConfigParam(param as string)
    expect(decoded.error).toBeUndefined()
    expect(decoded.config).toEqual({ ...config, saltNonce: candidate.saltNonce })
  })

  // S4, second half (moved from DeployPanel.test.tsx; the aria-haspopup half moved to
  // ResultCard.test.tsx with the trigger). The caveat is static copy that is always on screen,
  // so as a live region it would compete permanently with the real deploy status/error below it.
  it('keeps the phishing caveat a note, not a second live region', async () => {
    await renderDialog()
    expect(screen.getByRole('note').textContent).toMatch(/cosmetic/i)
  })

  // Moved from DeployPanel.test.tsx's "titles the panel as a real heading": the deploy step is
  // still a real heading, it is just the dialog's title now.
  it('titles itself as a real heading', async () => {
    await renderDialog()
    expect(screen.getByRole('heading', { level: 2, name: /^deploy this safe$/i })).toBeDefined()
  })

  // The panel and the dialog each carried their own copy of the caveat and of the counterfactual
  // paragraph. Merged into one dialog, saying either twice would be noise on the one screen that
  // has to be read carefully.
  it('says the caveat and the counterfactual once each, not twice', async () => {
    await renderDialog()
    expect(screen.getAllByText(/cosmetic/i)).toHaveLength(1)
    expect(screen.getAllByText(/deploy later instead/i)).toHaveLength(1)
  })

  // This is the detail view now: the result tile is a picture, a number and a truncated address,
  // so everything a user might want to read about a result has to be reachable here.

  // A bare "90.2" on the tile is a number without a denominator. The dialog is where there is room
  // to say what it is a percentage of.
  it('says what the score is a percentage of', async () => {
    await renderDialog()
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.getByText(/expression match/i)).toBeDefined()
  })

  it('offers to copy the address, which is the thing being verified', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await renderDialog()

    // fireEvent, not userEvent: userEvent.setup() replaces navigator.clipboard with its own stub.
    fireEvent.click(screen.getByRole('button', { name: /copy safe address/i }))
    expect(writeText).toHaveBeenCalledWith(candidate.address)
  })

  // The saltNonce is what reproduces the address, and until now the only way to keep one was the
  // share link — which carries the whole config with it.
  it('offers to copy the saltNonce on its own', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /copy saltnonce/i }))
    expect(writeText).toHaveBeenCalledWith(candidate.saltNonce)
  })
})
