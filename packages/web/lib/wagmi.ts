import type { Chain } from 'viem'
import { createConfig, http } from 'wagmi'
import { arbitrum, base, gnosis, mainnet, optimism, polygon, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

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

export interface ChainExplorer {
  /** The explorer's own name, so a link can say where it goes: "on Etherscan". */
  name: string
  tx: (hash: string) => string
  address: (address: string) => string
}

/**
 * Where to look a transaction or an address up, for the chain a Safe is being deployed on.
 *
 * Read off viem's own chain definition rather than from a table here: all seven supported chains
 * carry one, and a hand-maintained list of explorer hosts is a list that goes stale silently. It is
 * also why these links go to a block explorer rather than to app.safe.global, which would need a
 * per-chain short-name prefix (`eth:`, `matic:`, …) that no data this app already has can supply.
 *
 * Undefined when a chain has no explorer, so a caller degrades to plain text rather than to a
 * link that goes nowhere.
 */
export function explorerFor(chainId: number): ChainExplorer | undefined {
  const explorer = chainById(chainId).blockExplorers?.default
  if (!explorer) return undefined
  const base = explorer.url.replace(/\/$/, '')
  return {
    name: explorer.name,
    tx: (hash) => `${base}/tx/${hash}`,
    address: (address) => `${base}/address/${address}`,
  }
}

/**
 * Wagmi config for MetaMask only. `target: 'metaMask'` pins the injected connector to that one
 * wallet rather than accepting whatever `window.ethereum` happens to be, and it also turns off
 * the EIP-6963 discovery that would otherwise add a connector — and so a button — per wallet the
 * browser announces. One wallet means one connect control everywhere, and no screen has to ask
 * the user to choose between providers before it can do anything.
 *
 * Deliberately not WalletConnect: it would require a Reown/WalletConnect Cloud project id, which
 * would become a required secret for anyone running this app.
 *
 * Transports use each chain's default public RPC (no API key) — mining reads it before any
 * wallet connects, so it must work unauthenticated.
 */
export const wagmiConfig = createConfig({
  chains: CHAIN_LIST,
  connectors: [injected({ target: 'metaMask' })],
  transports: Object.fromEntries(CHAIN_LIST.map((chain) => [chain.id, http()])) as never,
})
