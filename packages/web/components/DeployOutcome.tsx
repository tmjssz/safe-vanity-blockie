'use client'

import { Check, ExternalLink, Loader2, X } from 'lucide-react'
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

/** The three states a deploy can be in once it has left the user's hands. */
export type DeployOutcomeVariant = 'pending' | 'success' | 'failed'

export interface DeployOutcomeProps {
  variant: DeployOutcomeVariant
  /** The Safe being deployed, or now deployed. The thing the user came for. */
  address: string
  /**
   * The transaction that carries it. Absent when nothing was ever sent, which is what a wallet
   * rejection is.
   */
  txHash?: string
  /** Which chain: names it, and points every link at the right network. */
  chainId: number
  /** Why it failed, in the words the sequence used. Read as the subtitle of the failed variant. */
  reason?: string
  /** Whether the failure was the user turning it down, which is not the same news as a fault. */
  rejected?: boolean
  /** Returns the dialog to the confirm state. Omitted when there is nothing to retry with. */
  onRetry?: () => void
}

/**
 * What the deploy dialog becomes once the transaction has left the user's hands.
 *
 * One skeleton, three variants. The confirm state is a form: a warning to read, a config to check,
 * an offer to deploy later, a button that spends gas. The moment a transaction is sent, none of
 * that is a question any more — so this is a different screen rather than the same one with a
 * status line bolted into it, and it is centred where the confirm state is left-aligned.
 *
 * Pending, success and failure differ ONLY in the badge on the picture, the two lines of text, and
 * what the footer offers. Everything else is identical and, because the dialog keeps this component
 * mounted across the change, a confirmation morphs in place instead of looking like a second dialog
 * opening over the first.
 */
export function DeployOutcome({
  variant,
  address,
  txHash,
  chainId,
  reason,
  rejected = false,
  onRetry,
}: DeployOutcomeProps) {
  const chainName =
    SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.name ?? `chain ${chainId}`
  const explorer = explorerFor(chainId)
  const safeApp = safeWalletUrl(chainId, address)

  const title =
    variant === 'pending'
      ? 'Deploying Safe'
      : variant === 'success'
        ? 'Safe deployed'
        : // A rejection is a decision the user made, not a fault: "failed" over it reads as the app
          // having gone wrong, and the next thing they do depends on knowing which it was.
          rejected
          ? 'Transaction rejected'
          : 'Deployment failed'

  const subtitle =
    variant === 'pending'
      ? `Transaction sent. Waiting for confirmation on ${chainName}.`
      : variant === 'success'
        ? `Live on ${chainName} and ready to use.`
        : (reason ?? 'The deployment stopped.')

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* Larger than the confirm state draws it, and for the opposite reason: there the identicon is
          evidence to be checked against a wallet, here it is the thing being made. */}
      <span className="relative inline-flex">
        <Blockie
          address={address}
          size={88}
          className="block size-22 overflow-hidden rounded-xl [&>svg]:size-full"
        />
        {/* One badge, one position, one size, whatever the news: a mark that moves or resizes
            between states turns a morph into a jump. The ring in the dialog's own background colour
            is what makes it read as pinned to the picture rather than floating over it. */}
        <span
          data-slot="outcome-badge"
          className={`absolute -right-1 -bottom-1 inline-flex size-[26px] items-center justify-center rounded-full border-[3px] border-background ${
            variant === 'success'
              ? 'bg-emerald-500'
              : variant === 'failed'
                ? 'bg-destructive'
                : 'bg-neutral-800'
          }`}
        >
          {variant === 'pending' && (
            <Loader2 className="size-3.5 animate-spin text-white" aria-hidden="true" />
          )}
          {variant === 'success' && (
            <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden="true" />
          )}
          {variant === 'failed' && (
            <X className="size-3.5 text-white" strokeWidth={3} aria-hidden="true" />
          )}
        </span>
      </span>

      <DialogHeader className="items-center gap-1 text-center sm:text-center">
        <DialogTitle className="text-lg">{title}</DialogTitle>
        {/* Not a live region: the dialog keeps one of those mounted for its whole life, because a
            region that appears WITH its first message announces nothing at all — and this screen
            replaces the one before it. */}
        <DialogDescription>{subtitle}</DialogDescription>
      </DialogHeader>

      {/* Its own box, because it is the primary artifact of this screen: what someone takes away is
          42 characters, and a box says "this is the thing" in a way a line among other lines
          cannot. Identical in all three states, so it does not move when the news arrives. */}
      <div className="flex w-full items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2.5">
        <code className="min-w-0 truncate font-mono text-[13px] text-foreground">{address}</code>
        <CopyButton
          value={address}
          label="Copy Safe address"
          copiedMessage="Safe address copied"
          failedMessage="Could not copy automatically. Select the address and copy it manually."
        />
      </div>

      {/* One caption line, and only when there is a transaction: a rejection never sent one, and a
          line reading "Transaction" with nothing after it is worse than no line.

          `items-baseline`, not `items-center`: the hash is monospace and the words either side of it
          are not, and centring the boxes leaves their baselines a hair apart — which is exactly what
          reads as "these are not on the same line". The copy button is 24px against a 16px line, so
          `-my-1` takes its contribution back to the line's height and `self-center` then centres it
          on the text rather than on a line it inflated itself. Both measured in a browser.

          Nowrap from `sm` up, where the line's 309px always fits: on anything narrower, wrapping is
          a better failure than running off the side. */}
      {txHash && (
        <p className="flex flex-wrap items-baseline justify-center gap-1.5 text-xs text-muted-foreground sm:flex-nowrap">
          <span>Transaction</span>
          <code className="font-mono">{`${txHash.slice(0, 6)}…${txHash.slice(-4)}`}</code>
          <CopyButton
            value={txHash}
            label="Copy transaction hash"
            copiedMessage="Transaction hash copied"
            className="-my-1 self-center"
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
      )}

      {/* Centred, like everything else here, rather than on the right edge the confirm state's
          actions sit on. */}
      <DialogFooter className="w-full justify-center sm:justify-center">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {/* While it is pending, leaving does not stop it, and the label is the warning. */}
            {variant === 'pending' ? 'Close and keep waiting' : 'Close'}
          </Button>
        </DialogClose>
        {/* Nothing primary while pending: there is nothing to do but wait, and a button that looks
            like the next step would be inventing one. */}
        {variant === 'success' && safeApp && (
          // A link, not a button: it goes somewhere, and a middle-click should be able to take it
          // there the way any other link can.
          <Button asChild>
            <a href={safeApp} target="_blank" rel="noreferrer">
              Open in Safe Wallet
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        )}
        {variant === 'failed' && onRetry && (
          <Button type="button" onClick={onRetry}>
            Try again
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}
