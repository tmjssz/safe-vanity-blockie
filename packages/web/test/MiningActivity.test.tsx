import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MiningActivity } from '../components/MiningActivity'

const barsIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-slot="activity-bar"]'))

describe('MiningActivity, running', () => {
  it('names itself Mining, and says nothing in words', () => {
    const { container } = render(<MiningActivity paused={false} />)
    expect(screen.getByRole('img', { name: 'Mining' })).toBeDefined()
    expect(container.textContent).toBe('')
  })

  it('draws three bars that animate on a staggered loop', () => {
    const { container } = render(<MiningActivity paused={false} />)
    const bars = barsIn(container)
    expect(bars).toHaveLength(3)
    bars.forEach((bar) => {
      expect(bar.className).toMatch(/animate-equalizer/)
    })
    // Offsets, not one block of three bars moving together, which is a flashing rectangle
    // rather than an equalizer.
    const delays = bars.map((bar) => (bar as HTMLElement).style.animationDelay)
    expect(delays).toEqual(['0ms', '150ms', '300ms'])
  })

  it('draws them in the accent green', () => {
    const { container } = render(<MiningActivity paused={false} />)
    barsIn(container).forEach((bar) => {
      expect(bar.className).toMatch(/bg-emerald-/)
    })
  })

  // A moving indicator is exactly the kind of thing prefers-reduced-motion exists for, and this
  // one sits on screen for the entire length of a search.
  it('holds still under prefers-reduced-motion, without disappearing', () => {
    const { container } = render(<MiningActivity paused={false} />)
    barsIn(container).forEach((bar) => {
      expect(bar.className).toMatch(/motion-reduce:animate-none/)
      // A resting height of its own, so switching the animation off leaves a bar rather than
      // a zero-height nothing.
      expect(bar.className).toMatch(/h-\[\d+px\]/)
    })
  })
})

describe('MiningActivity, paused', () => {
  it('names itself Paused and says so in words', () => {
    render(<MiningActivity paused />)
    const indicator = screen.getByRole('img', { name: 'Paused' })
    expect(indicator.textContent).toBe('Paused')
  })

  it('draws two still bars, in amber, with nothing animating', () => {
    const { container } = render(<MiningActivity paused />)
    const bars = barsIn(container)
    expect(bars).toHaveLength(2)
    bars.forEach((bar) => {
      expect(bar.className).not.toMatch(/animate-/)
    })
    expect(screen.getByRole('img', { name: 'Paused' }).className).toMatch(/text-amber-/)
  })
})

describe('MiningActivity, in both states', () => {
  // It reports a state; it is not a control and it is not a badge. A border or a fill would
  // make it look like one of the two things beside it that ARE pressable.
  it.each([true, false])('is plain inline content, not a pill (paused: %s)', (paused) => {
    render(<MiningActivity paused={paused} />)
    const indicator = screen.getByRole('img')
    expect(indicator.className).not.toMatch(/(^|\s|:)border/)
    expect(indicator.className).not.toMatch(/(^|\s|:)bg-/)
    expect(indicator.className).not.toMatch(/rounded-full/)
  })
})
