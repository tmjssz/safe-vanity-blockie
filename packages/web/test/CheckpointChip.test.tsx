import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckpointChip } from '../components/CheckpointChip'

describe('CheckpointChip', () => {
  it('is a chip that says Checkpoint, and shows nothing until it is opened', () => {
    render(<CheckpointChip nextStart={60_000_016_650_000} />)
    expect(screen.getByRole('button', { name: /checkpoint/i })).toBeDefined()
    expect(screen.queryByText('60,000,016,650,000')).toBeNull()
  })

  it('opens on click, with the full saltNonce grouped for reading', async () => {
    const user = userEvent.setup()
    render(<CheckpointChip nextStart={60_000_016_650_000} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    expect(await screen.findByText('60,000,016,650,000')).toBeDefined()
  })

  it('says what the number is for and how it travels', async () => {
    const user = userEvent.setup()
    render(<CheckpointChip nextStart={60_000_016_650_000} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    expect(
      await screen.findByText(
        'The next saltNonce to try. Resume continues from here automatically; copy it to continue this search on another machine.',
      ),
    ).toBeDefined()
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
    render(<CheckpointChip nextStart={60_000_016_650_000} />)

    fireEvent.click(screen.getByRole('button', { name: /checkpoint/i }))
    fireEvent.click(await screen.findByRole('button', { name: /copy checkpoint/i }))

    expect(writeText).toHaveBeenCalledWith('60000016650000')
    vi.unstubAllGlobals()
  })

  // The chip is the only thing on screen that stays put while the popover is open, so it is
  // the only thing that can show which chip the panel belongs to.
  it('marks itself active while its popover is open', async () => {
    const user = userEvent.setup()
    render(<CheckpointChip nextStart={60_000_016_650_000} />)
    const chip = screen.getByRole('button', { name: /checkpoint/i })

    expect(chip.getAttribute('data-state')).toBe('closed')
    expect(chip.className).toMatch(/data-\[state=open\]:/)

    await user.click(chip)
    expect(chip.getAttribute('data-state')).toBe('open')
  })

  it('closes again on a second click', async () => {
    const user = userEvent.setup()
    render(<CheckpointChip nextStart={60_000_016_650_000} />)
    const chip = screen.getByRole('button', { name: /checkpoint/i })

    await user.click(chip)
    await screen.findByText('60,000,016,650,000')
    await user.click(chip)

    expect(screen.queryByText('60,000,016,650,000')).toBeNull()
  })

  // The reason this is a real PopoverTrigger rather than the hover-driven HintPopover used
  // elsewhere on this bar: a panel that opens on hover has no way to open on a touch device,
  // and this one holds the value a user on a phone would most want to send to a desktop.
  it('opens from a touch tap, not only from a mouse click', async () => {
    render(<CheckpointChip nextStart={60_000_016_650_000} />)
    const chip = screen.getByRole('button', { name: /checkpoint/i })

    fireEvent.pointerDown(chip, { pointerType: 'touch', button: 0, ctrlKey: false })
    fireEvent.pointerUp(chip, { pointerType: 'touch' })
    fireEvent.click(chip)

    expect(await screen.findByText('60,000,016,650,000')).toBeDefined()
  })
})
