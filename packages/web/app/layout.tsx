import type { ReactNode } from 'react'
import { HEADER_CHAIN_SLOT_ID } from '../components/ChainSelector'
import { ConnectButton } from '../components/ConnectButton'
import { Footer } from '../components/Footer'
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
      {/* A column at least as tall as the viewport, with <main> taking the slack, so the footer
          sits on the bottom edge of the window when there is little to show rather than floating
          mid-page above dead space. On a full run it is pushed below the results and reached by
          scrolling, exactly as before — this pins it to the bottom of the *page*, not the viewport.
          `dvh` rather than `vh` so mobile browser chrome does not leave it a bar's height short. */}
      <body className="flex min-h-dvh flex-col">
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
                {/* Theme first, then chain, then wallet: left to right that is chrome, then the
                    thing the address is derived from, then the account. The toggle is the least
                    consequential control here and reads that way in the corner it is furthest
                    from. */}
                <ThemeToggle />
                <div id={HEADER_CHAIN_SLOT_ID} className="contents" />
                <ConnectButton />
              </div>
            </div>
          </header>
          {/* `flex-1` is what makes the footer sit on the bottom edge on a short page: main
              absorbs the leftover height rather than the footer being dragged up to meet the
              content. It also keeps main tall enough for the mining bar portaled into it to have
              somewhere to stick. */}
          <main className="flex-1">{children}</main>
          {/* Normal document flow, below everything else — the results grid can hold 200 cards,
              so this sits a long way down on a full run. It is not fixed and reaches for no
              z-index: nothing here is positioned, so it cannot contest the sticky header, the
              sticky mining bar, or the deploy dialog's backdrop. */}
          <Footer />
          {/* Mounted once, here, so every toast.* call from anywhere in the tree — including
              server-rendered pages before hydration finishes — has a renderer to land in. */}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
