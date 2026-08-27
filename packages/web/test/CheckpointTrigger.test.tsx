import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckpointTrigger } from '../components/CheckpointTrigger'
import { DEFAULT_FACE_FILTERS } from '../lib/config'
import { decodeConfigParam, decodeResumeParams } from '../lib/deep-link'

/** The open panel, as the element that holds both the number and the prose about it. */
async function findPanel(): Promise<HTMLElement> {
  const value = await screen.findByText('60,000,016,650,000')
  return value.closest('[data-slot="popover-content"]') as HTMLElement
}

const CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1' as const,
  chainId: 1,
}

/**
 * Every test in this file drives the same checkpoint on the same run; only the handler varies.
 * Spread rather than repeated, so the next required prop is one edit rather than fourteen.
 */
const PROPS = {
  nextStart: 60_000_016_650_000,
  workers: 5,
  config: CONFIG,
  target: 'smile,open',
  filters: DEFAULT_FACE_FILTERS,
  onShowCommand: vi.fn(),
}

describe('CheckpointTrigger', () => {
  it('says Checkpoint, and shows nothing until it is opened', () => {
    render(<CheckpointTrigger {...PROPS} />)
    expect(screen.getByRole('button', { name: /checkpoint/i })).toBeDefined()
    expect(screen.queryByText('60,000,016,650,000')).toBeNull()
  })

  it('opens on click, with the full saltNonce grouped for reading', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    expect(await screen.findByText('60,000,016,650,000')).toBeDefined()
  })

  // The trigger is pinned to the right edge of the summary line, so it has the whole width of
  // the page to its left and none of it to its right. A 320px panel aligned to its left edge
  // would hang off the side.
  it('aligns the panel to the end of the trigger', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    const content = await screen.findByText('60,000,016,650,000')
    expect(content.closest('[data-slot="popover-content"]')?.getAttribute('data-align')).toBe('end')
  })

  it('says what the number is for', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)

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
    render(<CheckpointTrigger {...PROPS} />)

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
    render(<CheckpointTrigger {...PROPS} />)

    fireEvent.click(screen.getByRole('button', { name: /checkpoint/i }))
    fireEvent.click(await screen.findByRole('button', { name: /copy checkpoint/i }))

    expect(writeText).toHaveBeenCalledWith('60000016650000')
    vi.unstubAllGlobals()
  })

  // It sits among the run's metadata, in the same size and rhythm as "Safe 1.4.1" beside it, so
  // it cannot be drawn as a control: a bordered chip in a line of plain text reads as the one
  // thing on the row you are meant to press, which is what the Resume button a line above is.
  // The dotted underline is the whole affordance, and it has to survive a restyle.
  it('reads as one more item of metadata, not as a control', () => {
    render(<CheckpointTrigger {...PROPS} />)
    const trigger = screen.getByRole('button', { name: /checkpoint/i })

    expect(trigger.className).not.toMatch(/(^|\s|:)border/)
    expect(trigger.className).not.toMatch(/(^|\s|:)bg-/)
    expect(trigger.className).toMatch(/decoration-dotted/)
  })

  // The panel already names the handoff as the thing that writes out both halves of a resume.
  // Naming it and leaving the reader to go and find it, on a page whose whole first screen is
  // now a results grid, is the sentence doing half its job.
  it('opens the handoff dialog from the sentence that names it', async () => {
    const user = userEvent.setup()
    const onShowCommand = vi.fn()
    render(<CheckpointTrigger {...PROPS} onShowCommand={onShowCommand} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))
    await user.click(await screen.findByRole('button', { name: /run on your machine/i }))

    expect(onShowCommand).toHaveBeenCalledOnce()
  })

  // The dialog it opens covers this panel, and a panel still open behind it is one the reader
  // has to dismiss a second time after reading the command.
  it('closes itself on the way to the dialog', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))
    await user.click(await screen.findByRole('button', { name: /run on your machine/i }))

    expect(screen.queryByText('60,000,016,650,000')).toBeNull()
  })

  // The chip is the only thing on screen that stays put while the popover is open, so it is
  // the only thing that can show which chip the panel belongs to.
  it('marks itself active while its popover is open', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)
    const chip = screen.getByRole('button', { name: /checkpoint/i })

    expect(chip.getAttribute('data-state')).toBe('closed')
    expect(chip.className).toMatch(/data-\[state=open\]:/)

    await user.click(chip)
    expect(chip.getAttribute('data-state')).toBe('open')
  })

  it('closes again on a second click', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)
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
    render(<CheckpointTrigger {...PROPS} />)

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
    render(<CheckpointTrigger {...PROPS} />)
    const chip = screen.getByRole('button', { name: /checkpoint/i })

    await user.hover(chip)
    chip.focus()
    expect(screen.queryByText('60,000,016,650,000')).toBeNull()

    await user.click(chip)
    expect(await screen.findByText('60,000,016,650,000')).toBeDefined()
  })
})

describe('CheckpointTrigger: the resume link', () => {
  // The same glyph the deploy dialog puts on its own share-link control. Both put a URL on the
  // clipboard, so a reader meeting one after the other should read them as the same offer rather
  // than take a different glyph for a different kind of thing.
  it('wears the same icon as the deploy dialog’s share link', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))
    const button = await screen.findByRole('button', { name: /copy resume link/i })

    // lucide names its glyphs in the class, which is the only handle on identity a rendered icon
    // has — jsdom loads no stylesheet and the paths are opaque.
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('lucide-link-2')
  })

  it('offers a link that continues the search somewhere else', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    expect(await screen.findByRole('button', { name: /copy resume link/i })).toBeDefined()
  })

  // Absolute, and it has to be: the destination is another window's address bar, where a path
  // resolves against whatever page happens to be open there — or against nothing at all.
  //
  // fireEvent, not userEvent: userEvent.setup() unconditionally replaces navigator.clipboard with
  // its own stub, clobbering the writeText spy stubbed in here.
  it('copies an absolute URL carrying the config, the search and the checkpoint', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<CheckpointTrigger {...PROPS} />)

    fireEvent.click(screen.getByRole('button', { name: /checkpoint/i }))
    fireEvent.click(await screen.findByRole('button', { name: /copy resume link/i }))

    expect(writeText).toHaveBeenCalledOnce()
    const copied = writeText.mock.calls[0][0] as string
    expect(copied.startsWith(window.location.origin)).toBe(true)

    const url = new URL(copied)
    expect(decodeConfigParam(url.searchParams.get('config') as string).config).toEqual(CONFIG)
    const { resume } = decodeResumeParams(url.searchParams)
    expect(resume?.start).toBe(60_000_016_650_000)
    expect(new Set(resume?.mouths)).toEqual(new Set(['smile', 'open']))
    expect(resume?.filters).toEqual(DEFAULT_FACE_FILTERS)

    vi.unstubAllGlobals()
  })

  // A resume link and a result link are different things, and `config=` carrying a saltNonce is
  // what makes a link the second kind. One that was both would invite the recipient to reproduce
  // a search AND open a deploy dialog over it.
  it('never puts a mined saltNonce in the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<CheckpointTrigger {...PROPS} />)

    fireEvent.click(screen.getByRole('button', { name: /checkpoint/i }))
    fireEvent.click(await screen.findByRole('button', { name: /copy resume link/i }))

    const url = new URL(writeText.mock.calls[0][0] as string)
    expect(
      decodeConfigParam(url.searchParams.get('config') as string).config?.saltNonce,
    ).toBeUndefined()

    vi.unstubAllGlobals()
  })

  // The panel already explains the bare number and the CLI handoff. A third artifact that says
  // nothing about itself leaves the reader to guess what pressing it puts on their clipboard.
  it('says what the link carries', async () => {
    const user = userEvent.setup()
    render(<CheckpointTrigger {...PROPS} />)

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))
    const panel = await findPanel()

    expect(panel.textContent).toMatch(/another tab/i)
    expect(panel.textContent).toMatch(/filters/i)
  })

  // The panel's existing controls are not this one's business. A copy that failed must not leave
  // the digits looking copied, and vice versa.
  it('reports a clipboard failure without touching the digits control', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<CheckpointTrigger {...PROPS} />)

    fireEvent.click(screen.getByRole('button', { name: /checkpoint/i }))
    fireEvent.click(await screen.findByRole('button', { name: /copy resume link/i }))

    // Still offering to copy, both of them: nothing latched a confirmation on a failure.
    expect(await screen.findByRole('button', { name: /copy resume link/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /copy checkpoint/i })).toBeDefined()

    vi.unstubAllGlobals()
  })
})
