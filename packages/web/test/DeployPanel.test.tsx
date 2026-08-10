import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeployPanel } from '../components/DeployPanel'

// Hoisted so each test can drive its own wagmi state — a module-scoped factory (the brief's
// original mock) can only ever return one fixed state, which meant every test rendered the
// same disconnected component and never exercised the wrong-chain gate, the connected branch,
// or error rendering.
const { useAccountMock, useSwitchChainMock, useConnectorClientMock } = vi.hoisted(() => ({
  useAccountMock: vi.fn(),
  useSwitchChainMock: vi.fn(() => ({ switchChain: vi.fn() })),
  useConnectorClientMock: vi.fn(() => ({ data: undefined })),
}))

vi.mock('wagmi', () => ({
  useAccount: useAccountMock,
  useSwitchChain: useSwitchChainMock,
  useConnectorClient: useConnectorClientMock,
  // The error-rendering test below clicks the deploy button, which dynamically imports
  // ../lib/wagmi for chainById — that module also imports createConfig/http from 'wagmi' at
  // its top level, so the mock needs harmless stand-ins for those or the import itself throws.
  createConfig: vi.fn(() => ({})),
  http: vi.fn(() => ({})),
}))

// Fails fast, before any network or wallet call, so the error-rendering test below never
// reaches sendTransaction or any real RPC — it only exercises the catch/alert path.
vi.mock('@safe-vanity-blockie/safe-config', () => ({
  loadSafeConstants: vi.fn().mockRejectedValue(new Error('Could not read Safe constants (test).')),
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
  useConnectorClientMock.mockReturnValue({ data: undefined })
})

describe('DeployPanel', () => {
  it('asks for a wallet before offering to deploy', () => {
    useAccountMock.mockReturnValue({ isConnected: false, address: undefined, chainId: 1 })
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/connect a wallet/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /^deploy/i })).toBeNull()
  })

  it('repeats the phishing caveat where the user is about to spend money', () => {
    useAccountMock.mockReturnValue({ isConnected: false, address: undefined, chainId: 1 })
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/cosmetic/i)).toBeDefined()
  })

  it('always shows the counterfactual alternative, so deploying is not the only path', () => {
    useAccountMock.mockReturnValue({ isConnected: false, address: undefined, chainId: 1 })
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/deploy it later/i)).toBeDefined()
  })

  it('shows the switch-network gate and no deploy button when connected on the wrong chain', () => {
    useAccountMock.mockReturnValue({
      isConnected: true,
      address: connectedAddress,
      chainId: 999,
    })
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByRole('button', { name: /switch network/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /^deploy/i })).toBeNull()
  })

  it('offers the deploy button when connected on the configured chain', () => {
    useAccountMock.mockReturnValue({
      isConnected: true,
      address: connectedAddress,
      chainId: config.chainId,
    })
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByRole('button', { name: /^deploy this safe/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /switch network/i })).toBeNull()
  })

  it('renders an error alert when the deploy attempt fails', async () => {
    useAccountMock.mockReturnValue({
      isConnected: true,
      address: connectedAddress,
      chainId: config.chainId,
    })
    useConnectorClientMock.mockReturnValue({
      data: { transport: {}, account: connectedAddress },
    } as never)
    render(<DeployPanel config={config as never} candidate={candidate} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^deploy this safe/i }))

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toMatch(/Could not read Safe constants/)
  })
})
