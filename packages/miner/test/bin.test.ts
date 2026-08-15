import { execFile } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const CLI = new URL('../dist/cli.js', import.meta.url).pathname

describe('bin entry point', () => {
  // npm installs a bin as a symlink into node_modules/.bin, so process.argv[1] is the symlink
  // while import.meta.url is the real path. A guard comparing them naively makes the published
  // CLI a silent no-op under `npx`. pnpm writes a shell shim instead, which is why this only
  // ever showed up in a packaged install.
  it('runs when invoked through a symlink, as npm and npx install it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svb-bin-'))
    const link = join(dir, 'safe-vanity-blockie')
    symlinkSync(CLI, link)

    const { stdout } = await run('node', [link, '--help'])

    expect(stdout).toMatch(/Usage:/)
    expect(stdout).toMatch(/--owners/)
  })
})
