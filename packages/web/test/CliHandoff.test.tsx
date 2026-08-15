import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CliHandoff, npxCommandFor } from '../components/CliHandoff'

const config = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '0x' + '22'.repeat(20)],
  threshold: 2,
  safeVersion: '1.4.1' as const,
  chainId: 1,
}

describe('npxCommandFor', () => {
  it('produces a command that runs the CLI with the same config', () => {
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example' })
    expect(command).toContain('npx safe-vanity-blockie')
    expect(command).toContain(`--owners ${config.owners.join(',')}`)
    expect(command).toContain('--threshold 2')
    expect(command).toContain('--safe-version 1.4.1')
    expect(command).toContain('--rpc https://rpc.example')
  })

  // One argument per line, so the command can be read rather than scanned. It used to be a
  // single line for exactly one reason — that it pastes into a shell as one command — and that
  // reason survives: every break is a backslash continuation, which is what keeps the shell
  // treating the whole block as one invocation.
  it('puts each argument on its own line', () => {
    const lines = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      filters: { twoColor: true, minContrast: 80 },
    }).split('\n')

    expect(lines[0]).toBe('npx safe-vanity-blockie \\')
    expect(lines.slice(1).map((line) => line.trim().replace(/ \\$/, ''))).toEqual([
      `--owners ${config.owners.join(',')}`,
      `--threshold ${config.threshold}`,
      `--safe-version ${config.safeVersion}`,
      '--rpc https://rpc.example',
      '--two-color',
      '--min-contrast 80',
    ])
  })

  // The property the single line was protecting. Every line but the last has to end in a
  // continuation, or a paste runs the first line on its own and the rest as unknown commands.
  it('continues every line but the last, so a paste is still one command', () => {
    const lines = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      filters: { twoColor: false, minContrast: 0 },
    }).split('\n')

    for (const line of lines.slice(0, -1)) expect(line.endsWith(' \\')).toBe(true)
    expect(lines.at(-1)!.endsWith('\\')).toBe(false)
  })

  it('passes the two-color and min-contrast filters through, so the CLI search enforces the same standard', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      filters: { twoColor: true, minContrast: 250 },
    })
    expect(command).toContain('--two-color')
    expect(command).not.toContain('--no-two-color')
    expect(command).toContain('--min-contrast 250')
  })

  it('passes --no-two-color when the two-colour filter is off', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      filters: { twoColor: false, minContrast: 0 },
    })
    expect(command).toContain('--no-two-color')
  })

  it('omits filter flags entirely when no filters are given', () => {
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example' })
    expect(command).not.toContain('--two-color')
    expect(command).not.toContain('--no-two-color')
    expect(command).not.toContain('--min-contrast')
  })
})

// The handoff is a dialog: its content is unmounted while closed, so every test below opens it
// via the trigger first. It was a Collapsible before that, and a <details> before that; every
// assertion those versions made still holds, because what changed is where the detail is shown
// rather than what it says.

describe('CliHandoff', () => {
  it('shows nothing but its trigger until asked', () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    expect(screen.getByRole('button', { name: /run this search/i })).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/full set of faces/i)).toBeNull()
  })

  // A dialog rather than an expander: it is a page of prose and a command to copy, and expanding
  // it pushed the entire leaderboard down the screen to read something most users read once.
  it('opens as a dialog, titled and dismissable', async () => {
    const user = userEvent.setup()
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)

    await user.click(screen.getByRole('button', { name: /run this search/i }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/run this search on your machine/i)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('explains why a user would want the CLI', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))
    expect(screen.getByText(/longer/i)).toBeDefined()
  })

  it('warns that a narrowed subset of expressions has no builtin CLI target', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))
    expect(screen.getByText(/full set of faces/i)).toBeDefined()
  })

  it('includes the live filters in the handed-off command', async () => {
    render(
      <CliHandoff
        config={config}
        rpcUrl="https://rpc.example"
        filters={{ twoColor: false, minContrast: 300 }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))
    expect(screen.getByText(/--no-two-color/)).toBeDefined()
    expect(screen.getByText(/--min-contrast 300/)).toBeDefined()
  })

  // fireEvent, not userEvent, for the clicks below: userEvent.setup() unconditionally replaces
  // navigator.clipboard with its own stub on first use, clobbering the deliberate value set here
  // (see the equivalent note in ShareConfig.test.tsx). A plain click event exercises the same
  // onClick handlers without that interference.

  it('copies the command and surfaces an alert plus toast when the clipboard is unavailable', async () => {
    const original = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    fireEvent.click(screen.getByRole('button', { name: /run this search/i }))

    // Read off the block rather than via getByText: the command is multi-line now, and the
    // default matcher collapses whitespace in the element while comparing against the raw string.
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example' })
    expect(document.querySelector('[data-slot="command-block"] pre')!.textContent).toBe(command)

    fireEvent.click(screen.getByRole('button', { name: /copy command/i }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/could not copy/i)).toBeDefined()

    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true })
  })

  // One long line in a box that scrolls sideways hides most of what it is about to put on the
  // clipboard. Wrapped, the whole command is readable at a glance — and it is still a single line
  // of text, so what gets copied is still pasteable straight into a shell.
  it('wraps the command instead of scrolling it out of sight', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))

    const block = (await screen.findByRole('dialog')).querySelector('pre')!
    expect(block.className).toMatch(/whitespace-pre-wrap/)
    expect(block.textContent).toBe(npxCommandFor(config, { rpcUrl: 'https://rpc.example' }))
  })

  // Inside the block it copies, but on a row of its own beneath the command rather than floating
  // over it: laid on top, it had to be given a lane the text could not use, which cost the
  // command a quarter of its width on every line to keep one corner clear.
  it('puts the copy control on its own row under the command, inside the block', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))

    const block = (await screen.findByRole('dialog')).querySelector('[data-slot="command-block"]')!
    const copy = screen.getByRole('button', { name: /copy/i })
    const command = block.querySelector('pre')!

    expect(block.contains(copy)).toBe(true)
    expect(command.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // A link rather than a bordered control: it sits inside a code block, where a second box drawn
  // around it is one frame too many.
  it('offers the copy control as a link, not a bordered button', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))

    const copy = screen.getByRole('button', { name: /copy/i })
    expect(copy.getAttribute('data-variant')).toBe('link')
  })

  // With the control on its own row there is nothing to keep clear, so the command gets the whole
  // width back. This pins the reserve being gone rather than the exact padding that replaced it.
  it('lets the command use the full width of the block', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))

    const command = (await screen.findByRole('dialog')).querySelector('pre')!
    expect(command.className).not.toMatch(/\bpr-(1[0-9]|[2-9][0-9])\b/)
  })

  it('copies the command and flips the button label on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    fireEvent.click(screen.getByRole('button', { name: /run this search/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy command/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
