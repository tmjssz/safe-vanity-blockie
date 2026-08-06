export class CliError extends Error {}

export const SUPPORTED_SAFE_VERSIONS = ['1.4.1', '1.3.0'] as const
export type SupportedSafeVersion = (typeof SUPPORTED_SAFE_VERSIONS)[number]

export interface MineArgs {
  owners: string[]
  threshold: number
  safeVersion: SupportedSafeVersion
  rpcUrl: string
  /** Builtin template name, or a path to a FaceSpec JSON file. */
  target: string
  twoColor: boolean
  minContrast: number
  workers: number
  maxIterations: number
  start: number
  keep: number
  out?: string
  gallery?: string
  isL1SafeSingleton?: boolean
}

export interface DeployArgs {
  saltNonce: string
  owners: string[]
  threshold: number
  safeVersion: SupportedSafeVersion
  rpcUrl: string
  privateKey: string
  isL1SafeSingleton?: boolean
}

export type Command =
  | { kind: 'mine'; options: MineArgs }
  | { kind: 'deploy'; options: DeployArgs }
  | { kind: 'help' }

export const HELP_TEXT = `safe-vanity-blockie — mine a Safe saltNonce whose address renders as a face

Usage:
  safe-vanity-blockie [mine] --owners <0x..,0x..> --rpc <url> [options]
  safe-vanity-blockie deploy --salt <n> --owners <0x..> --rpc <url> --pk <key>

Mine options:
  --owners <0x..,0x..>   required   comma-separated Safe owners
  --threshold <n>        1          signatures required
  --safe-version <v>     1.4.1      one of: ${SUPPORTED_SAFE_VERSIONS.join(', ')}
  --rpc <url>            required   used once, for chainId and canonical contract addresses
  --target <name|file>   faces      builtin template or a FaceSpec JSON file
  --two-color            on         only report blockies that use exactly two colours
  --no-two-color                    report three-colour results too
  --min-contrast <n>     0          drop results whose two colours are closer than this (0-442)
  --workers <n>          cores-1    worker threads
  --max-iterations <n>   unbounded  total nonces to scan; omit to run until Ctrl+C
  --start <n>            0          first saltNonce; use the printed nextStart to resume
  --keep <n>             20         leaderboard size
  --out <file.json>                 machine-readable results
  --gallery <file.html>             self-contained HTML gallery of real blo SVGs
  --l1-singleton                    force the L1 Safe singleton on an L2 chain
  -h, --help                        show this help

Deploy options:
  --salt <n>             required   saltNonce from a mining run
  --pk <key>             required   deployer private key (0x-prefixed)

A matching identicon is cosmetic. Never trust it as proof of an address.
`

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

function parseOwners(raw: string): string[] {
  const owners = raw
    .split(',')
    .map((owner) => owner.trim())
    .filter((owner) => owner.length > 0)
  if (owners.length === 0) throw new CliError('--owners must list at least one address')
  for (const owner of owners) {
    if (!ADDRESS_PATTERN.test(owner)) {
      throw new CliError(`--owners: "${owner}" is not a valid 0x address`)
    }
  }
  const seen = new Set<string>()
  for (const owner of owners) {
    const key = owner.toLowerCase()
    if (seen.has(key)) throw new CliError(`--owners: duplicate owner ${owner}`)
    seen.add(key)
  }
  return owners
}

function positiveInteger(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError(`${flag} must be a positive integer, got "${raw}"`)
  }
  return value
}

function nonNegativeInteger(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CliError(`${flag} must be a non-negative integer, got "${raw}"`)
  }
  return value
}

export function parseArgs(argv: string[], defaults: { workers: number }): Command {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { kind: 'help' }

  let rest = argv
  let kind: 'mine' | 'deploy' = 'mine'
  if (rest[0] === 'mine' || rest[0] === 'deploy') {
    kind = rest[0]
    rest = rest.slice(1)
  }

  const values = new Map<string, string>()
  const flags = new Set<string>()
  const BOOLEAN_FLAGS = new Set(['--two-color', '--no-two-color', '--l1-singleton'])
  const VALUE_FLAGS = new Set([
    '--owners', '--threshold', '--safe-version', '--rpc', '--target', '--min-contrast',
    '--workers', '--max-iterations', '--start', '--keep', '--out', '--gallery', '--salt', '--pk',
  ])

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (BOOLEAN_FLAGS.has(token)) {
      flags.add(token)
      continue
    }
    if (!VALUE_FLAGS.has(token)) throw new CliError(`unknown option "${token}"`)
    const value = rest[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new CliError(`${token} needs a value`)
    }
    values.set(token, value)
    i++
  }

  const require = (flag: string): string => {
    const value = values.get(flag)
    if (value === undefined) throw new CliError(`${flag} is required`)
    return value
  }

  const owners = parseOwners(require('--owners'))
  const rpcUrl = require('--rpc')

  const thresholdRaw = values.get('--threshold')
  const threshold = thresholdRaw === undefined ? 1 : positiveInteger(thresholdRaw, '--threshold')
  if (threshold > owners.length) {
    throw new CliError(
      `--threshold ${threshold} exceeds the ${owners.length} owner${owners.length === 1 ? '' : 's'} given`,
    )
  }

  const safeVersionRaw = values.get('--safe-version') ?? '1.4.1'
  if (!SUPPORTED_SAFE_VERSIONS.includes(safeVersionRaw as SupportedSafeVersion)) {
    throw new CliError(
      `unsupported --safe-version "${safeVersionRaw}"; supported: ${SUPPORTED_SAFE_VERSIONS.join(', ')}`,
    )
  }
  const safeVersion = safeVersionRaw as SupportedSafeVersion
  const isL1SafeSingleton = flags.has('--l1-singleton') ? true : undefined

  if (kind === 'deploy') {
    return {
      kind: 'deploy',
      options: {
        saltNonce: require('--salt'),
        owners,
        threshold,
        safeVersion,
        rpcUrl,
        privateKey: require('--pk'),
        isL1SafeSingleton,
      },
    }
  }

  const maxIterationsRaw = values.get('--max-iterations')
  const startRaw = values.get('--start')
  const keepRaw = values.get('--keep')
  const workersRaw = values.get('--workers')
  const minContrastRaw = values.get('--min-contrast')

  return {
    kind: 'mine',
    options: {
      owners,
      threshold,
      safeVersion,
      rpcUrl,
      target: values.get('--target') ?? 'faces',
      twoColor: !flags.has('--no-two-color'),
      minContrast: minContrastRaw === undefined ? 0 : nonNegativeInteger(minContrastRaw, '--min-contrast'),
      workers: workersRaw === undefined ? defaults.workers : positiveInteger(workersRaw, '--workers'),
      maxIterations:
        maxIterationsRaw === undefined
          ? Number.POSITIVE_INFINITY
          : positiveInteger(maxIterationsRaw, '--max-iterations'),
      start: startRaw === undefined ? 0 : nonNegativeInteger(startRaw, '--start'),
      keep: keepRaw === undefined ? 20 : positiveInteger(keepRaw, '--keep'),
      out: values.get('--out'),
      gallery: values.get('--gallery'),
      isL1SafeSingleton,
    },
  }
}
