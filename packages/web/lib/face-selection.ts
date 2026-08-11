import { MOUTHS, faceWithMouths, type FaceSpec } from '@safe-vanity-blockie/core'

export const ALL_MOUTH_NAMES: string[] = MOUTHS.map((mouth) => mouth.name)

/**
 * A FaceSpec accepting exactly the chosen expressions. Every expression is normalised to the
 * same budget, so accepting more of them widens the target without changing the maximum score.
 */
export function faceSpecFromSelection(mouthNames: string[]): FaceSpec {
  if (mouthNames.length === 0) {
    throw new Error('Choose at least one expression — a face needs a mouth to score against.')
  }
  return faceWithMouths(mouthNames.join('+'), mouthNames)
}

/**
 * The 32 target cells (left half of the 8x8 grid) for one accepted expression: the pinned
 * eyes/background plus that expression's mouth shape. This is the pattern the miner is aiming
 * at, not an identicon of any real address — `faceWithMouths` throws `unknown mouth "…"` for a
 * name it does not recognise, which propagates unchanged from here.
 */
export function targetGridFor(mouthName: string): (0 | 1)[] {
  const spec = faceWithMouths(mouthName, [mouthName])
  const grid: (0 | 1)[] = new Array(32).fill(0)
  for (const cell of spec.fixed) {
    grid[cell.index] = cell.value
  }
  const [region] = spec.regions
  const [alternative] = region.alternatives
  region.indices.forEach((index, position) => {
    grid[index] = alternative.cells[position]
  })
  return grid
}
