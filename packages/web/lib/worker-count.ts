'use client'

import { useState } from 'react'

/**
 * How many mining workers a run gets: one per core, less one left for the UI thread — the tab has
 * to stay able to paint the results it is finding.
 *
 * It lives here, in a module of its own, because there are two callers who must agree: MiningView
 * builds the pool with it, and ConfigForm needs it to know how high a starting nonce it can accept
 * (see maxStartNonce — the ceiling moves with the pool's reach). A second copy of this arithmetic
 * is how a form ends up accepting a start the pool then walks past the safe-integer limit from.
 *
 * Not in lib/worker-protocol, which would be the obvious home: workers/mine.worker.ts imports that
 * module, and the hook below would pull React into the worker bundle.
 *
 * The `typeof` guard is defence for a runtime that defines no `navigator`, and this deployment is
 * not one. ConfigForm is a client component that Next still renders on the SERVER — and unlike
 * MiningView, which only ever mounts after a submit, it is on screen for that render — but Node has
 * defined `navigator.hardwareConcurrency` since 21, so on this repo's Node 24 the guard never
 * fires: the server render reads the SERVER's core count. That is harmless here because the number
 * never reaches that render's DOM — the only text carrying it is the field's complaint, and the
 * field is never complained about on the server. A typed value needs the field left once, which is
 * a client event; a SEEDED value is complained about from the initialiser (see ConfigForm's
 * `startNonceTouched`), but a seed comes from a `?config=` link or from a previous submit, and
 * neither exists on a server render — one needs useSearchParams(), the other is state that starts
 * undefined. So the two core counts can still never both reach the DOM, and hydration has nothing
 * to disagree about. The guard stays because it costs a `typeof` and a runtime without `navigator`
 * would otherwise take the whole starting screen down with a TypeError. Four is the fallback
 * because it is the commonest core count a browser that declines to answer actually has.
 */
export function plannedWorkerCount(): number {
  const cores = typeof navigator === 'undefined' ? 0 : navigator.hardwareConcurrency
  return Math.max(1, (cores || 4) - 1)
}

/**
 * The same number, resolved once per mount and then held.
 *
 * Held rather than recomputed, because a pool's width is part of a run's identity (MiningView
 * restarts on a change) and hardwareConcurrency is not contractually stable across reads. A value
 * that re-derived itself mid-render could tear down a live search for nothing.
 */
export function useWorkerCount(): number {
  const [workers] = useState(plannedWorkerCount)
  return workers
}
