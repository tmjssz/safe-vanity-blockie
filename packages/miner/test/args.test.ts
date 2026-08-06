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
      '--owners', '0x' + '11'.repeat(20) + ',0x' + '22'.repeat(20),
      '--threshold', '2',
      '--safe-version', '1.3.0',
      '--target', 'smile',
      '--no-two-color',
      '--min-contrast', '150',
      '--workers', '3',
      '--max-iterations', '1000000',
      '--start', '8400000000',
      '--keep', '5',
      '--out', 'results.json',
      '--gallery', 'gallery.html',
    ])
    expect(options).toMatchObject({
      threshold: 2,
      safeVersion: '1.3.0',
      target: 'smile',
      twoColor: false,
      minContrast: 150,
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
    expect(() => mine(['--unknown-flag'])).toThrow(/unknown option "--unknown-flag"/)
    expect(() => mine(['--keep'])).toThrow(/--keep needs a value/)
  })

  it('rejects duplicate owners, which would make the Safe setup invalid', () => {
    const duplicate = '0x' + '11'.repeat(20)
    expect(() => parseArgs(['--owners', `${duplicate},${duplicate}`, '--rpc', 'x'], DEFAULTS)).toThrow(
      /duplicate owner/,
    )
  })
})
