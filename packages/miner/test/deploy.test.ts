import { describe, expect, it } from 'vitest'
import { formatDeployPlan } from '../src/deploy.js'

const PLAN = {
  address: '0x' + 'ab'.repeat(20),
  chainId: 1n,
  transaction: { to: '0x' + '14'.repeat(20), value: '0', data: '0x' },
}
const OPTIONS = {
  saltNonce: '5254976178',
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1' as const,
}

describe('formatDeployPlan', () => {
  // The version is part of the address, and since the default moved to 1.5.0 a deploy that omits
  // --safe-version targets a different Safe than one mined under the old default. This is the
  // last thing read before "yes", so it has to say which Safe is being deployed.
  it('names the Safe version alongside the address, chain, salt, owners and threshold', () => {
    const text = formatDeployPlan(PLAN, OPTIONS)
    expect(text).toContain(PLAN.address)
    expect(text).toContain('chain 1')
    expect(text).toContain('saltNonce 5254976178')
    expect(text).toMatch(/safe version: 1\.4\.1/i)
    expect(text).not.toMatch(/l1 singleton/i)
  })

  it('names a forced L1 singleton, which is part of the address too', () => {
    expect(formatDeployPlan(PLAN, { ...OPTIONS, isL1SafeSingleton: true })).toMatch(
      /l1 singleton: forced/i,
    )
  })
})
