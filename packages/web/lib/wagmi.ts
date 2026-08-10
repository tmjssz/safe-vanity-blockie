import { arbitrum, base, gnosis, mainnet, optimism, polygon, sepolia } from 'wagmi/chains'
import type { Chain } from 'viem'

/** Chains this app offers, keyed by chain ID — must stay in sync with `SUPPORTED_CHAINS`. */
const CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [polygon.id]: polygon,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [base.id]: base,
  [gnosis.id]: gnosis,
}

/** Looks up a supported chain by ID. Throws for anything not in `SUPPORTED_CHAINS`. */
export function chainById(chainId: number): Chain {
  const chain = CHAINS[chainId]
  if (!chain) throw new Error(`Chain ${chainId} is not supported.`)
  return chain
}
