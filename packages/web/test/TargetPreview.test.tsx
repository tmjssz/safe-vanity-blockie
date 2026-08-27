import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TargetPreview } from '../components/TargetPreview'
import { targetGridFor } from '../lib/face-selection'

function filledAt(container: HTMLElement, row: number, col: number): string | null {
  return (
    container
      .querySelector(`rect[data-row="${row}"][data-col="${col}"]`)
      ?.getAttribute('data-filled') ?? null
  )
}

describe('TargetPreview', () => {
  // The pattern is what a mined blockie will look like, so the frame around it should be what a
  // blockie sits on: paper. `bg-background` is pure white in light mode and near-black in dark, so
  // the filled cells — which are `currentColor`, i.e. the foreground — read as ink either way. The
  // border it replaces was drawing a box around a picture that is already a solid rectangle.
  it('frames the pattern on the page background rather than in a box', () => {
    const { container } = render(<TargetPreview mouthName="smile" />)

    const frame = container.firstElementChild as HTMLElement
    expect(frame.className).toContain('bg-background')
    // A bare `border` adds a 1px ring on all four sides; nothing here should.
    expect(frame.className).not.toMatch(/(^|\s)border(\s|$)/)
    expect(frame.className).not.toContain('bg-muted')
  })

  it('renders 8 rows worth of cells', () => {
    const { container } = render(<TargetPreview mouthName="smile" />)
    expect(container.querySelectorAll('rect')).toHaveLength(64)
  })

  it('is horizontally symmetric, mirroring column c to column 7-c like blo does', () => {
    const { container } = render(<TargetPreview mouthName="smile" />)
    for (let row = 0; row < 8; row++) {
      expect(filledAt(container, row, 0)).toBe(filledAt(container, row, 7))
      expect(filledAt(container, row, 3)).toBe(filledAt(container, row, 4))
    }
  })

  it('matches targetGridFor at the source columns for a known expression', () => {
    const { container } = render(<TargetPreview mouthName="open" />)
    const grid = targetGridFor('open')
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        expect(filledAt(container, row, col)).toBe(grid[row * 4 + col] === 1 ? 'true' : 'false')
      }
    }
  })

  it('gives the preview an accessible label naming the expression', () => {
    const { getByRole } = render(<TargetPreview mouthName="frown" />)
    expect(getByRole('img', { name: /frown/i })).toBeTruthy()
  })
})
