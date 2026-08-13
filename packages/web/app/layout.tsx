import type { ReactNode } from 'react'
import { HEADER_CHAIN_SLOT_ID } from '../components/ChainSelector'
import { ConnectButton } from '../components/ConnectButton'
import { ThemeToggle } from '../components/ThemeToggle'
import { Toaster } from '../components/ui/sonner'
import { Providers } from './providers'
import './globals.css'

export const metadata = {
  title: 'Safe Vanity Blockie',
  description: 'Mine a Safe address whose identicon renders as a face.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {/* Sticky, and a fixed height so the mining bar has something exact to pin below (see
              MiningStatusBar's `top-14`). The spec puts the wallet button in the always-in-view
              bar; keeping it here and making the header itself stay is the same guarantee — a
              user who decides to connect after a long search does not have to scroll back up.
              `bg-background` is required: without it the page scrolls visibly underneath. */}
          <header className="sticky top-0 z-50 h-14 border-b bg-background">
            <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-4">
              <h1 className="text-lg font-semibold">Safe Vanity Blockie</h1>
              <div className="ml-auto flex items-center gap-2">
                {/* The chain picker lands here, portaled in by the page. It is not rendered here
                    because the chain is not a piece of chrome state: it is one of the four inputs
                    the Safe address is derived from, so it belongs with the run, the submitted
                    config and the reset that crossing the mainnet boundary triggers — all of which
                    live in app/page.tsx. Same arrangement as the mining status bar, which is owned
                    by MiningView and portaled to a slot at the top of the page.

                    The consequence to know: this is empty until the page hydrates, exactly like
                    everything else the page renders (its whole subtree sits behind a Suspense
                    bailout for useSearchParams), so the header's right-hand group settles one
                    control wider on hydration rather than showing a chain that cannot yet be
                    changed. */}
                <div id={HEADER_CHAIN_SLOT_ID} className="contents" />
                <ThemeToggle />
                <ConnectButton />
              </div>
            </div>
          </header>
          <main>{children}</main>
          {/* Mounted once, here, so every toast.* call from anywhere in the tree — including
              server-rendered pages before hydration finishes — has a renderer to land in. */}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
