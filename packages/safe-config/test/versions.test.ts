import { describe, expect, it } from 'vitest'
import { DEFAULT_SAFE_VERSION, SUPPORTED_SAFE_VERSIONS } from '../src/index.js'

describe('SUPPORTED_SAFE_VERSIONS', () => {
  it('lists 1.5.0, 1.4.1 and 1.3.0, newest first', () => {
    expect(SUPPORTED_SAFE_VERSIONS).toEqual(['1.5.0', '1.4.1', '1.3.0'])
  })

  it('defaults to 1.5.0, which is one of the supported versions', () => {
    expect(DEFAULT_SAFE_VERSION).toBe('1.5.0')
    expect(SUPPORTED_SAFE_VERSIONS).toContain(DEFAULT_SAFE_VERSION)
  })
})
