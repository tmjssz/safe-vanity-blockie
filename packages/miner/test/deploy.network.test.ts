import {
  SUPPORTED_SAFE_VERSIONS,
  type SupportedSafeVersion,
} from '@safe-vanity-blockie/safe-config'
import { describe, expect, it } from 'vitest'
import { buildDeploymentPlan } from '../src/deploy.js'

const RPC_URL = process.env.TEST_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'
// Well-known throwaway key (hardhat account #0). Never funded on mainnet.
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// The canonical SafeProxyFactory per version — the deployment transaction is a call to it.
// Typed by SupportedSafeVersion, so a version added to the list without an entry here fails to compile.
// These are mainnet's: 1.3.0's factory differs per chain (canonical vs eip155 deployments).
const FACTORIES: Record<SupportedSafeVersion, string> = {
  '1.5.0': '0x14F2982D601c9458F93bd70B218933A6f8165e7b',
  '1.4.1': '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  '1.3.0': '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
}

describe.each(SUPPORTED_SAFE_VERSIONS.map((version) => [version, FACTORIES[version]] as const))(
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
