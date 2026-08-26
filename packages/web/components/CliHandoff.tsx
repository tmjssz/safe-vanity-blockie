'use client'

import { Check, Copy, Terminal } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { FaceFilters, MineConfig } from '../lib/config'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { InputGroup, InputGroupButton, InputGroupTextarea } from './ui/input-group'

/**
 * `--target` names the accepted expressions, and `--two-color`/`--no-two-color`, `--min-contrast`
 * and `--min-match` map 1:1 onto the browser's live filters (packages/miner/src/args.ts) — passed
 * through so the handed-off search enforces the same standard the user was already looking at,
 * instead of silently reverting to the CLI defaults.
 *
 * `--target` is not optional the way the filters are, because the omission it guards against is
 * the one that already happened: with the flag left off, the CLI falls back to its own default of
 * all five expressions, so a command copied off a screen showing two of them searched a wider
 * target than the screen it came from — and said nothing about having done so. The value is the
 * FaceSpec's own name (see lib/face-selection), which core's `faceSpecForTarget` resolves back to
 * exactly these expressions.
 *
 * Every one of them is emitted whenever filters are given, including at a permissive value. The
 * command is a statement of the standard the screen is holding results to, and a flag that appears
 * only sometimes leaves the reader working out whether it was left off or left at zero.
 *
 * One argument per line, joined by backslash continuations. This was deliberately a single line
 * before, for one reason: that it pastes into a shell as one command. The continuations are what
 * keep that true while making the thing readable — a POSIX shell treats the block as one
 * invocation. (A shell that does not use `\` for continuation, cmd or PowerShell, would need the
 * lines rejoined; the previous single line pasted anywhere.)
 *
 * `resume` carries `--workers` and `--start` as ONE option rather than two, because they are one
 * statement: pick this search up where the browser left off, with the pool that produced that
 * point. `--start` alone would invite a native run whose skipped tail nobody can account for — the
 * pool's width is what decides which tails an early stop leaves behind (see `nextStartFrom`) — and
 * `--workers` alone would pin the pool of a run that starts from scratch anyway.
 */
export function npxCommandFor(
  config: MineConfig,
  options: {
    rpcUrl: string
    target: string
    filters?: FaceFilters
    resume?: { start: number; workers: number }
  },
): string {
  const args = [
    `--owners ${config.owners.join(',')}`,
    `--threshold ${config.threshold}`,
    `--safe-version ${config.safeVersion}`,
    `--rpc ${options.rpcUrl}`,
    // In the order `--help` lists them, so a reader can follow the command down the help text.
    `--target ${options.target}`,
  ]
  if (options.filters) {
    args.push(options.filters.twoColor ? '--two-color' : '--no-two-color')
    args.push(`--min-contrast ${options.filters.minContrast}`)
    args.push(`--min-match ${options.filters.minMatch}`)
  }
  if (options.resume) {
    // `--help` order again: workers, then start.
    args.push(`--workers ${options.resume.workers}`)
    args.push(`--start ${options.resume.start}`)
  }
  // Every line but the last carries the continuation. Putting it on the last one too would leave
  // the shell waiting for an argument that never comes.
  return ['npx safe-vanity-blockie', ...args.map((arg) => `  ${arg}`)]
    .map((line, index, all) => (index === all.length - 1 ? line : `${line} \\`))
    .join('\n')
}

const COPY_FAILED_MESSAGE =
  'Could not copy automatically. Select the command above and copy it manually.'

export function CliHandoff({
  config,
  rpcUrl,
  target,
  filters,
  resume,
  open,
  onOpenChange,
}: {
  config: MineConfig
  rpcUrl: string
  /** The `--target` naming the accepted expressions: a FaceSpec name (see `npxCommandFor`). */
  target: string
  filters?: FaceFilters
  /**
   * Where the browser run got to, and the pool it got there with. Absent until something has
   * actually been scanned — a `--start 0` is a flag that says only that someone thought about it.
   */
  resume?: { start: number; workers: number }
  /**
   * Both together, or neither. Given, the owner holds the dialog open or shut and can raise it
   * from elsewhere on the page: the checkpoint panel on the status bar links to this command, and
   * a dialog that only its own trigger could open would leave that link with nothing to call.
   * Omitted, this is uncontrolled and the trigger below is the only way in.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | undefined>()
  const command = npxCommandFor(config, { rpcUrl, target, filters, resume })

  const copy = () => {
    setCopyError(undefined)
    // Same reasoning as ShareConfig's: a latched "Copied" label beside a "could not copy" alert
    // tells the user two contradictory things about the same click.
    setCopied(false)
    try {
      // Same reasoning as ShareConfig's copy handler: `.clipboard` can be undefined (throws
      // synchronously if read off `navigator` and called) or present and reject (async), so both
      // paths are guarded.
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!clipboard) {
        setCopyError(COPY_FAILED_MESSAGE)
        toast.error(COPY_FAILED_MESSAGE)
        return
      }
      clipboard
        .writeText(command)
        .then(() => {
          setCopied(true)
          toast.success('Command copied')
        })
        .catch(() => {
          setCopyError(COPY_FAILED_MESSAGE)
          toast.error(COPY_FAILED_MESSAGE)
        })
    } catch {
      setCopyError(COPY_FAILED_MESSAGE)
      toast.error(COPY_FAILED_MESSAGE)
    }
  }

  return (
    // Controlled only when someone asks: with both props undefined this is the uncontrolled
    // dialog it has always been, opened by its own trigger below. The status bar's checkpoint
    // panel links here, and that link is in a different part of the tree, so the state has to be
    // reachable from their common owner (MiningView) rather than private to this component.
    // A dialog rather than the expander this used to be. What it holds is two paragraphs, a
    // command and a copy button — read once, and then never again by the same person — and
    // expanding it in place pushed the entire leaderboard down the screen to make room. As a
    // dialog it costs one row beside the Results heading and nothing at all once it is closed.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        >
          <Terminal aria-hidden="true" />
          Run on your machine
        </Button>
      </DialogTrigger>
      {/* Between the widest dialog and the default: with each argument on its own line the
          command does not need a wide box, but at `lg` the owner list wrapped mid-address. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Run on your machine</DialogTitle>
          <DialogDescription>
            A browser tab is throttled when it loses focus, and mobile is roughly ten times slower.
            For a longer search, run the same config natively. It uses every core and can be
            resumed.
          </DialogDescription>
        </DialogHeader>
        {/* `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`, so the command
            below — one unbroken line the width of two addresses — sizes this track by its own
            intrinsic width and pushes the dialog out past its max, clipping the prose beside it.
            Allowed to shrink, the command field wraps inside the dialog instead of widening it. */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* This paragraph used to be a caveat: the CLI had no way to name a narrowed subset of
              expressions, so the command searched all five and only the colour and match filters
              carried over. `--target` accepts a list of expressions now (core's
              `faceSpecForTarget`, comma-separated as `--owners` is), so there is nothing left to warn about — the flags below are
              the whole standard this screen is holding results to. */}
          <p className="text-sm text-muted-foreground">
            Every part of the search on screen carries over exactly, via the flags below: the
            accepted expressions, and your two-color, contrast and match filters.
          </p>
          {/* Only when there is something to resume. The dialog's standing promise is that the
              search carries over exactly; this is the second half of it — that the PROGRESS
              carries over too, so the native run does not spend its first minutes re-mining what
              the tab already covered. */}
          {resume && (
            <p className="text-sm text-muted-foreground">
              It also picks up where the browser left off: <code>--start</code> is the resume point
              this run has reached and <code>--workers</code> is the pool that reached it, so
              nothing already scanned is scanned again.
            </p>
          )}
          {/* An InputGroup with the command as a read-only textarea and one control laid over its
              top-right corner.

              A textarea rather than the <pre> this was: the command exists to be taken away, and a
              form control is what browsers already make takeable — click puts a caret in it,
              ctrl/cmd-A selects the whole thing and nothing around it, and the keyboard can reach
              it at all. A <pre> is inert text a keyboard user cannot select without a mouse, which
              matters here precisely because the copy button is the path that can fail (see the
              alert below, and the fallback it names).

              `readOnly`, not `disabled`: a disabled control is unfocusable and its text
              unselectable, which would remove the only reason for using a control here. Read-only
              keeps focus, selection and the caret while refusing edits — which is what this is,
              since the command is derived from the config and there is nothing an edit here could
              be saved to.

              `rows` is counted from the command itself, so the box opens exactly as tall as what
              is in it — no inner scrollbar at the usual size, and no empty rows either. The base
              Textarea's `field-sizing-content` would do this too, but only on Chrome: Firefox and
              Safari do not support `field-sizing` yet, and there it would fall back to `min-h-16`
              — four lines of box around a seven-line command, scrolling most of what is about to
              go on the clipboard out of sight. Counting the lines works everywhere and is exact.
              `max-h-48` still caps it, for an owner list long enough to need one. What is copied is
              the `command` string in either case, never what happens to be in view.

              No header strip: it held a `bash` label and this one control, and a full row of
              furniture is a lot to spend on a word most readers do not need — the command is
              plainly a shell command, and the `\` continuations are explained where it matters, in
              npxCommandFor. The control comes back to the corner it used to float in, at 20px
              rather than the 24 it had in the strip.

              `pr-8` is the whole cost of that: enough to clear the corner, not the lane a bigger
              floating button needed. It matters while the field is scrolled, where a line that
              would otherwise pass under the button is the one thing that can make what is about to
              be copied unreadable. */}
          <InputGroup className="min-w-0">
            <InputGroupTextarea
              readOnly
              value={command}
              rows={command.split('\n').length}
              // With the `bash` label gone there is nothing on screen left to name this, so the
              // name is given here rather than pointed at. It matches the word the copy control
              // beside it already uses, so the two are not two names for the same thing.
              aria-label="Command"
              className="max-h-48 pr-8 font-mono text-sm"
            />
            {/* Positioned against the group, which is `relative` (see ui/input-group), rather than
                wrapped in an addon: every addon alignment is furniture with a row or a lane of its
                own, and this is meant to sit over the command's own corner.

                `size-5` for the box, with a 24px target restored by the padded pseudo-element —
                below that a pointer user is aiming at something smaller than the WCAG 2.2 minimum,
                and this is the one control in the dialog that does the thing the dialog is for. */}
            <InputGroupButton
              size="icon-xs"
              className="absolute top-1.5 right-1.5 size-5 before:absolute before:-inset-0.5 before:content-['']"
              onClick={copy}
            >
              {/* The icon changes with the name because they are one control reporting one
                  state: a clipboard glyph named "Copied" would be describing the action that is
                  no longer on offer. Icon-only, so the name is the sr-only text — the whole
                  control is 20px over the corner of the command, and a label beside it would
                  cover the command itself. */}
              {/* Sized on the glyph itself, not with a `[&>svg]` rule on the button: Button's own
                  `[&_svg:not([class*='size-'])]:size-4` carries a `:not()` and therefore more
                  specificity than any child rule added here, so it would quietly win and leave a
                  16px icon in a 20px box. A class on the element takes it out of that `:not()`. */}
              {copied ? (
                <Check aria-hidden="true" className="size-3" />
              ) : (
                <Copy aria-hidden="true" className="size-3" />
              )}
              <span className="sr-only">{copied ? 'Copied' : 'Copy command'}</span>
            </InputGroupButton>
          </InputGroup>
          {/* Same rule as ShareConfig: the toast fades, this Alert does not — it stays until the
              next successful copy so the fallback (select the field above and copy manually) is never
              the only path left once the toast is gone. */}
          {copyError && (
            <Alert variant="destructive">
              <AlertDescription>{copyError}</AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
