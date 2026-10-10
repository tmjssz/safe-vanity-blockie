import { describe, expect, it } from 'vitest'
import { addressClassFor, SUPPORTED_SAFE_VERSIONS } from '../src/index.js'

const ETHEREUM = 1
const SEPOLIA = 11155111
const POLYGON = 137
const ARBITRUM = 42161
const OPTIMISM = 10
const BASE = 8453
const GNOSIS = 100

// The partition MEASURED with loadSafeConstants against live RPCs (factory, initCodeHash and
// initializerHash compared chain by chain). addressClassFor derives it from safe-deployments, so a
// bump that reorders a chain's deployments fails here instead of silently carrying a leaderboard
// across a switch that changed every address.
const MEASURED_CLASSES: Record<(typeof SUPPORTED_SAFE_VERSIONS)[number], number[][]> = {
  // One factory everywhere; mainnet alone defaults to the L1 singleton.
  '1.5.0': [[ETHEREUM], [SEPOLIA, POLYGON, ARBITRUM, OPTIMISM, BASE, GNOSIS]],
  '1.4.1': [[ETHEREUM], [SEPOLIA, POLYGON, ARBITRUM, OPTIMISM, BASE, GNOSIS]],
  // Deployed twice, canonical and eip155, and protocol-kit takes whichever is listed first for the
  // chain — which splits the L2s in two.
  '1.3.0': [[ETHEREUM], [POLYGON, ARBITRUM, GNOSIS], [SEPOLIA, OPTIMISM, BASE]],
}

describe('addressClassFor', () => {
  it.each(SUPPORTED_SAFE_VERSIONS)(
    'partitions the measured chains on %s as measured',
    (version) => {
      const groups = MEASURED_CLASSES[version]
      const classes = groups.map((group) => {
        const inGroup = new Set(group.map((chainId) => addressClassFor(chainId, version)))
        expect(inGroup.size).toBe(1)
        const [only] = inGroup
        expect(only).toEqual(expect.any(String))
        return only
      })
      expect(new Set(classes).size).toBe(groups.length)
    },
  )

  it('has no class for a chain without a Safe deployment', () => {
    expect(addressClassFor(999_999, '1.4.1')).toBeUndefined()
  })

  // Same contract addresses as elsewhere, different CREATE2 formula.
  it('has no class for a zkSync-family chain', () => {
    expect(addressClassFor(324, '1.4.1')).toBeUndefined()
  })
})
