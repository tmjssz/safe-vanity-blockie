import { describe, expect, it } from 'vitest'
import { buildVersionHref, formatBuildVersion } from '../lib/build-info'

const REPO_URL = 'https://github.com/tmjssz/safe-vanity-blockie'

// The footer names the build a shared link was produced by, which only helps if it degrades
// cleanly on a local build: no SHA is the ordinary case there, not an error state, so it must
// never render as `undefined`, an empty string, or a version with a dangling separator.
describe('formatBuildVersion', () => {
  it('shows the version alone when there is no SHA', () => {
    expect(formatBuildVersion('0.1.0')).toBe('0.1.0')
  })

  it('treats undefined the same as absent', () => {
    expect(formatBuildVersion('0.1.0', undefined)).toBe('0.1.0')
  })

  it('treats an empty string the same as absent, rather than leaving a dangling separator', () => {
    expect(formatBuildVersion('0.1.0', '')).toBe('0.1.0')
  })

  it('treats a whitespace-only SHA the same as absent', () => {
    expect(formatBuildVersion('0.1.0', '   ')).toBe('0.1.0')
  })

  it('appends a short 7-character SHA in parentheses', () => {
    expect(formatBuildVersion('0.1.0', 'abcdef1234567890')).toBe('0.1.0 (abcdef1)')
  })

  it('does not pad a SHA shorter than 7 characters', () => {
    expect(formatBuildVersion('0.1.0', 'abc')).toBe('0.1.0 (abc)')
  })

  it('trims surrounding whitespace before shortening', () => {
    expect(formatBuildVersion('0.1.0', '  abcdef1234567890  ')).toBe('0.1.0 (abcdef1)')
  })
})

// The version in the footer is what someone reaches for to answer "what am I actually running?",
// so it has to land somewhere that answers it. A SHA identifies the build exactly and is the
// better target whenever one exists; the release tag is the fallback a local build can still
// offer. Neither may produce a URL that 404s, which is why the no-SHA case resolves to a tag
// rather than to `/commit/undefined`.
describe('buildVersionHref', () => {
  it('points at the exact commit when a SHA is available', () => {
    expect(buildVersionHref(REPO_URL, '0.1.0', 'abcdef1234567890')).toBe(
      `${REPO_URL}/commit/abcdef1234567890`,
    )
  })

  // The displayed SHA is shortened for readability; the href is not. A full SHA is unambiguous
  // forever, while a 7-character prefix is only unique until the repo grows into a collision.
  it('links the full SHA even though the label shows a short one', () => {
    expect(buildVersionHref(REPO_URL, '0.1.0', 'abcdef1234567890')).not.toBe(
      `${REPO_URL}/commit/abcdef1`,
    )
  })

  it('falls back to the release tag when there is no SHA', () => {
    expect(buildVersionHref(REPO_URL, '0.1.0')).toBe(`${REPO_URL}/releases/tag/v0.1.0`)
  })

  it('treats an empty SHA as absent rather than linking /commit/', () => {
    expect(buildVersionHref(REPO_URL, '0.1.0', '')).toBe(`${REPO_URL}/releases/tag/v0.1.0`)
  })

  it('treats a whitespace-only SHA as absent', () => {
    expect(buildVersionHref(REPO_URL, '0.1.0', '   ')).toBe(`${REPO_URL}/releases/tag/v0.1.0`)
  })

  it('trims whitespace around a SHA rather than baking it into the URL', () => {
    expect(buildVersionHref(REPO_URL, '0.1.0', '  abcdef1234567890  ')).toBe(
      `${REPO_URL}/commit/abcdef1234567890`,
    )
  })
})
