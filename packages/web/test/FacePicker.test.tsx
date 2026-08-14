import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FacePicker } from '../components/FacePicker'
import { DEFAULT_FACE_FILTERS, type FaceFilters } from '../lib/config'
import { ALL_MOUTH_NAMES, targetGridFor } from '../lib/face-selection'

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

/**
 * The picker is fully controlled, so a slider driven from a static `filters` prop can never move
 * on screen however hard the test drags it. This is the parent the real app provides: it feeds
 * every change straight back down, which is what makes the readout worth asserting on.
 */
function ControlledPicker({
  initialFilters,
  onFiltersChange,
}: {
  initialFilters: FaceFilters
  onFiltersChange: (filters: FaceFilters) => void
}) {
  const [filters, setFilters] = useState(initialFilters)
  return (
    <FacePicker
      value={['smile']}
      onChange={vi.fn()}
      filters={filters}
      onFiltersChange={(next) => {
        onFiltersChange(next)
        setFilters(next)
      }}
    />
  )
}

function tile(name: string): HTMLElement {
  return screen.getByRole('checkbox', { name: new RegExp(`^${name}$`, 'i') })
}

/** The cells one tile actually draws, as "row:col" pairs. */
function drawnCells(name: string): string {
  return Array.from(tile(name).querySelectorAll('rect[data-filled="true"]'))
    .map((cell) => `${cell.getAttribute('data-row')}:${cell.getAttribute('data-col')}`)
    .join(' ')
}

/** The cells `targetGridFor` promises for one expression, mirrored the way blo mirrors its grid. */
function expectedCells(mouthName: string): string {
  const grid = targetGridFor(mouthName)
  const cells: string[] = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const source = col < 4 ? col : 7 - col
      if (grid[row * 4 + source] === 1) cells.push(`${row}:${col}`)
    }
  }
  return cells.join(' ')
}

describe('FacePicker', () => {
  it('renders a toggle for every expression', () => {
    renderPicker({ value: ['smile'] })
    expect(
      screen.getAllByRole('checkbox', { name: /smile|frown|neutral|open|small/i }),
    ).toHaveLength(5)
  })

  it('adds an expression when its toggle is checked', async () => {
    const { onChange } = renderPicker({ value: ['smile'] })
    await userEvent.click(screen.getByRole('checkbox', { name: /frown/i }))
    expect(onChange).toHaveBeenCalledWith(['smile', 'frown'])
  })

  // T7. The tests below count the checkboxes and drive onCheckedChange, which fires regardless of
  // checked state — so `checked={value.includes(name)}` → `checked={false}` survived all of them.
  // The panel would show every expression unticked while the miner happily accepts all five.
  it('ticks exactly the accepted expressions', () => {
    renderPicker({ value: ['smile', 'frown'] })
    expect(screen.getByRole('checkbox', { name: /^smile$/i }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.getByRole('checkbox', { name: /^frown$/i }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.getByRole('checkbox', { name: /^neutral$/i }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('refuses to remove the last expression, since a face needs a mouth', async () => {
    const { onChange } = renderPicker({ value: ['smile'] })
    await userEvent.click(screen.getByRole('checkbox', { name: /smile/i }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/at least one/i)
  })

  describe('target previews', () => {
    // The previews are the control now: every expression gets one whether or not it is accepted,
    // because clicking a preview is how an expression is accepted in the first place. A preview
    // is identifiable by its 64 grid cells — nothing else in the card renders <rect>s.
    it('renders a preview for every expression, not only the accepted ones', () => {
      renderPicker({ value: ['smile'] })
      for (const name of ['smile', 'frown', 'neutral', 'open', 'small']) {
        expect(tile(name).querySelectorAll('rect')).toHaveLength(64)
      }
    })

    // Counting <rect>s proves a tile has *a* preview, not the right one: every tile has 64 cells
    // whatever it draws, so hard-coding one expression's pattern under all five captions would
    // pass every other test here. These are the same data-row/data-col/data-filled attributes
    // TargetPreview.test.tsx asserts on, read back through the tile that is meant to own them.
    it('draws each expression its own pattern, under its own caption', () => {
      renderPicker({ value: ['smile'] })
      for (const name of ALL_MOUTH_NAMES) {
        expect(drawnCells(name)).toBe(expectedCells(name))
      }
      // …and no two tiles draw the same shape, so "all five show one pattern" cannot pass either.
      expect(new Set(ALL_MOUTH_NAMES.map(drawnCells)).size).toBe(ALL_MOUTH_NAMES.length)
    })

    it('keeps all five previews when the selection changes, re-ticking the accepted ones', () => {
      const { rerender } = render(
        <FacePicker
          value={['smile']}
          onChange={vi.fn()}
          filters={DEFAULT_FACE_FILTERS}
          onFiltersChange={vi.fn()}
        />,
      )
      const checkedNames = () =>
        screen
          .getAllByRole('checkbox')
          .filter((entry) => entry.getAttribute('aria-checked') === 'true')
          .map((entry) => entry.textContent)
      expect(screen.getAllByRole('checkbox')).toHaveLength(5)
      expect(checkedNames()).toEqual(['smile'])

      rerender(
        <FacePicker
          value={['smile', 'frown', 'neutral']}
          onChange={vi.fn()}
          filters={DEFAULT_FACE_FILTERS}
          onFiltersChange={vi.fn()}
        />,
      )
      expect(screen.getAllByRole('checkbox')).toHaveLength(5)
      expect(checkedNames()).toEqual(['smile', 'frown', 'neutral'])
    })

    // Colour alone would leave the accepted set invisible to anyone who cannot see it, so the
    // state is carried by a mark as well: a check on the accepted tiles, absent on the rejected.
    // The emphasis is inverted from what it was — every expression starts accepted, so the
    // notable state is the rejected one, and it is the rejected tile that is dimmed rather than
    // the accepted one that is ringed.
    it('marks an accepted tile with more than colour, and dims a rejected one', () => {
      renderPicker({ value: ['smile'] })
      const accepted = tile('smile')
      expect(accepted.querySelector('[data-slot="expression-selected-mark"]')).not.toBeNull()

      const rejected = tile('frown')
      expect(rejected.querySelector('[data-slot="expression-selected-mark"]')).toBeNull()
      expect(rejected.className).toMatch(/opacity-/)
      expect(accepted.className).not.toMatch(/opacity-/)
    })

    // Inside a tile that is already named after its expression, the preview's own
    // "Target pattern for smile" would be announced twice over — so it is decorative here, and
    // the tile carries the name.
    it('names each tile after its expression, without a duplicate announcement from the preview', () => {
      renderPicker({ value: ['smile'] })
      expect(screen.queryAllByRole('img', { name: /target pattern/i })).toHaveLength(0)
      expect(
        screen.getAllByRole('checkbox').map((entry) => entry.getAttribute('aria-label') ?? entry.textContent),
      ).toEqual(['smile', 'frown', 'neutral', 'open', 'small'])
    })

    it('never labels the expression section or its tiles a blockie or identicon', () => {
      renderPicker({ value: ['smile'] })
      const heading = screen.getByRole('heading', { name: /face expressions/i })
      expect(heading.textContent).not.toMatch(/blockie|identicon/i)
      for (const entry of screen.getAllByRole('checkbox')) {
        expect(entry.textContent).not.toMatch(/blockie|identicon/i)
        expect(entry.getAttribute('aria-label') ?? '').not.toMatch(/blockie|identicon/i)
      }
    })

    // The explanation is still there, one press away, rather than as a paragraph the card has to
    // carry for every reader who has already understood it. What must not happen is it being
    // dropped in the move.
    it('still says what the shapes are, and what they are not, behind the info control', async () => {
      renderPicker({ value: ['smile'] })
      expect(
        screen.queryByText(/not a blockie of any real address, since none exists yet/i),
      ).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: /about face expressions/i }))

      expect(
        await screen.findByText(/not a blockie of any real address, since none exists yet/i),
      ).toBeDefined()
    })

    it('keeps the other two explanations reachable too', async () => {
      const user = userEvent.setup()
      renderPicker({ value: ['smile'] })

      await user.click(screen.getByRole('button', { name: /about two colours only/i }))
      expect(await screen.findByText(/no cell uses the spot colour/i)).toBeDefined()
      await user.keyboard('{Escape}')

      await user.click(screen.getByRole('button', { name: /about minimum contrast/i }))
      expect(
        await screen.findByText(/RGB distance required between the two blockie colours/i),
      ).toBeDefined()
    })
  })

  // Every expression starts accepted, so a user who has rejected several needs one gesture back
  // rather than five. It is offered only when it would do something.
  describe('the "All" reset', () => {
    it('is disabled while every expression is already accepted', () => {
      renderPicker({ value: [...ALL_MOUTH_NAMES] })
      expect((screen.getByRole('button', { name: /^all$/i }) as HTMLButtonElement).disabled).toBe(
        true,
      )
    })

    it('re-accepts everything once something has been rejected', async () => {
      const { onChange } = renderPicker({ value: ['smile', 'frown'] })
      const all = screen.getByRole('button', { name: /^all$/i }) as HTMLButtonElement
      expect(all.disabled).toBe(false)

      await userEvent.click(all)

      expect(onChange).toHaveBeenCalledWith([...ALL_MOUTH_NAMES])
    })
  })

  describe('the contrast preview', () => {
    const swatches = () => document.querySelectorAll('[data-slot="contrast-swatch"]')

    it('shows a pair of swatches beside the value', () => {
      renderPicker({ filters: { twoColor: true, minContrast: 120 } })
      expect(swatches()).toHaveLength(2)
    })

    // The pair is the answer to "how different is 120?", so it has to move with the number rather
    // than being a fixed decoration next to it.
    it('separates the swatches further as the contrast rises', () => {
      const { unmount } = render(
        <FacePicker
          value={['smile']}
          onChange={vi.fn()}
          filters={{ twoColor: true, minContrast: 40 }}
          onFiltersChange={vi.fn()}
        />,
      )
      const low = [...swatches()].map((s) => (s as HTMLElement).style.backgroundColor)
      unmount()

      render(
        <FacePicker
          value={['smile']}
          onChange={vi.fn()}
          filters={{ twoColor: true, minContrast: 400 }}
          onFiltersChange={vi.fn()}
        />,
      )
      const high = [...swatches()].map((s) => (s as HTMLElement).style.backgroundColor)

      expect(low).not.toEqual(high)
      expect(low[0]).not.toBe('')
    })

    // These replaced the sentence that used to explain the scale, so they carry its content now.
    it('anchors both ends of the scale', () => {
      renderPicker({ filters: DEFAULT_FACE_FILTERS })
      expect(screen.getByText(/0 · any pair/i)).toBeDefined()
      expect(screen.getByText(/442 · black on white/i)).toBeDefined()
    })
  })

  describe('two-colour and contrast filters', () => {
    it('defaults to two colours on and zero minimum contrast', () => {
      renderPicker({ filters: DEFAULT_FACE_FILTERS })
      expect(
        screen.getByRole('switch', { name: /two colours only/i }).getAttribute('aria-checked'),
      ).toBe('true')
      expect(
        screen.getByRole('slider', { name: /minimum contrast/i }).getAttribute('aria-valuenow'),
      ).toBe('0')
      expect(screen.getByTestId('min-contrast-value').textContent).toBe('0')
    })

    it('calls onFiltersChange with twoColor flipped when the switch is toggled', async () => {
      const { onFiltersChange } = renderPicker({ filters: DEFAULT_FACE_FILTERS })
      await userEvent.click(screen.getByRole('switch', { name: /two colours only/i }))
      expect(onFiltersChange).toHaveBeenCalledWith({ twoColor: false, minContrast: 0 })
    })

    // jsdom cannot drag a slider — no layout, so no pointer geometry — but Radix's thumb is
    // keyboard operable, which is the path a keyboard user takes anyway.
    it('reports the new contrast, and shows it, when the slider is moved', async () => {
      const onFiltersChange = vi.fn()
      render(
        <ControlledPicker
          initialFilters={{ twoColor: true, minContrast: 150 }}
          onFiltersChange={onFiltersChange}
        />,
      )
      const slider = screen.getByRole('slider', { name: /minimum contrast/i })
      slider.focus()
      await userEvent.keyboard('{ArrowRight}')

      expect(onFiltersChange).toHaveBeenCalledWith({ twoColor: true, minContrast: 151 })
      expect(screen.getByTestId('min-contrast-value').textContent).toBe('151')
      expect(
        screen.getByRole('slider', { name: /minimum contrast/i }).getAttribute('aria-valuenow'),
      ).toBe('151')
    })

    // Step 1 is pinned by the 150 → 151 test above; this one is about the ends of the range being
    // declared and actually reachable.
    it('covers the full 0–442 range, both ends included', async () => {
      render(
        <ControlledPicker
          initialFilters={{ twoColor: true, minContrast: 150 }}
          onFiltersChange={vi.fn()}
        />,
      )
      const slider = () => screen.getByRole('slider', { name: /minimum contrast/i })
      expect(slider().getAttribute('aria-valuemin')).toBe('0')
      expect(slider().getAttribute('aria-valuemax')).toBe('442')

      slider().focus()
      await userEvent.keyboard('{End}')
      expect(slider().getAttribute('aria-valuenow')).toBe('442')
      expect(screen.getByTestId('min-contrast-value').textContent).toBe('442')

      await userEvent.keyboard('{Home}')
      expect(slider().getAttribute('aria-valuenow')).toBe('0')
      expect(screen.getByTestId('min-contrast-value').textContent).toBe('0')
    })

    it('reflects a non-default filters prop', () => {
      renderPicker({ filters: { twoColor: false, minContrast: 150 } })
      expect(
        screen.getByRole('switch', { name: /two colours only/i }).getAttribute('aria-checked'),
      ).toBe('false')
      expect(
        screen.getByRole('slider', { name: /minimum contrast/i }).getAttribute('aria-valuenow'),
      ).toBe('150')
      expect(screen.getByTestId('min-contrast-value').textContent).toBe('150')
    })

    it('follows an external write to the contrast, since this section never locks', () => {
      const { rerender } = render(
        <FacePicker
          value={['smile']}
          onChange={vi.fn()}
          filters={{ twoColor: true, minContrast: 42 }}
          onFiltersChange={vi.fn()}
        />,
      )
      expect(screen.getByTestId('min-contrast-value').textContent).toBe('42')

      // An external write to `filters` — a "Start over" reset, a `?config=` deep link — must
      // overwrite whatever is on screen, since this section never locks and the displayed value
      // must not silently diverge from what the miner filters by.
      rerender(
        <FacePicker
          value={['smile']}
          onChange={vi.fn()}
          filters={{ twoColor: true, minContrast: 300 }}
          onFiltersChange={vi.fn()}
        />,
      )
      expect(screen.getByTestId('min-contrast-value').textContent).toBe('300')
      expect(
        screen.getByRole('slider', { name: /minimum contrast/i }).getAttribute('aria-valuenow'),
      ).toBe('300')
    })
  })
})
