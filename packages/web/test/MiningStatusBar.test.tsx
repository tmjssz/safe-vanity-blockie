import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MiningStatusBar } from '../components/MiningStatusBar'

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
    render(<MiningStatusBar status={status} onPauseToggle={vi.fn()} />)
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.queryByText(/120\/133/)).toBeNull()
  })

  // A bare percentage next to a progress bar reads as "the run is 90% done", which is not a
  // number this search can even have — the space is 2^256 wide and nothing is being counted down.
  it('labels the percentage, so it cannot be read as run progress', () => {
    render(<MiningStatusBar status={status} onPauseToggle={vi.fn()} />)
    expect(screen.getByText(/best result/i)).toBeDefined()
  })

  // The bar itself was the other half of that misreading: a filled track implies a total to be a
  // fraction of, and the only total here is the template's maximum score, which is not progress.
  it('draws no progress bar', () => {
    render(<MiningStatusBar status={status} onPauseToggle={vi.fn()} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows scanned count, rate and worker count', () => {
    render(<MiningStatusBar status={status} onPauseToggle={vi.fn()} />)
    expect(screen.getByText(/4,200,000/)).toBeDefined()
    expect(screen.getByText(/1\.03M\/s/)).toBeDefined()
    expect(screen.getByText(/5 workers/)).toBeDefined()
  })

  it('shows how long the run has been going, formatted the way the CLI reports it', () => {
    render(<MiningStatusBar status={status} onPauseToggle={vi.fn()} />)
    expect(screen.getByText(/2m 05s/)).toBeDefined()
  })

  it('keeps showing the elapsed time while paused, so it reads as a frozen clock', () => {
    render(
      <MiningStatusBar
        status={{ ...status, running: false, paused: true }}
        onPauseToggle={vi.fn()}
      />,
    )
    expect(screen.getByText(/2m 05s/)).toBeDefined()
  })

  it('offers Pause while running and Resume while paused', async () => {
    const onPauseToggle = vi.fn()
    const { rerender } = render(
      <MiningStatusBar status={status} onPauseToggle={onPauseToggle} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(onPauseToggle).toHaveBeenCalledOnce()

    rerender(
      <MiningStatusBar status={{ ...status, paused: true }} onPauseToggle={onPauseToggle} />,
    )
    expect(screen.getByRole('button', { name: /resume/i })).toBeDefined()
  })

  it('says so plainly before any candidate exists', () => {
    render(
      <MiningStatusBar
        status={{ ...status, bestScore: undefined, bestMaxScore: undefined }}
        onPauseToggle={vi.fn()}
      />,
    )
    expect(screen.getByText(/no candidates yet/i)).toBeDefined()
  })

  // The bar carried a "N candidates kept" count until it was removed as noise: it duplicated the
  // Results badge's population without being the number anyone wanted, and it plateaued at the
  // retention cap so it stopped moving seconds into a run. What the run has *scored* is the nonce
  // count; what survives the filters is the grid's badge.
  it('does not count the retained leaderboard', () => {
    render(<MiningStatusBar status={status} onPauseToggle={vi.fn()} />)
    expect(screen.queryByText(/kept/i)).toBeNull()
  })

  it('hides the pause control entirely when mining has not started', () => {
    render(
      <MiningStatusBar
        status={{ ...status, running: false, paused: false, scanned: 0 }}
        onPauseToggle={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /pause|resume/i })).toBeNull()
  })

  it('shows no elapsed time before a run exists, since there is nothing to have elapsed', () => {
    render(
      <MiningStatusBar
        status={{ ...status, running: false, paused: false, scanned: 0, elapsedMs: 0 }}
        onPauseToggle={vi.fn()}
      />,
    )
    expect(screen.queryByText(/elapsed/i)).toBeNull()
  })
})
