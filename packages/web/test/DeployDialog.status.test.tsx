import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The deploy sequence's happy path, which DeployDialog.test.tsx deliberately cannot reach: that
 * file's mocks reject the constants read so nothing it drives ever spends anything. Here every
 * step resolves, so the dialog's states *after* submission are observable — the pending view, the
 * transaction reference, and the success view with somewhere to go and see the Safe.
 *
 * Mocks are per-file (vi.mock is hoisted), which is why this is a file of its own rather than a
 * describe block over there.
 */

const HASH = '0xabc0000000000000000000000000000000000000000000000000000000000def'
const ADDRESS = '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5'

const state = vi.hoisted(() => ({
  account: { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 11155111 },
  /** Settled by the test, so the pending view can be inspected before the receipt arrives. */
  receipt: undefined as undefined | { resolve: (value: unknown) => void },
}))

vi.mock('wagmi', () => ({
  useAccount: () => state.account,
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useConnect: () => ({ connect: vi.fn(), connectors: [{ uid: 'mm', name: 'MetaMask' }] }),
  useConnectorClient: () => ({ data: { transport: {} } }),
  createConfig: vi.fn(() => ({})),
  http: vi.fn(() => ({})),
}))

vi.mock('@safe-vanity-blockie/safe-config', () => ({
  loadSafeConstants: vi.fn().mockResolvedValue({}),
  ZKSYNC_CHAIN_IDS: new Set(),
}))

vi.mock('../lib/deploy', () => ({
  buildDeploymentPlan: vi.fn().mockResolvedValue({
    // Matches the candidate below: a mismatch is a refusal to deploy, tested elsewhere.
    address: ADDRESS,
    transaction: { to: '0x' + '22'.repeat(20), value: '0', data: '0x' },
  }),
}))

vi.mock('viem/actions', () => ({ sendTransaction: vi.fn().mockResolvedValue(HASH) }))

vi.mock('viem', () => ({
  http: vi.fn(() => ({})),
  createPublicClient: () => ({
    waitForTransactionReceipt: () =>
      new Promise((resolve) => {
        state.receipt = { resolve }
      }),
  }),
}))

vi.mock('@safe-global/protocol-kit', () => ({
  getSafeAddressFromDeploymentTx: () => ADDRESS,
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const candidate = {
  saltNonce: '1885506',
  address: ADDRESS,
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
  // Sepolia, so the explorer links below are Sepolia's own and not a default that would pass
  // whatever chain the dialog happened to read.
  chainId: 11155111,
}

beforeEach(() => {
  state.receipt = undefined
})

async function deploy() {
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
  await userEvent.click(screen.getByRole('button', { name: /^deploy safe$/i }))
  // The transaction reference is what "after submission" means, and the point the dialog turns
  // into a report rather than a request.
  return screen.findByText(HASH, {}, { timeout: 5000 })
}

describe('DeployDialog after submission', () => {
  it('replaces the config and the deploy-later offer with the transaction', async () => {
    await deploy()

    // Nothing left to change, and nothing left to decide: all three of these were asking the user
    // for something that is now settled.
    expect(screen.queryByText(/^owner$/i)).toBeNull()
    expect(screen.queryByText(/^threshold$/i)).toBeNull()
    expect(screen.queryByText(/deploy later instead/i)).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()

    // The identity stays: this is which Safe the transaction is creating, and the only thing on
    // screen that answers "what did I just pay for?".
    expect(screen.getByText(ADDRESS)).toBeDefined()
    expect(screen.getByText('90.2%')).toBeDefined()
  })

  it('offers the transaction to copy and to open on the chain explorer', async () => {
    await deploy()

    expect(screen.getByRole('button', { name: /copy transaction hash/i })).toBeDefined()
    const link = screen.getByRole('link', { name: /on etherscan/i })
    expect(link.getAttribute('href')).toBe(`https://sepolia.etherscan.io/tx/${HASH}`)
  })

  it('says it is waiting on the chain, not on the wallet', async () => {
    await deploy()
    expect(screen.getByText(/waiting for confirmation on the chain/i)).toBeDefined()
    // The one press left is the deliberate, warned way out; there is nothing to deploy twice.
    expect(screen.queryByRole('button', { name: /^deploy safe$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /close and keep waiting/i })).toBeDefined()
  })

  // "Do not close silently on submission": the dialog is the only place the outcome is reported
  // inline, so it has to still be here to report it.
  it('reports the deployed Safe, with somewhere to go and see it', async () => {
    await deploy()
    state.receipt?.resolve({ status: 'success' })

    await waitFor(() => expect(screen.getByText(/safe deployed/i)).toBeDefined())
    const link = screen.getByRole('link', { name: /view the safe on etherscan/i })
    expect(link.getAttribute('href')).toBe(`https://sepolia.etherscan.io/address/${ADDRESS}`)
    // Closing is all that is left, and it no longer warns about abandoning anything. Scoped to the
    // footer, because the dialog's own X is also named "Close" and is back now that busy is false.
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(within(footer).getByRole('button', { name: /^close$/i })).toBeDefined()
    expect(within(footer).queryByRole('button', { name: /keep waiting/i })).toBeNull()
  })

  // The status is where "confirm in your wallet", the transaction and "Safe deployed" all arrive,
  // and a live region only announces changes to a container that was already mounted.
  it('announces each step through a region that was there before the first message', async () => {
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

    const live = document.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live?.textContent).toBe('')

    fireEvent.click(screen.getByRole('button', { name: /^deploy safe$/i }))
    await waitFor(() => expect(live?.textContent).toMatch(/\S/))
    // The same node throughout: a remounted region announces nothing at all.
    expect(document.querySelector('[aria-live="polite"]')).toBe(live)
  })
})
