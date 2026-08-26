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
} from '@safe-vanity-blockie/core'
import {
  DEFAULT_FACE_FILTERS,
  type FaceFilters,
  MATCH_MAX,
  type MineConfig,
  validateMineConfig,
} from './config'
import { CONTRAST_MAX } from './contrast-preview'

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
   * Whether the link said anything about the search ITSELF — expressions or filters, as opposed to
   * merely where to start. It is what decides whether the idle screen mounts the Filter card, and
   * it is answered here rather than recomputed at that call site: a link carrying only a
   * checkpoint would otherwise raise a card with nothing in it to show.
   */
  carriesSearch: boolean
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
  const resume: DecodedResume = { carriesSearch: false }

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
    resume.carriesSearch = true
  }

  // Built over the defaults, so what comes back is a COMPLETE FaceFilters or nothing — see the
  // field's own comment. `filters` is only attached if one of the three actually appeared.
  const filters: FaceFilters = { ...DEFAULT_FACE_FILTERS }
  let sawFilter = false

  const twoColor = params.get('two-color')
  if (twoColor !== null) {
    if (twoColor !== '1' && twoColor !== '0') {
      return { error: 'The two-colour filter in this link is not 1 or 0.' }
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
    resume.carriesSearch = true
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
