'use client'

import { Check, CircleAlert } from 'lucide-react'
import { DecorativeBlockie } from './Blockie'
import { SpinnerOverlay } from './SpinnerOverlay'
import { Button } from './ui/button'

/**
 * How far a deploy has got. Derived inside DeployDialog, which owns every value it is derived from;
 * this pill and the dialog's own status panel are two views of the same fact.
 */
export type DeployPhase = 'idle' | 'sending' | 'pending' | 'done' | 'failed'

export interface DeployStatusPillProps {
  /** Never 'idle': there is nothing to say about a deploy that has not started. */
  phase: Exclude<DeployPhase, 'idle'>
  /** The Safe being deployed, for the identicon and the accessible name. */
  address: string
  onOpen: () => void
}

/**
 * Four states, four different things to say. "Deploying" while the wallet holds the request is not
 * the same news as "Confirming" with a transaction already out, and neither of those is an outcome.
 */
const PHASES = {
  sending: { label: 'Deploying', icon: 'spinner' },
  pending: { label: 'Confirming', icon: 'spinner' },
  done: { label: 'Deployed', icon: 'done' },
  failed: { label: 'Stopped', icon: 'failed' },
} as const

/**
 * The way back to a deploy that was closed while it was still running.
 *
 * "Close and keep waiting" hands the page back without cancelling anything — nothing can recall a
 * transaction a wallet already has — and until this existed that was a one-way door: the sequence
 * carried on, the toast eventually reported it, and the dialog that could have shown the
 * transaction was gone. This sits in the header for exactly that window, and pressing it puts the
 * dialog back with its status intact.
 */
export function DeployStatusPill({ phase, address, onOpen }: DeployStatusPillProps) {
  const { label, icon } = PHASES[phase]

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      // The header can hold this while two hundred results scroll behind it, so the name has to say
      // which one it belongs to. The identicon does that for anyone who can see it.
      aria-label={`${label}: reopen the deploy for ${address}`}
      onClick={onOpen}
    >
      {/* One indicator, not two: the spinner turns ON the result it is spinning for. Beside it,
          the pill had a picture and a separate whirl competing for the same corner of the header,
          and neither said they were about the same thing. */}
      <span className="relative inline-flex size-4 shrink-0">
        <DecorativeBlockie
          address={address}
          size={16}
          slot="deploy-pill-identicon"
          className="size-4 rounded-sm"
        />
        {icon === 'spinner' && <SpinnerOverlay iconClassName="size-3" />}
      </span>
      {/* Settled, the marker sits beside the picture rather than over it: an outcome is worth its
          own glyph at full size, and there is no longer anything to watch on the identicon. */}
      {icon === 'done' && <Check className="text-emerald-500" aria-hidden="true" />}
      {icon === 'failed' && <CircleAlert className="text-destructive" aria-hidden="true" />}
      {label}
    </Button>
  )
}
