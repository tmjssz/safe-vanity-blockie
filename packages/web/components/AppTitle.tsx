'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useStartOverConfirm } from './StartOverDialog'

const APP_NAME = 'Safe Vanity Blockie'

/**
 * A run, as the header needs to see it: how much would be thrown away, and how to throw it away.
 *
 * Both are functions, and that is the point. The result count changes several times a second
 * during a search; read as a value it would re-render the header at that rate, which is exactly
 * what the status bar's portal was arranged to avoid. Read on the click instead, the header
 * re-renders twice a run — once when a run starts, once when it ends.
 */
interface StartOverEntry {
  resultCount: () => number
  startOver: () => void
}

const StartOverContext = createContext<{
  entry: StartOverEntry | null
  /** Returns the unregister for exactly this entry. See StartOverProvider. */
  register: (entry: StartOverEntry) => () => void
} | null>(null)

/**
 * Wraps the header and the page together, which is why it lives in app/providers.tsx: the title
 * is chrome the layout renders, and the run it acts on is state the page owns. A portal (the
 * arrangement the chain selector and the status bar use) cannot do this one — those move a
 * control INTO chrome, whereas this makes chrome that is already there become a control, and a
 * portal appends rather than replaces.
 */
export function StartOverProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<StartOverEntry | null>(null)

  /**
   * Registers an entry and hands back the undo for that one entry.
   *
   * Two callers hand this back and forth now — the page while the Configure card is up, MiningView
   * while a run is — so the unregister compares before it clears: it releases its OWN entry and
   * leaves anyone else's alone. Returning it, rather than exposing a `register(null)` anybody can
   * call, is what makes that possible at all.
   *
   * Defence in depth rather than a bug being fixed: React runs every teardown in a commit before
   * every setup, so the handover as the app performs it cannot deliver a stale clear after the new
   * registration (measured, when this was written, by logging both sides through a submit and a
   * reset). The compare costs one identity check and means a future arrangement that does not have
   * that guarantee — a third caller, a registration moved behind a transition — degrades to "last
   * registration wins" instead of to a dead title.
   */
  const register = useCallback((next: StartOverEntry) => {
    setEntry(next)
    return () => setEntry((current) => (current === next ? null : current))
  }, [])

  return (
    <StartOverContext.Provider value={{ entry, register }}>{children}</StartOverContext.Provider>
  )
}

/**
 * Tells the header what pressing the app name should throw away, for exactly as long as the caller
 * is mounted. Unmounting is the deregistration, so nothing has to remember to undo this.
 *
 * `enabled` is for a caller that outlives the screen it speaks for. MiningView does not need it —
 * it exists only during a run, so mounting and unmounting say everything — but the page is mounted
 * throughout and registers the idle reset only while the Configure card is the thing on screen.
 * Passing `false` is the same as not registering, and releases the entry if this had it.
 *
 * Outside a provider (a bare component in a unit test) it does nothing at all.
 */
export function useRegisterStartOver(resultCount: number, startOver: () => void, enabled = true) {
  // Written on every render, read only when the user clicks, so a per-tick count never reaches
  // the effect's dependencies — and therefore never re-registers, and never re-renders the header.
  const latest = useRef({ resultCount, startOver })
  latest.current = { resultCount, startOver }

  const register = useContext(StartOverContext)?.register
  useEffect(() => {
    if (!register || !enabled) return
    return register({
      resultCount: () => latest.current.resultCount,
      startOver: () => latest.current.startOver(),
    })
  }, [register, enabled])
}

/**
 * The app name in the header, and the way back to a clean start. During a run that is the only way
 * back at all: the status bar's "Start over" was removed, which makes this the whole exit rather
 * than a convenience beside one.
 *
 * It is a control on the idle screen too. It used to be plain text there, on the reasoning that
 * there is no initial page to return to from the initial page and a control that does nothing when
 * pressed teaches people the header is scenery — but "start again" is not nothing on a screen
 * holding half-typed owners, narrowed floors and a link's prefill, and a title that is a control
 * on one screen and dead text on another is a worse lesson than either. It resets the form.
 *
 * Still plain text when nobody has registered anything to reset, which is what a bare unit test
 * and a server render both are.
 */
export function AppTitle() {
  const entry = useContext(StartOverContext)?.entry ?? null
  // Called through the entry rather than captured from it: the confirmation is answered after the
  // click that asked, so this has to reset the run that is on screen then — not the one that was
  // registered when this rendered.
  const { request, dialog } = useStartOverConfirm(useCallback(() => entry?.startOver(), [entry]))

  return (
    <>
      <h1 className="text-lg font-semibold">
        {entry ? (
          <button
            type="button"
            // Negative margin so the hit area grows without the title moving: the header is a
            // fixed 14 units tall and this sits on the same baseline it always did.
            className="-mx-2 -my-1 rounded-md px-2 py-1 transition-colors outline-none hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => request(entry.resultCount())}
          >
            {APP_NAME}
          </button>
        ) : (
          APP_NAME
        )}
      </h1>
      {dialog}
    </>
  )
}
