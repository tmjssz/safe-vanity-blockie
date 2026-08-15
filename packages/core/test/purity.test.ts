import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('core stays isomorphic', () => {
  it('imports nothing Node- or browser-specific', () => {
    for (const file of sourceFiles(new URL('../src', import.meta.url).pathname)) {
      const text = readFileSync(file, 'utf8')
      expect(text, `${file} imports a node: builtin`).not.toMatch(/from ['"]node:/)
      expect(text, `${file} uses require()`).not.toMatch(/\brequire\(/)
      expect(text, `${file} touches the DOM`).not.toMatch(/\b(document|window|localStorage)\./)
      expect(text, `${file} touches process`).not.toMatch(/\bprocess\./)
    }
  })

  it('depends only on hash-wasm at runtime', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8'),
    )
    expect(Object.keys(pkg.dependencies)).toEqual(['hash-wasm'])
  })
})
