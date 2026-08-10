import { compileFace } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { ALL_MOUTH_NAMES, faceSpecFromSelection } from '../lib/face-selection'

describe('faceSpecFromSelection', () => {
  it('offers the five built-in expressions', () => {
    expect(ALL_MOUTH_NAMES).toEqual(['smile', 'frown', 'neutral', 'open', 'small'])
  })

  it('builds a spec whose maximum is unchanged by how many expressions are accepted', () => {
    // Every expression is normalised to the same budget, so the ceiling is the same whether
    // the user accepts one expression or all five.
    expect(compileFace(faceSpecFromSelection(['smile'])).maxScore).toBe(133)
    expect(compileFace(faceSpecFromSelection(ALL_MOUTH_NAMES)).maxScore).toBe(133)
  })

  it('keeps only the chosen expressions', () => {
    const spec = faceSpecFromSelection(['smile', 'frown'])
    expect(spec.regions[0].alternatives.map((alternative) => alternative.name)).toEqual([
      'smile',
      'frown',
    ])
  })

  it('rejects an empty selection rather than producing an unscoreable spec', () => {
    expect(() => faceSpecFromSelection([])).toThrow(/at least one expression/)
  })

  it('rejects an unknown expression name', () => {
    expect(() => faceSpecFromSelection(['grin'])).toThrow(/unknown mouth "grin"/)
  })
})
