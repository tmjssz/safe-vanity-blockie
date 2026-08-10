'use client'

import { formatScore, type Candidate } from '@safe-vanity-blockie/core'
import { useState } from 'react'
import { useAccount, useConnectorClient, useSwitchChain } from 'wagmi'
import type { MineConfig } from '../lib/config'
import { ShareConfig } from './ShareConfig'
import { Blockie } from './Blockie'

export function DeployPanel({ config, candidate }: { config: MineConfig; candidate: Candidate }) {
  const { isConnected, address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { data: client } = useConnectorClient()
  const [status, setStatus] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)

  const wrongChain = isConnected && chainId !== config.chainId

  return (
    <section>
      <h2>Deploy</h2>
      <Blockie address={candidate.address} size={128} />
      <p>
        <strong>{formatScore(candidate.score, candidate.maxScore)}</strong> ·{' '}
        <code>{candidate.address}</code> · saltNonce <code>{candidate.saltNonce}</code>
      </p>
      <p className="notice">
        <strong>A matching identicon is cosmetic.</strong> Verify the full address before you
        send anything — a look-alike blockie is a known phishing vector.
      </p>
      <p>
        This config is counterfactual: the address exists whether or not you deploy, so you can
        copy it and deploy it later, on any chain with the canonical Safe contracts.
      </p>
      <ShareConfig config={{ ...config, saltNonce: candidate.saltNonce }} />

      {!isConnected && <p>Connect a wallet to deploy.</p>}
      {wrongChain && (
        <button type="button" onClick={() => switchChain({ chainId: config.chainId })}>
          Switch network to continue
        </button>
      )}
      {isConnected && !wrongChain && (
        <button
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
              const { getSafeAddressFromDeploymentTx } = await import('@safe-global/protocol-kit')
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
              setStatus(`Safe deployed at ${deployed}.`)
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
            }
          }}
        >
          {busy ? 'Deploying…' : 'Deploy this Safe'}
        </button>
      )}
      {status && <p>{status}</p>}
      {error && <p role="alert">{error}</p>}
      {!client && isConnected && <p>Waiting for the wallet client…</p>}
    </section>
  )
}
