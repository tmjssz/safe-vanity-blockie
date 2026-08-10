import type { FaceSpec, FaceRegion, FixedCell, RegionAlternative } from './types.js'

export const MOUTH_BUDGET = 60
export const MOUTH_STROKE_WEIGHT = 3
export const MOUTH_BG_WEIGHT = 1

/** Rows 0-4, index = row * 4 + col. 1 = the eye pixel (mirrored to column 5), 0 = background. */
export const BASE_TARGET: readonly (0 | 1)[] = [
  0, 0, 0, 0,
  0, 0, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
]

/** 8 = the eye, 5 = cells hugging it (isolation, incl. col 3 to keep the two eyes apart), 3 = plain background. */
export const BASE_WEIGHTS: readonly number[] = [
  3, 3, 3, 3,
  3, 3, 5, 3,
  3, 5, 8, 5,
  3, 3, 5, 3,
  3, 3, 3, 3,
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
