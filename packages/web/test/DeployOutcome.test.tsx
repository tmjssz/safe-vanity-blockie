import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeployOutcome } from '../components/DeployOutcome'
import { Dialog, DialogContent } from '../components/ui/dialog'

const ADDRESS = '0x40fb0c68a29d8a12b3f32dd694ba2d1b7bbde9ee'
const HASH = '0x5d86000000000000000000000000000000000000000000000000000000004562'

/** Inside a Dialog, because the footer's Close is a DialogClose and needs that context. */
function renderOutcome(overrides: Partial<React.ComponentProps<typeof DeployOutcome>> = {}) {
  return render(
    <Dialog open>
      <DialogContent>
        <DeployOutcome
          variant="success"
          address={ADDRESS}
          txHash={HASH}
          chainId={11155111}
          {...overrides}
        />
      </DialogContent>
    </Dialog>,
  )
}

const footer = () => document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
const badge = () => document.querySelector('[data-slot="outcome-badge"]') as HTMLElement

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

describe('DeployOutcome', () => {
  // The three states a deploy can be in once it has left the user's hands are the same screen with
  // a different badge, headline and set of actions. Anything else and a confirmation that turns
  // into a success looks like a different dialog opening.
  describe('what stays the same in every variant', () => {
    it.each(['pending', 'success', 'failed'] as const)('shows the address in %s', (variant) => {
      renderOutcome({ variant, reason: 'Deployment reverted.' })
      const shown = screen.getByText(ADDRESS)
      expect(shown.className).toMatch(/font-mono/)
      expect(screen.getByRole('button', { name: /copy safe address/i })).toBeDefined()
    })

    it.each(['pending', 'success'] as const)('shows the transaction in %s', (variant) => {
      renderOutcome({ variant })
      expect(screen.getByText('0x5d86…4562')).toBeDefined()
      expect(screen.getByRole('button', { name: /copy transaction hash/i })).toBeDefined()
      expect(screen.getByRole('link', { name: /view on etherscan/i }).getAttribute('href')).toBe(
        `https://sepolia.etherscan.io/tx/${HASH}`,
      )
    })

    it.each(['pending', 'success', 'failed'] as const)(
      'draws one corner badge in %s',
      (variant) => {
        renderOutcome({ variant })
        const blockie = screen.getByRole('img', { name: /identicon/i })
        expect(blockie.className).toMatch(/size-22/)
        // Pinned to the picture rather than floating beside it, in every state.
        expect((blockie.parentElement as HTMLElement).contains(badge())).toBe(true)
      },
    )

    // Monospace and sans on one line have different cap heights, so centring the boxes leaves the
    // hash a hair above the words either side of it; and the 24px copy button, as an ordinary flex
    // item, grew the 16px line to its own height and then centred itself against THAT, six pixels
    // below the text. Both measured in a browser.
    it('sits the transaction line on one baseline, copy button included', () => {
      renderOutcome()
      const line = screen.getByText('Transaction').parentElement as HTMLElement
      expect(line.className).toMatch(/items-baseline/)
      expect(line.className).toMatch(/sm:flex-nowrap/)
      const copy = screen.getByRole('button', { name: /copy transaction hash/i }).className
      expect(copy).toMatch(/self-center/)
      expect(copy).toMatch(/-my-1/)
    })
  })

  describe('pending', () => {
    it('says the transaction is sent and what it is waiting for', () => {
      renderOutcome({ variant: 'pending' })
      expect(screen.getByRole('heading', { name: /^deploying safe$/i })).toBeDefined()
      expect(
        screen.getByText(/transaction sent\. waiting for confirmation on sepolia\./i),
      ).toBeDefined()
    })

    it('turns a spinner in the badge rather than a verdict', () => {
      renderOutcome({ variant: 'pending' })
      expect(badge().querySelector('.animate-spin')).not.toBeNull()
      expect(badge().querySelector('.lucide-check')).toBeNull()
    })

    // Nothing to do but wait, and nothing here can recall the transaction, so the one control says
    // exactly that.
    it('offers only a way out that does not claim to cancel', () => {
      renderOutcome({ variant: 'pending' })
      expect(
        within(footer()).getByRole('button', { name: /^close and keep waiting$/i }),
      ).toBeDefined()
      expect(within(footer()).queryByRole('link')).toBeNull()
      expect(within(footer()).getAllByRole('button')).toHaveLength(1)
    })
  })

  describe('success', () => {
    it('says what happened and where', () => {
      renderOutcome()
      expect(screen.getByRole('heading', { name: /^safe deployed$/i })).toBeDefined()
      expect(screen.getByText(/live on sepolia and ready to use/i)).toBeDefined()
      expect(badge().querySelector('.lucide-check')).not.toBeNull()
    })

    it('names the chain it was deployed on, not a default', () => {
      renderOutcome({ chainId: 1 })
      expect(screen.getByText(/live on ethereum and ready to use/i)).toBeDefined()
    })

    // Where the user actually goes next. The prefix is what tells Safe which chain, so an address
    // without it opens the wrong network's Safe or nothing at all.
    it('offers to open the Safe in Safe Wallet, on the chain it is on', () => {
      renderOutcome()
      const link = within(footer()).getByRole('link', { name: /open in safe wallet/i })
      expect(link.getAttribute('href')).toBe(`https://app.safe.global/home?safe=sep:${ADDRESS}`)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(within(footer()).getByRole('button', { name: /^close$/i })).toBeDefined()
    })
  })

  describe('failed', () => {
    it('names the failure and carries the reason as its subtitle', () => {
      renderOutcome({ variant: 'failed', reason: 'Deployment reverted. Gas was spent.' })
      expect(screen.getByRole('heading', { name: /^deployment failed$/i })).toBeDefined()
      expect(screen.getByText(/deployment reverted\. gas was spent\./i)).toBeDefined()
      expect(badge().querySelector('.lucide-x')).not.toBeNull()
    })

    // A rejection is a decision the user made, not a fault, and saying "failed" over it reads as
    // the app having gone wrong.
    it('calls a wallet rejection what it is', () => {
      renderOutcome({
        variant: 'failed',
        rejected: true,
        txHash: undefined,
        reason: 'You rejected the request in your wallet. Nothing was sent.',
      })
      expect(screen.getByRole('heading', { name: /^transaction rejected$/i })).toBeDefined()
    })

    // Nothing was sent, so there is no transaction to show: a line reading "Transaction" with
    // nothing after it would be worse than no line.
    it('drops the transaction line when there is no transaction', () => {
      renderOutcome({ variant: 'failed', rejected: true, txHash: undefined, reason: 'Rejected.' })
      expect(screen.queryByText(/^transaction$/i)).toBeNull()
      expect(screen.queryByRole('link', { name: /view on etherscan/i })).toBeNull()
    })

    it('keeps the transaction line when one was sent', () => {
      renderOutcome({ variant: 'failed', reason: 'Deployment reverted.' })
      expect(screen.getByText('0x5d86…4562')).toBeDefined()
    })

    it('offers to try again, and reports it', async () => {
      const onRetry = vi.fn()
      renderOutcome({ variant: 'failed', reason: 'Rejected.', onRetry })

      fireEvent.click(within(footer()).getByRole('button', { name: /try again/i }))
      expect(onRetry).toHaveBeenCalledOnce()
      expect(within(footer()).getByRole('button', { name: /^close$/i })).toBeDefined()
    })

    it('offers no retry when the caller has nothing to retry with', () => {
      renderOutcome({ variant: 'failed', reason: 'Rejected.' })
      expect(within(footer()).queryByRole('button', { name: /try again/i })).toBeNull()
    })
  })

  // Everything the confirm state was asking about is settled the moment this screen appears.
  it('leaves nothing of the state that was asking', () => {
    renderOutcome()
    expect(screen.queryByText(/cosmetic/i)).toBeNull()
    expect(screen.queryByText(/deploy later instead/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^deploy safe$/i })).toBeNull()
    expect(screen.queryByText(/^owners?$/i)).toBeNull()
    expect(screen.queryByText(/saltnonce/i)).toBeNull()
  })
})
