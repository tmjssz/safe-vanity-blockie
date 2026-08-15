'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from './ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    // `icon-sm` is 32px square, the same height as the chain selector and the wallet chip beside
    // it — `icon` is 36px and left the toggle standing a row taller than its neighbours.
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {/* The name is carried by CSS, exactly as the icon is, rather than by an `aria-label` built
          from `resolvedTheme`. That label was a hydration mismatch: next-themes cannot know the
          theme during SSR, so the server always rendered "Switch to dark theme" and the client
          replaced it — React reported it, and it left the button briefly announcing the wrong
          direction. Both labels are always in the DOM and `display: none` decides which one the
          accessibility tree can see, so the server and client markup are identical and the answer
          still changes with the theme. */}
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <span className="sr-only hidden dark:inline">Switch to light theme</span>
    </Button>
  )
}
