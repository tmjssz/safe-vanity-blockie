import { describe, expect, it } from 'vitest'
import { buildDeploymentPlan } from '../src/deploy.js'

const RPC_URL = process.env.TEST_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'
// Well-known throwaway key (hardhat account #0). Never funded on mainnet.
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

describe('buildDeploymentPlan', () => {
  it('produces a transaction and the address the miner predicted', async () => {
    const plan = await buildDeploymentPlan({
      saltNonce: '5254976178',
      owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
      threshold: 1,
      safeVersion: '1.4.1',
      rpcUrl: RPC_URL,
      privateKey: PRIVATE_KEY,
    })
    expect(plan.chainId).toBe(1n)
    expect(plan.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(plan.transaction.to).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(plan.transaction.data.length).toBeGreaterThan(200)
  }, 120_000)
})
