import { describe, expect, it } from 'vitest'
import {
  apportion,
  colorContrast,
  compileFace,
  describeMatch,
  hslToRgb,
  isTwoColor,
  makeScorer,
} from '../src/scoring.js'
import { MOUTHS, MOUTH_BUDGET, TEMPLATES, getTemplate } from '../src/templates.js'
import type { FaceSpec } from '../src/types.js'

const FACES = getTemplate('faces')

/** Straightforward, obviously-correct implementation used as an oracle for the fast scorer. */
function naiveScore(spec: FaceSpec, data: Uint8Array): number {
  let total = 0
  for (const cell of spec.fixed) if (data[cell.index] === cell.value) total += cell.weight
  for (const region of spec.regions) {
    let best = 0
    for (const alternative of region.alternatives) {
      const raw = alternative.cells.map((c) => (c === 1 ? region.strokeWeight : region.bgWeight))
      const weights = apportion(raw, region.budget)
      let got = 0
      for (let j = 0; j < region.indices.length; j++) {
        if (data[region.indices[j]] === alternative.cells[j]) got += weights[j]
      }
      if (got > best) best = got
    }
    total += best
  }
  return total
}

function gridFor(mouthName: string): Uint8Array {
  const data = new Uint8Array(32)
  for (const cell of FACES.fixed) data[cell.index] = cell.value
  const region = FACES.regions[0]
  const mouth = region.alternatives.find((alternative) => alternative.name === mouthName)
  if (!mouth) throw new Error(`no mouth named ${mouthName}`)
  for (let j = 0; j < region.indices.length; j++) data[region.indices[j]] = mouth.cells[j]
  return data
}

describe('apportion', () => {
  it('distributes a budget exactly, with no rounding drift', () => {
    expect(apportion([3, 1, 1], 60).reduce((a, b) => a + b, 0)).toBe(60)
    expect(apportion([1], 60)).toEqual([60])
    expect(apportion([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('gives larger raw weights larger shares', () => {
    const shares = apportion([3, 1, 1, 1], 60)
    expect(shares[0]).toBeGreaterThan(shares[1])
  })

  it('is deterministic for tied fractional remainders', () => {
    expect(apportion([1, 1, 1, 1, 1, 1, 1], 10)).toEqual(apportion([1, 1, 1, 1, 1, 1, 1], 10))
  })
})

describe('compileFace + makeScorer', () => {
  it('reports maxScore 133 for the default faces template', () => {
    expect(compileFace(FACES).maxScore).toBe(133)
  })

  it('gives every mouth expression exactly the same maximum, so none is favoured', () => {
    const score = makeScorer(compileFace(FACES))
    for (const mouth of MOUTHS) expect(score(gridFor(mouth.name))).toBe(133)
  })

  it('scores a perfect grid at maxScore and an inverted grid far below it', () => {
    const face = compileFace(FACES)
    const score = makeScorer(face)
    const perfect = gridFor('smile')
    expect(score(perfect)).toBe(face.maxScore)
    const inverted = perfect.map((value) => (value === 1 ? 0 : 1)) as unknown as Uint8Array
    expect(score(Uint8Array.from(inverted))).toBeLessThan(face.maxScore / 2)
  })

  it('treats the spot colour (value 2) as matching nothing, which drives two-colour results', () => {
    const face = compileFace(FACES)
    const score = makeScorer(face)
    const perfect = gridFor('smile')
    const withSpot = Uint8Array.from(perfect)
    withSpot[10] = 2 // the eye
    expect(score(withSpot)).toBe(face.maxScore - 8)
  })

  it('scores an empty mouth zone below every real expression', () => {
    const face = compileFace(FACES)
    const score = makeScorer(face)
    const empty = gridFor('smile')
    for (const index of FACES.regions[0].indices) empty[index] = 0
    for (const mouth of MOUTHS) expect(score(empty)).toBeLessThan(score(gridFor(mouth.name)))
  })

  it('matches the naive reference scorer on pseudo-random grids', () => {
    const score = makeScorer(compileFace(FACES))
    let state = 123456789
    for (let trial = 0; trial < 2000; trial++) {
      const data = new Uint8Array(32)
      for (let i = 0; i < 32; i++) {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        data[i] = state % 3
      }
      expect(score(data)).toBe(naiveScore(FACES, data))
    }
  })

  it('rejects malformed specs', () => {
    const overlapping: FaceSpec = {
      name: 'bad',
      fixed: [{ index: 20, value: 1, weight: 3 }],
      regions: FACES.regions,
    }
    expect(() => compileFace(overlapping)).toThrow(/used more than once/)

    const wrongLength: FaceSpec = {
      name: 'bad',
      fixed: [],
      regions: [{ ...FACES.regions[0], alternatives: [{ name: 'x', cells: [0, 1] }] }],
    }
    expect(() => compileFace(wrongLength)).toThrow(/12 cells/)

    const outOfRange: FaceSpec = {
      name: 'bad',
      fixed: [{ index: 32, value: 1, weight: 3 }],
      regions: [],
    }
    expect(() => compileFace(outOfRange)).toThrow(/between 0 and 31/)
  })
})

describe('describeMatch', () => {
  it('names the best-fitting expression per region', () => {
    const face = compileFace(FACES)
    for (const mouth of MOUTHS) {
      expect(describeMatch(face, gridFor(mouth.name)).regions).toEqual({ mouth: mouth.name })
    }
  })

  it('agrees with the hot-path scorer', () => {
    const face = compileFace(FACES)
    const score = makeScorer(face)
    const data = gridFor('open')
    expect(describeMatch(face, data).score).toBe(score(data))
  })
})

describe('colour helpers', () => {
  it('detects grids that use the spot colour', () => {
    expect(isTwoColor(Uint8Array.from([0, 1, 0, 1]))).toBe(true)
    expect(isTwoColor(Uint8Array.from([0, 1, 2, 1]))).toBe(false)
  })

  it('converts HSL to RGB at known anchors', () => {
    expect(hslToRgb(0, 100, 50).map(Math.round)).toEqual([255, 0, 0])
    expect(hslToRgb(120, 100, 50).map(Math.round)).toEqual([0, 255, 0])
    expect(hslToRgb(0, 0, 100).map(Math.round)).toEqual([255, 255, 255])
  })

  it('scores black-vs-white as the maximum contrast', () => {
    const maximum = colorContrast([0, 0, 0], [0, 0, 100])
    expect(Math.round(maximum)).toBe(442)
    expect(colorContrast([0, 50, 50], [0, 50, 50])).toBe(0)
    expect(colorContrast([0, 50, 40], [0, 50, 60])).toBeLessThan(maximum)
  })
})

describe('MOUTH_BUDGET wiring', () => {
  it('is the value every expression is normalised to', () => {
    for (const region of TEMPLATES.faces.regions) expect(region.budget).toBe(MOUTH_BUDGET)
  })
})
