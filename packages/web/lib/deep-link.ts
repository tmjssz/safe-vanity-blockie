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
  type SafeConstants,
} from '@safe-vanity-blockie/core'
import { validateMineConfig } from './config'

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
 * The share link for a config, as a path — the single place a `?config=` URL is spelled out.
 * Two of them exist now: the copyable field in the deploy dialog, and the address bar, which
 * page.tsx pushes when that dialog opens. They have to be the same string (it is the one a user
 * copies straight out of the bar), and the only way to be sure of that is for there to be one
 * builder rather than two that agree today.
 *
 * Written INTO the URL the page is on, not over it. `/?config=…` was the whole spelling, and
 * page.tsx pushes this string straight into the address bar — so it was not merely a share link
 * that dropped things, it was a navigation to the site root: under a basePath, off the deployment
 * entirely (a 404 on reload, and a 404 for whoever the link is sent to), and on any deployment it
 * threw away every other query parameter and the fragment. Those are exactly what `closeSelection`
 * in page.tsx is careful to keep when it takes `config` back out again; the two halves of the same
 * URL now follow the same rule.
 *
 * `base` is the URL to write into, defaulting to wherever the document currently is. It is a
 * parameter only so the rule above is testable and so this is safe where there is no document
 * (a server render, which has no address bar to preserve anything from).
 */
export function shareConfigPath(config: SharedConfig, base?: string): string {
  const here = base ?? (typeof window === 'undefined' ? '/' : window.location.href)
  // The second argument only resolves a relative `base`, and no part of it survives into the
  // return value: this is a PATH. The one caller that needs an absolute URL (ShareConfig, whose
  // link is pasted elsewhere) prefixes the real origin itself.
  const url = new URL(here, 'http://localhost')
  // `set`, never `append`: the bar usually already names a result when this is called again (the
  // chain carry in page.tsx replaces that entry), and two `config` parameters would leave which
  // one is read to whoever reads it. The other parameters are re-serialised on the way through,
  // which is a normalisation of their encoding and never a change to their values; the base64url
  // alphabet is untouched by it.
  url.searchParams.set('config', encodeConfigParam(config))
  return `${url.pathname}${url.search}${url.hash}`
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
