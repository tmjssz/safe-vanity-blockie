import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FaceSection } from '../components/FaceSection'
import { DEFAULT_FACE_FILTERS, type FaceFilters } from '../lib/config'
import { ALL_MOUTH_NAMES } from '../lib/face-selection'

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

/**
 * The collapse control. It is the card header, stretched under the title and chips as an
 * `inset-0` button, and it takes its accessible name from the <h2> it covers.
 */
function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /^filter$/i })
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

  // Still never locks: unlike Configure, which the page unmounts for the whole run, everything
  // here stays reachable and editable while mining. What changed is where the line falls INSIDE
  // the card. The colour filters re-filter candidates already mined, so they still apply on the
  // spot. The expressions are part of the run's identity — a new face spec wipes the leaderboard
  // and resets the scanned total — so they stage behind Apply and a warning instead of doing that
  // on one click with nothing said.
  it('applies a colour filter on the spot, and stages an expression change', async () => {
    const user = userEvent.setup()
    const props = renderSection()

    await user.click(screen.getByRole('switch', { name: /two colours only/i }))
    expect(props.onFiltersChange).toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox', { name: /neutral/i }))
    expect(props.onMouthsChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    await user.click(await screen.findByRole('button', { name: /restart the search/i }))
    expect(props.onMouthsChange).toHaveBeenCalledWith(['smile', 'frown', 'neutral'])
  })

  // Named "Filter" now, after two earlier names. "Face" described the expression tiles alone and
  // left the colour filters looking like strays; "Pattern filter" then described the tiles as a
  // pattern, which the colour controls are not part of either.
  //
  // The h2 survives every rename, and has to: FacePicker's <h3 id="face-expressions"> hangs off
  // it. That is also why the collapse trigger is a button stretched across the header rather than
  // a button wrapping it, since a heading cannot live inside a button.
  it('titles itself Filter, under a real heading', () => {
    renderSection()
    expect(screen.getByRole('heading', { level: 2, name: /^filter$/i })).toBeDefined()
    expect(screen.queryByRole('heading', { name: /pattern filter/i })).toBeNull()
  })

  // Open when there is nothing else to be getting on with, which is the state a first-time reader
  // arrives in. `mining` is the only thing that changes that.
  it('starts open with no run, and starts collapsed once one exists', () => {
    const { unmount } = render(
      <FaceSection
        mouths={['smile']}
        filters={DEFAULT_FACE_FILTERS}
        onMouthsChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    )
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    unmount()

    render(
      <FaceSection
        mouths={['smile']}
        filters={DEFAULT_FACE_FILTERS}
        mining
        onMouthsChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    )
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    // Radix unmounts a closed panel, so the controls are genuinely gone rather than hidden.
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  // The whole header, not the chevron alone: a 16px glyph is a poor target for a row that has an
  // obvious one. The chevron is decorative, which is what stops a screen reader announcing a
  // second control for the same job.
  it('makes the whole header row the toggle, with the chevron along for the ride', async () => {
    renderSection()
    const header = trigger()
    expect(header.getAttribute('aria-expanded')).toBe('true')

    await userEvent.click(header)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    const chevron = document.querySelector('[data-slot="filter-chevron"]')
    expect(chevron?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getAllByRole('button', { name: /^filter$/i })).toHaveLength(1)
  })

  // Auto-collapse is a default, not a rule. A card the user deliberately opened, closing itself
  // again a moment later because something unrelated started, is a control that does not hold.
  it('stops auto-collapsing once the user has said what they want', async () => {
    const props = {
      mouths: ['smile'],
      filters: DEFAULT_FACE_FILTERS,
      onMouthsChange: vi.fn(),
      onFiltersChange: vi.fn(),
    }
    const { rerender } = render(<FaceSection {...props} />)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')

    // Left alone, the start of a run closes it.
    rerender(<FaceSection {...props} mining />)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    // Opened by hand, it stays open through another transition into mining.
    await userEvent.click(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    rerender(<FaceSection {...props} />)
    rerender(<FaceSection {...props} mining />)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  // Collapsing hides controls; it must not touch what they hold. Nothing here calls a change
  // handler, and the values are all still there when the card comes back.
  it('does not disturb any filter value on the way closed and open again', async () => {
    const props = {
      mouths: ['smile', 'frown'],
      filters: { twoColor: true, minContrast: 80, minMatch: 0 },
      onMouthsChange: vi.fn(),
      onFiltersChange: vi.fn(),
    }
    render(<FaceSection {...props} />)

    await userEvent.click(trigger())
    await userEvent.click(trigger())

    expect(props.onFiltersChange).not.toHaveBeenCalled()
    expect(props.onMouthsChange).not.toHaveBeenCalled()
    expect(
      screen.getByRole('switch', { name: /two colours only/i }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(screen.getByTestId('min-contrast-value').textContent).toBe('80')
  })

  // The results grid's empty state tells the user to relax a filter, and during a run this card is
  // collapsed above it — so it asks to be opened. A counter rather than a boolean: after the user
  // closes the card again, a second press of the same button has to work, and a prop already true
  // would report nothing changed.
  describe('a request to reveal the filters', () => {
    const props = () => ({
      mouths: ['smile'],
      filters: DEFAULT_FACE_FILTERS,
      mining: true,
      onMouthsChange: vi.fn(),
      onFiltersChange: vi.fn(),
    })

    it('opens a collapsed card, and opens it again after the user closes it', async () => {
      const base = props()
      const { rerender } = render(<FaceSection {...base} revealRequest={0} />)
      expect(trigger().getAttribute('aria-expanded')).toBe('false')

      rerender(<FaceSection {...base} revealRequest={1} />)
      expect(trigger().getAttribute('aria-expanded')).toBe('true')

      await userEvent.click(trigger())
      expect(trigger().getAttribute('aria-expanded')).toBe('false')

      rerender(<FaceSection {...base} revealRequest={2} />)
      expect(trigger().getAttribute('aria-expanded')).toBe('true')
    })

    // A mount is not a request, whatever number it arrives holding. The page's counter does not
    // reset when this card remounts — a chain switch remounts the section under a run that has
    // already asked once — and a card that opened itself on arrival would override `mining`, which
    // is the whole reason it starts collapsed.
    it('does not treat the count it mounts with as a request', () => {
      render(<FaceSection {...props()} revealRequest={7} />)
      expect(trigger().getAttribute('aria-expanded')).toBe('false')
    })

    // Only the request opens it. A re-render for any other reason — a filter changing, the page
    // publishing mining progress — must not reopen a card the user has closed, which is what
    // reading the prop rather than its changes would do.
    it('leaves the card alone on a re-render that is not a request', async () => {
      const base = props()
      const { rerender } = render(<FaceSection {...base} revealRequest={0} />)
      rerender(<FaceSection {...base} revealRequest={1} />)
      expect(trigger().getAttribute('aria-expanded')).toBe('true')

      // Closed by hand, then a re-render carrying the same request number. A filter change is the
      // one a user provokes most often, and the page re-renders several times a second besides.
      await userEvent.click(trigger())
      rerender(
        <FaceSection
          {...base}
          filters={{ twoColor: false, minContrast: 0, minMatch: 0 }}
          revealRequest={1}
        />,
      )
      expect(trigger().getAttribute('aria-expanded')).toBe('false')
    })

    // Opening a card several hundred pixels above the grid the user is looking at moves it no
    // closer to them: the browser stays where it was, and the controls expand off-screen. jsdom
    // implements no scrolling, so this pins the call rather than a position.
    it('brings the card into view, not merely open', () => {
      const scrollIntoView = vi.fn()
      // jsdom leaves this undefined on the prototype, so an unguarded call would throw in tests
      // and the assertion needs something to observe either way.
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: scrollIntoView,
      })
      const base = props()
      const { rerender } = render(<FaceSection {...base} revealRequest={0} />)
      expect(scrollIntoView).not.toHaveBeenCalled()

      rerender(<FaceSection {...base} revealRequest={1} />)
      expect(scrollIntoView).toHaveBeenCalled()
    })
  })

  describe('the collapsed summary', () => {
    const collapsed = (overrides: { mouths?: string[]; filters?: FaceFilters } = {}) => {
      render(
        <FaceSection
          mouths={overrides.mouths ?? ALL_MOUTH_NAMES}
          filters={overrides.filters ?? DEFAULT_FACE_FILTERS}
          mining
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )
      const summary = document.querySelector('[data-slot="filter-summary"]')
      if (!summary) throw new Error('no summary on a collapsed card')
      return summary
    }

    // A chip per constraint that is actually constraining. Read off the applied selection, not
    // FacePicker's draft: a staged edit is not what is being mined, and this row's job is to say
    // what is.
    it('counts the expressions while every one is accepted', () => {
      expect(collapsed().textContent).toContain(`${ALL_MOUTH_NAMES.length} expressions`)
    })

    // Names beat a count once the list is short: "smile, open" says which, where "2 expressions"
    // only says how many and sends the reader back into the card to find out.
    it('names the expressions once three or fewer are left', () => {
      expect(collapsed({ mouths: ['smile', 'open'] }).textContent).toContain('smile, open')
    })

    // Above three the names are longer than the row has room for, so it counts again. Not the same
    // branch as all-accepted, and worth its own case: four of five is a real constraint that must
    // not be reported as five.
    it('falls back to a count above three, without claiming all are accepted', () => {
      const text = collapsed({ mouths: ALL_MOUTH_NAMES.slice(0, 4) }).textContent ?? ''
      expect(text).toContain('4 expressions')
      expect(text).not.toContain(`${ALL_MOUTH_NAMES.length} expressions`)
    })

    // The permissive defaults earn no chips. Three chips that all say "everything is allowed" tell
    // the user the filter is doing work it is not.
    it('shows nothing but the expressions when the colour filters are wide open', () => {
      const summary = collapsed({ filters: { twoColor: false, minContrast: 0, minMatch: 0 } })
      expect(summary.textContent).toContain('expressions')
      expect(summary.textContent).not.toMatch(/two colours/i)
      expect(summary.textContent).not.toContain('≥')
    })

    it('adds a chip for two colours only while that toggle is on', () => {
      expect(
        collapsed({ filters: { twoColor: true, minContrast: 0, minMatch: 0 } }).textContent,
      ).toMatch(/two colours/i)
    })

    // The number with the same swatch the result tiles and the slider carry, so one number has one
    // picture everywhere it appears. The glyph is not a screen reader's job to interpret, hence the
    // spelled-out name beside it.
    it('adds a chip for a contrast floor, with its swatch and a spoken name', () => {
      const summary = collapsed({ filters: { twoColor: false, minContrast: 80, minMatch: 0 } })
      expect(summary.textContent).toContain('≥ 80')
      expect(summary.textContent).toContain('minimum contrast 80')
      expect(summary.querySelector('svg')).not.toBeNull()
    })

    it('adds a chip for a match floor, with a spoken name', () => {
      const summary = collapsed({ filters: { twoColor: false, minContrast: 0, minMatch: 92 } })
      expect(summary.textContent).toContain('≥ 92%')
      expect(summary.textContent).toContain('minimum match 92 percent')
    })

    // The chips are a reading of the controls, so they have to be in the controls' order — a
    // summary that lists them the other way round makes the reader match them up by name.
    it('orders the chips the way the open card orders the controls', () => {
      const summary = collapsed({ filters: { twoColor: true, minContrast: 80, minMatch: 92 } })
      const text = summary.textContent ?? ''
      expect(text.indexOf('≥ 92%')).toBeGreaterThan(-1)
      expect(text.indexOf('≥ 92%')).toBeLessThan(text.indexOf('≥ 80'))
    })

    it('leaves the match chip off at zero, where it constrains nothing', () => {
      const summary = collapsed({ filters: { twoColor: true, minContrast: 80, minMatch: 0 } })
      expect(summary.textContent).not.toMatch(/match/i)
    })

    // The chips are taller than the title, and they come and go with the state, so without a
    // floor on the row the title was re-centred against a different height each way and visibly
    // moved on every toggle. The floor clears the chips, so the row is one height in both states.
    it('holds the header at one height so the title does not move when toggled', async () => {
      collapsed()
      const header = document.querySelector('[data-slot="card-header"]')
      expect(header?.className).toMatch(/min-h-8/)
      // The chips live in that row rather than in a strip of their own, which is why its height
      // depended on them at all.
      expect(header?.querySelector('[data-slot="filter-summary"]')).not.toBeNull()

      await userEvent.click(trigger())
      expect(document.querySelector('[data-slot="card-header"]')?.className).toMatch(/min-h-8/)
    })

    // Open, every chip restates a control that is on screen a few pixels below it.
    it('drops the whole summary once the card is open', async () => {
      collapsed()
      await userEvent.click(trigger())
      expect(document.querySelector('[data-slot="filter-summary"]')).toBeNull()
    })

    // Defensively live: the chips render from the props on every pass rather than from anything
    // captured when the card closed, so a filter changed elsewhere is reflected while it is shut.
    it('re-reads the chips from current state rather than from when it closed', () => {
      const props = {
        mouths: ALL_MOUTH_NAMES,
        filters: DEFAULT_FACE_FILTERS,
        mining: true,
        onMouthsChange: vi.fn(),
        onFiltersChange: vi.fn(),
      }
      const { rerender } = render(<FaceSection {...props} />)
      rerender(
        <FaceSection
          {...props}
          mouths={['smile']}
          filters={{ twoColor: false, minContrast: 200, minMatch: 0 }}
        />,
      )

      const summary = document.querySelector('[data-slot="filter-summary"]')
      expect(summary?.textContent).toContain('smile')
      expect(summary?.textContent).toContain('≥ 200')
      expect(summary?.textContent).not.toMatch(/two colours/i)
    })
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
    const props = renderSection({ filters: { twoColor: true, minContrast: 150, minMatch: 0 } })
    const slider = screen.getByRole('slider', { name: /minimum contrast/i })
    slider.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(props.onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ minContrast: 151 }),
    )
  })
})
