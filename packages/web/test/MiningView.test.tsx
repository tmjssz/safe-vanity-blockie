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

    expect(screen.getAllByRole('button', { name: /use this/i })).toHaveLength(1)
    expect(screen.getByText(/4,200/)).toBeDefined()
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
    expect(screen.getAllByRole('button', { name: /use this/i })).toHaveLength(1)
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

  // T3. MiningView.test.tsx never passed `selectedAddress`, so the hop from this component into
  // ResultsGrid was uncovered — and the ring is the only thing tying the open deploy panel to a
  // row in a grid that keeps re-sorting itself while a result is inspected.
  it('marks the row the deploy panel is showing', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        selectedAddress={CANDIDATE.address}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText(/^selected$/i)).toBeDefined()
  })

  it('marks no row when the selected address is not one of the candidates', () => {
    constantsState.current = { loading: false, data: STABLE_CONSTANTS_DATA }
    minerState.current = { ...IDLE_STATE, running: true, candidates: [CANDIDATE] }

    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={FACE_SPEC as never}
        filters={DEFAULT_FACE_FILTERS}
        selectedAddress={'0x' + '99'.repeat(20)}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.queryByText(/^selected$/i)).toBeNull()
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
