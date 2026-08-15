import {
  encodeSetupCallData,
  getSafeContract,
  getSafeProxyFactoryContract,
  predictSafeAddress,
  SafeProvider,
} from '@safe-global/protocol-kit'
import type { SafeVersion } from '@safe-global/types-kit'
import { hexToBytes, type SafeConstants } from '@safe-vanity-blockie/core'
import { concat, type Hex, keccak256 } from 'viem'

export interface SetupInput {
  rpcUrl: string
  owners: string[]
  threshold: number
  safeVersion: SafeVersion
  /** Force the L1 singleton on an L2 chain. Must match what deployment will use. */
  isL1SafeSingleton?: boolean
}

export interface SafeSetup {
  chainId: bigint
  constants: SafeConstants
  constantsHex: { initializerHash: Hex; factory: Hex; initCodeHash: Hex }
  safeProvider: SafeProvider
  safeAccountConfig: { owners: string[]; threshold: number }
  safeVersion: SafeVersion
  isL1SafeSingleton?: boolean
}

/**
 * zkSync Era and friends derive CREATE2 addresses with a different formula (spec §3.1).
 * These are the chain IDs protocol-kit itself gates its zkSync formula on internally
 * (ZKSYNC_MAINNET = 324, ZKSYNC_TESTNET = 300, ZKSYNC_LENS = 232), per the installed
 * @safe-global/protocol-kit@8.0.5 source. protocol-kit additionally gates on
 * `safeVersion <= 1.4.1`, which covers every version this CLI supports (1.4.1 and 1.3.0),
 * so a plain set membership check on chain ID is sufficient here.
 */
export const ZKSYNC_CHAIN_IDS: ReadonlySet<bigint> = new Set([324n, 300n, 232n])

/**
 * Reads chainId and the three constants that stay fixed for a given
 * (owners, threshold, safeVersion). Runs once on the main thread; workers get plain hex.
 */
export async function loadSafeConstants(input: SetupInput): Promise<SafeSetup> {
  const safeProvider = new SafeProvider({ provider: input.rpcUrl })
  const chainId = await safeProvider.getChainId()

  if (ZKSYNC_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `chain ${chainId} is zkSync-based and derives contract addresses with a different formula; ` +
        'this tool would predict the wrong address. Use a standard EVM chain.',
    )
  }

  const safeAccountConfig = { owners: input.owners, threshold: input.threshold }

  const factoryContract = await getSafeProxyFactoryContract({
    safeProvider,
    safeVersion: input.safeVersion,
  })
  const safeContract = await getSafeContract({
    safeProvider,
    safeVersion: input.safeVersion,
    isL1SafeSingleton: input.isL1SafeSingleton,
  })

  const initializer = await encodeSetupCallData({
    safeProvider,
    safeAccountConfig,
    safeContract,
    customSafeVersion: input.safeVersion,
  })
  const initializerHash = keccak256(initializer as Hex)

  // proxyCreationCode() returns a single-element tuple, not a bare string.
  const [proxyCreationCode] = await factoryContract.proxyCreationCode()
  const encodedSingleton = safeProvider.encodeParameters('address', [safeContract.getAddress()])
  const initCodeHash = keccak256(concat([proxyCreationCode as Hex, encodedSingleton as Hex]))
  const factory = factoryContract.getAddress() as Hex

  return {
    chainId,
    constants: {
      initializerHash: hexToBytes(initializerHash),
      factory: hexToBytes(factory),
      initCodeHash: hexToBytes(initCodeHash),
    },
    constantsHex: { initializerHash, factory, initCodeHash },
    safeProvider,
    safeAccountConfig,
    safeVersion: input.safeVersion,
    isL1SafeSingleton: input.isL1SafeSingleton,
  }
}

/** Cross-checks one mined result against protocol-kit. Run this every session (spec §11). */
export async function verifyWithProtocolKit(
  setup: SafeSetup,
  saltNonce: string,
  address: string,
): Promise<void> {
  const predicted = await predictSafeAddress({
    safeProvider: setup.safeProvider,
    chainId: setup.chainId,
    safeAccountConfig: setup.safeAccountConfig,
    safeDeploymentConfig: { saltNonce, safeVersion: setup.safeVersion },
    isL1SafeSingleton: setup.isL1SafeSingleton,
  })
  if (predicted.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      `self-check failed for saltNonce ${saltNonce}: fast derivation gave ${address}, ` +
        `protocol-kit predictSafeAddress gave ${predicted.toLowerCase()}`,
    )
  }
}
