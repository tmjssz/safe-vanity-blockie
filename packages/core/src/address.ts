import { bytesToHex } from './hex.js'
import type { Keccak256 } from './keccak.js'

/**
 * The three values that are constant for a given (owners, threshold, safeVersion) and therefore
 * precomputed once on the main thread. Only the saltNonce varies per iteration.
 */
export interface SafeConstants {
  /** keccak256 of the ABI-encoded setup() calldata. 32 bytes. */
  readonly initializerHash: Uint8Array
  /** SafeProxyFactory address. 20 bytes. */
  readonly factory: Uint8Array
  /** keccak256(proxyCreationCode ++ abi.encode(address, singleton)). 32 bytes. */
  readonly initCodeHash: Uint8Array
}

export interface AddressDeriver {
  /** Fast path for saltNonce < 2^53. Returns a lowercase 0x address. */
  derive(saltNonce: number): string
  /** Full uint256 path, for verification and huge nonces. Returns a lowercase 0x address. */
  deriveBig(saltNonce: bigint): string
}

const MAX_UINT256 = (1n << 256n) - 1n

/**
 * Builds a deriver whose buffers are allocated once. Each derive() is exactly two keccaks:
 *   salt = keccak256(initializerHash ++ uint256(saltNonce))
 *   address = keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12..32)
 */
export function createAddressDeriver(
  constants: SafeConstants,
  keccak256: Keccak256,
): AddressDeriver {
  const { initializerHash, factory, initCodeHash } = constants
  if (initializerHash.length !== 32) {
    throw new Error(`initializerHash must be 32 bytes, got ${initializerHash.length}`)
  }
  if (factory.length !== 20) throw new Error(`factory must be 20 bytes, got ${factory.length}`)
  if (initCodeHash.length !== 32) {
    throw new Error(`initCodeHash must be 32 bytes, got ${initCodeHash.length}`)
  }

  // Bytes 32..64 are the big-endian uint256 saltNonce. Bytes 32..56 stay zero for derive(),
  // so the fast path only writes the low 8 bytes.
  const saltPreimage = new Uint8Array(64)
  saltPreimage.set(initializerHash, 0)
  const saltView = new DataView(saltPreimage.buffer)

  const create2Preimage = new Uint8Array(85)
  create2Preimage[0] = 0xff
  create2Preimage.set(factory, 1)
  create2Preimage.set(initCodeHash, 53)

  function finish(): string {
    const salt = keccak256(saltPreimage)
    create2Preimage.set(salt, 21)
    return bytesToHex(keccak256(create2Preimage), 12, 32)
  }

  return {
    derive(saltNonce: number): string {
      if (!Number.isSafeInteger(saltNonce) || saltNonce < 0) {
        throw new Error(`derive() needs a non-negative safe integer, got ${saltNonce}`)
      }
      const high = Math.floor(saltNonce / 4294967296)
      saltView.setUint32(56, high)
      saltView.setUint32(60, saltNonce - high * 4294967296)
      return finish()
    },

    deriveBig(saltNonce: bigint): string {
      if (saltNonce < 0n || saltNonce > MAX_UINT256) {
        throw new Error(`deriveBig() needs a uint256, got ${saltNonce}`)
      }
      let remaining = saltNonce
      for (let i = 63; i >= 32; i--) {
        saltPreimage[i] = Number(remaining & 0xffn)
        remaining >>= 8n
      }
      try {
        return finish()
      } finally {
        // Restore the invariant derive() relies on: bytes 32..56 are zero.
        saltPreimage.fill(0, 32, 56)
      }
    },
  }
}
