import { concat, getCreate2Address, type Hex, numberToHex, keccak256 as viemKeccak256 } from 'viem'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAddressDeriver } from '../src/address.js'
import { hexToBytes } from '../src/hex.js'
import { createKeccak256, type Keccak256 } from '../src/keccak.js'

const INITIALIZER_HASH = ('0x' + '11'.repeat(32)) as Hex
const FACTORY = ('0x' + '22'.repeat(20)) as Hex
const INIT_CODE_HASH = ('0x' + '33'.repeat(32)) as Hex

const CONSTANTS = {
  initializerHash: hexToBytes(INITIALIZER_HASH),
  factory: hexToBytes(FACTORY),
  initCodeHash: hexToBytes(INIT_CODE_HASH),
}

/** Independent reference: salt = keccak(initializerHash ++ uint256(nonce)), then CREATE2. */
function expectedAddress(saltNonce: bigint): string {
  const salt = viemKeccak256(concat([INITIALIZER_HASH, numberToHex(saltNonce, { size: 32 })]))
  return getCreate2Address({ from: FACTORY, salt, bytecodeHash: INIT_CODE_HASH }).toLowerCase()
}

let keccak256: Keccak256

beforeAll(async () => {
  keccak256 = await createKeccak256()
})

describe('createAddressDeriver', () => {
  it('matches viem for small nonces', () => {
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    for (const nonce of [0, 1, 2, 42, 255, 256, 65535]) {
      expect(deriver.derive(nonce)).toBe(expectedAddress(BigInt(nonce)))
    }
  })

  it('matches viem for nonces above 2^32, where the high word matters', () => {
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    for (const nonce of [
      4294967295,
      4294967296,
      8_400_000_000,
      5254976178,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(deriver.derive(nonce)).toBe(expectedAddress(BigInt(nonce)))
    }
  })

  it('deriveBig covers the full uint256 range', () => {
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    for (const nonce of [0n, 1n, 2n ** 64n, 2n ** 200n + 12345n, 2n ** 256n - 1n]) {
      expect(deriver.deriveBig(nonce)).toBe(expectedAddress(nonce))
    }
  })

  it('deriveBig leaves no stale bytes behind for a later derive()', () => {
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    const fresh = createAddressDeriver(CONSTANTS, keccak256).derive(7)
    deriver.deriveBig(2n ** 200n + 999n)
    expect(deriver.derive(7)).toBe(fresh)
  })

  it('returns a lowercase 0x address of 42 characters', () => {
    const address = createAddressDeriver(CONSTANTS, keccak256).derive(1)
    expect(address).toMatch(/^0x[0-9a-f]{40}$/)
  })

  it('rejects malformed constants and out-of-range nonces', () => {
    expect(() =>
      createAddressDeriver({ ...CONSTANTS, factory: new Uint8Array(19) }, keccak256),
    ).toThrow(/factory must be 20 bytes/)
    expect(() =>
      createAddressDeriver({ ...CONSTANTS, initCodeHash: new Uint8Array(31) }, keccak256),
    ).toThrow(/initCodeHash must be 32 bytes/)
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    expect(() => deriver.derive(-1)).toThrow(/non-negative safe integer/)
    expect(() => deriver.derive(1.5)).toThrow(/non-negative safe integer/)
    expect(() => deriver.deriveBig(2n ** 256n)).toThrow(/uint256/)
  })
})
