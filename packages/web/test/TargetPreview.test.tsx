import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TargetPreview } from '../components/TargetPreview'
import { targetGridFor } from '../lib/face-selection'

function filledAt(container: HTMLElement, row: number, col: number): string | null {
  return container
    .querySelector(`rect[data-row="${row}"][data-col="${col}"]`)
    ?.getAttribute('data-filled') ?? null
}

describe('TargetPreview', () => {
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
