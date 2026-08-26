import { targetGridFor } from '../lib/face-selection'

export interface TargetPreviewProps {
  mouthName: string
  size?: number
  /**
   * Drops the preview's own image role and label. Use inside a control that is already named
   * after the same expression (FacePicker's toggles), where "Target pattern for smile" alongside
   * a caption reading "smile" is announced twice and would also corrupt the control's own
   * accessible name. Standalone, the preview keeps its label — it is the only thing describing
   * itself.
   */
  decorative?: boolean
}

const GRID_SIZE = 8

/**
 * Renders the 8x8 target pattern for one accepted expression — the shape the miner is aiming
 * at, mirrored exactly as `blo` mirrors its own grid (column `c` reads from `c < 4 ? c : 7 - c`).
 * This is deliberately not an identicon of any address: no address exists yet at this step, and
 * calling it a "blockie" would misrepresent what it shows.
 */
export function TargetPreview({ mouthName, size = 64, decorative = false }: TargetPreviewProps) {
  const grid = targetGridFor(mouthName)
  const cells = []
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const source = col < 4 ? col : 7 - col
      const filled = grid[row * 4 + source] === 1
      cells.push(
        <rect
          key={`${row}-${col}`}
          data-row={row}
          data-col={col}
          data-filled={filled ? 'true' : 'false'}
          x={col}
          y={row}
          width={1}
          height={1}
          fill={filled ? 'currentColor' : 'transparent'}
        />,
      )
    }
  }

  return (
    // `bg-background`, and no border: the pattern is what a mined blockie will look like, so the
    // frame around it should be what a blockie sits on — paper. That token is pure white in light
    // mode and near-black in dark, and the filled cells are `currentColor`, so they read as ink
    // either way without this component knowing which mode it is in. `--card` would have been the
    // near miss: it is a lifted grey in dark mode, which makes the pattern look like a swatch of
    // something rather than a picture.
    //
    // The border it replaces was drawing a box around a picture that is already a solid rectangle,
    // and at 40px inside a bordered tile that was three concentric rounded outlines deep.
    <div className="inline-flex rounded-md bg-background p-2 text-foreground">
      <svg
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : `Target pattern for ${mouthName}`}
        aria-hidden={decorative || undefined}
        viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
        width={size}
        height={size}
      >
        {cells}
      </svg>
    </div>
  )
}
