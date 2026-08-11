import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FACE_FILTERS } from '../lib/config'
import { FaceSection } from '../components/FaceSection'

function renderSection(overrides: Partial<Parameters<typeof FaceSection>[0]> = {}) {
  const props = {
    mouths: ['smile', 'frown'],
    filters: DEFAULT_FACE_FILTERS,
    onMouthsChange: vi.fn(),
    onFiltersChange: vi.fn(),
    ...overrides,
  }
  render(<FaceSection {...props} />)
  return props
}

describe('FaceSection', () => {
  it('summarises the accepted expressions', () => {
    renderSection()
    expect(screen.getByText(/smile, frown/i)).toBeDefined()
  })

  it('stays editable — expression changes apply without a reset', async () => {
    const props = renderSection()
    await userEvent.click(screen.getByRole('checkbox', { name: /neutral/i }))
    expect(props.onMouthsChange).toHaveBeenCalledWith(['smile', 'frown', 'neutral'])
  })

  it('renders one target preview per accepted expression', () => {
    renderSection({ mouths: ['smile', 'frown', 'open'] })
    expect(screen.getAllByRole('img', { name: /target pattern/i })).toHaveLength(3)
  })

  it('reports a two-colour toggle change', async () => {
    const props = renderSection()
    await userEvent.click(screen.getByRole('checkbox', { name: /two colours only/i }))
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...DEFAULT_FACE_FILTERS,
      twoColor: false,
    })
  })

  it('reports a contrast change', async () => {
    const props = renderSection()
    const input = screen.getByLabelText(/minimum contrast/i)
    await userEvent.clear(input)
    await userEvent.type(input, '150')
    expect(props.onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ minContrast: 150 }),
    )
  })
})
