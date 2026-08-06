import { bloImage as refImage, bloSvg as refSvg } from 'blo'
import { describe, expect, it } from 'vitest'
import { bloData, bloDataInto, bloImage, bloSvg, nextRandom, randSeed } from '../src/blo.js'

const ADDRESSES = [
  '0x0000000000000000000000000000000000000000',
  '0xffffffffffffffffffffffffffffffffffffffff',
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  '0x1234567890AbcdEF1234567890aBcdef12345678',
  '0x8Ba1f109551bD432803012645Ac136ddd64DBA72',
  '0x00000000219ab540356cBB839Cbe05303d7705Fa',
] as const

describe('blo port', () => {
  it('matches blo grid data byte-for-byte', () => {
    for (const address of ADDRESSES) {
      const [referenceData] = refImage(address)
      expect(Array.from(bloImage(address).data)).toEqual(Array.from(referenceData))
    }
  })

  it('matches the blo palette in [b, c, s] order', () => {
    for (const address of ADDRESSES) {
      const [, referencePalette] = refImage(address)
      const ours = bloImage(address).colors.map((color) => Array.from(color))
      expect(ours).toEqual(referencePalette.map((color) => Array.from(color)))
    }
  })

  it('matches blo svg output exactly', () => {
    for (const address of ADDRESSES) {
      expect(bloSvg(address, 64)).toBe(refSvg(address, 64))
    }
  })

  it('seeds from the lowercased 0x-prefixed address, so case does not matter', () => {
    const mixed = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    expect(Array.from(bloData(mixed))).toEqual(Array.from(bloData(mixed.toLowerCase())))
  })

  it('bloDataInto reuses caller buffers and stays identical to bloImage', () => {
    const data = new Uint8Array(32)
    const rseed = new Uint32Array(4)
    for (const address of ADDRESSES) {
      bloDataInto(address.toLowerCase(), data, rseed)
      expect(Array.from(data)).toEqual(Array.from(bloImage(address).data))
    }
  })

  it('keeps RANDOM_SCALE positive: nextRandom stays in [0, 1)', () => {
    const rseed = randSeed('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    for (let i = 0; i < 5000; i++) {
      const value = nextRandom(rseed)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('only ever emits grid values 0, 1 or 2', () => {
    for (const address of ADDRESSES) {
      for (const value of bloImage(address).data) expect(value).toBeLessThanOrEqual(2)
    }
  })
})
