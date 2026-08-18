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
  register: (entry: StartOverEntry | null) => void
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
  const register = useCallback((next: StartOverEntry | null) => setEntry(next), [])
  return (
    <StartOverContext.Provider value={{ entry, register }}>{children}</StartOverContext.Provider>
  )
}

/**
 * Tells the header there is a run to go back from, for exactly as long as the caller is mounted.
 * Unmounting is the deregistration, so nothing has to remember to undo this — the title returns
 * to being a plain heading the moment the run it acted on is gone.
 *
 * Outside a provider (a bare component in a unit test) it does nothing at all.
 */
export function useRegisterStartOver(resultCount: number, startOver: () => void) {
  // Written on every render, read only when the user clicks, so a per-tick count never reaches
  // the effect's dependencies — and therefore never re-registers, and never re-renders the header.
  const latest = useRef({ resultCount, startOver })
  latest.current = { resultCount, startOver }

  const register = useContext(StartOverContext)?.register
  useEffect(() => {
    if (!register) return
    register({
      resultCount: () => latest.current.resultCount,
      startOver: () => latest.current.startOver(),
    })
    return () => register(null)
  }, [register])
}

/**
 * The app name in the header, and — once there is a run — the second door back to the Configure
 * card. Idle it is exactly what it was: static text, server-rendered, nothing to press. There is
 * no initial page to return to from the initial page, and a control that does nothing when
 * pressed teaches people that this header is scenery.
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
