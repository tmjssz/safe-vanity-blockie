'use client'

import { type Candidate, formatScore } from '@safe-vanity-blockie/core'
import { Check, CircleAlert, Link2, Loader2, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { useAccount, useConnect, useConnectorClient, useSwitchChain } from 'wagmi'
import { type MineConfig, SUPPORTED_CHAINS } from '../lib/config'
import { shareConfigPath } from '../lib/deep-link'
import { useCopy } from '../lib/use-copy'
import { Blockie } from './Blockie'
import { ChainIcon } from './ChainIcon'
import { CopyButton } from './CopyButton'
import { DeployOutcome } from './DeployOutcome'
import { type DeployPhase, DeployStatusPill } from './DeployStatusPill'
import { OwnerList } from './OwnerList'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
} from './ui/dialog'

/**
 * The layout renders an empty element with this id in the header, and this dialog portals its
 * stand-in into it for the window where it has been closed while its transaction is still going.
 * Declared here, next to the state it is derived from, so the layout can render the slot without
 * importing anything about deploying. Same arrangement as HEADER_CHAIN_SLOT_ID and the mining
 * status bar's own slot, and for the same reason: the state belongs to the component, the place
 * belongs to the chrome.
 */
export const DEPLOY_STATUS_SLOT_ID = 'header-deploy-slot'

/**
 * Whether the wallet turned the request down, rather than something failing.
 *
 * It matters because it is the commonest outcome of pressing deploy, and because the generic
 * branches below would otherwise describe it wrongly: `sendTransaction` throwing after the request
 * was dispatched normally means "this may already have been broadcast", which for a rejection is
 * both false and alarming. viem raises `UserRejectedRequestError` before anything reaches the
 * network; EIP-1193 wallets carry code 4001 for the same thing. Matched on all three, name first,
 * because a bundler can rename the class but not the string it carries.
 */
function isWalletRejection(thrown: unknown): boolean {
  if (typeof thrown !== 'object' || thrown === null) return false
  const { name, message, code } = thrown as { name?: string; message?: string; code?: unknown }
  if (name === 'UserRejectedRequestError' || code === 4001) return true
  return /user rejected|user denied|rejected the request/i.test(message ?? '')
}

/**
 * One deploy attempt, as a value the page can compare. Opaque on purpose: nothing may be read off
 * it, only whether it is the same attempt that started — see `onDeploySettled`.
 */
export type DeployAttempt = symbol

export interface DeployDialogProps {
  open: boolean
  candidate: Candidate
  config: MineConfig
  onOpenChange: (open: boolean) => void
  /**
   * Fired immediately before the first `await` of the deploy sequence, and in a `finally` once
   * it settles either way. The page uses them to pause mining for exactly as long as the
   * deploy is in flight: the wallet confirmation is the one moment a user must read an address
   * carefully, and it should happen against a still surface.
   *
   * Both carry the SAME attempt, and that is what makes the pair safe to abandon. This dialog can
   * be dismissed mid-send — "Close and keep waiting", browser Back — and the page hands mining
   * back at once, deliberately, while the wallet still holds the transaction; the sequence
   * underneath keeps running and still settles. Without an identity on it, that settle would end
   * whatever deploy happened to be in flight when it landed, which by then can be a DIFFERENT
   * result's: mining would resume and the chain selector unlock in the middle of the second
   * wallet confirmation, so the chain could be repointed under a transaction already built for
   * the one it named. A settle may only ever end the attempt that started.
   */
  onDeployStart: (attempt: DeployAttempt) => void
  onDeploySettled: (attempt: DeployAttempt) => void
  /**
   * How far this dialog's deploy has got, whenever that changes and once on mount.
   *
   * The page needs it to decide whether closing may unmount this component. It cannot use its own
   * pause flag for that: the pause is handed back the first time the dialog is closed mid-flight
   * (that is the whole point of "Close and keep waiting"), so a second close would read "nothing
   * outstanding" and throw away the running deploy's state — which is exactly the bug this exists
   * to make impossible. Reported on mount as well, so a page still holding the previous dialog's
   * phase is corrected by the next one rather than by remembering to clear it.
   */
  onPhaseChange?: (phase: DeployPhase) => void
}

export function DeployDialog({
  open,
  candidate,
  config,
  onOpenChange,
  onDeployStart,
  onDeploySettled,
  onPhaseChange,
}: DeployDialogProps) {
  const { isConnected, address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { connect, connectors, isPending: isConnecting } = useConnect()
  const { data: client } = useConnectorClient()
  const [status, setStatus] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  /**
   * The transaction, once there is one. This is what "after submission" means: everything before it
   * is preparation the user can still walk away from, and everything after it is a fact on a chain.
   * The dialog reads it to decide whether it is still asking for a deploy or reporting one.
   */
  const [txHash, setTxHash] = useState<string | undefined>()
  /**
   * Whether the failure was the user turning the request down in their wallet.
   *
   * Kept apart from `error` because it changes what the outcome screen is called, and only the
   * sequence can tell: by the time the message exists, "rejected" and "failed" are the same string
   * to everything downstream.
   */
  const [rejected, setRejected] = useState(false)

  const wrongChain = isConnected && chainId !== config.chainId
  const chainName = SUPPORTED_CHAINS.find((entry) => entry.id === config.chainId)?.name
  const submitted = txHash !== undefined || completed
  /**
   * How far this deploy has got, as one value. The status panel below and the header pill are two
   * views of it, so they cannot disagree about what is happening.
   *
   * `error` is read before `completed` and `txHash` on purpose: a revert or a mismatch is the
   * outcome, whatever else already happened.
   */
  const phase: DeployPhase = error
    ? 'failed'
    : completed
      ? 'done'
      : txHash
        ? 'pending'
        : busy
          ? 'sending'
          : 'idle'

  useEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  // And 'idle' on the way out. A dialog that is gone has no phase, and the page reads this to
  // decide whether the grid may take a new result: without it, a traversal that unmounts this
  // component mid-deploy would leave the page holding "sending" for a dialog that no longer
  // exists, refusing every result from then on. Its own effect, so it fires only on unmount
  // rather than between every phase change.
  useEffect(() => () => onPhaseChange?.('idle'), [onPhaseChange])

  // Resolved during the first render in the browser, with the effect as the fallback for a mount
  // order the first render cannot see — the same arrangement MiningView uses for the status bar.
  const [pillSlot, setPillSlot] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.getElementById(DEPLOY_STATUS_SLOT_ID),
  )
  useEffect(() => {
    setPillSlot(document.getElementById(DEPLOY_STATUS_SLOT_ID))
  }, [])
  /**
   * Whether the dialog is reporting rather than asking.
   *
   * Deliberately NOT "there is an error". A failure before anything was sent — the wallet said no,
   * the constants read did not answer — leaves nothing in progress and nothing spent, so the dialog
   * has to go back to asking: the config to check, the share link to leave with, and the button to
   * try again. Counting `error` here is what left a spinner and the word "Working…" on screen after
   * a rejected transaction, describing work that had already stopped.
   *
   * After submission it stays, error or not: there is a hash, and it is the only way to look up
   * what the gas was spent on.
   */
  // The confirm state's own progress line, for the window between pressing Deploy and the
  // transaction existing — reading constants, checking the address, waiting for the wallet. Once
  // there IS a transaction, or a failure, the dialog is a different screen and this is not on it.
  const showStatus = busy && !submitted && error === undefined

  /**
   * The share link, absolute because it is copied and pasted elsewhere; page.tsx pushes the same
   * path into the address bar relative, where the origin is already there.
   *
   * The saltNonce in the spread is the entire payload: without it the link degrades from
   * "reproduces this exact address" to "prefills four form fields", silently.
   */
  const shareUrl = `${typeof window === 'undefined' ? '' : window.location.origin}${shareConfigPath(
    { ...config, saltNonce: candidate.saltNonce },
  )}`
  const share = useCopy({
    value: shareUrl,
    copiedMessage: 'Share link copied',
    // The anchor below is a real link to this URL, so a browser without clipboard access (any
    // non-secure origin) still has a way to get it out. That is deliberate: the share link is the
    // only way to keep a mined saltNonce without deploying, so a failed copy must not be the end
    // of the road.
    failedMessage: 'Could not copy automatically. Use the link\'s own "copy link address" instead.',
  })

  /**
   * Back to the confirm state, with nothing of the failed attempt left on it.
   *
   * Everything it clears is state this component owns about ONE attempt; the candidate, the config
   * and the share link are untouched, so "Try again" is the same deploy offered again rather than a
   * new dialog.
   */
  const retry = () => {
    setError(undefined)
    setStatus(undefined)
    setTxHash(undefined)
    setCompleted(false)
    setRejected(false)
  }

  /**
   * Writes a terminal failure to both channels at once. The inline Alert is the one the user acts
   * on — it stays until they do — and the toast is its copy in a renderer mounted outside every
   * subtree that can unmount underneath a deploy in flight.
   */
  const reportError = (message: string) => {
    setError(message)
    toast.error(message)
  }

  /**
   * Whether the header carries this deploy.
   *
   * From the press until the outcome has been seen, which is two rules rather than one:
   *
   * - while it is running, always — open or closed. A deploy takes as long as a chain takes, and
   *   the user is meant to be able to scroll the grid or change a filter meanwhile without losing
   *   sight of it.
   * - once it has settled, only while this dialog is closed. In front of the user the dialog is
   *   already saying it, and a pill beside it would be the same news twice; closed, it is the only
   *   thing that can bring the outcome back on screen.
   */
  const settled = phase === 'done' || phase === 'failed'
  const pill =
    phase === 'idle' || (settled && open) ? null : (
      <DeployStatusPill
        phase={phase}
        address={candidate.address}
        onOpen={() => onOpenChange(true)}
      />
    )

  return (
    <>
      {/* In place if no slot is mounted, as MiningView does with the status bar: a header that has
          not rendered the slot is not a reason for the only way back to a running deploy to
          disappear. */}
      {pillSlot && pill ? createPortal(pill, pillSlot) : pill}
      {/* NON-MODAL, and that is a deliberate reversal. As a modal this dialog laid a `z-50` overlay
      over the whole viewport, trapped focus and `aria-hidden`-ed everything behind it — which
      includes the sticky header, and therefore the chain selector. The chain could not be changed
      without closing the result first. Raising the header above the overlay instead would have let
      a mouse through while leaving the control invisible to keyboard and screen reader users, which
      is worse than not offering it at all; non-modal is the honest version: Radix drops the overlay
      entirely (`DialogOverlay` renders nothing at all when `modal={false}`), stops trapping focus
      and hides nothing, so the page behind really is the page — and the backdrop below is this
      component's own, drawn precisely so it can stop where the header starts. What follows from it
      is handled in page.tsx: the header's chain carries the open selection with it, and a card
      behind this dialog is out of a pointer's reach but still in the accessibility tree. */}
      <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
        {/* The backdrop, and the reason it is not `inset-0`. It darkens and blurs everything BELOW
          the sticky header — `top-14` is that header's own `h-14` in app/layout.tsx, the same
          relationship MiningStatusBar's `top-14` already depends on — and nothing above it, so the
          one control this dialog went non-modal for stays lit, unblurred and usable while the rest
          of the page is visibly and actually out of play. `bg-background/60 backdrop-blur-sm` is
          the share-link resolving overlay's language in page.tsx, deliberately: same app, same
          meaning. That overlay keeps `inset-0` and keeps covering the header, which is a different
          statement — nothing on the page is usable while a link resolves.

          `z-45`: above the page content and the mining status bar (`z-40`) so it really blocks
          them, below this dialog's content and the header (both `z-50`) so it covers neither, and
          below the chain selector's popover (`z-50` in ui/select.tsx) so the header's control
          opens over it rather than under it. Tailwind v4 generates this from the bare integer;
          the built stylesheet was checked rather than assumed, because a dropped class here fails
          silently and invisibly to every test in jsdom.

          Its click closes — the one dismissal-by-pointer this dialog has, and what earns it is
          that there is nothing on this sheet to reach for, so a click on it cannot be a reach for
          anything else. Not while busy, for exactly the reasons Escape and the X are refused for
          that window: a send in flight has nowhere else to report itself inline.

          `aria-hidden`, and a div rather than a button: it is the pointer's shorthand for
          "close", and it takes nothing away from a keyboard or screen reader user, who still has
          Escape, the X and the footer button. Inside DialogPortal so it mounts and unmounts with
          the dialog and lands in the same portal layer, before the content and therefore under
          it. */}
        <DialogPortal>
          <div
            data-slot="deploy-dialog-backdrop"
            aria-hidden="true"
            className="fixed inset-x-0 top-14 bottom-0 z-45 bg-background/60 backdrop-blur-sm"
            onClick={() => {
              if (!busy) onOpenChange(false)
            }}
          />
        </DialogPortal>
        {/* While the sequence is in flight this dialog is the ONLY place its outcome can be read
          inline, and closing it unmounts the dialog outright — page.tsx renders it only while a
          candidate is selected, keyed on that candidate's address, and clears the selection when
          it closes. So the *accidental* dismissals are blocked: Escape and the X while busy,
          Radix's own "interaction outside" always, and the backdrop's click while busy.

          Radix's `onInteractOutside` still never dismisses, and that is not the same rule as "a
          click outside never dismisses" any more. It fires for the header, for a focus move off
          the last control and for the backdrop alike, and telling them apart there would mean
          depending on which chain-selector internals happen to sit in this layer's stack — so
          reaching for the header (the entire point of this dialog being non-modal) or tabbing out
          cannot throw away the result that reach was for. The sheet of dark glass whose only
          possible purpose is "dismiss this" carries that meaning on its own click handler
          instead, above, where it is unambiguous and where the header is exempt by construction
          rather than by a special case. Activating another result card still replaces what is on
          screen — the backdrop takes the pointer route to the grid away (a mouse click there lands
          on the backdrop and closes this), and Tab never went that way in the first place: Radix's
          FocusScope keeps `loop` on for a non-modal dialog too, so Tab cycles inside this content
          rather than walking out of it (measured in a browser, 120 presses). What is left is the
          accessibility tree — nothing behind is `aria-hidden`, `inert` or pointer-events-none, so
          an assistive technology's virtual cursor can still focus a card and activate it. That
          goes through page.tsx's `selectFromGrid` and its `key`, not through a dismissal.

          The deliberate, warned footer button below stays live on purpose: a wallet that never
          settles its promise (the popup closed without a response) would otherwise trap the user
          in this dialog forever, and an unclosable dialog is a worse failure than a knowingly
          abandoned one. Browser Back is the other way out, and page.tsx reconciles it. The toast
          mirror below is what carries the outcome once the inline copy has gone with the dialog.

          The height cap leaves room for the header rather than the 1rem the shadcn default takes:
          centred, `100dvh-7rem` cannot reach under the layout's `h-14` sticky bar at any viewport
          height, so the control this dialog exists to leave usable is never covered by it. Below
          that the content scrolls inside the dialog, as it already did. */}
        <DialogContent
          className={`max-h-[calc(100dvh-7rem)] overflow-y-auto ${
            // 560 is the width the confirm state needs: a 42-character address beside a 96px
            // identicon, and owner rows under it. The outcome screens are three centred lines and a
            // button, so they take the narrower one the brief asks for — and since they are the same
            // component across pending, success and failure, the box does not resize on
            // confirmation either.
            phase === 'idle' || phase === 'sending' ? 'sm:max-w-[560px]' : 'sm:max-w-[480px]'
          }`}
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            // Still never, including on success, and that is not a contradiction of "clicking away
            // may dismiss a finished deploy". Clicking away already does: the backdrop below is
            // this component's own sheet of dark glass and its click closes whenever nothing is in
            // flight, which on the success screen is always. What this handler additionally covers
            // is the header and focus moves, which are not "outside" in any sense a user means —
            // and dismissing on them breaks the flow the success screen's own existence invites,
            // since switching chains to deploy the same address elsewhere starts by reaching for
            // the chain picker. Measured by test/page.test.tsx's carried-dialog test, which reaches
            // for exactly that.
            event.preventDefault()
          }}
        >
          {/* The one live region, and the reason it is here rather than on whichever screen
              happens to be showing: a region only announces changes to a container that was ALREADY
              there when the text arrived, and these screens replace each other outright. Mounted
              for the dialog's whole life, and sr-only because every word of it is on screen
              already — this is the channel, not the copy. */}
          <div aria-live="polite" className="sr-only">
            {phase === 'sending' && status}
            {phase === 'pending' && 'Transaction sent. Waiting for confirmation.'}
            {phase === 'done' && 'Safe deployed.'}
            {phase === 'failed' && error}
          </div>
          {/* Two screens, one dialog. Once the Safe exists, everything below was there to be
              checked or decided — the warning, the address being verified, the config, the offer
              to deploy later, a button that spends gas — and all of it is settled. A tick added to
              a form is not the same thing as a screen that says what happened, so this swaps
              rather than annotates. */}
          {phase === 'pending' || phase === 'done' || phase === 'failed' ? (
            <DeployOutcome
              variant={phase === 'done' ? 'success' : phase === 'failed' ? 'failed' : 'pending'}
              address={candidate.address}
              txHash={txHash}
              chainId={config.chainId}
              reason={error}
              rejected={rejected}
              onRetry={retry}
            />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Deploy this Safe</DialogTitle>
                <DialogDescription>
                  Your wallet will ask you to confirm a transaction that spends gas
                  {chainName ? ` on ${chainName}` : ''}.
                </DialogDescription>
              </DialogHeader>

              {/* The caveat is repeated here on purpose: this is the screen where money is actually
            spent, and it is the last place it can still do any good. role="note" rather than the
            Alert default, though — it is static copy that is always here, so as a live region it
            would compete permanently with the real status/error below.

            Gone once the transaction is away: "check the address before you confirm" is advice
            about a decision that has already been taken by then, and the status it would be
            sitting above is the thing to read instead. */}
              {!submitted && (
                <Alert role="note" variant="warning">
                  <ShieldAlert className="h-4 w-4" />
                  {/* The same box the About dialog and the results callout draw, in the same amber and
                with the lead running into the body rather than stacked above it. Met three times in
                one session it has to read as one warning, not three that begin alike. The wording
                stays this screen's own: "the address below", "before you confirm" — the others are
                read while browsing, this one while about to spend. */}
                  <AlertDescription>
                    <p>
                      <strong className="font-medium">A matching identicon is cosmetic.</strong>{' '}
                      Check every character of the address below before you confirm. A look-alike
                      blockie is a known phishing vector.
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {/* One card rather than the two stacked ones this replaces. They held the identity and the
            config that produces it, which is one subject, and the seam between them read as two
            unrelated blocks of small print.

            `bg-card`, the same fill the Pattern filter card has: this is the one raised surface in
            the dialog, and against the dialog's own background a bordered box with no fill reads as
            a hairline rather than as the thing to look at. */}
              <div className="rounded-lg border bg-card">
                <div className="flex items-center gap-3 p-4">
                  {/* The identicon is what a look-alike attack imitates, so this is the one picture in
                the app worth drawing large: it is compared against the tile that was clicked, and
                against whatever the wallet shows next. */}
                  <Blockie
                    address={candidate.address}
                    size={96}
                    className="size-24 shrink-0 overflow-hidden rounded-md [&>svg]:size-full"
                  />
                  {/* `flex-1`: the column takes the rest of the row rather than sizing to its longest
                child, which is what lets the address below run the full width of the card. */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex items-center gap-1">
                      {/* One line, unbroken and ungrouped: chunking an address makes it easier to skim
                    and harder to compare, and comparing is the only thing this screen is for. Full
                    strength, because it is the thing being read — everything else in this card is
                    context for it. The copy beside it is the same control as every other copy on
                    the screen; being the important one is the address's job, not the button's. */}
                      {/* Sized to fill the line, measured in a browser rather than guessed: 42
                    characters come to 340px against 340px of room at 13.5px, a fit with nothing to
                    spare. 13px keeps ~12px of slack for a monospace fallback wider than the 0.6em
                    advance this stack mostly shares — `truncate` is a backstop, and an address with
                    its tail quietly clipped is exactly the failure this screen exists to
                    prevent. */}
                      <code className="min-w-0 truncate font-mono text-[13px] text-foreground">
                        {candidate.address}
                      </code>
                      <CopyButton
                        value={candidate.address}
                        label="Copy Safe address"
                        copiedMessage="Safe address copied"
                        failedMessage="Could not copy automatically. Select the address and copy it manually."
                      />
                    </span>
                    {/* The caption, and everything the tile could not say. No expression, contrast or
                  colour-count chips: three badges of mining trivia sat directly under the address
                  they were competing with, on the screen where nothing may compete with it. */}
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="font-mono">
                        {formatScore(candidate.score, candidate.maxScore)}
                      </Badge>
                      {/* The label stays quiet and the value does not: the saltNonce is the other thing
                    here worth copying, since it is what reproduces this address. */}
                      <span className="truncate">
                        expression match · saltNonce{' '}
                        <span className="text-foreground">{candidate.saltNonce}</span>
                      </span>
                      <CopyButton
                        value={candidate.saltNonce}
                        label="Copy saltNonce"
                        copiedMessage="saltNonce copied"
                        failedMessage="Could not copy automatically. Select the saltNonce and copy it manually."
                      />
                    </span>
                  </div>
                </div>

                <div className="border-t p-4">
                  {/* Visible progress for the window before a transaction exists. NOT a live
                      region: the one that announces is mounted above for the dialog's whole life,
                      because this panel is replaced outright the moment there is something to
                      report, and a region that arrives with its first message announces nothing. */}
                  <div>
                    {showStatus && (
                      <div className="flex flex-col gap-2 text-sm">
                        <span className="flex items-center gap-2">
                          {error ? (
                            <CircleAlert
                              className="size-4 shrink-0 text-destructive"
                              aria-hidden="true"
                            />
                          ) : completed ? (
                            <Check
                              className="size-4 shrink-0 text-emerald-500"
                              aria-hidden="true"
                            />
                          ) : (
                            <Loader2
                              className="size-4 shrink-0 animate-spin text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          {/* The error branches clear `status`, so this headline names the state and the
                        alert below carries the detail. No "Working…" fallback: the handler sets a
                        status in the same batch as `busy`, so an empty one here only ever meant
                        something had gone wrong. */}
                          <span className="min-w-0">
                            {error ? 'The deployment stopped.' : (status ?? 'Working on it…')}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* What the address is derived from, and what a reader can still change their mind
                about. Replaced by the status above once a deploy is under way, because by then
                none of it can change and all of it is between the reader and the outcome.

                Whose Safe this is, read from `config` — this component's own prop, which page.tsx
                pairs with the candidate the address came from — and never from anything the page
                holds separately, because the two can legitimately differ: a share-link recipient
                can submit their own config while the link is still reconstructing, and then the
                Configure card behind this dialog summarises THEIR owners while this deploys the
                SENDER's. Nothing there drifts and nothing lies, but until this block existed the
                dialog never named the owners at all, so that state was merely self-consistent
                rather than self-evident. */}
                  {!showStatus && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                      {/* Singular when there is one: "Owners" over a single row is the kind of small
                    wrongness that makes a reader wonder what else is generated rather than read. */}
                      <dt className="text-muted-foreground">
                        {config.owners.length === 1 ? 'Owner' : 'Owners'}
                      </dt>
                      <dd className="min-w-0">
                        <OwnerList owners={config.owners} />
                      </dd>
                      <dt className="text-muted-foreground">Threshold</dt>
                      <dd>
                        {config.threshold} of {config.owners.length}{' '}
                        {config.owners.length === 1 ? 'signer' : 'signers'}
                      </dd>
                      <dt className="text-muted-foreground">Safe version</dt>
                      <dd className="font-mono">{config.safeVersion}</dd>
                      {/* No chain row. These three are what the ADDRESS is derived from and what a user
                    cannot change without invalidating it; the chain is not one of them — the same
                    address is this Safe's address on all six non-mainnet chains (measured; see
                    lib/config.ts), and it is a live control in the header that can move while this
                    dialog is open. Listing it here as though it were a property of the config would
                    have made it the one line in this block that changes under the reader. Where the
                    gas goes is still named, once, in the description above — which is the sentence
                    about spending money, and which follows the header. */}
                    </dl>
                  )}
                </div>
              </div>

              {/* One row, where a labelled input, a button and two paragraphs used to be. All of it said
            one thing — you can leave with the link instead — and said it at the size of the deploy
            step itself.

            A real <a> to the share URL, not a button: clicking copies (that is what the row
            offers), but the href is what remains when the clipboard is unavailable, which is every
            non-secure origin. The share link is the only way to keep a mined saltNonce without
            deploying, so "copy link address" has to still be there as a fallback. A modified click
            is left alone, so cmd-click still opens the link. */}
              {!showStatus && (
                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Deploy later instead? The address exists whether or not you deploy now.
                  </p>
                  <a
                    href={shareUrl}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey) return
                      event.preventDefault()
                      share.copy()
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {share.copied ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Link2 className="size-4" aria-hidden="true" />
                    )}
                    Copy share link
                  </a>
                </div>
              )}

              <DialogFooter>
                <DialogClose asChild>
                  {/* Never reads as "cancel the deployment" while one is running: nothing here can
                recall a transaction the wallet has been handed. */}
                  {/* Three states, keyed on the same fact the rest of this dialog is: while the
                sequence is running, leaving does not stop it, and the label is the warning. Once
                there is a transaction it is a report, so there is nothing left to wait for —
                "keep waiting" over a deploy that had already reverted read as though something
                were still pending. And a failure before anything was sent puts the dialog back to
                asking, where the way out is a plain Cancel. */}
                  <Button type="button" variant="ghost">
                    {busy ? 'Close and keep waiting' : submitted ? 'Close' : 'Cancel'}
                  </Button>
                </DialogClose>
                {/* Exactly one action occupies this slot in any state, so there is never a choice to
              make about which button is the way forward — but only one of the three is the deploy
              itself, and only that one is filled.

              Connecting and switching are prerequisites: they set up the wallet so the deploy
              becomes possible, and pressing either spends nothing. `outline` says so. Reserving
              the filled treatment for the press that actually spends gas means the card's one
              high-emphasis control always denotes the same thing, so arriving on the wrong chain
              cannot present a filled button one press away from a transaction.

              Connecting is not in the brief's state machine but is reachable from a share link
              opened in a fresh browser, and it lands where the deploy button will be rather than
              in a line of prose further up: it is the next action here, so it belongs among the
              actions. `connectors[0]` is safe to reach for — lib/wagmi always configures
              injected(), and EIP-6963 discovery only ever appends to that list. It does mean a
              browser announcing several wallets connects the first rather than offering a choice;
              the header's ConnectButton is the one that lists them all. */}
                {!isConnected && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isConnecting || connectors.length === 0}
                    onClick={() => {
                      const connector = connectors[0]
                      if (connector) connect({ connector })
                    }}
                  >
                    Connect a wallet
                  </Button>
                )}
                {/* Named, not "Switch network to continue": the chain is the one thing about this deploy
              the user may not have noticed changing, and a button that says which chain it is
              switching to is the last chance to catch it. */}
                {wrongChain && !submitted && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => switchChain({ chainId: config.chainId })}
                  >
                    {/* The chain's own mark rather than a swap arrow: the button already says
                  "Switch to", so an arrow only restates the verb, while the mark says which chain
                  — the part a user may not have noticed changing, on the last screen before gas
                  is spent. Falls back to no icon at all for an unmarked chain, which is the same
                  degradation the label beside it makes. */}
                    <ChainIcon chainId={config.chainId} />
                    Switch to {chainName ?? `chain ${config.chainId}`}
                  </Button>
                )}
                {/* Gone once the transaction is away: there is nothing left to press, and the status
              inside the card is what the dialog is for by then. */}
                {isConnected && !wrongChain && !submitted && (
                  <Button
                    type="button"
                    // `!client` is the state the removed "Waiting for the wallet client…" line reported.
                    // It reads as a disabled button rather than a line of prose because that is what it
                    // is: the deploy handler returns immediately without one, so an enabled button here
                    // would be a control that silently does nothing.
                    disabled={busy || !client}
                    aria-busy={busy}
                    onClick={async () => {
                      if (!client || !address) return
                      setError(undefined)
                      setBusy(true)
                      // This press, and only this press. Fresh per attempt rather than per dialog: a
                      // failed deploy leaves this dialog mounted and its button live, so one instance
                      // can hold more than one attempt over its life.
                      const attempt: DeployAttempt = Symbol('deploy attempt')
                      // Hoisted so the catch block can still report them if something fails after the
                      // point they were set — a lost hash (or a lost "we don't know") after gas may
                      // already be spent is worse than an error.
                      let hash: `0x${string}` | undefined
                      let sendDispatched = false
                      try {
                        setStatus('Reading Safe constants…')
                        // Mining stops here rather than when the candidate was selected: everything
                        // below reads an address the user is about to spend gas on.
                        onDeployStart(attempt)
                        const { loadSafeConstants } = await import(
                          '@safe-vanity-blockie/safe-config'
                        )
                        const { chainById } = await import('../lib/wagmi')
                        // Re-read rather than reuse anything already computed for mining: that is what
                        // keeps this an independent constants source for the deriver cross-check below,
                        // not a re-check of our own cached values.
                        const setup = await loadSafeConstants({
                          rpcUrl: chainById(config.chainId).rpcUrls.default.http[0],
                          owners: config.owners,
                          threshold: config.threshold,
                          safeVersion: config.safeVersion,
                        })

                        setStatus('Checking the address before spending anything…')
                        const { buildDeploymentPlan } = await import('../lib/deploy')
                        const plan = await buildDeploymentPlan({
                          setup,
                          saltNonce: candidate.saltNonce,
                          provider: client.transport as never,
                          signer: address,
                          chainId: config.chainId,
                        })

                        // Ties the plan built for the send path to the candidate the user actually picked
                        // and is looking at on screen. Cannot diverge today (both derive from the same
                        // saltNonce and config), but a saltNonce arriving from elsewhere (e.g. a share
                        // link) would make this reachable, so it is checked before anything is spent.
                        if (plan.address.toLowerCase() !== candidate.address.toLowerCase()) {
                          throw new Error(
                            `Deployment plan address ${plan.address} does not match the selected ` +
                              `candidate ${candidate.address}. Refusing to deploy.`,
                          )
                        }

                        // No address in this line. The card at the top of this dialog is already
                        // showing that exact string, in full and copyable, so repeating it here said
                        // nothing twice — and inside a sentence ending in an ellipsis the 42
                        // characters read as a value cut short.
                        setStatus('Sending: confirm in your wallet…')
                        // useConnectorClient() returns a plain viem Client, not one extended with wallet
                        // actions, so sendTransaction is called as a standalone action against it.
                        const { sendTransaction } = await import('viem/actions')
                        sendDispatched = true
                        hash = await sendTransaction(client, {
                          to: plan.transaction.to as `0x${string}`,
                          value: BigInt(plan.transaction.value),
                          data: plan.transaction.data as `0x${string}`,
                        })
                        setTxHash(hash)
                        // The hash gets a row of its own in the status panel below, with a copy and
                        // a link to the explorer on the pending screen, so the sentence
                        // below no longer carries it.
                        setStatus('Sent. Waiting for confirmation on the chain…')

                        const { createPublicClient, http } = await import('viem')
                        const publicClient = createPublicClient({
                          chain: chainById(config.chainId),
                          transport: http(),
                        })
                        const receipt = await publicClient.waitForTransactionReceipt({ hash })
                        if (receipt.status !== 'success') {
                          setStatus(undefined)
                          // Mirrored into a toast on every terminal branch below, and never *instead*
                          // of the inline message: <Toaster/> is mounted in app/layout.tsx, outside
                          // every subtree that can unmount here, so it is the only channel that
                          // survives "Start over" or closing this dialog while the send is still in
                          // flight — which now unmounts it, and with it every inline message. The
                          // inline copy stays because a toast is on a timer and this is something the
                          // user has to act on.
                          reportError(`Deployment reverted. Gas was spent. Transaction ${hash}.`)
                          return
                        }

                        // The transaction succeeded, but success only means the calldata protocol-kit
                        // built for `plan.address` executed without reverting — it does not by itself
                        // prove a Safe now exists at that address. Read the address the deployment
                        // actually produced back out of the receipt's logs and cross-check it before
                        // telling the user it worked.
                        const { getSafeAddressFromDeploymentTx } = await import(
                          '@safe-global/protocol-kit'
                        )
                        const deployed = getSafeAddressFromDeploymentTx(receipt, config.safeVersion)
                        if (deployed.toLowerCase() !== plan.address.toLowerCase()) {
                          setStatus(undefined)
                          reportError(
                            `Deployed address ${deployed} does not match the predicted ${plan.address}. ` +
                              `Transaction ${hash}.`,
                          )
                          return
                        }

                        setCompleted(true)
                        // Short inline, explicit in the toast: the panel already shows the address and
                        // the transaction as their own rows, while the toast is the copy that outlives
                        // this dialog and has to stand on its own.
                        setStatus('Safe deployed.')
                        toast.success(`Safe deployed at ${deployed}. Transaction ${hash}.`)
                      } catch (thrown) {
                        setStatus(undefined)
                        const message = thrown instanceof Error ? thrown.message : String(thrown)
                        if (isWalletRejection(thrown)) {
                          setRejected(true)
                          // Checked before the `sendDispatched` branch below, which would otherwise tell
                          // a user who had just pressed "reject" that their transaction might be out
                          // there: viem throws this one before anything reaches the network.
                          reportError('You rejected the request in your wallet. Nothing was sent.')
                        } else if (hash) {
                          reportError(
                            `${message} Transaction ${hash} was already sent. Check its status before retrying.`,
                          )
                        } else if (sendDispatched) {
                          reportError(
                            `${message} The transaction may already have been broadcast. Check your ` +
                              "wallet's activity list before retrying.",
                          )
                        } else {
                          reportError(message)
                        }
                      } finally {
                        setBusy(false)
                        onDeploySettled(attempt)
                      }
                    }}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden="true" />
                        Waiting for wallet…
                      </>
                    ) : client ? (
                      'Deploy Safe'
                    ) : (
                      'Connecting to your wallet…'
                    )}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
