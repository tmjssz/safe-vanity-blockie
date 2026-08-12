import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import RootLayout from '../app/layout'

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
})
