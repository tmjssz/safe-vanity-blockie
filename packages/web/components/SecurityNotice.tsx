import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'

export function SecurityNotice() {
  return (
    // role="note", not shadcn's hardcoded role="alert": this is permanent, static copy. Left as a
    // live region it competes with every genuine error on the page — and `main`'s version of this
    // component was a note.
    <Alert role="note">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>A matching identicon is cosmetic.</AlertTitle>
      <AlertDescription>
        Never treat it as proof of an address — blockie look-alikes are a known phishing
        vector. Always verify the full address.
      </AlertDescription>
    </Alert>
  )
}
