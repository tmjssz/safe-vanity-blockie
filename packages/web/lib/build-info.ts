/**
 * Renders the footer's build identifier: a version, plus a short commit SHA when one is
 * available. A local build has no SHA (Vercel is the only source, via `VERCEL_GIT_COMMIT_SHA`),
 * and that absence has to degrade to the version alone — never `undefined`, an empty string, or
 * a trailing `" ()"` — since a shared link is otherwise unmatchable to the build that produced it.
 */
export function formatBuildVersion(version: string, sha?: string | null): string {
  const trimmed = sha?.trim()
  if (!trimmed) return version
  return `${version} (${trimmed.slice(0, 7)})`
}

/**
 * Where the footer's build identifier links to. A commit is the exact answer to "what am I
 * running" and wins whenever a SHA exists; a local build has none, and falls back to the release
 * tag rather than to a `/commit/undefined` that 404s. The href carries the **full** SHA even
 * though the label is shortened — seven characters are unique only until the repo grows into a
 * collision, and a stale link is the one failure this whole feature exists to prevent.
 */
export function buildVersionHref(repoUrl: string, version: string, sha?: string | null): string {
  const trimmed = sha?.trim()
  if (!trimmed) return `${repoUrl}/releases/tag/v${version}`
  return `${repoUrl}/commit/${trimmed}`
}
