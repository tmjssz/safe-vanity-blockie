import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FacePicker } from '../components/FacePicker'
import { DEFAULT_FACE_FILTERS, type FaceFilters } from '../lib/config'
import { ALL_MOUTH_NAMES, targetGridFor } from '../lib/face-selection'
import { escapeRegExp } from './support/regexp'

function renderPicker(
  overrides: Partial<{
    value: string[]
    onChange: (mouthNames: string[]) => void
    filters: FaceFilters
    onFiltersChange: (filters: FaceFilters) => void
    live: boolean
  }> = {},
) {
  const onChange = overrides.onChange ?? vi.fn()
  const onFiltersChange = overrides.onFiltersChange ?? vi.fn()
  const props = {
    value: overrides.value ?? ['smile'],
    onChange,
    filters: overrides.filters ?? DEFAULT_FACE_FILTERS,
    onFiltersChange,
    ...(overrides.live === undefined ? {} : { live: overrides.live }),
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
  return screen.getByRole('checkbox', { name: new RegExp(`^${escapeRegExp(name)}$`, 'i') })
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

  // Applying a face change is destructive: the run identity includes the face spec, so a new one
  // wipes the leaderboard and resets the scanned total. It used to do that on a single click of a
  // tile, silently. Now the click only stages.
  it('stages an expression change instead of applying it', async () => {
    const { onChange } = renderPicker({ value: ['smile'] })
    await userEvent.click(screen.getByRole('checkbox', { name: /frown/i }))

    expect(onChange).not.toHaveBeenCalled()
    // The tile still answers to the click: what is staged is what the tiles show.
    expect(screen.getByRole('checkbox', { name: /^frown$/i }).getAttribute('aria-checked')).toBe(
      'true',
    )
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
        screen
          .getAllByRole('checkbox')
          .map((entry) => entry.getAttribute('aria-label') ?? entry.textContent),
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
  // rather than five. Absent rather than disabled when everything is already accepted: it shares
  // its row with Apply and Reset, which come and go with a staged change, so a control that only
  // greys out would be the one dead thing in a row that is otherwise never dead.
  describe('the "Select all" reset', () => {
    it('is not offered while every expression is already accepted', () => {
      renderPicker({ value: [...ALL_MOUTH_NAMES] })
      expect(screen.queryByRole('button', { name: /^select all$/i })).toBeNull()
    })

    it('re-accepts everything once something has been rejected', async () => {
      const { onChange } = renderPicker({ value: ['smile', 'frown'] })
      const all = screen.getByRole('button', { name: /^select all$/i })

      await userEvent.click(all)

      // Staged like any other selection change, not applied: it restarts the search just the same.
      expect(onChange).not.toHaveBeenCalled()
      for (const name of ALL_MOUTH_NAMES) {
        expect(
          screen
            .getByRole('checkbox', { name: new RegExp(`^${escapeRegExp(name)}$`, 'i') })
            .getAttribute('aria-checked'),
        ).toBe('true')
      }
      expect(screen.getByRole('button', { name: /^apply$/i })).toBeDefined()
      // Nothing left to select, so the control that would do it stands down.
      expect(screen.queryByRole('button', { name: /^select all$/i })).toBeNull()
    })
  })

  // All three act on the expression selection, so they belong to its heading rather than trailing
  // the tiles. Left to right they run from the least consequential to the most: widen the
  // selection, discard the edit, restart the search.
  describe('the expression controls row', () => {
    it('keeps Select all, Reset and Apply together in the heading row, in that order', async () => {
      renderPicker({ value: ['smile', 'frown'] })
      await userEvent.click(screen.getByRole('checkbox', { name: /^neutral$/i }))

      const row = screen
        .getByRole('heading', { name: /face expressions/i })
        .closest('[data-slot="expressions-heading-row"]')
      expect(row).not.toBeNull()

      const selectAll = screen.getByRole('button', { name: /^select all$/i })
      const reset = screen.getByRole('button', { name: /^reset$/i })
      const apply = screen.getByRole('button', { name: /^apply$/i })
      for (const control of [selectAll, reset, apply]) {
        expect(row!.contains(control)).toBe(true)
      }

      const following = Node.DOCUMENT_POSITION_FOLLOWING
      expect(selectAll.compareDocumentPosition(reset) & following).toBeTruthy()
      expect(reset.compareDocumentPosition(apply) & following).toBeTruthy()
    })
  })

  // The face spec is part of a run's identity, so changing it is not a filter adjustment: it
  // throws the leaderboard away and starts the search over. That used to happen on one click of a
  // tile with nothing said about it.
  describe('applying a staged selection', () => {
    const applyButton = () => screen.getByRole('button', { name: /^apply$/i })

    it('offers nothing to apply until the selection differs', () => {
      renderPicker({ value: ['smile', 'frown'] })
      expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull()
    })

    it('offers Apply once a tile has been changed', async () => {
      renderPicker({ value: ['smile', 'frown'] })
      await userEvent.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      expect(applyButton()).toBeDefined()
    })

    it('withdraws the offer when the selection is put back as it was', async () => {
      const user = userEvent.setup()
      renderPicker({ value: ['smile', 'frown'] })

      await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      expect(applyButton()).toBeDefined()

      await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull()
    })

    it('warns what applying costs before applying it', async () => {
      const { onChange } = renderPicker({ value: ['smile', 'frown'] })
      const user = userEvent.setup()

      await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      await user.click(applyButton())

      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toMatch(/restart/i)
      expect(dialog.textContent).toMatch(/discard/i)
      expect(onChange).not.toHaveBeenCalled()
    })

    // The warning is about a run: a leaderboard discarded, scanned nonces thrown away, the search
    // started again. On the idle screen — where a resume link now mounts this card so the
    // recipient can see what they are about to start — none of that exists, so every sentence in
    // that dialog is false and the press it costs buys nothing.
    it('applies straight away when there is no run to restart', async () => {
      const { onChange } = renderPicker({ value: ['smile', 'frown'], live: false })
      const user = userEvent.setup()

      await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      await user.click(applyButton())

      expect(onChange).toHaveBeenCalledWith(['smile', 'frown', 'neutral'])
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    // The default is the behaviour that already existed. A host that says nothing gets the
    // question, because the cost it warns about is the normal case.
    it('still warns when nothing says whether a run exists', async () => {
      const { onChange } = renderPicker({ value: ['smile', 'frown'] })
      const user = userEvent.setup()

      await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      await user.click(applyButton())

      expect(await screen.findByRole('dialog')).toBeDefined()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('applies the staged selection once the warning is accepted', async () => {
      const { onChange } = renderPicker({ value: ['smile', 'frown'] })
      const user = userEvent.setup()

      await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      await user.click(applyButton())
      await user.click(await screen.findByRole('button', { name: /restart the search/i }))

      expect(onChange).toHaveBeenCalledWith(['smile', 'frown', 'neutral'])
    })

    it('keeps the staged selection when the warning is declined', async () => {
      const { onChange } = renderPicker({ value: ['smile', 'frown'] })
      const user = userEvent.setup()

      await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      await user.click(applyButton())
      await user.click(await screen.findByRole('button', { name: /keep mining/i }))

      expect(onChange).not.toHaveBeenCalled()
      // Still staged, so a change is not silently lost by backing out of the question.
      expect(
        screen.getByRole('checkbox', { name: /^neutral$/i }).getAttribute('aria-checked'),
      ).toBe('true')
      expect(applyButton()).toBeDefined()
    })

    // The host applies by handing back a new `value`. Once it has, there is nothing outstanding.
    it('stops offering Apply once the run has caught up with the selection', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <FacePicker
          value={['smile', 'frown']}
          onChange={vi.fn()}
          filters={DEFAULT_FACE_FILTERS}
          onFiltersChange={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
      expect(applyButton()).toBeDefined()

      rerender(
        <FacePicker
          value={['smile', 'frown', 'neutral']}
          onChange={vi.fn()}
          filters={DEFAULT_FACE_FILTERS}
          onFiltersChange={vi.fn()}
        />,
      )

      expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull()
    })

    // The way out of a staged change that does not cost the run. Apply restarts the search;
    // this only throws away edits that have not taken effect, so it asks nothing.
    describe('Reset', () => {
      const resetButton = () => screen.getByRole('button', { name: /^reset$/i })

      // Three controls in one row, three weights: Select all is plain text, this is outlined, and
      // Apply is filled. Reset does something to the form rather than only to the selection, so it
      // reads as a control; only Apply has consequences for the run, so only Apply is solid.
      it('is outlined, between the plain text of Select all and the filled Apply', async () => {
        renderPicker({ value: ['smile', 'frown'] })
        await userEvent.click(screen.getByRole('checkbox', { name: /^neutral$/i }))

        expect(screen.getByRole('button', { name: /^reset$/i }).getAttribute('data-variant')).toBe(
          'outline',
        )
        expect(
          screen.getByRole('button', { name: /^select all$/i }).getAttribute('data-variant'),
        ).toBe('link')
        expect(screen.getByRole('button', { name: /^apply$/i }).getAttribute('data-variant')).toBe(
          'default',
        )
      })

      it('is offered only while something is staged', async () => {
        renderPicker({ value: ['smile', 'frown'] })
        expect(screen.queryByRole('button', { name: /^reset$/i })).toBeNull()

        await userEvent.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
        expect(resetButton()).toBeDefined()
      })

      it('puts the tiles back to what is being mined', async () => {
        const user = userEvent.setup()
        renderPicker({ value: ['smile', 'frown'] })

        await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
        await user.click(screen.getByRole('checkbox', { name: /^smile$/i }))
        await user.click(resetButton())

        expect(
          screen.getByRole('checkbox', { name: /^smile$/i }).getAttribute('aria-checked'),
        ).toBe('true')
        expect(
          screen.getByRole('checkbox', { name: /^frown$/i }).getAttribute('aria-checked'),
        ).toBe('true')
        expect(
          screen.getByRole('checkbox', { name: /^neutral$/i }).getAttribute('aria-checked'),
        ).toBe('false')
      })

      // Nothing was applied, so nothing restarts and there is nothing to warn about.
      it('touches neither the run nor the user with a question', async () => {
        const user = userEvent.setup()
        const { onChange } = renderPicker({ value: ['smile', 'frown'] })

        await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
        await user.click(resetButton())

        expect(onChange).not.toHaveBeenCalled()
        expect(screen.queryByRole('dialog')).toBeNull()
      })

      it('leaves nothing to apply or reset afterwards', async () => {
        const user = userEvent.setup()
        renderPicker({ value: ['smile', 'frown'] })

        await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
        await user.click(resetButton())

        expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull()
        expect(screen.queryByRole('button', { name: /^reset$/i })).toBeNull()
      })

      // The "keep at least one expression" complaint belongs to the draft that has just been
      // thrown away, so it cannot outlive it.
      it('clears a complaint left over from the discarded draft', async () => {
        const user = userEvent.setup()
        renderPicker({ value: ['smile', 'frown'] })

        await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
        await user.click(screen.getByRole('checkbox', { name: /^smile$/i }))
        await user.click(screen.getByRole('checkbox', { name: /^frown$/i }))
        await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))
        expect(screen.getByRole('alert').textContent).toMatch(/at least one/i)

        await user.click(resetButton())
        expect(screen.queryByRole('alert')).toBeNull()
      })
    })

    // The colour filters are excluded from a run's identity on purpose: they re-filter candidates
    // already mined rather than re-mining them, so gating them behind Apply would ask the user to
    // confirm a restart that does not happen.
    it('leaves the colour filters applying immediately', async () => {
      const { onFiltersChange } = renderPicker({ value: ['smile', 'frown'] })

      await userEvent.click(screen.getByRole('switch', { name: /two colours only/i }))

      expect(onFiltersChange).toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('the contrast preview', () => {
    const swatches = () => document.querySelectorAll('[data-slot="contrast-swatch"]')

    it('shows a pair of swatches beside the value', () => {
      renderPicker({ filters: { twoColor: true, minContrast: 120, minMatch: 0 } })
      expect(swatches()).toHaveLength(2)
    })

    // The pair is the answer to "how different is 120?", so it has to move with the number rather
    // than being a fixed decoration next to it.
    it('separates the swatches further as the contrast rises', () => {
      const { unmount } = render(
        <FacePicker
          value={['smile']}
          onChange={vi.fn()}
          filters={{ twoColor: true, minContrast: 40, minMatch: 0 }}
          onFiltersChange={vi.fn()}
        />,
      )
      const low = [...swatches()].map((s) => (s as HTMLElement).style.backgroundColor)
      unmount()

      render(
        <FacePicker
          value={['smile']}
          onChange={vi.fn()}
          filters={{ twoColor: true, minContrast: 400, minMatch: 0 }}
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

  describe('the minimum match filter', () => {
    it('shows the floor it was given, as a percentage', () => {
      renderPicker({ filters: { twoColor: true, minContrast: 80, minMatch: 90 } })
      expect(
        screen.getByRole('slider', { name: /minimum match/i }).getAttribute('aria-valuenow'),
      ).toBe('90')
      expect(screen.getByTestId('min-match-value').textContent).toBe('90%')
    })

    it('is off at zero by default, so a fresh run hides nothing', () => {
      renderPicker({ filters: DEFAULT_FACE_FILTERS })
      expect(
        screen.getByRole('slider', { name: /minimum match/i }).getAttribute('aria-valuenow'),
      ).toBe('0')
      expect(screen.getByTestId('min-match-value').textContent).toBe('0%')
    })

    it('reports the new floor, and shows it, when the slider is moved', async () => {
      const onFiltersChange = vi.fn()
      render(
        <ControlledPicker
          initialFilters={{ twoColor: true, minContrast: 80, minMatch: 90 }}
          onFiltersChange={onFiltersChange}
        />,
      )
      const slider = screen.getByRole('slider', { name: /minimum match/i })
      slider.focus()
      await userEvent.keyboard('{ArrowRight}')

      expect(onFiltersChange).toHaveBeenCalledWith({
        twoColor: true,
        minContrast: 80,
        minMatch: 91,
      })
      expect(screen.getByTestId('min-match-value').textContent).toBe('91%')
    })

    it('covers the full 0–100 range, both ends included', async () => {
      render(
        <ControlledPicker
          initialFilters={{ twoColor: true, minContrast: 80, minMatch: 50 }}
          onFiltersChange={vi.fn()}
        />,
      )
      const slider = () => screen.getByRole('slider', { name: /minimum match/i })
      expect(slider().getAttribute('aria-valuemin')).toBe('0')
      expect(slider().getAttribute('aria-valuemax')).toBe('100')

      slider().focus()
      await userEvent.keyboard('{End}')
      expect(screen.getByTestId('min-match-value').textContent).toBe('100%')

      await userEvent.keyboard('{Home}')
      expect(screen.getByTestId('min-match-value').textContent).toBe('0%')
    })

    it('leaves the other filters alone when it changes', async () => {
      const { onFiltersChange } = renderPicker({
        filters: { twoColor: false, minContrast: 42, minMatch: 90 },
      })
      screen.getByRole('slider', { name: /minimum match/i }).focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(onFiltersChange).toHaveBeenCalledWith({
        twoColor: false,
        minContrast: 42,
        minMatch: 91,
      })
    })

    it('anchors both ends of the scale', () => {
      renderPicker({ filters: DEFAULT_FACE_FILTERS })
      expect(screen.getByText(/0 · any match/i)).toBeDefined()
      expect(screen.getByText(/100 · perfect/i)).toBeDefined()
    })

    it('explains itself behind the hint, as the other filters do', async () => {
      renderPicker({ filters: DEFAULT_FACE_FILTERS })
      expect(screen.getByRole('button', { name: /about minimum match/i })).toBeDefined()
    })
  })

  describe('two-colour and contrast filters', () => {
    it('shows the defaults it was given', () => {
      renderPicker({ filters: DEFAULT_FACE_FILTERS })
      expect(
        screen.getByRole('switch', { name: /two colours only/i }).getAttribute('aria-checked'),
      ).toBe('true')
      expect(
        screen.getByRole('slider', { name: /minimum contrast/i }).getAttribute('aria-valuenow'),
      ).toBe(String(DEFAULT_FACE_FILTERS.minContrast))
      expect(screen.getByTestId('min-contrast-value').textContent).toBe(
        String(DEFAULT_FACE_FILTERS.minContrast),
      )
    })

    it('calls onFiltersChange with twoColor flipped when the switch is toggled', async () => {
      const { onFiltersChange } = renderPicker({ filters: DEFAULT_FACE_FILTERS })
      await userEvent.click(screen.getByRole('switch', { name: /two colours only/i }))
      expect(onFiltersChange).toHaveBeenCalledWith({
        twoColor: false,
        minContrast: DEFAULT_FACE_FILTERS.minContrast,
        minMatch: DEFAULT_FACE_FILTERS.minMatch,
      })
    })

    // jsdom cannot drag a slider — no layout, so no pointer geometry — but Radix's thumb is
    // keyboard operable, which is the path a keyboard user takes anyway.
    it('reports the new contrast, and shows it, when the slider is moved', async () => {
      const onFiltersChange = vi.fn()
      render(
        <ControlledPicker
          initialFilters={{ twoColor: true, minContrast: 150, minMatch: 0 }}
          onFiltersChange={onFiltersChange}
        />,
      )
      const slider = screen.getByRole('slider', { name: /minimum contrast/i })
      slider.focus()
      await userEvent.keyboard('{ArrowRight}')

      expect(onFiltersChange).toHaveBeenCalledWith({
        twoColor: true,
        minContrast: 151,
        minMatch: 0,
      })
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
          initialFilters={{ twoColor: true, minContrast: 150, minMatch: 0 }}
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
      renderPicker({ filters: { twoColor: false, minContrast: 150, minMatch: 0 } })
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
          filters={{ twoColor: true, minContrast: 42, minMatch: 0 }}
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
          filters={{ twoColor: true, minContrast: 300, minMatch: 0 }}
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
