import type { FaceRegion, FaceSpec, FixedCell, RegionAlternative } from './types.js'

export const MOUTH_BUDGET = 60
export const MOUTH_STROKE_WEIGHT = 3
export const MOUTH_BG_WEIGHT = 1

/** Rows 0-4, index = row * 4 + col. 1 = the eye pixel (mirrored to column 5), 0 = background. */
export const BASE_TARGET: readonly (0 | 1)[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]

/** 8 = the eye, 5 = cells hugging it (isolation, incl. col 3 to keep the two eyes apart), 3 = plain background. */
export const BASE_WEIGHTS: readonly number[] = [
  3, 3, 3, 3, 3, 3, 5, 3, 3, 5, 8, 5, 3, 3, 5, 3, 3, 3, 3, 3,
]

/** Rows 5-7 of the left half: r5c0..r5c3, r6c0..r6c3, r7c0..r7c3. */
export const MOUTH_INDICES: readonly number[] = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]

export const MOUTHS: readonly RegionAlternative[] = [
  // r5: c0 c1 c2 c3   r6: c0 c1 c2 c3   r7: c0 c1 c2 c3
  { name: 'smile', cells: [0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, // corners up, dips centre
  { name: 'frown', cells: [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] }, // corners down
  { name: 'neutral', cells: [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0] }, // straight line
  { name: 'open', cells: [0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1] }, // rounded "o" / surprised
  { name: 'small', cells: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0] }, // little mouth
]

function baseFixedCells(): FixedCell[] {
  return BASE_TARGET.map((value, index) => ({ index, value, weight: BASE_WEIGHTS[index] }))
}

function mouthRegion(alternatives: RegionAlternative[]): FaceRegion {
  return {
    name: 'mouth',
    indices: [...MOUTH_INDICES],
    budget: MOUTH_BUDGET,
    strokeWeight: MOUTH_STROKE_WEIGHT,
    bgWeight: MOUTH_BG_WEIGHT,
    alternatives,
  }
}

/** Builds a face with fixed eyes and the named subset of expressions accepted for the mouth. */
export function faceWithMouths(name: string, mouthNames: string[]): FaceSpec {
  const alternatives = mouthNames.map((mouthName) => {
    const mouth = MOUTHS.find((candidate) => candidate.name === mouthName)
    if (!mouth) {
      throw new Error(
        `unknown mouth "${mouthName}"; available: ${MOUTHS.map((m) => m.name).join(', ')}`,
      )
    }
    return { name: mouth.name, cells: [...mouth.cells] }
  })
  return { name, fixed: baseFixedCells(), regions: [mouthRegion(alternatives)] }
}

// Built on a null prototype so a lookup by an attacker- or URL-controlled name can never resolve
// an inherited Object.prototype key (e.g. "constructor", "toString", "__proto__") instead of
// throwing the intended "unknown template" error.
export const TEMPLATES: Record<string, FaceSpec> = Object.assign(Object.create(null), {
  faces: faceWithMouths(
    'faces',
    MOUTHS.map((mouth) => mouth.name),
  ),
  ...Object.fromEntries(
    MOUTHS.map((mouth) => [mouth.name, faceWithMouths(mouth.name, [mouth.name])]),
  ),
})

export function getTemplate(name: string): FaceSpec {
  if (!Object.hasOwn(TEMPLATES, name)) {
    throw new Error(`unknown template "${name}"; available: ${Object.keys(TEMPLATES).join(', ')}`)
  }
  return TEMPLATES[name]
}

/**
 * The name a set of accepted expressions is known by, both as a FaceSpec name and as a `--target`
 * value: the builtin `faces` when it is all of them, otherwise the names joined by commas.
 *
 * Commas because that is the one list separator the CLI already has — `--owners 0x..,0x..` — and a
 * second convention for a second list is one more thing to remember at the prompt for no gain.
 *
 * Lives beside TEMPLATES rather than in the app that needs it, because it is one side of a
 * round-trip whose other two sides are `faceSpecForTarget` (name → spec) and `mouthNamesForTarget`
 * below (name → names) — the app names a selection with this, hands that name to the CLI or a URL,
 * and either resolves it back to the same set of expressions. Split across two packages, the sides
 * would be free to drift apart with nothing failing.
 *
 * Validates nothing: the caller builds the spec from the same names, and `faceWithMouths` is where
 * an unknown one is caught, with the error that lists the expressions.
 */
export function targetNameForMouths(mouthNames: string[]): string {
  const unique = [...new Set(mouthNames)]
  const isEveryMouth =
    unique.length === MOUTHS.length && MOUTHS.every((mouth) => unique.includes(mouth.name))
  return isEveryMouth ? 'faces' : unique.join(',')
}

/**
 * The expressions a `--target` name accepts.
 *
 * The third side of the round-trip whose other two are `targetNameForMouths` (names → name) and
 * `faceSpecForTarget` (name → spec). It exists because a caller reading a name back needs the
 * NAMES, not a spec: the browser app's state is the accepted expressions, and it builds its own
 * spec from them (see the web package's `faceSpecFromSelection`). Handed a FaceSpec it would have
 * to take that object apart again to find out what is in it, or keep a second parser of its own —
 * and a second parser is how a `--target` at the prompt and a `target=` in a URL come to disagree
 * about what `smile,open` means.
 *
 * Lives here for the reason `targetNameForMouths` gives: split across packages, the halves of a
 * round-trip are free to drift apart with nothing failing.
 *
 * A repeat is deduped rather than rejected — it names the same expression twice, which is not
 * ambiguous, and a second identical alternative is scoring work for no wider target.
 */
export function mouthNamesForTarget(target: string): string[] {
  // The only builtin that is not simply a list of expressions. Every other TEMPLATES key IS a
  // mouth name, which the list branch below already reads, so this is the whole special case.
  if (target === 'faces') return MOUTHS.map((mouth) => mouth.name)

  const known = new Set(MOUTHS.map((mouth) => mouth.name))
  const names = [
    ...new Set(
      target
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  ]
  if (names.length === 0 || names.some((name) => !known.has(name))) {
    // One error for every way of getting this wrong, naming both alphabets: a template is a legal
    // target and an expression is a legal list entry, so a value like "faces,smile" is a plausible
    // confusion of the two and neither list alone would explain it. It is also what a `+` between
    // two otherwise valid expressions lands on, which is the whole message a wrong separator needs.
    throw new Error(
      `unknown target "${target}"; expected a template (${Object.keys(TEMPLATES).join(', ')}) ` +
        `or a comma-separated list of expressions (${MOUTHS.map((mouth) => mouth.name).join(', ')})`,
    )
  }
  return names
}

/**
 * A `--target` name: a builtin template, or a comma-separated list of expressions — so
 * `smile,frown` accepts either of those two mouths and nothing else.
 *
 * The list form exists because the builtins name only the two ends of the range, one expression or
 * all five, while the browser app accepts any subset of them. A narrowed selection therefore had no
 * name to be handed to the CLI at all, and the command the app offered for "run this same search
 * natively" quietly searched a wider target than the screen it was copied from.
 *
 * The TEMPLATES lookup stays a fast path rather than being folded into the parse below, and not
 * for speed: it returns the MEMOISED spec for a builtin name, and identity is load-bearing for the
 * browser app, which keys a run's identity on the spec object (see MiningView's `sameRun`).
 * Rebuilding an equal one here would restart a run over nothing. Its `hasOwn` also keeps the
 * null-prototype guard exactly where the TEMPLATES comment explains it.
 */
export function faceSpecForTarget(target: string): FaceSpec {
  // Same null-prototype reasoning as TEMPLATES: `hasOwn`, so a URL- or argv-supplied
  // "constructor" cannot resolve to an inherited key.
  if (Object.hasOwn(TEMPLATES, target)) return TEMPLATES[target]

  const names = mouthNamesForTarget(target)
  return faceWithMouths(targetNameForMouths(names), names)
}

/** Guards the `entry as Record<string, unknown>` casts below: a null or primitive entry would
 *  otherwise surface as a raw TypeError from the first property read. */
function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object, got ${JSON.stringify(value)}`)
  }
  return value as Record<string, unknown>
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value as number
}

/** Validates untrusted JSON (a `--target file.json`, or a future web designer export). */
export function parseFaceSpec(input: unknown): FaceSpec {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('FaceSpec must be an object')
  }
  const raw = input as Record<string, unknown>
  const name = typeof raw.name === 'string' && raw.name ? raw.name : 'custom'

  const fixedInput = Array.isArray(raw.fixed) ? raw.fixed : []
  const fixed: FixedCell[] = fixedInput.map((entry, i) => {
    const cell = requireObject(entry, `fixed[${i}]`)
    const index = cell.index
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 31) {
      throw new Error(`fixed[${i}].index must be an integer between 0 and 31`)
    }
    if (cell.value !== 0 && cell.value !== 1) {
      throw new Error(`fixed[${i}].value must be 0 or 1`)
    }
    return {
      index: index as number,
      value: cell.value as 0 | 1,
      weight: requirePositiveInteger(cell.weight, `fixed[${i}].weight`),
    }
  })

  const regionsInput = Array.isArray(raw.regions) ? raw.regions : []
  const regions: FaceRegion[] = regionsInput.map((entry, r) => {
    const label = `regions[${r}]`
    const region = requireObject(entry, label)
    if (!Array.isArray(region.indices) || region.indices.length === 0) {
      throw new Error(`${label}.indices must be a non-empty array`)
    }
    for (const index of region.indices) {
      if (!Number.isInteger(index) || index < 0 || index > 31) {
        throw new Error(`${label}.indices must all be integers between 0 and 31`)
      }
    }
    if (!Array.isArray(region.alternatives) || region.alternatives.length === 0) {
      throw new Error(`${label}.alternatives must contain at least one alternative`)
    }
    const alternatives: RegionAlternative[] = region.alternatives.map((altEntry, a) => {
      const alternative = requireObject(altEntry, `${label}.alternatives[${a}]`)
      if (!Array.isArray(alternative.cells)) {
        throw new Error(`${label}.alternatives[${a}].cells must be an array`)
      }
      for (const cell of alternative.cells) {
        if (cell !== 0 && cell !== 1) {
          throw new Error(`${label}.alternatives[${a}].cells value must be 0 or 1`)
        }
      }
      return {
        name: typeof alternative.name === 'string' ? alternative.name : `alt${a}`,
        cells: alternative.cells as (0 | 1)[],
      }
    })
    return {
      name: typeof region.name === 'string' ? region.name : `region${r}`,
      indices: region.indices as number[],
      budget: requirePositiveInteger(region.budget, `${label}.budget`),
      strokeWeight: requirePositiveInteger(region.strokeWeight, `${label}.strokeWeight`),
      bgWeight: requirePositiveInteger(region.bgWeight, `${label}.bgWeight`),
      alternatives,
    }
  })

  if (fixed.length === 0 && regions.length === 0) {
    throw new Error('FaceSpec must define at least one fixed cell or region')
  }
  return { name, fixed, regions }
}
