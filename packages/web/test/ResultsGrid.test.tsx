import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Candidate } from '@safe-vanity-blockie/core'
import { ResultsGrid } from '../components/ResultsGrid'
import { DEFAULT_FACE_FILTERS } from '../lib/config'

// Counting identicon draws is how "this card did not re-render" is observable from outside: the
// blockie is the expensive part of a card and the only thing a re-render necessarily redraws.
const { bloSvgSpy } = vi.hoisted(() => ({ bloSvgSpy: vi.fn() }))

vi.mock('@safe-vanity-blockie/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@safe-vanity-blockie/core')>()
  return {
    ...actual,
    bloSvg: (address: string, size: number) => {
      bloSvgSpy(address, size)
      return actual.bloSvg(address, size)
    },
  }
})

beforeEach(() => bloSvgSpy.mockClear())

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
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )
    expect(resultCards()).toHaveLength(3)
  })

  it('shows skeletons while mining with nothing found yet', () => {
    const { container } = render(
      <ResultsGrid
        candidates={[]}
        droppedCount={0}
        mining
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )
    expect(container.querySelectorAll('[data-testid="result-skeleton"]')).toHaveLength(4)
  })

  it('explains an empty grid when mining is not running', () => {
    render(
      <ResultsGrid
        candidates={[]}
        droppedCount={0}
        mining={false}
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/no results yet/i)).toBeDefined()
  })

  it('reports how many candidates the filters removed', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120)]}
        droppedCount={162}
        mining
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/162/)).toBeDefined()
  })

  // The bug this replaces: raise the contrast floor past every candidate and the grid quietly
  // showed the whole unfiltered list again, so the filter read as broken. Nothing matching has to
  // look like nothing matching — and not like a skeleton row, which promises results are coming.
  it('says plainly that nothing matches when the filters exclude every candidate', () => {
    const { container } = render(
      <ResultsGrid
        candidates={[]}
        droppedCount={162}
        mining
        filters={{ twoColor: true, minContrast: 300 }}
        onSelect={vi.fn()}
      />,
    )

    const message = screen.getByRole('status').textContent ?? ''
    expect(message).toMatch(/no result/i)
    expect(message).toMatch(/162/)
    expect(container.querySelectorAll('[data-testid="result-skeleton"]')).toHaveLength(0)
    expect(screen.queryByText(/no results yet/i)).toBeNull()
  })

  it('names the filters that are doing the excluding, so the user knows which one to relax', () => {
    const { rerender } = render(
      <ResultsGrid
        candidates={[]}
        droppedCount={162}
        mining
        filters={{ twoColor: true, minContrast: 300 }}
        onSelect={vi.fn()}
      />,
    )
    const both = screen.getByRole('status').textContent ?? ''
    expect(both).toMatch(/two colour/i)
    expect(both).toMatch(/300/)

    // With two-colour off, saying it is excluding things would send the user to the wrong control.
    rerender(
      <ResultsGrid
        candidates={[]}
        droppedCount={162}
        mining
        filters={{ twoColor: false, minContrast: 300 }}
        onSelect={vi.fn()}
      />,
    )
    const contrastOnly = screen.getByRole('status').textContent ?? ''
    expect(contrastOnly).toMatch(/300/)
    expect(contrastOnly).not.toMatch(/two colour/i)
  })

  it('reports the best contrast reached, which is the number the floor has to come down to', () => {
    render(
      <ResultsGrid
        candidates={[]}
        droppedCount={162}
        mining
        filters={{ twoColor: true, minContrast: 300 }}
        bestContrast={143}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/143/)
  })

  // "162 filtered out" over an empty grid, with the empty state also counting 162, reads as two
  // different populations. The count belongs to whichever one is on screen, once.
  it('does not count the excluded candidates twice over an empty grid', () => {
    const { container } = render(
      <ResultsGrid
        candidates={[]}
        droppedCount={162}
        mining
        filters={{ twoColor: true, minContrast: 300 }}
        onSelect={vi.fn()}
      />,
    )
    expect((container.textContent ?? '').match(/162/g)).toHaveLength(1)
  })

  // Two hundred cards, each an inline blockie of ~64 <rect>s, re-rendered on every worker progress
  // message: the grid only stays usable because a card whose candidate object has not changed does
  // not redraw. board.entries() returns the stored objects, so identity is what carries that.
  it('does not redraw a card whose candidate has not changed', () => {
    const unchanged = candidate('0xa', 120)
    const onSelect = vi.fn()
    const { rerender } = render(
      <ResultsGrid
        candidates={[unchanged]}
        droppedCount={0}
        mining
        filters={DEFAULT_FACE_FILTERS}
        onSelect={onSelect}
      />,
    )
    const drawn = bloSvgSpy.mock.calls.length
    expect(drawn).toBeGreaterThan(0)

    // A new array holding the same candidate object — exactly what a publish produces when the
    // leaderboard did not change.
    rerender(
      <ResultsGrid
        candidates={[unchanged]}
        droppedCount={7}
        mining
        filters={DEFAULT_FACE_FILTERS}
        onSelect={onSelect}
      />,
    )

    expect(bloSvgSpy.mock.calls.length).toBe(drawn)
  })

  // Eight cards whose only difference is the blockie they draw: a name that does not carry the
  // address is a name that cannot distinguish them, and this grid is where that actually bites.
  it('gives every card a name that identifies its own result', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120), candidate('0xb', 119)]}
        droppedCount={0}
        mining
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )

    const cards = resultCards()
    const names = cards.map((card) => card.getAttribute('aria-label'))
    expect(names).toEqual([
      expect.stringContaining('0xa'),
      expect.stringContaining('0xb'),
    ])
    expect(new Set(names).size).toBe(2)

    // Same for the badge row each card is described by: a shared id would point every card's
    // description at the first card's badges, silently describing the wrong result.
    const described = cards.map((card) => card.getAttribute('aria-describedby'))
    expect(described.every(Boolean)).toBe(true)
    expect(new Set(described).size).toBe(2)
  })
})
