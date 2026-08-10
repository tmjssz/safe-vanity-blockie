import { describe, expect, it } from 'vitest'
import { decodeConfigParam, encodeConfigParam } from '../lib/deep-link'

const CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1',
  chainId: 1,
  saltNonce: '1885506',
}

describe('config deep link', () => {
  it('round-trips a config', () => {
    const { config, error } = decodeConfigParam(encodeConfigParam(CONFIG))
    expect(error).toBeUndefined()
    expect(config).toEqual(CONFIG)
  })

  it('preserves a saltNonce beyond 2^53 exactly', () => {
    const huge = { ...CONFIG, saltNonce: '18446744073709551616' }
    expect(decodeConfigParam(encodeConfigParam(huge)).config?.saltNonce).toBe(
      '18446744073709551616',
    )
  })

  it('produces a URL-safe parameter with no padding', () => {
    const param = encodeConfigParam(CONFIG)
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects a parameter that is not valid base64url', () => {
    expect(decodeConfigParam('!!!not base64!!!').error).toMatch(/could not decode/i)
  })

  it('rejects a parameter that decodes to invalid JSON', () => {
    expect(decodeConfigParam(btoa('{ not json').replace(/=+$/, '')).error).toMatch(/could not decode/i)
  })

  it('rejects a config that fails validation, rather than trusting the link', () => {
    const bad = encodeConfigParam({ ...CONFIG, owners: ['0xnope'] })
    expect(decodeConfigParam(bad).error).toMatch(/not a valid address/)
  })

  it('rejects a non-numeric saltNonce', () => {
    const bad = encodeConfigParam({ ...CONFIG, saltNonce: '0x10' })
    expect(decodeConfigParam(bad).error).toMatch(/saltNonce/)
  })
})
