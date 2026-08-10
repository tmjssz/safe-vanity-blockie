/** Hue 0-360, saturation 0-100, lightness 0-100 — the ranges blo emits. */
export type Hsl = readonly [number, number, number]

/** blo's palette, in the order blo returns it: background, color, spot. */
export type Palette = readonly [Hsl, Hsl, Hsl]

export interface BloImage {
  /** 32 values in {0,1,2} for the left half of the 8x8 grid; column c mirrors to 7-c. */
  readonly data: Uint8Array
  readonly colors: Palette
}

/** A cell whose target value is pinned. `index` is 0..31 in the left half of the grid. */
export interface FixedCell {
  index: number
  value: 0 | 1
  weight: number
}

/** One accepted shape for a region, e.g. a single mouth expression. */
export interface RegionAlternative {
  name: string
  /** Aligned 1:1 with the region's `indices`. */
  cells: (0 | 1)[]
}

/**
 * A group of cells scored as `max` over a list of alternatives. Every alternative is normalised
 * to the same `budget`, so no shape wins just for having more stroke pixels.
 */
export interface FaceRegion {
  name: string
  indices: number[]
  budget: number
  /** Relative weight of a cell that should be foreground. */
  strokeWeight: number
  /** Relative weight of a cell that should stay background. */
  bgWeight: number
  alternatives: RegionAlternative[]
}

export interface FaceSpec {
  name: string
  fixed: FixedCell[]
  regions: FaceRegion[]
}

/** Flattened, integer-only form of a FaceSpec. Built once; read millions of times. */
export interface CompiledFace {
  readonly name: string
  readonly maxScore: number
  readonly nFixed: number
  readonly fixedIndex: Uint8Array
  readonly fixedTarget: Uint8Array
  readonly fixedWeight: Int32Array
  readonly nRegions: number
  readonly regionIndexStart: Int32Array
  readonly regionLength: Int32Array
  readonly regionAltCount: Int32Array
  readonly regionCellStart: Int32Array
  readonly regionIndex: Uint8Array
  readonly regionCells: Uint8Array
  readonly regionWeights: Int32Array
  readonly regionNames: readonly string[]
  readonly regionAltNames: readonly (readonly string[])[]
}
