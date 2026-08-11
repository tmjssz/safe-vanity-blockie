import {
  compileFace,
  createKeccak256,
  createMiner,
  getTemplate,
  hexToBytes,
} from '@safe-vanity-blockie/core'
import { describe, expect, it, vi } from 'vitest'
import { runBrowserMiner } from '../lib/browser-miner'

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

describe('runBrowserMiner', () => {
  it('produces exactly what a single synchronous run over the same range produces', async () => {
    const result = await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      count: 20_000,
      keep: 10,
      sliceSize: 3_000,
    })

    const keccak256 = await createKeccak256()
    const single = createMiner(CONSTANTS, compileFace(FACE_SPEC), keccak256).mine({
      start: 0,
      count: 20_000,
      keep: 10,
    })

    expect(result.scanned).toBe(20_000)
    expect(result.candidates).toEqual(single.candidates)
  })

  it('yields between slices so a stop signal can be observed', async () => {
    const yieldToEventLoop = vi.fn(async () => {})
    await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      count: 10_000,
      keep: 5,
      sliceSize: 2_500,
      yieldToEventLoop,
    })
    // four slices means four opportunities for the message queue to drain
    expect(yieldToEventLoop).toHaveBeenCalledTimes(4)
  })

  it('stops at the next slice boundary when asked', async () => {
    let slices = 0
    const result = await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      count: 1_000_000,
      keep: 5,
      sliceSize: 1_000,
      shouldStop: () => ++slices >= 3,
    })
    expect(result.scanned).toBe(3_000)
  })

  it('reports cumulative progress with the best so far at every slice', async () => {
    const seen: number[] = []
    await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      count: 9_000,
      keep: 5,
      sliceSize: 3_000,
      onSlice: (progress) => {
        seen.push(progress.scanned)
        expect(progress.candidates.length).toBeLessThanOrEqual(5)
      },
    })
    expect(seen).toEqual([3_000, 6_000, 9_000])
  })

  it('covers the exact range asked for when count is not a multiple of the slice', async () => {
    const result = await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 100,
      count: 2_500,
      keep: 3,
      sliceSize: 1_000,
    })
    const keccak256 = await createKeccak256()
    const single = createMiner(CONSTANTS, compileFace(FACE_SPEC), keccak256).mine({
      start: 100,
      count: 2_500,
      keep: 3,
    })
    expect(result.scanned).toBe(2_500)
    expect(result.candidates).toEqual(single.candidates)
  })
})
