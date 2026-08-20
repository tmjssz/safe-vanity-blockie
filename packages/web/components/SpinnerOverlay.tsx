import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'

export interface SpinnerOverlayProps {
  /** Sizes the spinner itself. The overlay always fills its parent. */
  iconClassName?: string
  className?: string
}

/**
 * "This is being worked on", drawn over whatever it is.
 *
 * One definition for the three places a deploy in progress is shown on top of the identicon it is
 * deploying: the header pill, the result tile in the grid, and the dialog that explains why the
 * grid is refusing. Beside the picture instead, each of them had a blockie and a separate whirl
 * competing for the same space without saying they were about the same thing.
 *
 * The parent must be a positioning context (`relative`). The scrim is not decoration: a blockie is
 * a wall of saturated colour, and a stroke in the foreground colour over it is a smudge without
 * something to read against.
 */
export function SpinnerOverlay({ iconClassName, className }: SpinnerOverlayProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute inset-0 flex items-center justify-center rounded-sm bg-background/70',
        className,
      )}
    >
      <Loader2 className={cn('animate-spin', iconClassName)} />
    </span>
  )
}
