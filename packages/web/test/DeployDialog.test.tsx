import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  account: { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 11155111 },
}))

vi.mock('wagmi', () => ({
  useAccount: () => state.account,
  useSwitchChain: () => ({ switchChain: vi.fn() }),
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
})

describe('DeployDialog', () => {
  it('repeats the phishing caveat where money is spent', async () => {
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByText(/cosmetic/i)).toBeDefined()
  })

  it('shows the address and saltNonce being deployed', async () => {
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByText(candidate.address)).toBeDefined()
    expect(screen.getByText(/1885506/)).toBeDefined()
  })

  it('pauses mining the moment a deploy is initiated', async () => {
    const onDeployStart = vi.fn()
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={onDeployStart}
        onDeploySettled={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /deploy this safe/i }))
    expect(onDeployStart).toHaveBeenCalledOnce()
  })

  it('asks for a wallet before offering to deploy', async () => {
    state.account = { isConnected: false, address: undefined as never, chainId: 11155111 }
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByText(/connect a wallet/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /deploy this safe/i })).toBeNull()
  })

  it('offers the counterfactual path alongside deploying', async () => {
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByText(/deploy it later/i)).toBeDefined()
  })

  // Moved from DeployPanel.test.tsx: the wrong-chain gate now lives here, with the button it
  // gates. The panel no longer knows anything about the wallet.
  it('shows the switch-network gate and no deploy button when connected on the wrong chain', async () => {
    state.account = { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 999 }
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /switch network/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /deploy this safe/i })).toBeNull()
  })

  // Moved from DeployPanel.test.tsx, plus the resume half of the pause contract: a deploy that
  // fails must hand mining back, or the user is left staring at a stopped miner.
  it('renders an error alert when the deploy attempt fails, and resumes mining', async () => {
    const onDeploySettled = vi.fn()
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={onDeploySettled}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /deploy this safe/i }))

    // A generous timeout: this waits on a dynamic import plus a rejected promise, and the
    // default 1000ms has been observed to flake under the CPU contention of a full monorepo
    // `pnpm -r test` run (many suites' worker pools competing for cores at once).
    // Queried by its text rather than by role because the phishing caveat above it is also an
    // Alert (role="alert"); the role is then asserted on the element that was found.
    const message = await screen.findByText(/Could not read Safe constants/, {}, { timeout: 5000 })
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(onDeploySettled).toHaveBeenCalledOnce()
  })
})
