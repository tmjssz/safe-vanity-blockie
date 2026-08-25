'use client'

import { ChevronDown, Flag } from 'lucide-react'
import { CopyButton } from './CopyButton'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/**
 * Where a follow-up run picks this search up, behind the last word of the config line.
 *
 * It used to be spelled out on the bar: the words "Resume from", eleven digits, a copy button
 * and an info icon, on every frame of a live run. That is a lot of row spent on a number nobody
 * reads while mining is working, and it moved as it grew. Folded away it costs one word, and
 * only while the run is stopped, which is the only moment the value is worth anything: a
 * running search resumes from here by itself.
 *
 * Drawn as text rather than as a control, because that is what it is: the last of the run's
 * dot-separated facts, in the same size and rhythm as "Safe 1.4.1" beside it. A bordered chip
 * in a line of plain metadata reads as the thing on the row you are meant to press, and the
 * thing you are meant to press is Resume, a line above. The dotted underline carries the whole
 * affordance, the way the "+N more" trigger on this same line does.
 *
 * A real PopoverTrigger, not the hover-driven HintPopover the rest of this bar uses. That one
 * cancels its own open-autofocus, on the grounds that nothing inside a hint is focusable; this
 * panel holds a copy button, and cancelling autofocus would leave it outside the keyboard's
 * reach. Opening on click rather than hover suits it anyway — it is reached by tap as
 * often as by pointer.
 *
 * `workers` travels with the number because a checkpoint alone is half a resume: each worker
 * keeps to a block of its own, so a pool of a different size skips a different slice of what
 * this run left behind. CliHandoff emits `--workers` and `--start` as a pair for the same
 * reason; this panel says so rather than handing out the bare digits and hoping.
 */
export function CheckpointTrigger({ nextStart, workers }: { nextStart: number; workers: number }) {
  return (
    // Uncontrolled: nothing outside the trigger's own `data-state` ever needs to know whether
    // this is open, so tracking it a second time here would just be a second source for one
    // fact that could drift from the first.
    <Popover>
      <PopoverTrigger asChild>
        {/* A plain button, not the `Button` component: every variant it offers is a control with
            a shape, and the point of this one is that it has none. That means bringing the focus
            ring along, which `Button` would otherwise have supplied. */}
        <button
          type="button"
          // A step brighter than the metadata around it, and brighter again while open: enough
          // to read as the one item on the line that does something, without becoming a second
          // colour on a row whose job is to be quiet.
          className="group inline-flex items-center gap-1 rounded-sm text-foreground/80 underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden data-[state=open]:text-foreground"
        >
          <Flag aria-hidden="true" className="size-3" />
          Checkpoint
          {/* The chevron turns because a word with a static arrow beside it gives no sign the
              panel below it came from here. It reads the trigger's OWN data-state through
              `group` rather than a second copy of `open` passed down here: two sources for one
              fact is two things that can disagree. */}
          <ChevronDown
            aria-hidden="true"
            className="size-3 transition-transform group-data-[state=open]:rotate-180"
          />
        </button>
      </PopoverTrigger>
      {/* Aligned to the trigger's start. The summary line begins at the left edge of the bar and
          runs only as far as the config needs, so the trigger has the width of the page to its
          right and none of it to its left. */}
      <PopoverContent align="start" side="bottom" className="w-80">
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
