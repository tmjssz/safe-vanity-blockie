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

/**
 * The command's own control. Reached by data-slot rather than by role, because the dialog is a
 * form-free surface where `textbox` would also match anything else that grew one later, and the
 * point of every assertion below is THIS field.
 */
function commandField(): HTMLTextAreaElement {
  const field = document.querySelector<HTMLTextAreaElement>('[data-slot="input-group-control"]')
  if (!field) throw new Error('no command field on screen')
  return field
}

describe('npxCommandFor', () => {
  it('produces a command that runs the CLI with the same config', () => {
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example', target: 'faces' })
    expect(command).toContain('npx safe-vanity-blockie')
    expect(command).toContain(`--owners ${config.owners.join(',')}`)
    expect(command).toContain('--threshold 2')
    expect(command).toContain('--safe-version 1.4.1')
    expect(command).toContain('--rpc https://rpc.example')
    expect(command).toContain('--target faces')
  })

  // The whole point of the handoff is that the native run searches what the screen searched. The
  // accepted expressions are part of that standard exactly as the colour and match filters are,
  // and a command without them silently widened the search back to all five faces.
  it('names the selected expressions with --target', () => {
    expect(
      npxCommandFor(config, { rpcUrl: 'https://rpc.example', target: 'smile,open' }),
    ).toContain('--target smile,open')
    expect(npxCommandFor(config, { rpcUrl: 'https://rpc.example', target: 'smile' })).toContain(
      '--target smile',
    )
  })

  // One argument per line, so the command can be read rather than scanned. It used to be a
  // single line for exactly one reason — that it pastes into a shell as one command — and that
  // reason survives: every break is a backslash continuation, which is what keeps the shell
  // treating the whole block as one invocation.
  it('puts each argument on its own line', () => {
    const lines = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      filters: { twoColor: true, minContrast: 80, minMatch: 0 },
    }).split('\n')

    expect(lines[0]).toBe('npx safe-vanity-blockie \\')
    expect(lines.slice(1).map((line) => line.trim().replace(/ \\$/, ''))).toEqual([
      `--owners ${config.owners.join(',')}`,
      `--threshold ${config.threshold}`,
      `--safe-version ${config.safeVersion}`,
      '--rpc https://rpc.example',
      '--target faces',
      '--two-color',
      '--min-contrast 80',
      '--min-match 0',
    ])
  })

  // The property the single line was protecting. Every line but the last has to end in a
  // continuation, or a paste runs the first line on its own and the rest as unknown commands.
  it('continues every line but the last, so a paste is still one command', () => {
    const lines = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      filters: { twoColor: false, minContrast: 0, minMatch: 0 },
    }).split('\n')

    for (const line of lines.slice(0, -1)) expect(line.endsWith(' \\')).toBe(true)
    expect(lines.at(-1)!.endsWith('\\')).toBe(false)
  })

  it('passes the two-color and min-contrast filters through, so the CLI search enforces the same standard', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      filters: { twoColor: true, minContrast: 250, minMatch: 0 },
    })
    expect(command).toContain('--two-color')
    expect(command).not.toContain('--no-two-color')
    expect(command).toContain('--min-contrast 250')
  })

  // Emitted at its permissive value too, exactly as --min-contrast is: the copied command is a
  // statement of the standard the screen is holding results to, and a flag that appears only
  // sometimes makes the reader work out whether it was left off or left at zero.
  it('passes the match floor through, so the CLI search enforces the same standard', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      filters: { twoColor: true, minContrast: 250, minMatch: 92.5 },
    })
    expect(command).toContain('--min-match 92.5')
  })

  it('passes --no-two-color when the two-colour filter is off', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      filters: { twoColor: false, minContrast: 0, minMatch: 0 },
    })
    expect(command).toContain('--no-two-color')
  })

  it('omits filter flags entirely when no filters are given', () => {
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example', target: 'faces' })
    expect(command).not.toContain('--two-color')
    expect(command).not.toContain('--no-two-color')
    expect(command).not.toContain('--min-contrast')
    expect(command).not.toContain('--min-match')
  })

  // The two travel together or not at all. A `--start` without its `--workers` invites a native
  // run whose skipped tail nobody can account for: the pool's width is what decides which tails
  // the browser left behind.
  it('hands the resume point over with the pool that produced it', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      resume: { start: 41_200_000_000, workers: 7 },
    })
    expect(command).toContain('--start 41200000000')
    expect(command).toContain('--workers 7')
    // In the order `--help` lists them, so a reader can follow the command down the help text.
    expect(command.indexOf('--workers')).toBeLessThan(command.indexOf('--start'))
  })

  // Digits, not a grouped number: the CLI parses `--start` with Number.
  it('writes the nonce as bare digits', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      resume: { start: 41_200_000_000, workers: 7 },
    })
    expect(command).not.toContain('41,200,000,000')
  })

  // Nothing scanned yet, so there is nothing to resume from — and a `--start 0` would be a flag
  // that says only "we thought about it".
  it('omits both flags when there is no progress to hand over', () => {
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example', target: 'faces' })
    expect(command).not.toContain('--start')
    expect(command).not.toContain('--workers')
  })

  it('still pastes as one command with the resume flags on it', () => {
    const command = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      resume: { start: 500, workers: 3 },
    })
    const lines = command.split('\n')
    expect(lines.slice(0, -1).every((line) => line.endsWith(' \\'))).toBe(true)
    expect(lines[lines.length - 1].endsWith('\\')).toBe(false)
  })
})

// The handoff is a dialog: its content is unmounted while closed, so every test below opens it
// via the trigger first. It was a Collapsible before that, and a <details> before that; every
// assertion those versions made still holds, because what changed is where the detail is shown
// rather than what it says.

describe('CliHandoff', () => {
  it('shows nothing but its trigger until asked', () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    expect(screen.getByRole('button', { name: /run on your machine/i })).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/carries over/i)).toBeNull()
  })

  // A dialog rather than an expander: it is a page of prose and a command to copy, and expanding
  // it pushed the entire leaderboard down the screen to read something most users read once.
  it('opens as a dialog, titled and dismissable', async () => {
    const user = userEvent.setup()
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)

    await user.click(screen.getByRole('button', { name: /run on your machine/i }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/run on your machine/i)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('explains why a user would want the CLI', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))
    expect(screen.getByText(/longer/i)).toBeDefined()
  })

  it('says the whole standard on screen carries over, expressions included', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))
    expect(screen.getByText(/carries over/i)).toBeDefined()
  })

  // The bug this dialog had: a narrowed selection was on screen and absent from the command, so
  // the native run searched all five expressions instead of the two asked for.
  it('names the selected expressions in the handed-off command', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="smile,open" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))
    expect(commandField().value).toContain('--target smile,open')
  })

  it('includes the live filters in the handed-off command', async () => {
    render(
      <CliHandoff
        config={config}
        rpcUrl="https://rpc.example"
        target="faces"
        filters={{ twoColor: false, minContrast: 300, minMatch: 0 }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))
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

    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    fireEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    // Read off the control's value rather than via getByText: the command is multi-line, and the
    // default matcher collapses whitespace in the element while comparing against the raw string.
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example', target: 'faces' })
    expect(commandField().value).toBe(command)

    fireEvent.click(screen.getByRole('button', { name: /copy command/i }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/could not copy/i)).toBeDefined()

    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true })
  })

  // A box that scrolls sideways hides most of what it is about to put on the clipboard. A textarea
  // soft-wraps by definition, so the whole command is readable at a glance without a class saying
  // so — and the value is the command verbatim, so what gets copied still pastes into a shell.
  it('holds the whole command in a field that wraps rather than scrolling sideways', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const field = commandField()
    expect(field.tagName).toBe('TEXTAREA')
    expect(field.value).toBe(
      npxCommandFor(config, { rpcUrl: 'https://rpc.example', target: 'faces' }),
    )
  })

  // The command is derived from the config: there is nothing an edit here could be saved to. But
  // read-only rather than disabled, because a disabled control cannot be focused and its text
  // cannot be selected — which would throw away the reason for using a control at all, and with it
  // the manual fallback the copy-failure alert tells the user to reach for.
  it('makes the command selectable and focusable but not editable', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const field = commandField()
    expect(field.readOnly).toBe(true)
    expect(field.disabled).toBe(false)
  })

  // Sized to the command it holds. The base Textarea asks for this with `field-sizing-content`,
  // which only Chrome implements — on Firefox and Safari that leaves `min-h-16`, a four-line box
  // around a command of seven, scrolling most of what is about to be copied out of sight. Counting
  // the lines is exact and works in every browser.
  it('opens as tall as the command, counting its lines rather than trusting field-sizing', async () => {
    render(
      <CliHandoff
        config={config}
        rpcUrl="https://rpc.example"
        target="faces"
        filters={{ twoColor: false, minContrast: 300, minMatch: 0 }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const lines = npxCommandFor(config, {
      rpcUrl: 'https://rpc.example',
      target: 'faces',
      filters: { twoColor: false, minContrast: 300, minMatch: 0 },
    }).split('\n').length
    expect(lines).toBeGreaterThan(4)
    expect(commandField().rows).toBe(lines)
  })

  // The header strip that used to carry a `bash` label is gone, and with it the only thing on
  // screen that named this field — so the name is given here. A field a screen reader announces
  // as "blank" is the one that is holding what the user came to take away.
  it('names the command field, now that no visible label does', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    expect(commandField().getAttribute('aria-label')).toBe('Command')
    // A pointer left behind by the removed label would name it after nothing at all, which reads
    // as unnamed to some screen readers and as the whole dialog to others.
    expect(commandField().getAttribute('aria-labelledby')).toBeNull()
  })

  // Over the command's own top-right corner, inside the group it copies — not in furniture of its
  // own, which is the row this dialog just got back.
  it('lays the copy control over the top-right corner of the command, inside the group', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const group = (await screen.findByRole('dialog')).querySelector('[data-slot="input-group"]')!
    const copy = screen.getByRole('button', { name: /copy/i })

    expect(group.contains(copy)).toBe(true)
    expect(copy.closest('[data-slot="input-group-addon"]')).toBeNull()
    expect(copy.className).toMatch(/\babsolute\b/)
    expect(copy.className).toMatch(/\btop-1\.5\b/)
    expect(copy.className).toMatch(/\bright-1\.5\b/)
  })

  // Smaller than the 24px it was given in the strip, but not a smaller thing to hit: the padded
  // pseudo-element keeps the target at the WCAG 2.2 minimum while the box itself reads as 20px.
  it('draws the copy control at 20px without shrinking what a pointer has to hit', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const copy = screen.getByRole('button', { name: /copy/i })
    expect(copy.className).toMatch(/\bsize-5\b/)
    expect(copy.className).toMatch(/before:-inset-0\.5/)
    // On the glyph itself, because Button's own `[&_svg:not([class*='size-'])]:size-4` outranks
    // any `[&>svg]` rule set here and would leave a 16px icon in a 20px box.
    expect(copy.querySelector('svg')?.getAttribute('class')).toMatch(/\bsize-3\b/)
  })

  // Nothing left of the strip. It said "bash" — one word, one row of furniture — and the command
  // it labelled is plainly a shell command without it.
  it('shows no header strip above the command', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))
    const dialog = await screen.findByRole('dialog')

    expect(screen.queryByText('bash')).toBeNull()
    expect(dialog.querySelector('[data-slot="input-group-addon"]')).toBeNull()
  })

  // Unboxed, whichever variant supplies that: the control sits inside the command's own frame,
  // where a second box drawn around it is one frame too many. `ghost` is the input group's default
  // and what this relies on — the assertion is that it is not one of the bordered ones.
  it('draws the copy control without a box of its own', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const copy = screen.getByRole('button', { name: /copy/i })
    expect(['ghost', 'link']).toContain(copy.getAttribute('data-variant'))
  })

  // The corner control has to be cleared, but only by its own width: the version of this that
  // floated a full-size button reserved a lane the text could not use, a quarter of every line
  // given up to keep one corner readable. `pr-8` clears a 20px control and nothing more, which is
  // what this pins — a wide reserve is the regression, not a narrow one.
  it('reserves no more width than the corner control needs', async () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    expect(commandField().className).toMatch(/\bpr-8\b/)
    expect(commandField().className).not.toMatch(/\bpr-(1[0-9]|[2-9][0-9])\b/)
  })

  it('copies the command and flips the button label on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    fireEvent.click(screen.getByRole('button', { name: /run on your machine/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy command/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('explains the resume flags in the dialog, and only when they are there', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <CliHandoff
        config={config}
        rpcUrl="https://rpc.example"
        target="faces"
        resume={{ start: 41_200_000_000, workers: 7 }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /run on your machine/i }))
    expect(await screen.findByText(/picks up where the browser left off/i)).toBeDefined()
    unmount()

    render(<CliHandoff config={config} rpcUrl="https://rpc.example" target="faces" />)
    await user.click(screen.getByRole('button', { name: /run on your machine/i }))
    expect(screen.queryByText(/picks up where the browser left off/i)).toBeNull()
  })
})
