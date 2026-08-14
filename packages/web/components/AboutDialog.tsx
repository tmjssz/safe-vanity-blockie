'use client'

import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </section>
  )
}

/**
 * What this app is, one click from the card's one-line subtitle.
 *
 * A single sentence cannot carry the mechanism, the counterfactual address and the phishing
 * caveat, and a card that opened with all three would bury the form underneath its own
 * explanation. So the subtitle answers "what is this" and this answers everything after it.
 *
 * The caveat is here for a reason beyond completeness: the amber callout that normally carries it
 * appears only once mining starts, so before a run this is the only place on the screen that says
 * a matching identicon proves nothing.
 */
export function AboutDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* The trigger is the caller's, because the same explanation is reached from two places
          that want to look nothing alike: a text link at the end of the card's subtitle, and an
          icon in the footer, which is the only route to it once the card is gone. The default is
          the card's, so the common case reads as one component. */}
      <DialogTrigger asChild>
        {trigger ?? (
          // A link-styled button rather than an icon: it sits at the end of a sentence, and the
          // thing it opens is prose. `h-auto p-0` keeps it on the subtitle's own line rather than
          // giving it a control's padding in the middle of a paragraph.
          <Button variant="link" size="sm" className="h-auto p-0 align-baseline text-sm">
            Learn more
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>About this app</DialogTitle>
          <DialogDescription className="sr-only">
            How the search works, what it does and does not do, and why a matching identicon is not
            proof of an address.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Section title="How it works">
            A Safe&rsquo;s address is derived from its owners, threshold, Safe version and one free
            number, the salt nonce. Only that number is free to vary, so this app tries them in
            bulk: for each one it draws the identicon the resulting address would produce and
            scores it against a face.
          </Section>

          <Section title="Nothing is deployed while you search">
            A run finds a config, not a Safe. The address exists deterministically whether or not
            you ever deploy it, so you can stop, share a result, and come back to it.
          </Section>

          <Section title="It runs on your machine">
            Mining happens in your browser, across its worker threads. The only network traffic is
            reading Safe&rsquo;s contract constants, and the transaction itself if you choose to
            deploy.
          </Section>

          {/* Deliberately last, and the only thing in here that is not plain prose: everything
              above is an invitation, and this is the one part a reader must not skim past. It is
              the same warning box that appears above the results once mining starts — same
              variant, same icon, same lead — so the two read as one warning met twice rather than
              as two that happen to be worded alike. `role="note"` for the same reason it carries
              one there: static copy, and a live region inside a dialog that has just been
              announced would read the caveat out a second time on top of the dialog itself.

              The wording here is the longer one. This is the page someone opened to understand
              the thing, so it has room to say HOW the attack works rather than only that it
              exists. */}
          <Alert role="note" variant="warning">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              <p>
                <strong className="font-medium">A matching identicon is cosmetic.</strong> Never
                treat it as proof of an address. Blockie look-alikes are a known phishing vector:
                someone can mine a different address whose identicon looks the same to you. Always
                verify the full address.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </DialogContent>
    </Dialog>
  )
}
