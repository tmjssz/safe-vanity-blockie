import { createAddressDeriver, createKeccak256 } from '@safe-vanity-blockie/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadSafeConstants, type SafeSetup, verifyWithProtocolKit } from '../src/setup.js'
import { SUPPORTED_SAFE_VERSIONS, type SupportedSafeVersion } from '../src/versions.js'

const RPC_URL = process.env.TEST_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'
const OWNERS = ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']

// The canonical SafeProxyFactory per version, from safe-deployments.
// Typed by SupportedSafeVersion, so a version added to the list without an entry here fails to compile.
// These are mainnet's: 1.3.0's factory differs per chain (canonical vs eip155 deployments).
const FACTORIES: Record<SupportedSafeVersion, string> = {
  '1.5.0': '0x14F2982D601c9458F93bd70B218933A6f8165e7b',
  '1.4.1': '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  '1.3.0': '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
}

describe.each(SUPPORTED_SAFE_VERSIONS.map((version) => [version, FACTORIES[version]] as const))(
  'loadSafeConstants (Safe %s)',
  (safeVersion, factory) => {
    let setup: SafeSetup

    beforeAll(async () => {
      setup = await loadSafeConstants({
        rpcUrl: RPC_URL,
        owners: OWNERS,
        threshold: 1,
        safeVersion,
      })
    }, 120_000)

    it('reads the chain id and returns correctly sized constants', () => {
      expect(setup.chainId).toBe(1n)
      expect(setup.constants.initializerHash).toHaveLength(32)
      expect(setup.constants.factory).toHaveLength(20)
      expect(setup.constants.initCodeHash).toHaveLength(32)
      expect(setup.constantsHex.factory.toLowerCase()).toBe(factory.toLowerCase())
    })

    it('derives the same address as protocol-kit predictSafeAddress', async () => {
      const keccak256 = await createKeccak256()
      const deriver = createAddressDeriver(setup.constants, keccak256)
      for (const saltNonce of [0, 1, 12345, 5254976178]) {
        await expect(
          verifyWithProtocolKit(setup, String(saltNonce), deriver.derive(saltNonce)),
        ).resolves.toBeUndefined()
      }
    })

    it('throws a clear mismatch error when the address is wrong', async () => {
      await expect(verifyWithProtocolKit(setup, '1', '0x' + '00'.repeat(20))).rejects.toThrow(
        /self-check failed/,
      )
    })

    it('produces the same constants for the same config on a second call', async () => {
      const again = await loadSafeConstants({
        rpcUrl: RPC_URL,
        owners: OWNERS,
        threshold: 1,
        safeVersion,
      })
      expect(again.constantsHex).toEqual(setup.constantsHex)
    })
  },
)
