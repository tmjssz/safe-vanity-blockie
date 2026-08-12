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

  // The previews are the expression control now, so there is one per expression rather than one
  // per accepted expression, and each is decorative inside its own labelled toggle — a preview is
  // identified by its 64 grid cells.
  it('renders a target preview inside every expression toggle', () => {
    renderSection({ mouths: ['smile', 'frown', 'open'] })
    const toggles = screen.getAllByRole('checkbox')
    expect(toggles).toHaveLength(5)
    for (const toggle of toggles) {
      expect(toggle.querySelectorAll('rect')).toHaveLength(64)
    }
  })

  it('reports a two-colour toggle change', async () => {
    const props = renderSection()
    await userEvent.click(screen.getByRole('switch', { name: /two colours only/i }))
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...DEFAULT_FACE_FILTERS,
      twoColor: false,
    })
  })

  // The contrast control is a slider now: jsdom cannot drag one, but Radix's thumb is keyboard
  // operable, which is the same code path a keyboard user takes.
  it('reports a contrast change', async () => {
    const props = renderSection({ filters: { twoColor: true, minContrast: 150 } })
    const slider = screen.getByLabelText(/minimum contrast/i)
    slider.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(props.onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ minContrast: 151 }),
    )
  })
})
