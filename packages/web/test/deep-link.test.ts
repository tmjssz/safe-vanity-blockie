import {
  bloImage,
  colorContrast,
  compileFace,
  createAddressDeriver,
  createKeccak256,
  describeMatch,
  getTemplate,
  hexToBytes,
  isTwoColor,
  makeScorer,
} from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import {
  candidateFromSaltNonce,
  decodeConfigParam,
  encodeConfigParam,
  resumeSearchPath,
  shareConfigPath,
} from '../lib/deep-link'

const CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1',
  chainId: 1,
  saltNonce: '1885506',
}

const MINE_CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1' as const,
  chainId: 1,
}

const SEARCH = {
  config: MINE_CONFIG,
  target: 'smile,open',
  filters: { twoColor: true, minContrast: 80, minMatch: 90 },
  start: 60_000_016_650_000,
}

// encodeConfigParam is typed to SharedConfig, so malformed/adversarial payloads that don't fit
// that shape are encoded by hand, the same way encodeConfigParam does it internally.
function encodeRaw(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('config deep link', () => {
  it('round-trips a config', () => {
    const { config, error } = decodeConfigParam(encodeConfigParam(CONFIG))
    expect(error).toBeUndefined()
    expect(config).toEqual(CONFIG)
  })

  it('preserves a saltNonce beyond 2^53 exactly', () => {
    const huge = { ...CONFIG, saltNonce: '18446744073709551616' }
    expect(decodeConfigParam(encodeConfigParam(huge)).config?.saltNonce).toBe(
      '18446744073709551616',
    )
  })

  it('produces a URL-safe parameter with no padding', () => {
    const param = encodeConfigParam(CONFIG)
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects a parameter that is not valid base64url', () => {
    expect(decodeConfigParam('!!!not base64!!!').error).toMatch(/could not decode/i)
  })

  it('rejects a parameter that decodes to invalid JSON', () => {
    expect(decodeConfigParam(btoa('{ not json').replace(/=+$/, '')).error).toMatch(
      /could not decode/i,
    )
  })

  it('rejects a config that fails validation, rather than trusting the link', () => {
    const bad = encodeConfigParam({ ...CONFIG, owners: ['0xnope'] })
    expect(decodeConfigParam(bad).error).toMatch(/not a valid address/)
  })

  it('rejects a non-numeric saltNonce', () => {
    const bad = encodeConfigParam({ ...CONFIG, saltNonce: '0x10' })
    expect(decodeConfigParam(bad).error).toMatch(/saltNonce/)
  })

  it('rejects owners containing a non-string entry, rather than dropping it and mining a different Safe', () => {
    const bad = encodeRaw({
      ...CONFIG,
      owners: [1234, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
    })
    const { config, error } = decodeConfigParam(bad)
    expect(error).toMatch(/invalid owner/i)
    expect(config).toBeUndefined()
  })

  it('rejects JSON that decodes to a bare number', () => {
    const { config, error } = decodeConfigParam(encodeRaw(42))
    expect(error).toMatch(/could not decode/i)
    expect(config).toBeUndefined()
  })

  it('rejects JSON that decodes to a bare string', () => {
    const { config, error } = decodeConfigParam(encodeRaw('hello'))
    expect(error).toMatch(/could not decode/i)
    expect(config).toBeUndefined()
  })

  it('rejects JSON that decodes to null', () => {
    const { config, error } = decodeConfigParam(encodeRaw(null))
    expect(error).toMatch(/could not decode/i)
    expect(config).toBeUndefined()
  })

  it('rejects JSON that decodes to an array', () => {
    const { config, error } = decodeConfigParam(encodeRaw([1, 2, 3]))
    expect(error).toMatch(/could not decode/i)
    expect(config).toBeUndefined()
  })

  it('rejects an owners field that is present but not an array', () => {
    const { config, error } = decodeConfigParam(encodeRaw({ ...CONFIG, owners: 'not-an-array' }))
    expect(error).toMatch(/add at least one owner/i)
    expect(config).toBeUndefined()
  })

  it('rejects a saltNonce given as a number rather than a string', () => {
    const { config, error } = decodeConfigParam(encodeRaw({ ...CONFIG, saltNonce: 1885506 }))
    expect(error).toMatch(/saltNonce/)
    expect(config).toBeUndefined()
  })
})

// page.tsx pushes exactly this string into the address bar, so what it does to the REST of the
// URL is not a detail of the copyable field — it is what the app navigates itself to.
describe('shareConfigPath', () => {
  it('writes ?config= into the URL it is given, keeping the path, other params and the fragment', () => {
    expect(shareConfigPath(CONFIG, '/vanity/app?utm=spring#results')).toBe(
      `/vanity/app?utm=spring&config=${encodeConfigParam(CONFIG)}#results`,
    )
  })

  it('replaces a config already in the URL rather than adding a second one', () => {
    expect(shareConfigPath(CONFIG, '/?config=stale')).toBe(`/?config=${encodeConfigParam(CONFIG)}`)
  })

  it('defaults to the URL the document is on', () => {
    expect(shareConfigPath(CONFIG)).toBe(`/?config=${encodeConfigParam(CONFIG)}`)
  })

  it('returns a path, never an absolute URL: the origin is the caller’s to add', () => {
    expect(shareConfigPath(CONFIG, 'https://example.test/app')).toBe(
      `/app?config=${encodeConfigParam(CONFIG)}`,
    )
  })
})

// A resume link is the second kind of link this module writes, and the two must never be
// confusable: `config=` carrying a saltNonce means "look at this mined address", and these five
// params mean "reproduce this search".
describe('resumeSearchPath', () => {
  it('writes the config and all five search params', () => {
    const params = new URL(resumeSearchPath(SEARCH), 'http://localhost').searchParams

    expect(params.get('config')).toBe(encodeConfigParam(MINE_CONFIG))
    expect(params.get('start')).toBe('60000016650000')
    expect(params.get('target')).toBe('smile,open')
    expect(params.get('two-color')).toBe('1')
    expect(params.get('min-contrast')).toBe('80')
    expect(params.get('min-match')).toBe('90')
  })

  // npxCommandFor's rule, for its reason: a param that appears only sometimes leaves the reader
  // working out whether it was left off or left at zero. The permissive end is exactly where that
  // ambiguity costs something, because the two readings mine different searches.
  it('writes every param at its permissive value too, rather than omitting it', () => {
    const permissive = {
      ...SEARCH,
      target: 'faces',
      filters: { twoColor: false, minContrast: 0, minMatch: 0 },
      start: 0,
    }
    const params = new URL(resumeSearchPath(permissive), 'http://localhost').searchParams

    expect(params.get('start')).toBe('0')
    expect(params.get('target')).toBe('faces')
    expect(params.get('two-color')).toBe('0')
    expect(params.get('min-contrast')).toBe('0')
    expect(params.get('min-match')).toBe('0')
  })

  // The digits, ungrouped. This value's destinations are a URL and the CLI's `--start`, and
  // "60,000,016,650,000" would be read by Number as 60 — rescanning the whole search from the
  // beginning, silently.
  it('writes the start nonce as bare digits', () => {
    expect(resumeSearchPath(SEARCH)).toContain('start=60000016650000')
  })

  // Same rule shareConfigPath keeps, and for the same reasons: under a basePath a link written
  // over the site root is a 404 for whoever it is sent to, and the other params and the fragment
  // belong to whoever put them there.
  it('writes into the URL it is given, keeping the path, other params and the fragment', () => {
    const path = resumeSearchPath(SEARCH, '/vanity/app?utm=spring#results')
    const url = new URL(path, 'http://localhost')

    expect(url.pathname).toBe('/vanity/app')
    expect(url.searchParams.get('utm')).toBe('spring')
    expect(url.hash).toBe('#results')
  })

  it('returns a path, never an absolute URL: the origin is the caller’s to add', () => {
    expect(resumeSearchPath(SEARCH, 'https://example.test/app')).toMatch(/^\/app\?/)
  })

  // The bar usually already names a result when this is reached — the panel only opens on a
  // stopped run, and a stopped run may well have had a deploy dialog open. A stale `config=` would
  // otherwise put a MINED saltNonce into a resume link, which is the one combination that makes
  // the two kinds of link indistinguishable.
  it('replaces a config already in the URL, saltNonce and all', () => {
    const stale = `/?config=${encodeConfigParam(CONFIG)}`
    const params = new URL(resumeSearchPath(SEARCH, stale), 'http://localhost').searchParams

    expect(params.getAll('config')).toHaveLength(1)
    expect(params.get('config')).toBe(encodeConfigParam(MINE_CONFIG))
    expect(decodeConfigParam(params.get('config') as string).config?.saltNonce).toBeUndefined()
  })

  it('replaces stale resume params rather than adding a second set', () => {
    const stale = '/?start=1&target=frown&two-color=0&min-contrast=5&min-match=5'
    const params = new URL(resumeSearchPath(SEARCH, stale), 'http://localhost').searchParams

    for (const name of ['start', 'target', 'two-color', 'min-contrast', 'min-match']) {
      expect(params.getAll(name)).toHaveLength(1)
    }
    expect(params.get('target')).toBe('smile,open')
  })
})

// The other direction of the same rule. shareConfigPath writes INTO the current URL and preserves
// everything else, so on a page loaded from a resume link a result share link would silently carry
// the resume too — a link meant to show one address would also reproduce someone's search.
describe('shareConfigPath and resume params', () => {
  it('strips every resume param, so a result link is never also a resume link', () => {
    const here = '/?start=999&target=frown&two-color=0&min-contrast=5&min-match=5&utm=spring'
    const params = new URL(shareConfigPath(CONFIG, here), 'http://localhost').searchParams

    expect(params.get('start')).toBeNull()
    expect(params.get('target')).toBeNull()
    expect(params.get('two-color')).toBeNull()
    expect(params.get('min-contrast')).toBeNull()
    expect(params.get('min-match')).toBeNull()
    // Everything that is not a resume param is still nobody else's business.
    expect(params.get('utm')).toBe('spring')
    expect(params.get('config')).toBe(encodeConfigParam(CONFIG))
  })
})

describe('candidateFromSaltNonce', () => {
  const CONSTANTS = {
    initializerHash: hexToBytes('0x' + '11'.repeat(32)),
    factory: hexToBytes('0x' + '22'.repeat(20)),
    initCodeHash: hexToBytes('0x' + '33'.repeat(32)),
  }
  const FACE_SPEC = getTemplate('faces')

  it('derives the same address createAddressDeriver produces for that nonce', async () => {
    const keccak256 = await createKeccak256()
    const expected = createAddressDeriver(CONSTANTS, keccak256).deriveBig(1885506n)

    const candidate = await candidateFromSaltNonce(CONSTANTS, '1885506', FACE_SPEC)

    expect(candidate.address).toBe(expected)
  })

  it('preserves a saltNonce beyond 2^53 exactly, as a string', async () => {
    const huge = '18446744073709551616'
    const candidate = await candidateFromSaltNonce(CONSTANTS, huge, FACE_SPEC)
    expect(candidate.saltNonce).toBe(huge)
    expect(typeof candidate.saltNonce).toBe('string')
  })

  it('agrees with recomputing twoColor, contrast and score from bloImage for the same address', async () => {
    const candidate = await candidateFromSaltNonce(CONSTANTS, '42', FACE_SPEC)

    const { data, colors } = bloImage(candidate.address)
    const face = compileFace(FACE_SPEC)

    expect(candidate.twoColor).toBe(isTwoColor(data))
    expect(candidate.contrast).toBe(Math.round(colorContrast(colors[0], colors[1])))
    expect(candidate.score).toBe(makeScorer(face)(data))
    expect(candidate.maxScore).toBe(face.maxScore)
    expect(candidate.regions).toEqual(describeMatch(face, data).regions)
  })
})
