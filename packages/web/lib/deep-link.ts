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
