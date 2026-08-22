'use client'

import { useEffect, useRef, useState } from 'react'
import { fitAddress } from './fit-address'

/**
 * Width of one character, per resolved CSS font, in pixels. Measured once per distinct font and
 * kept for the session: every result tile shares one font, so this is measured a single time for a
 * grid of two hundred rather than two hundred times.
 *
 * Keyed by the font string rather than assumed, because the row is monospace by CSS keyword — what
 * that resolves to is the reader's platform font, and its advance width is not a number this app
 * can know in advance. Guessing it is how an abbreviation ends up either overflowing its tile or
 * throwing away characters that fitted.
 */
const CHAR_WIDTHS = new Map<string, number>()

/**
 * How many characters to average the measurement over. One character of a monospace font is a
 * fractional number of pixels, so measuring twenty and dividing keeps the rounding error an order
 * of magnitude below a character rather than at the edge of one.
 */
const MEASURED_RUN = '0'.repeat(20)

/**
 * A fallback ratio of character width to font size, for the one case a measurement cannot be taken
 * at all: no 2D canvas context. Monospace faces cluster tightly around 0.6em — DejaVu Sans Mono
 * and Menlo are both 0.602, Consolas 0.55 — so this errs on the wide side of most of them, which
 * is the safe direction: it under-counts how much fits, and the row clips rather than overflows.
 */
const FALLBACK_CHAR_RATIO = 0.6

function charWidth(element: HTMLElement): number {
  const style = getComputedStyle(element)
  const font = `${style.fontSize} ${style.fontFamily}`
  const cached = CHAR_WIDTHS.get(font)
  if (cached !== undefined) return cached

  let width = 0
  try {
    // Canvas rather than a probe element in the document: no DOM mutation, no layout pass, and no
    // chance of a stray node inheriting styles from wherever it was appended.
    const context = document.createElement('canvas').getContext('2d')
    if (context) {
      context.font = font
      width = context.measureText(MEASURED_RUN).width / MEASURED_RUN.length
    }
  } catch {
    // A browser (or a test environment) without a 2D context. The estimate below is still better
    // than not abbreviating at all.
  }
  if (!(width > 0)) width = Number.parseFloat(style.fontSize) * FALLBACK_CHAR_RATIO
  if (!(width > 0)) return 0

  CHAR_WIDTHS.set(font, width)
  return width
}

/**
 * An address shortened to whatever the element it is rendered in can actually hold, symmetrically.
 *
 * Returns the ref to put on that element and the text to put inside it. Until a width is known the
 * text is the WHOLE address: it is the truthful thing to render, and paired with `truncate` on the
 * row it degrades to the browser clipping the tail — never to a layout that breaks. In practice
 * that state is not seen, because a ResizeObserver delivers the first size after layout and before
 * the frame is painted; it is what a reader gets in an environment with no ResizeObserver at all.
 *
 * Measuring per element rather than once for the grid, even though every tile is the same width:
 * the tile is where the row's width is actually decided (its padding, its column, the page's
 * container), and a shared number would have to be derived from a guess about all three. The cost
 * is bounded — one observer per tile, and `contentRect` comes with the callback, so a resize reads
 * no layout — and the character count is quantised, so the state only changes when a whole
 * character's worth of width appears or disappears rather than on every pixel of a drag.
 */
export function useFittedAddress(address: string): {
  ref: React.RefObject<HTMLElement | null>
  text: string
} {
  const ref = useRef<HTMLElement>(null)
  // The number of characters the row can hold, or undefined until something has measured it.
  const [budget, setBudget] = useState<number>()

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0
      const character = charWidth(element)
      // `setBudget` with an unchanged integer is a no-op in React, which is the point of storing
      // the character count rather than the width: dragging a window edge crosses a character
      // boundary every few pixels, and everything between two boundaries renders identically.
      if (character > 0) setBudget(Math.floor(width / character))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, text: budget === undefined ? address : fitAddress(address, budget) }
}
