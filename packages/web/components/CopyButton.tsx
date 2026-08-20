'use client'

import { Check, Copy } from 'lucide-react'
import { useCopy } from '../lib/use-copy'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

export interface CopyButtonProps {
  /** The text that goes on the clipboard. */
  value: string
  /** The control's accessible name, and its hover tooltip: "Copy address", "Copy saltNonce". */
  label: string
  /** Success toast. Names the thing copied, since several of these sit on one screen. */
  copiedMessage: string
  /**
   * Error toast. The default names no fallback because the callers that have one — a selectable
   * <input>, a <pre> the user can drag over, a real link — say so themselves.
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
 * copy of the same guarded clipboard call, and the results redesign added three more call sites.
 * The behaviour itself now lives in `useCopy`, which the deploy dialog's share-link anchor shares
 * — this is the icon-and-toast shape of it, and `CliHandoff` keeps its own handler because it
 * pairs the copy with an inline alert and a selectable fallback that an icon has no room for.
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
  const { copied, copy } = useCopy({ value, copiedMessage, failedMessage })

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
