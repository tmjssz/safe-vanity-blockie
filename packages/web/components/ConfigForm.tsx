'use client'

import { Flag, Plus, X } from 'lucide-react'
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
   * Reports what is in the form as it is edited, so the page can keep it in the address bar and a
   * reload does not cost the reader their work.
   *
   * The page writes the URL rather than this form, and there is one writer on purpose: the other
   * half of what goes in it (the expressions and the colour filters) is page state, and two writers
   * on one address bar would each drop the other's params unless both knew about all of them.
   *
   * `config` is present only when owners, threshold and version actually validate. Everything else
   * is reported regardless, because everything else is always valid. See `draftSearchPath` for why
   * a half-typed owner must not reach `config=`.
   */
  onDraftChange?: (draft: { config?: MineConfig; start: number }) => void
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
   * Whether the link this form was seeded from narrowed the search past the app's own defaults.
   *
   * It decides one thing: whether the Filter card arrives open. Narrowed, there is something in
   * there worth reading; not narrowed, there is not — and a link that spells out every default
   * (which is every link, since `resumeSearchPath` always writes all five params) must read the
   * same as a visit with no link at all. Otherwise the section opens to present the app's own
   * defaults as though the sender had chosen them.
   *
   * It says nothing about the checkpoint field, which reveals itself on a non-default
   * `initial.start` alone.
   *
   * Named for its provenance rather than folded into `initial`, because it is not a value to
   * prefill — it is a fact about where the prefill came from.
   */
  linkNarrowedFilters?: boolean
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

/**
 * The value with thousands separators, for display only.
 *
 * Eleven digits are unreadable in a row, and this number is read far more often than it is typed —
 * off a status bar, out of a link, into a CLI. Anything that is not a plain run of digits is handed
 * back untouched: a half-typed or malformed value has to stay exactly as written for the complaint
 * about it to make sense.
 *
 * BigInt, not Number: a saltNonce can exceed 2^53, and grouping a value the format step had already
 * rounded would present a number nobody entered.
 */
function groupDigits(raw: string): string {
  return /^\d+$/.test(raw) ? BigInt(raw).toLocaleString('en-US') : raw
}

/**
 * What the checkpoint field is for, in one place.
 *
 * Written once and rendered twice: in the popover behind the info icon, and in an sr-only paragraph
 * the field points `aria-describedby` at. Two copies of the same sentence would be free to drift,
 * and the one that drifted would be the invisible one.
 *
 * The sr-only copy is not optional. Radix unmounts a popover's content while it is closed, so
 * `aria-describedby` cannot point at it without dangling most of the time, and a form field losing
 * its description is a real downgrade rather than a cosmetic one.
 */
const CHECKPOINT_EXPLANATION =
  'Each saltNonce produces one candidate address, and mining tries them in order from 0. Set one ' +
  'here and it skips straight to that point instead. Paste the Checkpoint from a paused run to ' +
  'carry that search on from where it stopped; leave it empty to start from the beginning.'

/** Ids are per-form and monotonic, so no row ever inherits a removed row's identity. */
function makeRows(values: string[], nextId: { current: number }): OwnerRow[] {
  return values.map((value) => ({ id: `row-${nextId.current++}`, value, touched: false }))
}

export function ConfigForm({
  initial,
  chainId,
  onSubmit,
  onDraftChange,
  mouths,
  filters,
  onMouthsChange,
  onFiltersChange,
  linkNarrowedFilters,
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
  // Whether the reader asked for the checkpoint field. Only half the answer: see `revealed`.
  const [checkpointAsked, setCheckpointAsked] = useState(false)
  // Whether the caret is in it, which decides whether the value is shown grouped or bare.
  const [checkpointFocused, setCheckpointFocused] = useState(false)
  const checkpointRef = useRef<HTMLInputElement>(null)
  // Set by the reveal, consumed by the effect below. A press should land the caret in the field it
  // just produced; a value arriving from a link must NOT steal focus from wherever the reader is.
  const focusOnReveal = useRef(false)

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
      // Nothing to open: a non-empty value reveals the field by itself (see `revealed`), so a
      // seeded checkpoint is on screen the moment it lands rather than behind a press.
      // And complained about if this machine cannot take it — see the initialiser above. A link
      // reaches this form one render late (page.tsx latches `?config=` on first sight, and this
      // subtree's first render comes through a Suspense bailout), so the effect has to say it too.
      setStartNonceTouched(true)
    }
  }, [initial])

  // Read only to offer "Use connected wallet" inside an empty owner field — see the row below.
  // Nothing is filled in without being asked for: a form that answers its own first question makes
  // a connected visitor's owner list look decided before they have looked at it, and the one thing
  // that field decides is which Safe every result belongs to. The offer is one press, and a press
  // is an answer.
  const { address } = useAccount()

  // Lands the caret in the field the press just produced. Keyed on the ref rather than on
  // `revealed`, so a value arriving from a link — which reveals the field too — does not pull focus
  // out of whatever the reader was doing.
  useEffect(() => {
    if (!focusOnReveal.current) return
    focusOnReveal.current = false
    checkpointRef.current?.focus()
  })

  const fieldPrefix = useId()
  const ownerFieldId = (index: number) => `${fieldPrefix}-owner-${index + 1}`
  const ownerErrorId = (index: number) => `${fieldPrefix}-owner-${index + 1}-error`
  const thresholdId = `${fieldPrefix}-threshold`
  const safeVersionId = `${fieldPrefix}-safe-version`
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
  // On screen when asked for, or whenever there is anything in it — see the JSX for why a value
  // that is already set can never be behind a press.
  const revealed = checkpointAsked || startNonceInput.trim().length > 0

  const startNonce = parseStartNonce(startNonceInput, workers)
  const startNonceComplaint = startNonceTouched ? startNonce.error : undefined

  // Note the gate reads `startNonce.error`, not `startNonceComplaint`: the button must never be
  // pressable over a value the submit would reject, whether or not the field has been blurred
  // yet — the same reason the owner rows' gate above reads the value rather than the touched flag.
  const startBlocker: 'empty' | 'invalid' | 'no-expressions' | 'start-nonce' | undefined =
    filled.length === 0
      ? 'empty'
      : filled.some((owner) => !isOwnerAddress(owner.value))
        ? 'invalid'
        : // Only when the host is managing the expressions at all: undefined means it is not, and a
          // form that is not offering them cannot be blocked on them. Reachable only defensively
          // today, since FacePicker refuses to reject the last one and an empty `target=` is a
          // decode error, but the button must not be pressable over a face with no mouth to score.
          mouths?.length === 0
          ? 'no-expressions'
          : startNonce.error !== undefined
            ? 'start-nonce'
            : undefined

  /**
   * What the primary control says. The reason lives ON the button rather than in a line above it.
   *
   * A disabled button with a generic label is a dead control: the press that would have produced an
   * explanation is exactly what disabling removes. Saying the unmet requirement in the label puts
   * the reason where the eye already is, and makes the control's accessible NAME the reason too,
   * which is stronger than a separate sentence tied to it by `aria-describedby`.
   *
   * Exactly one at a time, in the order the reader can act on them: an owner is required before the
   * expressions matter, and both before a checkpoint that is only ever optional.
   *
   * The invalid-owner case keeps its own wording rather than folding into "add an owner": there IS
   * an owner, and telling someone to add one when the row is sitting there malformed sends them to
   * the wrong control.
   *
   * The checkpoint case is not in the specification's list of two and is here anyway, because the
   * button is disabled over it either way and a disabled control reading "Start mining" explains
   * nothing. The field's own complaint says what is wrong with the value; this says why the button
   * will not move.
   */
  const startLabel =
    startBlocker === 'empty'
      ? 'Add an owner to start'
      : startBlocker === 'invalid'
        ? 'Fix the owner address above'
        : startBlocker === 'no-expressions'
          ? 'Accept at least one expression'
          : startBlocker === 'start-nonce'
            ? 'Fix the checkpoint to start'
            : 'Start mining'

  // Every route by which the USER answers this form marks it answered, and nothing else does —
  // see `edited` above. "Use connected wallet" is one of them, because that one was asked for;
  // there is no longer anything that fills a field without being asked.
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

  // "Use connected wallet", applied to the row that offered it. It used to search for the first
  // blank row and grow the list when it found none, because one control at the bottom of the card
  // had to guess which field it meant. The offer lives inside a specific empty field now, so there
  // is nothing to guess and nothing to overwrite: the row it fills is the row it was rendered in.
  // Not named `use…`: the offer calls it from inside the row's JSX, and a `use` prefix there reads
  // to React's own lint rule as a hook called from a nested function.
  const fillFromConnectedWallet = (id: string) => {
    if (!address) return
    edited.current = true
    setOwners((rows) => rows.map((row) => (row.id === id ? { ...row, value: address } : row)))
  }

  // Offered only when it has something to do. Once the wallet is already an owner the only thing
  // this could add is a second copy of it, which validateMineConfig rejects as a duplicate — so
  // showing it then would be offering the user an error.
  const walletIsOwner =
    address !== undefined &&
    owners.some((row) => row.value.trim().toLowerCase() === address.toLowerCase())
  const canUseConnectedWallet = address !== undefined && !walletIsOwner

  // Reports the form upward as it is edited. Validation runs the same way submit runs it, so the
  // page never has to guess whether what it is about to put in the URL would be accepted: a config
  // reaches it only if this exact call would have accepted it too.
  //
  // Keyed on the values rather than on the handler, and the handler is expected to be stable. The
  // rows are mapped to a joined string for the dependency array because `owners` is a fresh array of
  // fresh objects on every keystroke, which would fire this on renders that changed nothing.
  const ownerValues = owners.map((owner) => owner.value).join('\u0000')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `owners` is deliberately read through `ownerValues` above — the array's identity changes on every render and would make this fire for renders that changed nothing.
  useEffect(() => {
    if (!onDraftChange) return
    const { config } = validateMineConfig({
      owners: owners.map((owner) => owner.value),
      threshold: effectiveThreshold,
      safeVersion,
      chainId,
    })
    // An unparseable start is reported as the default rather than withheld: the URL is a draft, and
    // a value the reader is still typing has no business erasing the rest of it.
    onDraftChange({ config, start: startNonce.value ?? 0 })
  }, [ownerValues, effectiveThreshold, safeVersion, chainId, startNonce.value, onDraftChange])

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
            // Every empty row offers it independently, and none of them once the wallet is already
            // an owner: see `canUseConnectedWallet`. Emptiness is what keeps the offer from ever
            // sitting over a value, which is also why it needs no reserved space in the field.
            const offerWallet = canUseConnectedWallet && owner.value.trim().length === 0
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
                    {/* `relative` for the offer below, and `@container` so it can answer to the
                        width of this field rather than the width of the window: the same card is
                        the whole of the start screen and a narrow column beside a run. */}
                    <div className="@container relative">
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
                        // Dropped when the field is too narrow to hold both, and only then: the
                        // offer is the more useful of the two, since "0x…" says what an address
                        // looks like to someone who already knows and the offer hands them one.
                        // 11rem is where a ~120px offer inset by the field's own padding meets a
                        // ~28px placeholder inset by the same, measured at this text size.
                        className={
                          offerWallet ? '@max-[11rem]:placeholder:text-transparent' : undefined
                        }
                        placeholder="0x…"
                      />
                      {/* Inside the field it fills, rather than one control under the whole list.
                          The old placement had to guess which row it meant (the first blank, or a
                          new one), and a card with two owner rows gave no clue which would move.

                          After the Input in the DOM, so it is the next stop from the field it
                          belongs to. A real button, not a value written into the input: a value
                          would be indistinguishable from a typed one, and the read of it that
                          matters here is "this field is still empty".

                          Absolutely positioned, so the field's own text has the whole width. It
                          never shares that width with a value: the first keystroke removes it. */}
                      {offerWallet && (
                        <button
                          type="button"
                          data-slot="use-connected-wallet"
                          aria-label={`Use connected wallet ${address}`}
                          className="absolute top-1/2 right-3 -translate-y-1/2 text-[11.5px] text-primary hover:underline"
                          onClick={() => fillFromConnectedWallet(owner.id)}
                        >
                          Use connected wallet
                        </button>
                      )}
                    </div>
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

          `quiet` is what makes its header read as a peer of the checkpoint line below rather than as
          the more important of the two: the same muted label and the same chevron against it.

          A tint and nothing else. `bg-muted/40` is the same wash the accepted expression tiles just
          above already sit on, so the two read as one family; and it is background ONLY, because a
          border inside a bordered card is two outlines a few pixels apart, which says "another box"
          where the tint says "these rows are one thing".

          The padding moves onto the Card, and the header's and content's own `px-6` is cancelled
          rather than left: Card carries no horizontal padding itself (see ui/card), so with theirs
          in place the text would sit 24px in from the tint's own edge on one side and the tint would
          run to the card edge on the other. Padding here instead wraps the header row too, which is
          what makes the block visible while collapsed — Radix unmounts a closed panel, so padding
          living on the content would leave that row sitting on nothing.

          `py-3` over `quiet`'s own `py-0`: that default is for a header that is just a line in the
          form's flow, and this one is a block with a background that needs room to be one.

          No `mining` passed, and that is load-bearing: it leaves this card's FacePicker applying an
          expression change immediately rather than asking about restarting a search that does not
          exist. */}
      {mouths && filters && onMouthsChange && onFiltersChange && (
        <FaceSection
          mouths={mouths}
          filters={filters}
          defaultOpen={Boolean(linkNarrowedFilters)}
          // Colours only: the expressions are their own section above, and two copies of the tiles
          // on one screen would be two controls for one value.
          withExpressions={false}
          quiet
          className="rounded-lg border-0 bg-muted/40 px-3 py-3 shadow-none [&_[data-slot=card-content]]:px-0 [&_[data-slot=card-header]]:px-0"
          onMouthsChange={onMouthsChange}
          onFiltersChange={onFiltersChange}
        />
      )}

      {/* Everything above is a question every run has to answer. This is the one only a resumed
          run answers, so it is one quiet line until it is wanted: the first screen a new visitor
          meets stays as short as the questions it actually asks, and the returning user pasting a
          resume point is one press from the field for it.

          An accordion did this before, and was too much furniture for one optional input: a header,
          a chevron and a section container around a single field. Same weight as "+ Add another
          owner" instead, which is the other optional thing on this card.

          Blur does NOT collapse an empty field, and that is not an oversight. It did, on the
          grounds that an empty field has nothing to show — and it took the field away from under
          whatever the reader clicked next: the info icon beside it blurs the input, so pressing the
          field's own tooltip unmounted the field and the tooltip with it, mid-click. Once it has
          been asked for it stays until the x says otherwise, which is the only control whose job
          that is.

          `revealed`, not `checkpointAsked`: a value that is already set must never be behind a
          press. It silently moves where the search begins, so a link or a restored session that
          brings one shows it, whether anybody asked or not. A non-empty field is therefore its own
          reason to be on screen — which also means invalid text stays put to be corrected rather
          than vanishing with the complaint that explains it. */}
      {revealed && (
        <div className="flex flex-col gap-2">
          {/* The flag is the status bar's own checkpoint glyph, so the number here and the number
              there are visibly the same fact. The explanation sits behind the same info control the
              filter labels use. */}
          <div className="flex items-center gap-1.5">
            <Flag aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <Label htmlFor={startNonceFieldId}>Checkpoint</Label>
            <Explains label="the starting saltNonce">{CHECKPOINT_EXPLANATION}</Explains>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id={startNonceFieldId}
              ref={checkpointRef}
              // Grouped while the reader is not in it, bare while they are. Eleven digits are
              // unreadable ungrouped, but separators that appear as you type push the caret around
              // and have to be deleted twice, so the grouping waits for blur.
              value={checkpointFocused ? startNonceInput : groupDigits(startNonceInput)}
              onChange={(event) => {
                // An answer, so the share link must not overwrite it later — the same rule the
                // owners and the threshold are held to (see `edited`).
                edited.current = true
                // Separators are display only. Stripping them here is what lets a grouped number be
                // pasted straight in from anywhere it was read, this field included.
                setStartNonceInput(event.target.value.replace(/,/g, ''))
              }}
              onFocus={() => setCheckpointFocused(true)}
              onBlur={() => {
                setCheckpointFocused(false)
                setStartNonceTouched(true)
              }}
              // `inputMode` rather than `type="number"`: a number input brings spinners nobody
              // wants on an eleven-digit nonce, and silently accepts the exponent notation this
              // field exists to reject. This asks a phone for the digit keypad and nothing else.
              inputMode="numeric"
              autoComplete="off"
              // The value it stands in for, so the field says what leaving it empty means.
              placeholder="0"
              aria-invalid={startNonceComplaint ? true : undefined}
              // The caption is a real description now that it is on screen, so there is no sr-only
              // copy of the tooltip to keep in step with it any more.
              aria-describedby={startNonceComplaint ? startNonceErrorId : startNonceHelpId}
              className="font-mono tabular-nums"
            />
            {/* Clears AND collapses, because an empty field left open would be the reveal offering
                itself again in a shape that looks like an answer. Ghost and icon-sized: undoing an
                optional extra is the least consequential thing on the card. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear the checkpoint"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => {
                edited.current = true
                setStartNonceInput('')
                setStartNonceTouched(false)
                setCheckpointAsked(false)
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {/* For the accessibility tree only. What the eye gets is the popover above; this is what
              `aria-describedby` can safely point at, since it is always in the tree. */}
          <p id={startNonceHelpId} className="sr-only">
            {CHECKPOINT_EXPLANATION}
          </p>
          {/* Always MOUNTED, so the live region is already in the tree when it speaks, which is the
              half of this that screen readers are picky about. But `empty:hidden` rather than the
              reserved `min-h-5` an owner row uses: those sit mid-form with fields below them, where
              a message appearing must not shove the next control down. This one's only neighbour is
              the Start button, so the reserved line was 20px of permanent gap directly above the
              submit, present precisely when the field was revealed and there was nothing wrong. */}
          <p id={startNonceErrorId} role="alert" className="text-sm text-destructive empty:hidden">
            {startNonceComplaint}
          </p>
        </div>
      )}

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
        <Button
          type="submit"
          data-slot="start-mining"
          className="w-full"
          disabled={startBlocker !== undefined}
        >
          {startLabel}
        </Button>

        {/* Below the button, not above it, and only while the field is not already on screen.
            Reading order is the point: the primary thing this card does, then the one alternative to
            doing it that way. Above the button it was a line the eye had to pass on the way to
            Start, for something most visits never want.

            And only while Start can actually be pressed. "or" offers an alternative to doing the
            thing above, which is a false offer when the thing above cannot be done: the button is
            carrying the unmet requirement as its label, and a second line under it competes with
            that message while leading somewhere that does not fix it. A checkpoint is where a search
            BEGINS, so it settles nothing about a missing owner or an unscoreable face. Once the form
            is answered the offer means what it says, and appears.

            `startBlocker === 'start-nonce'` never reaches this: a bad checkpoint requires a revealed
            field, and a revealed field has already taken the offer away.

            "or" stays plain muted text and only the action is a link, so what is pressable is
            exactly what is underlined on hover. Centred under a full-width button because there is
            no left edge to align to that would not look like a stray. */}
        {!revealed && startBlocker === undefined && (
          <p className="text-center text-sm text-muted-foreground">
            or{' '}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 align-baseline text-sm"
              onClick={() => {
                focusOnReveal.current = true
                setCheckpointAsked(true)
              }}
            >
              continue from a checkpoint
            </Button>
          </p>
        )}
      </div>
    </form>
  )
}
