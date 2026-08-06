/** Hue 0-360, saturation 0-100, lightness 0-100 — the ranges blo emits. */
export type Hsl = readonly [number, number, number]

/** blo's palette, in the order blo returns it: background, color, spot. */
export type Palette = readonly [Hsl, Hsl, Hsl]

export interface BloImage {
  /** 32 values in {0,1,2} for the left half of the 8x8 grid; column c mirrors to 7-c. */
  readonly data: Uint8Array
  readonly colors: Palette
}
