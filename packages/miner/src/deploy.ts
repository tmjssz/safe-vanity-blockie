import Safe, { getSafeAddressFromDeploymentTx, type SafeConfig } from '@safe-global/protocol-kit'
import type { Transaction } from '@safe-global/types-kit'
import { createWalletClient, http, publicActions, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { DeployArgs } from './args.js'
import { loadSafeConstants, verifyWithProtocolKit } from './setup.js'

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
    `Deploying Safe ${plan.address} on chain ${plan.chainId} with saltNonce ${options.saltNonce}\n`,
  )

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
