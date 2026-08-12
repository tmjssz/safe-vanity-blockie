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
