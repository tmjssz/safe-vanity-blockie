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
