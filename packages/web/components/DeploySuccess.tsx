'use client'

import { Check, ExternalLink } from 'lucide-react'
import { SUPPORTED_CHAINS } from '../lib/config'
import { safeWalletUrl } from '../lib/safe-app'
import { explorerFor } from '../lib/wagmi'
import { Blockie } from './Blockie'
import { CopyButton } from './CopyButton'
import { Button } from './ui/button'
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

export interface DeploySuccessProps {
  /** The Safe that now exists. The thing the user came for, and takes away. */
  address: string
  /** The transaction that created it. */
  txHash: string
  /** Which chain it is live on: names it, and points both links at the right network. */
  chainId: number
}

/**
 * What the deploy dialog becomes once the Safe exists.
 *
 * A different screen rather than the same one with a tick added, because it has a different job.
 * Everything the confirm state carried was there to be checked or decided — the warning, the
 * config, the offer to deploy later, a button that spends gas — and all of it is settled. What is
 * left is one fact and two places to take it: the address, and the Safe itself.
 *
 * Centred, where the confirm state is left-aligned. That is the switch a user feels before reading
 * a word of it.
 */
export function DeploySuccess({ address, txHash, chainId }: DeploySuccessProps) {
  const chainName = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.name
  const explorer = explorerFor(chainId)
  const safeApp = safeWalletUrl(chainId, address)

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* Larger than the 96px the confirm state draws, and for the opposite reason: there it is
          evidence to be checked against a wallet, here it is the thing that was made. */}
      <span className="relative inline-flex">
        <Blockie
          address={address}
          size={88}
          className="block size-22 overflow-hidden rounded-xl [&>svg]:size-full"
        />
        {/* Pinned to the corner rather than floating beside it: the ring in the dialog's own
            background colour is what makes it read as attached to the picture. */}
        <span className="absolute -right-1 -bottom-1 inline-flex size-[26px] items-center justify-center rounded-full border-[3px] border-background bg-emerald-500">
          <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden="true" />
        </span>
      </span>

      <DialogHeader className="items-center gap-1 text-center sm:text-center">
        <DialogTitle className="text-lg">Safe deployed</DialogTitle>
        <DialogDescription>
          Live on {chainName ?? `chain ${chainId}`} and ready to use.
        </DialogDescription>
      </DialogHeader>

      {/* Its own box, because it is the primary artifact of this screen: what someone takes away
          from here is 42 characters, and a box says "this is the thing" in a way a line of text in
          a column of other lines cannot. */}
      <div className="flex w-full items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2.5">
        <code className="min-w-0 truncate font-mono text-[13px] text-foreground">{address}</code>
        <CopyButton
          value={address}
          label="Copy Safe address"
          copiedMessage="Safe address copied"
          failedMessage="Could not copy automatically. Select the address and copy it manually."
        />
      </div>

      {/* One caption line. The pending state gives the hash a row of its own because it is the
          thing being watched; by now it is a receipt, so it is abbreviated and stays out of the
          way of the address above it — the full string is on the clipboard and on the explorer. */}
      {/* `items-baseline`, not `items-center`: the hash is monospace and the words either side of it
          are not, and centring the boxes leaves their baselines a hair apart — which is exactly what
          reads as "these are not on the same line". The copy button is taller than the text, so it
          is centred within that baseline row instead of hanging off it.

          Nowrap from `sm` up, where the line's 309px always fits: on anything narrower, wrapping is
          a better failure than running off the side. */}
      <p className="flex flex-wrap items-baseline justify-center gap-1.5 text-xs text-muted-foreground sm:flex-nowrap">
        <span>Transaction</span>
        <code className="font-mono">{`${txHash.slice(0, 6)}…${txHash.slice(-4)}`}</code>
        <CopyButton
          value={txHash}
          label="Copy transaction hash"
          copiedMessage="Transaction hash copied"
          className="self-center"
        />
        {explorer && (
          <>
            <span aria-hidden="true">·</span>
            <a
              href={explorer.tx(txHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              View on {explorer.name}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </>
        )}
      </p>

      {/* Centred, like everything else here, rather than pushed to the right edge the confirm
          state's actions sit on. */}
      <DialogFooter className="w-full justify-center sm:justify-center">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Close
          </Button>
        </DialogClose>
        {/* A link, not a button: it goes somewhere, and a middle-click or a long-press should be
            able to take it there the way any other link can. */}
        {safeApp && (
          <Button asChild>
            <a href={safeApp} target="_blank" rel="noreferrer">
              Open in Safe Wallet
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}
