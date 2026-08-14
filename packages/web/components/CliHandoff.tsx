'use client'

import { Terminal } from 'lucide-react'
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
 */
export function npxCommandFor(
  config: MineConfig,
  options: { rpcUrl: string; filters?: FaceFilters },
): string {
  const parts = [
    'npx safe-vanity-blockie',
    `--owners ${config.owners.join(',')}`,
    `--threshold ${config.threshold}`,
    `--safe-version ${config.safeVersion}`,
    `--rpc ${options.rpcUrl}`,
  ]
  if (options.filters) {
    parts.push(options.filters.twoColor ? '--two-color' : '--no-two-color')
    parts.push(`--min-contrast ${options.filters.minContrast}`)
  }
  return parts.join(' ')
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
          Run this search on your machine
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Run this search on your machine</DialogTitle>
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
          {/* Wrapped rather than scrolled sideways, and the copy control sits in the block it
              copies. One long line in a box that scrolls hid most of what was about to go on the
              clipboard, and a button underneath left the two related things a paragraph apart.
              `break-all` because the command is mostly hex: without it the wrap points are the
              spaces, and a 42-character address still overflows.

              What is copied is unchanged — the text is one line, wrapping is only how it is
              drawn, so it still pastes straight into a shell. */}
          <div data-slot="command-block" className="relative min-w-0 rounded-md bg-muted">
            {/* `pr-36` is the button's width plus its inset plus a gap, measured rather than
                guessed: at `pr-28` the first line of the command ran 18px underneath the button.
                It is tied to the button's label, so a shorter one leaves more room and a longer
                one would need this raised with it. */}
            <pre className="max-h-48 min-w-0 overflow-y-auto p-3 pr-36 text-sm whitespace-pre-wrap break-all">
              <code>{command}</code>
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="absolute top-2 right-2"
              onClick={copy}
            >
              {copied ? 'Copied' : 'Copy command'}
            </Button>
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
