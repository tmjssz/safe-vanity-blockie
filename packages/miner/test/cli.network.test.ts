import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const CLI = new URL('../dist/cli.js', import.meta.url).pathname
const RPC_URL = process.env.TEST_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'

describe('safe-vanity-blockie end to end', () => {
  it('mines a short range, self-checks, and writes both outputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svb-'))
    const out = join(dir, 'results.json')
    const gallery = join(dir, 'gallery.html')

    const { stdout } = await run('node', [
      CLI,
      '--owners', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '--rpc', RPC_URL,
      '--max-iterations', '200000',
      '--workers', '2',
      '--keep', '5',
      '--no-two-color',
      '--out', out,
      '--gallery', gallery,
    ])

    expect(stdout).toMatch(/self-check passed/)
    expect(stdout).toMatch(/--start \d+/)

    const results = JSON.parse(readFileSync(out, 'utf8'))
    expect(results.config.chainId).toBe('1')
    expect(results.config.maxScore).toBe(133)
    expect(results.results.length).toBeGreaterThan(0)
    expect(typeof results.results[0].saltNonce).toBe('string')
    expect(results.results[0].address).toMatch(/^0x[0-9a-f]{40}$/)

    const html = readFileSync(gallery, 'utf8')
    expect(html).toContain('<svg ')
    expect(html).toContain('cosmetic')
  }, 180_000)

  it('prints help and exits 0 with no arguments', async () => {
    const { stdout } = await run('node', [CLI])
    expect(stdout).toContain('safe-vanity-blockie')
    expect(stdout).toContain('--owners')
  })

  it('exits non-zero with a readable message on a bad flag', async () => {
    await expect(run('node', [CLI, '--owners', 'nope', '--rpc', RPC_URL])).rejects.toThrow(
      /not a valid 0x address/,
    )
  })
})
