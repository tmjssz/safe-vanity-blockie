import { createAddressDeriver, createKeccak256 } from '@safe-vanity-blockie/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadSafeConstants, verifyWithProtocolKit, type SafeSetup } from '../src/setup.js'

const RPC_URL = process.env.TEST_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'
const OWNERS = ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']

let setup: SafeSetup

beforeAll(async () => {
  setup = await loadSafeConstants({
    rpcUrl: RPC_URL,
    owners: OWNERS,
    threshold: 1,
    safeVersion: '1.4.1',
  })
}, 120_000)

describe('loadSafeConstants', () => {
  it('reads the chain id and returns correctly sized constants', () => {
    expect(setup.chainId).toBe(1n)
    expect(setup.constants.initializerHash).toHaveLength(32)
    expect(setup.constants.factory).toHaveLength(20)
    expect(setup.constants.initCodeHash).toHaveLength(32)
    expect(setup.constantsHex.factory).toMatch(/^0x[0-9a-fA-F]{40}$/)
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
      safeVersion: '1.4.1',
    })
    expect(again.constantsHex).toEqual(setup.constantsHex)
  })
})
