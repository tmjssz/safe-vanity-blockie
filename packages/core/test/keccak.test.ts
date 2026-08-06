import { keccak_256 } from '@noble/hashes/sha3.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { bytesToHex } from '../src/hex.js'
import { createKeccak256, type Keccak256 } from '../src/keccak.js'

let keccak256: Keccak256

beforeAll(async () => {
  keccak256 = await createKeccak256()
})

describe('keccak256', () => {
  it('matches the canonical empty-input vector', () => {
    expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    )
  })

  it('matches @noble/hashes on the exact input sizes the miner uses', () => {
    for (const size of [0, 1, 32, 64, 85, 200]) {
      const input = new Uint8Array(size)
      for (let i = 0; i < size; i++) input[i] = (i * 37 + 11) & 0xff
      expect(bytesToHex(keccak256(input))).toBe(bytesToHex(keccak_256(input)))
    }
  })

  it('returns a fresh 32-byte array each call, so results can be held across calls', () => {
    const a = keccak256(new Uint8Array([1]))
    const b = keccak256(new Uint8Array([2]))
    expect(a).toHaveLength(32)
    expect(a.buffer).not.toBe(b.buffer)
    expect(bytesToHex(a)).toBe(bytesToHex(keccak256(new Uint8Array([1]))))
  })

  it('is reusable: the hasher resets between calls', () => {
    const first = bytesToHex(keccak256(new Uint8Array([9, 9, 9])))
    keccak256(new Uint8Array(85))
    expect(bytesToHex(keccak256(new Uint8Array([9, 9, 9])))).toBe(first)
  })
})
