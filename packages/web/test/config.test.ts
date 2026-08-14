import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FACE_FILTERS,
  SUPPORTED_CHAINS,
  chainSwitchDiscardsResults,
  isOwnerAddress,
  ownerAddressError,
  safeSingletonFor,
  validateMineConfig,
} from '../lib/config'

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

  it('rejects an unsupported Safe version', () => {
    expect(validateMineConfig(input({ safeVersion: '1.2.0' })).errors.safeVersion).toMatch(
      /unsupported/i,
    )
  })

  // The chain reaches the address through exactly one thing: which Safe singleton protocol-kit
  // deploys through. That is what makes a switch among the six free and a crossing of the mainnet
  // boundary a reset, so it is pinned here rather than left implicit in whichever component
  // happens to ask.
  //
  // Chain by chain, by ID, against the measurement — NOT by re-deriving "mainnet is special", which
  // is the assumption under test. A rule-shaped assertion would pass automatically for a chain
  // nobody had measured, and the app would then ask nothing before a switch that silently
  // invalidated the whole leaderboard.
  it('names the measured singleton for each supported chain, one by one', () => {
    expect(safeSingletonFor(1)).toBe('Safe.sol') // Ethereum
    expect(safeSingletonFor(11155111)).toBe('SafeL2.sol') // Sepolia
    expect(safeSingletonFor(137)).toBe('SafeL2.sol') // Polygon
    expect(safeSingletonFor(42161)).toBe('SafeL2.sol') // Arbitrum One
    expect(safeSingletonFor(10)).toBe('SafeL2.sol') // OP Mainnet
    expect(safeSingletonFor(8453)).toBe('SafeL2.sol') // Base
    expect(safeSingletonFor(100)).toBe('SafeL2.sol') // Gnosis
  })

  // The gate on adding a chain: offer one the app has not measured and this fails, rather than the
  // app quietly assuming it behaves like the others.
  it('has a measured singleton for every chain the app offers', () => {
    for (const chain of SUPPORTED_CHAINS) {
      expect({ chain: chain.name, singleton: safeSingletonFor(chain.id) }).toEqual({
        chain: chain.name,
        singleton: expect.stringMatching(/^Safe(L2)?\.sol$/),
      })
    }
  })

  it('discards results only when a chain switch crosses the mainnet boundary', () => {
    const others = SUPPORTED_CHAINS.filter((chain) => chain.id !== 1)
    for (const from of others) {
      expect(chainSwitchDiscardsResults(from.id, 1)).toBe(true)
      expect(chainSwitchDiscardsResults(1, from.id)).toBe(true)
      for (const to of others) {
        expect(chainSwitchDiscardsResults(from.id, to.id)).toBe(false)
      }
    }
  })

  // An unmeasured chain is not assumed to be like the six. It cannot be reached from the header
  // today (the picker only offers SUPPORTED_CHAINS), so this pins the direction the fallback
  // takes rather than a live path: ask and reset, never assume and discard.
  it('treats a chain nobody has measured as a class of its own', () => {
    const LINEA = 59144
    expect(safeSingletonFor(LINEA)).toBeUndefined()
    expect(chainSwitchDiscardsResults(137, LINEA)).toBe(true)
    expect(chainSwitchDiscardsResults(LINEA, 137)).toBe(true)
    // …but a "switch" to the chain already in use is still not a switch.
    expect(chainSwitchDiscardsResults(LINEA, LINEA)).toBe(false)
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
    for (const owner of ['0xnope', '', '0x', OWNER_A.slice(0, -1), `${OWNER_A}00`, 'not an address']) {
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
  it('defaults to two colours only and a usable minimum contrast', () => {
    expect(DEFAULT_FACE_FILTERS).toEqual({ twoColor: true, minContrast: 80 })
  })
})
