import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FACE_FILTERS,
  SUPPORTED_CHAINS,
  chainSwitchDiscardsResults,
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
  // deploys through. Measured on live RPCs across all seven supported chains — the factory and the
  // initializer hash are identical everywhere, and the initCodeHash takes one of two values,
  // splitting mainnet (Safe.sol) from the other six (SafeL2.sol). That is what makes a switch
  // among the six free and a crossing of the mainnet boundary a reset, so it is pinned here rather
  // than left implicit in whichever component happens to ask.
  it('puts mainnet on the L1 singleton and every other supported chain on the L2 one', () => {
    expect(safeSingletonFor(1)).toBe('Safe.sol')
    for (const chain of SUPPORTED_CHAINS.filter((entry) => entry.id !== 1)) {
      expect(safeSingletonFor(chain.id)).toBe('SafeL2.sol')
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

describe('DEFAULT_FACE_FILTERS', () => {
  it('defaults to two colours only and no minimum contrast', () => {
    expect(DEFAULT_FACE_FILTERS).toEqual({ twoColor: true, minContrast: 0 })
  })
})
