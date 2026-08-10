import { bloSvg } from '@safe-vanity-blockie/core'

export interface BlockieProps {
  address: string
  size?: number
}

export function Blockie({ address, size = 64 }: BlockieProps) {
  // bloSvg emits a self-contained <svg> built from numeric HSL values and integer coordinates
  // derived from the address; it never echoes the address string into the markup.
  return (
    <span
      aria-label={`Identicon for ${address}`}
      role="img"
      dangerouslySetInnerHTML={{ __html: bloSvg(address, size) }}
    />
  )
}
