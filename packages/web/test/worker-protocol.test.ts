import { describe, expect, it } from 'vitest'
import { nextStartFrom, planWorkerRanges } from '../lib/worker-protocol'

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
