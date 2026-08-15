import { createAddressDeriver, createKeccak256, hexToBytes } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { assertDerivedAddressMatches } from '../lib/deploy'

const CONSTANTS = {
  initializerHash: hexToBytes('0x' + '11'.repeat(32)),
  factory: hexToBytes('0x' + '22'.repeat(20)),
  initCodeHash: hexToBytes('0x' + '33'.repeat(32)),
}

describe('assertDerivedAddressMatches', () => {
  it('accepts the address our own deriver produces for that saltNonce', async () => {
    const keccak256 = await createKeccak256()
    const expected = createAddressDeriver(CONSTANTS, keccak256).deriveBig(1885506n)
    await expect(
      assertDerivedAddressMatches(CONSTANTS, '1885506', expected),
    ).resolves.toBeUndefined()
  })

  it('is case-insensitive, since protocol-kit returns a checksummed address', async () => {
    const keccak256 = await createKeccak256()
    const expected = createAddressDeriver(CONSTANTS, keccak256).deriveBig(1885506n)
    await expect(
      assertDerivedAddressMatches(CONSTANTS, '1885506', expected.toUpperCase().replace('0X', '0x')),
    ).resolves.toBeUndefined()
  })

  it('throws naming both addresses when they disagree', async () => {
    await expect(
      assertDerivedAddressMatches(CONSTANTS, '1885506', '0x' + '00'.repeat(20)),
    ).rejects.toThrow(/does not match/)
  })

  it('rejects a saltNonce that is not a decimal integer, before any derivation', async () => {
    await expect(assertDerivedAddressMatches(CONSTANTS, '0x10', '0xabc')).rejects.toThrow(/decimal/)
    await expect(assertDerivedAddressMatches(CONSTANTS, '', '0xabc')).rejects.toThrow(/decimal/)
  })
})
