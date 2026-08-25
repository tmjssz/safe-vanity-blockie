import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MiningActivity } from '../components/MiningActivity'

const barsIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-slot="activity-bar"]'))

/** One face's markup, as the thing that has to change from frame to frame. */
const faceIn = (container: HTMLElement) =>
  container.querySelector('[data-slot="activity-blockie"]')?.innerHTML

/** The element the current face is drawn into, for the assertions about how it arrives. */
const faceElementIn = (container: HTMLElement) => {
  const face = container.querySelector('[data-slot="activity-blockie"]')
  if (!face) throw new Error('no face on screen')
  return face
}

/** The face being replaced, which stays on screen underneath while the new one fades over it. */
const outgoingFaceIn = (container: HTMLElement) =>
  container.querySelector('[data-slot="activity-blockie-outgoing"]')?.innerHTML

/** The interval the flicker runs on, and the number of faces it cycles before repeating. */
const FRAME_MS = 170
const POOL_SIZE = 30

const advance = (frames: number) => act(() => void vi.advanceTimersByTime(frames * FRAME_MS))

describe('MiningActivity, running', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('names itself Mining, and says nothing in words', () => {
    const { container } = render(<MiningActivity paused={false} />)
    expect(screen.getByRole('img', { name: 'Mining' })).toBeDefined()
    expect(container.textContent).toBe('')
  })

  // The thing this app makes is identicons, and this is the one spot on screen that can show
  // the search happening rather than describing it: a face, then another, then another.
  it('draws an identicon rather than a bar chart', () => {
    const { container } = render(<MiningActivity paused={false} />)
    expect(barsIn(container)).toHaveLength(0)
    expect(container.querySelector('[data-slot="activity-blockie"] svg')).not.toBeNull()
  })

  it('reshuffles the face on every frame', () => {
    const { container } = render(<MiningActivity paused={false} />)
    const first = faceIn(container)

    advance(1)

    expect(faceIn(container)).not.toBe(first)
  })

  // A hard cut six times a second reads as a strobe. The new face is drawn over the one it
  // replaces and fades in across part of the frame, so the two overlap rather than one being
  // swapped for the other — enough to soften the change, not enough to blur what it is.
  it('fades each new face in over the one it replaces', () => {
    const { container } = render(<MiningActivity paused={false} />)
    const first = faceIn(container)

    advance(1)

    expect(faceIn(container)).not.toBe(first)
    expect(outgoingFaceIn(container)).toBe(first)
  })

  it('restarts the fade on every frame rather than playing it once', () => {
    const { container } = render(<MiningActivity paused={false} />)

    expect(faceElementIn(container).className).toMatch(/animate-face-in/)
    // Keyed on the frame, so React remounts it and the animation plays again. Without that the
    // element persists and the fade runs once, on mount, and never again.
    const mounted = faceElementIn(container)
    advance(1)
    expect(faceElementIn(container)).not.toBe(mounted)
  })

  // On top of the faces, and on a period of its own: the swaps are a fast, hard-edged change,
  // and a slow swell underneath them is what turns a strobing square into something that looks
  // alive. Deliberately not a multiple of the frame, so the two never lock into step.
  it('breathes on a slower loop than the faces change', () => {
    const { container } = render(<MiningActivity paused={false} />)
    const faces = container.querySelector('[data-slot="activity-faces"]')

    expect(faces?.className).toMatch(/animate-face-breathe/)
    expect(faces?.className).toMatch(/motion-reduce:animate-none/)
  })

  // Cycled from a pool built once, not drawn fresh per frame: `bloSvg` builds ~64 path segments
  // through a keccak hash, and six of those a second for the length of a search is work the
  // indicator does not need to repeat. A sequence that comes back round is what a fixed pool
  // looks like from the outside.
  it('cycles a fixed pool rather than drawing a new face every frame', () => {
    const { container } = render(<MiningActivity paused={false} />)
    const seen = [faceIn(container)]
    for (let frame = 1; frame < POOL_SIZE; frame++) {
      advance(1)
      seen.push(faceIn(container))
    }

    expect(new Set(seen).size).toBe(POOL_SIZE)

    advance(1)
    expect(faceIn(container)).toBe(seen[0])
  })

  // A glyph that changes six times a second, on screen for the whole length of a search, is
  // exactly what this setting is for. Still a blockie, just one of them.
  it('holds a single face still under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const { container } = render(<MiningActivity paused={false} />)
    const only = faceIn(container)

    advance(10)

    expect(faceIn(container)).toBe(only)
    expect(container.querySelector('[data-slot="activity-blockie"] svg')).not.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    // Nothing cycles under this setting, so the fade has nothing to soften — and a face that
    // dissolves into view on mount is still movement someone asked not to see.
    expect(faceElementIn(container).className).toMatch(/motion-reduce:animate-none/)
  })

  // The bar unmounts this on a pause and on a stop, so the timer has to go with it: a run held
  // for an hour should not be repainting an indicator nobody is looking at.
  it('leaves no timer running once it is off screen', () => {
    const { unmount } = render(<MiningActivity paused={false} />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs no timer while paused', () => {
    render(<MiningActivity paused />)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('MiningActivity, paused', () => {
  it('names itself Paused and says so in words', () => {
    render(<MiningActivity paused />)
    const indicator = screen.getByRole('img', { name: 'Paused' })
    expect(indicator.textContent).toBe('Paused')
  })

  it('draws two still bars, in amber, with nothing animating', () => {
    const { container } = render(<MiningActivity paused />)
    const bars = barsIn(container)
    expect(bars).toHaveLength(2)
    bars.forEach((bar) => {
      expect(bar.className).not.toMatch(/animate-/)
    })
    expect(screen.getByRole('img', { name: 'Paused' }).className).toMatch(/text-amber-/)
  })
})

describe('MiningActivity, in both states', () => {
  // It reports a state; it is not a control and it is not a badge. A border or a fill would
  // make it look like one of the two things beside it that ARE pressable.
  it.each([true, false])('is plain inline content, not a pill (paused: %s)', (paused) => {
    render(<MiningActivity paused={paused} />)
    const indicator = screen.getByRole('img')
    expect(indicator.className).not.toMatch(/(^|\s|:)border/)
    expect(indicator.className).not.toMatch(/(^|\s|:)bg-/)
    expect(indicator.className).not.toMatch(/rounded-full/)
  })
})
