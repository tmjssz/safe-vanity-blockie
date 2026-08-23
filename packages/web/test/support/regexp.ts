/**
 * Escapes every regex metacharacter in `value` so it can be interpolated into a `new RegExp(…)`
 * pattern as a literal.
 *
 * Component tests here routinely build a matcher out of data — a package version, a URL, a
 * checksummed address, a chain name — and an unescaped `.` in any of those quietly widens to "any
 * character", so a pattern that reads as exact is not. `0.4.0` matching `0x4y0` is the harmless
 * end of that; the harmful end is an assertion that keeps passing after the thing it pins changed.
 * Anything interpolated from data goes through here, and only the surrounding anchors, alternations
 * and quantifiers stay live.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
