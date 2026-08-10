import type { MineConfig } from '../lib/config'

export function npxCommandFor(config: MineConfig, options: { rpcUrl: string }): string {
  return [
    'npx safe-vanity-blockie',
    `--owners ${config.owners.join(',')}`,
    `--threshold ${config.threshold}`,
    `--safe-version ${config.safeVersion}`,
    `--rpc ${options.rpcUrl}`,
  ].join(' ')
}

export function CliHandoff({ config, rpcUrl }: { config: MineConfig; rpcUrl: string }) {
  return (
    <details>
      <summary>Run this search on your machine instead</summary>
      <p className="hint">
        A browser tab is throttled when it loses focus, and mobile is roughly ten times slower.
        For a longer search, run the same config natively — it uses every core and can be
        resumed.
      </p>
      <pre>
        <code>{npxCommandFor(config, { rpcUrl })}</code>
      </pre>
    </details>
  )
}
