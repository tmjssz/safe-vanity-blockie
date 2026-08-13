import { ZKSYNC_CHAIN_IDS } from '@safe-vanity-blockie/safe-config'

export const SUPPORTED_SAFE_VERSIONS = ['1.4.1', '1.3.0'] as const
export type SupportedSafeVersion = (typeof SUPPORTED_SAFE_VERSIONS)[number]

/** Chains with canonical Safe deployments that this app offers. */
export const SUPPORTED_CHAINS = [
  { id: 1, name: 'Ethereum' },
  { id: 11155111, name: 'Sepolia' },
  { id: 137, name: 'Polygon' },
  { id: 42161, name: 'Arbitrum One' },
  { id: 10, name: 'OP Mainnet' },
  { id: 8453, name: 'Base' },
  { id: 100, name: 'Gnosis' },
] as const

/** The chain the header starts on, and what an unseeded config is mined for. */
export const DEFAULT_CHAIN_ID: number = SUPPORTED_CHAINS[0].id

/**
 * Which Safe singleton protocol-kit deploys through on a given chain: `Safe.sol` on mainnet,
 * `SafeL2.sol` everywhere else. That default is deliberately left alone — every chain then gets
 * its own conventional, properly-indexed deployment — and this function is where the consequence
 * is written down.
 *
 * It is the ONLY thing about a chain that reaches the address. Measured against live RPCs on all
 * seven supported chains: the proxy factory (0x4e1DCf7AD…) and the initializer hash (owners,
 * threshold and version, and nothing else) are identical everywhere, and the initCodeHash takes
 * exactly two values — one for mainnet, one shared by sepolia, polygon, arbitrum, optimism, base
 * and gnosis. Forcing `isL1SafeSingleton` both ways swaps them, which is what identifies the
 * singleton rather than the chain as the cause.
 */
export function safeSingletonFor(chainId: number): 'Safe.sol' | 'SafeL2.sol' {
  return chainId === 1 ? 'Safe.sol' : 'SafeL2.sol'
}

/**
 * Whether moving a search from one chain to another changes the addresses it has already found —
 * i.e. whether the results on screen have to be discarded rather than carried across.
 *
 * True only when the two chains deploy through different singletons, so switching among the six
 * non-mainnet chains is free and every mined address stays exactly as valid as it was; crossing
 * the mainnet boundary in either direction is not.
 */
export function chainSwitchDiscardsResults(from: number, to: number): boolean {
  return safeSingletonFor(from) !== safeSingletonFor(to)
}

export interface MineConfig {
  owners: string[]
  threshold: number
  safeVersion: SupportedSafeVersion
  chainId: number
}

export type ConfigErrors = Partial<
  Record<'owners' | 'threshold' | 'safeVersion' | 'chainId', string>
>

/** Filters applied to candidates before they can be reported as a match. */
export interface FaceFilters {
  /** Reject candidates whose blockie uses the spot colour — the common case to want. */
  twoColor: boolean
  /** Minimum RGB distance required between the two blockie colours. 0-442; 442 is black/white. */
  minContrast: number
}

export const DEFAULT_FACE_FILTERS: FaceFilters = { twoColor: true, minContrast: 0 }

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

export function validateMineConfig(input: {
  owners: string[]
  threshold: number
  safeVersion: string
  chainId: number
}): { config?: MineConfig; errors: ConfigErrors } {
  const errors: ConfigErrors = {}

  const owners = input.owners.map((owner) => owner.trim()).filter((owner) => owner.length > 0)
  if (owners.length === 0) {
    errors.owners = 'Add at least one owner address.'
  } else {
    const invalid = owners.find((owner) => !ADDRESS_PATTERN.test(owner))
    if (invalid) {
      errors.owners = `"${invalid}" is not a valid address.`
    } else {
      const seen = new Set<string>()
      const duplicate = owners.find((owner) => {
        const key = owner.toLowerCase()
        if (seen.has(key)) return true
        seen.add(key)
        return false
      })
      if (duplicate) errors.owners = `Duplicate owner ${duplicate}.`
    }
  }

  if (!Number.isInteger(input.threshold) || input.threshold < 1) {
    errors.threshold = 'Threshold must be at least 1.'
  } else if (!errors.owners && input.threshold > owners.length) {
    errors.threshold = `Threshold ${input.threshold} exceeds the ${owners.length} owner${
      owners.length === 1 ? '' : 's'
    }.`
  }

  if (!SUPPORTED_SAFE_VERSIONS.includes(input.safeVersion as SupportedSafeVersion)) {
    errors.safeVersion = `Unsupported Safe version "${input.safeVersion}".`
  }

  if (!Number.isInteger(input.chainId)) {
    errors.chainId = `Chain ${input.chainId} is not supported.`
  } else if (ZKSYNC_CHAIN_IDS.has(BigInt(input.chainId))) {
    errors.chainId = 'zkSync-based chains derive addresses with a different formula.'
  } else if (!SUPPORTED_CHAINS.some((chain) => chain.id === input.chainId)) {
    errors.chainId = `Chain ${input.chainId} is not supported.`
  }

  if (Object.keys(errors).length > 0) return { errors }
  return {
    config: {
      owners,
      threshold: input.threshold,
      safeVersion: input.safeVersion as SupportedSafeVersion,
      chainId: input.chainId,
    },
    errors: {},
  }
}
