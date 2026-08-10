import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FacePicker } from '../components/FacePicker'
import { DEFAULT_FACE_FILTERS, type FaceFilters } from '../lib/config'

function renderPicker(
  overrides: Partial<{
    value: string[]
    onChange: (mouthNames: string[]) => void
    filters: FaceFilters
    onFiltersChange: (filters: FaceFilters) => void
  }> = {},
) {
  const onChange = overrides.onChange ?? vi.fn()
  const onFiltersChange = overrides.onFiltersChange ?? vi.fn()
  const props = {
    value: overrides.value ?? ['smile'],
    onChange,
    filters: overrides.filters ?? DEFAULT_FACE_FILTERS,
    onFiltersChange,
  }
  const result = render(<FacePicker {...props} />)
  return { ...result, onChange, onFiltersChange }
}

describe('FacePicker', () => {
  it('renders a toggle for every expression', () => {
    renderPicker({ value: ['smile'] })
    expect(screen.getAllByRole('checkbox', { name: /smile|frown|neutral|open|small/i })).toHaveLength(5)
  })

  it('adds an expression when its toggle is checked', async () => {
    const { onChange } = renderPicker({ value: ['smile'] })
    await userEvent.click(screen.getByRole('checkbox', { name: /frown/i }))
    expect(onChange).toHaveBeenCalledWith(['smile', 'frown'])
  })

  it('refuses to remove the last expression, since a face needs a mouth', async () => {
    const { onChange } = renderPicker({ value: ['smile'] })
    await userEvent.click(screen.getByRole('checkbox', { name: /smile/i }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/at least one/i)
  })

  describe('target previews', () => {
    it('shows one preview per accepted expression', () => {
      renderPicker({ value: ['smile', 'frown'] })
      expect(screen.getAllByRole('img', { name: /target pattern/i })).toHaveLength(2)
    })

    it('updates the preview count when the selection changes', () => {
      const { rerender } = render(
        <FacePicker
          value={['smile']}
          onChange={vi.fn()}
          filters={DEFAULT_FACE_FILTERS}
          onFiltersChange={vi.fn()}
        />,
      )
      expect(screen.getAllByRole('img', { name: /target pattern/i })).toHaveLength(1)

      rerender(
        <FacePicker
          value={['smile', 'frown', 'neutral']}
          onChange={vi.fn()}
          filters={DEFAULT_FACE_FILTERS}
          onFiltersChange={vi.fn()}
        />,
      )
      expect(screen.getAllByRole('img', { name: /target pattern/i })).toHaveLength(3)
    })

    it('never labels the target patterns section or its previews a blockie or identicon', () => {
      renderPicker({ value: ['smile'] })
      const heading = screen.getByRole('heading', { name: /target patterns/i })
      expect(heading.textContent).not.toMatch(/blockie|identicon/i)
      for (const preview of screen.getAllByRole('img', { name: /target pattern/i })) {
        expect(preview.getAttribute('aria-label')).not.toMatch(/blockie|identicon/i)
      }
    })
  })

  describe('two-colour and contrast filters', () => {
    it('defaults to two colours on and zero minimum contrast', () => {
      renderPicker({ filters: DEFAULT_FACE_FILTERS })
      expect(screen.getByRole('checkbox', { name: /two colours only/i })).toHaveProperty(
        'checked',
        true,
      )
      expect(screen.getByRole('spinbutton', { name: /minimum contrast/i })).toHaveProperty(
        'value',
        '0',
      )
    })

    it('calls onFiltersChange with twoColor flipped when the checkbox is toggled', async () => {
      const { onFiltersChange } = renderPicker({ filters: DEFAULT_FACE_FILTERS })
      await userEvent.click(screen.getByRole('checkbox', { name: /two colours only/i }))
      expect(onFiltersChange).toHaveBeenCalledWith({ twoColor: false, minContrast: 0 })
    })

    it('calls onFiltersChange with the entered contrast value', () => {
      const { onFiltersChange } = renderPicker({ filters: DEFAULT_FACE_FILTERS })
      const input = screen.getByRole('spinbutton', { name: /minimum contrast/i })
      fireEvent.change(input, { target: { value: '300' } })
      expect(onFiltersChange).toHaveBeenCalledWith({ twoColor: true, minContrast: 300 })
    })

    it('reflects a non-default filters prop', () => {
      renderPicker({ filters: { twoColor: false, minContrast: 150 } })
      expect(screen.getByRole('checkbox', { name: /two colours only/i })).toHaveProperty(
        'checked',
        false,
      )
      expect(screen.getByRole('spinbutton', { name: /minimum contrast/i })).toHaveProperty(
        'value',
        '150',
      )
    })
  })
})
