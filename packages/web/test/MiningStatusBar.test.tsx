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
}

describe('MiningStatusBar', () => {
  it('shows the best score as a percentage, not a raw fraction', () => {
    render(
      <MiningStatusBar
        status={status}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.queryByText(/120\/133/)).toBeNull()
  })

  // A bare percentage next to a progress bar reads as "the run is 90% done", which is not a
  // number this search can even have — the space is 2^256 wide and nothing is being counted down.
  it('labels the percentage, so it cannot be read as run progress', () => {
    render(
      <MiningStatusBar
        status={status}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/best result/i)).toBeDefined()
  })

  // The bar itself was the other half of that misreading: a filled track implies a total to be a
  // fraction of, and the only total here is the template's maximum score, which is not progress.
  it('draws no progress bar', () => {
    render(
      <MiningStatusBar
        status={status}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows scanned count, rate and worker count', () => {
    render(
      <MiningStatusBar
        status={status}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/4,200,000/)).toBeDefined()
    expect(screen.getByText(/1\.03M\/s/)).toBeDefined()
    expect(screen.getByText(/5 workers/)).toBeDefined()
  })

  // Nothing is being scanned while paused, so a speed is a claim about work that is not
  // happening — and the number it would show is the average of the segment that just ended,
  // sitting unchanged next to a Resume button. The scanned count and the elapsed clock are
  // cumulative facts about the run and stay put; the rate is the one figure here that describes
  // this instant.
  it('reads zero while paused, rather than the speed the run last managed', () => {
    render(
      <MiningStatusBar
        status={{ ...status, paused: true }}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )

    expect(screen.getByText('0k/s')).toBeDefined()
    expect(screen.queryByText(/1\.03M\/s/)).toBeNull()
    // The totals behind it are untouched: they are what the run has done, not what it is doing.
    expect(screen.getByText(/4,200,000/)).toBeDefined()
    expect(screen.getByText(/2m 05s/)).toBeDefined()
  })

  it('shows how long the run has been going, formatted the way the CLI reports it', () => {
    render(
      <MiningStatusBar
        status={status}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/2m 05s/)).toBeDefined()
  })

  it('keeps showing the elapsed time while paused, so it reads as a frozen clock', () => {
    render(
      <MiningStatusBar
        status={{ ...status, running: false, paused: true }}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/2m 05s/)).toBeDefined()
  })

  it('offers Pause while running and Resume while paused', async () => {
    const onPauseToggle = vi.fn()
    const { rerender } = render(
      <MiningStatusBar
        status={status}
        onPauseToggle={onPauseToggle}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(onPauseToggle).toHaveBeenCalledOnce()

    rerender(
      <MiningStatusBar
        status={{ ...status, paused: true }}
        onPauseToggle={onPauseToggle}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /resume/i })).toBeDefined()
  })

  it('says so plainly before any candidate exists', () => {
    render(
      <MiningStatusBar
        status={{ ...status, bestScore: undefined, bestMaxScore: undefined }}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/no candidates yet/i)).toBeDefined()
  })

  // The bar carried a "N candidates kept" count until it was removed as noise: it duplicated the
  // Results badge's population without being the number anyone wanted, and it plateaued at the
  // retention cap so it stopped moving seconds into a run. What the run has *scored* is the nonce
  // count; what survives the filters is the grid's badge.
  it('does not count the retained leaderboard', () => {
    render(
      <MiningStatusBar
        status={status}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.queryByText(/kept/i)).toBeNull()
  })

  it('hides the pause control entirely when mining has not started', () => {
    render(
      <MiningStatusBar
        status={{ ...status, running: false, paused: false, scanned: 0 }}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /pause|resume/i })).toBeNull()
  })

  it('shows no elapsed time before a run exists, since there is nothing to have elapsed', () => {
    render(
      <MiningStatusBar
        status={{ ...status, running: false, paused: false, scanned: 0, elapsedMs: 0 }}
        onPauseToggle={vi.fn()}
        config={CONFIG}
        resultCount={0}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.queryByText(/elapsed/i)).toBeNull()
  })

  // The Configure card is gone for the whole run, so this line is the only place the config being
  // mined is legible. Without it there is no way to check what you set without discarding the run
  // to look — which is the one thing a user watching a long search must not have to do.
  describe('the config summary line', () => {
    function renderBar(config = CONFIG, overrides = {}) {
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
      renderBar()
      expect(screen.getByText(/mining for/i)).toBeDefined()
      expect(screen.getByText(/0xd8dA.*6045/)).toBeDefined()
      expect(screen.getByText(/1 of 1 signers/i)).toBeDefined()
      expect(screen.getByText(/Safe 1\.4\.1/i)).toBeDefined()
    })

    // The chain is in the header, permanently and changeably. Repeating it here would be a second
    // copy of a live value, and the two would disagree the instant one was not updated.
    it('leaves the chain to the header', () => {
      renderBar()
      expect(screen.queryByText(/ethereum/i)).toBeNull()
    })

    it('shows the owner identicon, hidden from assistive tech', () => {
      const { container } = renderBar()
      const identicon = container.querySelector('[data-slot="summary-identicon"]')
      expect(identicon).not.toBeNull()
      expect(identicon?.getAttribute('aria-hidden')).toBe('true')
      expect(identicon?.querySelector('svg')).not.toBeNull()
    })

    it('counts every owner in the signer summary, not just the one it shows', () => {
      renderBar({ ...CONFIG, owners: [OWNER_A, OWNER_B, OWNER_C], threshold: 2 })
      expect(screen.getByText(/2 of 3 signers/i)).toBeDefined()
    })

    // One chip plus a count, rather than three addresses wrapping the bar onto a third line. The
    // rest stay reachable rather than being dropped.
    it('summarises extra owners behind a "+N more" the rest can be read from', async () => {
      const user = userEvent.setup()
      renderBar({ ...CONFIG, owners: [OWNER_A, OWNER_B, OWNER_C], threshold: 2 })

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
      renderBar({ ...CONFIG, owners: [OWNER_A, OWNER_B, OWNER_C], threshold: 2 })

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
      renderBar()
      expect(screen.queryByRole('button', { name: /more owners/i })).toBeNull()
    })
  })

  describe('the Start over control', () => {
    function renderBar(overrides = {}) {
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

    // Two rows, both controls hard right. Pause sits with the counters it acts on; Start over
    // sits with the config summary, a row down and away from the control a user reaches for
    // dozens of times a run — the two are one pixel apart in consequence otherwise.
    it('sits on the second row, under Pause rather than beside it', () => {
      renderBar()

      const pause = screen.getByRole('button', { name: /pause/i })
      const startOver = screen.getByRole('button', { name: /start over/i })
      const rowOf = (el: HTMLElement) => el.closest('[data-slot="status-row"]')

      expect(rowOf(pause)).not.toBeNull()
      expect(rowOf(startOver)).not.toBeNull()
      expect(rowOf(pause)).not.toBe(rowOf(startOver))
      // Second row, so it follows the first in document order.
      expect(
        rowOf(pause)!.compareDocumentPosition(rowOf(startOver)!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      // Both pushed to the right edge of their own row.
      expect(pause.parentElement?.className).toMatch(/ml-auto/)
      expect(startOver.parentElement?.className).toMatch(/ml-auto/)
    })

    it('is hidden before a run exists, alongside the pause control', () => {
      renderBar({ status: { ...status, running: false, paused: false, scanned: 0 } })
      expect(screen.queryByRole('button', { name: /start over/i })).toBeNull()
    })
  })
})
