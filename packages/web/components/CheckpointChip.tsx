'use client'

import { ChevronDown, Flag } from 'lucide-react'
import { CopyButton } from './CopyButton'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/**
 * Where a follow-up run picks this search up, behind one chip on the config line.
 *
 * It used to be spelled out on the bar: the words "Resume from", eleven digits, a copy button
 * and an info icon, on every frame of a live run. That is a lot of row spent on a number nobody
 * reads while mining is working, and it moved as it grew. Folded into a chip it costs one small
 * outline, and only while paused, which is the only moment the value is worth anything: a
 * running search resumes from here by itself.
 *
 * A real PopoverTrigger, not the hover-driven HintPopover the rest of this bar uses. That one
 * cancels its own open-autofocus, on the grounds that nothing inside a hint is focusable; this
 * panel holds a copy button, and cancelling autofocus would leave it outside the keyboard's
 * reach. Opening on click rather than hover suits the chip anyway — it is reached by tap as
 * often as by pointer.
 *
 * `workers` travels with the number because a checkpoint alone is half a resume: each worker
 * keeps to a block of its own, so a pool of a different size skips a different slice of what
 * this run left behind. CliHandoff emits `--workers` and `--start` as a pair for the same
 * reason; this panel says so rather than handing out the bare digits and hoping.
 */
export function CheckpointChip({ nextStart, workers }: { nextStart: number; workers: number }) {
  return (
    // Uncontrolled: nothing outside the trigger's own `data-state` ever needs to know whether
    // this is open, so tracking it a second time here would just be a second source for one
    // fact that could drift from the first.
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          // Raised rather than recoloured while open: the chip has to stay identifiable as the
          // thing the panel is attached to, and a chip that changed colour would read as a
          // state of the RUN rather than a state of the panel.
          className="group text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground data-[state=open]:shadow-sm"
        >
          <Flag aria-hidden="true" />
          Checkpoint
          {/* The chevron turns because a chip that says "Checkpoint" with a static arrow gives
              no sign the panel below it came from here. It reads the trigger's OWN data-state
              through `group` rather than a second copy of `open` passed down here: two sources
              for one fact is two things that can disagree. */}
          <ChevronDown
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </PopoverTrigger>
      {/* Right-aligned to the chip, which sits at the right edge of the bar: aligned any other
          way the panel would hang off the side of the page. */}
      <PopoverContent align="end" side="bottom" className="w-80">
        <div className="flex items-start gap-2">
          {/* Grouped for the eye and monospaced so the digits line up; `tabular-nums` keeps the
              columns even. What goes on the clipboard is the bare digits, see below. */}
          <span className="min-w-0 flex-1 font-mono text-sm break-all tabular-nums text-foreground">
            {nextStart.toLocaleString('en-US')}
          </span>
          <CopyButton
            // Digits only. This value's destination is the CLI's `--start`, which parses with
            // Number: a grouped "60,000,016,650,000" would be read as 60 and rescan the whole
            // search from the beginning.
            value={String(nextStart)}
            label="Copy checkpoint"
            copiedMessage="Checkpoint copied"
            failedMessage="Could not copy automatically. Select the number and copy it manually."
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          The next saltNonce to try. Resume continues from here automatically.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          To continue this search on another machine, carry{' '}
          <span className="font-mono text-foreground">--workers {workers}</span> with it: each
          worker keeps to a block of its own, so a different worker count skips a different slice of
          what this run left behind. The Run on your machine command writes out both.
        </p>
      </PopoverContent>
    </Popover>
  )
}
