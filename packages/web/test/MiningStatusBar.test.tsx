import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MiningStatusBar } from '../components/MiningStatusBar'
import { escapeRegExp } from './support/regexp'

const OWNER_A = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const OWNER_B = '0x' + '22'.repeat(20)
const OWNER_C = '0x' + '33'.repeat(20)

const CONFIG = {
  owners: [OWNER_A],
  threshold: 1,
  safeVersion: '1.4.1' as const,
  chainId: 1,
}

const status = {
  running: true,
  paused: false,
  scanned: 4_200_000,
  rate: 1_030_000,
  workers: 5,
  elapsedMs: 125_000,
  bestScore: 120,
  bestMaxScore: 133,
  nextStart: 4_200_500,
}

function renderBar(overrides: Record<string, unknown> = {}) {
  return render(
    <MiningStatusBar
      status={status}
      onPauseToggle={vi.fn()}
      config={CONFIG}
      resultCount={0}
      onStartOver={vi.fn()}
      {...overrides}
    />,
  )
}

const statOf = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-slot="stat-${name}"]`)

describe('MiningStatusBar: the best result', () => {
  it('shows the best score as a percentage, not a raw fraction', () => {
    renderBar()
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.queryByText(/120\/133/)).toBeNull()
  })

  // A bare percentage next to a progress bar reads as "the run is 90% done", which is not a
  // number this search can even have: the space is 2^256 wide and nothing is being counted down.
  it('labels the percentage, so it cannot be read as run progress', () => {
    renderBar()
    expect(screen.getByText(/best result/i)).toBeDefined()
  })

  // The bar itself was the other half of that misreading: a filled track implies a total to be a
  // fraction of, and the only total here is the template's maximum score, which is not progress.
  it('draws no progress bar', () => {
    renderBar()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('says so plainly before any candidate exists', () => {
    renderBar({ status: { ...status, bestScore: undefined, bestMaxScore: undefined } })
    expect(screen.getByText(/no candidates yet/i)).toBeDefined()
  })

  // The bar carried a "N candidates kept" count until it was removed as noise: it duplicated the
  // Results badge's population without being the number anyone wanted, and it plateaued at the
  // retention cap so it stopped moving seconds into a run.
  it('does not count the retained leaderboard', () => {
    renderBar()
    expect(screen.queryByText(/kept/i)).toBeNull()
  })
})

describe('MiningStatusBar: the activity indicator', () => {
  it('shows the mining indicator while the run is working', () => {
    renderBar()
    expect(screen.getByRole('img', { name: 'Mining' })).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Paused' })).toBeNull()
  })

  it('shows the paused indicator, and the word, while the run is held', () => {
    renderBar({ status: { ...status, running: false, paused: true } })
    expect(screen.getByRole('img', { name: 'Paused' })).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Mining' })).toBeNull()
  })

  // An animated "mining" glyph over a run that has not begun, or one a worker error has
  // stopped, is the indicator asserting the one thing it exists to report, wrongly.
  it('shows no indicator at all before a run exists', () => {
    renderBar({ status: { ...status, running: false, paused: false, scanned: 0 } })
    expect(screen.queryByRole('img', { name: /mining|paused/i })).toBeNull()
  })

  // It leads the row it belongs to: the state of the run is what the rest of that row is a
  // measurement of.
  it('leads the stats row', () => {
    const { container } = renderBar()
    const row = container.querySelector('[data-slot="status-row"]')!
    const indicator = screen.getByRole('img', { name: 'Mining' })
    expect(row.contains(indicator)).toBe(true)
    expect(row.firstElementChild).toBe(indicator)
  })
})

describe('MiningStatusBar: the counters while running', () => {
  it('abbreviates the nonce count, in monospace, without the word nonces', () => {
    const { container } = renderBar()
    const scanned = statOf(container, 'scanned')!
    // The sighted, visible rendering: the abbreviation plus its suffix, with the exact figure
    // (which does say "nonces") held out of it in an sr-only sibling instead. `textContent` on
    // `scanned` itself would see both, so this reaches the aria-hidden wrapper directly.
    const visible = scanned.querySelector('[aria-hidden="true"]')
    expect(visible?.textContent).toBe('4.2M checked')
    expect(scanned.querySelector('.font-mono')?.textContent).toBe('4.2M')
    expect(visible?.textContent).not.toMatch(/nonces/)
  })

  // Four characters that never change width, in place of a figure that ran to eleven digits and
  // reflowed the row every time it gained one. The exact number is still here: one hover away
  // for a pointer, and as real text for anyone who cannot hover or cannot see the tooltip.
  it('keeps the exact count reachable as a tooltip, and as text for a screen reader', () => {
    const { container } = renderBar()
    const scanned = statOf(container, 'scanned')!
    expect(scanned.getAttribute('title')).toBe('4,200,000 nonces checked')
    expect(scanned.querySelector('.sr-only')?.textContent).toBe('4,200,000 nonces checked')
  })

  it('abbreviates the rate the same way, and keeps its exact value too', () => {
    const { container } = renderBar()
    const rate = statOf(container, 'rate')!
    expect(rate.querySelector('[aria-hidden="true"]')?.textContent).toBe('1.0M/s')
    expect(rate.className).toMatch(/font-mono/)
    expect(rate.getAttribute('title')).toBe('1,030,000 nonces per second')
    expect(rate.querySelector('.sr-only')?.textContent).toBe('1,030,000 nonces per second')
  })

  // abbreviateNumber clamps a non-finite rate to 0 because `use-miner` computes
  // `(scanned / elapsedMs) * 1000`, which is NaN on a tick where no time has passed yet. The
  // tooltip beside the abbreviation has to clamp the same way, or a NaN tick shows "0/s" titled
  // "NaN nonces per second".
  it('guards the rate tooltip against non-finite input the same way the abbreviation is guarded', () => {
    const { container } = renderBar({ status: { ...status, rate: Number.NaN } })
    const rate = statOf(container, 'rate')!
    expect(rate.querySelector('[aria-hidden="true"]')?.textContent).toBe('0/s')
    expect(rate.getAttribute('title')).toBe('0 nonces per second')
  })

  it('shows the worker count and the elapsed time as separate items', () => {
    const { container } = renderBar()
    expect(statOf(container, 'workers')?.textContent).toBe('5 workers')
    expect(statOf(container, 'elapsed')?.textContent).toBe('2m 05s')
  })

  // Gated on `started`, the same condition the controls use: a clock reading "0s" before
  // anything has been mined claims a run that does not exist. The count and rate can honestly
  // read zero; a duration cannot.
  it('shows no elapsed time before a run exists, since there is nothing to have elapsed', () => {
    const { container } = renderBar({
      status: { ...status, running: false, paused: false, scanned: 0, elapsedMs: 0 },
    })
    expect(statOf(container, 'elapsed')).toBeNull()
  })
})

describe('MiningStatusBar: the counters while paused', () => {
  const pausedStatus = { ...status, running: false, paused: true }

  // Two facts about a run that has stopped, read as one sentence. Apart they were a count and a
  // clock sitting either side of a speed that had nothing to say.
  it('merges the count and the frozen clock into one item', () => {
    const { container } = renderBar({ status: pausedStatus })
    const scanned = statOf(container, 'scanned')!
    expect(scanned.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      '4.2M checked in 2m 05s',
    )
    expect(statOf(container, 'elapsed')).toBeNull()
  })

  // Nothing is being scanned, so a speed is a claim about work that is not happening. It used to
  // read "0k/s", which is the same claim with a number on it: a rate of zero says the search is
  // running and getting nowhere.
  it('shows no hash rate at all, not even a zero', () => {
    const { container } = renderBar({ status: pausedStatus })
    expect(statOf(container, 'rate')).toBeNull()
    expect(container.textContent).not.toMatch(/\/s/)
    expect(container.textContent).not.toMatch(/0k\/s/)
  })

  it('still shows the worker count', () => {
    const { container } = renderBar({ status: pausedStatus })
    expect(statOf(container, 'workers')?.textContent).toBe('5 workers')
  })

  it('keeps the exact count reachable as a tooltip here too, and as text for a screen reader', () => {
    const { container } = renderBar({ status: pausedStatus })
    const scanned = statOf(container, 'scanned')!
    expect(scanned.getAttribute('title')).toBe('4,200,000 nonces checked')
    // The exact duration too, not just the exact count: the merged item speaks both.
    expect(scanned.querySelector('.sr-only')?.textContent).toBe(
      '4,200,000 nonces checked in 2m 05s',
    )
  })
})

describe('MiningStatusBar: the pause and resume controls', () => {
  it('offers Pause while running and Resume while paused, from the same handler', async () => {
    const onPauseToggle = vi.fn()
    const { rerender } = renderBar({ onPauseToggle })
    await userEvent.click(screen.getByRole('button', { name: /^pause$/i }))
    expect(onPauseToggle).toHaveBeenCalledOnce()

    rerender(
      <MiningStatusBar
        status={{ ...status, running: false, paused: true }}
        onPauseToggle={onPauseToggle}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^resume$/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull()
  })

  // One slot, two labels. Resume is the filled one because it is the thing to do next from a
  // paused bar; Pause is an outline because interrupting a working search is not.
  it('fills Resume and outlines Pause, in the one slot', () => {
    const { rerender } = renderBar()
    const pause = screen.getByRole('button', { name: /^pause$/i })
    expect(pause.getAttribute('data-variant')).toBe('outline')

    rerender(
      <MiningStatusBar
        status={{ ...status, running: false, paused: true }}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^resume$/i }).getAttribute('data-variant')).toBe(
      'default',
    )
  })

  // "Pause" and "Resume" are different lengths, so without a floor on the width the control
  // beside them steps sideways every time a user pauses. The two states have to be the same
  // shape, or the button under the pointer moves out from under it.
  it('reserves one width for both labels, so nothing moves when the state flips', () => {
    const { rerender } = renderBar()
    const pauseWidthClass = screen
      .getByRole('button', { name: /^pause$/i })
      .className.match(/\bmin-w-\S+\b/)?.[0]
    // The concrete class, not just `/min-w-/`: that pattern also matches `min-w-0`, which
    // reserves nothing at all and would let this test pass with the floor silently removed.
    expect(pauseWidthClass).toBe('min-w-28')

    rerender(
      <MiningStatusBar
        status={{ ...status, running: false, paused: true }}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    const resumeWidthClass = screen
      .getByRole('button', { name: /^resume$/i })
      .className.match(/\bmin-w-\S+\b/)?.[0]
    // Same width class on both states is what makes this one slot rather than two: if the two
    // buttons ever pick up different floors, Start over is back to moving under the pointer.
    expect(resumeWidthClass).toBe(pauseWidthClass)
  })

  it('hides the control entirely when mining has not started', () => {
    renderBar({ status: { ...status, running: false, paused: false, scanned: 0 } })
    expect(screen.queryByRole('button', { name: /^pause$|^resume$/i })).toBeNull()
  })
})

describe('MiningStatusBar: the Start over control', () => {
  // Nothing to lose yet, so nothing to ask about. A confirmation over an empty leaderboard is
  // the kind that teaches people to dismiss confirmations.
  it('discards immediately when there are no results to lose', async () => {
    const onStartOver = vi.fn()
    renderBar({ onStartOver })

    await userEvent.click(screen.getByRole('button', { name: /start over/i }))

    expect(onStartOver).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks first once results exist, and says how many are at stake', async () => {
    const onStartOver = vi.fn()
    const user = userEvent.setup()
    renderBar({ onStartOver, resultCount: 80 })

    await user.click(screen.getByRole('button', { name: /start over/i }))

    expect(await screen.findByRole('dialog')).toBeDefined()
    expect(screen.getByText(/discard 80 results and start over\?/i)).toBeDefined()
    expect(onStartOver).not.toHaveBeenCalled()
  })

  // One of the four dialogs that used to get the plain black wash while the deploy dialog and
  // the About dialog were blurred. The backdrop is the primitive's now, so this is the check
  // that the shared default actually reaches a dialog nobody styled by hand.
  it('dims and blurs the page behind its confirmation', async () => {
    const user = userEvent.setup()
    renderBar({ resultCount: 80 })

    await user.click(screen.getByRole('button', { name: /start over/i }))
    await screen.findByRole('dialog')

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    expect(overlay.className).toMatch(/backdrop-blur/)
    expect(overlay.className).not.toMatch(/bg-black/)
  })

  it('discards only once the question is answered', async () => {
    const onStartOver = vi.fn()
    const user = userEvent.setup()
    renderBar({ onStartOver, resultCount: 80 })

    await user.click(screen.getByRole('button', { name: /start over/i }))
    await user.click(await screen.findByRole('button', { name: /keep mining/i }))
    expect(onStartOver).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /start over/i }))
    await user.click(await screen.findByRole('button', { name: /^discard and start over$/i }))
    expect(onStartOver).toHaveBeenCalledOnce()
  })

  it('is available while paused, since that is the only way back to the form', () => {
    renderBar({ status: { ...status, running: false, paused: true } })
    expect(screen.getByRole('button', { name: /start over/i })).toBeDefined()
  })

  // Both controls in one group at the right end of the stats row, in both states. Start over
  // used to sit a row below, which is where the checkpoint chip lives now.
  it('sits beside the pause control, at the right end of the stats row', () => {
    renderBar()

    const pause = screen.getByRole('button', { name: /^pause$/i })
    const startOver = screen.getByRole('button', { name: /start over/i })
    expect(pause.parentElement).toBe(startOver.parentElement)
    expect(pause.parentElement?.className).toMatch(/ml-auto/)
    // Pause first: it is the one reached for dozens of times a run, and the destructive control
    // should never be the nearer of the two.
    expect(pause.compareDocumentPosition(startOver) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is hidden before a run exists, alongside the pause control', () => {
    renderBar({ status: { ...status, running: false, paused: false, scanned: 0 } })
    expect(screen.queryByRole('button', { name: /start over/i })).toBeNull()
  })
})

describe('MiningStatusBar: the checkpoint', () => {
  const pausedStatus = { ...status, running: false, paused: true }

  // A running search resumes from its own checkpoint by itself, so the number is worth nothing
  // to the reader until the search has stopped. On the bar it cost a row of furniture on every
  // frame of a live run.
  it('offers no checkpoint chip while the search is working', () => {
    renderBar()
    expect(screen.queryByRole('button', { name: /checkpoint/i })).toBeNull()
  })

  it('offers the chip while paused', () => {
    renderBar({ status: pausedStatus })
    expect(screen.getByRole('button', { name: /checkpoint/i })).toBeDefined()
  })

  it('hands the chip the checkpoint this run has reached', async () => {
    const user = userEvent.setup()
    renderBar({ status: pausedStatus })

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))

    expect(await screen.findByText('4,200,500')).toBeDefined()
  })

  // `nextStartFrom` returns the configured start plus a whole block per worker before any nonce
  // is tried, so a non-zero start would otherwise advertise a checkpoint for a run that has
  // mined nothing, at a number far above where it would actually begin.
  it('says nothing before a single nonce has been scanned', () => {
    renderBar({ status: { ...pausedStatus, scanned: 0, nextStart: 41_200_000_000 } })
    expect(screen.queryByRole('button', { name: /checkpoint/i })).toBeNull()
  })

  // The whole inline row is gone: the words, the eleven digits, the copy button and the info
  // icon that had to explain them.
  it('leaves no "Resume from" row behind', () => {
    const { container } = renderBar({ status: pausedStatus })
    expect(screen.queryByText(/resume from/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /copy resume point/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /what the resume point means/i })).toBeNull()
    expect(container.textContent).not.toMatch(/4,200,500/)
  })

  it('puts the chip at the right end of the config line, a row below the controls', () => {
    const { container } = renderBar({ status: pausedStatus })
    const rows = container.querySelectorAll('[data-slot="status-row"]')
    const chip = screen.getByRole('button', { name: /checkpoint/i })
    const resume = screen.getByRole('button', { name: /^resume$/i })

    expect(rows[0].contains(resume)).toBe(true)
    expect(rows[1].contains(chip)).toBe(true)
    expect(chip.parentElement?.className).toMatch(/ml-auto/)
  })
})

// The Configure card is gone for the whole run, so this line is the only place the config being
// mined is legible. Without it there is no way to check what you set without discarding the run
// to look: the one thing a user watching a long search must not have to do.
describe('MiningStatusBar: the config summary line', () => {
  function renderWithConfig(config = CONFIG, overrides = {}) {
    return render(
      <MiningStatusBar
        status={status}
        onPauseToggle={vi.fn()}
        config={config}
        resultCount={0}
        onStartOver={vi.fn()}
        {...overrides}
      />,
    )
  }

  it('names the owner, the threshold and the Safe version', () => {
    renderWithConfig()
    expect(screen.getByText(/mining for/i)).toBeDefined()
    expect(screen.getByText(/0xd8dA.*6045/)).toBeDefined()
    expect(screen.getByText(/1 of 1 signers/i)).toBeDefined()
    expect(screen.getByText(/Safe 1\.4\.1/i)).toBeDefined()
  })

  // The chain is in the header, permanently and changeably. Repeating it here would be a second
  // copy of a live value, and the two would disagree the instant one was not updated.
  it('leaves the chain to the header', () => {
    renderWithConfig()
    expect(screen.queryByText(/ethereum/i)).toBeNull()
  })

  it('shows the owner identicon, hidden from assistive tech', () => {
    const { container } = renderWithConfig()
    const identicon = container.querySelector('[data-slot="summary-identicon"]')
    expect(identicon).not.toBeNull()
    expect(identicon?.getAttribute('aria-hidden')).toBe('true')
    expect(identicon?.querySelector('svg')).not.toBeNull()
  })

  it('counts every owner in the signer summary, not just the one it shows', () => {
    renderWithConfig({ ...CONFIG, owners: [OWNER_A, OWNER_B, OWNER_C], threshold: 2 })
    expect(screen.getByText(/2 of 3 signers/i)).toBeDefined()
  })

  // One chip plus a count, rather than three addresses wrapping the bar onto a third line. The
  // rest stay reachable rather than being dropped.
  it('summarises extra owners behind a "+N more" the rest can be read from', async () => {
    const user = userEvent.setup()
    renderWithConfig({ ...CONFIG, owners: [OWNER_A, OWNER_B, OWNER_C], threshold: 2 })

    expect(screen.getByText(/0xd8dA.*6045/)).toBeDefined()
    expect(screen.queryByText(new RegExp(escapeRegExp(OWNER_B)))).toBeNull()

    await user.click(screen.getByRole('button', { name: /2 more owners/i }))

    expect(await screen.findByText(OWNER_B)).toBeDefined()
    expect(screen.getByText(OWNER_C)).toBeDefined()
  })

  // The list is a list of addresses, and this app's way of showing an address is its identicon.
  // Without them the panel is four lines of near-identical hex, which is exactly the reading
  // problem the blockie exists to solve.
  it('draws each owner in the list with its identicon', async () => {
    const user = userEvent.setup()
    renderWithConfig({ ...CONFIG, owners: [OWNER_A, OWNER_B, OWNER_C], threshold: 2 })

    await user.click(screen.getByRole('button', { name: /2 more owners/i }))
    await screen.findByText(OWNER_B)

    const drawn = document.querySelectorAll('[data-slot="owner-list-identicon"]')
    expect(drawn).toHaveLength(3)
    // Decorative: the address it depicts is spelled out on the same row.
    drawn.forEach((node) => {
      expect(node.getAttribute('aria-hidden')).toBe('true')
      expect(node.querySelector('svg')).not.toBeNull()
    })
  })

  it('offers no "+N more" for a single owner', () => {
    renderWithConfig()
    expect(screen.queryByRole('button', { name: /more owners/i })).toBeNull()
  })
})
