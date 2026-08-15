'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from './popover'

/**
 * How long the panel survives the pointer leaving the trigger. The panel is offset from it, so
 * travelling from one to the other crosses a few pixels of nothing; without a grace period the
 * panel would close underneath a pointer that was on its way to read it.
 */
const CLOSE_DELAY_MS = 150

export interface HintPopoverProps {
  /** The trigger's accessible name. It is the only name a screen reader gets. */
  label: string
  /** What the trigger looks like. Rendered inside a real <button>. */
  children: React.ReactNode
  /** The revealed content. */
  content: React.ReactNode
  side?: React.ComponentProps<typeof PopoverContent>['side']
  align?: React.ComponentProps<typeof PopoverContent>['align']
  className?: string
  contentClassName?: string
}

/**
 * A small trigger that reveals a panel of text on **hover, click and keyboard focus**.
 *
 * All three, deliberately. Hover alone is unreachable on a touch device; click alone makes a small
 * icon read as decoration to anyone skimming with a mouse; focus alone reaches nobody using a
 * pointer. Radix offers one or the other — `Tooltip` is hover/focus and dismisses on click,
 * `Popover` is click — so this drives the open state itself: `hovering` covers pointer and focus,
 * `pinned` covers a click, and either one holds it open.
 *
 * That is also why the trigger is a `PopoverAnchor` rather than a `PopoverTrigger`. A trigger
 * toggles on click, which would *close* the panel in the common mouse case where hover had
 * already opened it: the click would land on an open panel and dismiss it.
 */
export function HintPopover({
  label,
  children,
  content,
  side = 'top',
  align = 'center',
  className,
  contentClassName,
}: HintPopoverProps) {
  const [hovering, setHovering] = React.useState(false)
  const [pinned, setPinned] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentId = React.useId()

  const open = hovering || pinned

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  // A pending close outliving the component would call setState on an unmounted tree.
  React.useEffect(() => cancelClose, [cancelClose])

  const scheduleClose = React.useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setHovering(false), CLOSE_DELAY_MS)
  }, [cancelClose])

  const dismiss = React.useCallback(() => {
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
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          className={cn(
            'rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
            className,
          )}
          onClick={() => {
            // Unpinning has to clear `hovering` too: the pointer is still sitting on the trigger,
            // so leaving it set would hold the panel open and make the second click do nothing.
            if (pinned) {
              dismiss()
            } else {
              cancelClose()
              setPinned(true)
            }
          }}
          // A tap fires pointerenter before click. Letting it through would open the panel on
          // hover state that a touch device never clears, so the click could never close it.
          onPointerEnter={(event) => {
            if (event.pointerType === 'touch') return
            cancelClose()
            setHovering(true)
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'touch') return
            scheduleClose()
          }}
          onFocus={() => {
            cancelClose()
            setHovering(true)
          }}
          onBlur={() => setHovering(false)}
        >
          {children}
        </button>
      </PopoverAnchor>
      <PopoverContent
        id={contentId}
        side={side}
        align={align}
        className={cn('text-xs leading-relaxed text-muted-foreground', contentClassName)}
        // The trigger is an anchor, not a trigger, so Radix counts a click on it as "outside" and
        // would close before the button's own handler pins it open. Ceding those clicks to the
        // button is what makes a single click open the panel instead of flickering it.
        onPointerDownOutside={(event) => {
          if (buttonRef.current?.contains(event.target as Node)) event.preventDefault()
        }}
        // The panel is read where it sits; pulling focus off the trigger on hover would be worse
        // than useless, since nothing inside is focusable.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}
