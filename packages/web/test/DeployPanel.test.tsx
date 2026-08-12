import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeployPanel } from '../components/DeployPanel'
import { decodeConfigParam } from '../lib/deep-link'

// Hoisted so each test can drive its own wagmi state — a module-scoped factory (the brief's
// original mock) can only ever return one fixed state, which meant every test rendered the
// same disconnected component and never exercised the wrong-chain gate, the connected branch,
// or error rendering. The panel itself no longer touches wagmi, but the dialog it renders
// does, so the mock stays.
const { useAccountMock, useSwitchChainMock, useConnectorClientMock } = vi.hoisted(() => ({
  useAccountMock: vi.fn(),
  useSwitchChainMock: vi.fn(() => ({ switchChain: vi.fn() })),
  useConnectorClientMock: vi.fn(() => ({ data: undefined })),
}))

vi.mock('wagmi', () => ({
  useAccount: useAccountMock,
  useSwitchChain: useSwitchChainMock,
  useConnectorClient: useConnectorClientMock,
  createConfig: vi.fn(() => ({})),
  http: vi.fn(() => ({})),
}))

// Nothing here should ever reach a network or a wallet: the deploy sequence itself is covered
// in DeployDialog.test.tsx, and this suite only opens the dialog.
vi.mock('@safe-vanity-blockie/safe-config', () => ({
  loadSafeConstants: vi.fn().mockRejectedValue(new Error('Could not read Safe constants (test).')),
  // Read directly by ../lib/config's validateMineConfig, which the share-link round-trip test
  // below reaches through the real decodeConfigParam. An empty set collides with nothing here.
  ZKSYNC_CHAIN_IDS: new Set(),
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

const config = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }
const connectedAddress = '0x' + 'aa'.repeat(20)

beforeEach(() => {
  useAccountMock.mockReset()
  useAccountMock.mockReturnValue({ isConnected: false, address: undefined, chainId: 1 })
  useConnectorClientMock.mockReturnValue({ data: undefined })
})

function renderPanel() {
  render(
    <DeployPanel
      config={config as never}
      candidate={candidate}
      onDeployStart={vi.fn()}
      onDeploySettled={vi.fn()}
    />,
  )
}

describe('DeployPanel', () => {
  it('repeats the phishing caveat where the user is about to spend money', () => {
    renderPanel()
    expect(screen.getByText(/cosmetic/i)).toBeDefined()
  })

  it('always shows the counterfactual alternative, so deploying is not the only path', () => {
    renderPanel()
    expect(screen.getByText(/deploy it later/i)).toBeDefined()
  })

  it('shows the full address and saltNonce of the chosen candidate', () => {
    renderPanel()
    expect(screen.getByText(candidate.address)).toBeDefined()
    expect(screen.getByText(/1885506/)).toBeDefined()
  })

  it('keeps the share link reachable without deploying', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /copy share link/i })).toBeDefined()
  })

  // T1. The whole point of a share link is that it reproduces THIS address, and the only thing
  // that carries the address is the saltNonce. Asserting the button exists, or that the URL
  // contains "/?config=", leaves the entire encode half of the round trip unpinned: drop the
  // saltNonce here and every link silently degrades to "prefills four form fields", with the
  // recipient mining a different face and no error anywhere. So this decodes what the UI
  // actually produced, with the real decoder, and compares it field for field.
  it('T1: builds a share link that decodes back to this config, saltNonce included', () => {
    renderPanel()

    const value = (screen.getByRole('textbox', { name: /share link/i }) as HTMLInputElement).value
    const param = new URL(value).searchParams.get('config')
    expect(param).not.toBeNull()

    const decoded = decodeConfigParam(param as string)
    expect(decoded.error).toBeUndefined()
    expect(decoded.config).toEqual({ ...config, saltNonce: candidate.saltNonce })
  })

  // S4. The trigger is a plain Button rather than a DialogTrigger, so without these a screen
  // reader is never told that activating it opens a dialog. The caveat beside it is static copy
  // and must not be a live region competing with the real deploy error.
  it('announces that its trigger opens a dialog, and keeps the caveat a note', async () => {
    useAccountMock.mockReturnValue({
      isConnected: true,
      address: connectedAddress,
      chainId: config.chainId,
    })
    renderPanel()

    const trigger = screen.getByRole('button', { name: /deploy this safe…/i })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('note').textContent).toMatch(/cosmetic/i)

    await userEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('titles the panel as a real heading', () => {
    renderPanel()
    expect(screen.getByRole('heading', { level: 2, name: /^deploy$/i })).toBeDefined()
  })

  // The deploy button, the wrong-chain gate and the error alert moved to DeployDialog with the
  // handler; what the panel still owns is opening that dialog.
  it('opens the deploy dialog, where the confirmation is read', async () => {
    useAccountMock.mockReturnValue({
      isConnected: true,
      address: connectedAddress,
      chainId: config.chainId,
    })
    renderPanel()

    expect(screen.queryByRole('button', { name: /^deploy this safe$/i })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /deploy this safe…/i }))

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('button', { name: /^deploy this safe$/i })).toBeDefined()
    // The other half of the gate: on the configured chain there must be no switch-network
    // prompt. Without this, loosening the `wrongChain` comparison so that BOTH branches render
    // would still pass every other assertion in this suite.
    expect(screen.queryByRole('button', { name: /switch network/i })).toBeNull()
  })
})
