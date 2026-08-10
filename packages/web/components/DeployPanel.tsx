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
          onClick={async () => {
            if (!client || !address) return
            setError(undefined)
            // Hoisted so the catch block can still report it if waitForTransactionReceipt
            // fails after broadcast — a lost hash after gas is spent is worse than an error.
            let hash: `0x${string}` | undefined
            try {
              setStatus('Reading Safe constants…')
              const { loadSafeConstants } = await import('@safe-vanity-blockie/safe-config')
              const { chainById } = await import('../lib/wagmi')
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

              setStatus(`Sending — confirm in your wallet to deploy ${plan.address}…`)
              // useConnectorClient() returns a plain viem Client, not one extended with wallet
              // actions, so sendTransaction is called as a standalone action against it.
              const { sendTransaction } = await import('viem/actions')
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
              setStatus(`Safe deployed at ${plan.address}.`)
            } catch (thrown) {
              setStatus(undefined)
              const message = thrown instanceof Error ? thrown.message : String(thrown)
              setError(
                hash
                  ? `${message} Transaction ${hash} was already sent — check its status before retrying.`
                  : message,
              )
            }
          }}
        >
          Deploy this Safe
        </button>
      )}
      {status && <p>{status}</p>}
      {error && <p role="alert">{error}</p>}
      {!client && isConnected && <p>Waiting for the wallet client…</p>}
    </section>
  )
}
