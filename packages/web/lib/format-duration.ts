/**
 * How long a mining run has been going, in the shape the CLI reports it: `45s`, `2m 05s`,
 * `1h 02m 05s`.
 *
 * Deliberately a copy of `formatDuration` in packages/miner/src/report.ts rather than an import:
 * `packages/web` does not depend on `@safe-vanity-blockie/miner` (a Node CLI package) and should
 * not gain that dependency for eight lines of string formatting. The two must agree, so
 * test/format-duration.test.ts pins the same cases the miner's own suite pins.
 */
export function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  }
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}
