import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckpointTrigger } from '../components/CheckpointTrigger'

/** The open panel, as the element that holds both the number and the prose about it. */
async function findPanel(): Promise<HTMLElement> {
  const value = await screen.findByText('60,000,016,650,000')
  return value.closest('[data-slot="popover-content"]') as HTMLElement
}

describe('CheckpointTrigger', () => {
  it('is a chip that says Checkpoint, and shows nothing until it is opened', () => {
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)
    expect(screen.getByRole('button', { name: /checkpoint/i })).toBeDefined()
    expect(screen.queryByText('60,000,016,650,000')).toBeNull()
  })

  it('opens on click, with the full saltNonce grouped for reading', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    expect(await screen.findByText('60,000,016,650,000')).toBeDefined()
  })

  // The chip sits at the right edge of the bar, so a panel aligned any other way would hang off
  // the side of the page.
  it('aligns the panel to the right edge of the chip', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    const content = await screen.findByText('60,000,016,650,000')
    expect(content.closest('[data-slot="popover-content"]')?.getAttribute('data-align')).toBe('end')
  })

  it('says what the number is for', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    expect(
      await screen.findByText(
        'The next saltNonce to try. Resume continues from here automatically.',
      ),
    ).toBeDefined()
  })

  // The checkpoint is only half of a resume. `CliHandoff` emits `--workers` and `--start`
  // together for exactly this reason: each worker keeps to a block of its own, so whatever its
  // neighbours had not reached is skipped, and a pool of a different size skips a different
  // slice. A panel that hands over the bare number and invites pasting it elsewhere is a panel
  // that loses keyspace silently.
  it('names the pool the checkpoint belongs to, and what a different one costs', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))
    const panel = await findPanel()

    expect(panel.textContent).toContain('--workers 5')
    expect(panel.textContent).toMatch(/different worker count skips a different slice/i)
  })

  // Grouped on screen, ungrouped on the clipboard: the separators are for the eye, and this
  // value's destination is the CLI's `--start`, which parses with Number and would read
  // "60,000,016,650,000" as 60.
  //
  // fireEvent, not userEvent: userEvent.setup() unconditionally replaces navigator.clipboard
  // with its own stub, clobbering the writeText spy stubbed in here.
  it('copies the bare digits', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)

    fireEvent.click(screen.getByRole('button', { name: /checkpoint/i }))
    fireEvent.click(await screen.findByRole('button', { name: /copy checkpoint/i }))

    expect(writeText).toHaveBeenCalledWith('60000016650000')
    vi.unstubAllGlobals()
  })

  // The chip is the only thing on screen that stays put while the popover is open, so it is
  // the only thing that can show which chip the panel belongs to.
  it('marks itself active while its popover is open', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)
    const chip = screen.getByRole('button', { name: /checkpoint/i })

    expect(chip.getAttribute('data-state')).toBe('closed')
    expect(chip.className).toMatch(/data-\[state=open\]:/)

    await user.click(chip)
    expect(chip.getAttribute('data-state')).toBe('open')
  })

  it('closes again on a second click', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)
    const chip = screen.getByRole('button', { name: /checkpoint/i })

    await user.click(chip)
    await screen.findByText('60,000,016,650,000')
    await user.click(chip)

    expect(screen.queryByText('60,000,016,650,000')).toBeNull()
  })

  // The reason this is a real PopoverTrigger rather than the hover-driven HintPopover used
  // elsewhere on this bar: HintPopover cancels its own open-autofocus, since nothing inside a
  // hint is focusable — and this panel holds a copy button, which that would strand outside
  // the keyboard's reach. Pinned here as "focus lands inside the panel".
  it('moves focus into the panel, putting the copy button in reach of a keyboard', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))
    const panel = await findPanel()

    expect(panel.contains(document.activeElement)).toBe(true)
  })

  // Opening is a click, not a hover: the chip is reached by tap as often as by pointer, and a
  // hover-opened panel would leave a touch device with a chip that flickers open and shut. The
  // tap itself arrives at the trigger as an ordinary DOM click, which the test above already
  // covers, and jsdom does not synthesise one from a pointer pair.
  it('opens from a click rather than from hover, which is what makes a tap work', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger nextStart={60_000_016_650_000} workers={5} />)
    const chip = screen.getByRole('button', { name: /checkpoint/i })

    await user.hover(chip)
    chip.focus()
    expect(screen.queryByText('60,000,016,650,000')).toBeNull()

    await user.click(chip)
    expect(await screen.findByText('60,000,016,650,000')).toBeDefined()
  })
})
