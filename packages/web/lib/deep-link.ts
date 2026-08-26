import {
  bloImage,
  type Candidate,
  colorContrast,
  compileFace,
  createAddressDeriver,
  createKeccak256,
  describeMatch,
  type FaceSpec,
  isTwoColor,
  makeScorer,
  mouthNamesForTarget,
  type SafeConstants,
  targetNameForMouths,
} from '@safe-vanity-blockie/core'
import {
  DEFAULT_FACE_FILTERS,
  type FaceFilters,
  MATCH_MAX,
  type MineConfig,
  validateMineConfig,
} from './config'
import { CONTRAST_MAX } from './contrast-preview'
import { ALL_MOUTH_NAMES } from './face-selection'

export interface SharedConfig {
  owners: string[]
  threshold: number
  safeVersion: string
  chainId: number
  /** Decimal string. Present when sharing a specific mined result. */
  saltNonce?: string
}

const SALT_PATTERN = /^[0-9]+$/

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
}

export function encodeConfigParam(config: SharedConfig): string {
  return toBase64Url(JSON.stringify(config))
}

/**
 * Writes into the URL the page is on, and returns a PATH.
 *
 * The rules `shareConfigPath` spelled out, now shared with the resume-link writer below, because a
 * second copy of them is a second place they can be got wrong — and every one of them exists
 * because it was got wrong once already. Written INTO the current URL rather than over it: `/?…`
 * was the whole spelling once, and under a basePath that is a navigation off the deployment
 * entirely (a 404 on reload, and a 404 for whoever the link is sent to), and on any deployment it
 * threw away every other query parameter and the fragment.
 *
 * `base` is the URL to write into, defaulting to wherever the document currently is. It is a
 * parameter only so the rule above is testable and so this is safe where there is no document (a
 * server render, which has no address bar to preserve anything from).
 *
 * The second argument to `new URL` only resolves a relative `base`, and no part of it survives into
 * the return value: this is a PATH. Callers needing an absolute URL (the deploy dialog's share
 * field, the checkpoint panel's resume link) prefix the real origin themselves.
 */
function writeIntoUrl(base: string | undefined, write: (params: URLSearchParams) => void): string {
  const here = base ?? (typeof window === 'undefined' ? '/' : window.location.href)
  const url = new URL(here, 'http://localhost')
  write(url.searchParams)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The params a resume link adds beside `config=`, named after the CLI flags `npxCommandFor` emits
 * for exactly these values (see components/CliHandoff). A resume URL and the npx command then
 * state the search in the same words, which is worth more than a shorter URL: the two are read by
 * the same person, one after the other, and a second vocabulary is a second thing to learn.
 *
 * Listed once, here, because three places need to agree about them — the writer below, the
 * decoder, and `shareConfigPath`, which has to DELETE them.
 */
const RESUME_PARAMS = ['start', 'target', 'two-color', 'min-contrast', 'min-match'] as const

/**
 * The `target` an untouched form produces: every expression accepted.
 *
 * Derived through the same function that names a real selection rather than written out as `faces`,
 * so it cannot drift from what the form would actually put in the URL — which is the only thing
 * that makes "equal to the default, so leave it out" safe to act on.
 */
export const DEFAULT_TARGET = targetNameForMouths(ALL_MOUTH_NAMES)

/**
 * A search, as a link carries it.
 *
 * `target` is a `targetNameForMouths` value — the FaceSpec's own name, and the same string the
 * CLI's `--target` takes. Deliberately the name rather than the list of expressions: it is what
 * `faceSpec.name` already holds at the one call site, so nothing has to take a spec apart to build
 * a link, and core resolves it back (`mouthNamesForTarget`).
 */
export interface SharedSearch {
  config: MineConfig
  target: string
  filters: FaceFilters
  /** The checkpoint: where the resumed run should begin. */
  start: number
}

/**
 * The share link for a config, as a path — the single place a `?config=` URL is spelled out.
 * Two of them exist now: the copyable field in the deploy dialog, and the address bar, which
 * page.tsx pushes when that dialog opens. They have to be the same string (it is the one a user
 * copies straight out of the bar), and the only way to be sure of that is for there to be one
 * builder rather than two that agree today.
 *
 * Every other query parameter and the fragment survive the write — that is writeIntoUrl's rule —
 * and those are exactly what `closeSelection` in page.tsx is careful to keep when it takes
 * `config` back out again; the two halves of the same URL now follow the same rule.
 */
export function shareConfigPath(config: SharedConfig, base?: string): string {
  return writeIntoUrl(base, (params) => {
    // `set`, never `append`: the bar usually already names a result when this is called again (the
    // chain carry in page.tsx replaces that entry), and two `config` parameters would leave which
    // one is read to whoever reads it. The other parameters are re-serialised on the way through,
    // which is a normalisation of their encoding and never a change to their values; the base64url
    // alphabet is untouched by it.
    params.set('config', encodeConfigParam(config))
    // A result link is not a resume link. This function writes into whatever URL the page is on,
    // so on a page loaded from a resume link (`?config=…&start=…&target=…`) the copied share link
    // would otherwise carry that resume along with it — a link sent to show one address would also
    // hand over someone's search, and the recipient's screen would fill with a run they did not
    // ask to reproduce.
    //
    // The address bar keeps the params too, not just what is copied out of here — but only up
    // until page.tsx pushes THIS function's own output into it, which it does the moment a result
    // dialog opens. By then a run is on screen and a reload discards it anyway, so a reload taken
    // before Start still resumes; it is only from the dialog onward that the bar's copy of these
    // five params is gone for good (dropSelectionUrl, closing the dialog, removes only `config`).
    for (const param of RESUME_PARAMS) params.delete(param)
  })
}

/**
 * The link that reproduces a search from a checkpoint, as a path.
 *
 * Everything `shareConfigPath` says about writing INTO the URL the page is on applies here
 * verbatim — a basePath, unrelated params and the fragment all survive, `base` defaults to the
 * document's own URL and is a parameter only so this is testable and safe on a server render, and
 * every param is `set` rather than appended so no reader has to choose between two values.
 *
 * What is new is the rule that a link is one kind or the other. `encodeConfigParam` is given a
 * MineConfig with no `saltNonce`, so a resume link can never also name a mined result — and
 * `shareConfigPath` deletes these five params for the same reason in the other direction. The two
 * halves of that rule have to be enforced in code, not by convention, precisely because both
 * functions write into whatever URL they are handed: on a page loaded from one kind of link, the
 * other kind would otherwise inherit it.
 */
export function resumeSearchPath(search: SharedSearch, base?: string): string {
  return writeIntoUrl(base, (params) => {
    // No saltNonce. `config` is spread field by field rather than passed through, so a MineConfig
    // that ever grows a field cannot carry one in by accident — and `set` overwrites whatever
    // `config` the current URL held, which on a page that has had a deploy dialog open is one
    // naming a mined result.
    params.set(
      'config',
      encodeConfigParam({
        owners: search.config.owners,
        threshold: search.config.threshold,
        safeVersion: search.config.safeVersion,
        chainId: search.config.chainId,
      }),
    )
    // Bare digits: this value's other destination is the CLI's `--start`, which parses with Number
    // and would read a grouped "60,000,016,650,000" as 60.
    params.set('start', String(search.start))
    params.set('target', search.target)
    // Every one of them, including at a permissive value — npxCommandFor's rule, for its reason: a
    // param that appears only sometimes leaves the reader working out whether it was left off or
    // left at zero, and here those two readings are different searches.
    params.set('two-color', search.filters.twoColor ? '1' : '0')
    params.set('min-contrast', String(search.filters.minContrast))
    params.set('min-match', String(search.filters.minMatch))
  })
}

/**
 * Whether a URL carries any of the five resume params.
 *
 * Exported so page.tsx can decide whether a URL is worth latching without keeping its own copy of
 * the list. It matters because the address bar is now also where an unsubmitted form is kept: a
 * visitor who moved a slider before typing an owner has filters to restore and no `config=` to
 * carry them, and a latch that insisted on one would drop them.
 */
export function hasResumeParams(params: URLSearchParams): boolean {
  return RESUME_PARAMS.some((param) => params.has(param))
}

/**
 * The start screen's own state, written into the address bar as it is edited, so a reload does not
 * cost the reader their work.
 *
 * Same five params a resume link carries, because they are the same facts. `config` is separate and
 * OPTIONAL, and that is the whole difference: owners, threshold and version are free text that
 * spends most of its life half-typed, and `config=` is strict by design — one malformed owner and
 * `decodeConfigParam` rejects the entire link, which is right for something a stranger sent and
 * wrong for a draft of your own. So the caller passes a config only once it validates, and until
 * then the URL carries the parts that are always valid. The cost is honest and bounded: reload
 * mid-address and that address is gone, while everything chosen from a control survives.
 *
 * Written with `replaceState` by its caller, never pushed. A history entry per keystroke would make
 * Back mean "one character ago" instead of "the page before this one".
 */
export function draftSearchPath(
  draft: { config?: MineConfig; target: string; filters: FaceFilters; start: number },
  base?: string,
): string {
  return writeIntoUrl(base, (params) => {
    /**
     * Written when it differs from the default, removed when it does not.
     *
     * A value equal to the default says nothing the app would not have done anyway, so in the
     * address bar it is noise: `decodeResumeParams` reads a missing param as the default, which
     * makes "absent" and "spelled out at its default value" the same instruction, and only one of
     * them is legible. A pristine start screen therefore leaves the URL alone entirely rather than
     * stamping `?start=0&target=faces&two-color=1…` over it.
     *
     * Removed rather than left behind, so a value returning to its default takes its param with it.
     * Otherwise the URL would only ever grow, and would keep asserting a constraint the reader had
     * just undone.
     *
     * This is the opposite rule to `resumeSearchPath`, deliberately. That one always writes all
     * five, because a resume link is read by builds whose defaults may not match this one's, so it
     * has to state the whole search outright; the comment there says as much. A draft URL is read
     * only by the build that wrote it, so omission cannot change what it means.
     */
    const setUnlessDefault = (name: string, value: string, fallback: string) => {
      if (value === fallback) params.delete(name)
      else params.set(name, value)
    }
    // Removed rather than left stale when the form stops validating: a `config=` describing owners
    // the reader has since edited away is worse than none, because a reload would restore it.
    if (draft.config) {
      params.set(
        'config',
        encodeConfigParam({
          owners: draft.config.owners,
          threshold: draft.config.threshold,
          safeVersion: draft.config.safeVersion,
          chainId: draft.config.chainId,
        }),
      )
    } else {
      params.delete('config')
    }
    setUnlessDefault('start', String(draft.start), '0')
    setUnlessDefault('target', draft.target, DEFAULT_TARGET)
    setUnlessDefault(
      'two-color',
      draft.filters.twoColor ? '1' : '0',
      DEFAULT_FACE_FILTERS.twoColor ? '1' : '0',
    )
    setUnlessDefault(
      'min-contrast',
      String(draft.filters.minContrast),
      String(DEFAULT_FACE_FILTERS.minContrast),
    )
    setUnlessDefault(
      'min-match',
      String(draft.filters.minMatch),
      String(DEFAULT_FACE_FILTERS.minMatch),
    )
  })
}

/** Decodes and fully re-validates — a link is untrusted input, not a trusted config. */
export function decodeConfigParam(param: string): { config?: SharedConfig; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(fromBase64Url(param))
  } catch {
    return { error: 'Could not decode the shared config from this link.' }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'Could not decode the shared config from this link.' }
  }
  const candidate = raw as Record<string, unknown>

  if (
    Array.isArray(candidate.owners) &&
    candidate.owners.some((owner) => typeof owner !== 'string')
  ) {
    return { error: 'This link contains an invalid owner entry.' }
  }
  const owners = Array.isArray(candidate.owners) ? (candidate.owners as string[]) : []
  const { errors } = validateMineConfig({
    owners,
    threshold: Number(candidate.threshold),
    safeVersion: String(candidate.safeVersion),
    chainId: Number(candidate.chainId),
  })
  const firstError = Object.values(errors)[0]
  if (firstError) return { error: firstError }

  if (candidate.saltNonce !== undefined) {
    if (typeof candidate.saltNonce !== 'string' || !SALT_PATTERN.test(candidate.saltNonce)) {
      return { error: 'The saltNonce in this link is not a decimal integer.' }
    }
  }

  return {
    config: {
      owners,
      threshold: Number(candidate.threshold),
      safeVersion: String(candidate.safeVersion),
      chainId: Number(candidate.chainId),
      ...(candidate.saltNonce === undefined ? {} : { saltNonce: candidate.saltNonce as string }),
    },
  }
}

/** What a resume link said, once every param it carried has been checked. */
export interface DecodedResume {
  /** Absent when the link carried no `start=`. */
  start?: number
  /** Absent when the link carried no `target=`. */
  mouths?: string[]
  /**
   * COMPLETE, or absent. Any filter param that was present is applied over DEFAULT_FACE_FILTERS
   * here, so the page never merges a partial and never holds two notions of what an unstated
   * filter means — and the notion that lost would be the silent one, mining to a standard nobody
   * chose.
   */
  filters?: FaceFilters
  /**
   * Whether the link narrowed one of the three COLOUR constraints past the app's own default.
   *
   * It decides whether the Filter section arrives open, so the question it has to answer is "is
   * there anything in THERE worth showing?" Two things follow, and the second is what this got
   * wrong at first.
   *
   * Naming a value is not narrowing anything. `resumeSearchPath` always writes all five params, so
   * a link built from a run left at the defaults spells out `two-color=1`, `min-contrast=80`,
   * `min-match=0`: exactly what an ordinary visit uses. Opening the section over that would present
   * the app's own defaults as though the sender had chosen them.
   *
   * And `target` is not in that section. The expressions became a section of Configure in their own
   * right, always visible, so a link that narrowed only them has nothing for this disclosure to
   * show — it used to open anyway, which is a section expanding to reveal three untouched sliders
   * because something entirely elsewhere was set.
   *
   * Answered here rather than at the call site, so the comparison against the defaults lives beside
   * the decoding that produced the values, and a second consumer cannot reach a different verdict.
   */
  narrowsFilters: boolean
}

const DIGITS = /^\d+$/

/**
 * Reads a whole number param, or says why it could not.
 *
 * Digits only, which turns away every format a number is legitimately written in elsewhere — a
 * grouped `1,000`, an exponent, hex, a leading `+` — rather than letting Number silently
 * reinterpret it as some other value. Same reasoning as `parseStartNonce` in lib/config, and
 * deliberately the same strictness: these params are read back from links this app wrote.
 *
 * Two messages, not one, for the same reason `start` above keeps its two: "not a decimal integer"
 * and "out of range" are different faults with different fixes. A single message here used to
 * report `min-contrast=8.5` as "out of range (0-442)" — but 8.5 IS in that range, and the only fix
 * that sentence suggests, lowering the number, does not help; the actual fault is the decimal
 * point.
 */
function readBounded(
  raw: string,
  max: number,
  notIntegerMessage: string,
  rangeMessage: string,
): { value?: number; error?: string } {
  if (!DIGITS.test(raw)) return { error: notIntegerMessage }
  const value = Number(raw)
  if (value > max) return { error: rangeMessage }
  return { value }
}

/**
 * The five resume params, validated.
 *
 * A link is untrusted input, so nothing here is coerced or clamped: a value out of range is
 * reported, never quietly moved to the nearest legal one. And ONE bad param rejects the whole
 * link, `config=` included — the rule `decodeConfigParam` already applies to a bad owner entry.
 * Keeping the valid half of a malformed link would mean starting a search the link did not
 * describe, which is the failure this whole path exists to prevent; a recipient of a rejected link
 * still has an empty form in front of them, and one sentence saying what was wrong.
 *
 * Each param is independently OPTIONAL, though — present means validated, absent means the app's
 * own default. `resumeSearchPath` always writes all five, so a subset only arises from a truncated
 * or hand-edited URL, and the answer to that is the Filter card the idle screen now shows (which
 * states the resulting search before anything is mined) rather than a strictness that would reject
 * a link for being shortened.
 */
export function decodeResumeParams(params: URLSearchParams): {
  resume?: DecodedResume
  error?: string
} {
  const resume: DecodedResume = { narrowsFilters: false }

  const start = params.get('start')
  if (start !== null) {
    if (!DIGITS.test(start)) {
      return { error: 'The start nonce in this link is not a decimal integer.' }
    }
    // BigInt, for the reason parseStartNonce gives: the bound is a claim about exact integers, and
    // comparing it as one leaves no float reasoning for the next reader to redo.
    if (BigInt(start) > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { error: 'The start nonce in this link is out of range.' }
    }
    resume.start = Number(start)
  }

  const target = params.get('target')
  if (target !== null) {
    try {
      // core's parser, not a second one here. It is the other half of the round trip
      // `targetNameForMouths` opened, and a `--target` at the prompt and a `target=` in a URL have
      // to mean the same thing — which two parsers guarantee only until one of them is edited.
      resume.mouths = mouthNamesForTarget(target)
    } catch (cause) {
      // core's own message, which names both alphabets (the templates and the expressions) and so
      // explains a wrong separator as well as an unknown name. Prefixed rather than replaced: the
      // reader is looking at a link, and "unknown target" alone does not say where it came from.
      return {
        error: `This link names an unknown expression: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      }
    }
  }

  // Built over the defaults, so what comes back is a COMPLETE FaceFilters or nothing — see the
  // field's own comment. `filters` is only attached if one of the three actually appeared.
  const filters: FaceFilters = { ...DEFAULT_FACE_FILTERS }
  let sawFilter = false

  const twoColor = params.get('two-color')
  if (twoColor !== null) {
    if (twoColor !== '1' && twoColor !== '0') {
      return { error: 'The two-color filter in this link is not 1 or 0.' }
    }
    filters.twoColor = twoColor === '1'
    sawFilter = true
  }

  const minContrast = params.get('min-contrast')
  if (minContrast !== null) {
    // The bound is CONTRAST_MAX itself, interpolated into the message, so the sentence a user reads
    // and the limit that rejected them cannot come apart. It is the slider's own ceiling.
    const read = readBounded(
      minContrast,
      CONTRAST_MAX,
      'The contrast floor in this link is not a decimal integer.',
      `The contrast floor in this link is out of range (0-${CONTRAST_MAX}).`,
    )
    if (read.error) return { error: read.error }
    filters.minContrast = read.value as number
    sawFilter = true
  }

  const minMatch = params.get('min-match')
  if (minMatch !== null) {
    const read = readBounded(
      minMatch,
      MATCH_MAX,
      'The match floor in this link is not a decimal integer.',
      `The match floor in this link is out of range (0-${MATCH_MAX}).`,
    )
    if (read.error) return { error: read.error }
    filters.minMatch = read.value as number
    sawFilter = true
  }

  if (sawFilter) {
    resume.filters = filters
    // Only when one of these three actually moved. A link spelling them all out at their default
    // values has narrowed nothing, and the section it would open holds exactly what it already
    // says. `target` is deliberately not consulted: see `narrowsFilters`.
    if (
      filters.twoColor !== DEFAULT_FACE_FILTERS.twoColor ||
      filters.minContrast !== DEFAULT_FACE_FILTERS.minContrast ||
      filters.minMatch !== DEFAULT_FACE_FILTERS.minMatch
    ) {
      resume.narrowsFilters = true
    }
  }

  return { resume }
}

/**
 * Reconstructs the exact Candidate a decoded share link's saltNonce corresponds to, without
 * mining: a share link is deterministic (spec §8.2 — {owners, threshold, safeVersion, saltNonce}
 * predicts exactly one address), so the address, its blockie grid, and its score can all be
 * recomputed directly instead of re-scanning for it.
 *
 * Mirrors createMiner's own buildCandidate() in packages/core/src/miner.ts exactly, so a
 * reconstructed candidate is indistinguishable from one the miner would have produced. Uses
 * deriveBig rather than derive() because a shared saltNonce is a decimal string and may exceed
 * 2^53 (derive()'s safe-integer fast path).
 */
export async function candidateFromSaltNonce(
  constants: SafeConstants,
  saltNonce: string,
  faceSpec: FaceSpec,
): Promise<Candidate> {
  const keccak256 = await createKeccak256()
  const address = createAddressDeriver(constants, keccak256).deriveBig(BigInt(saltNonce))

  const face = compileFace(faceSpec)
  const { data, colors } = bloImage(address)

  return {
    saltNonce,
    address,
    score: makeScorer(face)(data),
    maxScore: face.maxScore,
    twoColor: isTwoColor(data),
    contrast: Math.round(colorContrast(colors[0], colors[1])),
    regions: describeMatch(face, data).regions,
  }
}
