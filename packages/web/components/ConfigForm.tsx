'use client'

import { Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { DecorativeBlockie } from './Blockie'
import {
  type ConfigErrors,
  isOwnerAddress,
  type MineConfig,
  ownerAddressError,
  SUPPORTED_SAFE_VERSIONS,
  validateMineConfig,
} from '../lib/config'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export interface ConfigFormProps {
  initial?: Partial<{ owners: string[]; threshold: number; safeVersion: string }>
  /**
   * The chain chosen in the page header. It is still one of the four inputs the address is derived
   * from and still travels in the submitted config and the share link — it is simply no longer
   * edited here, because unlike owners, threshold and version it can be changed after a run has
   * started without invalidating anything (see `chainSwitchDiscardsResults`).
   */
  chainId: number
  onSubmit: (config: MineConfig) => void
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

export function ConfigForm({ initial, chainId, onSubmit }: ConfigFormProps) {
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
  const startBlocker: 'empty' | 'invalid' | undefined =
    filled.length === 0
      ? 'empty'
      : filled.some((owner) => !isOwnerAddress(owner.value))
        ? 'invalid'
        : undefined

  const setOwnerValue = (id: string, value: string) => {
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
    setOwners((rows) => {
      const added = makeRows([''], nextRowId)
      focusRow.current = added[0].id
      return [...rows, ...added]
    })
  }

  const removeOwner = (id: string) => {
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
    const result = validateMineConfig({
      // Every row, in order, exactly as typed. Empties and whitespace are dropped by
      // validateMineConfig itself — the same filter `signerCount` counts with.
      owners: owners.map((owner) => owner.value),
      threshold: effectiveThreshold,
      safeVersion,
      chainId,
    })
    setErrors(result.errors)
    if (result.config) onSubmit(result.config)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3">
          {owners.map((owner, index) => {
            const complaint = ownerComplaint(owner)
            return (
              <div key={owner.id} className="flex flex-col gap-1">
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
                  {/* On every row, disabled on the last one standing. There is always at least
                      one owner (validateMineConfig rejects an empty list), but expressing that by
                      REMOVING the control means the row's width changes between one owner and
                      two — the button appears under a pointer already moving toward the input.
                      Disabled says the same rule and holds its ground. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mb-px"
                    disabled={owners.length === 1}
                    aria-label={`Remove owner ${index + 1}`}
                    onClick={() => removeOwner(owner.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
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
            the one that starts the search. These add to the form; that one acts on it. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
          520px wide. Stacked they read as two more steps than they are. */}
      <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor={thresholdId}>Threshold</Label>
        <div className="flex items-center gap-2">
          <Select
            value={String(effectiveThreshold)}
            onValueChange={(value) => setThreshold(Number(value))}
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
        <Select value={safeVersion} onValueChange={setSafeVersion}>
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
              : 'Fix the owner address marked above to start.'}
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
