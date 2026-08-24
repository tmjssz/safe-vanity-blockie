import { describe, expect, it } from 'vitest'
import { maxStartNonce } from '../lib/config'
import { nextStartFrom, planWorkerRanges, WORKER_BLOCK } from '../lib/worker-protocol'

describe('planWorkerRanges', () => {
  it('gives every worker a disjoint, gapless block', () => {
    expect(planWorkerRanges(0, 3, 1_000)).toEqual([
      { start: 0, count: 1_000 },
      { start: 1_000, count: 1_000 },
      { start: 2_000, count: 1_000 },
    ])
  })

  it('honours a non-zero starting nonce', () => {
    expect(planWorkerRanges(500, 2, 1_000)).toEqual([
      { start: 500, count: 1_000 },
      { start: 1_500, count: 1_000 },
    ])
  })
})

describe('nextStartFrom', () => {
  it('is past every range the run covered, so a follow-up never rescans', () => {
    // Worker w covered [start + w*perWorker, + scanned_w). Taking max(scanned) alone would
    // land inside worker 1's range and re-mine most of the run.
    expect(nextStartFrom(500, 1_000, [1_000, 1_000, 1_000])).toBe(3_500)
    expect(nextStartFrom(0, 25_000, [25_000, 25_000, 25_000, 25_000])).toBe(100_000)
  })

  it('handles an early stop where workers scanned unequal amounts', () => {
    // ends are [1000, 1400, 2050]; the highest is what a follow-up must start from
    expect(nextStartFrom(0, 1_000, [1_000, 400, 50])).toBe(2_050)
  })

  it('reduces to start + scanned for a single worker', () => {
    expect(nextStartFrom(0, 1_000, [640])).toBe(640)
  })
})

describe('the range plan at the largest start the form allows', () => {
  // This is what maxStartNonce is FOR, asserted against the plan itself rather than restated: at
  // the ceiling the form accepts, the far end of the last worker's block must still be a distinct
  // JS integer. One nonce past that and two different nonces derive the same address, so the
  // search stops covering new ground with nothing on screen to say so.
  it.each([1, 2, 7, 32])(
    'leaves the last block inside the safe-integer space (%i workers)',
    (workers) => {
      const ranges = planWorkerRanges(maxStartNonce(workers), workers, WORKER_BLOCK)
      const last = ranges[ranges.length - 1]
      const end = last.start + last.count
      expect(Number.isSafeInteger(end)).toBe(true)
      expect(end).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    },
  )

  it('is one nonce short of safe at one past the ceiling', () => {
    const workers = 7
    const ranges = planWorkerRanges(maxStartNonce(workers) + 1, workers, WORKER_BLOCK)
    const last = ranges[ranges.length - 1]
    expect(last.start + last.count).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
  })

  // Disjoint and gapless is the property a resume depends on, and it has to hold at a real
  // starting offset — not only at 0, where an off-by-one in the offset arithmetic is invisible.
  it('stays disjoint and gapless from a non-zero start', () => {
    const ranges = planWorkerRanges(41_200_000_000, 4, WORKER_BLOCK)
    expect(ranges[0].start).toBe(41_200_000_000)
    for (let index = 1; index < ranges.length; index++) {
      expect(ranges[index].start).toBe(ranges[index - 1].start + ranges[index - 1].count)
    }
  })
})
