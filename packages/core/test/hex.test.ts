import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from '../src/hex.js'

describe('hex', () => {
  it('encodes bytes as lowercase 0x hex', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xff]))).toBe('0x000fff')
  })

  it('encodes a slice, which is how a 32-byte hash becomes a 20-byte address', () => {
    const hash = new Uint8Array(32)
    for (let i = 0; i < 32; i++) hash[i] = i
    expect(bytesToHex(hash, 12, 32)).toBe('0x0c0d0e0f101112131415161718191a1b1c1d1e1f')
    expect(bytesToHex(hash, 12, 32)).toHaveLength(42)
  })

  it('round-trips through hexToBytes with and without the 0x prefix', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    expect(Array.from(hexToBytes('0xdeadbeef'))).toEqual(Array.from(bytes))
    expect(Array.from(hexToBytes('deadbeef'))).toEqual(Array.from(bytes))
    expect(bytesToHex(hexToBytes('0xDEADBEEF'))).toBe('0xdeadbeef')
  })

  it('rejects malformed hex', () => {
    expect(() => hexToBytes('0xabc')).toThrow(/odd-length/)
    expect(() => hexToBytes('0xzz')).toThrow(/invalid hex/)
    expect(() => hexToBytes('0x1x')).toThrow(/invalid hex/)
    expect(() => hexToBytes('0x-1')).toThrow(/invalid hex/)
    expect(() => hexToBytes('0x+1')).toThrow(/invalid hex/)
    expect(() => hexToBytes('0xa ')).toThrow(/invalid hex/)
  })
})
