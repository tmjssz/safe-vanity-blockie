import { SUPPORTED_SAFE_VERSIONS } from '@safe-vanity-blockie/safe-config'
import { describe, expect, it } from 'vitest'
import {
  addressClassFor,
  chainSwitchDiscardsResults,
  DEFAULT_FACE_FILTERS,
  isOwnerAddress,
  maxStartNonce,
  ownerAddressError,
  parseStartNonce,
  SUPPORTED_CHAINS,
  validateMineConfig,
} from '../lib/config'
import { WORKER_BLOCK } from '../lib/worker-protocol'

const OWNER_A = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const OWNER_B = '0x' + '22'.repeat(20)

function input(overrides: Partial<Parameters<typeof validateMineConfig>[0]> = {}) {
  return { owners: [OWNER_A], threshold: 1, safeVersion: '1.4.1', chainId: 1, ...overrides }
}

describe('validateMineConfig', () => {
  it('accepts a well-formed config', () => {
    const { config, errors } = validateMineConfig(input())
    expect(errors).toEqual({})
    expect(config).toEqual({
      owners: [OWNER_A],
      threshold: 1,
      safeVersion: '1.4.1',
      chainId: 1,
    })
  })

  it('rejects a malformed owner address', () => {
    const { config, errors } = validateMineConfig(input({ owners: ['0xnope'] }))
    expect(config).toBeUndefined()
    expect(errors.owners).toMatch(/not a valid address/)
  })

  it('rejects an empty owner list', () => {
    expect(validateMineConfig(input({ owners: [] })).errors.owners).toMatch(/at least one/)
  })

  it('rejects duplicate owners, case-insensitively', () => {
    const errors = validateMineConfig(input({ owners: [OWNER_A, OWNER_A.toLowerCase()] })).errors
    expect(errors.owners).toMatch(/duplicate/i)
  })

  it('rejects a threshold above the owner count', () => {
    expect(validateMineConfig(input({ threshold: 2 })).errors.threshold).toMatch(/exceeds/)
    expect(validateMineConfig(input({ owners: [OWNER_A, OWNER_B], threshold: 2 })).errors).toEqual(
      {},
    )
  })

  it('rejects a threshold below one', () => {
    expect(validateMineConfig(input({ threshold: 0 })).errors.threshold).toMatch(/at least 1/)
  })

  it('accepts every supported Safe version', () => {
    for (const safeVersion of SUPPORTED_SAFE_VERSIONS) {
      expect(validateMineConfig(input({ safeVersion })).errors).toEqual({})
    }
  })

  it('rejects an unsupported Safe version', () => {
    expect(validateMineConfig(input({ safeVersion: '1.2.0' })).errors.safeVersion).toMatch(
      /unsupported/i,
    )
  })

  // The chain reaches the address through the canonical Safe deployment protocol-kit picks for it:
  // factory, initializer (via the fallback handler) and singleton. addressClassFor reads those from
  // safe-deployments; these pin the partition it must produce to what was MEASURED against live
  // RPCs, chain by chain — so a safe-deployments bump that reorders a chain's deployments fails
  // here instead of silently carrying a leaderboard across a switch that changed every address.
  const ETHEREUM = 1
  const SEPOLIA = 11155111
  const POLYGON = 137
  const ARBITRUM = 42161
  const OPTIMISM = 10
  const BASE = 8453
  const GNOSIS = 100
  const MEASURED_CLASSES: Record<string, number[][]> = {
    // 1.4.1 / 1.5.0: one factory everywhere; mainnet alone defaults to the L1 singleton.
    '1.5.0': [[ETHEREUM], [SEPOLIA, POLYGON, ARBITRUM, OPTIMISM, BASE, GNOSIS]],
    '1.4.1': [[ETHEREUM], [SEPOLIA, POLYGON, ARBITRUM, OPTIMISM, BASE, GNOSIS]],
    // 1.3.0 is deployed twice, canonical and eip155, and protocol-kit takes whichever is listed
    // first for the chain — which splits the L2s in two.
    '1.3.0': [[ETHEREUM], [POLYGON, ARBITRUM, GNOSIS], [SEPOLIA, OPTIMISM, BASE]],
  }

  it.each(SUPPORTED_SAFE_VERSIONS)(
    'partitions the supported chains on %s exactly as measured',
    (safeVersion) => {
      const groups = MEASURED_CLASSES[safeVersion]
      expect(groups.flat().sort()).toEqual(SUPPORTED_CHAINS.map((chain) => chain.id).sort())
      const classes = groups.map((group) => {
        const inGroup = new Set(group.map((chainId) => addressClassFor(chainId, safeVersion)))
        expect(inGroup.size).toBe(1)
        const [only] = inGroup
        expect(only).toEqual(expect.any(String))
        return only
      })
      expect(new Set(classes).size).toBe(groups.length)
    },
  )

  it.each(['1.5.0', '1.4.1'] as const)(
    'discards results on %s only when a chain switch crosses the mainnet boundary',
    (safeVersion) => {
      const others = SUPPORTED_CHAINS.filter((chain) => chain.id !== 1)
      for (const from of others) {
        expect(chainSwitchDiscardsResults(from.id, 1, safeVersion)).toBe(true)
        expect(chainSwitchDiscardsResults(1, from.id, safeVersion)).toBe(true)
        for (const to of others) {
          expect(chainSwitchDiscardsResults(from.id, to.id, safeVersion)).toBe(false)
        }
      }
    },
  )

  it('discards results on 1.3.0 when a switch moves between the canonical and eip155 L2s', () => {
    expect(chainSwitchDiscardsResults(POLYGON, BASE, '1.3.0')).toBe(true)
    expect(chainSwitchDiscardsResults(BASE, POLYGON, '1.3.0')).toBe(true)
    expect(chainSwitchDiscardsResults(POLYGON, ARBITRUM, '1.3.0')).toBe(false)
    expect(chainSwitchDiscardsResults(BASE, OPTIMISM, '1.3.0')).toBe(false)
    expect(chainSwitchDiscardsResults(1, POLYGON, '1.3.0')).toBe(true)
  })

  // A chain safe-deployments does not cover is not assumed to be like the others. It cannot be
  // reached from the header today (the picker only offers SUPPORTED_CHAINS), so this pins the
  // direction the fallback takes rather than a live path: ask and reset, never assume and discard.
  it('treats a chain without a Safe deployment as a class of its own', () => {
    const UNDEPLOYED = 999_999
    expect(addressClassFor(UNDEPLOYED, '1.4.1')).toBeUndefined()
    expect(chainSwitchDiscardsResults(137, UNDEPLOYED, '1.4.1')).toBe(true)
    expect(chainSwitchDiscardsResults(UNDEPLOYED, 137, '1.4.1')).toBe(true)
    // …but a "switch" to the chain already in use is still not a switch.
    expect(chainSwitchDiscardsResults(UNDEPLOYED, UNDEPLOYED, '1.4.1')).toBe(false)
  })

  it('rejects a chain the app does not support', () => {
    expect(validateMineConfig(input({ chainId: 999_999 })).errors.chainId).toMatch(/not supported/)
  })

  it('rejects zkSync-family chains explicitly, since they derive addresses differently', () => {
    expect(validateMineConfig(input({ chainId: 324 })).errors.chainId).toMatch(/zkSync/)
  })

  it('rejects a non-integer chainId (NaN) without throwing', () => {
    const { config, errors } = validateMineConfig(input({ chainId: NaN }))
    expect(config).toBeUndefined()
    expect(errors.chainId).toMatch(/not supported/)
  })

  it('rejects a non-integer chainId (fractional) without throwing', () => {
    const { config, errors } = validateMineConfig(input({ chainId: 1.5 }))
    expect(config).toBeUndefined()
    expect(errors.chainId).toMatch(/not supported/)
  })

  it('rejects a non-integer chainId (Infinity) without throwing', () => {
    const { config, errors } = validateMineConfig(input({ chainId: Infinity }))
    expect(config).toBeUndefined()
    expect(errors.chainId).toMatch(/not supported/)
  })
})

// ConfigForm disables "Start" while any owner it has been given is malformed, which means the form
// now asks the address question BEFORE validateMineConfig gets a chance to answer it. These pin
// that there is only one answer: a second, subtly different check in the component is how a button
// ends up disabled over an address the validator would have accepted (nothing to fix, no way
// forward) or enabled over one it then rejects.
describe('isOwnerAddress', () => {
  it('accepts exactly what validateMineConfig accepts', () => {
    for (const owner of [OWNER_A, OWNER_B, OWNER_A.toLowerCase(), `  ${OWNER_A}  `]) {
      expect(isOwnerAddress(owner)).toBe(true)
      expect(validateMineConfig(input({ owners: [owner] })).errors.owners).toBeUndefined()
    }
  })

  it('rejects exactly what validateMineConfig rejects', () => {
    for (const owner of [
      '0xnope',
      '',
      '0x',
      OWNER_A.slice(0, -1),
      `${OWNER_A}00`,
      'not an address',
    ]) {
      expect(isOwnerAddress(owner)).toBe(false)
      // The empty string is the one that is not a MALFORMED address — the validator drops it and
      // complains that there are no owners at all, which is the same "cannot start" either way,
      // and is why the form treats "given" and "counts toward N" as one question.
      expect(validateMineConfig(input({ owners: [owner] })).errors.owners).toBeDefined()
    }
  })

  it('words its complaint exactly as validateMineConfig does', () => {
    expect(validateMineConfig(input({ owners: ['0xnope'] })).errors.owners).toBe(
      ownerAddressError('0xnope'),
    )
  })
})

describe('DEFAULT_FACE_FILTERS', () => {
  // Non-zero, on a scale running to 442: zero accepts a pair whose colours differ by less than
  // the eye reliably separates, which made the first run every user sees the least useful one.
  // Neither floor is 0: zero contrast accepts a pair the eye cannot separate, and zero match accepts
  // every near-miss the miner ever scored, so a first run at both would be the least useful one.
  it('defaults to two colours and a floor on both contrast and match', () => {
    expect(DEFAULT_FACE_FILTERS).toEqual({ twoColor: true, minContrast: 60, minMatch: 85 })
  })
})

describe('parseStartNonce', () => {
  // The field's resting state. An empty box is not a mistake to complain about — it is the
  // default the helper text promises, and the run has to be startable without opening the
  // disclosure at all.
  it('reads an empty field as 0', () => {
    expect(parseStartNonce('', 7)).toEqual({ value: 0 })
    expect(parseStartNonce('   ', 7)).toEqual({ value: 0 })
  })

  it('accepts a plain run of digits', () => {
    expect(parseStartNonce('41200000000', 7)).toEqual({ value: 41_200_000_000 })
    expect(parseStartNonce('0', 7)).toEqual({ value: 0 })
  })

  // The value arrives by paste, off a terminal or another tab, so it arrives with whatever
  // whitespace came with the selection.
  it('strips the whitespace a paste brings with it', () => {
    expect(parseStartNonce('  41200000000\n', 7)).toEqual({ value: 41_200_000_000 })
  })

  // Every one of these is a way the SAME number is legitimately written somewhere else — grouped
  // by a locale, a BigInt literal, an exponent, hex, a signed value. Number() would accept the
  // last three of them silently and mine somewhere the user never named, so they are rejected by
  // shape rather than by what Number makes of them.
  it.each([
    ['41,200,000,000', 'thousands separators'],
    ['41 200 000 000', 'spaced groups'],
    ['41200000000n', 'a BigInt literal'],
    ['4.12e10', 'an exponent'],
    ['0x10', 'hex'],
    ['1.5', 'a decimal point'],
    ['-1', 'a sign'],
    ['+41200000000', 'a leading plus'],
    ['abc', 'not a number at all'],
  ])('rejects %s (%s)', (raw) => {
    const result = parseStartNonce(raw, 7)
    expect(result.value).toBeUndefined()
    expect(result.error).toContain('digits only')
  })

  // The ceiling is not 2^53 flat: the last worker's range sits `workers × WORKER_BLOCK` above the
  // start, and it is that END that has to stay a safe integer — see the range plan in
  // worker-protocol.
  it('accepts the largest start the worker plan leaves room for', () => {
    const max = maxStartNonce(7)
    expect(max).toBe(Number.MAX_SAFE_INTEGER - 7 * WORKER_BLOCK)
    expect(parseStartNonce(String(max), 7)).toEqual({ value: max })
  })

  it('rejects one past it, naming the limit and the worker count', () => {
    const result = parseStartNonce(String(maxStartNonce(7) + 1), 7)
    expect(result.value).toBeUndefined()
    expect(result.error).toContain(maxStartNonce(7).toLocaleString('en-US'))
    expect(result.error).toContain('7 workers')
  })

  // A value that is fine on a 2-core laptop is not fine on a 32-core desktop, because the pool
  // behind it is wider. The limit has to move with the machine, and say which machine it is on.
  it('tightens the limit as workers are added', () => {
    expect(maxStartNonce(32)).toBeLessThan(maxStartNonce(1))
    const forOneWorker = String(maxStartNonce(1))
    expect(parseStartNonce(forOneWorker, 1).value).toBe(maxStartNonce(1))
    expect(parseStartNonce(forOneWorker, 32).error).toContain('32 workers')
  })

  it('says "worker" in the singular for a one-worker machine', () => {
    expect(parseStartNonce(String(maxStartNonce(1) + 1), 1).error).toContain('1 worker.')
  })

  // Far past anything Number can hold, so this is the digits path proving it does not fall over
  // on a 40-digit paste — it is rejected by the bound, with a limit, not by a NaN.
  it('rejects a value far outside the number space', () => {
    const result = parseStartNonce('9'.repeat(40), 7)
    expect(result.value).toBeUndefined()
    expect(result.error).toContain('at most')
  })
})
