'use client'

import { Check, Copy, Terminal } from 'lucide-react'
import { useId, useState } from 'react'
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from './ui/input-group'

/**
 * `--two-color`/`--no-two-color` and `--min-contrast` map 1:1 onto the browser's live filters
 * (packages/miner/src/args.ts) — passed through so the handed-off search enforces the same
 * standard the user was already looking at, instead of silently reverting to the CLI defaults.
 *
 * One argument per line, joined by backslash continuations. This was deliberately a single line
 * before, for one reason: that it pastes into a shell as one command. The continuations are what
 * keep that true while making the thing readable — a POSIX shell treats the block as one
 * invocation. (A shell that does not use `\` for continuation, cmd or PowerShell, would need the
 * lines rejoined; the previous single line pasted anywhere.)
 */
export function npxCommandFor(
  config: MineConfig,
  options: { rpcUrl: string; filters?: FaceFilters },
): string {
  const args = [
    `--owners ${config.owners.join(',')}`,
    `--threshold ${config.threshold}`,
    `--safe-version ${config.safeVersion}`,
    `--rpc ${options.rpcUrl}`,
  ]
  if (options.filters) {
    args.push(options.filters.twoColor ? '--two-color' : '--no-two-color')
    args.push(`--min-contrast ${options.filters.minContrast}`)
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
  filters,
}: {
  config: MineConfig
  rpcUrl: string
  filters?: FaceFilters
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | undefined>()
  const command = npxCommandFor(config, { rpcUrl, filters })
  const shellLabelId = useId()

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
    // A dialog rather than the expander this used to be. What it holds is two paragraphs, a
    // command and a copy button — read once, and then never again by the same person — and
    // expanding it in place pushed the entire leaderboard down the screen to make room. As a
    // dialog it costs one row beside the Results heading and nothing at all once it is closed.
    <Dialog>
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
          <p className="text-sm text-muted-foreground">
            The CLI has no builtin <code>--target</code> for a narrowed subset of expressions, so it
            searches the full set of faces; your two-colour and contrast filters still carry over
            exactly, via the flags below.
          </p>
          {/* An InputGroup with the command as a read-only textarea, and a header strip above it
              carrying the shell it is written for and the one control that acts on it.

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

              The header is `block-start` rather than a row beneath, which is what the addon is
              for: it puts the label and the control on furniture of their own, so the command gets
              the full width of every line back without a lane reserved for a floating button.
              `border-b` draws the strip as a header — the addon's own variants pick that class up
              and pad against it. */}
          <InputGroup className="min-w-0">
            <InputGroupTextarea
              readOnly
              value={command}
              rows={command.split('\n').length}
              // Named by the header's own label rather than an invented one: "bash" is already on
              // screen saying what this is, and a second name for a screen reader that does not
              // match the visible one is how a control comes to be referred to by two names.
              aria-labelledby={shellLabelId}
              className="max-h-48 font-mono text-sm"
            />
            <InputGroupAddon align="block-start" className="border-b">
              <Terminal aria-hidden="true" className="text-muted-foreground" />
              {/* The shell, not a filename: the command is joined with `\` continuations, which is
                  a POSIX-shell convention (see npxCommandFor). Someone pasting this into cmd or
                  PowerShell has to rejoin the lines, and this is the only thing on screen that
                  says which shell it was written for. */}
              <InputGroupText id={shellLabelId} className="font-mono">
                bash
              </InputGroupText>
              <InputGroupButton size="icon-xs" className="ml-auto" onClick={copy}>
                {/* The icon changes with the name because they are one control reporting one
                    state: a clipboard glyph named "Copied" would be describing the action that is
                    no longer on offer. Icon-only, so the name is the sr-only text — the whole
                    control is 24px in a header strip, and a label beside it would be wider than
                    the strip has room for. */}
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                <span className="sr-only">{copied ? 'Copied' : 'Copy command'}</span>
              </InputGroupButton>
            </InputGroupAddon>
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
