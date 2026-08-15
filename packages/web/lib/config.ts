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
 * Which Safe singleton protocol-kit deploys through, per chain — the ONLY thing about a chain that
 * reaches the Safe address, and therefore the only reason a chain switch can cost results.
 *
 * These are MEASURED, chain by chain, against live RPCs — not a rule with mainnet special-cased,
 * and deliberately not derived from one. For all seven chains below:
 *
 *   - the proxy factory is identical: 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
 *   - the initializerHash is identical (it is owners, threshold and version, and nothing else)
 *   - both singletons are deployed at identical addresses everywhere
 *   - the initCodeHash takes exactly two values: 0x76733d70… on mainnet, and 0xe298282c… on
 *     sepolia, polygon, arbitrum, optimism, base and gnosis
 *
 * The cause was isolated by forcing `isL1SafeSingleton` both ways: mainnet with it false produces
 * exactly polygon's hash, and polygon with it true produces exactly mainnet's. So it is the
 * singleton protocol-kit picks that splits them, and the per-chain default is kept precisely so
 * every chain gets its conventional, properly-indexed deployment.
 *
 * A chain that is not in either set has not been measured, and `safeSingletonFor` says so by
 * returning undefined rather than guessing — see `chainSwitchDiscardsResults`, which then treats a
 * switch involving it as one that costs results. Adding a chain to SUPPORTED_CHAINS without adding
 * it here fails test/config.test.ts, which is the point: the entry belongs to whoever measured it.
 */
const L1_SINGLETON_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, // Ethereum
])
const L2_SINGLETON_CHAIN_IDS: ReadonlySet<number> = new Set([
  11155111, // Sepolia
  137, // Polygon
  42161, // Arbitrum One
  10, // OP Mainnet
  8453, // Base
  100, // Gnosis
])

/** The measured singleton for a chain, or undefined for one nobody has measured. */
export function safeSingletonFor(chainId: number): 'Safe.sol' | 'SafeL2.sol' | undefined {
  if (L1_SINGLETON_CHAIN_IDS.has(chainId)) return 'Safe.sol'
  if (L2_SINGLETON_CHAIN_IDS.has(chainId)) return 'SafeL2.sol'
  return undefined
}

/**
 * Whether moving a search from one chain to another changes the addresses it has already found —
 * i.e. whether the results on screen have to be discarded rather than carried across.
 *
 * False only when both chains are measured and share a singleton, so switching among the six is
 * free and every mined address stays exactly as valid as it was. Anything else — the mainnet
 * boundary, or a chain nobody has measured — is true, which costs a confirmation and a reset. That
 * asymmetry is the safe one: asking about a switch that would in fact have been free is a dialog,
 * while not asking about one that is not is a leaderboard silently invalidated.
 */
export function chainSwitchDiscardsResults(from: number, to: number): boolean {
  if (from === to) return false
  const before = safeSingletonFor(from)
  const after = safeSingletonFor(to)
  if (before === undefined || after === undefined) return true
  return before !== after
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

/**
 * 80 rather than 0, on a scale that runs to 442. Zero accepts a pair whose two colours differ by
 * less than the eye reliably separates, so a face drawn in them is not a face anybody was hoping
 * to mine — which made the first run every user sees the least useful one, with the slider left
 * to be discovered before the results got better.
 */
export const DEFAULT_FACE_FILTERS: FaceFilters = { twoColor: true, minContrast: 80 }

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/**
 * Whether one owner entry is an address this app can mine for. Exported so the form can gate its
 * submit button per row WITHOUT growing a second address check: validateMineConfig below is the
 * definition, and it answers this question by calling exactly this. Two predicates that agree
 * today is how a button ends up enabled over an address the validator then rejects — or, worse,
 * disabled over one it would have accepted, with nothing on screen to fix.
 *
 * Trims, because the validator does: leading whitespace off a paste is not a malformed address.
 */
export function isOwnerAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value.trim())
}

/** The one wording for "that is not an address", so the row and the submit say the same thing. */
export function ownerAddressError(value: string): string {
  return `"${value.trim()}" is not a valid address.`
}

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
    const invalid = owners.find((owner) => !isOwnerAddress(owner))
    if (invalid) {
      errors.owners = ownerAddressError(invalid)
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
