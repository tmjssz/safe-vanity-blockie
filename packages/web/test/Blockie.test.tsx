import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Blockie } from '../components/Blockie'

const ADDRESS = '0x1234567890123456789012345678901234567890'

describe('Blockie', () => {
  it('renders an svg element for a known address', () => {
    const { container } = render(<Blockie address={ADDRESS} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('labels itself with the address it renders', () => {
    const { getByRole } = render(<Blockie address={ADDRESS} />)
    expect(getByRole('img', { name: new RegExp(ADDRESS) })).toBeTruthy()
  })
})
