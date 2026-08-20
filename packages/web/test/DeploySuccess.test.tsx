import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeploySuccess } from '../components/DeploySuccess'
import { Dialog, DialogContent } from '../components/ui/dialog'

const ADDRESS = '0x40fb0c68a29d8a12b3f32dd694ba2d1b7bbde9ee'
const HASH = '0x5d86000000000000000000000000000000000000000000000000000000004562'

/** Inside a Dialog, because the footer's Close is a DialogClose and needs that context. */
function renderSuccess(overrides: Partial<React.ComponentProps<typeof DeploySuccess>> = {}) {
  return render(
    <Dialog open>
      <DialogContent>
        <DeploySuccess address={ADDRESS} txHash={HASH} chainId={11155111} {...overrides} />
      </DialogContent>
    </Dialog>,
  )
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

describe('DeploySuccess', () => {
  // The dialog changes identity here: everything it was asking about is settled, so nothing that
  // was asking is left on screen.
  it('says what happened and where', () => {
    renderSuccess()
    expect(screen.getByRole('heading', { name: /^safe deployed$/i })).toBeDefined()
    expect(screen.getByText(/live on sepolia and ready to use/i)).toBeDefined()
  })

  it('names the chain it was deployed on, not a default', () => {
    renderSuccess({ chainId: 1 })
    expect(screen.getByText(/live on ethereum and ready to use/i)).toBeDefined()
  })

  // The primary artifact of the screen: the address is what the user takes away, so it is whole,
  // on one line, and copyable.
  it('shows the Safe address in full, with a copy', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderSuccess()

    const shown = screen.getByText(ADDRESS)
    expect(shown.className).toMatch(/font-mono/)
    // fireEvent, not userEvent: userEvent.setup() replaces navigator.clipboard with its own stub.
    fireEvent.click(screen.getByRole('button', { name: /copy safe address/i }))
    expect(writeText).toHaveBeenCalledWith(ADDRESS)
  })

  // The identicon is the reason this Safe exists, so it is bigger here than on the screen that was
  // verifying it, and it carries the mark that says the deploy landed.
  it('draws the blockie with a check pinned to it', () => {
    renderSuccess()
    const blockie = screen.getByRole('img', { name: /identicon/i })
    expect(blockie.className).toMatch(/size-22|size-\[88px\]/)
    const stack = blockie.parentElement as HTMLElement
    expect(stack.querySelector('.lucide-check')).not.toBeNull()
  })

  // One caption line, not the pending state's full-width hash: by now the transaction is a receipt
  // rather than the thing being watched.
  it('reduces the transaction to one line, truncated, with a copy and an explorer link', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderSuccess()

    expect(screen.getByText('0x5d86…4562')).toBeDefined()
    expect(screen.queryByText(HASH)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /copy transaction hash/i }))
    expect(writeText).toHaveBeenCalledWith(HASH)

    const link = screen.getByRole('link', { name: /view on etherscan/i })
    expect(link.getAttribute('href')).toBe(`https://sepolia.etherscan.io/tx/${HASH}`)
    expect(link.getAttribute('target')).toBe('_blank')
  })

  // Where the user actually goes next. The prefix is what tells Safe which chain, so an address
  // without it opens the wrong network's Safe or nothing at all.
  it('offers to open the Safe in Safe Wallet, on the chain it is on', () => {
    renderSuccess()
    const link = screen.getByRole('link', { name: /open in safe wallet/i })
    expect(link.getAttribute('href')).toBe(`https://app.safe.global/home?safe=sep:${ADDRESS}`)
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('offers a way out that does not pretend to cancel anything', () => {
    renderSuccess()
    // Scoped to the footer: the dialog's own X is named "Close" too.
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(within(footer).getByRole('button', { name: /^close$/i })).toBeDefined()
    // Nothing to keep waiting for, and nothing to cancel.
    expect(screen.queryByRole('button', { name: /keep waiting/i })).toBeNull()
  })

  // Everything the confirm state was asking about is settled: leaving any of it on screen would be
  // asking a question that has been answered.
  it('leaves nothing of the state that was asking', () => {
    renderSuccess()
    expect(screen.queryByText(/cosmetic/i)).toBeNull()
    expect(screen.queryByText(/deploy later instead/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^deploy safe$/i })).toBeNull()
    expect(screen.queryByText(/^owners?$/i)).toBeNull()
    expect(screen.queryByText(/saltnonce/i)).toBeNull()
  })
})
