import { createKeccak } from 'hash-wasm'

export type Keccak256 = (input: Uint8Array) => Uint8Array

/**
 * Creates a keccak-256 function backed by WebAssembly. Real WASM, so the identical module works
 * in Node worker_threads and browser Web Workers. Call once per worker at startup — instantiation
 * is the expensive part, hashing afterwards is not.
 */
export async function createKeccak256(): Promise<Keccak256> {
  const hasher = await createKeccak(256)
  return (input: Uint8Array): Uint8Array => {
    hasher.init()
    hasher.update(input)
    return hasher.digest('binary')
  }
}
