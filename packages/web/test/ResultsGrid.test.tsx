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

describe('ResultsGrid', () => {
  it('renders one card per candidate', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120), candidate('0xb', 119), candidate('0xc', 118)]}
        selectedAddress={undefined}
        droppedCount={0}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button', { name: /use this/i })).toHaveLength(3)
  })

  it('shows skeletons while mining with nothing found yet', () => {
    const { container } = render(
      <ResultsGrid
        candidates={[]}
        selectedAddress={undefined}
        droppedCount={0}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(container.querySelectorAll('[data-testid="result-skeleton"]')).toHaveLength(4)
  })

  it('explains an empty grid when mining is not running', () => {
    render(
      <ResultsGrid
        candidates={[]}
        selectedAddress={undefined}
        droppedCount={0}
        mining={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/no results yet/i)).toBeDefined()
  })

  it('reports how many candidates the filters removed', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120)]}
        selectedAddress={undefined}
        droppedCount={162}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/162/)).toBeDefined()
  })

  it('marks the selected card', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120), candidate('0xb', 119)]}
        selectedAddress="0xa"
        droppedCount={0}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/selected/i)).toBeDefined()
  })
})
