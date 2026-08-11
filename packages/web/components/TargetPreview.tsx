import { targetGridFor } from '../lib/face-selection'

export interface TargetPreviewProps {
  mouthName: string
  size?: number
}

const GRID_SIZE = 8

/**
 * Renders the 8x8 target pattern for one accepted expression — the shape the miner is aiming
 * at, mirrored exactly as `blo` mirrors its own grid (column `c` reads from `c < 4 ? c : 7 - c`).
 * This is deliberately not an identicon of any address: no address exists yet at this step, and
 * calling it a "blockie" would misrepresent what it shows.
 */
export function TargetPreview({ mouthName, size = 64 }: TargetPreviewProps) {
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
    <svg
      role="img"
      aria-label={`Target pattern for ${mouthName}`}
      viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
      width={size}
      height={size}
    >
      {cells}
    </svg>
  )
}
