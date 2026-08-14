'use client'

import { formatScore, type Candidate } from '@safe-vanity-blockie/core'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAccount, useConnect, useConnectorClient, useSwitchChain } from 'wagmi'
import { SUPPORTED_CHAINS, type MineConfig } from '../lib/config'
import { Blockie, DecorativeBlockie } from './Blockie'
import { ShareConfig } from './ShareConfig'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
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
       Radix drops the overlay entirely (`DialogOverlay` renders nothing at all when
       `modal={false}`), stops trapping focus and hides nothing, so the page behind really is the
       page — and the backdrop below is this component's own, drawn precisely so it can stop where
       the header starts. What follows from it is handled in page.tsx: the header's chain carries
       the open selection with it, and a card behind this dialog is out of a pointer's reach but
       still in the accessibility tree. */
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      {/* The backdrop, and the reason it is not `inset-0`. It darkens and blurs everything BELOW
          the sticky header — `top-14` is that header's own `h-14` in app/layout.tsx, the same
          relationship MiningStatusBar's `top-14` already depends on — and nothing above it, so the
          one control this dialog went non-modal for stays lit, unblurred and usable while the rest
          of the page is visibly and actually out of play. `bg-background/60 backdrop-blur-sm` is
          the share-link resolving overlay's language in page.tsx, deliberately: same app, same
          meaning. That overlay keeps `inset-0` and keeps covering the header, which is a different
          statement — nothing on the page is usable while a link resolves.

          `z-45`: above the page content and the mining status bar (`z-40`) so it really blocks
          them, below this dialog's content and the header (both `z-50`) so it covers neither, and
          below the chain selector's popover (`z-50` in ui/select.tsx) so the header's control
          opens over it rather than under it. Tailwind v4 generates this from the bare integer;
          the built stylesheet was checked rather than assumed, because a dropped class here fails
          silently and invisibly to every test in jsdom.

          Its click closes — the one dismissal-by-pointer this dialog has, and what earns it is
          that there is nothing on this sheet to reach for, so a click on it cannot be a reach for
          anything else. Not while busy, for exactly the reasons Escape and the X are refused for
          that window: a send in flight has nowhere else to report itself inline.

          `aria-hidden`, and a div rather than a button: it is the pointer's shorthand for
          "close", and it takes nothing away from a keyboard or screen reader user, who still has
          Escape, the X and the footer button. Inside DialogPortal so it mounts and unmounts with
          the dialog and lands in the same portal layer, before the content and therefore under
          it. */}
      <DialogPortal>
        <div
          data-slot="deploy-dialog-backdrop"
          aria-hidden="true"
          className="fixed inset-x-0 top-14 bottom-0 z-45 bg-background/60 backdrop-blur-sm"
          onClick={() => {
            if (!busy) onOpenChange(false)
          }}
        />
      </DialogPortal>
      {/* While the sequence is in flight this dialog is the ONLY place its outcome can be read
          inline, and closing it unmounts the dialog outright — page.tsx renders it only while a
          candidate is selected, keyed on that candidate's address, and clears the selection when
          it closes. So the *accidental* dismissals are blocked: Escape and the X while busy,
          Radix's own "interaction outside" always, and the backdrop's click while busy.

          Radix's `onInteractOutside` still never dismisses, and that is not the same rule as "a
          click outside never dismisses" any more. It fires for the header, for a focus move off
          the last control and for the backdrop alike, and telling them apart there would mean
          depending on which chain-selector internals happen to sit in this layer's stack — so
          reaching for the header (the entire point of this dialog being non-modal) or tabbing out
          cannot throw away the result that reach was for. The sheet of dark glass whose only
          possible purpose is "dismiss this" carries that meaning on its own click handler
          instead, above, where it is unambiguous and where the header is exempt by construction
          rather than by a special case. Activating another result card still replaces what is on
          screen — the backdrop takes the pointer route to the grid away (a mouse click there lands
          on the backdrop and closes this), and Tab never went that way in the first place: Radix's
          FocusScope keeps `loop` on for a non-modal dialog too, so Tab cycles inside this content
          rather than walking out of it (measured in a browser, 120 presses). What is left is the
          accessibility tree — nothing behind is `aria-hidden`, `inert` or pointer-events-none, so
          an assistive technology's virtual cursor can still focus a card and activate it. That
          goes through page.tsx's `selectFromGrid` and its `key`, not through a dismissal.

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
        <Alert role="note" variant="warning">
          <ShieldAlert className="h-4 w-4" />
          {/* The same box the About dialog and the results callout draw, in the same amber and
              with the lead running into the body rather than stacked above it. Met three times in
              one session it has to read as one warning, not three that begin alike. The wording
              stays this screen's own: "the address below", "before you confirm" — the others are
              read while browsing, this one while about to spend. */}
          <AlertDescription>
            <p>
              <strong className="font-medium">A matching identicon is cosmetic.</strong> Check
              every character of the address below before you confirm. A look-alike blockie is a
              known phishing vector.
            </p>
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
        {/* No heading of its own: three labelled rows inside a dialog whose title already says
            what is being deployed, and "Safe config" was a label for the thing its own labels
            were naming. */}
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Owners</dt>
            <dd className="flex min-w-0 flex-col gap-1.5">
              {/* Each owner beside the identicon its address produces. This is the screen where
                  the Safe is paid for, and the owner set is what determines control of it: a
                  reader who recognises their own blockie has a check that reading 42 hex
                  characters does not give them. Decorative, since the address is right there. */}
              {config.owners.map((owner) => (
                <span key={owner} className="flex min-w-0 items-start gap-2">
                  <DecorativeBlockie
                    address={owner}
                    size={16}
                    slot="owner-identicon"
                    className="mt-0.5 size-4 rounded-sm"
                  />
                  <code className="break-all">{owner}</code>
                </span>
              ))}
            </dd>
            <dt className="text-muted-foreground">Threshold</dt>
            {/* "signers" always, including at 1 of 1: "N of M signers" is how a multisig
                threshold is written, and it is the same phrase the status bar uses. */}
            <dd>
              {config.threshold} of {config.owners.length} signers
            </dd>
            <dt className="text-muted-foreground">Safe version</dt>
            <dd>
              <Badge variant="secondary" className="font-mono">
                {config.safeVersion}
              </Badge>
            </dd>
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

                  setStatus(`Sending: confirm in your wallet to deploy ${plan.address}…`)
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
                      `${message} Transaction ${hash} was already sent. Check its status before retrying.`,
                    )
                  } else if (sendDispatched) {
                    reportError(
                      `${message} The transaction may already have been broadcast. Check your ` +
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
