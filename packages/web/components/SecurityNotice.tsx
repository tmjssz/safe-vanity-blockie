import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription } from './ui/alert'

export function SecurityNotice() {
  return (
    // role="note", not shadcn's hardcoded role="alert": this is permanent, static copy. Left as a
    // live region it competes with every genuine error on the page — and `main`'s version of this
    // component was a note.
    //
    // Amber rather than `variant="destructive"`. Nothing has gone wrong when this is on screen:
    // it is a standing caution about how to read the grid beside it, and a permanent red panel on
    // a working screen is the fastest way to teach someone to stop seeing it — which is the one
    // thing this particular warning cannot afford. Both palettes are set explicitly rather than
    // left to a `dark:` inversion of one, so the tint is deliberate in each.
    <Alert
      role="note"
      className="border-amber-500/30 bg-amber-500/5 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/5 dark:text-amber-100"
    >
      <ShieldAlert className="h-4 w-4" />
      {/* One flowing sentence rather than an AlertTitle above an AlertDescription. Stacked, it
          read as a heading with a paragraph under it, and at the full content width that left a
          mostly empty first line above a second — a lot of vertical space for a caution that has
          to stay legible without becoming furniture. The lead keeps its emphasis; it just does
          not get a row of its own. */}
      <AlertDescription className="text-amber-900/80 dark:text-amber-100/70">
        <p>
          <strong className="font-medium text-amber-900 dark:text-amber-100">
            A matching identicon is cosmetic.
          </strong>{' '}
          Never treat it as proof of an address. Blockie look-alikes are a known phishing vector.
          Always verify the full address.
        </p>
      </AlertDescription>
    </Alert>
  )
}
