'use client'

import { ShieldCheck } from 'lucide-react'
import { HintPopover } from './ui/hint-popover'

/**
 * The footer's privacy note: a shield that reveals what the app does and does not send anywhere.
 * The hover/click/focus mechanics live in HintPopover, which the status bar's owner list shares.
 */
export function PrivacyNote() {
  return (
    <HintPopover
      label="Privacy details"
      align="end"
      side="top"
      className="text-muted-foreground transition-colors hover:text-foreground"
      content={
        /* "Nothing leaves your browser" would be false: the app reads public RPCs for Safe's
           contract constants, and a deploy sends a transaction through the connected wallet.
           Both are named rather than glossed over — mining is the only part that is genuinely
           local, and it is the only part this claims is. */
        <>
          Mining runs entirely in your browser, across your machine&rsquo;s worker threads. The only
          network activity is public RPC calls to read Safe&rsquo;s contract constants and, if you
          deploy, the transaction sent through your connected wallet. No analytics, no telemetry.
        </>
      }
    >
      <ShieldCheck className="size-4" aria-hidden="true" />
    </HintPopover>
  )
}
