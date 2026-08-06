import { parentPort, workerData } from 'node:worker_threads'
import {
  compileFace,
  createKeccak256,
  createMiner,
  hexToBytes,
  type Candidate,
  type FaceSpec,
} from '@safe-vanity-blockie/core'

export interface WorkerInput {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  start: number
  count: number
  keep: number
  chunkSize: number
  /** Int32Array view, slot 0: non-zero means stop at the next chunk boundary. */
  stopFlag: SharedArrayBuffer
}

export type WorkerMessage =
  | { type: 'progress'; scanned: number; candidates: Candidate[] }
  | { type: 'done'; scanned: number; candidates: Candidate[] }
  | { type: 'error'; message: string }

async function main(): Promise<void> {
  const input = workerData as WorkerInput
  const port = parentPort
  if (!port) throw new Error('worker.ts must be run as a worker thread')

  const keccak256 = await createKeccak256()
  const face = compileFace(input.faceSpec)
  const constants = {
    initializerHash: hexToBytes(input.constantsHex.initializerHash),
    factory: hexToBytes(input.constantsHex.factory),
    initCodeHash: hexToBytes(input.constantsHex.initCodeHash),
  }
  const stop = new Int32Array(input.stopFlag)

  const result = createMiner(constants, face, keccak256).mine({
    start: input.start,
    count: input.count,
    keep: input.keep,
    chunkSize: input.chunkSize,
    onProgress: (scanned, best) => {
      port.postMessage({ type: 'progress', scanned, candidates: best } satisfies WorkerMessage)
      return Atomics.load(stop, 0) === 0
    },
  })

  port.postMessage({
    type: 'done',
    scanned: result.scanned,
    candidates: result.candidates,
  } satisfies WorkerMessage)
}

main().catch((error: unknown) => {
  parentPort?.postMessage({
    type: 'error',
    message: error instanceof Error ? (error.stack ?? error.message) : String(error),
  } satisfies WorkerMessage)
  process.exitCode = 1
})
