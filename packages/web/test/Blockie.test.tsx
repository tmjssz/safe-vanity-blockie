import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Blockie } from '../components/Blockie'

const ADDRESS = '0x1234567890123456789012345678901234567890'
const OTHER_ADDRESS = '0x0987654321098765432109876543210987654321'

// Counting the draws is the only way "this picture was not redrawn" is observable from outside.
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

describe('Blockie', () => {
  it('renders an svg element for a known address', () => {
    const { container } = render(<Blockie address={ADDRESS} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('labels itself with the address it renders', () => {
    const { getByRole } = render(<Blockie address={ADDRESS} />)
    expect(getByRole('img', { name: new RegExp(ADDRESS) })).toBeTruthy()
  })

  // Memoised, and load-bearing rather than tidy — the same reason DecorativeBlockie is. bloSvg
  // builds ~64 <rect>s on every render, so a caller that re-renders without changing the address
  // redraws a picture that cannot have changed; in the result grid, two hundred of them. The tile's
  // own memo is what has been holding that line, and it only holds while nothing inside a tile
  // re-renders it for reasons of its own.
  it('does not redraw for a re-render that changes nothing', () => {
    bloSvgSpy.mockClear()
    const { rerender } = render(<Blockie address={ADDRESS} />)
    expect(bloSvgSpy).toHaveBeenCalledTimes(1)

    rerender(<Blockie address={ADDRESS} />)
    expect(bloSvgSpy).toHaveBeenCalledTimes(1)

    // A different address is a different picture, and must still be drawn.
    rerender(<Blockie address={OTHER_ADDRESS} />)
    expect(bloSvgSpy).toHaveBeenCalledTimes(2)
  })
})
