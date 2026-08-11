import type { ReactNode } from 'react'
import { ConnectButton } from '../components/ConnectButton'
import { ThemeToggle } from '../components/ThemeToggle'
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
          <header className="border-b">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
              <h1 className="text-lg font-semibold">Safe Vanity Blockie</h1>
              <div className="ml-auto flex items-center gap-2">
                <ThemeToggle />
                <ConnectButton />
              </div>
            </div>
          </header>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  )
}
