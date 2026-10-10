import { getEip3770NetworkPrefixFromChainId } from '@safe-global/protocol-kit'
import { SUPPORTED_CHAINS } from './config'

/**
 * Where to open a deployed Safe in Safe's own web app.
 *
 * The `sep:` in `?safe=sep:0x…` is not decoration: app.safe.global reads the chain out of that
 * prefix, so the wrong one opens a different network's Safe at the same address, or nothing at all.
 * The prefix comes from protocol-kit's own EIP-3770 table, the one Safe's apps use.
 *
 * Undefined for a chain the app does not offer or protocol-kit has no prefix for, so a caller shows
 * no button rather than a link to the wrong place. Not reachable today — the picker only offers
 * SUPPORTED_CHAINS, and protocol-kit names all of them.
 */
export function safeWalletUrl(chainId: number, address: string): string | undefined {
  if (!SUPPORTED_CHAINS.some((chain) => chain.id === chainId)) return undefined
  let shortName: string
  try {
    shortName = getEip3770NetworkPrefixFromChainId(BigInt(chainId))
  } catch {
    // protocol-kit throws for a chain its table lacks; this is called during render.
    return undefined
  }
  return `https://app.safe.global/home?safe=${shortName}:${address}`
}
