import {
  bloImage,
  colorContrast,
  compileFace,
  createAddressDeriver,
  createKeccak256,
  describeMatch,
  getTemplate,
  hexToBytes,
  isTwoColor,
  makeScorer,
} from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { candidateFromSaltNonce, decodeConfigParam, encodeConfigParam } from '../lib/deep-link'

const CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1',
  chainId: 1,
  saltNonce: '1885506',
}

// encodeConfigParam is typed to SharedConfig, so malformed/adversarial payloads that don't fit
// that shape are encoded by hand, the same way encodeConfigParam does it internally.
function encodeRaw(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
    expect(decodeConfigParam(btoa('{ not json').replace(/=+$/, '')).error).toMatch(
      /could not decode/i,
    )
  })

  it('rejects a config that fails validation, rather than trusting the link', () => {
    const bad = encodeConfigParam({ ...CONFIG, owners: ['0xnope'] })
    expect(decodeConfigParam(bad).error).toMatch(/not a valid address/)
  })

  it('rejects a non-numeric saltNonce', () => {
    const bad = encodeConfigParam({ ...CONFIG, saltNonce: '0x10' })
    expect(decodeConfigParam(bad).error).toMatch(/saltNonce/)
  })

  it('rejects owners containing a non-string entry, rather than dropping it and mining a different Safe', () => {
    const bad = encodeRaw({
      ...CONFIG,
      owners: [1234, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
    })
    const { config, error } = decodeConfigParam(bad)
    expect(error).toMatch(/invalid owner/i)
    expect(config).toBeUndefined()
  })

  it('rejects JSON that decodes to a bare number', () => {
    const { config, error } = decodeConfigParam(encodeRaw(42))
    expect(error).toMatch(/could not decode/i)
    expect(config).toBeUndefined()
  })

  it('rejects JSON that decodes to a bare string', () => {
    const { config, error } = decodeConfigParam(encodeRaw('hello'))
    expect(error).toMatch(/could not decode/i)
    expect(config).toBeUndefined()
  })

  it('rejects JSON that decodes to null', () => {
    const { config, error } = decodeConfigParam(encodeRaw(null))
    expect(error).toMatch(/could not decode/i)
    expect(config).toBeUndefined()
  })

  it('rejects JSON that decodes to an array', () => {
    const { config, error } = decodeConfigParam(encodeRaw([1, 2, 3]))
    expect(error).toMatch(/could not decode/i)
    expect(config).toBeUndefined()
  })

  it('rejects an owners field that is present but not an array', () => {
    const { config, error } = decodeConfigParam(encodeRaw({ ...CONFIG, owners: 'not-an-array' }))
    expect(error).toMatch(/add at least one owner/i)
    expect(config).toBeUndefined()
  })

  it('rejects a saltNonce given as a number rather than a string', () => {
    const { config, error } = decodeConfigParam(encodeRaw({ ...CONFIG, saltNonce: 1885506 }))
    expect(error).toMatch(/saltNonce/)
    expect(config).toBeUndefined()
  })
})

describe('candidateFromSaltNonce', () => {
  const CONSTANTS = {
    initializerHash: hexToBytes('0x' + '11'.repeat(32)),
    factory: hexToBytes('0x' + '22'.repeat(20)),
    initCodeHash: hexToBytes('0x' + '33'.repeat(32)),
  }
  const FACE_SPEC = getTemplate('faces')

  it('derives the same address createAddressDeriver produces for that nonce', async () => {
    const keccak256 = await createKeccak256()
    const expected = createAddressDeriver(CONSTANTS, keccak256).deriveBig(1885506n)

    const candidate = await candidateFromSaltNonce(CONSTANTS, '1885506', FACE_SPEC)

    expect(candidate.address).toBe(expected)
  })

  it('preserves a saltNonce beyond 2^53 exactly, as a string', async () => {
    const huge = '18446744073709551616'
    const candidate = await candidateFromSaltNonce(CONSTANTS, huge, FACE_SPEC)
    expect(candidate.saltNonce).toBe(huge)
    expect(typeof candidate.saltNonce).toBe('string')
  })

  it('agrees with recomputing twoColor, contrast and score from bloImage for the same address', async () => {
    const candidate = await candidateFromSaltNonce(CONSTANTS, '42', FACE_SPEC)

    const { data, colors } = bloImage(candidate.address)
    const face = compileFace(FACE_SPEC)

    expect(candidate.twoColor).toBe(isTwoColor(data))
    expect(candidate.contrast).toBe(Math.round(colorContrast(colors[0], colors[1])))
    expect(candidate.score).toBe(makeScorer(face)(data))
    expect(candidate.maxScore).toBe(face.maxScore)
    expect(candidate.regions).toEqual(describeMatch(face, data).regions)
  })
})
