'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { FaceFilters, MineConfig } from '../lib/config'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

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
  const [open, setOpen] = useState(false)
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-1 px-2">
          <ChevronDown
            className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
          Run this search on your machine instead
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted-foreground">
          A browser tab is throttled when it loses focus, and mobile is roughly ten times slower.
          For a longer search, run the same config natively. It uses every core and can be resumed.
        </p>
        <p className="text-sm text-muted-foreground">
          The CLI has no builtin <code>--target</code> for a narrowed subset of expressions, so it
          searches the full set of faces; your two-colour and contrast filters still carry over
          exactly, via the flags below.
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-sm">
          <code>{command}</code>
        </pre>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={copy}>
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
      </CollapsibleContent>
    </Collapsible>
  )
}
