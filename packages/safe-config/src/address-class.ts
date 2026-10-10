import {
  getCompatibilityFallbackHandlerDeployment,
  getProxyFactoryDeployment,
  getSafeL2SingletonDeployment,
  getSafeSingletonDeployment,
  type SingletonDeployment,
} from '@safe-global/safe-deployments'
import { ZKSYNC_CHAIN_IDS } from './setup.js'
import type { SupportedSafeVersion } from './versions.js'

/**
 * Chains on which protocol-kit defaults to the L1 singleton (Safe.sol) rather than SafeL2.sol.
 * Mirrors protocol-kit's own `safeDeploymentsL1ChainIds`, which it does not export.
 */
const L1_SINGLETON_CHAIN_IDS: ReadonlySet<number> = new Set([1])

/** The address protocol-kit resolves for a deployment on a chain: the first one listed. */
function deployedAddress(
  deployment: SingletonDeployment | undefined,
  chainId: number,
): string | undefined {
  const addresses = deployment?.networkAddresses[String(chainId)]
  return (Array.isArray(addresses) ? addresses[0] : addresses)?.toLowerCase()
}

function resolveAddressClass(
  chainId: number,
  safeVersion: SupportedSafeVersion,
): string | undefined {
  // Same contract addresses, different CREATE2 formula: sharing them says nothing about the Safe.
  if (ZKSYNC_CHAIN_IDS.has(BigInt(chainId))) return undefined
  const filter = { version: safeVersion, network: String(chainId), released: true }
  const singleton = L1_SINGLETON_CHAIN_IDS.has(chainId)
    ? getSafeSingletonDeployment(filter)
    : getSafeL2SingletonDeployment(filter)
  const parts = [
    deployedAddress(getProxyFactoryDeployment(filter), chainId),
    deployedAddress(singleton, chainId),
    deployedAddress(getCompatibilityFallbackHandlerDeployment(filter), chainId),
  ]
  return parts.every((part) => part !== undefined) ? parts.join(' ') : undefined
}

const classes = new Map<string, string | undefined>()

/**
 * Which chains give a Safe the same address, per Safe version: two chains with the same class give
 * every (owners, threshold, saltNonce) the same address, and two with different classes do not.
 *
 * Resolved from safe-deployments the way `loadSafeConstants` resolves it through protocol-kit: the
 * proxy factory, the singleton (L1 on mainnet, L2 elsewhere — protocol-kit's default, so a forced
 * `isL1SafeSingleton` is not modelled) and the compatibility fallback handler, each the first
 * address listed for the chain. Those three are what a chain contributes to a standard-EVM Safe
 * address — the factory directly, the singleton through the initCodeHash, and the handler through
 * the initializerHash. test/address-class.test.ts pins the resulting partition against what was
 * measured on live RPCs.
 *
 * Undefined for a chain safe-deployments has no deployment for, and for zkSync-family chains.
 */
export function addressClassFor(
  chainId: number,
  safeVersion: SupportedSafeVersion,
): string | undefined {
  const key = `${chainId}:${safeVersion}`
  if (!classes.has(key)) classes.set(key, resolveAddressClass(chainId, safeVersion))
  return classes.get(key)
}
