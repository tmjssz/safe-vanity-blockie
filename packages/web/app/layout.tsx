import type { ReactNode } from 'react'
import { ConnectButton } from '../components/ConnectButton'
import { Providers } from './providers'
import './globals.css'

export const metadata = {
  title: 'Safe Vanity Blockie',
  description: 'Mine a Safe address whose identicon renders as a face.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header>
            <h1>Safe Vanity Blockie</h1>
            <ConnectButton />
          </header>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  )
}
