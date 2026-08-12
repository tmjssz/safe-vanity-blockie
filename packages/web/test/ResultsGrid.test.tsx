import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Candidate } from '@safe-vanity-blockie/core'
import { ResultsGrid } from '../components/ResultsGrid'

const candidate = (address: string, score: number): Candidate => ({
  saltNonce: '1885506',
  address,
  score,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
})

// Each card is one button now, named after the result it opens ("Deploy 90.2% match 0xa").
const resultCards = () => screen.getAllByRole('button', { name: /deploy .* match/i })

describe('ResultsGrid', () => {
  it('renders one card per candidate', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120), candidate('0xb', 119), candidate('0xc', 118)]}
        droppedCount={0}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(resultCards()).toHaveLength(3)
  })

  it('shows skeletons while mining with nothing found yet', () => {
    const { container } = render(
      <ResultsGrid candidates={[]} droppedCount={0} mining onSelect={vi.fn()} />,
    )
    expect(container.querySelectorAll('[data-testid="result-skeleton"]')).toHaveLength(4)
  })

  it('explains an empty grid when mining is not running', () => {
    render(<ResultsGrid candidates={[]} droppedCount={0} mining={false} onSelect={vi.fn()} />)
    expect(screen.getByText(/no results yet/i)).toBeDefined()
  })

  it('reports how many candidates the filters removed', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120)]}
        droppedCount={162}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/162/)).toBeDefined()
  })

  // Eight cards whose only difference is the blockie they draw: a name that does not carry the
  // address is a name that cannot distinguish them, and this grid is where that actually bites.
  it('gives every card a name that identifies its own result', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120), candidate('0xb', 119)]}
        droppedCount={0}
        mining
        onSelect={vi.fn()}
      />,
    )

    const names = resultCards().map((card) => card.getAttribute('aria-label'))
    expect(names).toEqual([
      expect.stringContaining('0xa'),
      expect.stringContaining('0xb'),
    ])
    expect(new Set(names).size).toBe(2)
  })
})
