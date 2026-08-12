import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MINING_STATUS_BAR_SLOT_ID } from '../components/MiningStatusBar'
import { MiningView } from '../components/MiningView'
import { DEFAULT_FACE_FILTERS } from '../lib/config'

const CONFIG = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }
const FACE_SPEC = { name: 'x', fixed: [], regions: [] }

// Stable reference — the real useSafeConstants hook holds `data` in useState and returns the
// same object across re-renders once loaded, so a stub that built a new literal per call would
// misrepresent it (and mask the exact restart-loop bug this suite guards against).
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

const { constantsState, minerState, startSpy, stopSpy, setFiltersSpy, toastErrorSpy } = vi.hoisted(
  () => ({
    constantsState: {
      current: { loading: true } as { data?: unknown; error?: string; loading: boolean },
    },
    minerState: { current: {} as Record<string, unknown> },
    startSpy: vi.fn(),
    stopSpy: vi.fn(),
    setFiltersSpy: vi.fn(),
    toastErrorSpy: vi.fn(),
  }),
)

vi.mock('../lib/use-safe-constants.js', () => ({
  useSafeConstants: () => constantsState.current,
}))

vi.mock('../lib/use-miner.js', () => ({
  useMiner: () => ({
    state: minerState.current,
    start: startSpy,
    stop: stopSpy,
    setFilters: setFiltersSpy,
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
})

// RTL's cleanup only unmounts what it rendered; the portal slot is appended to the body by hand.
afterEach(() => {
  document.getElementById(MINING_STATUS_BAR_SLOT_ID)?.remove()
})

describe('MiningView', () => {
  it('explains that it is reading Safe constants before it can mine', () => {
    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/reading safe/i)).toBeDefined()
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('renders one ResultCard per candidate and shows the scanned count once loaded', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, scanned: 4200, candidates: [CANDIDATE] }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )

    expect(resultCards()).toHaveLength(1)
    expect(screen.getByText(/4,200/)).toBeDefined()
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
        filters={{ twoColor: true, minContrast: 300 }}
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
        filters={{ twoColor: true, minContrast: 300 }}
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
        onSelect={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('[data-testid="result-skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('results-count')).toBeNull()
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
        filters={{ twoColor: true, minContrast: 300 }}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByTestId('results-count').textContent).toBe('0 results shown')
    expect(container.querySelectorAll('[data-testid="result-skeleton"]')).toHaveLength(0)
    expect(screen.getByTestId('no-matches').textContent).toMatch(/no result matches/i)
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
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText(/5,000/)).toBeDefined()
    expect(bloSvgSpy.mock.calls.length).toBe(drawn)
  })

  it('calls start with the twoColor and minContrast values from the filters prop, not hardcoded ones', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: false, minContrast: 250 }}
        onSelect={vi.fn()}
      />,
    )

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ twoColor: false, minContrast: 250 }),
    )
  })

  it('re-filters via setFilters when only the filters prop changes, without restarting the run', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }

    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).toHaveBeenCalledTimes(1)

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={{ twoColor: false, minContrast: 300 }}
        onSelect={vi.fn()}
      />,
    )

    expect(setFiltersSpy).toHaveBeenCalledWith({ twoColor: false, minContrast: 300 })
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
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).not.toHaveBeenCalled()

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
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
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toMatch(/RPC blew up/)
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('toasts a worker failure in addition to (not instead of) the inline alert', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, error: 'Worker failed to start: boom' }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
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
        onSelect={vi.fn()}
      />,
    )

    const scanned = screen.getByText(/4,200/)
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
        onSelect={vi.fn()}
      />,
    )

    expect(container.contains(screen.getByText(/4,200/))).toBe(true)
  })

  it('resumes when the host stops pausing, even if Resume was pressed while it was', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, scanned: 4200 }

    // Mining is held paused by the host — a deploy in flight, or a share link's saltNonce still
    // being reconstructed. The bar can only read "Resume" here, so pressing it is the obvious
    // thing to do, and it must not silently arm a *second* pause that outlives the host's one.
    const { rerender } = render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /resume/i }))

    rerender(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        paused={false}
        onSelect={vi.fn()}
      />,
    )

    expect(startSpy).toHaveBeenCalledTimes(1)
  })

  it('still pauses and resumes on demand when the host is not pausing', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, scanned: 4200 }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )
    expect(startSpy).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(stopSpy).toHaveBeenCalled()
    expect(startSpy).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(startSpy).toHaveBeenCalledTimes(2)
  })

  // Clicking a card is the whole deploy flow now, so the hop from this component's `onSelect`
  // out to the page is what opens the dialog — a card wired to nothing is a dead page.
  it('reports the clicked candidate to its host', async () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }
    const onSelect = vi.fn()

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
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
        onSelect={vi.fn()}
      />,
    )

    const handoff = screen.getByRole('button', { name: /run this search/i })
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
        filters={{ twoColor: false, minContrast: 300 }}
        onSelect={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /run this search/i }))

    const command = screen.getByText(/npx safe-vanity-blockie/)
    expect(command.textContent).toContain('--no-two-color')
    expect(command.textContent).toContain('--min-contrast 300')
  })

  it('does not toast when there is no worker error', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = IDLE_STATE

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        onSelect={vi.fn()}
      />,
    )

    expect(toastErrorSpy).not.toHaveBeenCalled()
  })
})
