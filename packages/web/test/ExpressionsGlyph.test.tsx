import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExpressionsGlyph } from '../components/ExpressionsGlyph'

/** The rendered dots, in document order: row by row, left to right. */
function dots(container: HTMLElement) {
  return [...container.querySelectorAll('circle')]
}

describe('ExpressionsGlyph', () => {
  it('draws nine dots on a 3x3 grid inside a 12-unit box', () => {
    const { container } = render(<ExpressionsGlyph />)

    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 12 12')
    const circles = dots(container)
    expect(circles).toHaveLength(9)

    const stops = ['2.5', '6', '9.5']
    const expected = stops.flatMap((cy) => stops.map((cx) => `${cx},${cy}`))
    expect(circles.map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`)).toEqual(expected)
    // A hair under 11 of the 12 units of ink, which is what keeps it optically the same weight as
    // the lucide icons it sits among.
    for (const circle of circles) expect(circle.getAttribute('r')).toBe('1.4')
  })

  // Five bright, four muted, and specifically the corners-and-centre five. A grid of nine identical
  // dots reads as a texture or a drag handle; the checker is what gives it a figure.
  it('checkers the two tones, corners and centre bright', () => {
    const { container } = render(<ExpressionsGlyph />)
    const circles = dots(container)

    const bright = [0, 2, 4, 6, 8]
    const muted = [1, 3, 5, 7]
    for (const index of bright) {
      expect(circles[index].getAttribute('fill'), `dot ${index}`).toBe('currentColor')
      // `?? ''` because a bright dot carries no class attribute at all — it needs none — and
      // `not.toContain` against null throws rather than passing.
      expect(circles[index].getAttribute('class') ?? '').not.toContain('fill-muted-foreground')
    }
    for (const index of muted) {
      expect(circles[index].getAttribute('class'), `dot ${index}`).toContain(
        'fill-muted-foreground',
      )
      expect(circles[index].getAttribute('fill')).toBeNull()
    }
  })

  // Neither tone is a hex. The bright dots are whatever the text beside them is, and the muted ones
  // are a token — so light mode needs nothing added and a restyled chip takes the glyph with it.
  it('takes both tones from theme tokens rather than hard-coded colours', () => {
    const { container } = render(<ExpressionsGlyph />)

    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(container.innerHTML).not.toMatch(/rgb\(/i)
  })

  it('is decorative without the caller having to say so', () => {
    const { container } = render(<ExpressionsGlyph />)

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes a className while keeping its own', () => {
    const { container } = render(<ExpressionsGlyph className="size-3.5" />)

    const cls = container.querySelector('svg')?.getAttribute('class') as string
    expect(cls).toContain('size-3.5')
    expect(cls).toContain('shrink-0')
  })
})
