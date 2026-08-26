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

/**
 * Stands in for the page's own registration: mounted throughout, and speaking for the idle screen
 * only while `enabled` says it is the screen on show.
 */
function Idle({ enabled, onStartOver }: { enabled: boolean; onStartOver: () => void }) {
  useRegisterStartOver(0, onStartOver, enabled)
  return <p>configure</p>
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
  // Nothing registered at all, which is a server render and a bare unit test rather than any screen
  // of the app: the page registers an idle reset the moment it mounts (see its own suite), so a real
  // visitor meets a control. With nothing to act on there is nothing for a control to do.
  it('is a plain heading while nothing is registered', () => {
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

  // The only route back from a run, so the question it puts is the last thing standing between a
  // full leaderboard and an empty one. It names the count rather than asking in the abstract.
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

  // The copy has to match what Start over does. It once promised the owners, threshold and Safe
  // version came back in the form, which stopped being true when this became a full reset, and a
  // confirmation describing the old behaviour is worse than none because it is read and believed.
  it('says the reset clears everything, not that the config comes back', async () => {
    render(
      <App>
        <Run resultCount={80} onStartOver={vi.fn()} />
      </App>,
    )

    await userEvent.click(titleButton())
    const body = (await screen.findByRole('dialog')).textContent ?? ''

    expect(body).toMatch(/everything goes back to how it started/i)
    expect(body).toMatch(/owners, the filters and the checkpoint are all cleared/i)
    expect(body).not.toMatch(/come back in the form/i)
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

  // How the page steps aside for a run without unmounting: it is mounted the whole time, so it
  // cannot use mounting to say which screen is on show.
  it('releases the entry when a registrant is disabled', async () => {
    const resetForm = vi.fn()
    const { rerender } = render(
      <App>
        <Idle enabled onStartOver={resetForm} />
      </App>,
    )
    expect(titleButton()).toBeDefined()

    rerender(
      <App>
        <Idle enabled={false} onStartOver={resetForm} />
      </App>,
    )

    expect(noTitleButton()).toBeNull()
    expect(resetForm).not.toHaveBeenCalled()
  })

  // Nothing to lose yet, so nothing to ask about. The rule lives in the dialog hook rather than
  // here, which is what kept it identical while the status bar still asked the same question.
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
