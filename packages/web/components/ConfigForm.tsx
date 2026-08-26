'use client'

import { ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import {
  type ConfigErrors,
  type FaceFilters,
  isOwnerAddress,
  type MineConfig,
  ownerAddressError,
  parseStartNonce,
  type RunOptions,
  SUPPORTED_SAFE_VERSIONS,
  validateMineConfig,
} from '../lib/config'
import { useWorkerCount } from '../lib/worker-count'
import { DecorativeBlockie } from './Blockie'
import { Explains } from './Explains'
import { ExpressionPicker } from './ExpressionPicker'
import { FaceSection } from './FaceSection'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export interface ConfigFormProps {
  initial?: Partial<{
    owners: string[]
    threshold: number
    safeVersion: string
    /**
     * The starting saltNonce to seed the field with. Absent, or 0, leaves it empty and the
     * disclosure closed — a seeded zero is indistinguishable from a field nobody opened.
     */
    start: number
  }>
  /**
   * The chain chosen in the page header. It is still one of the four inputs the address is derived
   * from and still travels in the submitted config and the share link — it is simply no longer
   * edited here, because unlike owners, threshold and version it can be changed after a run has
   * started without invalidating anything (see `chainSwitchDiscardsResults`).
   */
  chainId: number
  /**
   * `run` travels beside the config rather than inside it: MineConfig is what `?config=` encodes,
   * and where a search began is not part of the address it found. See RunOptions.
   */
  onSubmit: (config: MineConfig, run: RunOptions) => void
  /**
   * The search itself — which expressions are accepted, and the colour and match floors — rendered
   * as the Filter card inside the Advanced disclosure below.
   *
   * It lives here because the expressions and the floors decide what the miner credits and what the
   * results grid shows, and until now they were unreachable until a run existed: a resume link's
   * recipient pressed Start on a search they could not see. Under Advanced they are answerable
   * before the first nonce is tried, by anyone, link or no link.
   *
   * All four together or none: without a value AND a handler the card would be a control that
   * cannot be used, so `undefined` means "do not offer it" rather than "offer a dead one". Held
   * by the page, not by this form, because a run keeps them after this card is unmounted.
   */
  mouths?: string[]
  filters?: FaceFilters
  onMouthsChange?: (mouthNames: string[]) => void
  onFiltersChange?: (filters: FaceFilters) => void
  /**
   * Whether the link this form was seeded from named any part of the search.
   *
   * It decides one thing: whether the Filter card above arrives open. A link that named filters has
   * something to show; a link that named only a checkpoint has nothing to show in there, and an
   * ordinary visit has neither — both leave it shut, one row of header and no more.
   *
   * It says nothing about the Advanced disclosure, which now holds only the checkpoint and opens on
   * `initial.start` alone. It used to open for carried filters too, back when they lived inside it.
   *
   * Named for its provenance rather than folded into `initial`, because it is not a value to
   * prefill — it is a fact about where the prefill came from.
   */
  linkCarriedFilters?: boolean
}

/**
 * One owner field. The `id` is the ROW'S IDENTITY and exists only to key the list: keyed by array
 * index instead, React reuses the wrong DOM node when a row is removed and the values appear to
 * jump between rows — which on this form means mining a Safe the user never typed, silently,
 * because every address looks equally arbitrary. It survives removal of any other row, so the row
 * a value belongs to is never in question.
 *
 * `touched` rides along with the row for the same reason the value does: a complaint attached to
 * the wrong row is the same class of bug as a value attached to the wrong row.
 */
type OwnerRow = { id: string; value: string; touched: boolean }

/** Ids are per-form and monotonic, so no row ever inherits a removed row's identity. */
function makeRows(values: string[], nextId: { current: number }): OwnerRow[] {
  return values.map((value) => ({ id: `row-${nextId.current++}`, value, touched: false }))
}

export function ConfigForm({
  initial,
  chainId,
  onSubmit,
  mouths,
  filters,
  onMouthsChange,
  onFiltersChange,
  linkCarriedFilters,
}: ConfigFormProps) {
  const nextRowId = useRef(0)
  // Seeded once, from the link's decoded owners — one field per entry, in order. There is always
  // at least one row: `validateMineConfig` requires at least one owner, and a form with no field
  // at all would have nowhere to type it.
  const [owners, setOwners] = useState<OwnerRow[]>(() =>
    makeRows(initial?.owners?.length ? initial.owners : [''], nextRowId),
  )
  // The threshold the user ASKED for. What is displayed and what is submitted are both the clamped
  // reading of it below — never this raw number — so the two cannot disagree. Keeping the ask
  // rather than overwriting it is deliberate: removing an owner to retype it (the ordinary way to
  // fix a typo) would otherwise silently leave a 3-of-3 Safe as 3-of-2 → clamped to 2, and the
  // threshold is part of the address, so that is a different Safe with nothing on screen to say so.
  const [threshold, setThreshold] = useState(initial?.threshold ?? 1)
  const [safeVersion, setSafeVersion] = useState(initial?.safeVersion ?? '1.4.1')
  const [errors, setErrors] = useState<ConfigErrors>({})

  // The field's RAW TEXT, not a parsed number. The complaint has to be able to quote what was
  // typed, and a field that reinterpreted "4.12e10" into 41200000000 as you left it would be
  // choosing a nonce the user never wrote.
  const [startNonceInput, setStartNonceInput] = useState(
    initial?.start ? String(initial.start) : '',
  )
  // Whether the reader has said what they want the Advanced disclosure to be. Once they have, no
  // rule here may say otherwise: the seed below opens it for a non-default start nonce, and a link
  // can land a render after this form mounts, so without this a deliberate collapse in between
  // would be reopened underneath them. Same reasoning as FaceSection's `userChose`, and a ref
  // rather than state because nothing renders differently for it.
  const advancedChosen = useRef(false)

  // Same schedule as an owner row — complain after the field has been left once, then live —
  // EXCEPT for a value that was seeded rather than typed, which starts complained-about.
  //
  // A seed is not a first draft somebody is halfway through: it is a finished value handed over by
  // a link or by "Start over", and if this machine cannot take it the submit gate has already
  // refused it (that gate reads `startNonce.error`, not this touched-gated complaint). Left
  // untouched, the result was a disabled Start button whose caption points at "the starting
  // saltNonce under Advanced" and no error at the field it names. `maxStartNonce` falls as cores
  // rise, so this is not hypothetical: a checkpoint a 4-core machine reached can be over a
  // 16-core recipient's ceiling.
  const [startNonceTouched, setStartNonceTouched] = useState(Boolean(initial?.start))
  // Open when there is a seeded value to show. A seeded 0 is the default, so it opens nothing.
  //
  // Carried filters do NOT open it, and used to: they were inside this disclosure, so hiding them
  // would have defeated the point of sending them. They sit above it now, behind a header of their
  // own, so the only thing left in here is the checkpoint — and opening it for a link that named no
  // checkpoint would present an empty field as though it had something to say.
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initial?.start))

  // `initial` does not necessarily exist when this form first renders, and the initialisers above
  // only ever see that first render. page.tsx latches the `?config=` link on FIRST SIGHT rather
  // than capturing it on the first render — its subtree reaches that render through a Suspense
  // bailout, with a useSearchParams() that can still be empty — so a share link can arrive one
  // render after this mounted. The header's chain follows it whenever it lands (it is derived, not
  // seeded); these are the other three inputs the Safe address is derived from, so a form that
  // kept its blanks under a header that had moved would send the recipient to a different Safe
  // with nothing on screen to say so — and with a wallet connected the owners field is not even
  // blank, it holds the recipient's OWN address.
  //
  // Seeded ONCE. `seeded` starts true when the initialisers above already had something, and
  // page.tsx builds a fresh `initial` object on every render, so anything keyed on that object's
  // identity would re-apply the link forever and undo every edit made after it landed.
  //
  // And only into a form the user has not answered yet. The wallet prefill below is not an answer
  // — it is this form guessing, and the link outranks it exactly as it does in the initialisers —
  // but anything the user did is one, and this must never write over it: owners, threshold and
  // version are what the address is derived from, so overwriting an answer already on screen
  // changes which Safe is mined, silently. That is the same rule the prefill keeps.
  const seeded = useRef(initial !== undefined)
  const edited = useRef(false)
  useEffect(() => {
    if (!initial || seeded.current || edited.current) return
    seeded.current = true
    setOwners(makeRows(initial.owners?.length ? initial.owners : [''], nextRowId))
    if (initial.threshold !== undefined) setThreshold(initial.threshold)
    if (initial.safeVersion !== undefined) setSafeVersion(initial.safeVersion)
    if (initial.start) {
      setStartNonceInput(String(initial.start))
      // Shown, not just filled: a value the user cannot see is one they cannot correct, and this
      // one silently moves where the search begins. Unless the reader has already said otherwise —
      // see `advancedChosen`.
      if (!advancedChosen.current) setAdvancedOpen(true)
      // And complained about if this machine cannot take it — see the initialiser above. A link
      // reaches this form one render late (page.tsx latches `?config=` on first sight, and this
      // subtree's first render comes through a Suspense bailout), so the effect has to say it too.
      setStartNonceTouched(true)
    }
  }, [initial])

  // Owner 1, filled in from the connected wallet — the address the user is nearly always mining
  // for, and the one they would otherwise paste from the header they just clicked.
  //
  // It can only ever fill a BLANK. Owners are part of the Safe address, so writing over an answer
  // already on screen would change which Safe is mined with nothing to say so; the guard lives
  // inside the updater rather than in this effect body precisely so it judges the rows React
  // holds, not whatever this closure captured — a value typed between render and effect still
  // wins. Returning `rows` untouched is a real no-op: React bails out on an identical reference.
  //
  // Keyed on the address alone, which settles three cases at once and is why none of them needs
  // bookkeeping of its own:
  //
  //   - Connected before this mounted (wagmi's silent reconnect on load) — the address is simply
  //     already here on the first pass, and a returning user meets a filled form.
  //   - The wallet switches account. This re-runs, finds row 0 occupied, and declines. The first
  //     address stands, as it does against anything else already typed.
  //   - The user clears the field. The address has NOT changed, so this does not re-run and the
  //     field stays empty. Watching the field instead would make owner 1 impossible to empty for
  //     as long as a wallet is connected. Disconnecting and reconnecting is a different address
  //     value (undefined and back), so that does fill it again — a new connection, a new blank.
  const { address } = useAccount()
  useEffect(() => {
    if (!address) return
    setOwners((rows) => {
      const first = rows[0]
      if (!first || first.value.trim().length > 0) return rows
      return [{ ...first, value: address }, ...rows.slice(1)]
    })
  }, [address])

  const fieldPrefix = useId()
  const ownerFieldId = (index: number) => `${fieldPrefix}-owner-${index + 1}`
  const ownerErrorId = (index: number) => `${fieldPrefix}-owner-${index + 1}-error`
  const thresholdId = `${fieldPrefix}-threshold`
  const safeVersionId = `${fieldPrefix}-safe-version`
  const startHintId = `${fieldPrefix}-start-hint`
  const startNonceFieldId = `${fieldPrefix}-start-nonce`
  const startNonceHelpId = `${fieldPrefix}-start-nonce-help`
  const startNonceErrorId = `${fieldPrefix}-start-nonce-error`

  // Focus after a row is added or removed, applied once the list has re-rendered. Removing a row
  // destroys the button that had focus, and without this focus falls to <body> — a keyboard user
  // dropped to the top of the document in the middle of the form.
  const inputs = useRef(new Map<string, HTMLInputElement | null>())
  const focusRow = useRef<string | null>(null)
  useEffect(() => {
    const id = focusRow.current
    if (!id) return
    focusRow.current = null
    inputs.current.get(id)?.focus()
  })

  // What counts toward N: rows with something typed in them. A row that has been added but not
  // filled is not a signer, and this is exactly how `validateMineConfig` counts (it trims and drops
  // empties before comparing threshold against owners.length) — so the N on screen is the same N
  // the validator will judge, without this component restating any of its rules.
  const signerCount = owners.filter((owner) => owner.value.trim().length > 0).length
  // The clamp, derived rather than stored. One value feeds the Select, the caption and the submit,
  // so the visible threshold and the submitted threshold agree at every moment — the alternative,
  // correcting state from an effect, leaves a render where they do not. Without it a threshold left
  // above N reaches `validateMineConfig`, which rejects it, and "Start" appears to do nothing.
  const effectiveThreshold = Math.min(threshold, Math.max(signerCount, 1))

  // What blocks "Start", read fresh off the rows that are actually there — never remembered. A
  // remembered "this form has had a bad address in it" would survive the offending row being
  // DELETED rather than corrected, leaving a dead button with nothing on screen to fix.
  //
  // The two questions are the two this form can answer row by row, and both are asked of
  // `isOwnerAddress` — validateMineConfig's own predicate — so the gate and the validator cannot
  // disagree about what an address is. Everything else the validator judges (duplicates, an
  // unsupported chain) is still judged by it, on submit, and still reported below: the button
  // gates what it can explain per row, and the validator answers for the rest.
  //
  // "Given" here means the same thing it means for N: a row with something typed in it. So an
  // added-but-empty row neither counts toward N nor blocks the button, and it never reaches the
  // config either — validateMineConfig drops it. One rule, three places.
  const filled = owners.filter((owner) => owner.value.trim().length > 0)

  // The pool this machine will run, which is what the ceiling on the field depends on: the last
  // worker's block sits `workers × WORKER_BLOCK` above the start (see maxStartNonce).
  const workers = useWorkerCount()
  const startNonce = parseStartNonce(startNonceInput, workers)
  const startNonceComplaint = startNonceTouched ? startNonce.error : undefined

  // Note the gate reads `startNonce.error`, not `startNonceComplaint`: the button must never be
  // pressable over a value the submit would reject, whether or not the field has been blurred
  // yet — the same reason the owner rows' gate above reads the value rather than the touched flag.
  const startBlocker: 'empty' | 'invalid' | 'start-nonce' | undefined =
    filled.length === 0
      ? 'empty'
      : filled.some((owner) => !isOwnerAddress(owner.value))
        ? 'invalid'
        : startNonce.error !== undefined
          ? 'start-nonce'
          : undefined

  // Every route by which the USER answers this form marks it answered, and nothing else does —
  // see `edited` above. The wallet prefill is deliberately not one of them; "Use connected wallet"
  // is, because that one was asked for.
  const setOwnerValue = (id: string, value: string) => {
    edited.current = true
    setOwners((rows) => rows.map((row) => (row.id === id ? { ...row, value } : row)))
  }

  // Rows complain only after they have been left once, and from then on live. Validating every
  // keystroke means "0x" is denounced as invalid before it has finished being typed, which is how
  // people learn to ignore these messages; waiting for a SECOND blur to clear a corrected one is
  // the opposite annoyance. The button is not on this schedule — it reads the value itself, so it
  // never claims a half-typed address is fine.
  const touchOwner = (id: string) => {
    setOwners((rows) => rows.map((row) => (row.id === id ? { ...row, touched: true } : row)))
  }
  const ownerComplaint = (owner: OwnerRow) =>
    owner.touched && owner.value.trim().length > 0 && !isOwnerAddress(owner.value)
      ? ownerAddressError(owner.value)
      : undefined

  const addOwner = () => {
    edited.current = true
    setOwners((rows) => {
      const added = makeRows([''], nextRowId)
      focusRow.current = added[0].id
      return [...rows, ...added]
    })
  }

  const removeOwner = (id: string) => {
    edited.current = true
    setOwners((rows) => {
      // The last row is never removed — validateMineConfig rejects an empty owner list, and a
      // form with no field at all has nowhere to type one. The button says so by being disabled;
      // this is the same rule held where the state actually changes.
      if (rows.length <= 1) return rows
      const index = rows.findIndex((row) => row.id === id)
      if (index < 0) return rows
      // The row above where possible, and the one below when the first row goes: focus has to
      // land on a field that still exists, or a keyboard user is dropped to <body>.
      focusRow.current = (rows[index - 1] ?? rows[index + 1]).id
      inputs.current.delete(id)
      return rows.filter((row) => row.id !== id)
    })
  }

  // "Use connected wallet", applied. Distinct from the prefill above in what it is allowed to
  // touch: the prefill only ever fills a blank owner 1, while this puts the wallet in the first
  // blank ANYWHERE, and makes a new row when there is no blank to use. Neither overwrites.
  const useConnectedWallet = () => {
    if (!address) return
    edited.current = true
    setOwners((rows) => {
      const blank = rows.findIndex((row) => row.value.trim().length === 0)
      if (blank >= 0) {
        return rows.map((row, index) => (index === blank ? { ...row, value: address } : row))
      }
      const added = makeRows([address], nextRowId)
      focusRow.current = added[0].id
      return [...rows, ...added]
    })
  }

  // Offered only when it has something to do. Once the wallet is already an owner the only thing
  // this could add is a second copy of it, which validateMineConfig rejects as a duplicate — so
  // showing it then would be offering the user an error.
  const walletIsOwner =
    address !== undefined &&
    owners.some((row) => row.value.trim().toLowerCase() === address.toLowerCase())
  const canUseConnectedWallet = address !== undefined && !walletIsOwner

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    // A press is a way of leaving the field, so the complaint stops being withheld as one about
    // a field nobody has finished with. Belt and braces rather than a fix: an invalid start
    // disables the button, so the press this would have to rescue cannot land.
    setStartNonceTouched(true)
    const result = validateMineConfig({
      // Every row, in order, exactly as typed. Empties and whitespace are dropped by
      // validateMineConfig itself — the same filter `signerCount` counts with.
      owners: owners.map((owner) => owner.value),
      threshold: effectiveThreshold,
      safeVersion,
      chainId,
    })
    setErrors(result.errors)
    if (result.config && startNonce.value !== undefined) {
      onSubmit(result.config, { start: startNonce.value })
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* The distance between two owner inputs is the 20px complaint slot each row reserves
            plus this gap, and the slot is already doing the separating — so the gap only has to
            mark where one row ends. `gap-2` rather than the `gap-3` this started at: with more
            than a couple of owners the list was reading as several separate questions instead of
            one repeated field. (Nothing is conditional on the count; a one-owner form has no
            gap to spend.)

            The row below sets no gap of its own, so a complaint sits flush under the input it
            belongs to and 8px clear of the next one. Halving the outer gap without that would
            have left the red line equidistant between two inputs, belonging to neither. */}
        <div className="flex flex-col gap-2">
          {owners.map((owner, index) => {
            const complaint = ownerComplaint(owner)
            return (
              <div key={owner.id} className="flex flex-col">
                <div className="flex items-end gap-2">
                  {/* The identicon the address in this row would produce, which is the thing the
                      whole app is about — so the row shows it rather than making the user submit
                      to find out. Only for an address that actually parses: deriving one from a
                      half-typed string would flicker a picture of a Safe nobody is mining. The
                      placeholder holds the same 32px so nothing shifts when it resolves. */}
                  {isOwnerAddress(owner.value) ? (
                    <DecorativeBlockie
                      address={owner.value.trim()}
                      size={32}
                      slot="owner-identicon"
                      className="mb-px size-8 rounded-md"
                    />
                  ) : (
                    <span
                      data-slot="owner-identicon-placeholder"
                      aria-hidden="true"
                      className="mb-px size-8 shrink-0 rounded-md border border-dashed border-muted-foreground/40"
                    />
                  )}
                  <div className="flex flex-1 flex-col gap-2">
                    {/* Each field carries its own name — "Owner 1", "Owner 2" — or the list is a
                        row of identically-named boxes to a screen reader. */}
                    <Label htmlFor={ownerFieldId(index)}>Owner {index + 1}</Label>
                    <Input
                      id={ownerFieldId(index)}
                      ref={(element: HTMLInputElement | null) => {
                        inputs.current.set(owner.id, element)
                      }}
                      value={owner.value}
                      onChange={(event) => setOwnerValue(owner.id, event.target.value)}
                      onBlur={() => touchOwner(owner.id)}
                      // The row says so itself, and says so programmatically: with "Start"
                      // disabled there is no press left to produce the validator's message, so a
                      // row that merely looked wrong would leave a screen-reader user with a dead
                      // button and no reason for it.
                      aria-invalid={complaint ? true : undefined}
                      aria-describedby={complaint ? ownerErrorId(index) : undefined}
                      placeholder="0x…"
                    />
                  </div>
                  {/* Absent while there is only one row, rather than present and disabled. There
                      is always at least one owner (validateMineConfig rejects an empty list), and
                      a lone greyed-out cross is a control offering the one thing the form will
                      not allow, on the very first thing a new user sees. The cost is that the
                      input narrows when a second owner arrives; the guarantee itself does not
                      rest on the markup — `removeOwner` refuses to drop the last row whatever is
                      rendered. */}
                  {owners.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mb-px"
                      aria-label={`Remove owner ${index + 1}`}
                      onClick={() => removeOwner(owner.id)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  )}
                </div>
                {/* BELOW the row and always mounted, holding a line of space whether or not it has
                    anything to say. Both halves of that are load-bearing, and MEASURED in a
                    browser rather than assumed: rendering the complaint inside the left column
                    pushed the trash button 28px down (it is 36px tall) at the instant blur marked
                    the row touched — so a user who typed a bad address and reached straight for
                    that row's bin got mousedown on the button and mouseup below it, and the click
                    was simply lost. Reserving the space means a complaint appearing or clearing
                    moves nothing at all, in this row or the ones under it.

                    A live region that is always in the tree is also the one screen readers
                    announce reliably; one mounted together with its text is a coin toss. */}
                <p
                  id={ownerErrorId(index)}
                  role="alert"
                  className="min-h-5 text-sm text-destructive"
                >
                  {complaint}
                </p>
              </div>
            )
          })}
        </div>
        {/* Both low-emphasis text buttons, on one line, so the only filled control on the card is
            the one that starts the search. These add to the form; that one acts on it.

            `-mt-3` cancels this column's own gap and then reaches 4px into the last row's
            always-mounted complaint slot, which reserves 20px below the input whether or not it
            has anything to say. At the form's plain spacing all of that stacked up and read as a
            break between the owners list and two unrelated buttons rather than as controls
            belonging to the list. 4px is as far as it goes: both lines are `text-sm`, so each has
            only ~3px of leading to give up before a complaint on the last row and the buttons
            under it start touching.

            `pl-10` is the identicon's 32px plus the row's 8px gap — the exact offset of every
            owner input above, so the line starts on their left edge instead of the card's. */}
        <div className="-mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 pl-10">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-muted-foreground no-underline hover:text-foreground hover:no-underline"
            onClick={addOwner}
          >
            <Plus aria-hidden="true" />
            Add another owner
          </Button>
          {canUseConnectedWallet && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={useConnectedWallet}
            >
              Use connected wallet
            </Button>
          )}
        </div>
        {errors.owners && (
          <p role="alert" className="text-sm text-destructive">
            {errors.owners}
          </p>
        )}
      </div>

      {/* Side by side: two narrow controls that each answer one short question, on a card only
          520px wide. Stacked they read as two more steps than they are.

          `mb-2` keeps these clear of the start control below, matching the 24px the rule above
          them holds — so the group is bounded by the same distance on both sides. */}
      <div className="mb-2 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={thresholdId}>Threshold</Label>
          <div className="flex items-center gap-2">
            <Select
              value={String(effectiveThreshold)}
              onValueChange={(value) => {
                // Only a real option is an answer. This control is backed by a hidden native
                // <select>, and Radix reports that element's changes as choices: a commit that adds
                // the option a new value names can leave it holding a value it has no option for
                // for an instant, and the element answers with "" — which `Number` reads as 0. That
                // is a threshold no config can have (it would clamp the display and the submit to 0
                // and mark the form as answered by the user, locking out the share-link seed above),
                // and nobody asked for it. Reachable exactly once: a `?config=` link landing after
                // the first render, which seeds the owners and the threshold together.
                const next = Number(value)
                if (!Number.isInteger(next) || next < 1) return
                edited.current = true
                setThreshold(next)
              }}
              // N of zero: no owner has been typed, so there is no threshold that could be honoured
              // and the control offers none. Submitting anyway is not silent — validateMineConfig
              // answers "Add at least one owner address.", which is rendered above.
              disabled={signerCount === 0}
            >
              <SelectTrigger id={thresholdId} aria-label="Threshold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Exactly 1..N. The `max(…, 1)` only ever matters while the control is disabled: it
                  keeps a "1" for the trigger to display rather than an empty box. */}
                {Array.from({ length: Math.max(signerCount, 1) }, (_, index) => index + 1).map(
                  (option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              out of {signerCount} signer{signerCount === 1 ? '' : 's'}
            </p>
          </div>
          {errors.threshold && (
            <p role="alert" className="text-sm text-destructive">
              {errors.threshold}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={safeVersionId}>Safe version</Label>
          <Select
            value={safeVersion}
            onValueChange={(value) => {
              edited.current = true
              setSafeVersion(value)
            }}
          >
            <SelectTrigger id={safeVersionId} aria-label="Safe version">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_SAFE_VERSIONS.map((version) => (
                <SelectItem key={version} value={version}>
                  {version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.safeVersion && (
            <p role="alert" className="text-sm text-destructive">
              {errors.safeVersion}
            </p>
          )}
        </div>
      </div>

      {/* Everything above is a question every run has to answer. This is the one that only a
          resumed run answers, so it is reachable rather than present: the first screen a new
          visitor sees stays four controls long, and the returning user pasting an eleven-digit
          resume point is a click away from the field for it.

          `open` is not simply `advancedOpen`: while the value is invalid the Start button is
          disabled and its reason lives in here, so collapsing over the complaint would leave a
          dead button with nothing on screen to fix. */}

      {/* Which patterns count as a hit, always visible, and above both disclosures.
          
          It is the other half of what this card is for. Reachable only by opening the Filter card,
          the most consequential choice on the screen sat behind the same door as three constraints
          that cost nothing to change — and a resume link's recipient could press Start without ever
          seeing it. Out here it is simply one of the questions the card asks, in the order they are
          asked: owners, threshold, version, what a hit looks like.
          
          `live={false}`: there is no run on this screen, so a click applies on the spot rather than
          staging behind an Apply that would have nothing to restart. */}
      {mouths && onMouthsChange && (
        <ExpressionPicker value={mouths} onChange={onMouthsChange} live={false} />
      )}

      {/* The colour constraints — what to mine for is settled above; these refine it.

          Offered on every visit rather than only for a link: the expressions and the colour and
          match floors decide what the miner credits and what the results grid shows, and until they
          were reachable from here nobody could answer them until a run already existed. A resume
          link's recipient in particular pressed Start on a search they could not see.

          Out in the open rather than behind Advanced, because it is not an advanced question — it
          is the other half of what the form is for, and a disclosure would hide the very values a
          link was sent to communicate. It brings its own collapsing header, so it costs one row
          when nobody wants it (see `defaultOpen`, which is what tells the three arrival states
          apart).

          `quiet` is what makes it read as a peer of the disclosure below rather than as the more
          important of the two: the same muted label, the same chevron against it, and the card's
          vertical padding gone so the row sits in the form's own rhythm instead of holding 24px of
          air above and below itself.

          Nested inside Configure's own Card, a second bordered card reads as clutter rather than as
          structure. Stripped of its border and shadow it reads as a section of this card instead of
          a box floating inside one.

          The two descendant rules are doing the real work, and `px-0` on the Card would not: Card
          carries no horizontal padding itself — its header and content each carry their own `px-6`
          (see ui/card) — so left alone this section's text would sit indented 24px from everything
          around it, which on a borderless card reads as a mistake rather than as nesting. Reached
          by `data-slot` because that is the hook those parts already expose for exactly this.

          No `mining` passed, and that is load-bearing: it leaves this card's FacePicker applying an
          expression change immediately rather than asking about restarting a search that does not
          exist. */}
      {mouths && filters && onMouthsChange && onFiltersChange && (
        <FaceSection
          mouths={mouths}
          filters={filters}
          defaultOpen={Boolean(linkCarriedFilters)}
          // Colours only: the expressions are their own section above, and two copies of the tiles
          // on one screen would be two controls for one value.
          withExpressions={false}
          quiet
          className="border-0 shadow-none [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-header]]:px-0"
          onMouthsChange={onMouthsChange}
          onFiltersChange={onFiltersChange}
        />
      )}

      <Collapsible
        open={advancedOpen || Boolean(startNonceComplaint)}
        // A press while a complaint is showing is REFUSED, not deferred: Radix still fires this
        // with `next = false` (a controlled Collapsible reports what the trigger asked for, not
        // what `open` ends up being), and recording that refusal would fire it for real the
        // instant the complaint later clears on its own — unmounting the panel with focus still
        // inside the input it had just been corrected in, and dropping a keyboard user to <body>.
        onOpenChange={(next) => {
          // A press is an answer, even the one refused below: the reader has said what they want
          // the disclosure to be, and the seed must not overrule it later.
          advancedChosen.current = true
          if (next || !startNonceComplaint) setAdvancedOpen(next)
        }}
      >
        <CollapsibleTrigger asChild>
          {/* Same quiet text-button treatment as "Add another owner": the only filled control on
              this card is the one that starts the search. */}
          <Button
            type="button"
            variant="link"
            size="sm"
            // `has-[>svg]:px-0` is load-bearing and cannot be left to `p-0`. Button's `sm` size
            // carries `has-[>svg]:px-2.5`, and tailwind-merge treats a modifier-prefixed class as
            // its own group — so `p-0` never sees it, and with the chevron as a direct child this
            // trigger kept 10px of left padding that nothing here appeared to ask for. That is what
            // sat its label right of the Filter label a row above, which is meant to line up with
            // it exactly.
            //
            // `gap-2`, matching that row's own glyph-to-label gap. Both start at x=0 with a 16px
            // chevron, so the gap is the only thing left that could put the two labels on different
            // columns.
            className="group/advanced h-auto gap-2 p-0 text-muted-foreground no-underline hover:text-foreground hover:no-underline has-[>svg]:px-0"
          >
            {/* Points down closed, up open. Rotated rather than swapped for a second glyph so the
                change is a turn rather than a cut.

                The rotation reads the trigger's data-state through a named GROUP, not off the icon
                itself. Radix puts `data-state` on the button — `asChild` merges the trigger onto it
                — and a bare `data-[state=open]:` compiles to a self-selector, so on this SVG it
                asks the icon about a state the icon never carries and silently never matches. The
                chevron then points down in both states, which is the only visual cue the disclosure
                has. Same shape as FaceSection's card chevron, which is where the working version
                already lived. */}
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform duration-200 group-data-[state=open]/advanced:rotate-180"
            />
            Advanced
          </Button>
        </CollapsibleTrigger>
        {/* `overflow-hidden` is what makes the height animation a reveal rather than a squash —
            same treatment as FaceSection's panel, whose keyframes these are (app/globals.css). */}
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="flex flex-col gap-2 pt-3">
            {/* The label and its explanation on one line, the same pairing the filter labels use
                (see Explains) — so a reader meeting both cards in one visit finds one affordance
                for "tell me more", not two. */}
            <div className="flex items-center gap-1.5">
              <Label htmlFor={startNonceFieldId}>Start from saltNonce</Label>
              <Explains label="the starting saltNonce">
                first saltNonce to try; leave empty to start at 0, or paste the resume point from a
                previous run.
              </Explains>
            </div>
            <Input
              id={startNonceFieldId}
              value={startNonceInput}
              onChange={(event) => {
                // An answer, so the share link must not overwrite it later — the same rule the
                // owners and the threshold are held to (see `edited`).
                edited.current = true
                setStartNonceInput(event.target.value)
              }}
              onBlur={() => setStartNonceTouched(true)}
              // `inputMode` rather than `type="number"`: a number input brings spinners nobody
              // wants on an eleven-digit nonce, and silently accepts the exponent notation this
              // field exists to reject. This asks a phone for the digit keypad and nothing else.
              inputMode="numeric"
              autoComplete="off"
              // The value it stands in for, so the field says what leaving it empty means.
              placeholder="0"
              aria-invalid={startNonceComplaint ? true : undefined}
              // The complaint replaces the help text as the description rather than joining it:
              // both at once reads the rule and the objection to it in one breath.
              aria-describedby={startNonceComplaint ? startNonceErrorId : startNonceHelpId}
            />
            {/* The same sentence, for the accessibility tree only. It cannot simply move into the
                popover and be done with: Radix unmounts that content while closed, so an
                `aria-describedby` pointing at it would dangle most of the time — and this is a form
                field, where losing the description is a real downgrade rather than a cosmetic one.
                So the popover carries it for the eye and this carries it for assistive tech, and
                `aria-describedby` below still resolves. */}
            <p id={startNonceHelpId} className="sr-only">
              first saltNonce to try; leave empty to start at 0, or paste the resume point from a
              previous run.
            </p>
            {/* Always mounted while the disclosure is open, holding its line of space whether or
                not it has anything to say — the same treatment as an owner row's complaint, and
                for the same two reasons: a message appearing must not move the control below it,
                and a live region that is already in the tree is the one screen readers announce
                reliably. */}
            <p id={startNonceErrorId} role="alert" className="min-h-5 text-sm text-destructive">
              {startNonceComplaint}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* The chain is picked in the header, so there is no field to hang this under — but
          validateMineConfig still judges it (an unsupported or zkSync-family chain), and a config
          rejected for a reason the form does not show is a submit button that silently does
          nothing. */}
      {errors.chainId && (
        <p role="alert" className="text-sm text-destructive">
          {errors.chainId}
        </p>
      )}

      {/* Disabled until there is something to mine, with the reason beside it and tied to it by
          aria-describedby. A bare `disabled` would be a dead control: the press that used to
          produce validateMineConfig's explanation is exactly what disabling removes, so the
          explanation has to arrive without one — here for the form as a whole, and on the rows
          themselves for the addresses at fault. */}
      {/* The single high-emphasis control on the card, full width at the bottom, so there is
          never a question about what this card is for. The hint sits ABOVE it rather than beside
          it: at full width there is no room alongside, and a reason placed above the control it
          disables is read before the press rather than after it.

          There is no Stop here. The card is the idle state and the page unmounts it the moment a
          run starts, so halting, resuming and discarding all belong to the status bar — the only
          surface on screen while mining. */}
      <div className="flex flex-col gap-2">
        {startBlocker && (
          <p id={startHintId} className="text-sm text-muted-foreground">
            {startBlocker === 'empty'
              ? 'Add an owner address to start.'
              : startBlocker === 'invalid'
                ? 'Fix the owner address marked above to start.'
                : 'Fix the starting saltNonce under Advanced to start.'}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={startBlocker !== undefined}
          aria-describedby={startBlocker ? startHintId : undefined}
        >
          Start mining
        </Button>
      </div>
    </form>
  )
}
