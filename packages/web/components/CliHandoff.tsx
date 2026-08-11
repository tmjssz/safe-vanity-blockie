import type { FaceFilters, MineConfig } from '../lib/config'

/**
 * `--two-color`/`--no-two-color` and `--min-contrast` map 1:1 onto the browser's live filters
 * (packages/miner/src/args.ts) — passed through so the handed-off search enforces the same
 * standard the user was already looking at, instead of silently reverting to the CLI defaults.
 */
export function npxCommandFor(
  config: MineConfig,
  options: { rpcUrl: string; filters?: FaceFilters },
): string {
  const parts = [
    'npx safe-vanity-blockie',
    `--owners ${config.owners.join(',')}`,
    `--threshold ${config.threshold}`,
    `--safe-version ${config.safeVersion}`,
    `--rpc ${options.rpcUrl}`,
  ]
  if (options.filters) {
    parts.push(options.filters.twoColor ? '--two-color' : '--no-two-color')
    parts.push(`--min-contrast ${options.filters.minContrast}`)
  }
  return parts.join(' ')
}

export function CliHandoff({
  config,
  rpcUrl,
  filters,
}: {
  config: MineConfig
  rpcUrl: string
  filters?: FaceFilters
}) {
  return (
    <details>
      <summary>Run this search on your machine instead</summary>
      <p className="hint">
        A browser tab is throttled when it loses focus, and mobile is roughly ten times slower.
        For a longer search, run the same config natively — it uses every core and can be
        resumed.
      </p>
      <p className="hint">
        The CLI has no builtin <code>--target</code> for a narrowed subset of expressions, so it
        searches the full set of faces; your two-colour and contrast filters still carry over
        exactly, via the flags below.
      </p>
      <pre>
        <code>{npxCommandFor(config, { rpcUrl, filters })}</code>
      </pre>
    </details>
  )
}
