import { createInterface } from 'node:readline/promises'
import Safe, { getSafeAddressFromDeploymentTx, type SafeConfig } from '@safe-global/protocol-kit'
import type { Transaction } from '@safe-global/types-kit'
import { createAddressDeriver, createKeccak256 } from '@safe-vanity-blockie/core'
import { createWalletClient, http, publicActions, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { DeployArgs } from './args.js'
import { loadSafeConstants, verifyWithProtocolKit } from '@safe-vanity-blockie/safe-config'

/**
 * protocol-kit's package.json has no `"type": "module"`, so under this project's
 * `moduleResolution: "nodenext"` TypeScript resolves its `export default Safe` as an
 * implied-CommonJS namespace instead of a real default export: the default import binding
 * types as the whole module namespace rather than the `Safe` class. The runtime value is
 * unaffected (it is still the class) -- only the static type is wrong -- so it is re-typed
 * here against the minimal shape this file actually calls.
 */
interface SafeSdkInstance {
  getAddress(): Promise<string>
  createSafeDeploymentTransaction(): Promise<Transaction>
}
interface SafeSdkStatic {
  init(config: SafeConfig): Promise<SafeSdkInstance>
}
const SafeSdk = Safe as unknown as SafeSdkStatic

export interface DeploymentPlan {
  address: string
  chainId: bigint
  transaction: { to: string; value: string; data: string }
}

/** Builds (but never sends) the deployment transaction, and confirms the predicted address. */
export async function buildDeploymentPlan(options: DeployArgs): Promise<DeploymentPlan> {
  const setup = await loadSafeConstants({
    rpcUrl: options.rpcUrl,
    owners: options.owners,
    threshold: options.threshold,
    safeVersion: options.safeVersion,
    isL1SafeSingleton: options.isL1SafeSingleton,
  })

  const safe = await SafeSdk.init({
    provider: options.rpcUrl,
    signer: options.privateKey,
    isL1SafeSingleton: options.isL1SafeSingleton,
    predictedSafe: {
      safeAccountConfig: setup.safeAccountConfig,
      safeDeploymentConfig: { saltNonce: options.saltNonce, safeVersion: options.safeVersion },
    },
  })

  const address = await safe.getAddress()

  // Independent cross-implementation check: derive the address ourselves from the constants
  // loadSafeConstants already computed, using the same fast deriver the miner uses. For a
  // predictedSafe, protocol-kit's Safe.getAddress() IS predictSafeAddress() with these same
  // inputs, so comparing verifyWithProtocolKit's predictSafeAddress call against `address`
  // (below) can never disagree -- it is a consistency check on protocol-kit's own inputs, not
  // an independent one. This deriver comparison is the independent one: a different --owners
  // order, --threshold, --safe-version, or --l1-singleton mismatch would change `setup.constants`
  // but not `address` in a way this catches.
  const keccak256 = await createKeccak256()
  const derived = createAddressDeriver(setup.constants, keccak256).deriveBig(BigInt(options.saltNonce))
  if (derived.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      `self-check failed for saltNonce ${options.saltNonce}: protocol-kit predicted ${address}, ` +
        `the independent CREATE2 deriver gave ${derived}`,
    )
  }

  // Cheap and harmless consistency check on protocol-kit's own inputs (see comment above).
  await verifyWithProtocolKit(setup, options.saltNonce, address)
  const transaction = await safe.createSafeDeploymentTransaction()

  return {
    address,
    chainId: setup.chainId,
    transaction: { to: transaction.to, value: transaction.value, data: transaction.data },
  }
}

export async function runDeploy(options: DeployArgs): Promise<number> {
  const plan = await buildDeploymentPlan(options)
  process.stdout.write(
    `Deploying Safe ${plan.address} on chain ${plan.chainId} with saltNonce ${options.saltNonce}\n` +
      `  owners: ${options.owners.join(', ')}\n` +
      `  threshold: ${options.threshold}\n`,
  )

  if (process.stdin.isTTY && !options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    let answer: string
    try {
      answer = await rl.question('Type "yes" to broadcast this deployment transaction: ')
    } finally {
      rl.close()
    }
    if (answer.trim() !== 'yes') {
      process.stderr.write('Aborted: deployment not confirmed. No transaction was sent.\n')
      return 1
    }
  }

  const account = privateKeyToAccount(options.privateKey as Hex)
  const client = createWalletClient({
    account,
    transport: http(options.rpcUrl),
  }).extend(publicActions)

  const hash = await client.sendTransaction({
    to: plan.transaction.to as Hex,
    value: BigInt(plan.transaction.value),
    data: plan.transaction.data as Hex,
    chain: null,
  })
  process.stdout.write(`Transaction sent: ${hash}\nWaiting for confirmation…\n`)

  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    process.stderr.write(`Deployment reverted in ${receipt.transactionHash}\n`)
    return 1
  }

  const deployed = getSafeAddressFromDeploymentTx(receipt, options.safeVersion)
  if (deployed.toLowerCase() !== plan.address.toLowerCase()) {
    process.stderr.write(
      `Deployed address ${deployed} does not match the predicted ${plan.address}\n`,
    )
    return 1
  }

  process.stdout.write(`Safe deployed at ${deployed}\n`)
  return 0
}
