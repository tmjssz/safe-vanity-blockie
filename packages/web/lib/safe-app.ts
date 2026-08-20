import { SUPPORTED_CHAINS } from './config'

/**
 * Where to open a deployed Safe in Safe's own web app.
 *
 * The `sep:` in `?safe=sep:0x…` is not decoration: app.safe.global reads the chain out of that
 * prefix, so the wrong one opens a different network's Safe at the same address, or nothing at all.
 * The prefixes live on SUPPORTED_CHAINS, beside the chains they name, so the two cannot drift.
 *
 * Undefined for a chain with no prefix, so a caller shows no button rather than a link to the wrong
 * place. Not reachable today — the picker only offers SUPPORTED_CHAINS — and that is why it returns
 * nothing instead of guessing.
 */
export function safeWalletUrl(chainId: number, address: string): string | undefined {
  const shortName = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.safeShortName
  if (!shortName) return undefined
  return `https://app.safe.global/home?safe=${shortName}:${address}`
}
