import { afterEach, describe, expect, it, vi } from 'vitest'
import { plannedWorkerCount } from '../lib/worker-count'

/** jsdom's navigator is not configurable by assignment; each case installs its own. */
function withCores(cores: number | undefined) {
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true })
}

afterEach(() => {
  vi.unstubAllGlobals()
  withCores(4)
})

describe('plannedWorkerCount', () => {
  // One core is left for the UI thread: the tab has to stay able to paint the results it is
  // finding, and a pool the width of the machine makes the page it reports to unresponsive.
  it('leaves one core for the UI', () => {
    withCores(8)
    expect(plannedWorkerCount()).toBe(7)
  })

  // A single-core machine still gets a worker. Zero would be a pool that reports nothing while
  // the status bar counts up from a run that cannot exist.
  it('never plans fewer than one worker', () => {
    withCores(1)
    expect(plannedWorkerCount()).toBe(1)
  })

  it('assumes four cores when the browser will not say', () => {
    withCores(undefined)
    expect(plannedWorkerCount()).toBe(3)
    withCores(0)
    expect(plannedWorkerCount()).toBe(3)
  })

  // ConfigForm reads this during render, and unlike MiningView it renders on the server, where
  // there is no navigator at all. Throwing here would take the whole starting screen down.
  it('survives having no navigator, as on the server', () => {
    vi.stubGlobal('navigator', undefined)
    expect(plannedWorkerCount()).toBe(3)
  })
})
