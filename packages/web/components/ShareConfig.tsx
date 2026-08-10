'use client'

import { useState } from 'react'
import { encodeConfigParam, type SharedConfig } from '../lib/deep-link'

export function ShareConfig({ config }: { config: SharedConfig }) {
  const [copied, setCopied] = useState(false)
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}/?config=${encodeConfigParam(config)}`

  return (
    <p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied' : 'Copy share link'}
      </button>
      <span className="hint"> The config is deterministic — deploy it whenever you like.</span>
    </p>
  )
}
