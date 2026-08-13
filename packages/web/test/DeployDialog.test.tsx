import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeConfigParam } from '../lib/deep-link'

const state = vi.hoisted(() => ({
  account: { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 11155111 },
  // lib/wagmi configures MetaMask alone, so this is a one-element list in production; the empty
  // case below is what the connect button's disabled state exists for.
  connectors: [{ uid: 'metamask', name: 'MetaMask' }] as { uid: string; name: string }[],
  connect: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => state.account,
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useConnect: () => ({ connect: state.connect, connectors: state.connectors, isPending: false }),
  useConnectorClient: () => ({ data: { transport: {} } }),
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
  state.connectors = [{ uid: 'metamask', name: 'MetaMask' }]
  state.connect.mockClear()
})

/**
 * Imported inside the helper rather than at the top of the file: the wagmi/safe-config mocks
 * above have to be in place before the component module is evaluated.
 */
async function renderDialog(
  props: { onDeployStart?: () => void; onDeploySettled?: () => void; onOpenChange?: () => void } = {},
) {
  const { DeployDialog } = await import('../components/DeployDialog')
  return render(
    <DeployDialog
      open
      candidate={candidate}
      config={config}
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

  it('shows the address and saltNonce being deployed', async () => {
    await renderDialog()
    expect(screen.getByText(candidate.address)).toBeDefined()
    expect(screen.getByText(/1885506/)).toBeDefined()
  })

  it('pauses mining the moment a deploy is initiated', async () => {
    const onDeployStart = vi.fn()
    await renderDialog({ onDeployStart })
    await userEvent.click(screen.getByRole('button', { name: /^deploy this safe$/i }))
    expect(onDeployStart).toHaveBeenCalledOnce()
  })

  // The prompt is a button among the footer's actions, not a line of prose further up: connecting
  // is the next thing to do here, and it lands where the deploy button will be once it is done.
  it('asks for a wallet before offering to deploy, and connects when asked', async () => {
    state.account = { isConnected: false, address: undefined as never, chainId: 11155111 }
    await renderDialog()

    const connectButton = screen.getByRole('button', { name: /connect a wallet to deploy/i })
    expect(screen.queryByRole('button', { name: /^deploy this safe$/i })).toBeNull()

    await userEvent.click(connectButton)
    expect(state.connect).toHaveBeenCalledWith({ connector: state.connectors[0] })
  })

  // Nothing to connect with means nothing to click: an enabled button that cannot do anything is
  // worse than a disabled one, since the failure only shows up after the user commits to it.
  it('disables the connect button when there is no connector at all', async () => {
    state.account = { isConnected: false, address: undefined as never, chainId: 11155111 }
    state.connectors = []
    await renderDialog()

    const connectButton = screen.getByRole('button', { name: /connect a wallet to deploy/i })
    expect((connectButton as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the counterfactual path alongside deploying', async () => {
    await renderDialog()
    expect(screen.getByText(/deploy it later/i)).toBeDefined()
  })

  // Moved from DeployPanel.test.tsx: the wrong-chain gate now lives here, with the button it
  // gates.
  it('shows the switch-network gate and no deploy button when connected on the wrong chain', async () => {
    state.account = { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 999 }
    await renderDialog()
    expect(screen.getByRole('button', { name: /switch network/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /^deploy this safe$/i })).toBeNull()
  })

  // The other half of that gate, moved from DeployPanel.test.tsx's "opens the deploy dialog"
  // test: on the configured chain there must be no switch-network prompt. Without this,
  // loosening the `wrongChain` comparison so BOTH branches render would still pass every other
  // assertion in this suite.
  it('offers only the deploy button when connected on the configured chain', async () => {
    await renderDialog()
    expect(screen.getByRole('button', { name: /^deploy this safe$/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /switch network/i })).toBeNull()
  })

  // Moved from DeployPanel.test.tsx, plus the resume half of the pause contract: a deploy that
  // fails must hand mining back, or the user is left staring at a stopped miner.
  it('renders an error alert when the deploy attempt fails, and resumes mining', async () => {
    const onDeploySettled = vi.fn()
    await renderDialog({ onDeploySettled })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^deploy this safe$/i }))

    // A generous timeout: this waits on a dynamic import plus a rejected promise, and the
    // default 1000ms has been observed to flake under the CPU contention of a full monorepo
    // `pnpm -r test` run (many suites' worker pools competing for cores at once).
    // Queried by its text rather than by role because the phishing caveat above it is also an
    // Alert (role="alert"); the role is then asserted on the element that was found.
    const message = await screen.findByText(/Could not read Safe constants/, {}, { timeout: 5000 })
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(onDeploySettled).toHaveBeenCalledOnce()
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
  it('draws the identicon large enough to check against the card that was clicked', async () => {
    await renderDialog()
    // Queried through the identicon's own role/label rather than "the first svg in the dialog",
    // which is the caveat's shield icon.
    const svg = screen.getByRole('img', { name: /identicon/i }).querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('width')).toBe('128')
  })

  it('keeps the share link reachable without deploying', async () => {
    await renderDialog()
    expect(screen.getByRole('button', { name: /copy share link/i })).toBeDefined()
  })

  // T1. The whole point of a share link is that it reproduces THIS address, and the only thing
  // that carries the address is the saltNonce. Asserting the button exists, or that the URL
  // contains "/?config=", leaves the entire encode half of the round trip unpinned: drop the
  // saltNonce here and every link silently degrades to "prefills four form fields", with the
  // recipient mining a different face and no error anywhere. So this decodes what the UI
  // actually produced, with the real decoder, and compares it field for field.
  it('T1: builds a share link that decodes back to this config, saltNonce included', async () => {
    await renderDialog()

    const value = (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value
    const param = new URL(value).searchParams.get('config')
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
    expect(screen.getAllByText(/deploy it later/i)).toHaveLength(1)
  })
})
