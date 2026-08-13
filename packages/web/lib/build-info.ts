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
