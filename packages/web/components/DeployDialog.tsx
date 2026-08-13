'use client'

import { formatScore, type Candidate } from '@safe-vanity-blockie/core'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAccount, useConnect, useConnectorClient, useSwitchChain } from 'wagmi'
import { SUPPORTED_CHAINS, type MineConfig } from '../lib/config'
import { Blockie } from './Blockie'
import { ShareConfig } from './ShareConfig'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
import { Badge } from './ui/badge'
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

export interface DeployDialogProps {
  open: boolean
  candidate: Candidate
  config: MineConfig
  onOpenChange: (open: boolean) => void
  /**
   * Fired immediately before the first `await` of the deploy sequence, and in a `finally` once
   * it settles either way. The page uses them to pause mining for exactly as long as the
   * deploy is in flight: the wallet confirmation is the one moment a user must read an address
   * carefully, and it should happen against a still surface.
   */
  onDeployStart: () => void
  onDeploySettled: () => void
}

export function DeployDialog({
  open,
  candidate,
  config,
  onOpenChange,
  onDeployStart,
  onDeploySettled,
}: DeployDialogProps) {
  const { isConnected, address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { connect, connectors, isPending: isConnecting } = useConnect()
  const { data: client } = useConnectorClient()
  const [status, setStatus] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)

  const wrongChain = isConnected && chainId !== config.chainId
  const chainName = SUPPORTED_CHAINS.find((entry) => entry.id === config.chainId)?.name

  /**
   * Writes a terminal failure to both channels at once. The inline Alert is the one the user acts
   * on — it stays until they do — and the toast is its copy in a renderer mounted outside every
   * subtree that can unmount underneath a deploy in flight.
   */
  const reportError = (message: string) => {
    setError(message)
    toast.error(message)
  }

  return (
    /* NON-MODAL, and that is a deliberate reversal. As a modal this dialog laid a `z-50` overlay
       over the whole viewport, trapped focus and `aria-hidden`-ed everything behind it — which
       includes the sticky header, and therefore the chain selector. The chain could not be
       changed without closing the result first. Raising the header above the overlay instead
       would have let a mouse through while leaving the control invisible to keyboard and screen
       reader users, which is worse than not offering it at all; non-modal is the honest version:
       Radix drops the overlay entirely, stops trapping focus and hides nothing, so the page
       behind really is the page. What follows from it is handled in page.tsx — a card behind this
       dialog is now clickable, and the header's chain now carries the open selection with it. */
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      {/* While the sequence is in flight this dialog is the ONLY place its outcome can be read
          inline, and closing it unmounts the dialog outright — page.tsx renders it only while a
          candidate is selected, keyed on that candidate's address, and clears the selection when
          it closes. So the *accidental* dismissals are blocked: Escape and the X while busy, and
          interaction outside always.

          "Outside" is the one that changed meaning with the overlay. There is no longer a sheet
          of dark glass out there whose only possible purpose is "dismiss this" — there is the
          live page, whose controls the user is now invited to use, and the chain selector in
          particular is the entire point of this change. Dismissing on a pointerdown or a focus
          move outside would mean reaching for the header closed the result it was meant to
          re-aim, and tabbing off the last control did the same. So it never dismisses, busy or
          not: a strictly stronger rule than the `busy`-only guard it replaces, and one that does
          not silently depend on which chain-selector internals happen to sit in this layer's
          stack. Clicking another result card still replaces what is on screen — that goes through
          page.tsx's `selectFromGrid` and its `key`, not through a dismissal.

          The deliberate, warned footer button below stays live on purpose: a wallet that never
          settles its promise (the popup closed without a response) would otherwise trap the user
          in this dialog forever, and an unclosable dialog is a worse failure than a knowingly
          abandoned one. Browser Back is the other way out, and page.tsx reconciles it. The toast
          mirror below is what carries the outcome once the inline copy has gone with the dialog.

          The height cap leaves room for the header rather than the 1rem the shadcn default takes:
          centred, `100dvh-7rem` cannot reach under the layout's `h-14` sticky bar at any viewport
          height, so the control this dialog exists to leave usable is never covered by it. Below
          that the content scrolls inside the dialog, as it already did. */}
      <DialogContent
        className="max-h-[calc(100dvh-7rem)] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Deploy this Safe</DialogTitle>
          <DialogDescription>
            Your wallet will ask you to confirm a transaction that spends gas
            {chainName ? ` on ${chainName}` : ''}.
          </DialogDescription>
        </DialogHeader>

        {/* The caveat is repeated here on purpose: this is the screen where money is actually
            spent, and it is the last place it can still do any good. role="note" rather than the
            Alert default, though — it is static copy that is always here, so as a live region it
            would compete permanently with the real status/error below. */}
        <Alert role="note">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>A matching identicon is cosmetic.</AlertTitle>
          <AlertDescription>
            Check every character of the address below before you confirm — a look-alike blockie
            is a known phishing vector.
          </AlertDescription>
        </Alert>

        {/* 128px, as the deleted DeployPanel drew it: this is the only place the identicon can
            still be compared against the card that was clicked, and a 64px copy is too small to
            check a look-alike against. */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
          <Blockie address={candidate.address} size={128} />
          <div className="flex min-w-0 flex-col items-start gap-2">
            <Badge variant="secondary">{formatScore(candidate.score, candidate.maxScore)}</Badge>
            <code className="break-all text-sm">{candidate.address}</code>
            <code className="text-xs text-muted-foreground">saltNonce {candidate.saltNonce}</code>
          </div>
        </div>

        {/* Whose Safe this is. Read from `config` — this component's own prop, which page.tsx
            pairs with the candidate the address came from — and never from anything the page
            holds separately, because the two can legitimately differ: a share-link recipient can
            submit their own config while the link is still reconstructing, and then the Configure
            card behind this dialog summarises THEIR owners while this deploys the SENDER's.
            Nothing there drifts and nothing lies, but until this block existed the dialog never
            named the owners at all, so that state was merely self-consistent rather than
            self-evident — and a recipient who had edited the prefill to their own address could
            reasonably read the dialog as a result of their own search and spend gas creating a
            Safe they do not control.

            Owners in full, not a count: the owner set is what determines control of the Safe, and
            "1 owner" is nothing a user can check on the one screen whose entire job is checking.
            `break-all` for the same reason the address above uses it. Subordinate to the blockie
            and the address by size and weight — those remain the thing being verified. */}
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <h3 className="text-sm font-medium">Safe config</h3>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Owners</dt>
            <dd className="flex min-w-0 flex-col gap-1">
              {config.owners.map((owner) => (
                <code key={owner} className="break-all">
                  {owner}
                </code>
              ))}
            </dd>
            <dt className="text-muted-foreground">Threshold</dt>
            <dd>
              {config.threshold} of {config.owners.length}
            </dd>
            <dt className="text-muted-foreground">Safe version</dt>
            <dd>{config.safeVersion}</dd>
            {/* No chain row. These three are what the ADDRESS is derived from and what a user
                cannot change without invalidating it; the chain is not one of them — the same
                address is this Safe's address on all six non-mainnet chains (measured; see
                lib/config.ts), and it is a live control in the header that can move while this
                dialog is open. Listing it here as though it were a property of the config would
                have made it the one line in this block that changes under the reader. Where the
                gas goes is still named, once, in the description above — which is the sentence
                about spending money, and which follows the header. */}
          </dl>
        </div>

        <p className="text-sm text-muted-foreground">
          You do not have to deploy now: this address exists whether or not you do, so you can
          copy the share link and deploy it later, on any chain with the canonical Safe contracts.
        </p>

        {/* The saltNonce in the spread is the entire payload: without it the link degrades from
            "reproduces this exact address" to "prefills four form fields", silently. This moved
            here from DeployPanel, which was the only place a mined result could be preserved
            without deploying it — closing this dialog now has to be able to leave with the link,
            or that escape route disappears with the panel. */}
        <ShareConfig config={{ ...config, saltNonce: candidate.saltNonce }} />

        {/* Always mounted, even while empty. A live region only announces changes to a container
            that was already there when the text arrived — mounting the <p> together with its
            first message (which is what `{status && …}` did) announces nothing at all, and this
            is where the transaction hash and "Safe deployed at 0x…" appear. */}
        <div aria-live="polite">
          {status && <p className="text-sm break-all">{status}</p>}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="break-all">{error}</AlertDescription>
          </Alert>
        )}
        {!client && isConnected && <p className="text-sm">Waiting for the wallet client…</p>}

        <DialogFooter>
          <DialogClose asChild>
            {/* Never reads as "cancel the deployment" while one is running: nothing here can
                recall a transaction the wallet has been handed. */}
            <Button type="button" variant="ghost">
              {busy ? 'Close and keep waiting' : 'Cancel'}
            </Button>
          </DialogClose>
          {/* Sits where the deploy button will be once there is a wallet, rather than as a line of
              prose further up: connecting is the next action here, so it belongs among the
              actions. `connectors[0]` is safe to reach for — lib/wagmi always configures
              injected(), and EIP-6963 discovery only ever appends to that list. It does mean a
              browser announcing several wallets connects the first rather than offering a choice;
              the header's ConnectButton is the one that lists them all. */}
          {!isConnected && (
            <Button
              type="button"
              disabled={isConnecting || connectors.length === 0}
              onClick={() => {
                const connector = connectors[0]
                if (connector) connect({ connector })
              }}
            >
              Connect a wallet to deploy
            </Button>
          )}
          {wrongChain && (
            <Button type="button" onClick={() => switchChain({ chainId: config.chainId })}>
              Switch network to continue
            </Button>
          )}
          {isConnected && !wrongChain && (
            <Button
              type="button"
              disabled={busy || completed}
              onClick={async () => {
                if (!client || !address) return
                setError(undefined)
                setBusy(true)
                // Hoisted so the catch block can still report them if something fails after the
                // point they were set — a lost hash (or a lost "we don't know") after gas may
                // already be spent is worse than an error.
                let hash: `0x${string}` | undefined
                let sendDispatched = false
                try {
                  setStatus('Reading Safe constants…')
                  // Mining stops here rather than when the candidate was selected: everything
                  // below reads an address the user is about to spend gas on.
                  onDeployStart()
                  const { loadSafeConstants } = await import('@safe-vanity-blockie/safe-config')
                  const { chainById } = await import('../lib/wagmi')
                  // Re-read rather than reuse anything already computed for mining: that is what
                  // keeps this an independent constants source for the deriver cross-check below,
                  // not a re-check of our own cached values.
                  const setup = await loadSafeConstants({
                    rpcUrl: chainById(config.chainId).rpcUrls.default.http[0],
                    owners: config.owners,
                    threshold: config.threshold,
                    safeVersion: config.safeVersion,
                  })

                  setStatus('Checking the address before spending anything…')
                  const { buildDeploymentPlan } = await import('../lib/deploy')
                  const plan = await buildDeploymentPlan({
                    setup,
                    saltNonce: candidate.saltNonce,
                    provider: client.transport as never,
                    signer: address,
                    chainId: config.chainId,
                  })

                  // Ties the plan built for the send path to the candidate the user actually picked
                  // and is looking at on screen. Cannot diverge today (both derive from the same
                  // saltNonce and config), but a saltNonce arriving from elsewhere (e.g. a share
                  // link) would make this reachable, so it is checked before anything is spent.
                  if (plan.address.toLowerCase() !== candidate.address.toLowerCase()) {
                    throw new Error(
                      `Deployment plan address ${plan.address} does not match the selected ` +
                        `candidate ${candidate.address}. Refusing to deploy.`,
                    )
                  }

                  setStatus(`Sending — confirm in your wallet to deploy ${plan.address}…`)
                  // useConnectorClient() returns a plain viem Client, not one extended with wallet
                  // actions, so sendTransaction is called as a standalone action against it.
                  const { sendTransaction } = await import('viem/actions')
                  sendDispatched = true
                  hash = await sendTransaction(client, {
                    to: plan.transaction.to as `0x${string}`,
                    value: BigInt(plan.transaction.value),
                    data: plan.transaction.data as `0x${string}`,
                  })
                  setStatus(`Sent ${hash}. Waiting for confirmation…`)

                  const { createPublicClient, http } = await import('viem')
                  const publicClient = createPublicClient({
                    chain: chainById(config.chainId),
                    transport: http(),
                  })
                  const receipt = await publicClient.waitForTransactionReceipt({ hash })
                  if (receipt.status !== 'success') {
                    setStatus(undefined)
                    // Mirrored into a toast on every terminal branch below, and never *instead*
                    // of the inline message: <Toaster/> is mounted in app/layout.tsx, outside
                    // every subtree that can unmount here, so it is the only channel that
                    // survives "Start over" or closing this dialog while the send is still in
                    // flight — which now unmounts it, and with it every inline message. The
                    // inline copy stays because a toast is on a timer and this is something the
                    // user has to act on.
                    reportError(`Deployment reverted. Gas was spent. Transaction ${hash}.`)
                    return
                  }

                  // The transaction succeeded, but success only means the calldata protocol-kit
                  // built for `plan.address` executed without reverting — it does not by itself
                  // prove a Safe now exists at that address. Read the address the deployment
                  // actually produced back out of the receipt's logs and cross-check it before
                  // telling the user it worked.
                  const { getSafeAddressFromDeploymentTx } = await import(
                    '@safe-global/protocol-kit'
                  )
                  const deployed = getSafeAddressFromDeploymentTx(receipt, config.safeVersion)
                  if (deployed.toLowerCase() !== plan.address.toLowerCase()) {
                    setStatus(undefined)
                    reportError(
                      `Deployed address ${deployed} does not match the predicted ${plan.address}. ` +
                        `Transaction ${hash}.`,
                    )
                    return
                  }

                  setCompleted(true)
                  const success = `Safe deployed at ${deployed}. Transaction ${hash}.`
                  setStatus(success)
                  toast.success(success)
                } catch (thrown) {
                  setStatus(undefined)
                  const message = thrown instanceof Error ? thrown.message : String(thrown)
                  if (hash) {
                    reportError(
                      `${message} Transaction ${hash} was already sent — check its status before retrying.`,
                    )
                  } else if (sendDispatched) {
                    reportError(
                      `${message} The transaction may already have been broadcast — check your ` +
                        "wallet's activity list before retrying.",
                    )
                  } else {
                    reportError(message)
                  }
                } finally {
                  setBusy(false)
                  onDeploySettled()
                }
              }}
            >
              {busy ? 'Deploying…' : 'Deploy this Safe'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
