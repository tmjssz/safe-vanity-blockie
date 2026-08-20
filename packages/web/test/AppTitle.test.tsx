import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppTitle, StartOverProvider, useRegisterStartOver } from '../components/AppTitle'

const TITLE = 'Safe Vanity Blockie'

const title = () => screen.getByRole('heading', { name: TITLE })
const titleButton = () => screen.getByRole('button', { name: TITLE })
const noTitleButton = () => screen.queryByRole('button', { name: TITLE })

/**
 * Stands in for MiningView: mounted for exactly as long as a run exists, and the thing that
 * tells the header there is now something to discard.
 */
function Run({ resultCount, onStartOver }: { resultCount: number; onStartOver: () => void }) {
  useRegisterStartOver(resultCount, onStartOver)
  return <p>mining</p>
}

/** The header and the page under one provider, as app/layout.tsx arranges them. */
function App({ children }: { children?: ReactNode }) {
  return (
    <StartOverProvider>
      <AppTitle />
      {children}
    </StartOverProvider>
  )
}

describe('AppTitle', () => {
  // Nothing has been mined, so there is nothing to go back to: a control that does nothing when
  // pressed is worse than the text it replaced.
  it('is a plain heading before a run exists', () => {
    render(<App />)

    expect(title()).toBeDefined()
    expect(noTitleButton()).toBeNull()
  })

  it('becomes a control once a run registers itself', () => {
    render(
      <App>
        <Run resultCount={0} onStartOver={vi.fn()} />
      </App>,
    )

    expect(titleButton()).toBeDefined()
  })

  // The same question the status bar's Start over asks, put by the same words and the same
  // number — this is a second door onto one action, not a second action.
  it('asks before discarding a run, naming what is at stake', async () => {
    const onStartOver = vi.fn()
    render(
      <App>
        <Run resultCount={80} onStartOver={onStartOver} />
      </App>,
    )

    await userEvent.click(titleButton())

    expect(screen.getByText(/discard 80 results and start over\?/i)).toBeDefined()
    expect(onStartOver).not.toHaveBeenCalled()
  })

  it('discards the run once the question is answered', async () => {
    const onStartOver = vi.fn()
    render(
      <App>
        <Run resultCount={80} onStartOver={onStartOver} />
      </App>,
    )

    await userEvent.click(titleButton())
    await userEvent.click(await screen.findByRole('button', { name: /^discard and start over$/i }))

    expect(onStartOver).toHaveBeenCalledTimes(1)
  })

  it('keeps the run when the question is declined', async () => {
    const onStartOver = vi.fn()
    render(
      <App>
        <Run resultCount={80} onStartOver={onStartOver} />
      </App>,
    )

    await userEvent.click(titleButton())
    await userEvent.click(await screen.findByRole('button', { name: /keep mining/i }))

    expect(onStartOver).not.toHaveBeenCalled()
  })

  // Nothing to lose yet, so nothing to ask about — the status bar's rule, shared rather than
  // reimplemented, so the two doors cannot drift apart.
  it('discards immediately when there are no results to lose', async () => {
    const onStartOver = vi.fn()
    render(
      <App>
        <Run resultCount={0} onStartOver={onStartOver} />
      </App>,
    )

    await userEvent.click(titleButton())

    expect(onStartOver).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // The run unmounting IS the deregistration, so the idle header needs no bookkeeping of its own.
  it('goes back to a plain heading once the run is gone', async () => {
    function Session() {
      const [running, setRunning] = useState(true)
      return (
        <App>
          {running && <Run resultCount={0} onStartOver={vi.fn()} />}
          <button type="button" onClick={() => setRunning(false)}>
            end run
          </button>
        </App>
      )
    }
    render(<Session />)
    expect(titleButton()).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'end run' }))

    expect(title()).toBeDefined()
    expect(noTitleButton()).toBeNull()
  })
})
