import { describe, expect, it } from 'vitest'
import { compileFace } from '../src/scoring.js'
import {
  BASE_TARGET,
  BASE_WEIGHTS,
  faceSpecForTarget,
  faceWithMouths,
  getTemplate,
  MOUTHS,
  mouthNamesForTarget,
  parseFaceSpec,
  TEMPLATES,
  targetNameForMouths,
} from '../src/templates.js'

describe('templates', () => {
  it('pins the eye at index 10 with the heaviest weight and separates the eyes at index 11', () => {
    expect(BASE_TARGET[10]).toBe(1)
    expect(BASE_WEIGHTS[10]).toBe(8)
    expect(BASE_WEIGHTS[11]).toBe(5)
    expect(BASE_WEIGHTS.reduce((a, b) => a + b, 0)).toBe(73)
  })

  it('ships the five documented expressions, each 12 cells long', () => {
    expect(MOUTHS.map((mouth) => mouth.name)).toEqual([
      'smile',
      'frown',
      'neutral',
      'open',
      'small',
    ])
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

  it('faceSpecForTarget resolves a builtin template name', () => {
    expect(faceSpecForTarget('faces')).toBe(getTemplate('faces'))
    expect(faceSpecForTarget('smile')).toBe(getTemplate('smile'))
  })

  // The reason the list form exists: the builtins cover only the two ends of the range — one
  // expression, or all five — while a narrowed selection is exactly what the browser app hands
  // over. Without this, such a selection had no way to be named on a command line.
  it('faceSpecForTarget accepts a list of expressions the builtins cannot name', () => {
    const spec = faceSpecForTarget('smile,frown')
    expect(spec.name).toBe('smile,frown')
    expect(spec.regions[0].alternatives.map((alternative) => alternative.name)).toEqual([
      'smile',
      'frown',
    ])
    // Same ceiling as any other target, so a score copied off the screen means the same thing.
    expect(compileFace(spec).maxScore).toBe(133)
  })

  // A quoted "smile, frown" is what a list typed for readability looks like by the time the shell
  // is done with it.
  it('faceSpecForTarget ignores spaces around the separator', () => {
    expect(faceSpecForTarget('smile, frown').regions[0].alternatives).toHaveLength(2)
  })

  it('faceSpecForTarget names a repeated expression once', () => {
    const spec = faceSpecForTarget('smile,smile')
    expect(spec.name).toBe('smile')
    expect(spec.regions[0].alternatives).toHaveLength(1)
  })

  it('faceSpecForTarget rejects a list naming something that is not an expression', () => {
    expect(() => faceSpecForTarget('smile,grin')).toThrow(/unknown target "smile,grin"/)
    // The error has to name both alphabets: a template is a legal target, an expression is a
    // legal list entry, and "faces,smile" is a plausible way to get either one wrong.
    expect(() => faceSpecForTarget('faces,smile')).toThrow(/faces.*smile, frown/s)
    expect(() => faceSpecForTarget(',')).toThrow(/unknown target/)
    expect(() => faceSpecForTarget('__proto__,smile')).toThrow(/unknown target/)
  })

  // Commas, as --owners does it, and only commas: a second list convention in the same CLI is
  // one more thing to get wrong at the prompt, so the separator --owners does not accept is not
  // quietly accepted here either.
  it('faceSpecForTarget takes commas alone as the separator', () => {
    expect(() => faceSpecForTarget('smile+frown')).toThrow(
      /unknown target "smile\+frown".*comma-separated/s,
    )
  })

  it('targetNameForMouths names the full set by its builtin, and any subset as a list', () => {
    expect(targetNameForMouths(MOUTHS.map((mouth) => mouth.name))).toBe('faces')
    expect(targetNameForMouths(['smile'])).toBe('smile')
    expect(targetNameForMouths(['smile', 'open'])).toBe('smile,open')
  })

  // The invariant the CLI handoff rests on: whatever the app names a selection, the CLI resolves
  // that same string back to a target with the same accepted expressions.
  it('every name targetNameForMouths produces resolves back through faceSpecForTarget', () => {
    const names = MOUTHS.map((mouth) => mouth.name)
    for (const selection of [names, ['frown'], ['smile', 'open'], ['neutral', 'small', 'open']]) {
      const resolved = faceSpecForTarget(targetNameForMouths(selection))
      expect(
        resolved.regions[0].alternatives.map((alternative) => alternative.name).sort(),
      ).toEqual([...selection].sort())
    }
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

  it('parseFaceSpec reports non-object array entries instead of throwing a TypeError', () => {
    expect(() => parseFaceSpec({ fixed: [null] })).toThrow(/fixed\[0\] must be an object/)
    expect(() => parseFaceSpec({ regions: [null] })).toThrow(/regions\[0\] must be an object/)
    expect(() => parseFaceSpec({ regions: [{ indices: [0], alternatives: [null] }] })).toThrow(
      /regions\[0\]\.alternatives\[0\] must be an object/,
    )
    expect(() => parseFaceSpec({ fixed: ['nope'] })).toThrow(/fixed\[0\] must be an object/)
  })

  // The third side of the round-trip: the app names a selection with `targetNameForMouths`, puts
  // that name in a URL or a `--target`, and reads it back to the same set here. Asserted over
  // every non-empty subset rather than a sample, because the failure this guards is a name that
  // round-trips for four expressions and not for three — which reaches a user as a resumed search
  // that credits a mouth they had excluded, with nothing on screen to say so.
  it('round-trips every non-empty subset of the expressions through targetNameForMouths', () => {
    const names = MOUTHS.map((mouth) => mouth.name)
    for (let mask = 1; mask < 1 << names.length; mask++) {
      const subset = names.filter((_, index) => mask & (1 << index))
      const target = targetNameForMouths(subset)
      expect(new Set(mouthNamesForTarget(target))).toEqual(new Set(subset))
    }
  })

  // `faces` is the one name that is not a list of expressions, so it is the one case the list
  // branch cannot answer.
  it('reads "faces" as every expression, in MOUTHS order', () => {
    expect(mouthNamesForTarget('faces')).toEqual(MOUTHS.map((mouth) => mouth.name))
  })

  // A single name needs no special case — the list branch already covers it — and this pins that,
  // so nobody adds one.
  it('reads a lone expression name as a one-entry list', () => {
    expect(mouthNamesForTarget('smile')).toEqual(['smile'])
  })

  // Naming the same expression twice is not ambiguous, and a second identical alternative is
  // scoring work for no wider target. Whitespace is what a hand-edited URL or a shell paste
  // leaves behind.
  it('dedupes repeats and tolerates surrounding whitespace', () => {
    expect(mouthNamesForTarget(' smile , open ,smile ')).toEqual(['smile', 'open'])
  })

  // The same message `faceSpecForTarget` has always thrown, from the same place, so a bad
  // `--target` at the prompt and a bad `target=` in a URL fail identically.
  it('throws the target message for an unknown name, an empty target and a wrong separator', () => {
    expect(() => mouthNamesForTarget('grin')).toThrow(/unknown target "grin"/)
    expect(() => mouthNamesForTarget('')).toThrow(/unknown target ""/)
    expect(() => mouthNamesForTarget('smile+open')).toThrow(/unknown target "smile\+open"/)
  })

  // The fast path matters beyond speed: MiningView keys a run's identity on `faceSpec` IDENTITY
  // (see its `sameRun`), and TEMPLATES holds memoised specs. Rebuilding one here would hand the
  // CLI a structurally equal object where it used to get the same one, which is exactly the class
  // of change that restarts a run for no reason.
  it('leaves faceSpecForTarget returning the memoised TEMPLATES object for a builtin name', () => {
    expect(faceSpecForTarget('faces')).toBe(TEMPLATES.faces)
    expect(faceSpecForTarget('smile')).toBe(TEMPLATES.smile)
  })
})
