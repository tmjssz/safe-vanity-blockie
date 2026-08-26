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
    // `mining: true` because the scenario this test's comment describes ("while mining") is a run
    // in progress — the only case `FaceSection` is actually mounted for today (see page.tsx). The
    // picker's restart question below is gated on that, since Task 6 taught it not to ask when
    // there is no run. That also starts the card collapsed, so it is opened by hand before the
    // controls inside it are reached.
    const props = renderSection({ mining: true })
    await user.click(trigger())

    await user.click(screen.getByRole('switch', { name: /two colours only/i }))
    expect(props.onFiltersChange).toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox', { name: /neutral/i }))
    expect(props.onMouthsChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    await user.click(await screen.findByRole('button', { name: /restart the search/i }))
    expect(props.onMouthsChange).toHaveBeenCalledWith(['smile', 'frown', 'neutral'])
  })

  // Three arrival states have to be told apart now that this card lives inside Configure's
  // Advanced disclosure as well as on the results page: a resume link that named filters wants it
  // open (they decide what gets mined and nobody has seen them), a link that named only a
  // checkpoint wants Advanced open but this shut (there is nothing carried to look at), and an
  // ordinary visit wants both shut. `mining` cannot express that — it is one bit about whether a
  // run exists — so the initial state is the caller's to state outright when it knows.
  describe('defaultOpen', () => {
    it('starts open or shut as the caller says, whatever `mining` would have defaulted to', () => {
      const { unmount } = render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          defaultOpen={false}
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )
      // No `mining`, so `!mining` would have opened it. The caller said otherwise.
      expect(trigger().getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByRole('checkbox')).toBeNull()
      unmount()

      render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          mining
          defaultOpen
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )
      expect(trigger().getAttribute('aria-expanded')).toBe('true')
    })

    // Omitted, nothing changes: `mining` still supplies the default, which is what keeps the
    // results page's call site exactly as it was.
    it('falls back to `mining` when the caller does not say', () => {
      render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )
      expect(trigger().getAttribute('aria-expanded')).toBe('true')
    })

    // The header still wins. `defaultOpen` names where the card STARTS; it is not a standing
    // instruction that re-closes a card the reader has deliberately opened.
    it('is only a starting point, not something the header has to fight', async () => {
      const user = userEvent.setup()
      render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          defaultOpen={false}
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      await user.click(trigger())
      expect(trigger().getAttribute('aria-expanded')).toBe('true')
      expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    })
  })

  // Nested on Configure's start screen it sits inside another Card, where its own border and
  // shadow read as clutter rather than structure. The host says so, rather than this component
  // guessing from a prop about where it is.
  it('lets the host restyle the card it draws', () => {
    const { container } = render(
      <FaceSection
        mouths={['smile']}
        filters={DEFAULT_FACE_FILTERS}
        className="border-0 shadow-none"
        onMouthsChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    )
    const card = container.querySelector('[data-slot="card"]') as HTMLElement
    expect(card.className).toContain('border-0')
    expect(card.className).toContain('shadow-none')
  })

  // On Configure's start screen this sits a row above the Advanced disclosure, and the two are the
  // same kind of thing: a quiet line you press to see more. Drawn as a card header it shouted next
  // to Advanced's muted text — a semibold heading, its own icon, and a chevron pushed to the far
  // side of the row — so `quiet` renders it in Advanced's voice instead.
  describe('quiet', () => {
    it('puts the chevron before the label rather than across the row', () => {
      const { container } = render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          quiet
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      const chevron = container.querySelector('[data-slot="filter-chevron"]') as SVGElement
      const title = container.querySelector('#filter-card-title') as HTMLElement
      // `getAttribute`, not `.className`: on an SVG element that property is an
      // SVGAnimatedString rather than a string, and `toContain` against it passes for anything —
      // which is a test that cannot fail. The control test below is what caught it.
      expect(chevron.getAttribute('class')).not.toContain('ml-auto')
      // DOCUMENT_POSITION_FOLLOWING: the chevron comes first in the row.
      expect(chevron.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('drops the second icon, so the row carries one glyph as Advanced does', () => {
      const { container } = render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          quiet
          defaultOpen={false}
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      // Direct children of the row only. Counting every svg in the tree would also count the
      // expressions chip's own Smile — which belongs to the value, not to the header chrome, and
      // stays exactly where it is — and the panel's icons once the card is open. What this pins is
      // that the row itself carries one glyph, the chevron, as Advanced's trigger does.
      const row = container.querySelector('[data-slot="card-header"]') as HTMLElement
      const rowGlyphs = [...row.children].filter((child) => child.tagName.toLowerCase() === 'svg')
      expect(rowGlyphs).toHaveLength(1)
      expect(rowGlyphs[0].getAttribute('data-slot')).toBe('filter-chevron')
    })

    // The heading is load-bearing however it is drawn: the trigger takes its accessible name from
    // it (`aria-labelledby`), and FacePicker's own <h3> hangs off it. Restyling must not cost that.
    it('keeps the heading a heading, and the trigger named by it', () => {
      render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          quiet
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      const title = screen.getByRole('heading', { name: /^filter$/i })
      expect(title.id).toBe('filter-card-title')
      expect(trigger().getAttribute('aria-labelledby')).toBe('filter-card-title')
    })

    // The values stay in the row with the label — that is the whole point of collapsing to one
    // line. `summarise` already omits anything sitting at a permissive value, so at the defaults
    // this is three chips and a `min match` of 0 says nothing at all.
    it('keeps the collapsed values on the label’s own row', () => {
      const { container } = render(
        <FaceSection
          mouths={['smile', 'open']}
          filters={{ twoColor: true, minContrast: 80, minMatch: 0 }}
          quiet
          defaultOpen={false}
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      const row = container.querySelector('[data-slot="card-header"]') as HTMLElement
      const summary = container.querySelector('[data-slot="filter-summary"]') as HTMLElement
      expect(row.contains(summary)).toBe(true)
      expect(summary.textContent).toContain('smile, open')
      expect(summary.textContent).toContain('two colours')
      expect(summary.textContent).toContain('80')
      // Permissive, so silent — not "≥ 0%".
      expect(summary.textContent).not.toContain('%')
    })

    // Advanced's label is a Button, whose base carries `text-sm font-medium`. Matching the size
    // and leaving the weight behind is a near-match, which reads as a mistake rather than as a
    // pair — the two labels sit one row apart.
    it('matches the Advanced label’s weight, not just its size', () => {
      const { container } = render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          quiet
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      const title = container.querySelector('#filter-card-title') as HTMLElement
      expect(title.className).toContain('text-sm')
      expect(title.className).toContain('font-medium')
      // CardTitle's own `font-semibold` must have lost, not merely been joined.
      expect(title.className).not.toContain('font-semibold')
    })

    // Advanced's chevron carries no colour of its own, so it inherits the trigger's and lifts with
    // the label on hover. This one is coloured explicitly, so it needs to be told.
    it('lifts its chevron on hover, as Advanced’s does', () => {
      const { container } = render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          quiet
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      const chevron = container.querySelector('[data-slot="filter-chevron"]') as SVGElement
      const cls = chevron.getAttribute('class') as string
      expect(cls).toContain('group-hover/filter:text-foreground')
      // Colour has to be among the transitioned properties, and it cannot simply be
      // `transition-colors`: this glyph also rotates, so a transition naming only colour would
      // trade a snap on hover for a snap on open.
      expect(cls).toMatch(/transition-\[[^\]]*color/)
      expect(cls).toMatch(/transition-\[[^\]]*transform/)
    })

    it('takes the vertical padding off the card so the row sits tight to its neighbours', () => {
      const { container } = render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          quiet
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      const card = container.querySelector('[data-slot="card"]') as HTMLElement
      expect(card.className).toContain('py-0')
    })

    // Omitted, the results page is untouched: its own heading, its own icon, chevron across the row.
    it('leaves the loud header alone when not asked for', () => {
      const { container } = render(
        <FaceSection
          mouths={['smile']}
          filters={DEFAULT_FACE_FILTERS}
          onMouthsChange={vi.fn()}
          onFiltersChange={vi.fn()}
        />,
      )

      const chevron = container.querySelector('[data-slot="filter-chevron"]') as SVGElement
      expect(chevron.getAttribute('class')).toContain('ml-auto')
      expect(container.querySelectorAll('svg').length).toBeGreaterThan(1)
    })
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

    // The empty state that asks for this card offers its button only while the card is collapsed —
    // a button that reveals something already on screen does nothing, and it sits directly under a
    // sentence naming filters the user can see. So the page has to know which state the card is
    // in, and only the card knows: `mining`, the reveal request and the header are three separate
    // ways it changes.
    it('reports whether it is open, from the first render onwards', async () => {
      const onOpenChange = vi.fn()
      const base = { ...props(), onOpenChange }
      const { rerender } = render(<FaceSection {...base} revealRequest={0} />)
      // Collapsed on arrival, because a run exists — said out loud rather than left to the page to
      // assume, which is what would go stale the moment any of the three ways changed it.
      expect(onOpenChange).toHaveBeenLastCalledWith(false)

      rerender(<FaceSection {...base} revealRequest={1} />)
      expect(onOpenChange).toHaveBeenLastCalledWith(true)

      await userEvent.click(trigger())
      expect(onOpenChange).toHaveBeenLastCalledWith(false)
    })

    // The other half of the same contract: with no run, the card mounts open, and a page that
    // assumed "collapsed until told otherwise" would offer a button for a card already showing.
    it('reports the open card it mounts as when there is no run', () => {
      const onOpenChange = vi.fn()
      render(<FaceSection {...props()} mining={false} onOpenChange={onOpenChange} />)
      expect(onOpenChange).toHaveBeenLastCalledWith(true)
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

  // The card is the only thing that knows whether a run exists — the page tells it, and it is what
  // decides whether the card starts collapsed. The picker inside it needs the same fact for a
  // different reason, and a picker left to assume would ask about a restart on the idle screen.
  it('tells the picker whether there is a run to restart', async () => {
    const user = userEvent.setup()
    const { onMouthsChange } = renderSection({ mouths: ['smile', 'frown'] })

    await user.click(screen.getByRole('checkbox', { name: /^neutral$/i }))

    // No `mining`, so no run: the click applied on the spot, with no question and no Apply to
    // press — staging exists to put a warning before a restart, and there is nothing to restart.
    expect(onMouthsChange).toHaveBeenCalledWith(['smile', 'frown', 'neutral'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull()
  })
})
