# Safe Vanity Blockie — `core` + `miner` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pnpm workspace containing `@safe-vanity-blockie/core` (a pure, isomorphic library: exact `blo` port, Safe CREATE2 address derivation, face scoring, WASM keccak) and `@safe-vanity-blockie/miner` (a multi-core CLI that brute-forces a Safe `saltNonce` whose predicted address renders as a chosen two-color face).

**Architecture:** `core` is dependency-light and has no Node- or browser-only APIs, so the identical module runs in Node `worker_threads` today and browser Web Workers when the `web` package is planned later. The hot loop is two keccak hashes → 32-value blockie grid → integer scoring, with every buffer allocated once per worker. `miner` owns all network and Node concerns: it reads the three CREATE2 constants once from an RPC via `@safe-global/protocol-kit`, hands them to workers as plain hex, fans out disjoint nonce ranges, and cross-checks its winner against `predictSafeAddress()` before printing anything.

**Tech Stack:** TypeScript 6 (ESM, NodeNext), Node 24 LTS, pnpm 11, vitest 4, `hash-wasm` 4.12 (WASM keccak-256), `@safe-global/protocol-kit` 8, `viem` 2. Dev-only oracles: `blo@2.0.0` (byte-for-byte port parity) and `@noble/hashes` (keccak parity).

**Scope:** This plan covers deliverables 1 and 2 from the spec (`core`, `miner`). The `web` Next.js app (spec §8) is deliberately excluded and gets its own plan once `core` is finished and stable — every interface it needs is produced by Tasks 1–5 here.

## Global Constraints

- **Runtime floors (spec §2):** Node ≥ 20 (we develop on 24 LTS), TypeScript ≥ 5.4 (we use ^6.0.3), pnpm ≥ 9 (we use 11).
- **`core` purity:** no `node:*` imports, no DOM APIs, no filesystem, no network anywhere in `packages/core/src`. Enforced by a test in Task 5.
- **Worker leanness (spec §3.2):** worker threads may import `@safe-vanity-blockie/core` and `hash-wasm` only. They must never import `@safe-global/protocol-kit` or `viem`.
- **Hot path rules (spec §5.5, §11):** flattened typed arrays, no per-candidate allocation, no array-of-objects lookups. **The scoring loop specifically** must be integer-only with no per-candidate division — that is the rule spec §5.5 states, and it binds `scoring.ts`. It does not bind `address.ts`: `derive()` uses one float division to split the nonce into high/low 32-bit words, which is unavoidable without BigInt (banned for allocation reasons) since a shift count of 32 reduces mod 32. One division alongside two keccak-256 hashes is unmeasurable, and it is strictly cheaper than the source spec's own reference loop, which allocated a BigInt per iteration.
- **One source of truth (spec §11):** the mining loop lives in `core`, not in `miner`. The CLI worker is a thin wrapper so the future Web Worker can reuse the exact same code.
- **Chain support:** standard (non-zkSync) chains only. zkSync-family chain IDs must throw a clear error, never silently mis-derive (spec §3.1, §11).
- **`saltNonce` is emitted as a decimal string everywhere** (JSON, CLI output, deep links) because it may exceed `2^53` (spec §7.3).
- **Security copy:** the root `README.md` must carry the phishing caveat verbatim — a matching identicon is cosmetic and must not be trusted as proof of an address (spec §1).
- **Licence:** MIT.
- **Commit style:** conventional commits (`feat:`, `test:`, `fix:`, `docs:`, `chore:`), one commit per task.

## Deviations from the spec (deliberate, each justified in-task)

1. **Mouth weight normalisation uses largest-remainder apportionment, not `Math.round`.** The spec's `Math.round(mouthW(c)/tot*MOUTH_BUDGET)` does **not** produce equal budgets: `smile`/`frown`/`neutral` sum to 57, `open` to 61, `small` to 62 — so `small` is silently worth 5 more points than `smile` and the advertised `MAX_SCORE = 133` is wrong (real max would be 135). Task 4 implements exact apportionment so every expression sums to exactly `MOUTH_BUDGET = 60` and `MAX_SCORE = 133` is true as written. Spec §5.4's stated intent ("each expression must be normalized to the same budget") is preserved; only the arithmetic is fixed.
2. **No `BigInt` in the hot loop.** The spec's reference loop calls `BigInt(nonce)` and four `setBigUint64` writes per iteration. Task 3 writes two `setUint32`s from a plain `number` and keeps bytes 32..56 permanently zero, which is allocation-free and identical in output. A separate `deriveBig()` covers the full `uint256` range for verification.
3. **`blo` grid generation reuses caller-owned buffers.** `bloDataInto()` writes into a caller-supplied `Uint8Array(32)` + `Uint32Array(4)` and skips building the three colour tuples (it only advances the PRNG 18 times). Byte-for-byte identical to `bloImage().data`, proven by a test.
4. **JSON output is `{ config, results }`, not a bare array.** Spec §7.3 shows an array but then requires the config context be included "in a header or sibling field"; an object satisfies both and keeps a result self-describing.

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/types.ts` | Shared types: `Hsl`, `Palette`, `BloImage`, `FaceSpec`, `CompiledFace`, `Candidate` |
| `packages/core/src/hex.ts` | `bytesToHex` (with slice bounds), `hexToBytes` |
| `packages/core/src/blo.ts` | Exact `blo` v2 port: PRNG, colours, grid, SVG, allocation-free grid variant |
| `packages/core/src/keccak.ts` | `hash-wasm` keccak-256 backend, async init, reused hasher |
| `packages/core/src/address.ts` | CREATE2 derivation from the three precomputed constants |
| `packages/core/src/scoring.ts` | `FaceSpec` → `CompiledFace` compiler, hot-path scorer, reporting helpers |
| `packages/core/src/templates.ts` | Built-in face templates, `FaceSpec` JSON parsing/validation |
| `packages/core/src/miner.ts` | `Leaderboard` + the mining loop (shared by CLI and future Web Workers) |
| `packages/core/src/index.ts` | Public surface |
| `packages/miner/src/setup.ts` | protocol-kit: chainId + the three constants, and the `predictSafeAddress` self-check |
| `packages/miner/src/worker.ts` | `worker_threads` entry: thin wrapper around `core`'s miner |
| `packages/miner/src/pool.ts` | Worker fan-out, disjoint ranges, progress aggregation, cooperative stop |
| `packages/miner/src/args.ts` | Pure CLI argument parsing + validation |
| `packages/miner/src/report.ts` | ASCII preview, leaderboard table, results JSON, self-contained HTML gallery |
| `packages/miner/src/cli.ts` | Orchestration, live progress, SIGINT handling, `bin` entry |
| `packages/miner/src/deploy.ts` | `deploy` subcommand (signer + protocol-kit) |

---

### Task 1: Workspace bootstrap + exact `blo` port

The `blo` port is the foundation everything else scores against, so the workspace scaffolding is folded into this task rather than standing alone. Deliverable: `pnpm test` proves our port matches `blo@2.0.0` byte-for-byte.

**Files:**
- Create: `.mise.toml`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `LICENSE`, `README.md`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/types.ts`, `packages/core/src/blo.ts`
- Test: `packages/core/test/blo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Hsl = readonly [number, number, number]`; `Palette = readonly [Hsl, Hsl, Hsl]` (order `[b, c, s]`); `BloImage = { data: Uint8Array; colors: Palette }`; `randSeed(seed: string): Uint32Array`; `seedInto(seed: string, rseed: Uint32Array): void`; `nextRandom(rseed: Uint32Array): number`; `randomColor(rseed: Uint32Array): Hsl`; `bloImage(address: string): BloImage`; `bloData(address: string): Uint8Array`; `bloDataInto(lowercaseAddress: string, data: Uint8Array, rseed: Uint32Array): void`; `bloSvg(address: string, size?: number): string`.

- [ ] **Step 1: Install the toolchain and initialise the repository**

```bash
cd ~/safe-vanity-blockie
mise use node@24 pnpm@11
mise exec -- node --version   # expect v24.x
mise exec -- pnpm --version   # expect 11.x
git init
```

- [ ] **Step 2: Write the root workspace files**

`.mise.toml`:

```toml
[tools]
node = "24"
pnpm = "11"
```

`package.json`:

```json
{
  "name": "safe-vanity-blockie-workspace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20.19" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r build && pnpm -r test",
    "test:network": "pnpm -r build && pnpm -r test:network",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "@types/node": "^24.13.3",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

`tsconfig.base.json` — `noUncheckedIndexedAccess` is deliberately off: the hot path indexes typed arrays millions of times and `undefined` unions there would force non-null assertions everywhere.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
results*.json
gallery*.html
```

`LICENSE`: standard MIT text, `Copyright (c) 2026 safe-vanity-blockie contributors`.

`README.md` — the security caveat is a hard requirement from spec §1:

```markdown
# safe-vanity-blockie

Brute-force a Safe deployment config (`saltNonce`) so the resulting Safe address renders a chosen
two-color face when drawn by [`blo`](https://github.com/bpierre/blo), the identicon library used by
the Safe UI.

The address is **counterfactual**: mining only finds a config. The address exists deterministically
whether or not the Safe is deployed, and on non-zkSync chains it is identical on every chain that has
the canonical Safe contracts.

## ⚠️ Security caveat

**A matching identicon is cosmetic and must never be trusted as proof of an address.** Blockie
look-alikes are a known phishing vector: an attacker can mine a different address whose identicon
looks the same to a human. Always verify the full address, never the picture.

## Packages

- `packages/core` — pure, isomorphic library: `blo` port, CREATE2 derivation, scoring, templates
- `packages/miner` — multi-core CLI

## Development

    mise install
    pnpm install
    pnpm test
```

- [ ] **Step 3: Write the `core` package files**

`packages/core/package.json`:

```json
{
  "name": "@safe-vanity-blockie/core",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:network": "vitest run --mode network",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "hash-wasm": "^4.12.0"
  },
  "devDependencies": {
    "@noble/hashes": "^2.3.0",
    "blo": "2.0.0",
    "viem": "^2.55.11"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.network.test.ts', '**/node_modules/**'],
  },
})
```

Then install:

```bash
mise exec -- pnpm install
```

- [ ] **Step 4: Write the failing test**

`packages/core/test/blo.test.ts` — `blo`'s `bloImage()` returns the tuple `[data, [b, c, s]]` where each colour is a `Uint16Array`, so both sides are normalised to plain arrays before comparing.

```ts
import { bloImage as refImage, bloSvg as refSvg } from 'blo'
import { describe, expect, it } from 'vitest'
import { bloData, bloDataInto, bloImage, bloSvg, nextRandom, randSeed } from '../src/blo.js'

const ADDRESSES = [
  '0x0000000000000000000000000000000000000000',
  '0xffffffffffffffffffffffffffffffffffffffff',
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  '0x1234567890AbcdEF1234567890aBcdef12345678',
  '0x8Ba1f109551bD432803012645Ac136ddd64DBA72',
  '0x00000000219ab540356cBB839Cbe05303d7705Fa',
] as const

describe('blo port', () => {
  it('matches blo grid data byte-for-byte', () => {
    for (const address of ADDRESSES) {
      const [referenceData] = refImage(address)
      expect(Array.from(bloImage(address).data)).toEqual(Array.from(referenceData))
    }
  })

  it('matches the blo palette in [b, c, s] order', () => {
    for (const address of ADDRESSES) {
      const [, referencePalette] = refImage(address)
      const ours = bloImage(address).colors.map((color) => Array.from(color))
      expect(ours).toEqual(referencePalette.map((color) => Array.from(color)))
    }
  })

  it('matches blo svg output exactly', () => {
    for (const address of ADDRESSES) {
      expect(bloSvg(address, 64)).toBe(refSvg(address, 64))
    }
  })

  it('seeds from the lowercased 0x-prefixed address, so case does not matter', () => {
    const mixed = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    expect(Array.from(bloData(mixed))).toEqual(Array.from(bloData(mixed.toLowerCase())))
  })

  it('bloDataInto reuses caller buffers and stays identical to bloImage', () => {
    const data = new Uint8Array(32)
    const rseed = new Uint32Array(4)
    for (const address of ADDRESSES) {
      bloDataInto(address.toLowerCase(), data, rseed)
      expect(Array.from(data)).toEqual(Array.from(bloImage(address).data))
    }
  })

  it('keeps RANDOM_SCALE positive: nextRandom stays in [0, 1)', () => {
    const rseed = randSeed('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    for (let i = 0; i < 5000; i++) {
      const value = nextRandom(rseed)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('only ever emits grid values 0, 1 or 2', () => {
    for (const address of ADDRESSES) {
      for (const value of bloImage(address).data) expect(value).toBeLessThanOrEqual(2)
    }
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test`
Expected: FAIL — `Failed to resolve import "../src/blo.js"`.

- [ ] **Step 6: Write `types.ts`**

`packages/core/src/types.ts`:

```ts
/** Hue 0-360, saturation 0-100, lightness 0-100 — the ranges blo emits. */
export type Hsl = readonly [number, number, number]

/** blo's palette, in the order blo returns it: background, color, spot. */
export type Palette = readonly [Hsl, Hsl, Hsl]

export interface BloImage {
  /** 32 values in {0,1,2} for the left half of the 8x8 grid; column c mirrors to 7-c. */
  readonly data: Uint8Array
  readonly colors: Palette
}
```

- [ ] **Step 7: Write `blo.ts`**

`packages/core/src/blo.ts` — every constant here is load-bearing; see spec §4.1. `1 / ((1 << 31) >>> 0)` must stay parenthesised exactly like this, and exactly 18 PRNG draws must happen before the grid.

```ts
import type { BloImage, Hsl, Palette } from './types.js'

/** = 1 / 2147483648. Parenthesise as ((1 << 31) >>> 0); `1 << (31 >>> 0)` is negative. */
const RANDOM_SCALE = 1 / ((1 << 31) >>> 0)

/** Number of nextRandom() draws consumed by the three randomColor() calls before the grid. */
const COLOR_DRAWS = 18

export function seedInto(seed: string, rseed: Uint32Array): void {
  rseed[0] = 0
  rseed[1] = 0
  rseed[2] = 0
  rseed[3] = 0
  for (let i = 0; i < seed.length; i++) {
    const slot = i & 3
    rseed[slot] = (rseed[slot] << 5) - rseed[slot] + seed.charCodeAt(i)
  }
}

export function randSeed(seed: string): Uint32Array {
  const rseed = new Uint32Array(4)
  seedInto(seed, rseed)
  return rseed
}

export function nextRandom(rseed: Uint32Array): number {
  const t = rseed[0] ^ (rseed[0] << 11)
  rseed[0] = rseed[1]
  rseed[1] = rseed[2]
  rseed[2] = rseed[3]
  rseed[3] = (rseed[3] ^ (rseed[3] >> 19) ^ t ^ (t >> 8)) >>> 0
  return rseed[3] * RANDOM_SCALE
}

export function randomColor(rseed: Uint32Array): Hsl {
  return [
    Math.floor(nextRandom(rseed) * 360),
    Math.floor(40 + nextRandom(rseed) * 60),
    Math.floor((nextRandom(rseed) + nextRandom(rseed) + nextRandom(rseed) + nextRandom(rseed)) * 25),
  ]
}

export function bloImage(address: string): BloImage {
  const rseed = randSeed(address.toLowerCase())
  // blo assigns these to c, b, s in this order but returns them as [b, c, s].
  const c = randomColor(rseed)
  const b = randomColor(rseed)
  const s = randomColor(rseed)
  const data = new Uint8Array(32)
  for (let i = 0; i < 32; i++) data[i] = Math.floor(nextRandom(rseed) * 2.3)
  return { data, colors: [b, c, s] as Palette }
}

/**
 * Hot-path grid generation. `lowercaseAddress` MUST already be lowercased and 0x-prefixed —
 * the caller owns that so the loop never allocates a string. Writes 32 values into `data`
 * and reuses `rseed` as scratch. Identical output to `bloImage(address).data`.
 */
export function bloDataInto(lowercaseAddress: string, data: Uint8Array, rseed: Uint32Array): void {
  seedInto(lowercaseAddress, rseed)
  for (let i = 0; i < COLOR_DRAWS; i++) nextRandom(rseed)
  for (let i = 0; i < 32; i++) data[i] = Math.floor(nextRandom(rseed) * 2.3)
}

export function bloData(address: string): Uint8Array {
  const data = new Uint8Array(32)
  bloDataInto(address.toLowerCase(), data, new Uint32Array(4))
  return data
}

export function bloSvg(address: string, size = 64): string {
  const {
    data,
    colors: [b, c, s],
  } = bloImage(address)
  const paths = ['', '']
  for (let i = 0; i < 32; i++) {
    if (data[i] === 0) continue
    const x = i & 3
    const y = i >> 2
    const square = ',' + y + 'h1v1h-1z'
    paths[data[i] - 1] += 'M' + x + square + 'M' + (7 - x) + square
  }
  const path = (color: Hsl, d: string) =>
    '<path fill="hsl(' + color[0] + ' ' + color[1] + '% ' + color[2] + '%)" d="' + d + '"/>'
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="optimizeSpeed" ' +
    'width="' +
    size +
    '" height="' +
    size +
    '">' +
    path(b, 'M0,0H8V8H0z') +
    path(c, paths[0]) +
    path(s, paths[1]) +
    '</svg>'
  )
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test`
Expected: PASS — 7 tests.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(core): bootstrap workspace and port the blo identicon algorithm"
```

---

### Task 2: Hex helpers + WASM keccak-256 backend

**Files:**
- Create: `packages/core/src/hex.ts`, `packages/core/src/keccak.ts`
- Test: `packages/core/test/hex.test.ts`, `packages/core/test/keccak.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `bytesToHex(bytes: Uint8Array, start?: number, end?: number): string` (returns `0x`-prefixed lowercase); `hexToBytes(hex: string): Uint8Array`; `type Keccak256 = (input: Uint8Array) => Uint8Array`; `createKeccak256(): Promise<Keccak256>`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/hex.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from '../src/hex.js'

describe('hex', () => {
  it('encodes bytes as lowercase 0x hex', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xff]))).toBe('0x000fff')
  })

  it('encodes a slice, which is how a 32-byte hash becomes a 20-byte address', () => {
    const hash = new Uint8Array(32)
    for (let i = 0; i < 32; i++) hash[i] = i
    expect(bytesToHex(hash, 12, 32)).toBe('0x0c0d0e0f101112131415161718191a1b1c1d1e1f')
    expect(bytesToHex(hash, 12, 32)).toHaveLength(42)
  })

  it('round-trips through hexToBytes with and without the 0x prefix', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    expect(Array.from(hexToBytes('0xdeadbeef'))).toEqual(Array.from(bytes))
    expect(Array.from(hexToBytes('deadbeef'))).toEqual(Array.from(bytes))
    expect(bytesToHex(hexToBytes('0xDEADBEEF'))).toBe('0xdeadbeef')
  })

  it('rejects malformed hex', () => {
    expect(() => hexToBytes('0xabc')).toThrow(/odd-length/)
    expect(() => hexToBytes('0xzz')).toThrow(/invalid hex/)
  })
})
```

`packages/core/test/keccak.test.ts`:

```ts
import { keccak_256 } from '@noble/hashes/sha3.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { bytesToHex } from '../src/hex.js'
import { createKeccak256, type Keccak256 } from '../src/keccak.js'

let keccak256: Keccak256

beforeAll(async () => {
  keccak256 = await createKeccak256()
})

describe('keccak256', () => {
  it('matches the canonical empty-input vector', () => {
    expect(bytesToHex(keccak256(new Uint8Array(0)))).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    )
  })

  it('matches @noble/hashes on the exact input sizes the miner uses', () => {
    for (const size of [0, 1, 32, 64, 85, 200]) {
      const input = new Uint8Array(size)
      for (let i = 0; i < size; i++) input[i] = (i * 37 + 11) & 0xff
      expect(bytesToHex(keccak256(input))).toBe(bytesToHex(keccak_256(input)))
    }
  })

  it('returns a fresh 32-byte array each call, so results can be held across calls', () => {
    const a = keccak256(new Uint8Array([1]))
    const b = keccak256(new Uint8Array([2]))
    expect(a).toHaveLength(32)
    expect(a.buffer).not.toBe(b.buffer)
    expect(bytesToHex(a)).toBe(bytesToHex(keccak256(new Uint8Array([1]))))
  })

  it('is reusable: the hasher resets between calls', () => {
    const first = bytesToHex(keccak256(new Uint8Array([9, 9, 9])))
    keccak256(new Uint8Array(85))
    expect(bytesToHex(keccak256(new Uint8Array([9, 9, 9])))).toBe(first)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test`
Expected: FAIL — `Failed to resolve import "../src/hex.js"` and `"../src/keccak.js"`.

- [ ] **Step 3: Write `hex.ts`**

`packages/core/src/hex.ts`:

```ts
const HEX_BYTES = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** Lowercase 0x-prefixed hex for `bytes[start..end)`. */
export function bytesToHex(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '0x'
  for (let i = start; i < end; i++) out += HEX_BYTES[bytes[i]]
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (body.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${body.length} characters)`)
  }
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error(`hexToBytes: invalid hex at byte ${i}`)
    out[i] = byte
  }
  return out
}
```

- [ ] **Step 4: Write `keccak.ts`**

`packages/core/src/keccak.ts` — `hash-wasm`'s `digest('binary')` returns `memoryView.slice(0, 32)`, i.e. a fresh copy, so the returned array is safe to hold. Instantiate once per worker; `init()` resets the reused hasher.

```ts
import { createKeccak } from 'hash-wasm'

export type Keccak256 = (input: Uint8Array) => Uint8Array

/**
 * Creates a keccak-256 function backed by WebAssembly. Real WASM, so the identical module works
 * in Node worker_threads and browser Web Workers. Call once per worker at startup — instantiation
 * is the expensive part, hashing afterwards is not.
 */
export async function createKeccak256(): Promise<Keccak256> {
  const hasher = await createKeccak(256)
  return (input: Uint8Array): Uint8Array => {
    hasher.init()
    hasher.update(input)
    return hasher.digest('binary')
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test`
Expected: PASS — all `hex` and `keccak256` tests green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add hex helpers and the hash-wasm keccak-256 backend"
```

---

### Task 3: CREATE2 address derivation

**Files:**
- Create: `packages/core/src/address.ts`
- Test: `packages/core/test/address.test.ts`

**Interfaces:**
- Consumes: `Keccak256` and `createKeccak256()` (Task 2), `bytesToHex` (Task 2).
- Produces: `interface SafeConstants { initializerHash: Uint8Array; factory: Uint8Array; initCodeHash: Uint8Array }`; `interface AddressDeriver { derive(saltNonce: number): string; deriveBig(saltNonce: bigint): string }`; `createAddressDeriver(constants: SafeConstants, keccak256: Keccak256): AddressDeriver`. Both derive methods return a lowercase, non-checksummed, `0x`-prefixed 42-character address.

- [ ] **Step 1: Write the failing test**

`packages/core/test/address.test.ts` — viem is the independent oracle for the CREATE2 byte layout, so this task needs no Safe constants and no network.

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { concat, getCreate2Address, keccak256 as viemKeccak256, numberToHex, type Hex } from 'viem'
import { createAddressDeriver } from '../src/address.js'
import { hexToBytes } from '../src/hex.js'
import { createKeccak256, type Keccak256 } from '../src/keccak.js'

const INITIALIZER_HASH = ('0x' + '11'.repeat(32)) as Hex
const FACTORY = ('0x' + '22'.repeat(20)) as Hex
const INIT_CODE_HASH = ('0x' + '33'.repeat(32)) as Hex

const CONSTANTS = {
  initializerHash: hexToBytes(INITIALIZER_HASH),
  factory: hexToBytes(FACTORY),
  initCodeHash: hexToBytes(INIT_CODE_HASH),
}

/** Independent reference: salt = keccak(initializerHash ++ uint256(nonce)), then CREATE2. */
function expectedAddress(saltNonce: bigint): string {
  const salt = viemKeccak256(concat([INITIALIZER_HASH, numberToHex(saltNonce, { size: 32 })]))
  return getCreate2Address({ from: FACTORY, salt, bytecodeHash: INIT_CODE_HASH }).toLowerCase()
}

let keccak256: Keccak256

beforeAll(async () => {
  keccak256 = await createKeccak256()
})

describe('createAddressDeriver', () => {
  it('matches viem for small nonces', () => {
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    for (const nonce of [0, 1, 2, 42, 255, 256, 65535]) {
      expect(deriver.derive(nonce)).toBe(expectedAddress(BigInt(nonce)))
    }
  })

  it('matches viem for nonces above 2^32, where the high word matters', () => {
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    for (const nonce of [4294967295, 4294967296, 8_400_000_000, 5254976178, Number.MAX_SAFE_INTEGER]) {
      expect(deriver.derive(nonce)).toBe(expectedAddress(BigInt(nonce)))
    }
  })

  it('deriveBig covers the full uint256 range', () => {
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    for (const nonce of [0n, 1n, 2n ** 64n, 2n ** 200n + 12345n, 2n ** 256n - 1n]) {
      expect(deriver.deriveBig(nonce)).toBe(expectedAddress(nonce))
    }
  })

  it('deriveBig leaves no stale bytes behind for a later derive()', () => {
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    const fresh = createAddressDeriver(CONSTANTS, keccak256).derive(7)
    deriver.deriveBig(2n ** 200n + 999n)
    expect(deriver.derive(7)).toBe(fresh)
  })

  it('returns a lowercase 0x address of 42 characters', () => {
    const address = createAddressDeriver(CONSTANTS, keccak256).derive(1)
    expect(address).toMatch(/^0x[0-9a-f]{40}$/)
  })

  it('rejects malformed constants and out-of-range nonces', () => {
    expect(() =>
      createAddressDeriver({ ...CONSTANTS, factory: new Uint8Array(19) }, keccak256),
    ).toThrow(/factory must be 20 bytes/)
    expect(() =>
      createAddressDeriver({ ...CONSTANTS, initCodeHash: new Uint8Array(31) }, keccak256),
    ).toThrow(/initCodeHash must be 32 bytes/)
    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    expect(() => deriver.derive(-1)).toThrow(/non-negative safe integer/)
    expect(() => deriver.derive(1.5)).toThrow(/non-negative safe integer/)
    expect(() => deriver.deriveBig(2n ** 256n)).toThrow(/uint256/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test address`
Expected: FAIL — `Failed to resolve import "../src/address.js"`.

- [ ] **Step 3: Write `address.ts`**

`packages/core/src/address.ts`:

```ts
import { bytesToHex } from './hex.js'
import type { Keccak256 } from './keccak.js'

/**
 * The three values that are constant for a given (owners, threshold, safeVersion) and therefore
 * precomputed once on the main thread. Only the saltNonce varies per iteration.
 */
export interface SafeConstants {
  /** keccak256 of the ABI-encoded setup() calldata. 32 bytes. */
  readonly initializerHash: Uint8Array
  /** SafeProxyFactory address. 20 bytes. */
  readonly factory: Uint8Array
  /** keccak256(proxyCreationCode ++ abi.encode(address, singleton)). 32 bytes. */
  readonly initCodeHash: Uint8Array
}

export interface AddressDeriver {
  /** Fast path for saltNonce < 2^53. Returns a lowercase 0x address. */
  derive(saltNonce: number): string
  /** Full uint256 path, for verification and huge nonces. Returns a lowercase 0x address. */
  deriveBig(saltNonce: bigint): string
}

const MAX_UINT256 = (1n << 256n) - 1n

/**
 * Builds a deriver whose buffers are allocated once. Each derive() is exactly two keccaks:
 *   salt = keccak256(initializerHash ++ uint256(saltNonce))
 *   address = keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12..32)
 */
export function createAddressDeriver(
  constants: SafeConstants,
  keccak256: Keccak256,
): AddressDeriver {
  const { initializerHash, factory, initCodeHash } = constants
  if (initializerHash.length !== 32) {
    throw new Error(`initializerHash must be 32 bytes, got ${initializerHash.length}`)
  }
  if (factory.length !== 20) throw new Error(`factory must be 20 bytes, got ${factory.length}`)
  if (initCodeHash.length !== 32) {
    throw new Error(`initCodeHash must be 32 bytes, got ${initCodeHash.length}`)
  }

  // Bytes 32..64 are the big-endian uint256 saltNonce. Bytes 32..56 stay zero for derive(),
  // so the fast path only writes the low 8 bytes.
  const saltPreimage = new Uint8Array(64)
  saltPreimage.set(initializerHash, 0)
  const saltView = new DataView(saltPreimage.buffer)

  const create2Preimage = new Uint8Array(85)
  create2Preimage[0] = 0xff
  create2Preimage.set(factory, 1)
  create2Preimage.set(initCodeHash, 53)

  function finish(): string {
    const salt = keccak256(saltPreimage)
    create2Preimage.set(salt, 21)
    return bytesToHex(keccak256(create2Preimage), 12, 32)
  }

  return {
    derive(saltNonce: number): string {
      if (!Number.isSafeInteger(saltNonce) || saltNonce < 0) {
        throw new Error(`derive() needs a non-negative safe integer, got ${saltNonce}`)
      }
      const high = Math.floor(saltNonce / 4294967296)
      saltView.setUint32(56, high)
      saltView.setUint32(60, saltNonce - high * 4294967296)
      return finish()
    },

    deriveBig(saltNonce: bigint): string {
      if (saltNonce < 0n || saltNonce > MAX_UINT256) {
        throw new Error(`deriveBig() needs a uint256, got ${saltNonce}`)
      }
      let remaining = saltNonce
      for (let i = 63; i >= 32; i--) {
        saltPreimage[i] = Number(remaining & 0xffn)
        remaining >>= 8n
      }
      const address = finish()
      // Restore the invariant derive() relies on: bytes 32..56 are zero.
      saltPreimage.fill(0, 32, 56)
      return address
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test address`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): derive Safe CREATE2 addresses from precomputed constants"
```

---

### Task 4: `FaceSpec` compiler, hot-path scorer, and built-in templates

Scoring and templates ship together because a template is meaningless without the compiler that turns it into typed arrays, and the compiler is untestable without a real template.

**Files:**
- Modify: `packages/core/src/types.ts` (append the face types)
- Create: `packages/core/src/scoring.ts`, `packages/core/src/templates.ts`
- Test: `packages/core/test/scoring.test.ts`, `packages/core/test/templates.test.ts`

**Interfaces:**
- Consumes: `Hsl` (Task 1).
- Produces:
  - `FixedCell { index: number; value: 0 | 1; weight: number }`
  - `RegionAlternative { name: string; cells: (0 | 1)[] }`
  - `FaceRegion { name: string; indices: number[]; budget: number; strokeWeight: number; bgWeight: number; alternatives: RegionAlternative[] }`
  - `FaceSpec { name: string; fixed: FixedCell[]; regions: FaceRegion[] }`
  - `CompiledFace` (opaque flattened typed arrays + `name`, `maxScore`)
  - `compileFace(spec: FaceSpec): CompiledFace`
  - `makeScorer(face: CompiledFace): (data: Uint8Array) => number`
  - `describeMatch(face: CompiledFace, data: Uint8Array): { score: number; regions: Record<string, string> }`
  - `isTwoColor(data: Uint8Array): boolean`
  - `hslToRgb(h: number, s: number, l: number): [number, number, number]`
  - `colorContrast(a: Hsl, b: Hsl): number`
  - `apportion(rawWeights: number[], budget: number): number[]`
  - `MOUTHS: RegionAlternative[]`, `TEMPLATES: Record<string, FaceSpec>`, `getTemplate(name: string): FaceSpec`, `faceWithMouths(name: string, mouthNames: string[]): FaceSpec`, `parseFaceSpec(input: unknown): FaceSpec`

- [ ] **Step 1: Write the failing scoring test**

`packages/core/test/scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  apportion,
  colorContrast,
  compileFace,
  describeMatch,
  hslToRgb,
  isTwoColor,
  makeScorer,
} from '../src/scoring.js'
import { MOUTHS, MOUTH_BUDGET, TEMPLATES, getTemplate } from '../src/templates.js'
import type { FaceSpec } from '../src/types.js'

const FACES = getTemplate('faces')

/** Straightforward, obviously-correct implementation used as an oracle for the fast scorer. */
function naiveScore(spec: FaceSpec, data: Uint8Array): number {
  let total = 0
  for (const cell of spec.fixed) if (data[cell.index] === cell.value) total += cell.weight
  for (const region of spec.regions) {
    let best = 0
    for (const alternative of region.alternatives) {
      const raw = alternative.cells.map((c) => (c === 1 ? region.strokeWeight : region.bgWeight))
      const weights = apportion(raw, region.budget)
      let got = 0
      for (let j = 0; j < region.indices.length; j++) {
        if (data[region.indices[j]] === alternative.cells[j]) got += weights[j]
      }
      if (got > best) best = got
    }
    total += best
  }
  return total
}

function gridFor(mouthName: string): Uint8Array {
  const data = new Uint8Array(32)
  for (const cell of FACES.fixed) data[cell.index] = cell.value
  const region = FACES.regions[0]
  const mouth = region.alternatives.find((alternative) => alternative.name === mouthName)
  if (!mouth) throw new Error(`no mouth named ${mouthName}`)
  for (let j = 0; j < region.indices.length; j++) data[region.indices[j]] = mouth.cells[j]
  return data
}

describe('apportion', () => {
  it('distributes a budget exactly, with no rounding drift', () => {
    expect(apportion([3, 1, 1], 60).reduce((a, b) => a + b, 0)).toBe(60)
    expect(apportion([1], 60)).toEqual([60])
    expect(apportion([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('gives larger raw weights larger shares', () => {
    const shares = apportion([3, 1, 1, 1], 60)
    expect(shares[0]).toBeGreaterThan(shares[1])
  })

  it('is deterministic for tied fractional remainders', () => {
    expect(apportion([1, 1, 1, 1, 1, 1, 1], 10)).toEqual(apportion([1, 1, 1, 1, 1, 1, 1], 10))
  })
})

describe('compileFace + makeScorer', () => {
  it('reports maxScore 133 for the default faces template', () => {
    expect(compileFace(FACES).maxScore).toBe(133)
  })

  it('gives every mouth expression exactly the same maximum, so none is favoured', () => {
    const score = makeScorer(compileFace(FACES))
    for (const mouth of MOUTHS) expect(score(gridFor(mouth.name))).toBe(133)
  })

  it('scores a perfect grid at maxScore and an inverted grid far below it', () => {
    const face = compileFace(FACES)
    const score = makeScorer(face)
    const perfect = gridFor('smile')
    expect(score(perfect)).toBe(face.maxScore)
    const inverted = perfect.map((value) => (value === 1 ? 0 : 1)) as unknown as Uint8Array
    expect(score(Uint8Array.from(inverted))).toBeLessThan(face.maxScore / 2)
  })

  it('treats the spot colour (value 2) as matching nothing, which drives two-colour results', () => {
    const face = compileFace(FACES)
    const score = makeScorer(face)
    const perfect = gridFor('smile')
    const withSpot = Uint8Array.from(perfect)
    withSpot[10] = 2 // the eye
    expect(score(withSpot)).toBe(face.maxScore - 8)
  })

  it('scores an empty mouth zone below every real expression', () => {
    const face = compileFace(FACES)
    const score = makeScorer(face)
    const empty = gridFor('smile')
    for (const index of FACES.regions[0].indices) empty[index] = 0
    for (const mouth of MOUTHS) expect(score(empty)).toBeLessThan(score(gridFor(mouth.name)))
  })

  it('matches the naive reference scorer on pseudo-random grids', () => {
    const score = makeScorer(compileFace(FACES))
    let state = 123456789
    for (let trial = 0; trial < 2000; trial++) {
      const data = new Uint8Array(32)
      for (let i = 0; i < 32; i++) {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        data[i] = state % 3
      }
      expect(score(data)).toBe(naiveScore(FACES, data))
    }
  })

  it('rejects malformed specs', () => {
    const overlapping: FaceSpec = {
      name: 'bad',
      fixed: [{ index: 20, value: 1, weight: 3 }],
      regions: FACES.regions,
    }
    expect(() => compileFace(overlapping)).toThrow(/used more than once/)

    const wrongLength: FaceSpec = {
      name: 'bad',
      fixed: [],
      regions: [{ ...FACES.regions[0], alternatives: [{ name: 'x', cells: [0, 1] }] }],
    }
    expect(() => compileFace(wrongLength)).toThrow(/12 cells/)

    const outOfRange: FaceSpec = {
      name: 'bad',
      fixed: [{ index: 32, value: 1, weight: 3 }],
      regions: [],
    }
    expect(() => compileFace(outOfRange)).toThrow(/between 0 and 31/)
  })
})

describe('describeMatch', () => {
  it('names the best-fitting expression per region', () => {
    const face = compileFace(FACES)
    for (const mouth of MOUTHS) {
      expect(describeMatch(face, gridFor(mouth.name)).regions).toEqual({ mouth: mouth.name })
    }
  })

  it('agrees with the hot-path scorer', () => {
    const face = compileFace(FACES)
    const score = makeScorer(face)
    const data = gridFor('open')
    expect(describeMatch(face, data).score).toBe(score(data))
  })
})

describe('colour helpers', () => {
  it('detects grids that use the spot colour', () => {
    expect(isTwoColor(Uint8Array.from([0, 1, 0, 1]))).toBe(true)
    expect(isTwoColor(Uint8Array.from([0, 1, 2, 1]))).toBe(false)
  })

  it('converts HSL to RGB at known anchors', () => {
    expect(hslToRgb(0, 100, 50).map(Math.round)).toEqual([255, 0, 0])
    expect(hslToRgb(120, 100, 50).map(Math.round)).toEqual([0, 255, 0])
    expect(hslToRgb(0, 0, 100).map(Math.round)).toEqual([255, 255, 255])
  })

  it('scores black-vs-white as the maximum contrast', () => {
    const maximum = colorContrast([0, 0, 0], [0, 0, 100])
    expect(Math.round(maximum)).toBe(442)
    expect(colorContrast([0, 50, 50], [0, 50, 50])).toBe(0)
    expect(colorContrast([0, 50, 40], [0, 50, 60])).toBeLessThan(maximum)
  })
})

describe('MOUTH_BUDGET wiring', () => {
  it('is the value every expression is normalised to', () => {
    for (const region of TEMPLATES.faces.regions) expect(region.budget).toBe(MOUTH_BUDGET)
  })
})
```

- [ ] **Step 2: Write the failing templates test**

`packages/core/test/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compileFace } from '../src/scoring.js'
import {
  BASE_TARGET,
  BASE_WEIGHTS,
  MOUTHS,
  TEMPLATES,
  faceWithMouths,
  getTemplate,
  parseFaceSpec,
} from '../src/templates.js'

describe('templates', () => {
  it('pins the eye at index 10 with the heaviest weight and separates the eyes at index 11', () => {
    expect(BASE_TARGET[10]).toBe(1)
    expect(BASE_WEIGHTS[10]).toBe(8)
    expect(BASE_WEIGHTS[11]).toBe(5)
    expect(BASE_WEIGHTS.reduce((a, b) => a + b, 0)).toBe(73)
  })

  it('ships the five documented expressions, each 12 cells long', () => {
    expect(MOUTHS.map((mouth) => mouth.name)).toEqual(['smile', 'frown', 'neutral', 'open', 'small'])
    for (const mouth of MOUTHS) expect(mouth.cells).toHaveLength(12)
  })

  it('exposes an "all expressions" template plus one per expression', () => {
    expect(Object.keys(TEMPLATES)).toEqual(
      expect.arrayContaining(['faces', 'smile', 'frown', 'neutral', 'open', 'small']),
    )
    expect(getTemplate('faces').regions[0].alternatives).toHaveLength(5)
    expect(getTemplate('smile').regions[0].alternatives).toHaveLength(1)
    expect(compileFace(getTemplate('smile')).maxScore).toBe(133)
  })

  it('throws a helpful error for an unknown template name', () => {
    expect(() => getTemplate('nope')).toThrow(/unknown template "nope".*faces/s)
  })

  it('faceWithMouths rejects unknown expression names', () => {
    expect(() => faceWithMouths('custom', ['grin'])).toThrow(/unknown mouth "grin"/)
  })

  it('parseFaceSpec round-trips a serialised template', () => {
    const parsed = parseFaceSpec(JSON.parse(JSON.stringify(getTemplate('faces'))))
    expect(compileFace(parsed).maxScore).toBe(133)
    expect(parsed.regions[0].alternatives).toHaveLength(5)
  })

  it('parseFaceSpec rejects structurally invalid input', () => {
    expect(() => parseFaceSpec(null)).toThrow(/must be an object/)
    expect(() => parseFaceSpec({ name: 'x', fixed: [], regions: [] })).toThrow(/at least one/)
    expect(() =>
      parseFaceSpec({ name: 'x', fixed: [{ index: 0, value: 2, weight: 1 }], regions: [] }),
    ).toThrow(/value must be 0 or 1/)
    expect(() =>
      parseFaceSpec({
        name: 'x',
        fixed: [{ index: 0, value: 1, weight: 0 }],
        regions: [],
      }),
    ).toThrow(/weight must be a positive integer/)
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test`
Expected: FAIL — `Failed to resolve import "../src/scoring.js"` and `"../src/templates.js"`.

- [ ] **Step 4: Append the face types to `types.ts`**

Add to `packages/core/src/types.ts`:

```ts
/** A cell whose target value is pinned. `index` is 0..31 in the left half of the grid. */
export interface FixedCell {
  index: number
  value: 0 | 1
  weight: number
}

/** One accepted shape for a region, e.g. a single mouth expression. */
export interface RegionAlternative {
  name: string
  /** Aligned 1:1 with the region's `indices`. */
  cells: (0 | 1)[]
}

/**
 * A group of cells scored as `max` over a list of alternatives. Every alternative is normalised
 * to the same `budget`, so no shape wins just for having more stroke pixels.
 */
export interface FaceRegion {
  name: string
  indices: number[]
  budget: number
  /** Relative weight of a cell that should be foreground. */
  strokeWeight: number
  /** Relative weight of a cell that should stay background. */
  bgWeight: number
  alternatives: RegionAlternative[]
}

export interface FaceSpec {
  name: string
  fixed: FixedCell[]
  regions: FaceRegion[]
}

/** Flattened, integer-only form of a FaceSpec. Built once; read millions of times. */
export interface CompiledFace {
  readonly name: string
  readonly maxScore: number
  readonly nFixed: number
  readonly fixedIndex: Uint8Array
  readonly fixedTarget: Uint8Array
  readonly fixedWeight: Int32Array
  readonly nRegions: number
  readonly regionIndexStart: Int32Array
  readonly regionLength: Int32Array
  readonly regionAltCount: Int32Array
  readonly regionCellStart: Int32Array
  readonly regionIndex: Uint8Array
  readonly regionCells: Uint8Array
  readonly regionWeights: Int32Array
  readonly regionNames: readonly string[]
  readonly regionAltNames: readonly (readonly string[])[]
}
```

- [ ] **Step 5: Write `scoring.ts`**

`packages/core/src/scoring.ts`:

```ts
import type { CompiledFace, FaceSpec, Hsl } from './types.js'

/**
 * Largest-remainder apportionment: split `budget` across `rawWeights` proportionally using
 * integers that sum to exactly `budget`.
 *
 * The spec's `Math.round(raw / total * budget)` does not do this — it yields 57 for a 3-stroke
 * mouth and 62 for a 2-stroke one, silently making some expressions worth more than others.
 */
export function apportion(rawWeights: number[], budget: number): number[] {
  if (rawWeights.length === 0) return []
  const total = rawWeights.reduce((a, b) => a + b, 0)
  if (total <= 0) throw new Error('apportion: raw weights must sum to a positive number')
  const exact = rawWeights.map((weight) => (weight * budget) / total)
  const shares = exact.map((value) => Math.floor(value))
  let remainder = budget - shares.reduce((a, b) => a + b, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < remainder; i++) shares[order[i].index] += 1
  return shares
}

export function compileFace(spec: FaceSpec): CompiledFace {
  const used = new Set<number>()
  const claim = (index: number, where: string) => {
    if (!Number.isInteger(index) || index < 0 || index > 31) {
      throw new Error(`${where}: cell index ${index} must be an integer between 0 and 31`)
    }
    if (used.has(index)) throw new Error(`${where}: cell index ${index} is used more than once`)
    used.add(index)
  }

  const fixedIndex = new Uint8Array(spec.fixed.length)
  const fixedTarget = new Uint8Array(spec.fixed.length)
  const fixedWeight = new Int32Array(spec.fixed.length)
  let maxScore = 0
  spec.fixed.forEach((cell, i) => {
    claim(cell.index, `fixed cell ${i}`)
    fixedIndex[i] = cell.index
    fixedTarget[i] = cell.value
    fixedWeight[i] = cell.weight
    maxScore += cell.weight
  })

  const regionIndexStart = new Int32Array(spec.regions.length)
  const regionLength = new Int32Array(spec.regions.length)
  const regionAltCount = new Int32Array(spec.regions.length)
  const regionCellStart = new Int32Array(spec.regions.length)
  const indices: number[] = []
  const cells: number[] = []
  const weights: number[] = []
  const regionNames: string[] = []
  const regionAltNames: string[][] = []

  spec.regions.forEach((region, r) => {
    regionIndexStart[r] = indices.length
    regionCellStart[r] = cells.length
    regionLength[r] = region.indices.length
    regionAltCount[r] = region.alternatives.length
    regionNames.push(region.name)
    regionAltNames.push(region.alternatives.map((alternative) => alternative.name))

    if (region.alternatives.length === 0) {
      throw new Error(`region "${region.name}": needs at least one alternative`)
    }
    for (const index of region.indices) claim(index, `region "${region.name}"`)
    indices.push(...region.indices)

    for (const alternative of region.alternatives) {
      if (alternative.cells.length !== region.indices.length) {
        throw new Error(
          `region "${region.name}", alternative "${alternative.name}": expected ` +
            `${region.indices.length} cells, got ${alternative.cells.length}`,
        )
      }
      const raw = alternative.cells.map((cell) =>
        cell === 1 ? region.strokeWeight : region.bgWeight,
      )
      cells.push(...alternative.cells)
      weights.push(...apportion(raw, region.budget))
    }
    maxScore += region.budget
  })

  return {
    name: spec.name,
    maxScore,
    nFixed: spec.fixed.length,
    fixedIndex,
    fixedTarget,
    fixedWeight,
    nRegions: spec.regions.length,
    regionIndexStart,
    regionLength,
    regionAltCount,
    regionCellStart,
    regionIndex: Uint8Array.from(indices),
    regionCells: Uint8Array.from(cells),
    regionWeights: Int32Array.from(weights),
    regionNames,
    regionAltNames,
  }
}

/**
 * Builds the hot-path scorer. Everything is hoisted into locals so the returned closure is
 * monomorphic: integer-only, no allocation, no division, no property lookups per candidate.
 */
export function makeScorer(face: CompiledFace): (data: Uint8Array) => number {
  const {
    nFixed,
    fixedIndex,
    fixedTarget,
    fixedWeight,
    nRegions,
    regionIndexStart,
    regionLength,
    regionAltCount,
    regionCellStart,
    regionIndex,
    regionCells,
    regionWeights,
  } = face

  return function score(data: Uint8Array): number {
    let total = 0
    for (let i = 0; i < nFixed; i++) {
      if (data[fixedIndex[i]] === fixedTarget[i]) total += fixedWeight[i]
    }
    for (let r = 0; r < nRegions; r++) {
      const indexBase = regionIndexStart[r]
      const length = regionLength[r]
      const altCount = regionAltCount[r]
      const cellBase = regionCellStart[r]
      let best = 0
      for (let a = 0; a < altCount; a++) {
        const offset = cellBase + a * length
        let got = 0
        for (let j = 0; j < length; j++) {
          if (data[regionIndex[indexBase + j]] === regionCells[offset + j]) {
            got += regionWeights[offset + j]
          }
        }
        if (got > best) best = got
      }
      total += best
    }
    return total
  }
}

/** Off the hot path: which alternative won in each region, plus the total score. */
export function describeMatch(
  face: CompiledFace,
  data: Uint8Array,
): { score: number; regions: Record<string, string> } {
  let total = 0
  for (let i = 0; i < face.nFixed; i++) {
    if (data[face.fixedIndex[i]] === face.fixedTarget[i]) total += face.fixedWeight[i]
  }
  const regions: Record<string, string> = {}
  for (let r = 0; r < face.nRegions; r++) {
    const indexBase = face.regionIndexStart[r]
    const length = face.regionLength[r]
    const cellBase = face.regionCellStart[r]
    let best = -1
    let bestAlt = 0
    for (let a = 0; a < face.regionAltCount[r]; a++) {
      const offset = cellBase + a * length
      let got = 0
      for (let j = 0; j < length; j++) {
        if (data[face.regionIndex[indexBase + j]] === face.regionCells[offset + j]) {
          got += face.regionWeights[offset + j]
        }
      }
      if (got > best) {
        best = got
        bestAlt = a
      }
    }
    total += best
    regions[face.regionNames[r]] = face.regionAltNames[r][bestAlt]
  }
  return { score: total, regions }
}

/** True when the grid never uses blo's spot colour, i.e. the blockie renders in two colours. */
export function isTwoColor(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) if (data[i] === 2) return false
  return true
}

/** blo emits h 0-360, s 0-100, l 0-100. Returns r/g/b in 0-255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const saturation = s / 100
  const lightness = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = saturation * Math.min(lightness, 1 - lightness)
  const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** Euclidean RGB distance between two HSL colours. 0 = identical, ~441.7 = black vs white. */
export function colorContrast(a: Hsl, b: Hsl): number {
  const [r1, g1, b1] = hslToRgb(a[0], a[1], a[2])
  const [r2, g2, b2] = hslToRgb(b[0], b[1], b[2])
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}
```

- [ ] **Step 6: Write `templates.ts`**

`packages/core/src/templates.ts`:

```ts
import type { FaceSpec, FaceRegion, FixedCell, RegionAlternative } from './types.js'

export const MOUTH_BUDGET = 60
export const MOUTH_STROKE_WEIGHT = 3
export const MOUTH_BG_WEIGHT = 1

/** Rows 0-4, index = row * 4 + col. 1 = the eye pixel (mirrored to column 5), 0 = background. */
export const BASE_TARGET: readonly (0 | 1)[] = [
  0, 0, 0, 0,
  0, 0, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
]

/** 8 = the eye, 5 = cells hugging it (isolation, incl. col 3 to keep the two eyes apart), 3 = plain background. */
export const BASE_WEIGHTS: readonly number[] = [
  3, 3, 3, 3,
  3, 3, 5, 3,
  3, 5, 8, 5,
  3, 3, 5, 3,
  3, 3, 3, 3,
]

/** Rows 5-7 of the left half: r5c0..r5c3, r6c0..r6c3, r7c0..r7c3. */
export const MOUTH_INDICES: readonly number[] = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]

export const MOUTHS: readonly RegionAlternative[] = [
  // r5: c0 c1 c2 c3   r6: c0 c1 c2 c3   r7: c0 c1 c2 c3
  { name: 'smile', cells: [0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, // corners up, dips centre
  { name: 'frown', cells: [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] }, // corners down
  { name: 'neutral', cells: [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0] }, // straight line
  { name: 'open', cells: [0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1] }, // rounded "o" / surprised
  { name: 'small', cells: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0] }, // little mouth
]

function baseFixedCells(): FixedCell[] {
  return BASE_TARGET.map((value, index) => ({ index, value, weight: BASE_WEIGHTS[index] }))
}

function mouthRegion(alternatives: RegionAlternative[]): FaceRegion {
  return {
    name: 'mouth',
    indices: [...MOUTH_INDICES],
    budget: MOUTH_BUDGET,
    strokeWeight: MOUTH_STROKE_WEIGHT,
    bgWeight: MOUTH_BG_WEIGHT,
    alternatives,
  }
}

/** Builds a face with fixed eyes and the named subset of expressions accepted for the mouth. */
export function faceWithMouths(name: string, mouthNames: string[]): FaceSpec {
  const alternatives = mouthNames.map((mouthName) => {
    const mouth = MOUTHS.find((candidate) => candidate.name === mouthName)
    if (!mouth) {
      throw new Error(
        `unknown mouth "${mouthName}"; available: ${MOUTHS.map((m) => m.name).join(', ')}`,
      )
    }
    return { name: mouth.name, cells: [...mouth.cells] }
  })
  return { name, fixed: baseFixedCells(), regions: [mouthRegion(alternatives)] }
}

export const TEMPLATES: Record<string, FaceSpec> = {
  faces: faceWithMouths(
    'faces',
    MOUTHS.map((mouth) => mouth.name),
  ),
  ...Object.fromEntries(
    MOUTHS.map((mouth) => [mouth.name, faceWithMouths(mouth.name, [mouth.name])]),
  ),
}

export function getTemplate(name: string): FaceSpec {
  const template = TEMPLATES[name]
  if (!template) {
    throw new Error(`unknown template "${name}"; available: ${Object.keys(TEMPLATES).join(', ')}`)
  }
  return template
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value as number
}

/** Validates untrusted JSON (a `--target file.json`, or a future web designer export). */
export function parseFaceSpec(input: unknown): FaceSpec {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('FaceSpec must be an object')
  }
  const raw = input as Record<string, unknown>
  const name = typeof raw.name === 'string' && raw.name ? raw.name : 'custom'

  const fixedInput = Array.isArray(raw.fixed) ? raw.fixed : []
  const fixed: FixedCell[] = fixedInput.map((entry, i) => {
    const cell = entry as Record<string, unknown>
    const index = cell.index
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 31) {
      throw new Error(`fixed[${i}].index must be an integer between 0 and 31`)
    }
    if (cell.value !== 0 && cell.value !== 1) {
      throw new Error(`fixed[${i}].value must be 0 or 1`)
    }
    return {
      index: index as number,
      value: cell.value as 0 | 1,
      weight: requirePositiveInteger(cell.weight, `fixed[${i}].weight`),
    }
  })

  const regionsInput = Array.isArray(raw.regions) ? raw.regions : []
  const regions: FaceRegion[] = regionsInput.map((entry, r) => {
    const region = entry as Record<string, unknown>
    const label = `regions[${r}]`
    if (!Array.isArray(region.indices) || region.indices.length === 0) {
      throw new Error(`${label}.indices must be a non-empty array`)
    }
    for (const index of region.indices) {
      if (!Number.isInteger(index) || index < 0 || index > 31) {
        throw new Error(`${label}.indices must all be integers between 0 and 31`)
      }
    }
    if (!Array.isArray(region.alternatives) || region.alternatives.length === 0) {
      throw new Error(`${label}.alternatives must contain at least one alternative`)
    }
    const alternatives: RegionAlternative[] = region.alternatives.map((altEntry, a) => {
      const alternative = altEntry as Record<string, unknown>
      if (!Array.isArray(alternative.cells)) {
        throw new Error(`${label}.alternatives[${a}].cells must be an array`)
      }
      for (const cell of alternative.cells) {
        if (cell !== 0 && cell !== 1) {
          throw new Error(`${label}.alternatives[${a}].cells value must be 0 or 1`)
        }
      }
      return {
        name: typeof alternative.name === 'string' ? alternative.name : `alt${a}`,
        cells: alternative.cells as (0 | 1)[],
      }
    })
    return {
      name: typeof region.name === 'string' ? region.name : `region${r}`,
      indices: region.indices as number[],
      budget: requirePositiveInteger(region.budget, `${label}.budget`),
      strokeWeight: requirePositiveInteger(region.strokeWeight, `${label}.strokeWeight`),
      bgWeight: requirePositiveInteger(region.bgWeight, `${label}.bgWeight`),
      alternatives,
    }
  })

  if (fixed.length === 0 && regions.length === 0) {
    throw new Error('FaceSpec must define at least one fixed cell or region')
  }
  return { name, fixed, regions }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test`
Expected: PASS — all scoring and template tests green, including `maxScore === 133` and every expression peaking at exactly 133.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): compile face templates into an allocation-free integer scorer"
```

---

### Task 5: Leaderboard, mining loop, and the public `core` surface

**Files:**
- Create: `packages/core/src/miner.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/miner.test.ts`, `packages/core/test/purity.test.ts`

**Interfaces:**
- Consumes: `bloDataInto`, `bloImage` (Task 1); `Keccak256` (Task 2); `createAddressDeriver`, `SafeConstants` (Task 3); `compileFace`, `makeScorer`, `describeMatch`, `isTwoColor`, `colorContrast`, `CompiledFace` (Task 4).
- Produces:
  - `Candidate { saltNonce: string; address: string; score: number; maxScore: number; twoColor: boolean; contrast: number; regions: Record<string, string> }`
  - `compareCandidates(a: Candidate, b: Candidate): number`
  - `class Leaderboard { constructor(capacity: number); readonly capacity: number; get threshold(): number; offer(candidate: Candidate): boolean; merge(candidates: Candidate[]): void; entries(): Candidate[] }`
  - `MineOptions { start: number; count: number; keep?: number; chunkSize?: number; onProgress?: (scanned: number, best: Candidate[]) => boolean | void }`
  - `MineResult { scanned: number; candidates: Candidate[] }`
  - `createMiner(constants: SafeConstants, face: CompiledFace, keccak256: Keccak256): { mine(options: MineOptions): MineResult }`
  - `packages/core/src/index.ts` re-exports every public symbol from Tasks 1–5.

- [ ] **Step 1: Write the failing miner test**

`packages/core/test/miner.test.ts` — synthetic constants keep this offline and deterministic. Assertions are invariants and cross-checks, never hardcoded scores, because the exact winner depends on keccak output.

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { bloData } from '../src/blo.js'
import { createAddressDeriver } from '../src/address.js'
import { hexToBytes } from '../src/hex.js'
import { createKeccak256, type Keccak256 } from '../src/keccak.js'
import { Leaderboard, compareCandidates, createMiner, type Candidate } from '../src/miner.js'
import { compileFace, makeScorer } from '../src/scoring.js'
import { getTemplate } from '../src/templates.js'

const CONSTANTS = {
  initializerHash: hexToBytes('0x' + '11'.repeat(32)),
  factory: hexToBytes('0x' + '22'.repeat(20)),
  initCodeHash: hexToBytes('0x' + '33'.repeat(32)),
}
const FACE = compileFace(getTemplate('faces'))

let keccak256: Keccak256

beforeAll(async () => {
  keccak256 = await createKeccak256()
})

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    saltNonce: '1',
    address: '0x' + '00'.repeat(20),
    score: 100,
    maxScore: 133,
    twoColor: true,
    contrast: 100,
    regions: { mouth: 'smile' },
    ...overrides,
  }
}

describe('Leaderboard', () => {
  it('ranks by score desc, then two-colour first, then contrast desc', () => {
    const board = new Leaderboard(5)
    board.offer(candidate({ address: '0xa', score: 120, twoColor: true, contrast: 50 }))
    board.offer(candidate({ address: '0xb', score: 131, twoColor: false, contrast: 300 }))
    board.offer(candidate({ address: '0xc', score: 131, twoColor: true, contrast: 100 }))
    board.offer(candidate({ address: '0xd', score: 131, twoColor: true, contrast: 250 }))
    expect(board.entries().map((entry) => entry.address)).toEqual(['0xd', '0xc', '0xb', '0xa'])
  })

  it('never exceeds capacity and reports the score to beat', () => {
    const board = new Leaderboard(3)
    expect(board.threshold).toBe(-1)
    for (const score of [100, 110, 120, 130]) {
      board.offer(candidate({ address: `0x${score}`, score }))
    }
    expect(board.entries()).toHaveLength(3)
    expect(board.entries().map((entry) => entry.score)).toEqual([130, 120, 110])
    expect(board.threshold).toBe(110)
    expect(board.offer(candidate({ address: '0xlow', score: 100 }))).toBe(false)
  })

  it('dedupes by address', () => {
    const board = new Leaderboard(5)
    expect(board.offer(candidate({ address: '0xsame', score: 120 }))).toBe(true)
    expect(board.offer(candidate({ address: '0xsame', score: 120 }))).toBe(false)
    expect(board.entries()).toHaveLength(1)
  })

  it('merges another run and re-ranks', () => {
    const board = new Leaderboard(3)
    board.offer(candidate({ address: '0xa', score: 100 }))
    board.merge([candidate({ address: '0xb', score: 130 }), candidate({ address: '0xa', score: 100 })])
    expect(board.entries().map((entry) => entry.address)).toEqual(['0xb', '0xa'])
  })

  it('compareCandidates is a total order with a stable saltNonce tiebreak', () => {
    const a = candidate({ address: '0xa', saltNonce: '1' })
    const b = candidate({ address: '0xb', saltNonce: '2' })
    expect(compareCandidates(a, b)).toBeLessThan(0)
    expect(compareCandidates(b, a)).toBeGreaterThan(0)
    expect(compareCandidates(a, a)).toBe(0)
  })
})

describe('createMiner', () => {
  it('agrees with a naive single-nonce loop over the same range', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const result = miner.mine({ start: 0, count: 5000, keep: 5 })

    const deriver = createAddressDeriver(CONSTANTS, keccak256)
    const score = makeScorer(FACE)
    let bestScore = -1
    let bestNonce = -1
    for (let nonce = 0; nonce < 5000; nonce++) {
      const value = score(bloData(deriver.derive(nonce)))
      if (value > bestScore) {
        bestScore = value
        bestNonce = nonce
      }
    }

    expect(result.scanned).toBe(5000)
    expect(result.candidates[0].score).toBe(bestScore)
    expect(result.candidates[0].saltNonce).toBe(String(bestNonce))
    expect(result.candidates[0].address).toBe(deriver.derive(bestNonce))
  })

  it('is deterministic and honours keep', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const first = miner.mine({ start: 1000, count: 3000, keep: 7 })
    const second = miner.mine({ start: 1000, count: 3000, keep: 7 })
    expect(first.candidates).toEqual(second.candidates)
    expect(first.candidates.length).toBeLessThanOrEqual(7)
  })

  it('produces self-consistent candidate metadata', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const score = makeScorer(FACE)
    for (const entry of miner.mine({ start: 0, count: 3000, keep: 10 }).candidates) {
      expect(entry.address).toMatch(/^0x[0-9a-f]{40}$/)
      expect(entry.maxScore).toBe(133)
      expect(entry.score).toBe(score(bloData(entry.address)))
      expect(entry.score).toBeLessThanOrEqual(entry.maxScore)
      expect(Object.keys(entry.regions)).toEqual(['mouth'])
    }
  })

  it('reports cumulative progress and stops when onProgress returns false', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const seen: number[] = []
    const result = miner.mine({
      start: 0,
      count: 10_000,
      chunkSize: 1000,
      onProgress: (scanned) => {
        seen.push(scanned)
        return seen.length < 3
      },
    })
    expect(seen).toEqual([1000, 2000, 3000])
    expect(result.scanned).toBe(3000)
  })

  it('covers exactly the requested range', () => {
    const miner = createMiner(CONSTANTS, FACE, keccak256)
    const whole = miner.mine({ start: 0, count: 4000, keep: 3 })
    const firstHalf = miner.mine({ start: 0, count: 2000, keep: 3 })
    const secondHalf = miner.mine({ start: 2000, count: 2000, keep: 3 })
    const board = new Leaderboard(3)
    board.merge(firstHalf.candidates)
    board.merge(secondHalf.candidates)
    expect(board.entries()).toEqual(whole.candidates)
  })
})
```

- [ ] **Step 2: Write the failing purity test**

`packages/core/test/purity.test.ts` — the `web` package will import these files into a browser bundle, so this guard has to exist before anything else grows.

```ts
import { readFileSync, readdirSync } from 'node:fs'
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test`
Expected: FAIL — `Failed to resolve import "../src/miner.js"`.

- [ ] **Step 4: Write `miner.ts`**

`packages/core/src/miner.ts`:

```ts
import { createAddressDeriver, type SafeConstants } from './address.js'
import { bloDataInto, bloImage } from './blo.js'
import type { Keccak256 } from './keccak.js'
import { colorContrast, describeMatch, isTwoColor, makeScorer } from './scoring.js'
import type { CompiledFace } from './types.js'

export interface Candidate {
  /** Decimal string: a saltNonce is a uint256 and may exceed 2^53. */
  saltNonce: string
  address: string
  score: number
  maxScore: number
  twoColor: boolean
  contrast: number
  /** Winning alternative per region, e.g. `{ mouth: 'smile' }`. */
  regions: Record<string, string>
}

/** Ranking from spec §5.6: score desc, two-colour first, contrast desc, then saltNonce for stability. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.twoColor !== b.twoColor) return a.twoColor ? -1 : 1
  if (a.contrast !== b.contrast) return b.contrast - a.contrast
  if (a.saltNonce === b.saltNonce) return 0
  return a.saltNonce.length - b.saltNonce.length || (a.saltNonce < b.saltNonce ? -1 : 1)
}

export class Leaderboard {
  readonly capacity: number
  private items: Candidate[] = []
  private seen = new Set<string>()

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Leaderboard capacity must be a positive integer, got ${capacity}`)
    }
    this.capacity = capacity
  }

  /** Score a candidate must reach to be worth building. -1 until the board is full. */
  get threshold(): number {
    return this.items.length < this.capacity ? -1 : this.items[this.items.length - 1].score
  }

  offer(candidate: Candidate): boolean {
    if (this.seen.has(candidate.address)) return false
    if (this.items.length >= this.capacity && candidate.score < this.threshold) return false
    this.seen.add(candidate.address)
    this.items.push(candidate)
    this.items.sort(compareCandidates)
    if (this.items.length > this.capacity) this.items.length = this.capacity
    return true
  }

  merge(candidates: Candidate[]): void {
    for (const candidate of candidates) this.offer(candidate)
  }

  entries(): Candidate[] {
    return this.items.slice()
  }
}

export interface MineOptions {
  start: number
  count: number
  /** Leaderboard size. Default 20. */
  keep?: number
  /** Iterations between onProgress callbacks. Default 250_000. */
  chunkSize?: number
  /** Return false to stop early. `scanned` is cumulative for this call. */
  onProgress?: (scanned: number, best: Candidate[]) => boolean | void
}

export interface MineResult {
  scanned: number
  candidates: Candidate[]
}

export function createMiner(
  constants: SafeConstants,
  face: CompiledFace,
  keccak256: Keccak256,
): { mine(options: MineOptions): MineResult } {
  const deriver = createAddressDeriver(constants, keccak256)
  const score = makeScorer(face)

  /** Off the hot path — only runs when a candidate reaches the leaderboard. */
  function buildCandidate(nonce: number, address: string, value: number): Candidate {
    const { data, colors } = bloImage(address)
    return {
      saltNonce: String(nonce),
      address,
      score: value,
      maxScore: face.maxScore,
      twoColor: isTwoColor(data),
      contrast: Math.round(colorContrast(colors[0], colors[1])),
      regions: describeMatch(face, data).regions,
    }
  }

  return {
    mine(options: MineOptions): MineResult {
      const board = new Leaderboard(options.keep ?? 20)
      const chunkSize = options.chunkSize ?? 250_000
      // Allocated once for the whole run; the hot loop allocates nothing else.
      const data = new Uint8Array(32)
      const rseed = new Uint32Array(4)
      let scanned = 0

      while (scanned < options.count) {
        const from = options.start + scanned
        const to = from + Math.min(chunkSize, options.count - scanned)
        for (let nonce = from; nonce < to; nonce++) {
          const address = deriver.derive(nonce)
          bloDataInto(address, data, rseed)
          const value = score(data)
          if (value >= board.threshold) board.offer(buildCandidate(nonce, address, value))
        }
        scanned = to - options.start
        if (options.onProgress?.(scanned, board.entries()) === false) break
      }

      return { scanned, candidates: board.entries() }
    },
  }
}
```

- [ ] **Step 5: Write `index.ts`**

`packages/core/src/index.ts`:

```ts
export { createAddressDeriver, type AddressDeriver, type SafeConstants } from './address.js'
export {
  bloData,
  bloDataInto,
  bloImage,
  bloSvg,
  nextRandom,
  randSeed,
  randomColor,
  seedInto,
} from './blo.js'
export { bytesToHex, hexToBytes } from './hex.js'
export { createKeccak256, type Keccak256 } from './keccak.js'
export {
  Leaderboard,
  compareCandidates,
  createMiner,
  type Candidate,
  type MineOptions,
  type MineResult,
} from './miner.js'
export {
  apportion,
  colorContrast,
  compileFace,
  describeMatch,
  hslToRgb,
  isTwoColor,
  makeScorer,
} from './scoring.js'
export {
  BASE_TARGET,
  BASE_WEIGHTS,
  MOUTHS,
  MOUTH_BG_WEIGHT,
  MOUTH_BUDGET,
  MOUTH_INDICES,
  MOUTH_STROKE_WEIGHT,
  TEMPLATES,
  faceWithMouths,
  getTemplate,
  parseFaceSpec,
} from './templates.js'
export type {
  BloImage,
  CompiledFace,
  FaceRegion,
  FaceSpec,
  FixedCell,
  Hsl,
  Palette,
  RegionAlternative,
} from './types.js'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test && mise exec -- pnpm --filter @safe-vanity-blockie/core build`
Expected: PASS on all core tests, and `tsc` emits `packages/core/dist/index.js` + `.d.ts` with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add the leaderboard, mining loop and public API surface"
```

---

### Task 6: `miner` package + Safe constants from protocol-kit

The CLI package is named `safe-vanity-blockie` (not `@safe-vanity-blockie/miner`) so that `npx safe-vanity-blockie` works as promised in spec §2. That is why the workspace root is named `safe-vanity-blockie-workspace`.

**Files:**
- Create: `packages/miner/package.json`, `packages/miner/tsconfig.json`, `packages/miner/vitest.config.ts`
- Create: `packages/miner/src/setup.ts`
- Test: `packages/miner/test/setup.network.test.ts`

**Interfaces:**
- Consumes: `SafeConstants`, `hexToBytes`, `createKeccak256`, `createAddressDeriver` from `@safe-vanity-blockie/core`.
- Produces:
  - `SetupInput { rpcUrl: string; owners: string[]; threshold: number; safeVersion: SafeVersion; isL1SafeSingleton?: boolean }`
  - `SafeSetup { chainId: bigint; constants: SafeConstants; constantsHex: { initializerHash: Hex; factory: Hex; initCodeHash: Hex }; safeProvider: SafeProvider; safeAccountConfig: { owners: string[]; threshold: number }; safeVersion: SafeVersion; isL1SafeSingleton?: boolean }`
  - `loadSafeConstants(input: SetupInput): Promise<SafeSetup>`
  - `verifyWithProtocolKit(setup: SafeSetup, saltNonce: string, address: string): Promise<void>` — throws on mismatch
  - `ZKSYNC_CHAIN_IDS: ReadonlySet<bigint>`

- [ ] **Step 1: Create the package files**

`packages/miner/package.json`:

```json
{
  "name": "safe-vanity-blockie",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "description": "Brute-force a Safe saltNonce so the Safe address renders a two-color face as a blo identicon",
  "bin": { "safe-vanity-blockie": "./dist/cli.js" },
  "main": "./dist/cli.js",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:network": "vitest run --config vitest.network.config.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@safe-global/protocol-kit": "^8.0.5",
    "@safe-global/types-kit": "^4.0.1",
    "@safe-vanity-blockie/core": "workspace:*",
    "viem": "^2.55.11"
  }
}
```

`packages/miner/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/miner/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.network.test.ts', '**/node_modules/**'],
    testTimeout: 60_000,
  },
})
```

`packages/miner/vitest.network.config.ts` — network tests are opt-in so `pnpm test` never depends on a public RPC:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.network.test.ts'],
    testTimeout: 120_000,
  },
})
```

Then:

```bash
mise exec -- pnpm install
```

- [ ] **Step 2: Write the failing test**

`packages/miner/test/setup.network.test.ts` — this is the check spec §3.2 calls out as having caught real bugs: our two-keccak fast path must agree with protocol-kit's own `predictSafeAddress`.

```ts
import { createAddressDeriver, createKeccak256 } from '@safe-vanity-blockie/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadSafeConstants, verifyWithProtocolKit, type SafeSetup } from '../src/setup.js'

const RPC_URL = process.env.TEST_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'
const OWNERS = ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']

let setup: SafeSetup

beforeAll(async () => {
  setup = await loadSafeConstants({
    rpcUrl: RPC_URL,
    owners: OWNERS,
    threshold: 1,
    safeVersion: '1.4.1',
  })
}, 120_000)

describe('loadSafeConstants', () => {
  it('reads the chain id and returns correctly sized constants', () => {
    expect(setup.chainId).toBe(1n)
    expect(setup.constants.initializerHash).toHaveLength(32)
    expect(setup.constants.factory).toHaveLength(20)
    expect(setup.constants.initCodeHash).toHaveLength(32)
    expect(setup.constantsHex.factory).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('derives the same address as protocol-kit predictSafeAddress', async () => {
    const keccak256 = await createKeccak256()
    const deriver = createAddressDeriver(setup.constants, keccak256)
    for (const saltNonce of [0, 1, 12345, 5254976178]) {
      await expect(
        verifyWithProtocolKit(setup, String(saltNonce), deriver.derive(saltNonce)),
      ).resolves.toBeUndefined()
    }
  })

  it('throws a clear mismatch error when the address is wrong', async () => {
    await expect(
      verifyWithProtocolKit(setup, '1', '0x' + '00'.repeat(20)),
    ).rejects.toThrow(/self-check failed/)
  })

  it('produces the same constants for the same config on a second call', async () => {
    const again = await loadSafeConstants({
      rpcUrl: RPC_URL,
      owners: OWNERS,
      threshold: 1,
      safeVersion: '1.4.1',
    })
    expect(again.constantsHex).toEqual(setup.constantsHex)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `mise exec -- pnpm --filter safe-vanity-blockie test:network`
Expected: FAIL — `Failed to resolve import "../src/setup.js"`.

- [ ] **Step 4: Write `setup.ts`**

`packages/miner/src/setup.ts` — `isL1SafeSingleton` must be passed identically to `getSafeContract` and `predictSafeAddress`, otherwise the singleton (and therefore the address) silently differs between the fast path and the self-check.

```ts
import {
  SafeProvider,
  encodeSetupCallData,
  getSafeContract,
  getSafeProxyFactoryContract,
  predictSafeAddress,
} from '@safe-global/protocol-kit'
import type { SafeVersion } from '@safe-global/types-kit'
import { hexToBytes, type SafeConstants } from '@safe-vanity-blockie/core'
import { concat, keccak256, type Hex } from 'viem'

export interface SetupInput {
  rpcUrl: string
  owners: string[]
  threshold: number
  safeVersion: SafeVersion
  /** Force the L1 singleton on an L2 chain. Must match what deployment will use. */
  isL1SafeSingleton?: boolean
}

export interface SafeSetup {
  chainId: bigint
  constants: SafeConstants
  constantsHex: { initializerHash: Hex; factory: Hex; initCodeHash: Hex }
  safeProvider: SafeProvider
  safeAccountConfig: { owners: string[]; threshold: number }
  safeVersion: SafeVersion
  isL1SafeSingleton?: boolean
}

/** zkSync Era and friends derive CREATE2 addresses with a different formula (spec §3.1). */
export const ZKSYNC_CHAIN_IDS: ReadonlySet<bigint> = new Set([324n, 300n, 302n])

/**
 * Reads chainId and the three constants that stay fixed for a given
 * (owners, threshold, safeVersion). Runs once on the main thread; workers get plain hex.
 */
export async function loadSafeConstants(input: SetupInput): Promise<SafeSetup> {
  const safeProvider = new SafeProvider({ provider: input.rpcUrl })
  const chainId = await safeProvider.getChainId()

  if (ZKSYNC_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `chain ${chainId} is zkSync-based and derives contract addresses with a different formula; ` +
        'this tool would predict the wrong address. Use a standard EVM chain.',
    )
  }

  const safeAccountConfig = { owners: input.owners, threshold: input.threshold }

  const factoryContract = await getSafeProxyFactoryContract({
    safeProvider,
    safeVersion: input.safeVersion,
  })
  const safeContract = await getSafeContract({
    safeProvider,
    safeVersion: input.safeVersion,
    isL1SafeSingleton: input.isL1SafeSingleton,
  })

  const initializer = await encodeSetupCallData({
    safeProvider,
    safeAccountConfig,
    safeContract,
    customSafeVersion: input.safeVersion,
  })
  const initializerHash = keccak256(initializer as Hex)

  // proxyCreationCode() returns a single-element tuple, not a bare string.
  const [proxyCreationCode] = await factoryContract.proxyCreationCode()
  const encodedSingleton = safeProvider.encodeParameters('address', [safeContract.getAddress()])
  const initCodeHash = keccak256(concat([proxyCreationCode as Hex, encodedSingleton as Hex]))
  const factory = factoryContract.getAddress() as Hex

  return {
    chainId,
    constants: {
      initializerHash: hexToBytes(initializerHash),
      factory: hexToBytes(factory),
      initCodeHash: hexToBytes(initCodeHash),
    },
    constantsHex: { initializerHash, factory, initCodeHash },
    safeProvider,
    safeAccountConfig,
    safeVersion: input.safeVersion,
    isL1SafeSingleton: input.isL1SafeSingleton,
  }
}

/** Cross-checks one mined result against protocol-kit. Run this every session (spec §11). */
export async function verifyWithProtocolKit(
  setup: SafeSetup,
  saltNonce: string,
  address: string,
): Promise<void> {
  const predicted = await predictSafeAddress({
    safeProvider: setup.safeProvider,
    chainId: setup.chainId,
    safeAccountConfig: setup.safeAccountConfig,
    safeDeploymentConfig: { saltNonce, safeVersion: setup.safeVersion },
    isL1SafeSingleton: setup.isL1SafeSingleton,
  })
  if (predicted.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      `self-check failed for saltNonce ${saltNonce}: fast derivation gave ${address}, ` +
        `protocol-kit predictSafeAddress gave ${predicted.toLowerCase()}`,
    )
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `mise exec -- pnpm -r build && mise exec -- pnpm --filter safe-vanity-blockie test:network`
Expected: PASS — 4 tests, including the `predictSafeAddress` agreement over four nonces.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(miner): read Safe CREATE2 constants via protocol-kit with a predictSafeAddress self-check"
```

---

### Task 7: Worker threads and the fan-out pool

**Files:**
- Create: `packages/miner/src/worker.ts`, `packages/miner/src/pool.ts`
- Test: `packages/miner/test/pool.test.ts`

**Interfaces:**
- Consumes: `createKeccak256`, `createMiner`, `compileFace`, `parseFaceSpec`, `hexToBytes`, `Leaderboard`, `Candidate`, `FaceSpec` from `@safe-vanity-blockie/core`.
- Produces:
  - `WORKER_BLOCK = 1_000_000_000_000`
  - `WorkerInput { constantsHex: { initializerHash: string; factory: string; initCodeHash: string }; faceSpec: FaceSpec; start: number; count: number; keep: number; chunkSize: number; stopFlag: SharedArrayBuffer }`
  - `WorkerMessage = { type: 'progress'; scanned: number; candidates: Candidate[] } | { type: 'done'; scanned: number; candidates: Candidate[] } | { type: 'error'; message: string }`
  - `PoolOptions { constantsHex; faceSpec: FaceSpec; start: number; workers: number; perWorker: number; keep: number; chunkSize?: number; workerUrl?: URL; onProgress?: (progress: PoolProgress) => void }`
  - `PoolProgress { scanned: number; elapsedMs: number; rate: number; best: Candidate[] }`
  - `PoolResult { scanned: number; scannedPerWorker: number[]; candidates: Candidate[]; nextStart: number }`
  - `createPool(options: PoolOptions): { run(): Promise<PoolResult>; stop(): void }`

- [ ] **Step 1: Write the failing test**

`packages/miner/test/pool.test.ts` — because the pool assigns worker `w` the contiguous block `[start + w*perWorker, +perWorker)`, four workers over 25 000 nonces each must reproduce a single-threaded run over `[0, 100 000)` exactly. That equality is the whole correctness argument for the fan-out.

```ts
import {
  compileFace,
  createKeccak256,
  createMiner,
  getTemplate,
  hexToBytes,
} from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { createPool } from '../src/pool.js'

const CONSTANTS_HEX = {
  initializerHash: '0x' + '11'.repeat(32),
  factory: '0x' + '22'.repeat(20),
  initCodeHash: '0x' + '33'.repeat(32),
}
const CONSTANTS = {
  initializerHash: hexToBytes(CONSTANTS_HEX.initializerHash),
  factory: hexToBytes(CONSTANTS_HEX.factory),
  initCodeHash: hexToBytes(CONSTANTS_HEX.initCodeHash),
}
const FACE_SPEC = getTemplate('faces')

describe('createPool', () => {
  it('reproduces a single-threaded run over the same contiguous range', async () => {
    const pool = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      workers: 4,
      perWorker: 25_000,
      keep: 10,
      chunkSize: 5000,
    })
    const result = await pool.run()

    const keccak256 = await createKeccak256()
    const single = createMiner(CONSTANTS, compileFace(FACE_SPEC), keccak256).mine({
      start: 0,
      count: 100_000,
      keep: 10,
    })

    expect(result.scanned).toBe(100_000)
    expect(result.scannedPerWorker).toEqual([25_000, 25_000, 25_000, 25_000])
    expect(result.candidates).toEqual(single.candidates)
    expect(result.nextStart).toBe(25_000)
  })

  it('reports aggregate progress while running', async () => {
    const snapshots: number[] = []
    const pool = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      workers: 2,
      perWorker: 20_000,
      keep: 5,
      chunkSize: 2000,
      onProgress: (progress) => {
        snapshots.push(progress.scanned)
        expect(progress.rate).toBeGreaterThanOrEqual(0)
      },
    })
    await pool.run()
    expect(snapshots.length).toBeGreaterThan(0)
    expect(Math.max(...snapshots)).toBeLessThanOrEqual(40_000)
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBeGreaterThanOrEqual(snapshots[i - 1])
    }
  })

  it('stops early and still returns the best found so far', async () => {
    const pool = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      workers: 2,
      perWorker: 50_000_000,
      keep: 5,
      chunkSize: 5000,
      onProgress: () => pool.stop(),
    })
    const result = await pool.run()
    expect(result.scanned).toBeGreaterThan(0)
    expect(result.scanned).toBeLessThan(100_000_000)
    expect(result.candidates.length).toBeGreaterThan(0)
  })

  it('keeps worker ranges disjoint so nextStart can resume without rescanning', async () => {
    const pool = createPool({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 500,
      workers: 3,
      perWorker: 1000,
      keep: 20,
      chunkSize: 500,
    })
    const result = await pool.run()
    const nonces = result.candidates.map((candidate) => Number(candidate.saltNonce))
    expect(new Set(nonces).size).toBe(nonces.length)
    for (const nonce of nonces) {
      expect(nonce).toBeGreaterThanOrEqual(500)
      expect(nonce).toBeLessThan(500 + 3 * 1000)
    }
    expect(result.nextStart).toBe(1500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- pnpm --filter safe-vanity-blockie test`
Expected: FAIL — `Failed to resolve import "../src/pool.js"`.

- [ ] **Step 3: Write `worker.ts`**

`packages/miner/src/worker.ts` — imports `@safe-vanity-blockie/core` and nothing else heavy: no protocol-kit, no viem. The stop signal travels through a `SharedArrayBuffer` because the mining loop is synchronous and would never drain a `postMessage` queue.

```ts
import { parentPort, workerData } from 'node:worker_threads'
import {
  compileFace,
  createKeccak256,
  createMiner,
  hexToBytes,
  type Candidate,
  type FaceSpec,
} from '@safe-vanity-blockie/core'

export interface WorkerInput {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  start: number
  count: number
  keep: number
  chunkSize: number
  /** Int32Array view, slot 0: non-zero means stop at the next chunk boundary. */
  stopFlag: SharedArrayBuffer
}

export type WorkerMessage =
  | { type: 'progress'; scanned: number; candidates: Candidate[] }
  | { type: 'done'; scanned: number; candidates: Candidate[] }
  | { type: 'error'; message: string }

async function main(): Promise<void> {
  const input = workerData as WorkerInput
  const port = parentPort
  if (!port) throw new Error('worker.ts must be run as a worker thread')

  const keccak256 = await createKeccak256()
  const face = compileFace(input.faceSpec)
  const constants = {
    initializerHash: hexToBytes(input.constantsHex.initializerHash),
    factory: hexToBytes(input.constantsHex.factory),
    initCodeHash: hexToBytes(input.constantsHex.initCodeHash),
  }
  const stop = new Int32Array(input.stopFlag)

  const result = createMiner(constants, face, keccak256).mine({
    start: input.start,
    count: input.count,
    keep: input.keep,
    chunkSize: input.chunkSize,
    onProgress: (scanned, best) => {
      port.postMessage({ type: 'progress', scanned, candidates: best } satisfies WorkerMessage)
      return Atomics.load(stop, 0) === 0
    },
  })

  port.postMessage({
    type: 'done',
    scanned: result.scanned,
    candidates: result.candidates,
  } satisfies WorkerMessage)
}

main().catch((error: unknown) => {
  parentPort?.postMessage({
    type: 'error',
    message: error instanceof Error ? (error.stack ?? error.message) : String(error),
  } satisfies WorkerMessage)
  process.exitCode = 1
})
```

- [ ] **Step 4: Write `pool.ts`**

`packages/miner/src/pool.ts`:

```ts
import { Worker } from 'node:worker_threads'
import { Leaderboard, type Candidate, type FaceSpec } from '@safe-vanity-blockie/core'
import type { WorkerInput, WorkerMessage } from './worker.js'

/**
 * Block size handed to each worker when the run is unbounded. Large enough that a worker never
 * reaches the next worker's territory (at 3M nonces/s that is ~4 days per worker).
 */
export const WORKER_BLOCK = 1_000_000_000_000

export interface PoolProgress {
  scanned: number
  elapsedMs: number
  /** Nonces per second, aggregated across workers. */
  rate: number
  best: Candidate[]
}

export interface PoolOptions {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  start: number
  workers: number
  /** Nonces assigned to each worker; also the stride between worker ranges. */
  perWorker: number
  keep: number
  chunkSize?: number
  workerUrl?: URL
  onProgress?: (progress: PoolProgress) => void
}

export interface PoolResult {
  scanned: number
  scannedPerWorker: number[]
  candidates: Candidate[]
  /**
   * Safe `--start` for a follow-up run with the same worker count and perWorker value:
   * start + max(scannedPerWorker) can never overlap any range this run covered.
   */
  nextStart: number
}

export function createPool(options: PoolOptions): {
  run(): Promise<PoolResult>
  stop(): void
} {
  const stopFlag = new SharedArrayBuffer(4)
  const stopView = new Int32Array(stopFlag)
  const workerUrl = options.workerUrl ?? new URL('./worker.js', import.meta.url)

  function stop(): void {
    Atomics.store(stopView, 0, 1)
  }

  async function run(): Promise<PoolResult> {
    const startedAt = Date.now()
    const board = new Leaderboard(options.keep)
    const scannedPerWorker = new Array<number>(options.workers).fill(0)

    const emitProgress = () => {
      if (!options.onProgress) return
      const scanned = scannedPerWorker.reduce((a, b) => a + b, 0)
      const elapsedMs = Math.max(1, Date.now() - startedAt)
      options.onProgress({
        scanned,
        elapsedMs,
        rate: (scanned / elapsedMs) * 1000,
        best: board.entries(),
      })
    }

    const runs = Array.from({ length: options.workers }, (_, index) => {
      const input: WorkerInput = {
        constantsHex: options.constantsHex,
        faceSpec: options.faceSpec,
        start: options.start + index * options.perWorker,
        count: options.perWorker,
        keep: options.keep,
        chunkSize: options.chunkSize ?? 250_000,
        stopFlag,
      }

      return new Promise<void>((resolve, reject) => {
        const worker = new Worker(workerUrl, { workerData: input })
        worker.on('message', (message: WorkerMessage) => {
          if (message.type === 'error') {
            reject(new Error(`worker ${index} failed: ${message.message}`))
            return
          }
          scannedPerWorker[index] = message.scanned
          board.merge(message.candidates)
          if (message.type === 'progress') emitProgress()
        })
        worker.on('error', reject)
        worker.on('exit', (code) => {
          if (code !== 0) reject(new Error(`worker ${index} exited with code ${code}`))
          else resolve()
        })
      })
    })

    try {
      await Promise.all(runs)
    } finally {
      stop()
    }

    const scanned = scannedPerWorker.reduce((a, b) => a + b, 0)
    return {
      scanned,
      scannedPerWorker,
      candidates: board.entries(),
      nextStart: options.start + Math.max(...scannedPerWorker),
    }
  }

  return { run, stop }
}
```

- [ ] **Step 5: Build and run the test to verify it passes**

The pool resolves `./worker.js` relative to its own module URL, so the compiled output must exist before the test runs.

Run: `mise exec -- pnpm -r build && mise exec -- pnpm --filter safe-vanity-blockie test`
Expected: PASS — 4 tests, with `result.candidates` exactly equal to the single-threaded leaderboard.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(miner): fan out disjoint nonce ranges across worker threads"
```

---

### Task 8: Argument parsing and result reporting

Both are pure functions with no I/O, which is why they are separated from `cli.ts` — they can be unit-tested without spawning a process or touching the network.

**Files:**
- Create: `packages/miner/src/args.ts`, `packages/miner/src/report.ts`
- Test: `packages/miner/test/args.test.ts`, `packages/miner/test/report.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `bloData`, `bloSvg` from `@safe-vanity-blockie/core`.
- Produces:
  - `class CliError extends Error`
  - `SUPPORTED_SAFE_VERSIONS: readonly ['1.4.1', '1.3.0']`, `type SupportedSafeVersion`
  - `MineArgs { owners: string[]; threshold: number; safeVersion: SupportedSafeVersion; rpcUrl: string; target: string; twoColor: boolean; minContrast: number; workers: number; maxIterations: number; start: number; keep: number; out?: string; gallery?: string; isL1SafeSingleton?: boolean }`
  - `DeployArgs { saltNonce: string; owners: string[]; threshold: number; safeVersion: SupportedSafeVersion; rpcUrl: string; privateKey: string; isL1SafeSingleton?: boolean }`
  - `Command = { kind: 'mine'; options: MineArgs } | { kind: 'deploy'; options: DeployArgs } | { kind: 'help' }`
  - `parseArgs(argv: string[], defaults: { workers: number }): Command`
  - `HELP_TEXT: string`
  - `ResultConfig { owners: string[]; threshold: number; safeVersion: string; chainId: string; target: string; maxScore: number; start: number; scanned: number; nextStart: number; workers: number; perWorker: number; generatedAt: string }`
  - `renderAscii(data: Uint8Array): string[]`
  - `filterCandidates(candidates: Candidate[], filters: { twoColor: boolean; minContrast: number }): Candidate[]`
  - `formatLeaderboard(candidates: Candidate[], limit: number): string`
  - `buildResultsJson(config: ResultConfig, candidates: Candidate[]): string`
  - `buildGalleryHtml(config: ResultConfig, candidates: Candidate[]): string`

- [ ] **Step 1: Write the failing args test**

`packages/miner/test/args.test.ts`:

```ts
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
    const options = mine([
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
```

- [ ] **Step 2: Write the failing report test**

`packages/miner/test/report.test.ts`:

```ts
import type { Candidate } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import {
  buildGalleryHtml,
  buildResultsJson,
  filterCandidates,
  formatLeaderboard,
  renderAscii,
  type ResultConfig,
} from '../src/report.js'

const CONFIG: ResultConfig = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1',
  chainId: '1',
  target: 'faces',
  maxScore: 133,
  start: 0,
  scanned: 100000,
  nextStart: 25000,
  workers: 4,
  perWorker: 25000,
  generatedAt: '2026-08-06T00:00:00.000Z',
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    saltNonce: '5254976178',
    address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    score: 131,
    maxScore: 133,
    twoColor: true,
    contrast: 170,
    regions: { mouth: 'small' },
    ...overrides,
  }
}

describe('renderAscii', () => {
  it('renders 8 rows of 8 mirrored cells', () => {
    const data = new Uint8Array(32)
    data[0] = 1 // row 0, col 0 -> mirrors to col 7
    const lines = renderAscii(data)
    expect(lines).toHaveLength(8)
    expect(lines[0]).toBe('██            ██')
    expect(lines[1]).toBe('                ')
  })

  it('distinguishes the spot colour from the main colour', () => {
    const data = new Uint8Array(32)
    data[1] = 2
    expect(renderAscii(data)[0]).toContain('▒▒')
  })
})

describe('filterCandidates', () => {
  it('drops non-two-colour results when two-colour is requested', () => {
    const entries = [candidate({ address: '0xa' }), candidate({ address: '0xb', twoColor: false })]
    expect(filterCandidates(entries, { twoColor: true, minContrast: 0 })).toHaveLength(1)
    expect(filterCandidates(entries, { twoColor: false, minContrast: 0 })).toHaveLength(2)
  })

  it('drops results below the contrast floor', () => {
    const entries = [candidate({ address: '0xa', contrast: 200 }), candidate({ address: '0xb', contrast: 50 })]
    expect(filterCandidates(entries, { twoColor: false, minContrast: 150 })).toHaveLength(1)
  })
})

describe('buildResultsJson', () => {
  it('emits config plus results with saltNonce as a string', () => {
    const parsed = JSON.parse(buildResultsJson(CONFIG, [candidate()]))
    expect(parsed.config).toMatchObject({ chainId: '1', safeVersion: '1.4.1', maxScore: 133 })
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0]).toEqual({
      saltNonce: '5254976178',
      address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      score: 131,
      max: 133,
      twoColor: true,
      contrast: 170,
      mouth: 'small',
    })
  })

  it('keeps huge saltNonces exact', () => {
    const huge = '18446744073709551616'
    const parsed = JSON.parse(buildResultsJson(CONFIG, [candidate({ saltNonce: huge })]))
    expect(parsed.results[0].saltNonce).toBe(huge)
  })
})

describe('buildGalleryHtml', () => {
  it('produces a self-contained page with one real blo svg per result', () => {
    const html = buildGalleryHtml(CONFIG, [candidate(), candidate({ address: '0x' + '11'.repeat(20) })])
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/<script|https?:\/\/[^"]*\.(js|css)/)
    expect(html.match(/<svg /g)).toHaveLength(2)
    expect(html).toContain('5254976178')
    expect(html).toContain('cosmetic')
  })

  it('escapes text that comes from the config', () => {
    const html = buildGalleryHtml({ ...CONFIG, target: '<img src=x onerror=alert(1)>' }, [candidate()])
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})

describe('formatLeaderboard', () => {
  it('renders one line per candidate up to the limit', () => {
    const entries = [candidate({ address: '0xa' }), candidate({ address: '0xb' }), candidate({ address: '0xc' })]
    const lines = formatLeaderboard(entries, 2).trim().split('\n')
    expect(lines.filter((line) => line.includes('0x'))).toHaveLength(2)
    expect(lines[0]).toMatch(/score/i)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `mise exec -- pnpm --filter safe-vanity-blockie test`
Expected: FAIL — `Failed to resolve import "../src/args.js"` and `"../src/report.js"`.

- [ ] **Step 4: Write `args.ts`**

`packages/miner/src/args.ts`:

```ts
export class CliError extends Error {}

export const SUPPORTED_SAFE_VERSIONS = ['1.4.1', '1.3.0'] as const
export type SupportedSafeVersion = (typeof SUPPORTED_SAFE_VERSIONS)[number]

export interface MineArgs {
  owners: string[]
  threshold: number
  safeVersion: SupportedSafeVersion
  rpcUrl: string
  /** Builtin template name, or a path to a FaceSpec JSON file. */
  target: string
  twoColor: boolean
  minContrast: number
  workers: number
  maxIterations: number
  start: number
  keep: number
  out?: string
  gallery?: string
  isL1SafeSingleton?: boolean
}

export interface DeployArgs {
  saltNonce: string
  owners: string[]
  threshold: number
  safeVersion: SupportedSafeVersion
  rpcUrl: string
  privateKey: string
  isL1SafeSingleton?: boolean
}

export type Command =
  | { kind: 'mine'; options: MineArgs }
  | { kind: 'deploy'; options: DeployArgs }
  | { kind: 'help' }

export const HELP_TEXT = `safe-vanity-blockie — mine a Safe saltNonce whose address renders as a face

Usage:
  safe-vanity-blockie [mine] --owners <0x..,0x..> --rpc <url> [options]
  safe-vanity-blockie deploy --salt <n> --owners <0x..> --rpc <url> --pk <key>

Mine options:
  --owners <0x..,0x..>   required   comma-separated Safe owners
  --threshold <n>        1          signatures required
  --safe-version <v>     1.4.1      one of: ${SUPPORTED_SAFE_VERSIONS.join(', ')}
  --rpc <url>            required   used once, for chainId and canonical contract addresses
  --target <name|file>   faces      builtin template or a FaceSpec JSON file
  --two-color            on         only report blockies that use exactly two colours
  --no-two-color                    report three-colour results too
  --min-contrast <n>     0          drop results whose two colours are closer than this (0-442)
  --workers <n>          cores-1    worker threads
  --max-iterations <n>   unbounded  total nonces to scan; omit to run until Ctrl+C
  --start <n>            0          first saltNonce; use the printed nextStart to resume
  --keep <n>             20         leaderboard size
  --out <file.json>                 machine-readable results
  --gallery <file.html>             self-contained HTML gallery of real blo SVGs
  --l1-singleton                    force the L1 Safe singleton on an L2 chain
  -h, --help                        show this help

Deploy options:
  --salt <n>             required   saltNonce from a mining run
  --pk <key>             required   deployer private key (0x-prefixed)

A matching identicon is cosmetic. Never trust it as proof of an address.
`

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

function parseOwners(raw: string): string[] {
  const owners = raw
    .split(',')
    .map((owner) => owner.trim())
    .filter((owner) => owner.length > 0)
  if (owners.length === 0) throw new CliError('--owners must list at least one address')
  for (const owner of owners) {
    if (!ADDRESS_PATTERN.test(owner)) {
      throw new CliError(`--owners: "${owner}" is not a valid 0x address`)
    }
  }
  const seen = new Set<string>()
  for (const owner of owners) {
    const key = owner.toLowerCase()
    if (seen.has(key)) throw new CliError(`--owners: duplicate owner ${owner}`)
    seen.add(key)
  }
  return owners
}

function positiveInteger(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError(`${flag} must be a positive integer, got "${raw}"`)
  }
  return value
}

function nonNegativeInteger(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CliError(`${flag} must be a non-negative integer, got "${raw}"`)
  }
  return value
}

export function parseArgs(argv: string[], defaults: { workers: number }): Command {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { kind: 'help' }

  let rest = argv
  let kind: 'mine' | 'deploy' = 'mine'
  if (rest[0] === 'mine' || rest[0] === 'deploy') {
    kind = rest[0]
    rest = rest.slice(1)
  }

  const values = new Map<string, string>()
  const flags = new Set<string>()
  const BOOLEAN_FLAGS = new Set(['--two-color', '--no-two-color', '--l1-singleton'])
  const VALUE_FLAGS = new Set([
    '--owners', '--threshold', '--safe-version', '--rpc', '--target', '--min-contrast',
    '--workers', '--max-iterations', '--start', '--keep', '--out', '--gallery', '--salt', '--pk',
  ])

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (BOOLEAN_FLAGS.has(token)) {
      flags.add(token)
      continue
    }
    if (!VALUE_FLAGS.has(token)) throw new CliError(`unknown option "${token}"`)
    const value = rest[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new CliError(`${token} needs a value`)
    }
    values.set(token, value)
    i++
  }

  const require = (flag: string): string => {
    const value = values.get(flag)
    if (value === undefined) throw new CliError(`${flag} is required`)
    return value
  }

  const owners = parseOwners(require('--owners'))
  const rpcUrl = require('--rpc')

  const thresholdRaw = values.get('--threshold')
  const threshold = thresholdRaw === undefined ? 1 : positiveInteger(thresholdRaw, '--threshold')
  if (threshold > owners.length) {
    throw new CliError(
      `--threshold ${threshold} exceeds the ${owners.length} owner${owners.length === 1 ? '' : 's'} given`,
    )
  }

  const safeVersionRaw = values.get('--safe-version') ?? '1.4.1'
  if (!SUPPORTED_SAFE_VERSIONS.includes(safeVersionRaw as SupportedSafeVersion)) {
    throw new CliError(
      `unsupported --safe-version "${safeVersionRaw}"; supported: ${SUPPORTED_SAFE_VERSIONS.join(', ')}`,
    )
  }
  const safeVersion = safeVersionRaw as SupportedSafeVersion
  const isL1SafeSingleton = flags.has('--l1-singleton') ? true : undefined

  if (kind === 'deploy') {
    return {
      kind: 'deploy',
      options: {
        saltNonce: require('--salt'),
        owners,
        threshold,
        safeVersion,
        rpcUrl,
        privateKey: require('--pk'),
        isL1SafeSingleton,
      },
    }
  }

  const maxIterationsRaw = values.get('--max-iterations')
  const startRaw = values.get('--start')
  const keepRaw = values.get('--keep')
  const workersRaw = values.get('--workers')
  const minContrastRaw = values.get('--min-contrast')

  return {
    kind: 'mine',
    options: {
      owners,
      threshold,
      safeVersion,
      rpcUrl,
      target: values.get('--target') ?? 'faces',
      twoColor: !flags.has('--no-two-color'),
      minContrast: minContrastRaw === undefined ? 0 : nonNegativeInteger(minContrastRaw, '--min-contrast'),
      workers: workersRaw === undefined ? defaults.workers : positiveInteger(workersRaw, '--workers'),
      maxIterations:
        maxIterationsRaw === undefined
          ? Number.POSITIVE_INFINITY
          : positiveInteger(maxIterationsRaw, '--max-iterations'),
      start: startRaw === undefined ? 0 : nonNegativeInteger(startRaw, '--start'),
      keep: keepRaw === undefined ? 20 : positiveInteger(keepRaw, '--keep'),
      out: values.get('--out'),
      gallery: values.get('--gallery'),
      isL1SafeSingleton,
    },
  }
}
```

- [ ] **Step 5: Write `report.ts`**

`packages/miner/src/report.ts`:

```ts
import { bloData, bloSvg, type Candidate } from '@safe-vanity-blockie/core'

export interface ResultConfig {
  owners: string[]
  threshold: number
  safeVersion: string
  /** Decimal string; chainId is a bigint and JSON has no bigint. */
  chainId: string
  target: string
  maxScore: number
  start: number
  scanned: number
  nextStart: number
  workers: number
  perWorker: number
  generatedAt: string
}

const GLYPHS = ['  ', '██', '▒▒'] as const

/** 8 lines of 8 cells. Columns 4-7 mirror columns 3-0, exactly as blo renders them. */
export function renderAscii(data: Uint8Array): string[] {
  const lines: string[] = []
  for (let row = 0; row < 8; row++) {
    let line = ''
    for (let col = 0; col < 8; col++) {
      const source = col < 4 ? col : 7 - col
      line += GLYPHS[data[row * 4 + source]]
    }
    lines.push(line)
  }
  return lines
}

export function filterCandidates(
  candidates: Candidate[],
  filters: { twoColor: boolean; minContrast: number },
): Candidate[] {
  return candidates.filter(
    (candidate) =>
      (!filters.twoColor || candidate.twoColor) && candidate.contrast >= filters.minContrast,
  )
}

function regionSummary(candidate: Candidate): string {
  return Object.values(candidate.regions).join('/') || '-'
}

export function formatLeaderboard(candidates: Candidate[], limit: number): string {
  const header = ' # | score | 2col | contrast | expression | address                                    | saltNonce'
  const rows = candidates.slice(0, limit).map((candidate, index) => {
    return [
      String(index + 1).padStart(2),
      `${candidate.score}/${candidate.maxScore}`.padStart(6),
      (candidate.twoColor ? 'yes' : 'no').padStart(4),
      String(candidate.contrast).padStart(8),
      regionSummary(candidate).padStart(10),
      candidate.address,
      candidate.saltNonce,
    ].join(' | ')
  })
  return [header, '-'.repeat(header.length), ...rows].join('\n') + '\n'
}

export function buildResultsJson(config: ResultConfig, candidates: Candidate[]): string {
  return (
    JSON.stringify(
      {
        config,
        results: candidates.map((candidate) => ({
          saltNonce: candidate.saltNonce,
          address: candidate.address,
          score: candidate.score,
          max: candidate.maxScore,
          twoColor: candidate.twoColor,
          contrast: candidate.contrast,
          ...candidate.regions,
        })),
      },
      null,
      2,
    ) + '\n'
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildGalleryHtml(config: ResultConfig, candidates: Candidate[]): string {
  const cards = candidates
    .map((candidate) => {
      const twoColor = candidate.twoColor ? 'two colours' : 'three colours'
      return `    <figure class="card">
      ${bloSvg(candidate.address, 128)}
      <figcaption>
        <strong>${candidate.score}/${candidate.maxScore}</strong>
        <span>${escapeHtml(regionSummary(candidate))} · ${twoColor} · contrast ${candidate.contrast}</span>
        <code>${escapeHtml(candidate.address)}</code>
        <code>saltNonce ${escapeHtml(candidate.saltNonce)}</code>
      </figcaption>
    </figure>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>safe-vanity-blockie results</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; }
  .warning { border: 1px solid currentColor; padding: .75rem 1rem; border-radius: .5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
  .card { margin: 0; padding: 1rem; border: 1px solid rgba(128,128,128,.4); border-radius: .5rem; }
  .card svg { border-radius: .25rem; display: block; }
  figcaption { display: grid; gap: .25rem; margin-top: .75rem; }
  code { font-size: 12px; overflow-wrap: anywhere; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; }
  dt { font-weight: 600; }
</style>
</head>
<body>
<h1>safe-vanity-blockie results</h1>
<p class="warning"><strong>A matching identicon is cosmetic.</strong> Never treat it as proof of an
address — blockie look-alikes are a known phishing vector. Always verify the full address.</p>
<dl>
  <dt>owners</dt><dd><code>${escapeHtml(config.owners.join(', '))}</code></dd>
  <dt>threshold</dt><dd>${config.threshold}</dd>
  <dt>Safe version</dt><dd>${escapeHtml(config.safeVersion)}</dd>
  <dt>chain id</dt><dd>${escapeHtml(config.chainId)}</dd>
  <dt>target</dt><dd>${escapeHtml(config.target)}</dd>
  <dt>scanned</dt><dd>${config.scanned.toLocaleString('en-US')} nonces from ${config.start}</dd>
  <dt>resume at</dt><dd><code>--start ${config.nextStart} --workers ${config.workers}</code></dd>
  <dt>generated</dt><dd>${escapeHtml(config.generatedAt)}</dd>
</dl>
<div class="grid">
${cards}
</div>
</body>
</html>
`
}

/** Re-exported so cli.ts can preview a candidate without importing core directly. */
export function asciiFor(address: string): string[] {
  return renderAscii(bloData(address))
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `mise exec -- pnpm -r build && mise exec -- pnpm --filter safe-vanity-blockie test`
Expected: PASS — all args, report and pool tests green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(miner): add CLI argument parsing and JSON/HTML/ASCII reporting"
```

---

### Task 9: CLI orchestration and the `npx` entry point

**Files:**
- Create: `packages/miner/src/cli.ts`
- Test: `packages/miner/test/cli.test.ts`, `packages/miner/test/cli.network.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–8, plus `getTemplate`, `parseFaceSpec`, `compileFace` from core.
- Produces: `resolveFaceSpec(target: string): FaceSpec`; `runMine(options: MineArgs): Promise<number>` (returns a process exit code); `main(argv: string[]): Promise<number>`; a `bin` executable at `dist/cli.js`.

- [ ] **Step 1: Write the failing unit test**

`packages/miner/test/cli.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing end-to-end test**

`packages/miner/test/cli.network.test.ts` — the one test that exercises the whole pipeline: real RPC, real workers, real self-check, real output files.

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `mise exec -- pnpm --filter safe-vanity-blockie test`
Expected: FAIL — `Failed to resolve import "../src/cli.js"`.

- [ ] **Step 4: Write `cli.ts`**

`packages/miner/src/cli.ts`:

```ts
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import {
  compileFace,
  getTemplate,
  parseFaceSpec,
  TEMPLATES,
  type Candidate,
  type FaceSpec,
} from '@safe-vanity-blockie/core'
import { CliError, HELP_TEXT, parseArgs, type MineArgs } from './args.js'
import { WORKER_BLOCK, createPool } from './pool.js'
import {
  asciiFor,
  buildGalleryHtml,
  buildResultsJson,
  filterCandidates,
  formatLeaderboard,
  type ResultConfig,
} from './report.js'
import { loadSafeConstants, verifyWithProtocolKit } from './setup.js'

/** A builtin template name, or a path to a FaceSpec JSON file. */
export function resolveFaceSpec(target: string): FaceSpec {
  if (Object.hasOwn(TEMPLATES, target)) return getTemplate(target)
  if (!target.includes('/') && !target.endsWith('.json')) return getTemplate(target) // throws with the list

  let text: string
  try {
    text = readFileSync(target, 'utf8')
  } catch (error) {
    throw new CliError(
      `could not read face spec "${target}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new CliError(
      `could not parse face spec "${target}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return parseFaceSpec(json)
}

function formatRate(rate: number): string {
  return rate >= 1e6 ? `${(rate / 1e6).toFixed(2)}M/s` : `${Math.round(rate / 1000)}k/s`
}

export async function runMine(options: MineArgs): Promise<number> {
  const faceSpec = resolveFaceSpec(options.target)
  const maxScore = compileFace(faceSpec).maxScore

  process.stderr.write(`Reading Safe constants from ${options.rpcUrl}…\n`)
  const setup = await loadSafeConstants({
    rpcUrl: options.rpcUrl,
    owners: options.owners,
    threshold: options.threshold,
    safeVersion: options.safeVersion,
    isL1SafeSingleton: options.isL1SafeSingleton,
  })

  const perWorker = Number.isFinite(options.maxIterations)
    ? Math.ceil(options.maxIterations / options.workers)
    : WORKER_BLOCK
  const budget = Number.isFinite(options.maxIterations)
    ? `${options.maxIterations.toLocaleString('en-US')} nonces`
    : 'until Ctrl+C'

  process.stderr.write(
    `chain ${setup.chainId} · Safe ${options.safeVersion} · target "${faceSpec.name}" ` +
      `(max ${maxScore}) · ${options.workers} workers · ${budget}\n`,
  )

  const pool = createPool({
    constantsHex: setup.constantsHex,
    faceSpec,
    start: options.start,
    workers: options.workers,
    perWorker,
    keep: options.keep,
    onProgress: (progress) => {
      const best = progress.best[0]
      const summary = best ? `best ${best.score}/${best.maxScore}` : 'no candidates yet'
      process.stderr.write(
        `\r${progress.scanned.toLocaleString('en-US')} nonces · ${formatRate(progress.rate)} · ${summary}   `,
      )
    },
  })

  const onSigint = () => {
    process.stderr.write('\nStopping workers, keeping the best results found so far…\n')
    pool.stop()
  }
  process.on('SIGINT', onSigint)

  let result
  try {
    result = await pool.run()
  } finally {
    process.off('SIGINT', onSigint)
    process.stderr.write('\n')
  }

  const filtered = filterCandidates(result.candidates, {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
  })
  const reported: Candidate[] = filtered.length > 0 ? filtered : result.candidates
  if (filtered.length === 0 && result.candidates.length > 0) {
    process.stderr.write(
      'No result passed the --two-color / --min-contrast filters; showing unfiltered results.\n',
    )
  }

  if (reported.length === 0) {
    process.stdout.write('No candidates found. Try a larger --max-iterations.\n')
    return 1
  }

  const top = reported[0]
  await verifyWithProtocolKit(setup, top.saltNonce, top.address)
  process.stdout.write(`self-check passed: predictSafeAddress agrees with ${top.address}\n\n`)

  for (const line of asciiFor(top.address)) process.stdout.write(`  ${line}\n`)
  process.stdout.write('\n')
  process.stdout.write(formatLeaderboard(reported, options.keep))

  const config: ResultConfig = {
    owners: options.owners,
    threshold: options.threshold,
    safeVersion: options.safeVersion,
    chainId: String(setup.chainId),
    target: faceSpec.name,
    maxScore,
    start: options.start,
    scanned: result.scanned,
    nextStart: result.nextStart,
    workers: options.workers,
    perWorker,
    generatedAt: new Date().toISOString(),
  }

  if (options.out) {
    writeFileSync(options.out, buildResultsJson(config, reported))
    process.stdout.write(`\nWrote ${options.out}\n`)
  }
  if (options.gallery) {
    writeFileSync(options.gallery, buildGalleryHtml(config, reported))
    process.stdout.write(`Wrote ${options.gallery}\n`)
  }

  process.stdout.write(
    `\nResume without rescanning:\n  --start ${result.nextStart} --workers ${options.workers}\n`,
  )
  process.stdout.write(
    '\nReminder: a matching identicon is cosmetic. Never trust it as proof of an address.\n',
  )
  return 0
}

export async function main(argv: string[]): Promise<number> {
  const defaults = { workers: Math.max(1, availableParallelism() - 1) }
  const command = parseArgs(argv, defaults)

  if (command.kind === 'help') {
    process.stdout.write(HELP_TEXT)
    return 0
  }
  if (command.kind === 'deploy') {
    const { runDeploy } = await import('./deploy.js')
    return runDeploy(command.options)
  }
  return runMine(command.options)
}

// Only run when invoked as the executable. Without this guard, importing cli.js from a test
// would execute main() with vitest's own argv and fail on "unknown option".
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    })
}
```

This needs one more import at the top of the file, alongside the other `node:` imports:

```ts
import { pathToFileURL } from 'node:url'
```

- [ ] **Step 5: Add a temporary `deploy.ts` stub so `cli.ts` typechecks**

Task 10 fills this in. Create `packages/miner/src/deploy.ts`:

```ts
import type { DeployArgs } from './args.js'

export async function runDeploy(_options: DeployArgs): Promise<number> {
  throw new Error('deploy is not implemented yet')
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `mise exec -- pnpm -r build && mise exec -- pnpm --filter safe-vanity-blockie test`
Expected: PASS — the `resolveFaceSpec` tests.

Run: `mise exec -- pnpm --filter safe-vanity-blockie test:network`
Expected: PASS — the end-to-end run prints `self-check passed`, writes both files, and the help/error cases behave.

- [ ] **Step 7: Try it by hand**

```bash
mise exec -- node packages/miner/dist/cli.js \
  --owners 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  --rpc https://ethereum-rpc.publicnode.com \
  --max-iterations 3000000 --workers 4 --keep 10 \
  --out /tmp/results.json --gallery /tmp/gallery.html
```

Expected: a live progress line reporting well over 1M nonces/s aggregate, an ASCII face, a leaderboard, and both files written. Note the observed rate in the commit message — spec §6.1 predicts ~2.5–3M/s on 8 cores.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(miner): wire up the CLI with live progress, self-check and outputs"
```

---

### Task 10: `deploy` subcommand and final documentation

**Files:**
- Modify: `packages/miner/src/deploy.ts` (replace the Task 9 stub)
- Modify: `README.md` (usage, benchmarks, resume workflow)
- Test: `packages/miner/test/deploy.test.ts`

**Interfaces:**
- Consumes: `DeployArgs` (Task 8), `loadSafeConstants`, `verifyWithProtocolKit` (Task 6).
- Produces: `buildDeploymentPlan(options: DeployArgs): Promise<{ address: string; chainId: bigint; transaction: { to: string; value: string; data: string } }>`; `runDeploy(options: DeployArgs): Promise<number>`.

- [ ] **Step 1: Write the failing test**

`packages/miner/test/deploy.test.ts` — no funds and no broadcast: the test asserts the plan is built and the predicted address is confirmed before any transaction is sent.

```ts
import { describe, expect, it } from 'vitest'
import { buildDeploymentPlan } from '../src/deploy.js'

const RPC_URL = process.env.TEST_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'
// Well-known throwaway key (hardhat account #0). Never funded on mainnet.
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

describe('buildDeploymentPlan', () => {
  it('produces a transaction and the address the miner predicted', async () => {
    const plan = await buildDeploymentPlan({
      saltNonce: '5254976178',
      owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
      threshold: 1,
      safeVersion: '1.4.1',
      rpcUrl: RPC_URL,
      privateKey: PRIVATE_KEY,
    })
    expect(plan.chainId).toBe(1n)
    expect(plan.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(plan.transaction.to).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(plan.transaction.data.length).toBeGreaterThan(200)
  }, 120_000)
})
```

Rename this file to `deploy.network.test.ts` so it runs with the other network tests:

```bash
git mv packages/miner/test/deploy.test.ts packages/miner/test/deploy.network.test.ts 2>/dev/null \
  || mv packages/miner/test/deploy.test.ts packages/miner/test/deploy.network.test.ts
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- pnpm --filter safe-vanity-blockie test:network -- deploy`
Expected: FAIL — `buildDeploymentPlan is not exported` / `deploy is not implemented yet`.

- [ ] **Step 3: Write `deploy.ts`**

`packages/miner/src/deploy.ts`:

```ts
import Safe, { getSafeAddressFromDeploymentTx } from '@safe-global/protocol-kit'
import { createWalletClient, http, publicActions, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { DeployArgs } from './args.js'
import { loadSafeConstants, verifyWithProtocolKit } from './setup.js'

export interface DeploymentPlan {
  address: string
  chainId: bigint
  transaction: { to: string; value: string; data: string }
}

/** Builds (but never sends) the deployment transaction, and confirms the predicted address. */
export async function buildDeploymentPlan(options: DeployArgs): Promise<DeploymentPlan> {
  const setup = await loadSafeConstants({
    rpcUrl: options.rpcUrl,
    owners: options.owners,
    threshold: options.threshold,
    safeVersion: options.safeVersion,
    isL1SafeSingleton: options.isL1SafeSingleton,
  })

  const safe = await Safe.init({
    provider: options.rpcUrl,
    signer: options.privateKey,
    isL1SafeSingleton: options.isL1SafeSingleton,
    predictedSafe: {
      safeAccountConfig: setup.safeAccountConfig,
      safeDeploymentConfig: { saltNonce: options.saltNonce, safeVersion: options.safeVersion },
    },
  })

  const address = await safe.getAddress()
  await verifyWithProtocolKit(setup, options.saltNonce, address)
  const transaction = await safe.createSafeDeploymentTransaction()

  return {
    address,
    chainId: setup.chainId,
    transaction: { to: transaction.to, value: transaction.value, data: transaction.data },
  }
}

export async function runDeploy(options: DeployArgs): Promise<number> {
  const plan = await buildDeploymentPlan(options)
  process.stdout.write(
    `Deploying Safe ${plan.address} on chain ${plan.chainId} with saltNonce ${options.saltNonce}\n`,
  )

  const account = privateKeyToAccount(options.privateKey as Hex)
  const client = createWalletClient({
    account,
    transport: http(options.rpcUrl),
  }).extend(publicActions)

  const hash = await client.sendTransaction({
    to: plan.transaction.to as Hex,
    value: BigInt(plan.transaction.value),
    data: plan.transaction.data as Hex,
    chain: null,
  })
  process.stdout.write(`Transaction sent: ${hash}\nWaiting for confirmation…\n`)

  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    process.stderr.write(`Deployment reverted in ${receipt.transactionHash}\n`)
    return 1
  }

  const deployed = getSafeAddressFromDeploymentTx(receipt, options.safeVersion)
  if (deployed.toLowerCase() !== plan.address.toLowerCase()) {
    process.stderr.write(
      `Deployed address ${deployed} does not match the predicted ${plan.address}\n`,
    )
    return 1
  }

  process.stdout.write(`Safe deployed at ${deployed}\n`)
  return 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `mise exec -- pnpm -r build && mise exec -- pnpm --filter safe-vanity-blockie test:network -- deploy`
Expected: PASS — the plan is built and the predicted address is confirmed against `predictSafeAddress`.

- [ ] **Step 5: Finish the README**

Append to `README.md`:

````markdown
## Usage

    npx safe-vanity-blockie \
      --owners 0xYourOwner,0xAnotherOwner \
      --threshold 1 \
      --rpc https://ethereum-rpc.publicnode.com \
      --target faces \
      --keep 20 \
      --out results.json \
      --gallery gallery.html

Run `npx safe-vanity-blockie --help` for every flag. `Ctrl+C` stops the workers and keeps the best
results found so far.

### Targets

`--target` accepts a builtin name (`faces`, `smile`, `frown`, `neutral`, `open`, `small`) or a path
to a `FaceSpec` JSON file. `faces` pins the eyes and accepts any of the five expressions, crediting
each candidate with its best-fitting one.

### Resuming and merging runs

Each run prints a resume line. Start the next run there, with the same `--workers`, and merge the
JSON files by deduping on `address`:

    npx safe-vanity-blockie … --start 8400000000 --workers 8 --out results-2.json

### What score to expect

A mathematically perfect face (all 32 cells exact) is roughly a 1-in-4×10¹¹ event, so it is not
brute-forceable. Scoring pushes residual error into the lowest-weight corner cells, which makes
128–131 out of 133 the practical ceiling — one or two faint stray pixels, never in the eyes or mouth.

| quality (of 133) | ~nonces | CLI (~2.5–3M/s on 8 cores) |
|---|---|---|
| recognisable face (~121) | ~3–10M | seconds |
| clean face (~125) | ~0.1–0.4B | seconds to 2 min |
| very clean (~127–128) | ~0.7–4B | 4–25 min |
| near-perfect (~131) | ~8B | 45–55 min |

### Deploying

The mined config is counterfactual — deploy whenever you like, on any chain with the canonical Safe
contracts (zkSync-based chains are rejected: they derive addresses differently).

    npx safe-vanity-blockie deploy \
      --salt 5254976178 --owners 0xYourOwner --threshold 1 \
      --rpc https://… --pk 0xYourDeployerKey

## Testing

    pnpm test           # offline: unit + worker-pool integration
    pnpm test:network   # additionally hits a public RPC and protocol-kit

Set `TEST_RPC_URL` to use your own endpoint.

## Prior art

Austin Griffith's [`vanity-blockie-miner`](https://github.com/austintgriffith/vanity-blockie-miner)
brute-forces EOA private keys against the older `ethereum/blockies` algorithm. This project targets a
Safe CREATE2 `saltNonce` — a deploy config, not a key — against `blo` specifically, with a two-colour,
multi-expression scoring model.
````

- [ ] **Step 6: Run the full suite**

Run: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm test:network`
Expected: every package builds, typechecks, and passes both offline and network suites.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(miner): add the deploy subcommand and complete the README"
```

---

## Self-review

**Spec coverage.** Every numbered section maps to a task: §3.1/§3.3 → Task 3; §3.2 → Task 6; §4 (incl. the §4.4 parity test) → Task 1; §5.1–§5.7 → Task 4 (`FaceSpec`/region model included, so §5.7's generalisation is built, not deferred); §5.6 ranking → Task 5; §6 → Task 2; §7.1–§7.4 → Tasks 7–9; §7.5 → Task 10; §9 dependencies → Tasks 1 and 6; §10 milestones 1–2 → Tasks 1–10. §8 (`web`) is explicitly out of scope and gets its own plan. §12 nice-to-haves are not implemented; the two worth revisiting after `web` are `blo`-in-WASM and progress persistence.

**Correctness checklist (spec §11)** — each item has a test that fails if it regresses:

| Checklist item | Where it is enforced |
|---|---|
| Seed is the lowercased `0x`-prefixed address | Task 1, `blo` parity + case-insensitivity tests |
| Exactly 18 PRNG draws before the grid | Task 1, `bloDataInto` parity test |
| `RANDOM_SCALE` positive | Task 1, `nextRandom` in `[0,1)` test |
| Grid value 2 breaks two-colour; `isTwoColor` tracked | Task 4 spot-colour test, Task 5 candidate metadata |
| `saltNonce` big-endian uint256, emitted as a string | Task 3 viem cross-check, Task 8 JSON test |
| CREATE2 preimage layout and `[12..32)` slice | Task 3 viem cross-check |
| `proxyCreationCode()` returns a tuple | Task 6, destructured `[proxyCreationCode]`, proven by the address self-check |
| Hot path: flattened typed arrays, integer-only | Task 4 naive-oracle equivalence, Task 5 single-allocation loop |
| Verify the top result against `predictSafeAddress()` | Task 6 unit-level, Task 9 every CLI run |
| zkSync excluded, never silently mis-derived | Task 6 `ZKSYNC_CHAIN_IDS` guard |
| CLI and future Web Workers share one `core` | Task 5 purity test, Task 7 thin worker wrapper |

**Interface consistency.** `SafeConstants`, `Keccak256`, `Candidate`, `CompiledFace`, `FaceSpec` and `MineOptions` are defined once and imported everywhere. The one deliberate rename is the CLI's `MineArgs` (Task 8), kept distinct from core's `MineOptions` (Task 5) because they are different shapes. `createPool` in Task 7 consumes exactly the `constantsHex` object Task 6 produces, and `runMine` in Task 9 passes it through untouched.

**Known ordering constraint.** Task 9 creates a `deploy.ts` stub because `cli.ts` imports `runDeploy`; Task 10 replaces it. Any executor that reorders these two will break the Task 9 typecheck.
