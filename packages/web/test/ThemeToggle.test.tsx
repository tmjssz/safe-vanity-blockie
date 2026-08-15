import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../components/ThemeToggle'

const { useThemeMock, setThemeMock } = vi.hoisted(() => ({
  useThemeMock: vi.fn(),
  setThemeMock: vi.fn(),
}))

vi.mock('next-themes', () => ({ useTheme: useThemeMock }))

describe('ThemeToggle', () => {
  // The bug this pins: the name used to be an `aria-label` interpolated from `resolvedTheme`.
  // next-themes cannot know the theme while rendering on the server, so `resolvedTheme` is
  // undefined there and the server always emitted "Switch to dark theme" — which the client then
  // replaced. React reported it as a hydration mismatch, and until hydration finished the button
  // announced the wrong direction to anyone reading it.
  //
  // The fix is to let CSS choose, as it already did for the icon: both names are always in the
  // markup, so the server and client agree byte for byte, and `display: none` decides which one
  // the accessibility tree can reach.
  it('renders identical markup whether or not the theme is known yet', () => {
    useThemeMock.mockReturnValue({ resolvedTheme: undefined, setTheme: setThemeMock })
    const { container: beforeResolve } = render(<ThemeToggle />)
    const ssr = beforeResolve.innerHTML

    useThemeMock.mockReturnValue({ resolvedTheme: 'dark', setTheme: setThemeMock })
    const { container: afterResolve } = render(<ThemeToggle />)

    expect(afterResolve.innerHTML).toBe(ssr)
  })

  it('carries both directions in the markup, for CSS to choose between', () => {
    useThemeMock.mockReturnValue({ resolvedTheme: 'dark', setTheme: setThemeMock })
    render(<ThemeToggle />)

    expect(screen.getByText('Switch to light theme')).toBeDefined()
    expect(screen.getByText('Switch to dark theme')).toBeDefined()
    // No interpolated label: that is the thing that could not survive being server-rendered.
    expect(screen.getByRole('button').getAttribute('aria-label')).toBeNull()
  })

  it('switches to the opposite of the resolved theme', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')

    useThemeMock.mockReturnValue({ resolvedTheme: 'dark', setTheme: setThemeMock })
    const { unmount } = render(<ThemeToggle />)
    await userEvent.click(screen.getByRole('button'))
    expect(setThemeMock).toHaveBeenLastCalledWith('light')
    unmount()

    useThemeMock.mockReturnValue({ resolvedTheme: 'light', setTheme: setThemeMock })
    render(<ThemeToggle />)
    await userEvent.click(screen.getByRole('button'))
    expect(setThemeMock).toHaveBeenLastCalledWith('dark')
  })
})
