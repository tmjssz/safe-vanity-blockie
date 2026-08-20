import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeployInProgressDialog } from '../components/DeployInProgressDialog'

const ADDRESS = '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5'

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof DeployInProgressDialog>> = {},
) {
  return render(
    <DeployInProgressDialog
      open
      address={ADDRESS}
      onOpenChange={vi.fn()}
      onView={vi.fn()}
      {...overrides}
    />,
  )
}

describe('DeployInProgressDialog', () => {
  // The whole reason it exists: activating another result did nothing at all, which reads as a
  // broken grid rather than as a rule.
  it('says a deploy is in progress and how to get out of it', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/deploy is already in progress/i)
    // Both routes, because there is no button anywhere that cancels a sent transaction.
    expect(dialog.textContent).toMatch(/finish/i)
    expect(dialog.textContent).toMatch(/reject it in your wallet/i)
  })

  // In full, and copyable, as the deploy dialog shows it: this names the Safe whose deploy is in
  // the way, and an abbreviation is not something a user can check against their wallet's pending
  // transaction.
  it('names the Safe that is being deployed, in full', () => {
    renderDialog()
    expect(screen.getByText(ADDRESS)).toBeDefined()
    expect(screen.queryByText('0x70e9…eed5')).toBeNull()
    // Queried on the document: Radix portals dialog content out of the render container.
    expect(document.querySelector('[data-slot="in-progress-identicon"]')).not.toBeNull()
  })

  it('offers the address to copy', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderDialog()

    // fireEvent, not userEvent: userEvent.setup() replaces navigator.clipboard with its own stub.
    fireEvent.click(screen.getByRole('button', { name: /copy safe address/i }))
    expect(writeText).toHaveBeenCalledWith(ADDRESS)
  })

  // The same "this one is being worked on" mark the header pill and the result tile carry, so all
  // three places a running deploy shows up say it the same way.
  it('turns a spinner over the identicon', () => {
    renderDialog()
    const identicon = document.querySelector('[data-slot="in-progress-identicon"]') as HTMLElement
    const stack = identicon.parentElement as HTMLElement
    expect(stack.className).toMatch(/relative/)
    expect(stack.querySelector('.animate-spin')).not.toBeNull()
  })

  it('offers the deploy it is talking about', async () => {
    const onView = vi.fn()
    renderDialog({ onView })
    await userEvent.click(screen.getByRole('button', { name: /view the deploy/i }))
    expect(onView).toHaveBeenCalledOnce()
  })

  it('closes without doing anything else', async () => {
    const onOpenChange = vi.fn()
    const onView = vi.fn()
    renderDialog({ onOpenChange, onView })

    // The same words the deploy dialog uses for the same act, because it is the same act: leaving
    // does not stop what the wallet is doing.
    await userEvent.click(screen.getByRole('button', { name: /^close and keep waiting$/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onView).not.toHaveBeenCalled()
  })

  it('is not on screen until it is asked for', () => {
    renderDialog({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
