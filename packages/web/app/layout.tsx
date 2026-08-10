import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Safe Vanity Blockie',
  description: 'Mine a Safe address whose identicon renders as a face.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <h1>Safe Vanity Blockie</h1>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
