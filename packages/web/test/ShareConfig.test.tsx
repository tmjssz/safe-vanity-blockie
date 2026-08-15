import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareConfig } from '../components/ShareConfig'

// fireEvent, not userEvent: userEvent.setup() unconditionally replaces navigator.clipboard with
// its own stub (@testing-library/user-event's Clipboard.attachClipboardStubToView), clobbering
// whatever this file defines below on every call — including a deliberate `undefined`. A plain
// click event exercises the same onClick handler without that interference.

const { toastErrorSpy, toastSuccessSpy } = vi.hoisted(() => ({
  toastErrorSpy: vi.fn(),
  toastSuccessSpy: vi.fn(),
}))

// Mocked the same way as MiningView.test.tsx, so the two files stay consistent: a toast is
// additive feedback on top of the inline alert, never a replacement for it, and both call sites
// are checked the same way.
vi.mock('sonner', () => ({
  toast: { error: toastErrorSpy, success: toastSuccessSpy },
}))

const config = {
  owners: ['0x' + '11'.repeat(20)],
  threshold: 1,
  safeVersion: '1.4.1',
  chainId: 1,
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

beforeEach(() => {
  toastErrorSpy.mockClear()
  toastSuccessSpy.mockClear()
})

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

describe('ShareConfig', () => {
  it('always renders the link in a read-only, selectable input, so a failed copy is never the only path', () => {
    render(<ShareConfig config={config} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.readOnly).toBe(true)
    expect(input.value).toContain('/?config=')
  })

  it('copies the link and flips the button label on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<ShareConfig config={config} />)
    fireEvent.click(screen.getByRole('button', { name: /copy share link/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    // Additive to (not a replacement for) the button-label flip above.
    expect(toastSuccessSpy).toHaveBeenCalledTimes(1)
  })

  it('surfaces an actionable message instead of throwing when navigator.clipboard is undefined', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    render(<ShareConfig config={config} />)
    // Must not throw inside the click handler.
    fireEvent.click(screen.getByRole('button', { name: /copy share link/i }))

    // Both must happen: the toast is timed and fades, so the inline alert (still asserted below)
    // remains the durable, actionable record of the failure.
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.queryByRole('button', { name: /^copied$/i })).toBeNull()
    expect(toastErrorSpy).toHaveBeenCalledTimes(1)
  })

  it('surfaces an actionable message when the clipboard promise rejects (e.g. denied permission)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<ShareConfig config={config} />)
    fireEvent.click(screen.getByRole('button', { name: /copy share link/i }))

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.queryByRole('button', { name: /^copied$/i })).toBeNull()
  })

  it('keeps the URL selectable even when the clipboard is unavailable', async () => {
    const original = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    render(<ShareConfig config={config} />)
    const field = screen.getByRole('textbox', { name: /share link/i })
    expect((field as HTMLInputElement).readOnly).toBe(true)
    expect((field as HTMLInputElement).value).toContain('?config=')

    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(await screen.findByText(/could not copy/i)).toBeDefined()

    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true })
  })
})
