import { describe, expect, it } from 'vitest'
import { compileFace } from '../src/scoring.js'
import {
  BASE_TARGET,
  BASE_WEIGHTS,
  MOUTHS,
  TEMPLATES,
  faceWithMouths,
  getTemplate,
  parseFaceSpec,
} from '../src/templates.js'

describe('templates', () => {
  it('pins the eye at index 10 with the heaviest weight and separates the eyes at index 11', () => {
    expect(BASE_TARGET[10]).toBe(1)
    expect(BASE_WEIGHTS[10]).toBe(8)
    expect(BASE_WEIGHTS[11]).toBe(5)
    expect(BASE_WEIGHTS.reduce((a, b) => a + b, 0)).toBe(73)
  })

  it('ships the five documented expressions, each 12 cells long', () => {
    expect(MOUTHS.map((mouth) => mouth.name)).toEqual(['smile', 'frown', 'neutral', 'open', 'small'])
    for (const mouth of MOUTHS) expect(mouth.cells).toHaveLength(12)
  })

  it('exposes an "all expressions" template plus one per expression', () => {
    expect(Object.keys(TEMPLATES)).toEqual(
      expect.arrayContaining(['faces', 'smile', 'frown', 'neutral', 'open', 'small']),
    )
    expect(getTemplate('faces').regions[0].alternatives).toHaveLength(5)
    expect(getTemplate('smile').regions[0].alternatives).toHaveLength(1)
    expect(compileFace(getTemplate('smile')).maxScore).toBe(133)
  })

  it('throws a helpful error for an unknown template name', () => {
    expect(() => getTemplate('nope')).toThrow(/unknown template "nope".*faces/s)
  })

  it('never resolves inherited Object.prototype keys', () => {
    expect(() => getTemplate('constructor')).toThrow(/unknown template "constructor".*faces/s)
    expect(() => getTemplate('toString')).toThrow(/unknown template "toString".*faces/s)
    expect(() => getTemplate('__proto__')).toThrow(/unknown template "__proto__".*faces/s)
  })

  it('faceWithMouths rejects unknown expression names', () => {
    expect(() => faceWithMouths('custom', ['grin'])).toThrow(/unknown mouth "grin"/)
  })

  it('parseFaceSpec round-trips a serialised template', () => {
    const parsed = parseFaceSpec(JSON.parse(JSON.stringify(getTemplate('faces'))))
    expect(compileFace(parsed).maxScore).toBe(133)
    expect(parsed.regions[0].alternatives).toHaveLength(5)
  })

  it('parseFaceSpec rejects structurally invalid input', () => {
    expect(() => parseFaceSpec(null)).toThrow(/must be an object/)
    expect(() => parseFaceSpec({ name: 'x', fixed: [], regions: [] })).toThrow(/at least one/)
    expect(() =>
      parseFaceSpec({ name: 'x', fixed: [{ index: 0, value: 2, weight: 1 }], regions: [] }),
    ).toThrow(/value must be 0 or 1/)
    expect(() =>
      parseFaceSpec({
        name: 'x',
        fixed: [{ index: 0, value: 1, weight: 0 }],
        regions: [],
      }),
    ).toThrow(/weight must be a positive integer/)
  })
})
