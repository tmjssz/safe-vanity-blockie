// createPool defaults to resolving its worker as `./worker.js` relative to its own module URL.
// That's correct once pool.ts runs compiled as dist/pool.js, but under vitest pool.ts runs
// straight from src/, so the same lookup would resolve into src/ (where only worker.ts exists,
// not a compiled worker.js). Every createPool call below passes an explicit `workerUrl` pointing
// at the compiled dist/worker.js instead, so the package must be built (`pnpm -r build`) before
// this test runs.
import {
  compileFace,
  createKeccak256,
  createMiner,
  getTemplate,
  hexToBytes,
} from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { createPool } from '../src/pool.js'

const CONSTANTS_HEX = {
  initializerHash: '0x' + '11'.repeat(32),
  factory: '0x' + '22'.repeat(20),
  initCodeHash: '0x' + '33'.repeat(32),
}
const CONSTANTS = {
  initializerHash: hexToBytes(CONSTANTS_HEX.initializerHash),
  factory: hexToBytes(CONSTANTS_HEX.factory),
  initCodeHash: hexToBytes(CONSTANTS_HEX.initCodeHash),
}
const FACE_SPEC = getTemplate('faces')

describe('createPool', () => {
  it('reproduces a single-threaded run over the same contiguous range', async () => {
    const pool = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      workers: 4,
      perWorker: 25_000,
      keep: 10,
      chunkSize: 5000,
      workerUrl: new URL('../dist/worker.js', import.meta.url),
    })
    const result = await pool.run()

    const keccak256 = await createKeccak256()
    const single = createMiner(CONSTANTS, compileFace(FACE_SPEC), keccak256).mine({
      start: 0,
      count: 100_000,
      keep: 10,
    })

    expect(result.scanned).toBe(100_000)
    expect(result.scannedPerWorker).toEqual([25_000, 25_000, 25_000, 25_000])
    expect(result.candidates).toEqual(single.candidates)
    expect(result.nextStart).toBe(100_000)
  })

  it('reports aggregate progress while running', async () => {
    const snapshots: number[] = []
    const pool = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      workers: 2,
      perWorker: 20_000,
      keep: 5,
      chunkSize: 2000,
      workerUrl: new URL('../dist/worker.js', import.meta.url),
      onProgress: (progress) => {
        snapshots.push(progress.scanned)
        expect(progress.rate).toBeGreaterThanOrEqual(0)
      },
    })
    await pool.run()
    expect(snapshots.length).toBeGreaterThan(0)
    expect(Math.max(...snapshots)).toBeLessThanOrEqual(40_000)
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBeGreaterThanOrEqual(snapshots[i - 1])
    }
  })

  it('stops early and still returns the best found so far', async () => {
    const pool = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      workers: 2,
      perWorker: 50_000_000,
      keep: 5,
      chunkSize: 5000,
      workerUrl: new URL('../dist/worker.js', import.meta.url),
      onProgress: () => pool.stop(),
    })
    const result = await pool.run()
    expect(result.scanned).toBeGreaterThan(0)
    expect(result.scanned).toBeLessThan(100_000_000)
    expect(result.candidates.length).toBeGreaterThan(0)
  })

  it('keeps worker ranges disjoint so nextStart can resume without rescanning', async () => {
    const pool = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 500,
      workers: 3,
      perWorker: 1000,
      keep: 20,
      chunkSize: 500,
      workerUrl: new URL('../dist/worker.js', import.meta.url),
    })
    const result = await pool.run()
    const nonces = result.candidates.map((candidate) => Number(candidate.saltNonce))
    expect(new Set(nonces).size).toBe(nonces.length)
    for (const nonce of nonces) {
      expect(nonce).toBeGreaterThanOrEqual(500)
      expect(nonce).toBeLessThan(500 + 3 * 1000)
    }
    expect(result.nextStart).toBe(3500)
  })

  it('resumes from nextStart without rescanning or overlapping the previous run', async () => {
    const poolA = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      workers: 2,
      perWorker: 1000,
      keep: 20,
      workerUrl: new URL('../dist/worker.js', import.meta.url),
    })
    const resultA = await poolA.run()
    expect(resultA.nextStart).toBe(2000)

    const poolB = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: resultA.nextStart,
      workers: 2,
      perWorker: 1000,
      keep: 20,
      workerUrl: new URL('../dist/worker.js', import.meta.url),
    })
    const resultB = await poolB.run()

    const noncesA = resultA.candidates.map((candidate) => Number(candidate.saltNonce))
    const noncesB = resultB.candidates.map((candidate) => Number(candidate.saltNonce))
    for (const nonce of noncesA) expect(nonce).toBeLessThan(2000)
    for (const nonce of noncesB) expect(nonce).toBeGreaterThanOrEqual(2000)

    const addressesA = new Set(resultA.candidates.map((candidate) => candidate.address))
    const addressesB = new Set(resultB.candidates.map((candidate) => candidate.address))
    for (const address of addressesB) expect(addressesA.has(address)).toBe(false)
  })
})
