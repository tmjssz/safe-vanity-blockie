import { describe, expect, it } from 'vitest'
import { formatBuildVersion } from '../lib/build-info'

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
