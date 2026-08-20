import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

/**
 * The dialog's own description, which is the visible subtitle of whichever screen is showing.
 *
 * Queried through `aria-describedby` rather than by its text, because the dialog's sr-only live
 * region deliberately repeats the same words — that is how the outcome gets announced across a swap
 * that replaces every visible part of it — so a plain text query matches twice.
 */
// Any leftover header slot, gone whether or not the test that made it reached its last line: two
// elements with the same id means `getElementById` hands the dialog the stale one, and the next
// test reads an empty node forever.
afterEach(() => {
  for (const stale of document.querySelectorAll('#header-deploy-slot')) stale.remove()
})

const subtitle = () => {
  const id = screen.getByRole('dialog').getAttribute('aria-describedby') as string
  return document.getElementById(id)?.textContent ?? ''
}

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
  // The pending screen is what "after submission" means: the point the dialog stops asking and
  // starts reporting. The hash is on it, truncated — DeployOutcome's own tests cover the format.
  return screen.findByRole('heading', { name: /^deploying safe$/i }, { timeout: 5000 })
}

describe('DeployDialog after submission', () => {
  it('replaces the form with the pending screen', async () => {
    await deploy()

    // Nothing left to change, and nothing left to decide: all three of these were asking the user
    // for something that is now settled.
    expect(screen.queryByText(/^owner$/i)).toBeNull()
    expect(screen.queryByText(/^threshold$/i)).toBeNull()
    expect(screen.queryByText(/deploy later instead/i)).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByRole('heading', { name: /deploy this safe/i })).toBeNull()

    // The identity stays: this is which Safe the transaction is creating, and the only thing on
    // screen that answers "what did I just pay for?".
    expect(screen.getByText(ADDRESS)).toBeDefined()
  })

  it('offers the transaction to copy and to open on the chain explorer', async () => {
    await deploy()

    expect(screen.getByRole('button', { name: /copy transaction hash/i })).toBeDefined()
    const link = screen.getByRole('link', { name: /on etherscan/i })
    expect(link.getAttribute('href')).toBe(`https://sepolia.etherscan.io/tx/${HASH}`)
  })

  it('says the transaction is sent and names what it is waiting on', async () => {
    await deploy()
    expect(
      screen.getByText(/transaction sent\. waiting for confirmation on sepolia\./i),
    ).toBeDefined()
    // The one press left is the deliberate, warned way out; there is nothing to deploy twice.
    expect(screen.queryByRole('button', { name: /^deploy safe$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /close and keep waiting/i })).toBeDefined()
  })

  // "Morph in place": the confirmation must change the badge, the two lines and the footer WITHOUT
  // the screen being rebuilt around them. Asserted as DOM identity, because that is what "without
  // remounting" means — a rebuilt subtree hands back different nodes for the parts that did not
  // change, and anything a user was mid-way through (a selection, a just-pressed copy) goes with
  // them.
  it('morphs into the success screen without rebuilding it', async () => {
    await deploy()
    const addressBefore = screen.getByText(ADDRESS)
    const boxBefore = addressBefore.parentElement
    const copyBefore = screen.getByRole('button', { name: /copy safe address/i })

    state.receipt?.resolve({ status: 'success' })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^safe deployed$/i })).toBeDefined(),
    )

    expect(screen.getByText(ADDRESS)).toBe(addressBefore)
    expect(screen.getByText(ADDRESS).parentElement).toBe(boxBefore)
    expect(screen.getByRole('button', { name: /copy safe address/i })).toBe(copyBefore)
    // And the parts that DO change have: the same badge element, different contents.
    const badge = document.querySelector('[data-slot="outcome-badge"]') as HTMLElement
    expect(badge.querySelector('.lucide-check')).not.toBeNull()
    expect(badge.querySelector('.animate-spin')).toBeNull()
  })

  // "Do not close silently on submission": the dialog is the only place the outcome is reported
  // inline, so it has to still be here to report it — and by then it is a different screen. What
  // that screen contains is DeploySuccess's own tests; this is the switch into it.
  it('turns into the success screen once the Safe exists', async () => {
    await deploy()
    state.receipt?.resolve({ status: 'success' })

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^safe deployed$/i })).toBeDefined(),
    )
    expect(screen.getByText(/live on sepolia and ready to use/i)).toBeDefined()
    expect(screen.getByRole('link', { name: /open in safe wallet/i }).getAttribute('href')).toBe(
      `https://app.safe.global/home?safe=sep:${ADDRESS}`,
    )

    // Nothing of the screen that was asking is left: not the title it had, not the warning, not the
    // saltNonce, and not a button offering to deploy something that already exists.
    expect(screen.queryByRole('heading', { name: /deploy this safe/i })).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByText(/saltnonce/i)).toBeNull()
    // Closing is all that is left, and it no longer warns about abandoning anything. Scoped to the
    // footer, because the dialog's own X is also named "Close" and is back now that busy is false.
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(within(footer).getByRole('button', { name: /^close$/i })).toBeDefined()
    expect(within(footer).queryByRole('button', { name: /keep waiting/i })).toBeNull()
  })

  // The other half of the spinner bug: once the transaction is a fact, a failure has to stay in the
  // status view — there is a hash to keep — but it must stop claiming to be working on something.
  it('turns into the failure screen when the transaction fails after it was sent', async () => {
    await deploy()
    state.receipt?.resolve({ status: 'reverted' })

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^deployment failed$/i })).toBeDefined(),
    )
    // The reason, in the words the sequence used, and nothing still claiming to be working.
    expect(subtitle()).toMatch(/deployment reverted/i)
    expect(document.querySelector('.animate-spin')).toBeNull()
    // The transaction outlives the failure: it is the only way to look up what the gas bought.
    expect(screen.getByRole('link', { name: /view on etherscan/i })).toBeDefined()
  })

  // The commonest error of all, and the one the wallet answers instantly. It has to read as a
  // decision the user made rather than as a fault, and it must not suggest that a transaction may
  // be out there: viem rejects before broadcasting.
  it('reports a rejection in the wallet as nothing having been sent', async () => {
    const { sendTransaction } = await import('viem/actions')
    vi.mocked(sendTransaction).mockRejectedValueOnce(
      Object.assign(new Error('User rejected the request.'), {
        name: 'UserRejectedRequestError',
      }),
    )

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

    // Its own headline, because a rejection is a decision rather than a fault — and no transaction
    // line, because nothing was sent.
    expect(
      await screen.findByRole('heading', { name: /^transaction rejected$/i }, { timeout: 5000 }),
    ).toBeDefined()
    expect(subtitle()).toMatch(/nothing was sent/i)
    expect(subtitle()).not.toMatch(/may already have been broadcast/i)
    expect(screen.queryByRole('link', { name: /view on etherscan/i })).toBeNull()

    // And the way back to the form is offered rather than assumed: nothing was spent, so trying
    // again is the obvious next move, but it is the user's to make.
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByRole('button', { name: /^deploy safe$/i })).toBeDefined()
  })

  // "Close and keep waiting" is not a cancel — nothing can recall a transaction a wallet already
  // has — but until the pill existed it was a one-way door: the sequence carried on and the only
  // thing that could show it was gone.
  it('leaves a way back in the header once it is closed mid-flight', async () => {
    const { DeployDialog, DEPLOY_STATUS_SLOT_ID } = await import('../components/DeployDialog')
    const slot = document.createElement('div')
    slot.id = DEPLOY_STATUS_SLOT_ID
    document.body.append(slot)

    const onOpenChange = vi.fn()
    const props = {
      candidate,
      config,
      onOpenChange,
      onDeployStart: vi.fn(),
      onDeploySettled: vi.fn(),
    }
    const { rerender } = render(<DeployDialog open {...props} />)

    // Nothing yet: an untouched dialog has nothing outstanding to stand in for.
    expect(slot.textContent).toBe('')

    await userEvent.click(screen.getByRole('button', { name: /^deploy safe$/i }))
    // From the press, not from the close: a deploy is under way, and the header is where that has
    // to be visible however the user moves around the page next.
    await waitFor(() => expect(slot.textContent).toMatch(/deploying|confirming/i))
    await screen.findByRole('heading', { name: /^deploying safe$/i }, { timeout: 5000 })
    rerender(<DeployDialog open={false} {...props} />)

    expect(slot.textContent).toMatch(/confirming/i)
    await userEvent.click(within(slot).getByRole('button'))
    expect(onOpenChange).toHaveBeenCalledWith(true)

    // `open` is a prop here, so the ask has to be granted for the round trip to be observable —
    // page.tsx is what holds that state in production. What comes back is the same pending screen,
    // and the pill steps aside for it.
    rerender(<DeployDialog open {...props} />)
    expect(screen.getByRole('heading', { name: /^deploying safe$/i })).toBeDefined()
    expect(slot.textContent).toMatch(/confirming/i)
  })

  // Once it has settled with the dialog in front of the user, the dialog is saying it: a pill
  // beside it would be the same news twice.
  it('drops the header status when the deploy settles with the dialog open', async () => {
    const { DeployDialog, DEPLOY_STATUS_SLOT_ID } = await import('../components/DeployDialog')
    const slot = document.createElement('div')
    slot.id = DEPLOY_STATUS_SLOT_ID
    document.body.append(slot)

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
    await waitFor(() => expect(slot.textContent).toMatch(/confirming/i))

    state.receipt?.resolve({ status: 'success' })
    // By role: the sr-only live region carries the same words, so plain text matches twice.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^safe deployed$/i })).toBeDefined(),
    )

    expect(slot.textContent).toBe('')
  })

  // …but settling while it is closed is exactly when the pill has to stay: it is the only thing
  // that can bring the outcome back on screen.
  it('keeps the header status when the deploy settles while it is closed', async () => {
    const { DeployDialog, DEPLOY_STATUS_SLOT_ID } = await import('../components/DeployDialog')
    const slot = document.createElement('div')
    slot.id = DEPLOY_STATUS_SLOT_ID
    document.body.append(slot)

    const props = {
      candidate,
      config,
      onOpenChange: vi.fn(),
      onDeployStart: vi.fn(),
      onDeploySettled: vi.fn(),
    }
    const { rerender } = render(<DeployDialog open {...props} />)
    await userEvent.click(screen.getByRole('button', { name: /^deploy safe$/i }))
    await waitFor(() => expect(slot.textContent).toMatch(/confirming/i))

    rerender(<DeployDialog open={false} {...props} />)
    state.receipt?.resolve({ status: 'success' })

    await waitFor(() => expect(slot.textContent).toMatch(/deployed/i))
  })

  // What the page needs in order to decide whether closing this dialog may unmount it.
  it('reports each phase it moves through', async () => {
    const { DeployDialog } = await import('../components/DeployDialog')
    const onPhaseChange = vi.fn()
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
        onPhaseChange={onPhaseChange}
      />,
    )
    // On mount, so a page holding the last dialog's phase is corrected by the next one.
    expect(onPhaseChange).toHaveBeenCalledWith('idle')

    await userEvent.click(screen.getByRole('button', { name: /^deploy safe$/i }))
    await waitFor(() => expect(onPhaseChange).toHaveBeenCalledWith('pending'))

    state.receipt?.resolve({ status: 'success' })
    await waitFor(() => expect(onPhaseChange).toHaveBeenCalledWith('done'))
  })

  // An untouched dialog has nothing to stand in for, and a pill for it would be a control in the
  // header that reopens a form the user closed on purpose.
  it('leaves nothing in the header when it is closed without a deploy', async () => {
    const { DeployDialog, DEPLOY_STATUS_SLOT_ID } = await import('../components/DeployDialog')
    const slot = document.createElement('div')
    slot.id = DEPLOY_STATUS_SLOT_ID
    document.body.append(slot)

    render(
      <DeployDialog
        open={false}
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(slot.textContent).toBe('')
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
    // The SAME node, all the way through a swap that replaces every visible part of the dialog:
    // that is why the region lives on the dialog rather than on whichever screen is showing.
    await waitFor(() => expect(live?.textContent).toMatch(/waiting for confirmation/i))
    expect(document.querySelector('[aria-live="polite"]')).toBe(live)
  })
})
