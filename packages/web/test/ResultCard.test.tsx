import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ResultCard } from '../components/ResultCard'

const candidate = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

describe('ResultCard', () => {
  it('shows the score as a percentage, not a raw fraction', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.queryByText(/120\/133/)).toBeNull()
  })

  it('shows the address, the saltNonce and the expression', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(screen.getByText(candidate.address)).toBeDefined()
    expect(screen.getByText(/1885506/)).toBeDefined()
    expect(screen.getByText(/small/)).toBeDefined()
  })

  it('renders the real blo identicon for the address', () => {
    const { container } = render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('reports the candidate when chosen', async () => {
    const onSelect = vi.fn()
    render(<ResultCard candidate={candidate} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /use this/i }))
    expect(onSelect).toHaveBeenCalledWith(candidate)
  })

  it('marks a three-colour result so it is not mistaken for a clean one', () => {
    render(<ResultCard candidate={{ ...candidate, twoColor: false }} onSelect={vi.fn()} />)
    expect(screen.getByText(/three colours/i)).toBeDefined()
  })
})
