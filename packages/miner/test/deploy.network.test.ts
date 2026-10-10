import { describe, expect, it } from 'vitest'
import { buildDeploymentPlan } from '../src/deploy.js'

const RPC_URL = process.env.TEST_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'
// Well-known throwaway key (hardhat account #0). Never funded on mainnet.
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// The canonical SafeProxyFactory per version — the deployment transaction is a call to it.
const FACTORIES = {
  '1.5.0': '0x14F2982D601c9458F93bd70B218933A6f8165e7b',
  '1.4.1': '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
} as const

describe.each(Object.entries(FACTORIES) as [keyof typeof FACTORIES, string][])(
  'buildDeploymentPlan (Safe %s)',
  (safeVersion, factory) => {
    it("produces a transaction to the version's factory and the address the miner predicted", async () => {
      const plan = await buildDeploymentPlan({
        saltNonce: '5254976178',
        owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
        threshold: 1,
        safeVersion,
        rpcUrl: RPC_URL,
        privateKey: PRIVATE_KEY,
        yes: true,
      })
      expect(plan.chainId).toBe(1n)
      expect(plan.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(plan.transaction.to.toLowerCase()).toBe(factory.toLowerCase())
      expect(plan.transaction.data.length).toBeGreaterThan(200)
    }, 120_000)
  },
)
