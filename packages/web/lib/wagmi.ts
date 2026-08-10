import { arbitrum, base, gnosis, mainnet, optimism, polygon, sepolia } from 'wagmi/chains'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import type { Chain } from 'viem'

/** Chains this app offers, in order — must stay in sync with `SUPPORTED_CHAINS`. */
const CHAIN_LIST = [mainnet, sepolia, polygon, arbitrum, optimism, base, gnosis] as const

/** Chains this app offers, keyed by chain ID — must stay in sync with `SUPPORTED_CHAINS`. */
const CHAINS: Record<number, Chain> = Object.fromEntries(
  CHAIN_LIST.map((chain) => [chain.id, chain]),
)

/** Looks up a supported chain by ID. Throws for anything not in `SUPPORTED_CHAINS`. */
export function chainById(chainId: number): Chain {
  const chain = CHAINS[chainId]
  if (!chain) throw new Error(`Chain ${chainId} is not supported.`)
  return chain
}

/**
 * Wagmi config for injected wallets only. EIP-6963 discovery is on by default, so every
 * injected wallet the browser announces appears without naming any of them here. No
 * WalletConnect: it would require a Reown/WalletConnect Cloud project id, which would become
 * a required secret for anyone running this app.
 *
 * Transports use each chain's default public RPC (no API key) — mining reads it before any
 * wallet connects, so it must work unauthenticated.
 */
export const wagmiConfig = createConfig({
  chains: CHAIN_LIST,
  connectors: [injected()],
  transports: Object.fromEntries(CHAIN_LIST.map((chain) => [chain.id, http()])) as never,
})
