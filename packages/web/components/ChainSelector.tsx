'use client'

import { useState } from 'react'
import { SUPPORTED_CHAINS, chainSwitchDiscardsResults } from '../lib/config'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

/**
 * The layout renders an empty element with this id inside the sticky header, and the page — which
 * owns the selected chain, along with the run and the reset that a chain change may have to
 * trigger — portals the selector into it. The same arrangement as MINING_STATUS_BAR_SLOT_ID, and
 * for the same reason: the control belongs in the chrome, the state belongs with everything it
 * has to stay consistent with. Declared here so the layout can render the slot without importing
 * the page's module.
 */
export const HEADER_CHAIN_SLOT_ID = 'header-chain-slot'

const chainName = (chainId: number) =>
  SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.name ?? `Chain ${chainId}`

export interface ChainSelectorProps {
  chainId: number
  /**
   * True once a config is submitted, i.e. once there is a run whose results a chain switch could
   * invalidate. Before that there is nothing to lose and every switch is unconditional.
   */
  hasRun: boolean
  /**
   * Called with the chosen chain once it is allowed to happen — immediately for a switch that
   * keeps every result valid, and only after the user confirms for one that does not. What the
   * switch then entails (adopting it, and discarding the run when it must) is the page's business,
   * not this control's; it decides only whether to ask first.
   */
  onSelect: (chainId: number) => void
}

export function ChainSelector({ chainId, hasRun, onSelect }: ChainSelectorProps) {
  // The chain the user picked that is waiting on a confirmation, and the dialog's own open state:
  // one value, because a pending switch and an open dialog are the same fact.
  const [pending, setPending] = useState<number | undefined>()

  const choose = (value: string) => {
    const next = Number(value)
    if (next === chainId) return
    // A switch among the six non-mainnet chains keeps the constants byte-identical, so nothing on
    // screen stops being true and there is nothing to ask about. Crossing the mainnet boundary
    // changes the singleton, and with it every address already found — the same loss "Start over"
    // asks about, so it is asked about the same way rather than done silently.
    if (hasRun && chainSwitchDiscardsResults(chainId, next)) {
      setPending(next)
      return
    }
    onSelect(next)
  }

  return (
    <>
      <Select value={String(chainId)} onValueChange={choose}>
        {/* Labelled rather than captioned: the header has no room for a field label, and the
            trigger already displays the chain's name as its value. */}
        <SelectTrigger id="header-chain" size="sm" aria-label="Chain">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_CHAINS.map((chain) => (
            <SelectItem key={chain.id} value={String(chain.id)}>
              {chain.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Open exactly while a switch is pending. Dismissing it any way at all — Escape, the X, the
          overlay, "Keep mining" — drops the pending chain, so the select stays on the chain the
          results were mined for and nothing is switched by walking away from the question. */}
      <Dialog open={pending !== undefined} onOpenChange={(open) => !open && setPending(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to {pending === undefined ? '' : chainName(pending)}?</DialogTitle>
            <DialogDescription>
              {chainName(chainId)} and {pending === undefined ? '' : chainName(pending)} deploy
              through different Safe singletons, so a Safe with the same owners, threshold and
              version lands on a different address on each. Switching will discard every result
              found so far and any selected result.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep mining</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const next = pending
                setPending(undefined)
                if (next !== undefined) onSelect(next)
              }}
            >
              Switch and start over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
