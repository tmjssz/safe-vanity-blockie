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
            Allowed to shrink, the <pre> scrolls inside the dialog instead of widening it. */}
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            The CLI has no builtin <code>--target</code> for a narrowed subset of expressions, so it
            searches the full set of faces; your two-colour and contrast filters still carry over
            exactly, via the flags below.
          </p>
          {/* Wrapped rather than scrolled sideways: one long line in a box that scrolls hides
              most of what is about to go on the clipboard. `break-all` because the command is
              mostly hex, so breaking at spaces alone still overflows on a 42-character address.

              What is copied is unchanged — the text is one line, and wrapping is only how it is
              drawn, so it still pastes straight into a shell.

              The copy control is inside the block but on its own row beneath the command, not
              floating over it. Laid on top it had to be given a lane the text could not use, and
              that reserve cost the command a quarter of its width on EVERY line to keep one
              corner clear. A row of its own costs one line once. It is a link because it sits
              inside a code block, where a second box drawn around it is one frame too many. */}
          <div data-slot="command-block" className="min-w-0 rounded-md bg-muted">
            <pre className="max-h-48 min-w-0 overflow-y-auto px-3 pt-3 text-sm whitespace-pre-wrap break-all">
              <code>{command}</code>
            </pre>
            <div className="flex justify-end px-3 pt-1 pb-2">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto gap-1.5 p-0 text-xs"
                onClick={copy}
              >
                {/* The icon changes with the label because they are one control reporting one
                    state: a clipboard glyph next to the word "Copied" would be describing the
                    action that is no longer on offer. */}
                {copied ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  <Copy className="size-3" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy command'}
              </Button>
            </div>
          </div>
          {/* Same rule as ShareConfig: the toast fades, this Alert does not — it stays until the
              next successful copy so the fallback (select the <pre> and copy manually) is never
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
