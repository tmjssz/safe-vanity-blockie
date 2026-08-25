import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppTitle, StartOverProvider } from '../components/AppTitle'
import { MINING_STATUS_BAR_SLOT_ID } from '../components/MiningStatusBar'
import { MiningView } from '../components/MiningView'
import { DEFAULT_FACE_FILTERS } from '../lib/config'

const CONFIG = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }
const FACE_SPEC = { name: 'x', fixed: [], regions: [] }

// Stable reference — the real useSafeConstants hook holds `data` in useState and returns the
// same object across re-renders once loaded, so a stub that built a new literal per call would
// misrepresent it (and mask the exact restart-loop bug this suite guards against).
//
// MiningView no longer keys its restart on that object's identity but on the three constants
// inside it, so that a chain switch — which re-reads and comes back equal in value as a NEW
// object — does not restart the run. That is a different test's job precisely because this stub
// cannot express it: see MiningView.chain-switch.test.tsx, which drives the real hook.
const STABLE_CONSTANTS_DATA = {
  constantsHex: { initializerHash: '0x1', factory: '0x2', initCodeHash: '0x3' },
}

const IDLE_STATE = {
  running: false,
  scanned: 0,
  elapsedMs: 0,
  rate: 0,
  candidates: [],
  droppedCount: 0,
  nextStart: 0,
}

const CANDIDATE = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

// Each result card is one button, named after the result it opens ("Deploy 90.2% match 0x70e9…").
const resultCards = () => screen.getAllByRole('button', { name: /deploy .* match/i })

// Counting identicon draws is how "this card did not re-render" is observable from outside — see
// ResultsGrid.test.tsx. Used here to prove the callback this component hands the grid survives a
// publish, which is the invariant ResultCard's memo is worth anything under.
const { bloSvgSpy } = vi.hoisted(() => ({ bloSvgSpy: vi.fn() }))

vi.mock('@safe-vanity-blockie/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@safe-vanity-blockie/core')>()
  return {
    ...actual,
    bloSvg: (address: string, size: number) => {
      bloSvgSpy(address, size)
      return actual.bloSvg(address, size)
    },
  }
})

const {
  constantsState,
  minerState,
  startSpy,
  stopSpy,
  setFiltersSpy,
  setSortSpy,
  toastErrorSpy,
  reloadSpy,
} = vi.hoisted(() => ({
  constantsState: {
    current: { loading: true } as { data?: unknown; error?: string; loading: boolean },
  },
  minerState: { current: {} as Record<string, unknown> },
  startSpy: vi.fn(),
  stopSpy: vi.fn(),
  setFiltersSpy: vi.fn(),
  setSortSpy: vi.fn(),
  toastErrorSpy: vi.fn(),
  reloadSpy: vi.fn(),
}))

// `reload` is part of the hook's contract, not part of what a test sets up: every state it can
// return carries one, so it is spread in here rather than repeated in each `constantsState`.
vi.mock('../lib/use-safe-constants.js', () => ({
  useSafeConstants: () => ({ reload: reloadSpy, ...constantsState.current }),
}))

vi.mock('../lib/use-miner.js', () => ({
  useMiner: () => ({
    state: minerState.current,
    start: startSpy,
    stop: stopSpy,
    setFilters: setFiltersSpy,
    setSort: setSortSpy,
  }),
}))

// A worker failure must reach the toast layer as well as the inline alert (see the test below) —
// the alert is what the brief requires to stay put, the toast is the extra, timed feedback.
vi.mock('sonner', () => ({
  toast: { error: toastErrorSpy, success: vi.fn() },
}))

beforeEach(() => {
  constantsState.current = { loading: true }
  minerState.current = IDLE_STATE
  bloSvgSpy.mockClear()
  startSpy.mockClear()
  toastErrorSpy.mockClear()
  stopSpy.mockClear()
  setFiltersSpy.mockClear()
  setSortSpy.mockClear()
  reloadSpy.mockClear()
})

/** The page's slot for the portaled status bar, mounted so a test can ask whether the bar exists. */
function mountStatusBarSlot(): HTMLElement {
  const slot = document.createElement('div')
  slot.id = MINING_STATUS_BAR_SLOT_ID
  document.body.append(slot)
  return slot
}

// RTL's cleanup only unmounts what it rendered; the portal slot is appended to the body by hand.
afterEach(() => {
  document.getElementById(MINING_STATUS_BAR_SLOT_ID)?.remove()
})

describe('MiningView', () => {
  // Placeholders stand in for the whole screen before the constants land, and mining has not been
  // asked to start: the two facts together are what this state is. There is deliberately no prose
  // — see the test further down for why the "Reading Safe constants…" line is gone.
  it('waits for the Safe constants before mining, showing placeholders meanwhile', () => {
    const { container } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(container.querySelectorAll('[data-testid="result-skeleton"]')).toHaveLength(4)
    expect(startSpy).not.toHaveBeenCalled()
  })

  describe('the sort control', () => {
    const sortTrigger = () => screen.getByRole('combobox', { name: /^sort results$/i })

    const renderWithResults = () => {
      constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
      minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }
      render(
        <MiningView
          config={CONFIG as never}
          faceSpec={FACE_SPEC as never}
          filters={DEFAULT_FACE_FILTERS}
          onPauseToggle={vi.fn()}
          onStartOver={vi.fn()}
          onSelect={vi.fn()}
        />,
      )
    }

    // Best match is what the leaderboard is for: the run exists to find the closest face, and any
    // other default would hide that behind an ordering nobody asked for.
    it('starts on best match', () => {
      renderWithResults()
      expect(sortTrigger().textContent).toMatch(/best match/i)
      // Pushed on mount as well as on a change, so the hook and the control cannot disagree about
      // what is on screen.
      expect(setSortSpy).toHaveBeenCalledWith('best')
    })

    // "Best match" on its own, beside a heading, reads as a status rather than as a control, so a
    // glyph marks it as an order being chosen. It replaced the words "Sort:" — the only text on a
    // crowded row that named a control instead of saying something — and it must not inherit the
    // job of naming it: the accessible name comes from the trigger, and the mark stays decorative.
    it('marks the sort with an icon and leaves the naming to the trigger', () => {
      renderWithResults()
      const mark = document.querySelector('[data-slot="results-sort-icon"]')
      expect(mark).not.toBeNull()
      expect(mark?.getAttribute('aria-hidden')).toBe('true')
      expect(screen.queryByText('Sort:')).toBeNull()
      expect(sortTrigger().getAttribute('aria-label')).toBe('Sort results')
    })

    it('offers the three orders and nothing else', async () => {
      const user = userEvent.setup()
      renderWithResults()
      await user.click(sortTrigger())

      const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
      expect(options).toEqual(['Best match', 'Newest', 'Contrast'])
    })

    // Ordering is the miner's to apply — it holds the arrival numbers, and re-ordering there costs
    // no mining progress — so this control's whole job is to say which one.
    it('asks the miner to re-order, rather than sorting the grid itself', async () => {
      const user = userEvent.setup()
      renderWithResults()

      await user.click(sortTrigger())
      await user.click(await screen.findByRole('option', { name: /contrast/i }))

      expect(setSortSpy).toHaveBeenLastCalledWith('contrast')
      expect(sortTrigger().textContent).toMatch(/contrast/i)
      // Nothing about the run changes: it is a display order, not a search.
      expect(startSpy).toHaveBeenCalledTimes(1)
      expect(stopSpy).not.toHaveBeenCalled()
    })

    it('sits in the heading row beside the CLI handoff, not above the grid', () => {
      renderWithResults()
      const row = sortTrigger().closest('div')?.parentElement
      expect(row?.textContent).toMatch(/results/i)
      expect(row?.querySelector('[data-testid="results-grid"]')).toBeNull()
      expect(row?.contains(screen.getByRole('button', { name: /run on your machine/i }))).toBe(true)
    })

    // A control that reorders nothing is furniture to be read past, and this row already carries
    // a heading, a count badge and the CLI handoff.
    it('stays away until there is something to order', () => {
      constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
      minerState.current = { ...IDLE_STATE, running: true, candidates: [] }
      render(
        <MiningView
          config={CONFIG as never}
          faceSpec={FACE_SPEC as never}
          filters={DEFAULT_FACE_FILTERS}
          onPauseToggle={vi.fn()}
          onStartOver={vi.fn()}
          onSelect={vi.fn()}
        />,
      )
      expect(screen.queryByRole('combobox', { name: /^sort results$/i })).toBeNull()
    })
  })

  // The page owns the deploy; the grid owns the picture. This is the wire between them, and a tile
  // that does not know it is being deployed is a wall of two hundred identical-looking results with
  // gas being spent on one of them.
  it('marks the tile whose result the page says is deploying', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }

    const { container } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        deployingAddress={CANDIDATE.address}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.getByRole('button', { name: /view the deploy in progress/i })).toBeDefined()
  })

  it('renders one ResultCard per candidate and shows the scanned count once loaded', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, scanned: 4200, candidates: [CANDIDATE] }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(resultCards()).toHaveLength(1)
    expect(
      document.querySelector('[data-slot="stat-scanned"] [aria-hidden="true"]')?.textContent,
    ).toBe('4.2K checked')
  })

  // The grid shows everything retained and scrolls, so the number handed to the miner is a
  // retention size only. A display count riding on it would multiply into the leaderboard's size
  // (it used to be keep x 20) the moment anyone asked to see more results.
  it('asks the miner to retain a deep pool, with no display count riding on it', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ retain: 200 }))
    expect(startSpy.mock.calls[0][0]).not.toHaveProperty('keep')
  })

  it('shows every result it is given rather than a top-eight slice', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = {
      ...IDLE_STATE,
      running: true,
      candidates: Array.from({ length: 24 }, (_, index) => ({
        ...CANDIDATE,
        address: `0x${index.toString(16).padStart(40, '0')}`,
      })),
    }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(resultCards()).toHaveLength(24)
  })

  // The wiring hop the grid cannot test for itself: without `filters` and `bestContrast` reaching
  // it, the empty state cannot name what is excluding things or how close the search came.
  it('hands the grid what its empty state needs to explain itself', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = {
      ...IDLE_STATE,
      running: true,
      candidates: [],
      droppedCount: 162,
      bestContrast: 143,
    }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: true, minContrast: 300, minMatch: 0 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    // The whole panel, not the live region inside it: that region carries the stable headline
    // only, so the numbers do not queue an announcement each time they change.
    const message = screen.getByTestId('no-matches').textContent ?? ''
    expect(message).toMatch(/no result matches/i)
    expect(message).toMatch(/162/)
    expect(message).toMatch(/300/)
    expect(message).toMatch(/143/)
  })

  // The other half of that wiring: the panel's action belongs to the page, which owns the filter
  // card it reveals. This component only carries the handler down, and the button must not appear
  // at all when there is nothing to carry.
  it('passes the empty state\u2019s action through to the host, and omits it without one', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [], droppedCount: 162 }
    const onAdjustFilters = vi.fn()

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: true, minContrast: 300, minMatch: 0 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onAdjustFilters={onAdjustFilters}
        onSelect={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /adjust filters/i }))
    expect(onAdjustFilters).toHaveBeenCalledOnce()

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: true, minContrast: 300, minMatch: 0 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /adjust filters/i })).toBeNull()
  })

  // The bar used to read the head of the *displayed* list. Once the filters can empty that list
  // (they no longer fall back to showing everything), the bar answered a filter change with "No
  // candidates yet" two rows above an empty state explaining that 162 candidates had been found —
  // re-asserting the exact misreading the empty state exists to correct, and taking the only live
  // signal of search quality with it. It reads the unfiltered board instead.
  it('keeps reporting the best result while the filters exclude every card', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = {
      ...IDLE_STATE,
      running: true,
      candidates: [],
      droppedCount: 162,
      bestOverall: CANDIDATE,
      bestContrast: 143,
    }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: true, minContrast: 300, minMatch: 0 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.getByText(/best result/i)).toBeDefined()
    expect(screen.queryByText(/no candidates yet/i)).toBeNull()
  })

  // The filtered-out count is gone from above the grid; what replaces it is a count of what is
  // actually on screen, next to the heading, so it can be checked against the cards by eye. Just
  // the number — the heading it sits on already says what is being counted.
  it('badges the Results heading with the number of cards shown, and drops the filtered-out line', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = {
      ...IDLE_STATE,
      running: true,
      candidates: Array.from({ length: 3 }, (_, index) => ({
        ...CANDIDATE,
        address: `0x${index.toString(16).padStart(40, '0')}`,
      })),
      droppedCount: 197,
      bestOverall: CANDIDATE,
    }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const heading = screen.getByRole('heading', { name: /^results$/i })
    const badge = screen.getByTestId('results-count')
    // On the heading, not floating somewhere above the grid.
    expect(heading.parentElement?.contains(badge)).toBe(true)
    expect(badge.textContent).toBe(`${resultCards().length} results shown`)
    expect(screen.queryByText(/filtered out/i)).toBeNull()
  })

  // The badge's whole claim is that it counts what is on screen. In the opening seconds of a run
  // the grid holds four skeleton placeholders, so a bare "0" is the one moment that claim is false —
  // and counting the placeholders instead would be worse, since they are not results. There is
  // simply nothing to count yet, so the badge waits.
  it('does not count placeholders: no badge until there is something real to count', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [], droppedCount: 0 }

    const { container } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('[data-testid="result-skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('results-count')).toBeNull()
  })

  // The heading and the placeholders, and the prose that used to be here is gone: "Reading Safe
  // constants…" named an internal RPC read that means nothing to the person waiting and that they
  // cannot act on either way. What is left says the only thing worth saying — results are coming,
  // and here is where they will land. "No results yet." must not appear either; that is a finished
  // search that found nothing, over a run that has not begun.
  //
  // The heading titles the part of the page rather than the run, so it is there from the first
  // frame: without it the tiles sat unlabelled and the title dropped in above them the moment
  // mining began, pushing the grid down. Its badge stays away until there is something to count.
  it('heads the placeholders while the Safe constants are read, with no prose and no badge', () => {
    constantsState.current = { loading: true }
    minerState.current = { ...IDLE_STATE, running: false }

    const { container } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('[data-testid="result-skeleton"]')).toHaveLength(4)
    expect(screen.queryByText(/reading safe/i)).toBeNull()
    expect(screen.queryByText(/no results yet/i)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: /^results$/i })).toBeDefined()
    // The badge would be claiming to count four visible boxes that are not results.
    expect(screen.queryByTestId('results-count')).toBeNull()
    // And no sort: a control that reorders nothing is furniture to be read past.
    expect(screen.queryByRole('combobox', { name: /^sort results$/i })).toBeNull()
  })

  // The exception: nothing found *yet* is not the same as nothing surviving the filters. There the
  // grid has no cards on purpose, the zero is the point, and it agrees with the empty state.
  it('keeps the badge at zero when the filters exclude everything, agreeing with the empty state', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = {
      ...IDLE_STATE,
      running: true,
      candidates: [],
      droppedCount: 162,
      bestOverall: CANDIDATE,
    }

    const { container } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: true, minContrast: 300, minMatch: 0 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByTestId('results-count').textContent).toBe('0 results shown')
    expect(container.querySelectorAll('[data-testid="result-skeleton"]')).toHaveLength(0)
    expect(screen.getByTestId('no-matches').textContent).toMatch(/no result matches/i)
  })

  // The header title is the second door back to the Configure card, and this component is what
  // makes it one: it owns both the count the confirmation names and the reset it calls. Registered
  // for exactly as long as a run is on screen — so the title is a control during a run and plain
  // text either side of it — which is asserted in AppTitle's own suite.
  it('puts the run in reach of the header title, count and all', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }
    const onStartOver = vi.fn()

    render(
      <StartOverProvider>
        <AppTitle />
        <MiningView
          config={CONFIG as never}
          faceSpec={FACE_SPEC as never}
          filters={DEFAULT_FACE_FILTERS}
          onPauseToggle={vi.fn()}
          onStartOver={onStartOver}
          onSelect={vi.fn()}
        />
      </StartOverProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Safe Vanity Blockie' }))
    expect(screen.getByText(/discard 1 result and start over\?/i)).toBeDefined()

    await userEvent.click(await screen.findByRole('button', { name: /^discard and start over$/i }))
    expect(onStartOver).toHaveBeenCalledTimes(1)
  })

  // ResultCard's memo is what keeps a 200-card grid usable across several publishes a second, and
  // it is worth nothing unless the callback threaded down to it is the same function every time.
  // A refactor to `onSelect={(candidate) => onSelect(candidate)}` anywhere on that path would
  // leave every test green while turning the memo into 200 wasted comparisons per publish.
  it('hands the grid a callback that survives a publish, which is what the card memo rides on', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }
    const onSelect = vi.fn()

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={onSelect}
      />,
    )
    const drawn = bloSvgSpy.mock.calls.length
    expect(drawn).toBeGreaterThan(0)

    // A publish: a new state object and a new candidates array holding the same candidate object,
    // exactly what useMiner produces when the board did not change.
    minerState.current = {
      ...IDLE_STATE,
      running: true,
      scanned: 5_000,
      candidates: [CANDIDATE],
    }
    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={onSelect}
      />,
    )

    expect(
      document.querySelector('[data-slot="stat-scanned"] [aria-hidden="true"]')?.textContent,
    ).toBe('5.0K checked')
    expect(bloSvgSpy.mock.calls.length).toBe(drawn)
  })

  it('calls start with the twoColor and minContrast values from the filters prop, not hardcoded ones', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: false, minContrast: 250, minMatch: 0 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ twoColor: false, minContrast: 250, minMatch: 0 }),
    )
  })

  it('re-filters via setFilters when only the filters prop changes, without restarting the run', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).toHaveBeenCalledTimes(1)

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: false, minContrast: 300, minMatch: 0 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(setFiltersSpy).toHaveBeenCalledWith({ twoColor: false, minContrast: 300, minMatch: 0 })
    expect(startSpy).toHaveBeenCalledTimes(1)
  })

  // The match floor is the third of the three display filters, and it must behave like the other
  // two: a change to it re-reads the board rather than throwing the run away.
  it('re-filters rather than restarting when only the match floor changes', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).toHaveBeenCalledTimes(1)

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ ...DEFAULT_FACE_FILTERS, minMatch: 92 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(setFiltersSpy).toHaveBeenCalledWith(
      expect.objectContaining({ minMatch: 92, minContrast: DEFAULT_FACE_FILTERS.minContrast }),
    )
    expect(startSpy).toHaveBeenCalledTimes(1)
  })

  it('does not start mining when rendered paused, even once constants are ready', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(startSpy).not.toHaveBeenCalled()
  })

  it('stops a running mine when paused flips true, without unmounting or losing the leaderboard', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).toHaveBeenCalledTimes(1)

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(stopSpy).toHaveBeenCalled()
    expect(startSpy).toHaveBeenCalledTimes(1)
    // The row is still there — pausing stops mining, it does not hide the leaderboard.
    expect(resultCards()).toHaveLength(1)
  })

  it('resumes mining when paused flips back to false', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).not.toHaveBeenCalled()

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(startSpy).toHaveBeenCalledTimes(1)
  })

  it('shows an alert and does not start mining when constants fail to load', () => {
    constantsState.current = { loading: false, error: 'RPC blew up' }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toMatch(/RPC blew up/)
    expect(startSpy).not.toHaveBeenCalled()
  })

  // The chain picker moved into the header, so the config can change — and the constants be
  // re-read — under a LIVE search, against unauthenticated public RPCs where a rate-limited read
  // is an ordinary event. Replacing the screen then says the search is gone while the run is in
  // fact completely intact (leaderboard, cumulative totals and resume point are all still in
  // useMiner), and the obvious response to that screen is the reload that really does lose it.
  it('keeps a live run on screen when the constants read fails, and reports it inline', () => {
    const slot = mountStatusBarSlot()
    constantsState.current = { loading: false, error: 'HTTP 429: rate limited' }
    minerState.current = { ...IDLE_STATE, scanned: 4200, candidates: [CANDIDATE] }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    // Everything the user would have lost is still exactly where it was: the status bar with its
    // scanned count, and every card on the leaderboard.
    expect(slot.querySelector('[data-slot="stat-scanned"] [aria-hidden="true"]')?.textContent).toBe(
      '4.2K checked',
    )
    expect(resultCards()).toHaveLength(1)

    // …and the failure is reported among them rather than in place of them — saying what stopped,
    // what did not, and offering the way back.
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/HTTP 429: rate limited/)
    expect(alert.textContent).toMatch(/every result below is still here/i)
    expect(screen.getByRole('button', { name: /try again/i })).toBeDefined()
    // The run is not mined on while the constants behind it are unknown.
    expect(startSpy).not.toHaveBeenCalled()
  })

  // The other half of the same rule, kept deliberately: a run that has reported nothing has
  // nothing on screen to protect, so the failure is still allowed to be the whole view.
  it('still replaces the whole view with the error when no run has reported anything yet', () => {
    const slot = mountStatusBarSlot()
    constantsState.current = { loading: false, error: 'RPC blew up' }
    minerState.current = IDLE_STATE

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toMatch(/RPC blew up/)
    // Nothing else at all: no status bar in the page's slot, no Results section, no grid.
    expect(slot.children).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: /^results$/i })).toBeNull()
    // Was `queryByText(/nonces/i)`, which passed either way once the exact figure moved into a
    // `title` attribute that text queries do not search: a status bar rendered here would not
    // have failed it. `data-slot` names the element the bar would leave behind directly.
    expect(document.querySelector('[data-slot="stat-scanned"]')).toBeNull()
  })

  it('asks for the constants again when the retry beside a live run is pressed', async () => {
    mountStatusBarSlot()
    constantsState.current = { loading: false, error: 'HTTP 429: rate limited' }
    minerState.current = { ...IDLE_STATE, scanned: 4200, candidates: [CANDIDATE] }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    // The hook's own reload, which re-reads for the same config — the run is never restarted and
    // nothing on screen is thrown away to ask again.
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(resultCards()).toHaveLength(1)
  })

  it('toasts a worker failure in addition to (not instead of) the inline alert', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, error: 'Worker failed to start: boom' }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(toastErrorSpy).toHaveBeenCalledWith('Worker failed to start: boom')
    // The toast is additive: the alert this same error produces (MiningView.tsx) must still be
    // on screen, since a toast alone would disappear before the user can act on it.
    expect(screen.getByRole('alert').textContent).toMatch(/worker failed to start: boom/i)
  })

  it('portals the status bar into the page slot when one is mounted', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, scanned: 4200 }
    // The page renders this element at the very top of the layout; the bar has to end up inside
    // it, not inline in the middle of the results section, or it stops being the thing that stays
    // in view during a long search.
    const slot = document.createElement('div')
    slot.id = MINING_STATUS_BAR_SLOT_ID
    document.body.append(slot)

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const scanned = document.querySelector('[data-slot="stat-scanned"]')
    expect(scanned).not.toBeNull()
    expect(slot.contains(scanned)).toBe(true)
    // The bar's own root is a direct child of the slot — nothing of MiningView's own markup is
    // hoisted along with it.
    expect(slot.children).toHaveLength(1)
  })

  it('renders the status bar in place when no slot is mounted', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, scanned: 4200 }

    const { container } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(container.contains(document.querySelector('[data-slot="stat-scanned"]'))).toBe(true)
  })

  // What this component still owns after the pause state moved to the page: obeying `paused`, and
  // reporting the press. The decision of what a press MEANS while the host is also pausing is no
  // longer here — it is asserted in test/page.test.tsx, where the flag now lives, because the
  // Configure card offers the same action and both have to reach the same state.
  it('stops and resumes the same run as `paused` moves', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, scanned: 4200 }

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).not.toHaveBeenCalled()

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).toHaveBeenCalledTimes(1)

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(stopSpy).toHaveBeenCalled()
  })

  it('reports a press of the bar control instead of deciding for itself', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, scanned: 4200 }
    const onPauseToggle = vi.fn()

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={onPauseToggle}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /pause/i }))

    expect(onPauseToggle).toHaveBeenCalledOnce()
    // It does not pause itself: the flag is the page's, and a component that also stopped locally
    // would be a second source of truth for the state the Configure card reads.
    expect(stopSpy).not.toHaveBeenCalled()
  })

  // Clicking a card is the whole deploy flow now, so the hop from this component's `onSelect`
  // out to the page is what opens the dialog — a card wired to nothing is a dead page.
  // An alternative to the search that is running, so it belongs beside the thing it is an
  // alternative to rather than as a row of its own between the heading and the grid.
  it('puts the CLI handoff in the Results heading row', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, scanned: 4200, candidates: [CANDIDATE] }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const row = screen.getByRole('heading', { level: 2, name: /^results$/i }).parentElement!
    const handoff = screen.getByRole('button', { name: /run on your machine/i })
    expect(row.contains(handoff)).toBe(true)
    // Pushed to the right end of that row, away from the heading and its count.
    expect(handoff.parentElement?.className ?? handoff.className).toMatch(/ml-auto/)
  })

  it('reports the clicked candidate to its host', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }
    const onSelect = vi.fn()

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={onSelect}
      />,
    )

    await userEvent.click(resultCards()[0])
    expect(onSelect).toHaveBeenCalledWith(CANDIDATE)
  })

  // The handoff is an alternative to the search that is running, so it belongs where it can be
  // read before scrolling through eight results — not stranded under them. Asserted on document
  // order rather than on markup, so it survives any amount of restyling.
  it('offers the CLI handoff above the results, not below them', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const handoff = screen.getByRole('button', { name: /run on your machine/i })
    const position = handoff.compareDocumentPosition(resultCards()[0])
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // T5. `filters` is optional on CliHandoff and the command builder omits the flags entirely
  // without it, so deleting the prop here typechecks and every test stays green — while the
  // copied `npx` command silently reverts to CLI defaults and the native run enforces a different
  // standard from the one on screen. CliHandoff.test.tsx covers the component in isolation; this
  // covers the wiring hop.
  it('hands the live filters to the CLI command, not the CLI defaults', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: false, minContrast: 300, minMatch: 0 }}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const command = screen.getByText(/npx safe-vanity-blockie/)
    expect(command.textContent).toContain('--no-two-color')
    expect(command.textContent).toContain('--min-contrast 300')
    // The same hop for the accepted expressions, which the command left out entirely: without
    // `--target` the native run searches all five faces whatever this run was narrowed to. The
    // run's own FaceSpec name IS the target (see lib/face-selection), so this is the wiring.
    expect(command.textContent).toContain(`--target ${FACE_SPEC.name}`)
  })

  // The same number the Checkpoint chip shows, in the command the handoff dialog hands over.
  // Without this, deleting the `resume` prop typechecks and every other test stays green while
  // the copied command quietly restarts the search from zero, which is the one thing this
  // dialog promises not to do.
  it('injects the checkpoint this run has reached into the handoff command', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = {
      ...IDLE_STATE,
      running: true,
      scanned: 4_200_000,
      nextStart: 41_200_000_000,
    }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const command = screen.getByText(/npx safe-vanity-blockie/)
    // Bare digits, the way the CLI's Number parse needs them, and the way the chip's copy
    // button puts them on the clipboard.
    expect(command.textContent).toContain('--start 41200000000')
    expect(command.textContent).not.toContain('41,200,000,000')
  })

  // The whole point of the link: the checkpoint panel names the handoff as the thing that writes
  // out both halves of a resume, and the two live in different parts of the tree. This is the
  // only test that crosses that gap.
  it('opens the handoff dialog from the checkpoint panel on the bar', async () => {
    const user = userEvent.setup()
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: false, scanned: 4_200_000, nextStart: 8_400_000 }
    mountStatusBarSlot()

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /checkpoint/i }))
    // Scoped to the panel on purpose: the handoff's OWN trigger is further down this same page,
    // so an unscoped query finds that one and proves nothing about the link.
    const panel = (await screen.findByText('8,400,000')).closest('[data-slot="popover-content"]')
    if (!panel) throw new Error('no checkpoint panel on screen')
    await user.click(
      within(panel as HTMLElement).getByRole('button', { name: /run on your machine/i }),
    )

    expect(screen.getByRole('dialog').textContent).toMatch(/npx safe-vanity-blockie/)
  })

  // Nothing scanned means `nextStartFrom` has only handed out blocks, so there is no checkpoint
  // to carry over. The chip is hidden in exactly the same case, for the same reason.
  it('leaves the checkpoint out of the command before anything has been scanned', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, scanned: 0, nextStart: 41_200_000_000 }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /run on your machine/i }))

    const command = screen.getByText(/npx safe-vanity-blockie/)
    expect(command.textContent).not.toContain('--start')
  })

  it('does not toast when there is no worker error', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = IDLE_STATE

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onPauseToggle={vi.fn()}
        onStartOver={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(toastErrorSpy).not.toHaveBeenCalled()
  })
})
