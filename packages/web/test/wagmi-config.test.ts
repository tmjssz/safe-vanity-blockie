import { describe, expect, it } from 'vitest'
import { wagmiConfig } from '../lib/wagmi'

// The app offers MetaMask and nothing else. Pinned here rather than left to the components,
// because this is the single place that decides it: `injected({ target: 'metaMask' })` both
// restricts the connector and switches off the EIP-6963 discovery that would otherwise add one
// connector — and, in the header, one button — per wallet the browser announces.
describe('wagmiConfig', () => {
  it('offers exactly one connector, and it is MetaMask', () => {
    expect(wagmiConfig.connectors).toHaveLength(1)
    expect(wagmiConfig.connectors[0]?.name).toMatch(/metamask/i)
  })
})
