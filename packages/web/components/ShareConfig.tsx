'use client'

import { useState } from 'react'
import { encodeConfigParam, type SharedConfig } from '../lib/deep-link'

const COPY_FAILED_MESSAGE =
  'Could not copy automatically — select the link above and copy it manually.'

export function ShareConfig({ config }: { config: SharedConfig }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | undefined>()
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}/?config=${encodeConfigParam(config)}`

  const copy = () => {
    setCopyError(undefined)
    try {
      // Undefined on any non-secure origin (plain http:// on a LAN IP is a normal way to try
      // this app) — reading `.writeText` off it would throw synchronously inside the click
      // handler rather than rejecting, so it is checked before being called at all.
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!clipboard) {
        setCopyError(COPY_FAILED_MESSAGE)
        return
      }
      clipboard
        .writeText(url)
        .then(() => setCopied(true))
        .catch(() => setCopyError(COPY_FAILED_MESSAGE))
    } catch {
      setCopyError(COPY_FAILED_MESSAGE)
    }
  }

  return (
    <div>
      <p>
        {/* Always rendered, read-only and selectable: the share link is currently the only way
            to preserve a mined saltNonce without deploying, so a copy-button failure must never
            be the only path to it. */}
        <input
          type="text"
          readOnly
          value={url}
          aria-label="Share link"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy share link'}
        </button>
        <span className="hint"> The config is deterministic — deploy it whenever you like.</span>
      </p>
      {copyError && <p role="alert">{copyError}</p>}
    </div>
  )
}
