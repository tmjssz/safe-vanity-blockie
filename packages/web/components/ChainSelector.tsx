'use client'

import { useState } from 'react'
import { chainSwitchDiscardsResults, SUPPORTED_CHAINS } from '../lib/config'
import { ChainIcon, ChainLabel } from './ChainIcon'
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
  /** The chain the header shows, and the one a pick is compared against for being a no-op. */
  chainId: number
  /**
   * The chain whose addresses a switch is measured against: the run on screen, if there is one,
   * and otherwise the open result's — a share link opens a dialog with no run behind it, and that
   * result is as chain-bound as any mined one. Undefined when there is neither, and so nothing a
   * switch could cost. The page decides which it is (see `stakedChainId` there); this control only
   * asks about it.
   *
   * This, and NOT the chain above, is what the question is asked about, because it is what the
   * answer acts on: the page discards the run when the submitted config's chain and the new one
   * take different singletons. The two agree today only by the invariant that the form submits
   * whatever the header shows, so asking about the header meant the decision was read from one
   * value and carried out against another — and the half that fails quietly is a reset performed
   * without ever asking. One value, read once, decides both.
   */
  runChainId?: number
  /**
   * Called with the chosen chain once it is allowed to happen — immediately for a switch that
   * keeps every result valid, and only after the user confirms for one that does not. What the
   * switch then entails (adopting it, and discarding the run when it must) is the page's business,
   * not this control's; it decides only whether to ask first.
   */
  onSelect: (chainId: number) => void
  /**
   * Held still while a deploy transaction is in the wallet's hands. The deploy dialog is non-modal
   * — the whole point of this control living in the header — so without this the chain could move
   * while a send is in flight, and the open dialog's description, share link and wrong-chain gate
   * would follow it away from the transaction the user actually confirmed. Disabled rather than
   * silently ignored: a select that snaps back with no explanation is worse than one that is
   * visibly unavailable for the few seconds it takes.
   */
  disabled?: boolean
}

export function ChainSelector({ chainId, runChainId, disabled, onSelect }: ChainSelectorProps) {
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
    if (runChainId !== undefined && chainSwitchDiscardsResults(runChainId, next)) {
      setPending(next)
      return
    }
    onSelect(next)
  }

  // The chain being left, as the question names it: the run's, which is the one whose results are
  // at stake. `?? chainId` is narrowing and nothing more — the dialog below only ever opens on the
  // branch above, which requires `runChainId`.
  const leaving = runChainId ?? chainId

  return (
    <>
      <Select value={String(chainId)} onValueChange={choose} disabled={disabled}>
        {/* Labelled rather than captioned: the header has no room for a field label, and the
            trigger already displays the chain's name as its value. */}
        <SelectTrigger id="header-chain" size="sm" aria-label="Chain">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_CHAINS.map((chain) => (
            <SelectItem key={chain.id} value={String(chain.id)}>
              {/* The mark rides inside the item rather than being added to the trigger separately,
                  because SelectValue renders the selected item's own content — so one place to put
                  it covers both the open list and the closed control, and the two cannot disagree
                  about what the current chain looks like. */}
              <ChainIcon chainId={chain.id} />
              {chain.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Open exactly while a switch is pending. Dismissing it any way at all — Escape, the X, the
          overlay, the decline button — drops the pending chain, so the select stays exactly where
          it was and nothing is switched by walking away from the question.

          The copy does not assume a search is running. It asks about `runChainId`, which is the
          chain whose addresses are at stake, and that is a mined run in the ordinary case but a
          single open result in another: a share-link recipient meets this dialog with nothing
          mining and nothing found, and "discard every result found so far" over a button reading
          "Keep mining" described neither the loss nor the way out. Naming the chain being kept is
          true in both cases and says more than "keep" did — it is the answer to the question in
          the title. */}
      <Dialog open={pending !== undefined} onOpenChange={(open) => !open && setPending(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Switch to{' '}
              {pending === undefined ? (
                ''
              ) : (
                <ChainLabel chainId={pending}>{chainName(pending)}</ChainLabel>
              )}
              ?
            </DialogTitle>
            <DialogDescription>
              {chainName(leaving)} and {pending === undefined ? '' : chainName(pending)} deploy
              through different Safe singletons, so a Safe with the same owners, threshold and
              version lands on a different address on each. Switching starts over: every result
              found for {chainName(leaving)} is discarded, and any result open in front of you
              closes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">
                <ChainIcon chainId={leaving} />
                Stay on {chainName(leaving)}
              </Button>
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
