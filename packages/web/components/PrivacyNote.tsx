'use client'

import { ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

/**
 * How long the note survives the pointer leaving the shield. The panel is offset from the icon,
 * so travelling from one to the other crosses a few pixels of nothing; without a grace period
 * the note would close underneath a pointer that was on its way to read it.
 */
const CLOSE_DELAY_MS = 150

/**
 * The footer's privacy note: a shield that reveals what the app does and does not send anywhere.
 *
 * It opens on **both** hover and click, deliberately. Hover alone is unreachable on a touch
 * device, and click alone makes a small footer icon read as decoration to anyone skimming with a
 * mouse. Radix gives one or the other — `Tooltip` is hover/focus and dismisses on click, `Popover`
 * is click — so this drives the open state itself: `hovering` covers pointer and keyboard focus,
 * `pinned` covers a click, and either one holds it open.
 *
 * That is also why the button is a `PopoverAnchor` rather than a `PopoverTrigger`. A trigger
 * toggles on click, which would *close* the note for the common mouse case where hover had
 * already opened it — the click would land on an open panel and dismiss it.
 */
export function PrivacyNote() {
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentId = useId()

  const open = hovering || pinned

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  // A pending close outliving the component would call setState on an unmounted tree.
  useEffect(() => cancelClose, [cancelClose])

  const dismiss = useCallback(() => {
    cancelClose()
    setHovering(false)
    setPinned(false)
  }, [cancelClose])

  return (
    <Popover
      open={open}
      // Radix only asks to close here — Escape and outside clicks. Opening is ours to decide.
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
    >
      <PopoverAnchor asChild>
        <button
          ref={buttonRef}
          type="button"
          aria-label="Privacy details"
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          onClick={() => {
            // Unpinning has to clear `hovering` too: the pointer is still sitting on the shield,
            // so leaving it set would hold the note open and make the second click do nothing.
            if (pinned) {
              dismiss()
            } else {
              cancelClose()
              setPinned(true)
            }
          }}
          // A tap fires pointerenter before click. Letting it through would open the note on
          // hover state that a touch device never clears, so the click could never close it.
          onPointerEnter={(event) => {
            if (event.pointerType === 'touch') return
            cancelClose()
            setHovering(true)
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'touch') return
            cancelClose()
            closeTimer.current = setTimeout(() => setHovering(false), CLOSE_DELAY_MS)
          }}
          onFocus={() => {
            cancelClose()
            setHovering(true)
          }}
          onBlur={() => setHovering(false)}
        >
          <ShieldCheck className="size-4" aria-hidden="true" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        id={contentId}
        align="end"
        side="top"
        className="text-xs leading-relaxed text-muted-foreground"
        // The button is an anchor, not a trigger, so Radix counts a click on it as "outside" and
        // would close before the button's own handler pins it open. Ceding those clicks to the
        // button is what makes a single click open the note instead of flickering it.
        onPointerDownOutside={(event) => {
          if (buttonRef.current?.contains(event.target as Node)) event.preventDefault()
        }}
        // The note is read where it sits; pulling focus off the shield on hover would be worse
        // than useless, since nothing inside is focusable.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={cancelClose}
        onPointerLeave={() => {
          cancelClose()
          closeTimer.current = setTimeout(() => setHovering(false), CLOSE_DELAY_MS)
        }}
      >
        {/* "Nothing leaves your browser" would be false: the app reads public RPCs for Safe's
            contract constants, and a deploy sends a transaction through the connected wallet.
            Both are named rather than glossed over — mining is the only part that is genuinely
            local, and it is the only part this claims is. */}
        Mining runs entirely in your browser, across your machine&rsquo;s worker threads. The only
        network activity is public RPC calls to read Safe&rsquo;s contract constants and, if you
        deploy, the transaction sent through your connected wallet. No analytics, no telemetry.
      </PopoverContent>
    </Popover>
  )
}
