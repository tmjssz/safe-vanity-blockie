'use client'

import { Check, ChevronDown, Copy, Flag } from 'lucide-react'
import { useState } from 'react'
import type { FaceFilters, MineConfig } from '../lib/config'
import { resumeSearchPath } from '../lib/deep-link'
import { useCopy } from '../lib/use-copy'
import { CopyButton } from './CopyButton'
import { Button } from './ui/button'
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
 * reason; this panel says so rather than handing out the bare digits and hoping — and
 * `onShowCommand` is what makes that sentence worth reading, since naming the handoff and
 * leaving the reader to go and find it below a full screen of results is half a job.
 */
export function CheckpointTrigger({
  nextStart,
  workers,
  config,
  target,
  filters,
  onShowCommand,
}: {
  nextStart: number
  workers: number
  /**
   * The three things beyond the checkpoint that a resumed search needs. They are here rather than
   * a URL built upstream because this panel is mounted only while the run is stopped (see
   * MiningStatusBar's gate), and MiningView — the only other place that holds all three —
   * re-renders several times a second while mining. Building the link where it is read costs
   * nothing on a live run.
   *
   * `target` is `faceSpec.name`: a `targetNameForMouths` value, and the same string CliHandoff
   * passes as `--target`. So the link and the command name the accepted expressions identically.
   */
  config: MineConfig
  target: string
  filters: FaceFilters
  /** Raises the "Run on your machine" dialog, which lives elsewhere on the page. */
  onShowCommand: () => void
}) {
  // Controlled, where this used to ride on the trigger's own `data-state`: the link below hands
  // over to a dialog that covers this panel, and a panel still open behind it is one the reader
  // has to dismiss a second time after reading the command.
  const [open, setOpen] = useState(false)

  // Absolute, and it has to be: this is pasted into another window's address bar, where a path
  // would resolve against whatever page is open there. Same construction the deploy dialog's
  // share field uses. `resumeSearchPath` writes into the URL this page is on, so a basePath and
  // any unrelated params survive into the link.
  const resumeUrl = `${typeof window === 'undefined' ? '' : window.location.origin}${resumeSearchPath(
    { config, target, filters, start: nextStart },
  )}`
  const { copied, copy } = useCopy({
    value: resumeUrl,
    copiedMessage: 'Resume link copied',
    // NOT "copy the link from the address bar" — this URL is never there. The bar holds whatever
    // the session opened, or a share link `closeSelection` writes on a deploy dialog, and that
    // writer strips these five params outright (see `shareConfigPath`). Following that advice
    // would copy a link that silently drops the checkpoint, the target and the filters — exactly
    // the "resumes a different search" failure this whole panel exists to prevent. Point at what
    // is actually on screen instead: the checkpoint digits above (with their own fallback a few
    // lines up) and the "Run on your machine" command, which states the same search in CLI flags.
    failedMessage:
      'Could not copy automatically. Copy the checkpoint above and use the "Run on your machine" command for the rest of this search.',
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      {/* Aligned to the trigger's end. The trigger is pinned to the right edge of the summary
          line, so it has the width of the page to its left and none of it to its right: aligned
          any other way this panel would hang off the side. */}
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
          what this run left behind. The{' '}
          {/* The sentence's own words as the control, rather than a button bolted on after it:
              the handoff IS what the sentence is about, and a reader who has got this far has
              already been told the thing they would press it for. */}
          <button
            type="button"
            className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            onClick={() => {
              setOpen(false)
              onShowCommand()
            }}
          >
            Run on your machine
          </button>{' '}
          command writes out both.
        </p>
        {/* The third way out of this panel, after the bare digits and the CLI command, and the
            only one that needs no second step: the number, the config and the filters travel
            together, so the other tab opens on a Configure card that is already answered.

            A labelled Button rather than the icon-only CopyButton the digits use. An icon on its
            own says "copy" and nothing about WHAT — which is exactly the question a panel now
            holding two copyable things raises. */}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          To continue it in another tab, this link carries the Safe config, the filters and this
          checkpoint.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          // Full width: it is the one control in the panel with a label, and left to its own
          // width it would sit as a small box in a column of full-width prose with nothing
          // aligning it to anything.
          className="mt-2 w-full"
          onClick={copy}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {/* The name changes with the icon because they are one control reporting one state: a
              clipboard glyph beside "Copied" would name the action that is no longer on offer. */}
          {copied ? 'Copied' : 'Copy resume link'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
