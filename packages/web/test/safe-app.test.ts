import { describe, expect, it } from 'vitest'
import { SUPPORTED_CHAINS } from '../lib/config'
import { safeWalletUrl } from '../lib/safe-app'

const ADDRESS = '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5'

describe('safeWalletUrl', () => {
  // The prefix is not decoration: app.safe.global reads the chain out of it, so the wrong one opens
  // a different network's Safe (or nothing at all) at the same address.
  it('names the chain the way Safe names it', () => {
    expect(safeWalletUrl(11155111, ADDRESS)).toBe(
      `https://app.safe.global/home?safe=sep:${ADDRESS}`,
    )
    expect(safeWalletUrl(1, ADDRESS)).toBe(`https://app.safe.global/home?safe=eth:${ADDRESS}`)
  })

  it('builds a link for every chain this app can deploy on', () => {
    for (const chain of SUPPORTED_CHAINS) {
      const url = safeWalletUrl(chain.id, ADDRESS)
      expect(url).toBe(`https://app.safe.global/home?safe=${chain.safeShortName}:${ADDRESS}`)
    }
  })

  // Undefined rather than a link to the wrong place: a caller shows no button at all, which is
  // honest, where a guessed prefix would send someone to another chain's address.
  it('offers nothing for a chain it has no name for', () => {
    expect(safeWalletUrl(999, ADDRESS)).toBeUndefined()
  })
})
