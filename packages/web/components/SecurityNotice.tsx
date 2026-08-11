import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'

export function SecurityNotice() {
  return (
    <Alert>
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>A matching identicon is cosmetic.</AlertTitle>
      <AlertDescription>
        Never treat it as proof of an address — blockie look-alikes are a known phishing
        vector. Always verify the full address.
      </AlertDescription>
    </Alert>
  )
}
