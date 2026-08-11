'use client'

import type { Candidate } from '@safe-vanity-blockie/core'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useAccount, useConnectorClient, useSwitchChain } from 'wagmi'
import { SUPPORTED_CHAINS, type MineConfig } from '../lib/config'
import { Blockie } from './Blockie'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
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
  const { data: client } = useConnectorClient()
  const [status, setStatus] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)

  const wrongChain = isConnected && chainId !== config.chainId
  const chainName = SUPPORTED_CHAINS.find((entry) => entry.id === config.chainId)?.name

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Deploy this Safe</DialogTitle>
          <DialogDescription>
            Your wallet will ask you to confirm a transaction that spends gas
            {chainName ? ` on ${chainName}` : ''}.
          </DialogDescription>
        </DialogHeader>

        {/* The caveat is repeated here on purpose: this is the screen where money is actually
            spent, and it is the last place it can still do any good. */}
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>A matching identicon is cosmetic.</AlertTitle>
          <AlertDescription>
            Check every character of the address below before you confirm — a look-alike blockie
            is a known phishing vector.
          </AlertDescription>
        </Alert>

        <div className="flex items-center gap-4 rounded-lg border p-4">
          <Blockie address={candidate.address} size={64} />
          <div className="flex min-w-0 flex-col gap-1">
            <code className="break-all text-sm">{candidate.address}</code>
            <code className="text-xs text-muted-foreground">saltNonce {candidate.saltNonce}</code>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          You do not have to deploy now: this address exists whether or not you do, so you can
          copy the share link and deploy it later, on any chain with the canonical Safe contracts.
        </p>

        {!isConnected && <p className="text-sm">Connect a wallet to deploy.</p>}
        {status && <p className="text-sm break-all">{status}</p>}
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="break-all">{error}</AlertDescription>
          </Alert>
        )}
        {!client && isConnected && <p className="text-sm">Waiting for the wallet client…</p>}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
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
                    setError(`Deployment reverted. Gas was spent. Transaction ${hash}.`)
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
                    setError(
                      `Deployed address ${deployed} does not match the predicted ${plan.address}. ` +
                        `Transaction ${hash}.`,
                    )
                    return
                  }

                  setCompleted(true)
                  setStatus(`Safe deployed at ${deployed}. Transaction ${hash}.`)
                } catch (thrown) {
                  setStatus(undefined)
                  const message = thrown instanceof Error ? thrown.message : String(thrown)
                  if (hash) {
                    setError(
                      `${message} Transaction ${hash} was already sent — check its status before retrying.`,
                    )
                  } else if (sendDispatched) {
                    setError(
                      `${message} The transaction may already have been broadcast — check your ` +
                        "wallet's activity list before retrying.",
                    )
                  } else {
                    setError(message)
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
