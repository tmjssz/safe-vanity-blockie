'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * How long a confirmation stands before the control goes back to being an offer.
 *
 * A tick that never reverts stops being a confirmation and becomes the control's resting state:
 * nothing then distinguishes "just copied" from "copied ten minutes ago", and copying the same
 * value again gives no feedback at all, because the control already looks done.
 */
const CONFIRMATION_MS = 1500

export interface UseCopyInput {
  value: string
  /** Success toast. Names the thing copied, since several of these sit on one screen. */
  copiedMessage: string
  /** Error toast. Callers with a fallback path (a selectable field, a link) name it here. */
  failedMessage: string
}

/**
 * One copy-to-clipboard control's behaviour, without its markup.
 *
 * Extracted so the icon button (CopyButton) and the deploy dialog's share-link anchor are the same
 * control wearing different clothes. Both need the guarded clipboard call and the confirmation that
 * reverts, and those had already been written out twice before this existed.
 */
export function useCopy({ value, copiedMessage, failedMessage }: UseCopyInput): {
  copied: boolean
  copy: () => void
} {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable, as HintPopover's cancelClose is and for the same reason: the cleanup below is keyed on
  // it, and a fresh function every render would tear the pending revert down on every re-render —
  // which, in a grid that re-renders several times a second while mining, means the confirmation
  // would never revert at all.
  const cancelReset = useCallback(() => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
  }, [])

  // These unmount by the hundred — one per tile in the results grid, all of them thrown away on
  // "Start over" — so a pending reset outliving the component would call setState on a dead tree.
  useEffect(() => cancelReset, [cancelReset])

  const copy = useCallback(() => {
    // Reset before every attempt: one success latching the tick forever would leave a
    // confirmed-looking control beside a "could not copy" toast saying the opposite. Cancelling the
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
  }, [cancelReset, copiedMessage, failedMessage, value])

  return { copied, copy }
}
