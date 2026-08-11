import { describe, expect, it } from 'vitest'
import { SUPPORTED_CHAINS } from '../lib/config'
import { chainById, wagmiConfig } from '../lib/wagmi'

describe('wagmi config', () => {
  it('covers exactly the chains the app offers', () => {
    expect(wagmiConfig.chains.map((chain) => chain.id).sort()).toEqual(
      SUPPORTED_CHAINS.map((chain) => chain.id).sort(),
    )
  })

  it('resolves a supported chain', () => {
    expect(chainById(1).id).toBe(1)
    expect(chainById(11155111).name).toMatch(/sepolia/i)
  })

  it('throws for a chain it does not know, rather than returning undefined', () => {
    expect(() => chainById(999_999)).toThrow(/not supported/)
  })

  it('every chain has a usable default RPC, since mining needs one before any wallet connects', () => {
    for (const chain of wagmiConfig.chains) {
      expect(chain.rpcUrls.default.http[0]).toMatch(/^https:\/\//)
    }
  })
})
