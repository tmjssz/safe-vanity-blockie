import type { Eip1193Provider, SafeConfig } from '@safe-global/protocol-kit'
import Safe from '@safe-global/protocol-kit'
import type { Transaction } from '@safe-global/types-kit'
import {
  createAddressDeriver,
  createKeccak256,
  type SafeConstants,
} from '@safe-vanity-blockie/core'
import { type SafeSetup, verifyWithProtocolKit } from '@safe-vanity-blockie/safe-config'

/**
 * protocol-kit's default export resolves as an implied-CommonJS namespace under bundler
 * resolution, so it is asserted here against the minimal shape this file calls.
 */
interface SafeSdkInstance {
  getAddress(): Promise<string>
  createSafeDeploymentTransaction(): Promise<Transaction>
}
interface SafeSdkStatic {
  init(config: SafeConfig): Promise<SafeSdkInstance>
}
const SafeSdk = Safe as unknown as SafeSdkStatic

const SALT_PATTERN = /^[0-9]+$/

export interface DeploymentPlan {
  address: string
  chainId: number
  transaction: { to: string; value: string; data: string }
}

/**
 * Derives the address independently from the CREATE2 constants and compares it with the one
 * protocol-kit predicted. This is the check that matters: protocol-kit's own `getAddress()`
 * IS `predictSafeAddress`, so comparing those two proves nothing.
 */
export async function assertDerivedAddressMatches(
  constants: SafeConstants,
  saltNonce: string,
  predicted: string,
): Promise<void> {
  if (!SALT_PATTERN.test(saltNonce)) {
    throw new Error(`saltNonce "${saltNonce}" is not a decimal integer.`)
  }
  const keccak256 = await createKeccak256()
  const derived = createAddressDeriver(constants, keccak256).deriveBig(BigInt(saltNonce))
  if (derived.toLowerCase() !== predicted.toLowerCase()) {
    throw new Error(
      `Derived address ${derived} does not match protocol-kit's prediction ` +
        `${predicted.toLowerCase()} for saltNonce ${saltNonce}. Refusing to deploy.`,
    )
  }
}

/** Builds — but never sends — the deployment transaction, after both cross-checks pass. */
export async function buildDeploymentPlan(input: {
  setup: SafeSetup
  saltNonce: string
  provider: Eip1193Provider
  signer: string
  chainId: number
}): Promise<DeploymentPlan> {
  const safe = await SafeSdk.init({
    provider: input.provider,
    signer: input.signer,
    predictedSafe: {
      safeAccountConfig: input.setup.safeAccountConfig,
      safeDeploymentConfig: {
        saltNonce: input.saltNonce,
        safeVersion: input.setup.safeVersion,
      },
    },
  } as SafeConfig)

  const address = await safe.getAddress()

  // The independent cross-check: our own two-keccak CREATE2 derivation against protocol-kit's
  // prediction. This is the one that can actually catch a bug, in either implementation.
  await assertDerivedAddressMatches(input.setup.constants, input.saltNonce, address)
  // A second, cheaper consistency check on protocol-kit's own inputs: for a predictedSafe,
  // safe.getAddress() above IS predictSafeAddress() with these same inputs, so this call can
  // never disagree with `address` — it is not independent, but it is free to keep.
  await verifyWithProtocolKit(input.setup, input.saltNonce, address)

  const transaction = await safe.createSafeDeploymentTransaction()
  return {
    address,
    chainId: input.chainId,
    transaction: { to: transaction.to, value: transaction.value, data: transaction.data },
  }
}
