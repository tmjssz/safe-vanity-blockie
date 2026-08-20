import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import RootLayout from '../app/layout'
import { useRegisterStartOver } from '../components/AppTitle'

// T6. `<Toaster />` was mounted in app/layout.tsx and deleting it kept the whole suite green:
// nothing rendered layout.tsx, and all four toast assertions elsewhere check only that the
// mocked function was called, never that anything became visible. So worker-failure toasts,
// "Share link copied", "Command copied" and (since S1) every terminal deploy outcome would all
// vanish in production against a fully green suite.
//
// `sonner` is deliberately NOT mocked in this file — the renderer under test is the real one.

// Providers pulls in wagmi's connector discovery and a QueryClient, neither of which this test is
// about; passing children straight through keeps the assertion on the one thing it is about.
vi.mock('../app/providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../components/ConnectButton', () => ({
  ConnectButton: () => <button type="button">connect</button>,
}))

describe('RootLayout', () => {
  it('mounts a toast renderer, so a toast.* call actually reaches the screen', async () => {
    render(
      <RootLayout>
        <p>page content</p>
      </RootLayout>,
    )

    toast.success('Share link copied')

    await waitFor(() => expect(screen.getByText('Share link copied')).toBeDefined())
  })
  // The title is chrome the layout renders and the run it discards is state the page owns, so the
  // wiring between them is this file's to get right: a page that registers a run must find the
  // header's heading turned into a control. Providers is mocked away here, which is exactly why
  // the start-over provider is mounted by the layout rather than tucked inside it.
  it('leaves the app title a plain heading until a page registers a run', () => {
    render(
      <RootLayout>
        <p>page content</p>
      </RootLayout>,
    )

    expect(screen.getByRole('heading', { name: 'Safe Vanity Blockie' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Safe Vanity Blockie' })).toBeNull()
  })

  it('turns the app title into the way back once a page registers a run', async () => {
    const onStartOver = vi.fn()
    function Run() {
      useRegisterStartOver(0, onStartOver)
      return <p>mining</p>
    }

    render(
      <RootLayout>
        <Run />
      </RootLayout>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Safe Vanity Blockie' }))

    expect(onStartOver).toHaveBeenCalledTimes(1)
  })
})
