import type { BloImage, Hsl, Palette } from './types.js'

/** = 1 / 2147483648. Parenthesise as ((1 << 31) >>> 0); `1 << (31 >>> 0)` is negative. */
const RANDOM_SCALE = 1 / ((1 << 31) >>> 0)

/** Number of nextRandom() draws consumed by the three randomColor() calls before the grid. */
const COLOR_DRAWS = 18

export function seedInto(seed: string, rseed: Uint32Array): void {
  rseed[0] = 0
  rseed[1] = 0
  rseed[2] = 0
  rseed[3] = 0
  for (let i = 0; i < seed.length; i++) {
    const slot = i & 3
    rseed[slot] = (rseed[slot] << 5) - rseed[slot] + seed.charCodeAt(i)
  }
}

export function randSeed(seed: string): Uint32Array {
  const rseed = new Uint32Array(4)
  seedInto(seed, rseed)
  return rseed
}

export function nextRandom(rseed: Uint32Array): number {
  const t = rseed[0] ^ (rseed[0] << 11)
  rseed[0] = rseed[1]
  rseed[1] = rseed[2]
  rseed[2] = rseed[3]
  rseed[3] = (rseed[3] ^ (rseed[3] >> 19) ^ t ^ (t >> 8)) >>> 0
  return rseed[3] * RANDOM_SCALE
}

export function randomColor(rseed: Uint32Array): Hsl {
  return [
    Math.floor(nextRandom(rseed) * 360),
    Math.floor(40 + nextRandom(rseed) * 60),
    Math.floor(
      (nextRandom(rseed) + nextRandom(rseed) + nextRandom(rseed) + nextRandom(rseed)) * 25,
    ),
  ]
}

export function bloImage(address: string): BloImage {
  const rseed = randSeed(address.toLowerCase())
  // blo assigns these to c, b, s in this order but returns them as [b, c, s].
  const c = randomColor(rseed)
  const b = randomColor(rseed)
  const s = randomColor(rseed)
  const data = new Uint8Array(32)
  for (let i = 0; i < 32; i++) data[i] = Math.floor(nextRandom(rseed) * 2.3)
  return { data, colors: [b, c, s] as Palette }
}

/**
 * Hot-path grid generation. `lowercaseAddress` MUST already be lowercased and 0x-prefixed —
 * the caller owns that so the loop never allocates a string. Writes 32 values into `data`
 * and reuses `rseed` as scratch. Identical output to `bloImage(address).data`.
 */
export function bloDataInto(lowercaseAddress: string, data: Uint8Array, rseed: Uint32Array): void {
  seedInto(lowercaseAddress, rseed)
  for (let i = 0; i < COLOR_DRAWS; i++) nextRandom(rseed)
  for (let i = 0; i < 32; i++) data[i] = Math.floor(nextRandom(rseed) * 2.3)
}

export function bloData(address: string): Uint8Array {
  const data = new Uint8Array(32)
  bloDataInto(address.toLowerCase(), data, new Uint32Array(4))
  return data
}

export function bloSvg(address: string, size = 64): string {
  const {
    data,
    colors: [b, c, s],
  } = bloImage(address)
  const paths = ['', '']
  for (let i = 0; i < 32; i++) {
    if (data[i] === 0) continue
    const x = i & 3
    const y = i >> 2
    const square = ',' + y + 'h1v1h-1z'
    paths[data[i] - 1] += 'M' + x + square + 'M' + (7 - x) + square
  }
  const path = (color: Hsl, d: string) =>
    '<path fill="hsl(' + color[0] + ' ' + color[1] + '% ' + color[2] + '%)" d="' + d + '"/>'
  const numericSize = Number(size)
  const safeSize = Number.isFinite(numericSize) && numericSize >= 0 ? numericSize : 64
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="optimizeSpeed" ' +
    'width="' +
    safeSize +
    '" height="' +
    safeSize +
    '">' +
    path(b, 'M0,0H8V8H0z') +
    path(c, paths[0]) +
    path(s, paths[1]) +
    '</svg>'
  )
}
