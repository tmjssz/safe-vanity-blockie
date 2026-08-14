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

  it('is a single line, so it can be pasted straight into a shell', () => {
    expect(npxCommandFor(config, { rpcUrl: 'https://rpc.example' })).not.toContain('\n')
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

    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example' })
    expect(screen.getByText(command)).toBeDefined()

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

  it('puts the copy control inside the command block', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))

    const block = (await screen.findByRole('dialog')).querySelector(
      '[data-slot="command-block"]',
    )!
    expect(block.contains(screen.getByRole('button', { name: /copy/i }))).toBe(true)
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
