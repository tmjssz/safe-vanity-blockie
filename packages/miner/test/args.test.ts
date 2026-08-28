import { describe, expect, it } from 'vitest'
import { CliError, parseArgs } from '../src/args.js'

const DEFAULTS = { workers: 7 }
const REQUIRED = [
  '--owners',
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  '--rpc',
  'https://rpc.example',
]

function mine(extra: string[] = []) {
  const command = parseArgs([...REQUIRED, ...extra], DEFAULTS)
  if (command.kind !== 'mine') throw new Error(`expected a mine command, got ${command.kind}`)
  return command.options
}

describe('parseArgs', () => {
  it('defaults to the mine command with the documented defaults', () => {
    const options = mine()
    expect(options.threshold).toBe(1)
    expect(options.safeVersion).toBe('1.4.1')
    expect(options.target).toBe('faces')
    expect(options.twoColor).toBe(true)
    expect(options.minContrast).toBe(0)
    expect(options.minMatch).toBe(0)
    expect(options.workers).toBe(7)
    expect(options.maxIterations).toBe(Number.POSITIVE_INFINITY)
    expect(options.start).toBe(0)
    expect(options.keep).toBe(20)
    expect(options.out).toBeUndefined()
    expect(options.gallery).toBeUndefined()
  })

  it('accepts an explicit mine subcommand', () => {
    expect(parseArgs(['mine', ...REQUIRED], DEFAULTS).kind).toBe('mine')
  })

  it('parses a comma-separated owner list and lowercases nothing', () => {
    const owners = mine().owners
    expect(owners).toEqual(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'])
    const multi = parseArgs(
      ['--owners', '0x' + '11'.repeat(20) + ',0x' + '22'.repeat(20), '--rpc', 'x'],
      DEFAULTS,
    )
    expect(multi.kind === 'mine' && multi.options.owners).toHaveLength(2)
  })

  it('parses every documented flag', () => {
    // Overrides REQUIRED's single owner with two, since --threshold 2 needs >= 2 owners.
    const options = mine([
      '--owners',
      '0x' + '11'.repeat(20) + ',0x' + '22'.repeat(20),
      '--threshold',
      '2',
      '--safe-version',
      '1.3.0',
      '--target',
      'smile',
      '--no-two-color',
      '--min-contrast',
      '150',
      '--min-match',
      '92.5',
      '--workers',
      '3',
      '--max-iterations',
      '1000000',
      '--start',
      '8400000000',
      '--keep',
      '5',
      '--out',
      'results.json',
      '--gallery',
      'gallery.html',
    ])
    expect(options).toMatchObject({
      threshold: 2,
      safeVersion: '1.3.0',
      target: 'smile',
      twoColor: false,
      minContrast: 150,
      minMatch: 92.5,
      workers: 3,
      maxIterations: 1_000_000,
      start: 8_400_000_000,
      keep: 5,
      out: 'results.json',
      gallery: 'gallery.html',
    })
  })

  it('returns the help command for --help and -h', () => {
    expect(parseArgs(['--help'], DEFAULTS).kind).toBe('help')
    expect(parseArgs(['-h'], DEFAULTS).kind).toBe('help')
    expect(parseArgs([], DEFAULTS).kind).toBe('help')
  })

  it('parses the deploy subcommand', () => {
    const command = parseArgs(
      ['deploy', '--salt', '5254976178', ...REQUIRED, '--pk', '0x' + 'ab'.repeat(32)],
      DEFAULTS,
    )
    expect(command.kind).toBe('deploy')
    expect(command.kind === 'deploy' && command.options.saltNonce).toBe('5254976178')
  })

  it('rejects missing required flags', () => {
    expect(() => parseArgs(['mine', '--rpc', 'x'], DEFAULTS)).toThrow(CliError)
    expect(() => parseArgs(['mine', '--rpc', 'x'], DEFAULTS)).toThrow(/--owners is required/)
    expect(() => parseArgs(['mine', '--owners', '0x' + '11'.repeat(20)], DEFAULTS)).toThrow(
      /--rpc is required/,
    )
    expect(() => parseArgs(['deploy', ...REQUIRED, '--pk', '0x1'], DEFAULTS)).toThrow(
      /--salt is required/,
    )
  })

  it('rejects malformed values with actionable messages', () => {
    expect(() => mine(['--threshold', '0'])).toThrow(/--threshold must be a positive integer/)
    expect(() => mine(['--threshold', '9'])).toThrow(/threshold 9 exceeds the 1 owner/)
    expect(() => parseArgs(['--owners', 'nope', '--rpc', 'x'], DEFAULTS)).toThrow(
      /not a valid 0x address/,
    )
    expect(() => mine(['--safe-version', '1.2.0'])).toThrow(/unsupported --safe-version/)
    expect(() => mine(['--keep', '0'])).toThrow(/--keep must be a positive integer/)
    expect(() => mine(['--start', '-1'])).toThrow(/--start must be a non-negative integer/)
    expect(() => mine(['--workers', '0'])).toThrow(/--workers must be a positive integer/)
    expect(() => mine(['--min-match', '-1'])).toThrow(
      /--min-match must be a number between 0 and 100/,
    )
    expect(() => mine(['--min-match', '101'])).toThrow(
      /--min-match must be a number between 0 and 100/,
    )
    expect(() => mine(['--min-match', 'high'])).toThrow(
      /--min-match must be a number between 0 and 100/,
    )
    expect(() => mine(['--unknown-flag'])).toThrow(/unknown option "--unknown-flag"/)
    expect(() => mine(['--keep'])).toThrow(/--keep needs a value/)
  })

  it('rejects duplicate owners, which would make the Safe setup invalid', () => {
    const duplicate = '0x' + '11'.repeat(20)
    expect(() =>
      parseArgs(['--owners', `${duplicate},${duplicate}`, '--rpc', 'x'], DEFAULTS),
    ).toThrow(/duplicate owner/)
  })

  it('rejects an empty value for any value flag instead of silently accepting it', () => {
    // Reachable via `--salt "$SALT"` with SALT unset: an empty string must never be treated as
    // a present-but-empty value (protocol-kit's two deploy code paths disagree on what '' means).
    expect(() => parseArgs(['mine', '--owners', '', '--rpc', 'x'], DEFAULTS)).toThrow(
      /--owners needs a value/,
    )
    expect(() =>
      parseArgs(['deploy', '--salt', '', ...REQUIRED, '--pk', '0x' + 'ab'.repeat(32)], DEFAULTS),
    ).toThrow(/--salt needs a value/)
  })

  describe('--salt validation', () => {
    const PK = ['--pk', '0x' + 'ab'.repeat(32)]

    it('rejects a hex-prefixed salt, which silently means a tiny decimal value', () => {
      expect(() => parseArgs(['deploy', '--salt', '0x10', ...REQUIRED, ...PK], DEFAULTS)).toThrow(
        /--salt must be a decimal non-negative integer/,
      )
    })

    it('rejects a non-numeric salt', () => {
      expect(() =>
        parseArgs(['deploy', '--salt', 'not-a-number', ...REQUIRED, ...PK], DEFAULTS),
      ).toThrow(/--salt must be a decimal non-negative integer/)
    })

    it('rejects a salt above the maximum uint256', () => {
      const tooBig = (2n ** 256n).toString()
      expect(() => parseArgs(['deploy', '--salt', tooBig, ...REQUIRED, ...PK], DEFAULTS)).toThrow(
        /--salt exceeds the maximum uint256/,
      )
    })

    it('accepts a valid huge decimal salt and preserves it exactly as a string', () => {
      const huge = '18446744073709551616'
      const command = parseArgs(['deploy', '--salt', huge, ...REQUIRED, ...PK], DEFAULTS)
      expect(command.kind).toBe('deploy')
      expect(command.kind === 'deploy' && command.options.saltNonce).toBe(huge)
    })

    it('accepts the maximum uint256 exactly', () => {
      const max = (2n ** 256n - 1n).toString()
      const command = parseArgs(['deploy', '--salt', max, ...REQUIRED, ...PK], DEFAULTS)
      expect(command.kind === 'deploy' && command.options.saltNonce).toBe(max)
    })
  })

  describe('deployer key resolution', () => {
    const PK = ['--pk', '0x' + 'ab'.repeat(32)]

    it('requires --pk (or the env var) for deploy', () => {
      expect(() => parseArgs(['deploy', '--salt', '1', ...REQUIRED], DEFAULTS)).toThrow(
        /--pk is required.*SAFE_VANITY_DEPLOYER_KEY/,
      )
    })

    it('accepts --pk when no env var default is supplied', () => {
      const command = parseArgs(['deploy', '--salt', '1', ...REQUIRED, ...PK], DEFAULTS)
      expect(command.kind === 'deploy' && command.options.privateKey).toBe(PK[1])
    })

    it('makes --pk optional when a deployer key default is supplied', () => {
      const command = parseArgs(['deploy', '--salt', '1', ...REQUIRED], {
        ...DEFAULTS,
        deployerKey: '0x' + 'cd'.repeat(32),
      })
      expect(command.kind === 'deploy' && command.options.privateKey).toBe('0x' + 'cd'.repeat(32))
    })

    it('prefers the deployer key default over an explicit --pk when both are present', () => {
      const command = parseArgs(['deploy', '--salt', '1', ...REQUIRED, ...PK], {
        ...DEFAULTS,
        deployerKey: '0x' + 'cd'.repeat(32),
      })
      expect(command.kind === 'deploy' && command.options.privateKey).toBe('0x' + 'cd'.repeat(32))
    })
  })

  it('parses --yes as an opt-in boolean flag for deploy', () => {
    const PK = ['--pk', '0x' + 'ab'.repeat(32)]
    const withoutYes = parseArgs(['deploy', '--salt', '1', ...REQUIRED, ...PK], DEFAULTS)
    expect(withoutYes.kind === 'deploy' && withoutYes.options.yes).toBe(false)
    const withYes = parseArgs(['deploy', '--salt', '1', ...REQUIRED, ...PK, '--yes'], DEFAULTS)
    expect(withYes.kind === 'deploy' && withYes.options.yes).toBe(true)
  })
})

describe('parseArgs --out defaulting', () => {
  // The caller injects the path (cli.ts builds it from the clock), so parseArgs stays a pure
  // function of its arguments and these tests never depend on the current time.
  const DEFAULT_OUT = 'safe-vanity-blockie-20260828-113042Z.json'
  const WITH_DEFAULT = { ...DEFAULTS, out: DEFAULT_OUT }

  const mineWithDefault = (extra: string[] = []) => {
    const command = parseArgs([...REQUIRED, ...extra], WITH_DEFAULT)
    if (command.kind !== 'mine') throw new Error(`expected a mine command, got ${command.kind}`)
    return command.options
  }

  // The point of the default: a run stopped with Ctrl+C leaves its results on disk even when
  // nobody remembered to pass --out before starting a search that then ran for hours.
  it('falls back to the injected default when no --out is given', () => {
    expect(mineWithDefault().out).toBe(DEFAULT_OUT)
  })

  it('prefers an explicit --out over the default', () => {
    expect(mineWithDefault(['--out', 'chosen.json']).out).toBe('chosen.json')
  })

  it('writes nothing when --no-out is given', () => {
    expect(mineWithDefault(['--no-out']).out).toBeUndefined()
  })

  // Contradictory flags: the named destination wins. An unwanted file costs the user one `rm`,
  // while honouring --no-out here would throw away the results of the run they just sat through.
  it('keeps an explicit --out even alongside --no-out', () => {
    expect(mineWithDefault(['--out', 'chosen.json', '--no-out']).out).toBe('chosen.json')
  })

  // --gallery is unchanged: still opt-in, still nothing without the flag.
  it('leaves --gallery opt-in', () => {
    expect(mineWithDefault().gallery).toBeUndefined()
  })
})
