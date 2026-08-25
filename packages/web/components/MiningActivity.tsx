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
 *
 * The fade between faces is `--animate-face-in` in globals.css, which is where its duration
 * lives: it is shorter than FRAME_MS on purpose, and the reasoning is next to the number.
 */
function MiningFaces() {
  const [faces] = useState(() =>
    Array.from({ length: POOL_SIZE }, () => bloSvg(randomAddress(), FACE_PX)),
  )
  // Both indices in one piece of state, so the outgoing face is always the one that was
  // actually on screen. Deriving it as `frame - 1` would be wrong twice: at mount it names a
  // face nobody has seen, and on the wrap from the last index it names the incoming face
  // itself, so that one frame would not fade at all.
  const [{ current, outgoing }, setFace] = useState({ current: 0, outgoing: 0 })
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) return
    const timer = setInterval(
      () =>
        setFace(({ current: shown }) => ({ current: (shown + 1) % POOL_SIZE, outgoing: shown })),
      FRAME_MS,
    )
    return () => clearInterval(timer)
  }, [reduced])

  return (
    // No size here: `bloSvg` writes FACE_PX into the svg's own width and height, and this
    // wrapper takes the size of the face in normal flow below. A second copy of 18 in a utility
    // class is a second number to keep in step with the first.
    <span className="relative inline-flex shrink-0 overflow-hidden rounded-sm">
      {/* The face on its way out, and the one giving this box its size — which is why it stays
          in flow while its replacement is the one lifted on top. Something has to hold the
          space, and it cannot be the layer that spends part of every frame transparent. */}
      <span
        data-slot="activity-blockie-outgoing"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: bloSvg is this repo's pure blo port, over addresses this module generated itself — see Blockie.tsx.
        dangerouslySetInnerHTML={{ __html: faces[outgoing] }}
      />
      {/* Keyed on the face, so React remounts this on every frame and the fade plays again:
          a persistent element runs its animation once, on mount, and never again. */}
      <span
        key={current}
        data-slot="activity-blockie"
        className="absolute inset-0 animate-face-in motion-reduce:animate-none"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: bloSvg is this repo's pure blo port, over addresses this module generated itself — see Blockie.tsx.
        dangerouslySetInnerHTML={{ __html: faces[current] }}
      />
    </span>
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
