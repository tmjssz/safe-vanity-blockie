import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getTemplate } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { resolveFaceSpec } from '../src/cli.js'

describe('resolveFaceSpec', () => {
  it('resolves builtin template names', () => {
    expect(resolveFaceSpec('faces').regions[0].alternatives).toHaveLength(5)
    expect(resolveFaceSpec('smile').regions[0].alternatives).toHaveLength(1)
  })

  it('loads and validates a FaceSpec JSON file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'facespec-'))
    const file = join(dir, 'custom.json')
    writeFileSync(file, JSON.stringify({ ...getTemplate('smile'), name: 'custom' }))
    expect(resolveFaceSpec(file).name).toBe('custom')
  })

  it('reports unreadable files clearly rather than falling back silently', () => {
    expect(() => resolveFaceSpec('./does-not-exist.json')).toThrow(/could not read face spec/)
  })

  it('reports invalid JSON files clearly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'facespec-'))
    const file = join(dir, 'broken.json')
    writeFileSync(file, '{ not json')
    expect(() => resolveFaceSpec(file)).toThrow(/could not parse face spec/)
  })

  it('rejects an unknown name that is not a file path', () => {
    expect(() => resolveFaceSpec('grin')).toThrow(/unknown template "grin"/)
  })
})
