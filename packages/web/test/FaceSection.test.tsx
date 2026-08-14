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
  // The header carried a badge listing the accepted expressions. It existed so the collapsed card
  // still said what was accepted; with the card always open, the toggles themselves are the answer
  // — each is labelled and each shows its own checked state, a few pixels below where the badge
  // was restating them.
  it('leaves the accepted expressions to the toggles rather than restating them', () => {
    renderSection()
    expect(screen.queryByText('smile, frown')).toBeNull()

    // Still legible, from the controls that set it.
    const smile = screen.getByRole('checkbox', { name: /smile/i }) as HTMLInputElement
    expect(smile.getAttribute('aria-checked') ?? String(smile.checked)).toBe('true')
    const neutral = screen.getByRole('checkbox', { name: /neutral/i }) as HTMLInputElement
    expect(neutral.getAttribute('aria-checked') ?? String(neutral.checked)).toBe('false')
  })

  it('stays editable — expression changes apply without a reset', async () => {
    const props = renderSection()
    await userEvent.click(screen.getByRole('checkbox', { name: /neutral/i }))
    expect(props.onMouthsChange).toHaveBeenCalledWith(['smile', 'frown', 'neutral'])
  })

  // Was a Collapsible, starting open. The collapse existed to keep ~600px of picker from sitting
  // between the caveat and the results all session — but scrolling past it costs nothing, and a
  // control that only ever hides something the user can already scroll past is a control that
  // does not need to exist. S4's other half stands: the title is a real h2, which is what the
  // FacePicker's h3 underneath it hangs off.
  it('shows its options with nothing to open, under a real heading', () => {
    renderSection()
    expect(screen.getByRole('heading', { level: 2, name: /^face$/i })).toBeDefined()
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /show or hide the face options/i })).toBeNull()
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
