import type { SafeVersion } from '@safe-global/types-kit'

/**
 * The Safe versions the CLI and the web app accept, newest first. One list for both, so a version
 * cannot be minable in one and rejected by the other. Each must be a version protocol-kit knows,
 * which the `satisfies` below enforces at compile time.
 */
export const SUPPORTED_SAFE_VERSIONS = [
  '1.5.0',
  '1.4.1',
  '1.3.0',
] as const satisfies readonly SafeVersion[]
export type SupportedSafeVersion = (typeof SUPPORTED_SAFE_VERSIONS)[number]

/** What a config that names no version mines and deploys. It is part of the address. */
export const DEFAULT_SAFE_VERSION: SupportedSafeVersion = '1.5.0'
