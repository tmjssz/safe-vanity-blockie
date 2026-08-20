import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnerList } from '../components/OwnerList'

const owner = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(20)}`
const owners = (count: number) => Array.from({ length: count }, (_, index) => owner(index + 1))

const rows = () => screen.getAllByTestId('owner-row')
const expander = () => screen.queryByRole('button', { name: /show all/i })

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

describe('OwnerList', () => {
  // The owner set is what determines control of the Safe, so this is the one block on the screen
  // that may not abbreviate: "1 owner" or a truncated address is nothing a reader can check.
  it('lists every owner in full', () => {
    render(<OwnerList owners={owners(3)} />)
    expect(rows()).toHaveLength(3)
    for (const address of owners(3)) expect(screen.getByText(address)).toBeDefined()
  })

  // A reader who recognises their own blockie has a check that reading 42 hex characters does not
  // give them. Decorative, because the address is right there beside it.
  it('draws each owner beside the identicon its address produces', () => {
    const { container } = render(<OwnerList owners={owners(2)} />)
    const identicons = container.querySelectorAll('[data-slot="owner-identicon"]')
    expect(identicons).toHaveLength(2)
    expect(identicons[0].getAttribute('aria-hidden')).toBe('true')
  })

  it('offers a copy per owner, named by the owner it copies', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<OwnerList owners={owners(2)} />)

    // fireEvent, not userEvent: userEvent.setup() replaces navigator.clipboard with its own stub.
    fireEvent.click(screen.getByRole('button', { name: `Copy owner ${owner(2)}` }))

    expect(writeText).toHaveBeenCalledWith(owner(2))
  })

  it('shows every owner outright while there are few enough of them', () => {
    render(<OwnerList owners={owners(5)} />)
    expect(rows()).toHaveLength(5)
    expect(expander()).toBeNull()
  })

  // A Safe can have dozens of owners, and this card sits in a dialog that must not scroll: growing
  // a row per owner pushes the deploy button off the screen.
  it('holds a long list back behind an expander that says how many there are', () => {
    render(<OwnerList owners={owners(9)} />)
    expect(rows()).toHaveLength(5)
    expect(expander()?.textContent).toBe('Show all 9 owners')
  })

  it('reveals the rest when asked, and takes them back', async () => {
    const user = userEvent.setup()
    render(<OwnerList owners={owners(9)} />)

    await user.click(expander() as HTMLElement)
    expect(rows()).toHaveLength(9)

    // Expanding is reversible: nine rows is exactly the state the collapse exists to undo, and a
    // one-way control leaves the dialog taller than it started with no way back.
    await user.click(screen.getByRole('button', { name: /show fewer/i }))
    expect(rows()).toHaveLength(5)
  })
})
