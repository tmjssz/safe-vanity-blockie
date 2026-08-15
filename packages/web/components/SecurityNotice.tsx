import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription } from './ui/alert'

export function SecurityNotice() {
  return (
    // role="note", not shadcn's hardcoded role="alert": this is permanent, static copy. Left as a
    // live region it competes with every genuine error on the page — and `main`'s version of this
    // component was a note.
    //
    // `variant="warning"` rather than destructive: nothing has gone wrong when this is on screen,
    // it is a standing caution about how to read the grid beside it. The tint lives in the variant
    // because the About dialog shows this same warning, and the two have to stay recognisably one
    // warning rather than two that happen to be worded alike.
    <Alert role="note" variant="warning">
      <ShieldAlert className="h-4 w-4" />
      {/* One flowing sentence rather than an AlertTitle above an AlertDescription. Stacked, it
          read as a heading with a paragraph under it, and at the full content width that left a
          mostly empty first line above a second — a lot of vertical space for a caution that has
          to stay legible without becoming furniture. The lead keeps its emphasis; it just does
          not get a row of its own. */}
      <AlertDescription>
        <p>
          <strong className="font-medium">A matching identicon is cosmetic.</strong> Never treat it
          as proof of an address. Blockie look-alikes are a known phishing vector. Always verify the
          full address.
        </p>
      </AlertDescription>
    </Alert>
  )
}
