import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyButton } from '../components/CopyButton'

// fireEvent, not userEvent, for the same reason ShareConfig's tests give: userEvent.setup()
// unconditionally replaces navigator.clipboard with its own stub, clobbering whatever this file
// defines below — including a deliberate `undefined`.

const { toastErrorSpy, toastSuccessSpy } = vi.hoisted(() => ({
  toastErrorSpy: vi.fn(),
  toastSuccessSpy: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: toastErrorSpy, success: toastSuccessSpy },
}))

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

beforeEach(() => {
  toastErrorSpy.mockClear()
  toastSuccessSpy.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

describe('CopyButton', () => {
  it('names what it copies, since the icon alone names nothing', () => {
    render(<CopyButton value="0xabc" label="Copy address" copiedMessage="Address copied" />)
    const button = screen.getByRole('button', { name: 'Copy address' })
    // Sighted pointer users get the same words on hover; the icon is the only visible content.
    expect(button.getAttribute('title')).toBe('Copy address')
  })

  it('puts the value on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard(writeText)

    render(<CopyButton value="0xabc" label="Copy address" copiedMessage="Address copied" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))

    expect(writeText).toHaveBeenCalledWith('0xabc')
    // The toast is the only confirmation a one-icon control can give.
    await vi.waitFor(() => expect(toastSuccessSpy).toHaveBeenCalledWith('Address copied'))
  })

  it('confirms the copy on the button itself, not only in a toast that times out', async () => {
    stubClipboard(vi.fn(() => Promise.resolve()))

    const { container } = render(
      <CopyButton value="0xabc" label="Copy address" copiedMessage="Address copied" />,
    )
    expect(container.querySelector('.lucide-check')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))

    await vi.waitFor(() => expect(container.querySelector('.lucide-check')).not.toBeNull())
  })

  // Plain http:// on a LAN IP is a normal way to try this app, and there `navigator.clipboard` is
  // undefined: reading `.writeText` off it throws synchronously inside the handler.
  it('reports a clipboard that is not there instead of throwing', () => {
    Reflect.deleteProperty(navigator, 'clipboard')

    render(<CopyButton value="0xabc" label="Copy address" copiedMessage="Address copied" />)
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Copy address' })),
    ).not.toThrow()

    expect(toastErrorSpy).toHaveBeenCalled()
    expect(toastSuccessSpy).not.toHaveBeenCalled()
  })

  it('reports a rejected write', async () => {
    stubClipboard(vi.fn(() => Promise.reject(new Error('denied'))))

    render(<CopyButton value="0xabc" label="Copy address" copiedMessage="Address copied" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))

    await vi.waitFor(() => expect(toastErrorSpy).toHaveBeenCalled())
    expect(toastSuccessSpy).not.toHaveBeenCalled()
  })

  // A tick that stays forever stops being a confirmation and becomes the button's new resting
  // state: nothing on screen then distinguishes "just copied" from "copied ten minutes ago", and a
  // second copy of the same value gives no feedback at all, because the button already looks done.
  it('returns to the copy icon a moment after confirming', async () => {
    vi.useFakeTimers()
    stubClipboard(vi.fn(() => Promise.resolve()))

    const { container } = render(
      <CopyButton value="0xabc" label="Copy address" copiedMessage="Address copied" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))

    // Flush the clipboard promise without moving the clock: the tick is up straight away.
    await act(async () => {})
    expect(container.querySelector('.lucide-check')).not.toBeNull()

    await act(() => vi.advanceTimersByTimeAsync(1500))
    expect(container.querySelector('.lucide-check')).toBeNull()
    expect(container.querySelector('.lucide-copy')).not.toBeNull()
  })

  // The reset is a pending timer, and this component unmounts by the hundred: every tile in the
  // grid holds one, and the grid is thrown away on "Start over".
  it('does not reset a button that has already unmounted', async () => {
    vi.useFakeTimers()
    stubClipboard(vi.fn(() => Promise.resolve()))

    const { unmount } = render(
      <CopyButton value="0xabc" label="Copy address" copiedMessage="Address copied" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    await act(async () => {})
    unmount()

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  // One success latching the tick forever would leave a confirmed-looking button beside a
  // "could not copy" toast saying the opposite.
  it('drops the confirmation when a later copy fails', async () => {
    let succeed = true
    stubClipboard(vi.fn(() => (succeed ? Promise.resolve() : Promise.reject(new Error('denied')))))

    const { container } = render(
      <CopyButton value="0xabc" label="Copy address" copiedMessage="Address copied" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    await vi.waitFor(() => expect(container.querySelector('.lucide-check')).not.toBeNull())

    succeed = false
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))

    await vi.waitFor(() => expect(toastErrorSpy).toHaveBeenCalled())
    expect(container.querySelector('.lucide-check')).toBeNull()
  })
})
