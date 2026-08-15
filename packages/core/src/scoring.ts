import type { CompiledFace, FaceSpec, Hsl } from './types.js'

/**
 * Largest-remainder apportionment: split `budget` across `rawWeights` proportionally using
 * integers that sum to exactly `budget`.
 *
 * The spec's `Math.round(raw / total * budget)` does not do this — it yields 57 for a 3-stroke
 * mouth and 62 for a 2-stroke one, silently making some expressions worth more than others.
 */
export function apportion(rawWeights: number[], budget: number): number[] {
  if (rawWeights.length === 0) return []
  const total = rawWeights.reduce((a, b) => a + b, 0)
  if (total <= 0) throw new Error('apportion: raw weights must sum to a positive number')
  const exact = rawWeights.map((weight) => (weight * budget) / total)
  const shares = exact.map((value) => Math.floor(value))
  const remainder = budget - shares.reduce((a, b) => a + b, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < remainder; i++) shares[order[i].index] += 1
  return shares
}

export function compileFace(spec: FaceSpec): CompiledFace {
  const used = new Set<number>()
  const claim = (index: number, where: string) => {
    if (!Number.isInteger(index) || index < 0 || index > 31) {
      throw new Error(`${where}: cell index ${index} must be an integer between 0 and 31`)
    }
    if (used.has(index)) throw new Error(`${where}: cell index ${index} is used more than once`)
    used.add(index)
  }

  const fixedIndex = new Uint8Array(spec.fixed.length)
  const fixedTarget = new Uint8Array(spec.fixed.length)
  const fixedWeight = new Int32Array(spec.fixed.length)
  let maxScore = 0
  spec.fixed.forEach((cell, i) => {
    claim(cell.index, `fixed cell ${i}`)
    fixedIndex[i] = cell.index
    fixedTarget[i] = cell.value
    fixedWeight[i] = cell.weight
    maxScore += cell.weight
  })

  const regionIndexStart = new Int32Array(spec.regions.length)
  const regionLength = new Int32Array(spec.regions.length)
  const regionAltCount = new Int32Array(spec.regions.length)
  const regionCellStart = new Int32Array(spec.regions.length)
  const indices: number[] = []
  const cells: number[] = []
  const weights: number[] = []
  const regionNames: string[] = []
  const regionAltNames: string[][] = []

  spec.regions.forEach((region, r) => {
    regionIndexStart[r] = indices.length
    regionCellStart[r] = cells.length
    regionLength[r] = region.indices.length
    regionAltCount[r] = region.alternatives.length
    regionNames.push(region.name)
    regionAltNames.push(region.alternatives.map((alternative) => alternative.name))

    if (region.alternatives.length === 0) {
      throw new Error(`region "${region.name}": needs at least one alternative`)
    }
    for (const index of region.indices) claim(index, `region "${region.name}"`)
    indices.push(...region.indices)

    for (const alternative of region.alternatives) {
      if (alternative.cells.length !== region.indices.length) {
        throw new Error(
          `region "${region.name}", alternative "${alternative.name}": expected ` +
            `${region.indices.length} cells, got ${alternative.cells.length}`,
        )
      }
      const raw = alternative.cells.map((cell) =>
        cell === 1 ? region.strokeWeight : region.bgWeight,
      )
      cells.push(...alternative.cells)
      weights.push(...apportion(raw, region.budget))
    }
    maxScore += region.budget
  })

  return {
    name: spec.name,
    maxScore,
    nFixed: spec.fixed.length,
    fixedIndex,
    fixedTarget,
    fixedWeight,
    nRegions: spec.regions.length,
    regionIndexStart,
    regionLength,
    regionAltCount,
    regionCellStart,
    regionIndex: Uint8Array.from(indices),
    regionCells: Uint8Array.from(cells),
    regionWeights: Int32Array.from(weights),
    regionNames,
    regionAltNames,
  }
}

/**
 * Builds the hot-path scorer. Everything is hoisted into locals so the returned closure is
 * monomorphic: integer-only, no allocation, no division, no property lookups per candidate.
 */
export function makeScorer(face: CompiledFace): (data: Uint8Array) => number {
  const {
    nFixed,
    fixedIndex,
    fixedTarget,
    fixedWeight,
    nRegions,
    regionIndexStart,
    regionLength,
    regionAltCount,
    regionCellStart,
    regionIndex,
    regionCells,
    regionWeights,
  } = face

  return function score(data: Uint8Array): number {
    let total = 0
    for (let i = 0; i < nFixed; i++) {
      if (data[fixedIndex[i]] === fixedTarget[i]) total += fixedWeight[i]
    }
    for (let r = 0; r < nRegions; r++) {
      const indexBase = regionIndexStart[r]
      const length = regionLength[r]
      const altCount = regionAltCount[r]
      const cellBase = regionCellStart[r]
      let best = 0
      for (let a = 0; a < altCount; a++) {
        const offset = cellBase + a * length
        let got = 0
        for (let j = 0; j < length; j++) {
          if (data[regionIndex[indexBase + j]] === regionCells[offset + j]) {
            got += regionWeights[offset + j]
          }
        }
        if (got > best) best = got
      }
      total += best
    }
    return total
  }
}

/** Off the hot path: which alternative won in each region, plus the total score. */
export function describeMatch(
  face: CompiledFace,
  data: Uint8Array,
): { score: number; regions: Record<string, string> } {
  let total = 0
  for (let i = 0; i < face.nFixed; i++) {
    if (data[face.fixedIndex[i]] === face.fixedTarget[i]) total += face.fixedWeight[i]
  }
  const regions: Record<string, string> = {}
  for (let r = 0; r < face.nRegions; r++) {
    const indexBase = face.regionIndexStart[r]
    const length = face.regionLength[r]
    const cellBase = face.regionCellStart[r]
    let best = -1
    let bestAlt = 0
    for (let a = 0; a < face.regionAltCount[r]; a++) {
      const offset = cellBase + a * length
      let got = 0
      for (let j = 0; j < length; j++) {
        if (data[face.regionIndex[indexBase + j]] === face.regionCells[offset + j]) {
          got += face.regionWeights[offset + j]
        }
      }
      if (got > best) {
        best = got
        bestAlt = a
      }
    }
    total += best
    regions[face.regionNames[r]] = face.regionAltNames[r][bestAlt]
  }
  return { score: total, regions }
}

/** True when the grid never uses blo's spot colour, i.e. the blockie renders in two colours. */
export function isTwoColor(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) if (data[i] === 2) return false
  return true
}

/** blo emits h 0-360, s 0-100, l 0-100. Returns r/g/b in 0-255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const saturation = s / 100
  const lightness = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = saturation * Math.min(lightness, 1 - lightness)
  const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** Euclidean RGB distance between two HSL colours. 0 = identical, ~441.7 = black vs white. */
export function colorContrast(a: Hsl, b: Hsl): number {
  const [r1, g1, b1] = hslToRgb(a[0], a[1], a[2])
  const [r2, g2, b2] = hslToRgb(b[0], b[1], b[2])
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}
