import { ZKSYNC_CHAIN_IDS } from '@safe-vanity-blockie/safe-config'
import { WORKER_BLOCK } from './worker-protocol'

export const SUPPORTED_SAFE_VERSIONS = ['1.4.1', '1.3.0'] as const
export type SupportedSafeVersion = (typeof SUPPORTED_SAFE_VERSIONS)[number]

/**
 * Chains with canonical Safe deployments that this app offers.
 *
 * `safeShortName` is the EIP-3770 prefix Safe itself uses to name a chain in an address — the
 * `sep:` in `sep:0x…` — and it is what app.safe.global's own links are built from. Carried on
 * these entries rather than in a map of its own so it cannot drift out of step with the list it
 * describes; test/config.test.ts pins one per chain.
 */
export const SUPPORTED_CHAINS = [
  { id: 1, name: 'Ethereum', safeShortName: 'eth' },
  { id: 11155111, name: 'Sepolia', safeShortName: 'sep' },
  { id: 137, name: 'Polygon', safeShortName: 'matic' },
  { id: 42161, name: 'Arbitrum One', safeShortName: 'arb1' },
  { id: 10, name: 'OP Mainnet', safeShortName: 'oeth' },
  { id: 8453, name: 'Base', safeShortName: 'base' },
  { id: 100, name: 'Gnosis', safeShortName: 'gno' },
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
  /**
   * Minimum share of the template's maximum score a candidate must reach, as a percentage. 0-100;
   * 0 accepts everything. Judged against the percentage the result tile displays (core's
   * `scorePercent`), so a card reading 90.0% is never excluded by a floor of 90.
   */
  minMatch: number
}

/**
 * Neither floor is 0. Zero contrast accepts a pair whose two colours differ by less than the eye
 * reliably separates, so a face drawn in them is not a face anybody was hoping to mine; zero match
 * accepts every near-miss the miner has ever scored. Both made the first run a user sees the least
 * useful one, with a slider left to be discovered before the results got better.
 *
 * 60 rather than the 80 contrast started at, and 85 rather than the 0 match started at. The two
 * numbers are not on the same scale and do not mean the same kind of thing: contrast is 0 to 442 and
 * describes one candidate, match is a percentage of the best a candidate could have scored.
 *
 * The match floor is the one with a cost, and it is accepted deliberately rather than overlooked.
 * Contrast is a property of a candidate alone, so a floor on it is satisfiable from the first
 * second. Match quality is a property of how long the search has run, so a floor of 85 leaves the
 * grid empty for the opening stretch of every run — and an empty grid is exactly what a broken
 * search looks like. What makes that survivable is that the grid says which it is: its empty state
 * distinguishes "nothing found yet" from "nothing survived the filters" and offers the control that
 * relaxes them (see ResultsGrid). Without that this default would be the wrong one.
 */
export const DEFAULT_FACE_FILTERS: FaceFilters = { twoColor: true, minContrast: 60, minMatch: 85 }

/**
 * A perfect match, and the top of the match slider. Lives here rather than in FacePicker, which is
 * where it used to be, because a second consumer arrived: `min-match=` in a resume link is
 * validated against exactly this bound (lib/deep-link). Two copies of it would be two things that
 * agree until one is edited — the same reason `CONTRAST_MAX` moved out of FacePicker and into
 * lib/contrast-preview.ts. Here rather than there because `minMatch` is a field of `FaceFilters`,
 * declared a few lines up, and a bound on that field belongs beside the type it bounds.
 */
export const MATCH_MAX = 100

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

/**
 * What a run needs that the Safe address does not depend on.
 *
 * Deliberately NOT part of MineConfig. That type is what `?config=` encodes (lib/deep-link), and
 * where a search happened to begin is not part of what a shared address IS: two people who mine
 * the same Safe from different starting nonces have found the same address, and a link that
 * carried the difference would invite the recipient to reproduce a search rather than to look at
 * a result.
 */
export interface RunOptions {
  /** First saltNonce to try. 0 unless the user asked otherwise. */
  start: number
}

/**
 * The highest saltNonce a browser run may start from, given how many workers will share the range
 * behind it.
 *
 * Not 2^53 flat. `planWorkerRanges` gives worker w the block starting at `start + w × WORKER_BLOCK`
 * (lib/worker-protocol), so the position the LAST worker walks toward is `start + workers ×
 * WORKER_BLOCK` — and every nonce in between has to stay a safe integer, because core's `derive`
 * (packages/core/src/address.ts) rejects anything else outright. So the ceiling is the safe-integer
 * limit minus the whole pool's reach, which is why it tightens as cores are added rather than being
 * one number for every machine.
 *
 * Clamped at 0 for an absurd worker count, so the form's message can never read "at most
 * -3,000,000,000,000".
 *
 * It bounds the FIRST plan and only the first. A pause and resume re-plans from the run's own
 * `nextStart` (components/MiningView → lib/use-miner), which is higher than where the run began by
 * up to a block per worker, and nothing consults this ceiling again — so a run started near the
 * limit the form advertises can put the last worker's block past 2^53 after a single Pause/Resume.
 * That failure is LOUD, not silent: `derive` throws `derive() needs a non-negative safe integer`,
 * the worker reports the error, and use-miner tears the pool down and shows the message. Nothing is
 * mis-mined — the run dies. Deliberately not guarded here, because no fixed ceiling bounds an
 * unbounded sequence of resumes; the improvement worth making, if this is ever seen in the wild, is
 * catching that throw and saying "this search has run past the addressable range, start lower"
 * rather than surfacing an internal message.
 */
export function maxStartNonce(workers: number): number {
  return Math.max(0, Number.MAX_SAFE_INTEGER - workers * WORKER_BLOCK)
}

const START_NONCE_PATTERN = /^\d+$/

/**
 * Reads what is in the "Start from saltNonce" field.
 *
 * Digits only, which is stricter than the CLI's own `--start` (packages/miner/src/args.ts parses it
 * with `Number`, and therefore accepts `4.12e10` and `0x10`). The asymmetry is deliberate and in
 * the safe direction: every value this accepts the CLI accepts too — which is the direction that
 * matters, since this app's resume point is pasted INTO that CLI — while the formats a number is
 * legitimately written in elsewhere (a grouped `41,200,000,000`, a BigInt literal, an exponent) are
 * turned away here with a message instead of being silently reinterpreted as some other nonce.
 *
 * The bound is compared in BigInt. Not because Number would misjudge it — anything at or below the
 * limit is exactly representable, and anything above 2^53 rounds to a value still above it — but
 * because the bound is a claim about exact integers, and comparing it as one leaves no float
 * reasoning for the next reader to redo.
 */
export function parseStartNonce(raw: string, workers: number): { value?: number; error?: string } {
  const trimmed = raw.trim()
  // The default the helper text promises, not an error: the run must be startable without ever
  // opening the disclosure this field lives in.
  if (trimmed.length === 0) return { value: 0 }
  if (!START_NONCE_PATTERN.test(trimmed)) {
    return {
      error: 'Enter digits only — no separators, decimal points, exponents, hex or an "n" suffix.',
    }
  }
  const max = maxStartNonce(workers)
  if (BigInt(trimmed) > BigInt(max)) {
    return {
      error: `Enter at most ${max.toLocaleString('en-US')} — the limit on this machine, with ${workers} worker${
        workers === 1 ? '' : 's'
      }.`,
    }
  }
  return { value: Number(trimmed) }
}
