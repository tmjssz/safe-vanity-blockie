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

  // S4/S6. The section is a Collapsible now, but it starts open — the picker has to stay
  // discoverable — and its title is a real h2, which also repairs the FacePicker h3 underneath it
  // that previously hung off a non-heading.
  it('starts open, with its title as a real heading, and collapses on demand', async () => {
    renderSection()
    expect(screen.getByRole('heading', { level: 2, name: /^face$/i })).toBeDefined()
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: /show or hide the face options/i }))

    expect(screen.queryByRole('checkbox')).toBeNull()
    // The one-line summary survives the collapse, as Configure's does.
    expect(screen.getByText(/smile, frown/i)).toBeDefined()
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
