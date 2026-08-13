'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { shareConfigPath, type SharedConfig } from '../lib/deep-link'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

const COPY_FAILED_MESSAGE =
  'Could not copy automatically — select the link above and copy it manually.'

export function ShareConfig({ config }: { config: SharedConfig }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | undefined>()
  // Absolute, because this one is copied and pasted elsewhere; page.tsx pushes the same path
  // into the address bar relative, where the origin is already there. Same builder either way.
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}${shareConfigPath(config)}`

  const copy = () => {
    setCopyError(undefined)
    // Reset before every attempt, not just on success: otherwise one success latches the label
    // forever, and a later failure shows a "Copied" button beside a destructive "could not copy"
    // alert saying the opposite.
    setCopied(false)
    try {
      // Undefined on any non-secure origin (plain http:// on a LAN IP is a normal way to try
      // this app) — reading `.writeText` off it would throw synchronously inside the click
      // handler rather than rejecting, so it is checked before being called at all.
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!clipboard) {
        setCopyError(COPY_FAILED_MESSAGE)
        toast.error(COPY_FAILED_MESSAGE)
        return
      }
      clipboard
        .writeText(url)
        .then(() => {
          setCopied(true)
          toast.success('Share link copied')
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
    <div className="flex flex-col gap-2">
      <Label htmlFor="share-link">Share link</Label>
      <div className="flex gap-2">
        {/* Always rendered, read-only and selectable: the share link is currently the only way
            to preserve a mined saltNonce without deploying, so a copy-button failure must never
            be the only path to it. */}
        <Input
          id="share-link"
          type="text"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? 'Copied' : 'Copy share link'}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        The config is deterministic — deploy it whenever you like.
      </p>
      {/* A toast disappears on a timer; this stays on screen until the next successful copy, so
          a failure that needs the user to act (select-and-copy manually) is never lost. */}
      {copyError && (
        <Alert variant="destructive">
          <AlertDescription>{copyError}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
