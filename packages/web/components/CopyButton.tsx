'use client'

import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

/**
 * How long the tick stands before the icon goes back to being an offer.
 *
 * A tick that never reverts stops being a confirmation and becomes the button's resting state:
 * nothing then distinguishes "just copied" from "copied ten minutes ago", and copying the same
 * value again gives no feedback at all, because the button already looks done.
 */
const CONFIRMATION_MS = 1500

export interface CopyButtonProps {
  /** The text that goes on the clipboard. */
  value: string
  /** The control's accessible name, and its hover tooltip: "Copy address", "Copy saltNonce". */
  label: string
  /** Success toast. Names the thing copied, since several of these sit on one screen. */
  copiedMessage: string
  /**
   * Error toast. The default names no fallback because the callers that have one — a selectable
   * <input>, a <pre> the user can drag over — say so themselves.
   */
  failedMessage?: string
  size?: React.ComponentProps<typeof Button>['size']
  variant?: React.ComponentProps<typeof Button>['variant']
  className?: string
}

/**
 * An icon-only copy control.
 *
 * Extracted rather than inlined a third time: `ShareConfig` and `CliHandoff` each grew their own
 * copy of the same guarded clipboard call, and this redesign adds three more call sites (the
 * address on a result tile, the address and the saltNonce in the deploy dialog). Those two keep
 * their own handlers — both pair the copy with an inline alert and a selectable fallback, which an
 * icon the size of a favicon has no room for — so this is the icon-and-toast shape only.
 */
export function CopyButton({
  value,
  label,
  copiedMessage,
  failedMessage = 'Could not copy automatically.',
  size = 'icon-xs',
  variant = 'ghost',
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable, as HintPopover's cancelClose is and for the same reason: the cleanup below is keyed on
  // it, and a fresh function every render would tear the pending revert down on every re-render —
  // which, in a grid that re-renders several times a second while mining, means the tick would
  // never revert at all.
  const cancelReset = useCallback(() => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
  }, [])

  // These unmount by the hundred — one per tile in the results grid, all of them thrown away on
  // "Start over" — so a pending reset outliving the component would call setState on a dead tree.
  useEffect(() => cancelReset, [cancelReset])

  const copy = () => {
    // Reset before every attempt: one success latching the tick forever would leave a
    // confirmed-looking button beside a "could not copy" toast saying the opposite. Cancelling the
    // pending revert with it is what keeps a second click's tick a full CONFIRMATION_MS long,
    // rather than however much was left of the first one.
    cancelReset()
    setCopied(false)
    const fail = () => {
      setCopied(false)
      toast.error(failedMessage)
    }
    try {
      // Undefined on any non-secure origin (plain http:// on a LAN IP is a normal way to try this
      // app), where reading `.writeText` off it throws synchronously inside the click handler
      // rather than rejecting — so it is checked before being called at all.
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!clipboard) {
        fail()
        return
      }
      clipboard
        .writeText(value)
        .then(() => {
          setCopied(true)
          toast.success(copiedMessage)
          resetTimer.current = setTimeout(() => setCopied(false), CONFIRMATION_MS)
        })
        .catch(fail)
    } catch {
      fail()
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      // The icon is the only visible content, so the name has to come from here — and the same
      // words are worth having on hover, where a pointer user meets the control with no label.
      aria-label={label}
      title={label}
      className={cn(className)}
      onClick={copy}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  )
}
