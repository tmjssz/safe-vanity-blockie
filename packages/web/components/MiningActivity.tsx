'use client'

import { bloSvg } from '@safe-vanity-blockie/core'
import { useEffect, useState } from 'react'

/**
 * The flicker: how many faces are drawn up front, and how long each one is on screen.
 *
 * Thirty is enough that the loop does not read as a loop — six seconds of faces before it comes
 * round, by which time nobody is watching the sequence — and few enough that building them all
 * on mount is one burst of work rather than something the run has to keep paying for. 170ms is
 * the fastest a face can be shown and still register as a face rather than as noise.
 */
const POOL_SIZE = 30
const FRAME_MS = 170

/**
 * Big enough to read as an identicon at a glance — eight cells across need the room — and small
 * enough to sit inside the row's line box, so the bar does not grow a pixel when a run starts.
 */
const FACE_PX = 18

/** A throwaway 20-byte address. Nothing derives from it; it exists to be a face for 170ms. */
function randomAddress(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Whether the reader has asked for less movement, kept live rather than read once.
 *
 * Read in an effect rather than during render because this component is rendered on the server
 * too, where there is no `matchMedia` and no reader to ask. The listener is what the CSS this
 * replaced got for free: a run can be hours long, and someone who turns the setting on midway
 * through should not have to restart it to be taken seriously.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * The search, as a picture of what it is searching for: identicons dealt past at six a second.
 *
 * A component of its own, and that is what keeps the promise that nothing ticks while a run is
 * held: the bar renders this only while mining, so pausing unmounts it and the effect's cleanup
 * takes the interval with it. A `paused` branch inside one component could not do that — hooks
 * do not disappear on a branch.
 *
 * The markup is built once and held, not derived from an address per frame. `bloSvg` runs a
 * keccak hash and assembles ~64 path segments; six of those a second, for the length of a
 * search, is work with nothing to show for it, since the faces are interchangeable by design.
 * That is also why this does not go through `DecorativeBlockie`, which takes an address and
 * draws it on every render.
 */
function MiningFaces() {
  const [faces] = useState(() =>
    Array.from({ length: POOL_SIZE }, () => bloSvg(randomAddress(), FACE_PX)),
  )
  const [frame, setFrame] = useState(0)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) return
    const timer = setInterval(() => setFrame((current) => (current + 1) % POOL_SIZE), FRAME_MS)
    return () => clearInterval(timer)
  }, [reduced])

  return (
    <span
      data-slot="activity-blockie"
      // No size here: `bloSvg` writes FACE_PX into the svg's own width and height, and an
      // inline-flex wrapper takes the size of what it holds. A second copy of 18 in a utility
      // class is a second number to keep in step with the first.
      className="inline-flex shrink-0 overflow-hidden rounded-sm"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: bloSvg is this repo's pure blo port, over addresses this module generated itself — see Blockie.tsx.
      dangerouslySetInnerHTML={{ __html: faces[frame] }}
    />
  )
}

/**
 * Whether the search is working, at the head of the status bar's counters.
 *
 * A picture rather than a word, because it is the one thing on the bar a user glances at
 * repeatedly over a long run and never needs to read. Plain inline content, deliberately: no
 * border and no fill, so it cannot be mistaken for the controls at the other end of the same
 * row. Paused is the exception that earns a word, since a still glyph on its own is
 * indistinguishable from a decoration.
 *
 * `role="img"` with a name, so the whole thing is announced once, as one object: without it a
 * screen reader meets empty spans and says nothing at all.
 */
export function MiningActivity({ paused }: { paused: boolean }) {
  if (paused) {
    return (
      <span
        data-slot="mining-activity"
        role="img"
        aria-label="Paused"
        // One colour for the glyph and the word, so `bg-current` on the bars cannot drift from
        // the text beside them. amber-600 in light mode rather than the 500 the bars could
        // carry alone: this one has to be readable as text, not just visible as a shape.
        className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400"
      >
        <span className="inline-flex h-[14px] items-center gap-[3px]">
          <span data-slot="activity-bar" className="h-[12px] w-[3px] rounded-full bg-current" />
          <span data-slot="activity-bar" className="h-[12px] w-[3px] rounded-full bg-current" />
        </span>
        Paused
      </span>
    )
  }

  return (
    <span
      data-slot="mining-activity"
      role="img"
      aria-label="Mining"
      className="inline-flex items-center"
    >
      <MiningFaces />
    </span>
  )
}
