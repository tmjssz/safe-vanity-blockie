# Safe Vanity Blockie — `web` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/web`, a Next.js app that walks a user from Safe config → face choice → live in-browser mining → result pick → one-click deploy, reusing `@safe-vanity-blockie/core` unchanged.

**Architecture:** The browser runs the *same* mining loop as the CLI — `core` is already pure and isomorphic, enforced by a test. Web Workers slice the search into short synchronous bursts and yield between them, so a stop message is processed within milliseconds **without** `SharedArrayBuffer` (see Global Constraints). Everything protocol-kit-shaped moves into a new isomorphic `packages/safe-config` shared by the CLI and the app, so the logic where most of this project's correctness lives has one home.

**Tech Stack:** Next.js 16 (app router) · React 19 · wagmi 3 + viem 2 + TanStack Query 5 · `@safe-global/protocol-kit` 8 · vitest 4 + @testing-library/react 16 + jsdom 30. Node 24 / pnpm 11 via `mise`, as in the rest of the repo.

**Scope:** Spec §8 (`web`), plus the shared extraction §8 depends on. The freeform 8×8 template designer and `FaceSpec` JSON import/export are deliberately **out of scope** and get their own plan; this one ships the built-in templates plus a per-expression picker, which is what §8.1 step 2 calls "preset expression sets".

## Global Constraints

- **`core` is not modified except to receive shared pure helpers** (Task 1). Its purity test must keep passing: no `node:*`, DOM, filesystem or network anywhere in `packages/core/src`.
- **No `SharedArrayBuffer`, and therefore no COOP/COEP headers.** The Node worker stops via `SharedArrayBuffer` + `Atomics` because `mine()` is synchronous and a blocked thread never drains its message queue. In a browser, requiring cross-origin isolation to get `SharedArrayBuffer` would break injected-wallet and popup flows. Instead the browser worker calls `mine()` in bounded slices and awaits a macrotask between them, so `postMessage` is processed at every slice boundary. This is the single most important architectural difference from the CLI.
- **Filtering happens after retention, so retention must over-fetch.** `compareCandidates` ranks by score with `twoColor` only breaking ties; sizing a leaderboard at the display count silently discards the two-colour candidates the user asked for. Web reuses `selectReported` for exactly this reason (Task 1).
- **Worker ranges are disjoint and gapless:** worker `w` gets `[start + w*perWorker, +perWorker)`. Resume position is `start + max(w*perWorker + scanned_w)` — **not** `start + max(scanned_w)`, which re-mines most of the previous run.
- **`saltNonce` is a decimal string everywhere**, including through JSON, the deep link, and into protocol-kit. It may exceed 2^53.
- **Scores are displayed as percentages** with one decimal (`formatScore`); the raw integer stays the ranking key.
- **Security copy is mandatory on every surface that shows a blockie**: a matching identicon is cosmetic and must never be trusted as proof of an address. It appears in the header, on the results view, and in the deploy confirmation.
- **The deploy path must cross-check the address independently** before sending, exactly as the CLI does — protocol-kit's `safe.getAddress()` is itself `predictSafeAddress`, so comparing those two proves nothing.
- **Chain support:** standard non-zkSync chains only; zkSync-family chain IDs must throw a clear error, never silently mis-derive.
- **Commit style:** conventional commits. Commits are made by the controller (the sandbox cannot sign or commit) — implementers stage with `git add -A` and stop.

## File structure

| File | Responsibility |
|---|---|
| `packages/safe-config/src/setup.ts` | protocol-kit: chainId + the three CREATE2 constants, and the `predictSafeAddress` self-check (moved verbatim from `miner`) |
| `packages/safe-config/src/index.ts` | Public surface of the shared package |
| `packages/core/src/select.ts` | `filterCandidates`, `selectReported`, `formatScore` — pure, shared by CLI and web |
| `packages/web/lib/config.ts` | `MineConfig` + validation, independent of React |
| `packages/web/lib/face-selection.ts` | Expression picker → `FaceSpec` |
| `packages/web/lib/deep-link.ts` | `?config=` encode/decode/validate |
| `packages/web/lib/browser-miner.ts` | The sliced, yielding mining loop — pure, runs under vitest in Node |
| `packages/web/workers/mine.worker.ts` | Thin Web Worker wrapper: message protocol only |
| `packages/web/lib/use-miner.ts` | React hook owning the worker pool, progress aggregation and stop |
| `packages/web/lib/deploy.ts` | protocol-kit deployment through the wallet provider, with the independent cross-check |
| `packages/web/lib/wagmi.ts` | wagmi config: chains, injected/EIP-6963 connectors |
| `packages/web/components/*.tsx` | Presentational components, one concern each |
| `packages/web/app/*` | Route, layout, providers |

---

### Task 1: Shared extraction — `packages/safe-config` and `core/select.ts`

The web app needs the Safe-constants logic and the candidate-filtering logic the CLI already has. Both move to shared homes before any web code exists, so there is never a second copy to drift.

**Files:**
- Create: `packages/safe-config/package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.network.config.ts`, `src/setup.ts`, `src/index.ts`, `LICENSE`
- Create: `packages/core/src/select.ts`
- Move: `packages/miner/test/setup.network.test.ts` → `packages/safe-config/test/setup.network.test.ts`
- Modify: `packages/miner/src/setup.ts` (delete), `packages/miner/src/cli.ts`, `packages/miner/src/deploy.ts`, `packages/miner/src/report.ts`, `packages/miner/package.json`, `packages/core/src/index.ts`
- Test: `packages/core/test/select.test.ts`

**Interfaces:**
- Consumes: `Candidate` (core), the existing `setup.ts` implementation.
- Produces:
  - `@safe-vanity-blockie/safe-config` exporting `SetupInput`, `SafeSetup`, `loadSafeConstants(input): Promise<SafeSetup>`, `verifyWithProtocolKit(setup, saltNonce, address): Promise<void>`, `ZKSYNC_CHAIN_IDS`
  - `@safe-vanity-blockie/core` additionally exporting:
    - `filterCandidates(candidates: Candidate[], filters: { twoColor: boolean; minContrast: number }): Candidate[]`
    - `SelectReportedResult { reported: Candidate[]; droppedCount: number; usedFallback: boolean }`
    - `selectReported(candidates: Candidate[], options: { twoColor: boolean; minContrast: number; keep: number }): SelectReportedResult`
    - `formatScore(score: number, maxScore: number): string`

- [ ] **Step 1: Create the `safe-config` package and move the code**

`packages/safe-config/package.json`:

```json
{
  "name": "@safe-vanity-blockie/safe-config",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "LICENSE"],
  "sideEffects": false,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepublishOnly": "pnpm build",
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

`packages/safe-config/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/safe-config/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.network.test.ts', '**/node_modules/**'],
    passWithNoTests: true,
  },
})
```

`packages/safe-config/vitest.network.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.network.test.ts'], testTimeout: 120_000 },
})
```

Then move the files with git so history follows them:

```bash
mkdir -p packages/safe-config/src packages/safe-config/test
git mv packages/miner/src/setup.ts packages/safe-config/src/setup.ts
git mv packages/miner/test/setup.network.test.ts packages/safe-config/test/setup.network.test.ts
cp LICENSE packages/safe-config/LICENSE
```

`packages/safe-config/src/index.ts`:

```ts
export {
  ZKSYNC_CHAIN_IDS,
  loadSafeConstants,
  verifyWithProtocolKit,
  type SafeSetup,
  type SetupInput,
} from './setup.js'
```

In the moved test, change the import of `../src/setup.js` so it still resolves (the relative path is unchanged, so no edit is needed) and confirm it imports `@safe-vanity-blockie/core` for `createAddressDeriver`/`createKeccak256` — it already does.

- [ ] **Step 2: Point `miner` at the new package**

In `packages/miner/package.json`, add to `dependencies`:

```json
"@safe-vanity-blockie/safe-config": "workspace:*"
```

and remove `"@safe-global/protocol-kit"` and `"@safe-global/types-kit"` only if no other miner file imports them — `deploy.ts` imports `Safe` and `getSafeAddressFromDeploymentTx` from protocol-kit, so **keep both**.

In `packages/miner/src/cli.ts` and `packages/miner/src/deploy.ts`, replace:

```ts
import { loadSafeConstants, verifyWithProtocolKit } from './setup.js'
```

with:

```ts
import { loadSafeConstants, verifyWithProtocolKit } from '@safe-vanity-blockie/safe-config'
```

Then install:

```bash
mise exec -- pnpm install
```

- [ ] **Step 3: Write the failing test for the shared selection helpers**

`packages/core/test/select.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { filterCandidates, formatScore, selectReported } from '../src/select.js'
import type { Candidate } from '../src/miner.js'

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    saltNonce: '1',
    address: '0x' + '11'.repeat(20),
    score: 120,
    maxScore: 133,
    twoColor: true,
    contrast: 150,
    regions: { mouth: 'smile' },
    ...overrides,
  }
}

describe('filterCandidates', () => {
  it('drops three-colour results when two-colour is requested', () => {
    const entries = [candidate({ address: '0xa' }), candidate({ address: '0xb', twoColor: false })]
    expect(filterCandidates(entries, { twoColor: true, minContrast: 0 })).toHaveLength(1)
    expect(filterCandidates(entries, { twoColor: false, minContrast: 0 })).toHaveLength(2)
  })

  it('drops results below the contrast floor', () => {
    const entries = [
      candidate({ address: '0xa', contrast: 200 }),
      candidate({ address: '0xb', contrast: 50 }),
    ]
    expect(filterCandidates(entries, { twoColor: false, minContrast: 150 })).toHaveLength(1)
  })
})

describe('selectReported', () => {
  const options = { twoColor: true, minContrast: 0, keep: 2 }

  it('returns at most keep entries and reports how many were dropped', () => {
    const entries = [
      candidate({ address: '0xa', score: 125, twoColor: false }),
      candidate({ address: '0xb', score: 120 }),
      candidate({ address: '0xc', score: 119 }),
      candidate({ address: '0xd', score: 118 }),
    ]
    const result = selectReported(entries, options)
    expect(result.reported.map((entry) => entry.address)).toEqual(['0xb', '0xc'])
    expect(result.droppedCount).toBe(1)
    expect(result.usedFallback).toBe(false)
  })

  it('falls back to the unfiltered list rather than showing nothing', () => {
    const entries = [candidate({ address: '0xa', twoColor: false })]
    const result = selectReported(entries, options)
    expect(result.reported).toHaveLength(1)
    expect(result.usedFallback).toBe(true)
    expect(result.droppedCount).toBe(0)
  })

  it('is empty for an empty input', () => {
    expect(selectReported([], options)).toEqual({
      reported: [],
      droppedCount: 0,
      usedFallback: false,
    })
  })
})

describe('formatScore', () => {
  it('renders a percentage with one decimal', () => {
    expect(formatScore(133, 133)).toBe('100.0%')
    expect(formatScore(120, 133)).toBe('90.2%')
    expect(formatScore(0, 133)).toBe('0.0%')
  })

  it('does not divide by zero', () => {
    expect(formatScore(0, 0)).toBe('0.0%')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/core test select`
Expected: FAIL — `Failed to resolve import "../src/select.js"`.

- [ ] **Step 5: Write `core/src/select.ts`**

Move the bodies out of `packages/miner/src/report.ts` (`filterCandidates`, `formatScore`) and `packages/miner/src/cli.ts` (`selectReported`, `SelectReportedResult`) into this file verbatim — do not re-derive them.

`packages/core/src/select.ts`:

```ts
import type { Candidate } from './miner.js'

export function filterCandidates(
  candidates: Candidate[],
  filters: { twoColor: boolean; minContrast: number },
): Candidate[] {
  return candidates.filter(
    (candidate) =>
      (!filters.twoColor || candidate.twoColor) && candidate.contrast >= filters.minContrast,
  )
}

export interface SelectReportedResult {
  reported: Candidate[]
  /** How many candidates the filters removed. Zero when the fallback was used. */
  droppedCount: number
  /** True when filtering removed everything and the unfiltered list is being shown instead. */
  usedFallback: boolean
}

/**
 * Retention is score-ranked and blind to twoColor/minContrast, which are applied here — so
 * callers must retain far more candidates than they intend to display, or the filters will
 * have nothing left to choose from.
 */
export function selectReported(
  candidates: Candidate[],
  options: { twoColor: boolean; minContrast: number; keep: number },
): SelectReportedResult {
  const filtered = filterCandidates(candidates, {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
  })
  const usedFallback = filtered.length === 0 && candidates.length > 0
  const usable = usedFallback ? candidates : filtered
  const droppedCount = usedFallback ? 0 : candidates.length - filtered.length
  return { reported: usable.slice(0, options.keep), droppedCount, usedFallback }
}

/**
 * A score as a percentage of the template's maximum. One decimal, because the interesting
 * results sit in a narrow band near the top and whole percent would collapse distinct scores.
 */
export function formatScore(score: number, maxScore: number): string {
  if (maxScore <= 0) return '0.0%'
  return `${((score / maxScore) * 100).toFixed(1)}%`
}
```

Add to `packages/core/src/index.ts`:

```ts
export {
  filterCandidates,
  formatScore,
  selectReported,
  type SelectReportedResult,
} from './select.js'
```

- [ ] **Step 6: Delete the old copies and re-point the miner**

In `packages/miner/src/report.ts`, delete the `filterCandidates` and `formatScore` definitions and import them instead:

```ts
import { filterCandidates, formatScore, type Candidate } from '@safe-vanity-blockie/core'
```

`report.ts` must keep re-exporting `filterCandidates` if any test imports it from there — check with `grep -rn "filterCandidates" packages/miner` and update those imports to come from core rather than adding a re-export.

In `packages/miner/src/cli.ts`, delete the `selectReported` definition and `SelectReportedResult` interface, and import them:

```ts
import { selectReported, formatScore, ... } from '@safe-vanity-blockie/core'
```

`cli.ts` currently exports `selectReported` for its own tests. Update `packages/miner/test/cli.test.ts` to import it from `@safe-vanity-blockie/core` instead.

- [ ] **Step 7: Run every suite to verify nothing regressed**

Run: `mise exec -- pnpm test`
Expected: PASS — core gains the new select tests; miner's 76 stay green.

Run: `mise exec -- pnpm typecheck`
Expected: PASS, both packages plus the new one.

Run: `mise exec -- pnpm test:network`
Expected: PASS — the moved `setup.network.test.ts` runs under `safe-config` now and still agrees with `predictSafeAddress` on mainnet.

- [ ] **Step 8: Stage (the controller commits)**

```bash
git add -A
```

Report the work as staged. Suggested commit message: `refactor: extract safe-config package and share candidate selection from core`.

---

### Task 2: Next.js app scaffold and the Configure step

**Files:**
- Create: `packages/web/package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `lib/config.ts`, `components/ConfigForm.tsx`, `components/SecurityNotice.tsx`
- Test: `packages/web/test/config.test.ts`, `packages/web/test/ConfigForm.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier web tasks.
- Produces:
  - `SUPPORTED_CHAINS: readonly { id: number; name: string }[]`
  - `SUPPORTED_SAFE_VERSIONS: readonly ['1.4.1', '1.3.0']`, `SupportedSafeVersion`
  - `MineConfig { owners: string[]; threshold: number; safeVersion: SupportedSafeVersion; chainId: number }`
  - `ConfigErrors = Partial<Record<'owners' | 'threshold' | 'safeVersion' | 'chainId', string>>`
  - `validateMineConfig(input: { owners: string[]; threshold: number; safeVersion: string; chainId: number }): { config?: MineConfig; errors: ConfigErrors }`
  - `<ConfigForm value={…} onChange={…} onSubmit={(config: MineConfig) => void} />`
  - `<SecurityNotice />`

- [ ] **Step 1: Create the package**

`packages/web/package.json`:

```json
{
  "name": "@safe-vanity-blockie/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@safe-global/protocol-kit": "^8.0.5",
    "@safe-vanity-blockie/core": "workspace:*",
    "@safe-vanity-blockie/safe-config": "workspace:*",
    "@tanstack/react-query": "^5.101.4",
    "next": "^16.3.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "viem": "^2.55.11",
    "wagmi": "^3.7.6"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.3",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.0.5",
    "jsdom": "^30.0.1"
  }
}
```

`packages/web/tsconfig.json` — Next needs different module settings from the repo base, so this overrides several of them:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "noEmit": true,
    "allowJs": true,
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`packages/web/next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // core and safe-config ship compiled ESM, so no transpilation is needed. If a future
  // dependency ships TypeScript or ESM-only CJS interop breaks, add it to transpilePackages.
  reactStrictMode: true,
}

export default nextConfig
```

`packages/web/vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
  },
})
```

`packages/web/vitest.setup.ts`:

```ts
import '@testing-library/react'
```

Install:

```bash
mise exec -- pnpm install
```

- [ ] **Step 2: Write the failing validation test**

`packages/web/test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateMineConfig } from '../lib/config.js'

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
    expect(errors.owners).toMatch(/duplicate/)
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
      /unsupported/,
    )
  })

  it('rejects a chain the app does not support', () => {
    expect(validateMineConfig(input({ chainId: 999_999 })).errors.chainId).toMatch(/not supported/)
  })

  it('rejects zkSync-family chains explicitly, since they derive addresses differently', () => {
    expect(validateMineConfig(input({ chainId: 324 })).errors.chainId).toMatch(/zkSync/)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: FAIL — `Failed to resolve import "../lib/config.js"`.

- [ ] **Step 4: Write `lib/config.ts`**

```ts
import { ZKSYNC_CHAIN_IDS } from '@safe-vanity-blockie/safe-config'

export const SUPPORTED_SAFE_VERSIONS = ['1.4.1', '1.3.0'] as const
export type SupportedSafeVersion = (typeof SUPPORTED_SAFE_VERSIONS)[number]

/** Chains with canonical Safe deployments that this app offers. */
export const SUPPORTED_CHAINS = [
  { id: 1, name: 'Ethereum' },
  { id: 11155111, name: 'Sepolia' },
  { id: 137, name: 'Polygon' },
  { id: 42161, name: 'Arbitrum One' },
  { id: 10, name: 'OP Mainnet' },
  { id: 8453, name: 'Base' },
  { id: 100, name: 'Gnosis' },
] as const

export interface MineConfig {
  owners: string[]
  threshold: number
  safeVersion: SupportedSafeVersion
  chainId: number
}

export type ConfigErrors = Partial<
  Record<'owners' | 'threshold' | 'safeVersion' | 'chainId', string>
>

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

export function validateMineConfig(input: {
  owners: string[]
  threshold: number
  safeVersion: string
  chainId: number
}): { config?: MineConfig; errors: ConfigErrors } {
  const errors: ConfigErrors = {}

  const owners = input.owners.map((owner) => owner.trim()).filter((owner) => owner.length > 0)
  if (owners.length === 0) {
    errors.owners = 'Add at least one owner address.'
  } else {
    const invalid = owners.find((owner) => !ADDRESS_PATTERN.test(owner))
    if (invalid) {
      errors.owners = `"${invalid}" is not a valid address.`
    } else {
      const seen = new Set<string>()
      const duplicate = owners.find((owner) => {
        const key = owner.toLowerCase()
        if (seen.has(key)) return true
        seen.add(key)
        return false
      })
      if (duplicate) errors.owners = `Duplicate owner ${duplicate}.`
    }
  }

  if (!Number.isInteger(input.threshold) || input.threshold < 1) {
    errors.threshold = 'Threshold must be at least 1.'
  } else if (!errors.owners && input.threshold > owners.length) {
    errors.threshold = `Threshold ${input.threshold} exceeds the ${owners.length} owner${
      owners.length === 1 ? '' : 's'
    }.`
  }

  if (!SUPPORTED_SAFE_VERSIONS.includes(input.safeVersion as SupportedSafeVersion)) {
    errors.safeVersion = `Unsupported Safe version "${input.safeVersion}".`
  }

  if (ZKSYNC_CHAIN_IDS.has(BigInt(input.chainId))) {
    errors.chainId = 'zkSync-based chains derive addresses with a different formula.'
  } else if (!SUPPORTED_CHAINS.some((chain) => chain.id === input.chainId)) {
    errors.chainId = `Chain ${input.chainId} is not supported.`
  }

  if (Object.keys(errors).length > 0) return { errors }
  return {
    config: {
      owners,
      threshold: input.threshold,
      safeVersion: input.safeVersion as SupportedSafeVersion,
      chainId: input.chainId,
    },
    errors: {},
  }
}
```

- [ ] **Step 5: Write the failing component test**

`packages/web/test/ConfigForm.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigForm } from '../components/ConfigForm.js'

const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

describe('ConfigForm', () => {
  it('surfaces a validation error instead of submitting', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/owners/i), '0xnope')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText(/not a valid address/i)).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a valid config', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/owners/i), OWNER)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      owners: [OWNER],
      threshold: 1,
      safeVersion: '1.4.1',
      chainId: 1,
    })
  })

  it('warns that owners are part of the address', () => {
    render(<ConfigForm onSubmit={vi.fn()} />)
    expect(screen.getByText(/changing them re-rolls/i)).toBeDefined()
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: FAIL — `Failed to resolve import "../components/ConfigForm.js"`.

- [ ] **Step 7: Write the components and app shell**

`packages/web/components/SecurityNotice.tsx`:

```tsx
export function SecurityNotice() {
  return (
    <p className="notice" role="note">
      <strong>A matching identicon is cosmetic.</strong> Never treat it as proof of an address —
      blockie look-alikes are a known phishing vector. Always verify the full address.
    </p>
  )
}
```

`packages/web/components/ConfigForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import {
  SUPPORTED_CHAINS,
  SUPPORTED_SAFE_VERSIONS,
  validateMineConfig,
  type ConfigErrors,
  type MineConfig,
} from '../lib/config.js'

export interface ConfigFormProps {
  initial?: Partial<{ owners: string; threshold: number; safeVersion: string; chainId: number }>
  onSubmit: (config: MineConfig) => void
}

export function ConfigForm({ initial, onSubmit }: ConfigFormProps) {
  const [owners, setOwners] = useState(initial?.owners ?? '')
  const [threshold, setThreshold] = useState(initial?.threshold ?? 1)
  const [safeVersion, setSafeVersion] = useState(initial?.safeVersion ?? '1.4.1')
  const [chainId, setChainId] = useState(initial?.chainId ?? 1)
  const [errors, setErrors] = useState<ConfigErrors>({})

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const result = validateMineConfig({
      owners: owners.split(',').map((owner) => owner.trim()),
      threshold,
      safeVersion,
      chainId,
    })
    setErrors(result.errors)
    if (result.config) onSubmit(result.config)
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="owners">Owners (comma-separated)</label>
      <input
        id="owners"
        value={owners}
        onChange={(event) => setOwners(event.target.value)}
        placeholder="0x…, 0x…"
      />
      <p className="hint">
        Owners are part of the Safe address — changing them re-rolls every result.
      </p>
      {errors.owners && <p role="alert">{errors.owners}</p>}

      <label htmlFor="threshold">Threshold</label>
      <input
        id="threshold"
        type="number"
        min={1}
        value={threshold}
        onChange={(event) => setThreshold(Number(event.target.value))}
      />
      {errors.threshold && <p role="alert">{errors.threshold}</p>}

      <label htmlFor="safeVersion">Safe version</label>
      <select
        id="safeVersion"
        value={safeVersion}
        onChange={(event) => setSafeVersion(event.target.value)}
      >
        {SUPPORTED_SAFE_VERSIONS.map((version) => (
          <option key={version} value={version}>
            {version}
          </option>
        ))}
      </select>
      {errors.safeVersion && <p role="alert">{errors.safeVersion}</p>}

      <label htmlFor="chainId">Chain</label>
      <select
        id="chainId"
        value={chainId}
        onChange={(event) => setChainId(Number(event.target.value))}
      >
        {SUPPORTED_CHAINS.map((chain) => (
          <option key={chain.id} value={chain.id}>
            {chain.name}
          </option>
        ))}
      </select>
      {errors.chainId && <p role="alert">{errors.chainId}</p>}

      <button type="submit">Continue</button>
    </form>
  )
}
```

`packages/web/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Safe Vanity Blockie',
  description: 'Mine a Safe address whose identicon renders as a face.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <h1>Safe Vanity Blockie</h1>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
```

`packages/web/app/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ConfigForm } from '../components/ConfigForm.js'
import { SecurityNotice } from '../components/SecurityNotice.js'
import type { MineConfig } from '../lib/config.js'

export default function Page() {
  const [config, setConfig] = useState<MineConfig | undefined>()

  return (
    <>
      <SecurityNotice />
      {config ? (
        <pre>{JSON.stringify(config, null, 2)}</pre>
      ) : (
        <ConfigForm onSubmit={setConfig} />
      )}
    </>
  )
}
```

`packages/web/app/globals.css` — minimal, readable defaults:

```css
:root { color-scheme: light dark; }
body { font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; padding: 2rem; max-width: 72rem; }
form { display: grid; gap: .5rem; max-width: 34rem; }
label { font-weight: 600; }
input, select { padding: .5rem; font: inherit; }
.hint { color: color-mix(in srgb, currentColor 60%, transparent); font-size: 13px; margin: 0; }
.notice { border: 1px solid currentColor; border-radius: .5rem; padding: .75rem 1rem; }
[role='alert'] { color: #b00020; margin: 0; }
button { padding: .6rem 1rem; font: inherit; cursor: pointer; }
```

- [ ] **Step 8: Run tests and the production build**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — 12 tests.

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web build`
Expected: Next builds with no type errors. If it fails to resolve `@safe-vanity-blockie/core`, run `mise exec -- pnpm -r build` first — the web app consumes core's compiled `dist`.

- [ ] **Step 9: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): scaffold the Next.js app and the config step`.

---

### Task 3: Face selection — presets, expression picker, live preview

**Files:**
- Create: `packages/web/lib/face-selection.ts`, `packages/web/components/Blockie.tsx`, `packages/web/components/FacePicker.tsx`
- Modify: `packages/web/app/page.tsx`
- Test: `packages/web/test/face-selection.test.ts`, `packages/web/test/FacePicker.test.tsx`

**Interfaces:**
- Consumes: `MOUTHS`, `faceWithMouths`, `getTemplate`, `compileFace`, `bloSvg` from `@safe-vanity-blockie/core`.
- Produces:
  - `ALL_MOUTH_NAMES: string[]`
  - `faceSpecFromSelection(mouthNames: string[]): FaceSpec` — throws `Error` when the list is empty
  - `<Blockie address={string} size={number} />`
  - `<FacePicker value={string[]} onChange={(names: string[]) => void} />`

- [ ] **Step 1: Write the failing test**

`packages/web/test/face-selection.test.ts`:

```ts
import { compileFace } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { ALL_MOUTH_NAMES, faceSpecFromSelection } from '../lib/face-selection.js'

describe('faceSpecFromSelection', () => {
  it('offers the five built-in expressions', () => {
    expect(ALL_MOUTH_NAMES).toEqual(['smile', 'frown', 'neutral', 'open', 'small'])
  })

  it('builds a spec whose maximum is unchanged by how many expressions are accepted', () => {
    // Every expression is normalised to the same budget, so the ceiling is the same whether
    // the user accepts one expression or all five.
    expect(compileFace(faceSpecFromSelection(['smile'])).maxScore).toBe(133)
    expect(compileFace(faceSpecFromSelection(ALL_MOUTH_NAMES)).maxScore).toBe(133)
  })

  it('keeps only the chosen expressions', () => {
    const spec = faceSpecFromSelection(['smile', 'frown'])
    expect(spec.regions[0].alternatives.map((alternative) => alternative.name)).toEqual([
      'smile',
      'frown',
    ])
  })

  it('rejects an empty selection rather than producing an unscoreable spec', () => {
    expect(() => faceSpecFromSelection([])).toThrow(/at least one expression/)
  })

  it('rejects an unknown expression name', () => {
    expect(() => faceSpecFromSelection(['grin'])).toThrow(/unknown mouth "grin"/)
  })
})
```

`packages/web/test/FacePicker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FacePicker } from '../components/FacePicker.js'

describe('FacePicker', () => {
  it('renders a toggle for every expression', () => {
    render(<FacePicker value={['smile']} onChange={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
  })

  it('adds an expression when its toggle is checked', async () => {
    const onChange = vi.fn()
    render(<FacePicker value={['smile']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /frown/i }))
    expect(onChange).toHaveBeenCalledWith(['smile', 'frown'])
  })

  it('refuses to remove the last expression, since a face needs a mouth', async () => {
    const onChange = vi.fn()
    render(<FacePicker value={['smile']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /smile/i }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/at least one/i))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: FAIL — `Failed to resolve import "../lib/face-selection.js"`.

- [ ] **Step 3: Write `lib/face-selection.ts`**

```ts
import { MOUTHS, faceWithMouths, type FaceSpec } from '@safe-vanity-blockie/core'

export const ALL_MOUTH_NAMES: string[] = MOUTHS.map((mouth) => mouth.name)

/**
 * A FaceSpec accepting exactly the chosen expressions. Every expression is normalised to the
 * same budget, so accepting more of them widens the target without changing the maximum score.
 */
export function faceSpecFromSelection(mouthNames: string[]): FaceSpec {
  if (mouthNames.length === 0) {
    throw new Error('Choose at least one expression — a face needs a mouth to score against.')
  }
  return faceWithMouths(mouthNames.join('+'), mouthNames)
}
```

- [ ] **Step 4: Write the components**

`packages/web/components/Blockie.tsx` — renders the real `blo` SVG, so the preview is exactly what a wallet shows:

```tsx
import { bloSvg } from '@safe-vanity-blockie/core'

export interface BlockieProps {
  address: string
  size?: number
}

export function Blockie({ address, size = 64 }: BlockieProps) {
  // bloSvg emits a self-contained <svg> built from numeric HSL values and integer coordinates
  // derived from the address; it never echoes the address string into the markup.
  return (
    <span
      aria-label={`Identicon for ${address}`}
      role="img"
      dangerouslySetInnerHTML={{ __html: bloSvg(address, size) }}
    />
  )
}
```

`packages/web/components/FacePicker.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ALL_MOUTH_NAMES } from '../lib/face-selection.js'

export interface FacePickerProps {
  value: string[]
  onChange: (mouthNames: string[]) => void
}

export function FacePicker({ value, onChange }: FacePickerProps) {
  const [error, setError] = useState<string | undefined>()

  const toggle = (name: string) => {
    if (value.includes(name)) {
      if (value.length === 1) {
        setError('Keep at least one expression — a face needs a mouth to score against.')
        return
      }
      setError(undefined)
      onChange(value.filter((entry) => entry !== name))
      return
    }
    setError(undefined)
    onChange([...value, name])
  }

  return (
    <fieldset>
      <legend>Accepted expressions</legend>
      <p className="hint">
        Each candidate is credited with its best-fitting expression, so accepting more of them
        finds a good face sooner.
      </p>
      {ALL_MOUTH_NAMES.map((name) => (
        <label key={name}>
          <input
            type="checkbox"
            checked={value.includes(name)}
            onChange={() => toggle(name)}
            aria-label={name}
          />
          {name}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  )
}
```

Wire both into `app/page.tsx` as the second step, after a config is submitted, keeping the existing `SecurityNotice` at the top:

```tsx
const [mouths, setMouths] = useState<string[]>(['smile', 'frown', 'neutral', 'open', 'small'])
```

and render `<FacePicker value={mouths} onChange={setMouths} />` once `config` is set.

- [ ] **Step 5: Run tests**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — 20 tests.

- [ ] **Step 6: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add face selection with a live blo preview`.

---

### Task 4: The browser mining loop

The heart of the app, and the one place its architecture genuinely differs from the CLI. Written as a pure module so it is testable in Node under vitest, with the Worker file a thin wrapper around it (Task 5).

**Files:**
- Create: `packages/web/lib/browser-miner.ts`
- Test: `packages/web/test/browser-miner.test.ts`

**Interfaces:**
- Consumes: `createKeccak256`, `createMiner`, `compileFace`, `parseFaceSpec`, `hexToBytes`, `Leaderboard`, `Candidate`, `FaceSpec` from core.
- Produces:
  - `SLICE_SIZE = 50_000`
  - `BrowserMineOptions { constantsHex: { initializerHash: string; factory: string; initCodeHash: string }; faceSpec: FaceSpec; start: number; count: number; keep: number; sliceSize?: number; onSlice?: (progress: { scanned: number; candidates: Candidate[] }) => void; shouldStop?: () => boolean; yieldToEventLoop?: () => Promise<void> }`
  - `BrowserMineResult { scanned: number; candidates: Candidate[] }`
  - `runBrowserMiner(options: BrowserMineOptions): Promise<BrowserMineResult>`

- [ ] **Step 1: Write the failing test**

`packages/web/test/browser-miner.test.ts`:

```ts
import {
  compileFace,
  createKeccak256,
  createMiner,
  getTemplate,
  hexToBytes,
} from '@safe-vanity-blockie/core'
import { describe, expect, it, vi } from 'vitest'
import { runBrowserMiner } from '../lib/browser-miner.js'

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

describe('runBrowserMiner', () => {
  it('produces exactly what a single synchronous run over the same range produces', async () => {
    const result = await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      count: 20_000,
      keep: 10,
      sliceSize: 3_000,
    })

    const keccak256 = await createKeccak256()
    const single = createMiner(CONSTANTS, compileFace(FACE_SPEC), keccak256).mine({
      start: 0,
      count: 20_000,
      keep: 10,
    })

    expect(result.scanned).toBe(20_000)
    expect(result.candidates).toEqual(single.candidates)
  })

  it('yields between slices so a stop signal can be observed', async () => {
    const yieldToEventLoop = vi.fn(async () => {})
    await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      count: 10_000,
      keep: 5,
      sliceSize: 2_500,
      yieldToEventLoop,
    })
    // four slices means four opportunities for the message queue to drain
    expect(yieldToEventLoop).toHaveBeenCalledTimes(4)
  })

  it('stops at the next slice boundary when asked', async () => {
    let slices = 0
    const result = await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      count: 1_000_000,
      keep: 5,
      sliceSize: 1_000,
      shouldStop: () => ++slices >= 3,
    })
    expect(result.scanned).toBe(3_000)
  })

  it('reports cumulative progress with the best so far at every slice', async () => {
    const seen: number[] = []
    await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 0,
      count: 9_000,
      keep: 5,
      sliceSize: 3_000,
      onSlice: (progress) => {
        seen.push(progress.scanned)
        expect(progress.candidates.length).toBeLessThanOrEqual(5)
      },
    })
    expect(seen).toEqual([3_000, 6_000, 9_000])
  })

  it('covers the exact range asked for when count is not a multiple of the slice', async () => {
    const result = await runBrowserMiner({
      constantsHex: CONSTANTS_HEX,
      faceSpec: FACE_SPEC,
      start: 100,
      count: 2_500,
      keep: 3,
      sliceSize: 1_000,
    })
    const keccak256 = await createKeccak256()
    const single = createMiner(CONSTANTS, compileFace(FACE_SPEC), keccak256).mine({
      start: 100,
      count: 2_500,
      keep: 3,
    })
    expect(result.scanned).toBe(2_500)
    expect(result.candidates).toEqual(single.candidates)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test browser-miner`
Expected: FAIL — `Failed to resolve import "../lib/browser-miner.js"`.

- [ ] **Step 3: Write `lib/browser-miner.ts`**

```ts
import {
  Leaderboard,
  compileFace,
  createKeccak256,
  createMiner,
  hexToBytes,
  type Candidate,
  type FaceSpec,
} from '@safe-vanity-blockie/core'

/**
 * Nonces per synchronous burst. At roughly 400k nonces/s per core this is ~125ms of work,
 * short enough that a stop message is acted on almost immediately and the worker stays
 * responsive, long enough that the per-slice overhead is negligible.
 */
export const SLICE_SIZE = 50_000

export interface BrowserMineOptions {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  start: number
  count: number
  keep: number
  sliceSize?: number
  onSlice?: (progress: { scanned: number; candidates: Candidate[] }) => void
  shouldStop?: () => boolean
  /** Overridable for tests; defaults to a macrotask, which lets postMessage be delivered. */
  yieldToEventLoop?: () => Promise<void>
}

export interface BrowserMineResult {
  scanned: number
  candidates: Candidate[]
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Mines a range in bounded synchronous slices, awaiting a macrotask between them.
 *
 * core's mine() is synchronous by design — that is what makes it fast — so a worker running
 * one long call never drains its message queue. The Node CLI solves this with a
 * SharedArrayBuffer flag and Atomics; in a browser that would require cross-origin isolation
 * (COOP/COEP), which breaks wallet popups and injected providers. Slicing achieves the same
 * responsiveness with no headers and no shared memory.
 */
export async function runBrowserMiner(options: BrowserMineOptions): Promise<BrowserMineResult> {
  const constants = {
    initializerHash: hexToBytes(options.constantsHex.initializerHash),
    factory: hexToBytes(options.constantsHex.factory),
    initCodeHash: hexToBytes(options.constantsHex.initCodeHash),
  }
  const keccak256 = await createKeccak256()
  const miner = createMiner(constants, compileFace(options.faceSpec), keccak256)
  const yieldToEventLoop = options.yieldToEventLoop ?? macrotask
  const sliceSize = Math.max(1, options.sliceSize ?? SLICE_SIZE)

  // mine() returns a fresh leaderboard per call, so the run-long board lives here and each
  // slice is merged into it. merge() dedupes by address, so this is idempotent.
  const board = new Leaderboard(options.keep)
  let scanned = 0

  while (scanned < options.count) {
    const sliceCount = Math.min(sliceSize, options.count - scanned)
    const slice = miner.mine({
      start: options.start + scanned,
      count: sliceCount,
      keep: options.keep,
    })
    board.merge(slice.candidates)
    scanned += slice.scanned

    options.onSlice?.({ scanned, candidates: board.entries() })
    await yieldToEventLoop()
    if (options.shouldStop?.()) break
  }

  return { scanned, candidates: board.entries() }
}
```

- [ ] **Step 4: Run tests**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test browser-miner`
Expected: PASS — 5 tests, including the equality check against a single synchronous run.

- [ ] **Step 5: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add the sliced browser mining loop`.

---

### Task 5: Web Worker and the `useMiner` hook

**Files:**
- Create: `packages/web/workers/mine.worker.ts`, `packages/web/lib/worker-protocol.ts`, `packages/web/lib/use-miner.ts`
- Test: `packages/web/test/worker-protocol.test.ts`, `packages/web/test/use-miner.test.tsx`

**Interfaces:**
- Consumes: `runBrowserMiner` (Task 4), `selectReported` (Task 1).
- Produces:
  - `WorkerRequest = { type: 'start'; input: BrowserWorkerInput } | { type: 'stop' }`
  - `BrowserWorkerInput { constantsHex; faceSpec; start; count; keep; sliceSize? }`
  - `WorkerEvent = { type: 'progress'; scanned: number; candidates: Candidate[] } | { type: 'done'; scanned: number; candidates: Candidate[] } | { type: 'error'; message: string }`
  - `WORKER_BLOCK = 1_000_000_000_000`
  - `planWorkerRanges(start: number, workers: number, perWorker: number): { start: number; count: number }[]`
  - `nextStartFrom(start: number, perWorker: number, scannedPerWorker: number[]): number`
  - `useMiner(): { state: MinerState; start(input: StartMiningInput): void; stop(): void }`
  - `MinerState { running: boolean; scanned: number; elapsedMs: number; rate: number; candidates: Candidate[]; droppedCount: number; error?: string; nextStart: number }`

- [ ] **Step 1: Write the failing range-planning test**

`packages/web/test/worker-protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextStartFrom, planWorkerRanges } from '../lib/worker-protocol.js'

describe('planWorkerRanges', () => {
  it('gives every worker a disjoint, gapless block', () => {
    expect(planWorkerRanges(0, 3, 1_000)).toEqual([
      { start: 0, count: 1_000 },
      { start: 1_000, count: 1_000 },
      { start: 2_000, count: 1_000 },
    ])
  })

  it('honours a non-zero starting nonce', () => {
    expect(planWorkerRanges(500, 2, 1_000)).toEqual([
      { start: 500, count: 1_000 },
      { start: 1_500, count: 1_000 },
    ])
  })
})

describe('nextStartFrom', () => {
  it('is past every range the run covered, so a follow-up never rescans', () => {
    // Worker w covered [start + w*perWorker, + scanned_w). Taking max(scanned) alone would
    // land inside worker 1's range and re-mine most of the run.
    expect(nextStartFrom(500, 1_000, [1_000, 1_000, 1_000])).toBe(3_500)
    expect(nextStartFrom(0, 25_000, [25_000, 25_000, 25_000, 25_000])).toBe(100_000)
  })

  it('handles an early stop where workers scanned unequal amounts', () => {
    // ends are [1000, 1400, 2050]; the highest is what a follow-up must start from
    expect(nextStartFrom(0, 1_000, [1_000, 400, 50])).toBe(2_050)
  })

  it('reduces to start + scanned for a single worker', () => {
    expect(nextStartFrom(0, 1_000, [640])).toBe(640)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test worker-protocol`
Expected: FAIL — `Failed to resolve import "../lib/worker-protocol.js"`.

- [ ] **Step 3: Write `lib/worker-protocol.ts`**

```ts
import type { Candidate, FaceSpec } from '@safe-vanity-blockie/core'

export interface BrowserWorkerInput {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  start: number
  count: number
  keep: number
  sliceSize?: number
}

export type WorkerRequest = { type: 'start'; input: BrowserWorkerInput } | { type: 'stop' }

export type WorkerEvent =
  | { type: 'progress'; scanned: number; candidates: Candidate[] }
  | { type: 'done'; scanned: number; candidates: Candidate[] }
  | { type: 'error'; message: string }

/**
 * Block size handed to each worker on an unbounded run. Large enough that a worker never
 * reaches the next worker's territory.
 */
export const WORKER_BLOCK = 1_000_000_000_000

/** Worker w gets [start + w*perWorker, +perWorker) — disjoint and gapless. */
export function planWorkerRanges(
  start: number,
  workers: number,
  perWorker: number,
): { start: number; count: number }[] {
  return Array.from({ length: workers }, (_, index) => ({
    start: start + index * perWorker,
    count: perWorker,
  }))
}

/**
 * The highest END position any worker reached. A follow-up run from here never rescans
 * anything this run covered. Note the guarantee is no-rescan, not full coverage: after an
 * early stop the unfinished tails of slower workers are skipped.
 *
 * Taking max(scannedPerWorker) without the positional offset is WRONG — it compares each new
 * worker only against the old worker of the same index, so new worker 0 lands inside old
 * worker 1's range.
 */
export function nextStartFrom(
  start: number,
  perWorker: number,
  scannedPerWorker: number[],
): number {
  if (scannedPerWorker.length === 0) return start
  return start + Math.max(...scannedPerWorker.map((scanned, index) => index * perWorker + scanned))
}
```

- [ ] **Step 4: Write the Worker**

`packages/web/workers/mine.worker.ts` — imports only `core` and the pure loop, exactly as the Node worker imports only `core` and `hash-wasm`:

```ts
/// <reference lib="webworker" />
import { runBrowserMiner } from '../lib/browser-miner.js'
import type { WorkerEvent, WorkerRequest } from '../lib/worker-protocol.js'

let stopRequested = false

const post = (event: WorkerEvent) => self.postMessage(event)

self.onmessage = async (message: MessageEvent<WorkerRequest>) => {
  if (message.data.type === 'stop') {
    stopRequested = true
    return
  }

  const { input } = message.data
  stopRequested = false

  try {
    const result = await runBrowserMiner({
      ...input,
      onSlice: (progress) =>
        post({ type: 'progress', scanned: progress.scanned, candidates: progress.candidates }),
      shouldStop: () => stopRequested,
    })
    post({ type: 'done', scanned: result.scanned, candidates: result.candidates })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
```

- [ ] **Step 5: Write the failing hook test**

`packages/web/test/use-miner.test.tsx` — a fake Worker keeps this deterministic and offline; the real Worker is exercised manually in Step 8.

```tsx
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEvent, WorkerRequest } from '../lib/worker-protocol.js'
import { useMiner } from '../lib/use-miner.js'

const instances: FakeWorker[] = []

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null
  posted: WorkerRequest[] = []
  terminated = false

  constructor() {
    instances.push(this)
  }

  postMessage(request: WorkerRequest) {
    this.posted.push(request)
  }

  terminate() {
    this.terminated = true
  }

  emit(event: WorkerEvent) {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>)
  }
}

const candidate = (address: string, score: number, twoColor = true) => ({
  saltNonce: '1',
  address,
  score,
  maxScore: 133,
  twoColor,
  contrast: 150,
  regions: { mouth: 'smile' },
})

const startInput = {
  constantsHex: {
    initializerHash: '0x' + '11'.repeat(32),
    factory: '0x' + '22'.repeat(20),
    initCodeHash: '0x' + '33'.repeat(32),
  },
  faceSpec: { name: 'x', fixed: [], regions: [] },
  workers: 2,
  keep: 4,
  twoColor: true,
  minContrast: 0,
} as unknown as Parameters<ReturnType<typeof useMiner>['start']>[0]

beforeEach(() => {
  instances.length = 0
  vi.stubGlobal('Worker', FakeWorker)
})

describe('useMiner', () => {
  it('spawns one worker per requested thread and starts each on a disjoint range', () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    expect(instances).toHaveLength(2)
    const starts = instances.map((worker) => {
      const request = worker.posted[0]
      if (request.type !== 'start') throw new Error('expected a start request')
      return request.input.start
    })
    expect(new Set(starts).size).toBe(2)
    expect(result.current.state.running).toBe(true)
  })

  it('aggregates scanned counts across workers', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() => instances[0].emit({ type: 'progress', scanned: 1_000, candidates: [] }))
    act(() => instances[1].emit({ type: 'progress', scanned: 2_500, candidates: [] }))

    await waitFor(() => expect(result.current.state.scanned).toBe(3_500))
  })

  it('applies the same filters the results view uses, so the live view matches', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))

    act(() =>
      instances[0].emit({
        type: 'progress',
        scanned: 10,
        candidates: [candidate('0xa', 125, false), candidate('0xb', 120, true)],
      }),
    )

    await waitFor(() => {
      expect(result.current.state.candidates.map((entry) => entry.address)).toEqual(['0xb'])
      expect(result.current.state.droppedCount).toBe(1)
    })
  })

  it('stops every worker and clears running when asked', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))
    act(() => result.current.stop())

    for (const worker of instances) {
      expect(worker.posted.some((request) => request.type === 'stop')).toBe(true)
    }
    act(() => instances[0].emit({ type: 'done', scanned: 10, candidates: [] }))
    act(() => instances[1].emit({ type: 'done', scanned: 10, candidates: [] }))
    await waitFor(() => expect(result.current.state.running).toBe(false))
  })

  it('surfaces a worker error rather than hanging', async () => {
    const { result } = renderHook(() => useMiner())
    act(() => result.current.start(startInput))
    act(() => instances[0].emit({ type: 'error', message: 'wasm failed to load' }))
    await waitFor(() => expect(result.current.state.error).toMatch(/wasm failed to load/))
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test use-miner`
Expected: FAIL — `Failed to resolve import "../lib/use-miner.js"`.

- [ ] **Step 7: Write `lib/use-miner.ts`**

```ts
'use client'

import { selectReported, type Candidate, type FaceSpec } from '@safe-vanity-blockie/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Leaderboard } from '@safe-vanity-blockie/core'
import {
  WORKER_BLOCK,
  nextStartFrom,
  planWorkerRanges,
  type WorkerEvent,
  type WorkerRequest,
} from './worker-protocol.js'

/**
 * Retention is score-ranked and blind to the two-colour and contrast filters, which are
 * applied for display — so retain far more than we show, or filtering has nothing left.
 */
const RETENTION_MULTIPLIER = 20
const MIN_RETENTION = 200

export interface StartMiningInput {
  constantsHex: { initializerHash: string; factory: string; initCodeHash: string }
  faceSpec: FaceSpec
  workers: number
  keep: number
  twoColor: boolean
  minContrast: number
  start?: number
}

export interface MinerState {
  running: boolean
  scanned: number
  elapsedMs: number
  rate: number
  candidates: Candidate[]
  droppedCount: number
  error?: string
  nextStart: number
}

const IDLE: MinerState = {
  running: false,
  scanned: 0,
  elapsedMs: 0,
  rate: 0,
  candidates: [],
  droppedCount: 0,
  nextStart: 0,
}

export function useMiner(): {
  state: MinerState
  start: (input: StartMiningInput) => void
  stop: () => void
} {
  const [state, setState] = useState<MinerState>(IDLE)
  const workersRef = useRef<Worker[]>([])
  const scannedRef = useRef<number[]>([])
  const boardRef = useRef<Leaderboard | undefined>(undefined)
  const startedAtRef = useRef(0)
  const liveRef = useRef(0)

  const teardown = useCallback(() => {
    for (const worker of workersRef.current) worker.terminate()
    workersRef.current = []
  }, [])

  useEffect(() => teardown, [teardown])

  const start = useCallback((input: StartMiningInput) => {
    teardown()

    const retain = Math.max(input.keep * RETENTION_MULTIPLIER, MIN_RETENTION)
    const from = input.start ?? 0
    const ranges = planWorkerRanges(from, input.workers, WORKER_BLOCK)

    scannedRef.current = new Array(input.workers).fill(0)
    boardRef.current = new Leaderboard(retain)
    startedAtRef.current = Date.now()
    liveRef.current = input.workers
    setState({ ...IDLE, running: true })

    const publish = () => {
      const board = boardRef.current
      if (!board) return
      const scanned = scannedRef.current.reduce((a, b) => a + b, 0)
      const elapsedMs = Math.max(1, Date.now() - startedAtRef.current)
      const { reported, droppedCount } = selectReported(board.entries(), {
        twoColor: input.twoColor,
        minContrast: input.minContrast,
        keep: input.keep,
      })
      setState((previous) => ({
        ...previous,
        scanned,
        elapsedMs,
        rate: (scanned / elapsedMs) * 1000,
        candidates: reported,
        droppedCount,
        nextStart: nextStartFrom(from, WORKER_BLOCK, scannedRef.current),
      }))
    }

    workersRef.current = ranges.map((range, index) => {
      const worker = new Worker(new URL('../workers/mine.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (message: MessageEvent<WorkerEvent>) => {
        const event = message.data
        if (event.type === 'error') {
          setState((previous) => ({ ...previous, running: false, error: event.message }))
          teardown()
          return
        }
        scannedRef.current[index] = event.scanned
        boardRef.current?.merge(event.candidates)
        publish()
        if (event.type === 'done') {
          liveRef.current -= 1
          if (liveRef.current <= 0) setState((previous) => ({ ...previous, running: false }))
        }
      }
      const request: WorkerRequest = {
        type: 'start',
        input: {
          constantsHex: input.constantsHex,
          faceSpec: input.faceSpec,
          start: range.start,
          count: range.count,
          keep: retain,
        },
      }
      worker.postMessage(request)
      return worker
    })
  }, [teardown])

  const stop = useCallback(() => {
    const request: WorkerRequest = { type: 'stop' }
    for (const worker of workersRef.current) worker.postMessage(request)
  }, [])

  return { state, start, stop }
}
```

- [ ] **Step 8: Run tests, then verify the real Worker by hand**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — 30 tests.

Then start the dev server and confirm the real Worker path works, which the fake-Worker tests cannot cover:

```bash
mise exec -- pnpm --filter @safe-vanity-blockie/web dev
```

Temporarily render a button on the page that calls `start` with the synthetic constants from the browser-miner test and `workers: navigator.hardwareConcurrency - 1`. Open the app, click it, and confirm in the console that `scanned` climbs and `stop()` halts it within a second. Record the observed aggregate nonces/second in your report — spec §8.3 predicts 1.5–2M/s on a desktop. Remove the temporary button before staging.

- [ ] **Step 9: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add the mining worker and useMiner hook`.

---

### Task 6: Mining screen — live gallery and results

**Files:**
- Create: `packages/web/lib/use-safe-constants.ts`, `packages/web/components/ResultCard.tsx`, `packages/web/components/MiningView.tsx`
- Modify: `packages/web/app/page.tsx`, `packages/web/app/globals.css`
- Test: `packages/web/test/ResultCard.test.tsx`, `packages/web/test/MiningView.test.tsx`

**Interfaces:**
- Consumes: `useMiner` (Task 5), `loadSafeConstants` (Task 1), `formatScore`, `bloSvg`.
- Produces:
  - `useSafeConstants(config: MineConfig | undefined): { data?: SafeSetup; error?: string; loading: boolean }`
  - `<ResultCard candidate={Candidate} onSelect={(candidate: Candidate) => void} />`
  - `<MiningView config={MineConfig} faceSpec={FaceSpec} onSelect={(candidate: Candidate) => void} />`

- [ ] **Step 1: Write the failing tests**

`packages/web/test/ResultCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ResultCard } from '../components/ResultCard.js'

const candidate = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

describe('ResultCard', () => {
  it('shows the score as a percentage, not a raw fraction', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.queryByText(/120\/133/)).toBeNull()
  })

  it('shows the address, the saltNonce and the expression', () => {
    render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(screen.getByText(candidate.address)).toBeDefined()
    expect(screen.getByText(/1885506/)).toBeDefined()
    expect(screen.getByText(/small/)).toBeDefined()
  })

  it('renders the real blo identicon for the address', () => {
    const { container } = render(<ResultCard candidate={candidate} onSelect={vi.fn()} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('reports the candidate when chosen', async () => {
    const onSelect = vi.fn()
    render(<ResultCard candidate={candidate} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /use this/i }))
    expect(onSelect).toHaveBeenCalledWith(candidate)
  })

  it('marks a three-colour result so it is not mistaken for a clean one', () => {
    render(<ResultCard candidate={{ ...candidate, twoColor: false }} onSelect={vi.fn()} />)
    expect(screen.getByText(/three colours/i)).toBeDefined()
  })
})
```

`packages/web/test/MiningView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MiningView } from '../components/MiningView.js'

const CONFIG = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }

vi.mock('../lib/use-safe-constants.js', () => ({
  useSafeConstants: () => ({ loading: true }),
}))

describe('MiningView', () => {
  it('explains that it is reading Safe constants before it can mine', () => {
    render(
      <MiningView
        config={CONFIG as never}
        faceSpec={{ name: 'x', fixed: [], regions: [] } as never}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/reading safe/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: FAIL — the two new component modules do not resolve.

- [ ] **Step 3: Write `lib/use-safe-constants.ts`**

```ts
'use client'

import { loadSafeConstants, type SafeSetup } from '@safe-vanity-blockie/safe-config'
import { useEffect, useState } from 'react'
import { http, createPublicClient } from 'viem'
import type { MineConfig } from './config.js'
import { chainById } from './wagmi.js'

/**
 * Reads chainId and the three CREATE2 constants once per config. Everything protocol-kit
 * touches stays on the main thread; workers receive plain hex.
 */
export function useSafeConstants(config: MineConfig | undefined): {
  data?: SafeSetup
  error?: string
  loading: boolean
} {
  const [state, setState] = useState<{ data?: SafeSetup; error?: string; loading: boolean }>({
    loading: false,
  })

  useEffect(() => {
    if (!config) {
      setState({ loading: false })
      return
    }
    let cancelled = false
    setState({ loading: true })

    const chain = chainById(config.chainId)
    const rpcUrl = chain.rpcUrls.default.http[0]

    loadSafeConstants({
      rpcUrl,
      owners: config.owners,
      threshold: config.threshold,
      safeVersion: config.safeVersion,
    })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [config])

  return state
}
```

> `createPublicClient`/`http` are imported so the module compiles against viem's chain types used by `chainById`; if the implementer finds them unused after writing `wagmi.ts` in Task 8, delete the import rather than leaving it.

- [ ] **Step 4: Write the components**

`packages/web/components/ResultCard.tsx`:

```tsx
import { formatScore, type Candidate } from '@safe-vanity-blockie/core'
import { Blockie } from './Blockie.js'

export interface ResultCardProps {
  candidate: Candidate
  onSelect: (candidate: Candidate) => void
}

export function ResultCard({ candidate, onSelect }: ResultCardProps) {
  const expression = Object.values(candidate.regions).join('/') || '—'
  return (
    <figure className="card">
      <Blockie address={candidate.address} size={128} />
      <figcaption>
        <strong>{formatScore(candidate.score, candidate.maxScore)}</strong>
        <span>
          {expression} · {candidate.twoColor ? 'two colours' : 'three colours'} · contrast{' '}
          {candidate.contrast}
        </span>
        <code>{candidate.address}</code>
        <code>saltNonce {candidate.saltNonce}</code>
        <button type="button" onClick={() => onSelect(candidate)}>
          Use this
        </button>
      </figcaption>
    </figure>
  )
}
```

`packages/web/components/MiningView.tsx`:

```tsx
'use client'

import type { Candidate, FaceSpec } from '@safe-vanity-blockie/core'
import { useEffect, useState } from 'react'
import type { MineConfig } from '../lib/config.js'
import { useMiner } from '../lib/use-miner.js'
import { useSafeConstants } from '../lib/use-safe-constants.js'
import { ResultCard } from './ResultCard.js'

const DISPLAY_COUNT = 8

export interface MiningViewProps {
  config: MineConfig
  faceSpec: FaceSpec
  onSelect: (candidate: Candidate) => void
}

export function MiningView({ config, faceSpec, onSelect }: MiningViewProps) {
  const constants = useSafeConstants(config)
  const { state, start, stop } = useMiner()
  const [workers] = useState(() => Math.max(1, (navigator.hardwareConcurrency || 4) - 1))

  useEffect(() => {
    if (!constants.data) return
    start({
      constantsHex: constants.data.constantsHex,
      faceSpec,
      workers,
      keep: DISPLAY_COUNT,
      twoColor: true,
      minContrast: 0,
    })
    return stop
  }, [constants.data, faceSpec, start, stop, workers])

  if (constants.loading) return <p>Reading Safe constants…</p>
  if (constants.error) return <p role="alert">Could not read Safe constants: {constants.error}</p>

  return (
    <section>
      <p>
        {state.scanned.toLocaleString('en-US')} nonces · {Math.round(state.rate / 1000)}k/s ·{' '}
        {workers} workers
        {state.droppedCount > 0 && ` · ${state.droppedCount} filtered out`}
      </p>
      <button type="button" onClick={state.running ? stop : () => undefined}>
        {state.running ? 'Stop' : 'Stopped'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      <div className="grid">
        {state.candidates.map((candidate) => (
          <ResultCard key={candidate.address} candidate={candidate} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}
```

Append to `app/globals.css`:

```css
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
.card { margin: 0; padding: 1rem; border: 1px solid rgba(128,128,128,.4); border-radius: .5rem; }
figcaption { display: grid; gap: .25rem; margin-top: .75rem; }
code { font-size: 12px; overflow-wrap: anywhere; }
```

Wire `MiningView` into `app/page.tsx` as the third step, after config and face selection.

- [ ] **Step 5: Run tests and the build**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — 36 tests.

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web build`
Expected: clean build.

- [ ] **Step 6: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add the live mining view and result cards`.

---

### Task 7: `?config=` deep link

**Files:**
- Create: `packages/web/lib/deep-link.ts`, `packages/web/components/ShareConfig.tsx`
- Modify: `packages/web/app/page.tsx`
- Test: `packages/web/test/deep-link.test.ts`

**Interfaces:**
- Consumes: `MineConfig`, `validateMineConfig` (Task 2).
- Produces:
  - `SharedConfig { owners: string[]; threshold: number; safeVersion: string; chainId: number; saltNonce?: string }`
  - `encodeConfigParam(config: SharedConfig): string`
  - `decodeConfigParam(param: string): { config?: SharedConfig; error?: string }`
  - `<ShareConfig config={SharedConfig} />`

- [ ] **Step 1: Write the failing test**

`packages/web/test/deep-link.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodeConfigParam, encodeConfigParam } from '../lib/deep-link.js'

const CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1',
  chainId: 1,
  saltNonce: '1885506',
}

describe('config deep link', () => {
  it('round-trips a config', () => {
    const { config, error } = decodeConfigParam(encodeConfigParam(CONFIG))
    expect(error).toBeUndefined()
    expect(config).toEqual(CONFIG)
  })

  it('preserves a saltNonce beyond 2^53 exactly', () => {
    const huge = { ...CONFIG, saltNonce: '18446744073709551616' }
    expect(decodeConfigParam(encodeConfigParam(huge)).config?.saltNonce).toBe(
      '18446744073709551616',
    )
  })

  it('produces a URL-safe parameter with no padding', () => {
    const param = encodeConfigParam(CONFIG)
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects a parameter that is not valid base64url', () => {
    expect(decodeConfigParam('!!!not base64!!!').error).toMatch(/could not decode/i)
  })

  it('rejects a parameter that decodes to invalid JSON', () => {
    expect(decodeConfigParam(btoa('{ not json').replace(/=+$/, '')).error).toMatch(/could not decode/i)
  })

  it('rejects a config that fails validation, rather than trusting the link', () => {
    const bad = encodeConfigParam({ ...CONFIG, owners: ['0xnope'] })
    expect(decodeConfigParam(bad).error).toMatch(/not a valid address/)
  })

  it('rejects a non-numeric saltNonce', () => {
    const bad = encodeConfigParam({ ...CONFIG, saltNonce: '0x10' })
    expect(decodeConfigParam(bad).error).toMatch(/saltNonce/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test deep-link`
Expected: FAIL — `Failed to resolve import "../lib/deep-link.js"`.

- [ ] **Step 3: Write `lib/deep-link.ts`**

```ts
import { validateMineConfig } from './config.js'

export interface SharedConfig {
  owners: string[]
  threshold: number
  safeVersion: string
  chainId: number
  /** Decimal string. Present when sharing a specific mined result. */
  saltNonce?: string
}

const SALT_PATTERN = /^[0-9]+$/

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
}

export function encodeConfigParam(config: SharedConfig): string {
  return toBase64Url(JSON.stringify(config))
}

/** Decodes and fully re-validates — a link is untrusted input, not a trusted config. */
export function decodeConfigParam(param: string): { config?: SharedConfig; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(fromBase64Url(param))
  } catch {
    return { error: 'Could not decode the shared config from this link.' }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'Could not decode the shared config from this link.' }
  }
  const candidate = raw as Record<string, unknown>

  const owners = Array.isArray(candidate.owners)
    ? candidate.owners.filter((owner): owner is string => typeof owner === 'string')
    : []
  const { errors } = validateMineConfig({
    owners,
    threshold: Number(candidate.threshold),
    safeVersion: String(candidate.safeVersion),
    chainId: Number(candidate.chainId),
  })
  const firstError = Object.values(errors)[0]
  if (firstError) return { error: firstError }

  if (candidate.saltNonce !== undefined) {
    if (typeof candidate.saltNonce !== 'string' || !SALT_PATTERN.test(candidate.saltNonce)) {
      return { error: 'The saltNonce in this link is not a decimal integer.' }
    }
  }

  return {
    config: {
      owners,
      threshold: Number(candidate.threshold),
      safeVersion: String(candidate.safeVersion),
      chainId: Number(candidate.chainId),
      ...(candidate.saltNonce === undefined ? {} : { saltNonce: candidate.saltNonce as string }),
    },
  }
}
```

- [ ] **Step 4: Write `components/ShareConfig.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { encodeConfigParam, type SharedConfig } from '../lib/deep-link.js'

export function ShareConfig({ config }: { config: SharedConfig }) {
  const [copied, setCopied] = useState(false)
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}/?config=${encodeConfigParam(config)}`

  return (
    <p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied' : 'Copy share link'}
      </button>
      <span className="hint"> The config is deterministic — deploy it whenever you like.</span>
    </p>
  )
}
```

Read the parameter in `app/page.tsx` with `useSearchParams()` and seed `ConfigForm`'s `initial` prop from it; surface `error` as an alert when the link is malformed rather than silently ignoring it.

- [ ] **Step 5: Run tests**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — 43 tests.

- [ ] **Step 6: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add ?config= deep links`.

---

### Task 8: Wallet connection

**Files:**
- Create: `packages/web/lib/wagmi.ts`, `packages/web/app/providers.tsx`, `packages/web/components/ConnectButton.tsx`
- Modify: `packages/web/app/layout.tsx`
- Test: `packages/web/test/wagmi.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_CHAINS` (Task 2).
- Produces:
  - `wagmiConfig` — a wagmi `Config` with injected/EIP-6963 connectors over the supported chains
  - `chainById(chainId: number): Chain` — throws for an unsupported chain
  - `<Providers>{children}</Providers>`
  - `<ConnectButton />`

- [ ] **Step 1: Write the failing test**

`packages/web/test/wagmi.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SUPPORTED_CHAINS } from '../lib/config.js'
import { chainById, wagmiConfig } from '../lib/wagmi.js'

describe('wagmi config', () => {
  it('covers exactly the chains the app offers', () => {
    expect(wagmiConfig.chains.map((chain) => chain.id).sort()).toEqual(
      SUPPORTED_CHAINS.map((chain) => chain.id).sort(),
    )
  })

  it('resolves a supported chain', () => {
    expect(chainById(1).id).toBe(1)
    expect(chainById(11155111).name).toMatch(/sepolia/i)
  })

  it('throws for a chain it does not know, rather than returning undefined', () => {
    expect(() => chainById(999_999)).toThrow(/not supported/)
  })

  it('every chain has a usable default RPC, since mining needs one before any wallet connects', () => {
    for (const chain of wagmiConfig.chains) {
      expect(chain.rpcUrls.default.http[0]).toMatch(/^https:\/\//)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test wagmi`
Expected: FAIL — `Failed to resolve import "../lib/wagmi.js"`.

- [ ] **Step 3: Write `lib/wagmi.ts`**

```ts
import { arbitrum, base, gnosis, mainnet, optimism, polygon, sepolia } from 'wagmi/chains'
import { http, createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'
import type { Chain } from 'viem'

const CHAINS = [mainnet, sepolia, polygon, arbitrum, optimism, base, gnosis] as const

export const wagmiConfig = createConfig({
  chains: CHAINS,
  // EIP-6963 discovery is on by default, so every injected wallet the browser announces
  // appears without naming any of them here. No WalletConnect: it would require a project id.
  connectors: [injected()],
  transports: Object.fromEntries(CHAINS.map((chain) => [chain.id, http()])) as never,
})

export function chainById(chainId: number): Chain {
  const chain = CHAINS.find((entry) => entry.id === chainId)
  if (!chain) throw new Error(`Chain ${chainId} is not supported.`)
  return chain
}
```

- [ ] **Step 4: Write the providers and connect button**

`packages/web/app/providers.tsx`:

```tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig } from '../lib/wagmi.js'

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
```

`packages/web/components/ConnectButton.tsx`:

```tsx
'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <button type="button" onClick={() => disconnect()}>
        {address.slice(0, 6)}…{address.slice(-4)} — disconnect
      </button>
    )
  }

  return (
    <>
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          type="button"
          disabled={isPending}
          onClick={() => connect({ connector })}
        >
          Connect {connector.name}
        </button>
      ))}
      {connectors.length === 0 && <p>No browser wallet detected.</p>}
    </>
  )
}
```

Wrap `{children}` in `app/layout.tsx` with `<Providers>` and render `<ConnectButton />` in the header.

- [ ] **Step 5: Run tests and the build**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — 47 tests.

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web build`
Expected: clean build.

- [ ] **Step 6: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): connect injected wallets via wagmi`.

---

### Task 9: Deploy flow

**Files:**
- Create: `packages/web/lib/deploy.ts`, `packages/web/components/DeployPanel.tsx`
- Modify: `packages/web/app/page.tsx`
- Test: `packages/web/test/deploy.test.ts`, `packages/web/test/DeployPanel.test.tsx`

**Interfaces:**
- Consumes: `loadSafeConstants`, `verifyWithProtocolKit` (Task 1); `createAddressDeriver`, `createKeccak256` (core); wagmi hooks (Task 8).
- Produces:
  - `DeploymentPlan { address: string; chainId: number; transaction: { to: string; value: string; data: string } }`
  - `assertDerivedAddressMatches(constants: SafeConstants, saltNonce: string, predicted: string): Promise<void>` — throws on mismatch
  - `buildDeploymentPlan(input: { setup: SafeSetup; saltNonce: string; provider: Eip1193Provider; signer: string; chainId: number }): Promise<DeploymentPlan>`
  - `<DeployPanel config={MineConfig} candidate={Candidate} />`

- [ ] **Step 1: Write the failing test**

`packages/web/test/deploy.test.ts` — offline, because the cross-check is the part worth pinning and it needs no network:

```ts
import { createAddressDeriver, createKeccak256, hexToBytes } from '@safe-vanity-blockie/core'
import { describe, expect, it } from 'vitest'
import { assertDerivedAddressMatches } from '../lib/deploy.js'

const CONSTANTS = {
  initializerHash: hexToBytes('0x' + '11'.repeat(32)),
  factory: hexToBytes('0x' + '22'.repeat(20)),
  initCodeHash: hexToBytes('0x' + '33'.repeat(32)),
}

describe('assertDerivedAddressMatches', () => {
  it('accepts the address our own deriver produces for that saltNonce', async () => {
    const keccak256 = await createKeccak256()
    const expected = createAddressDeriver(CONSTANTS, keccak256).deriveBig(1885506n)
    await expect(
      assertDerivedAddressMatches(CONSTANTS, '1885506', expected),
    ).resolves.toBeUndefined()
  })

  it('is case-insensitive, since protocol-kit returns a checksummed address', async () => {
    const keccak256 = await createKeccak256()
    const expected = createAddressDeriver(CONSTANTS, keccak256).deriveBig(1885506n)
    await expect(
      assertDerivedAddressMatches(CONSTANTS, '1885506', expected.toUpperCase().replace('0X', '0x')),
    ).resolves.toBeUndefined()
  })

  it('throws naming both addresses when they disagree', async () => {
    await expect(
      assertDerivedAddressMatches(CONSTANTS, '1885506', '0x' + '00'.repeat(20)),
    ).rejects.toThrow(/does not match/)
  })

  it('rejects a saltNonce that is not a decimal integer, before any derivation', async () => {
    await expect(assertDerivedAddressMatches(CONSTANTS, '0x10', '0xabc')).rejects.toThrow(
      /decimal/,
    )
    await expect(assertDerivedAddressMatches(CONSTANTS, '', '0xabc')).rejects.toThrow(/decimal/)
  })
})
```

`packages/web/test/DeployPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeployPanel } from '../components/DeployPanel.js'

vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: false, address: undefined, chainId: 1 }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useConnectorClient: () => ({ data: undefined }),
}))

const candidate = {
  saltNonce: '1885506',
  address: '0x70e9f0a8cb8f727322574b4c6c0fadd2e804eed5',
  score: 120,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
}

const config = { owners: ['0x' + '11'.repeat(20)], threshold: 1, safeVersion: '1.4.1', chainId: 1 }

describe('DeployPanel', () => {
  it('asks for a wallet before offering to deploy', () => {
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/connect a wallet/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /^deploy/i })).toBeNull()
  })

  it('repeats the phishing caveat where the user is about to spend money', () => {
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/cosmetic/i)).toBeDefined()
  })

  it('always shows the counterfactual alternative, so deploying is not the only path', () => {
    render(<DeployPanel config={config as never} candidate={candidate} />)
    expect(screen.getByText(/deploy it later/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: FAIL — neither `deploy.js` nor `DeployPanel.js` resolves.

- [ ] **Step 3: Write `lib/deploy.ts`**

```ts
import Safe from '@safe-global/protocol-kit'
import type { SafeConfig } from '@safe-global/protocol-kit'
import type { Transaction } from '@safe-global/types-kit'
import {
  createAddressDeriver,
  createKeccak256,
  type SafeConstants,
} from '@safe-vanity-blockie/core'
import { verifyWithProtocolKit, type SafeSetup } from '@safe-vanity-blockie/safe-config'
import type { Eip1193Provider } from '@safe-global/protocol-kit'

/**
 * protocol-kit's default export resolves as an implied-CommonJS namespace under bundler
 * resolution, so it is asserted here against the minimal shape this file calls.
 */
interface SafeSdkInstance {
  getAddress(): Promise<string>
  createSafeDeploymentTransaction(): Promise<Transaction>
}
interface SafeSdkStatic {
  init(config: SafeConfig): Promise<SafeSdkInstance>
}
const SafeSdk = Safe as unknown as SafeSdkStatic

const SALT_PATTERN = /^[0-9]+$/

export interface DeploymentPlan {
  address: string
  chainId: number
  transaction: { to: string; value: string; data: string }
}

/**
 * Derives the address independently from the CREATE2 constants and compares it with the one
 * protocol-kit predicted. This is the check that matters: protocol-kit's own `getAddress()`
 * IS `predictSafeAddress`, so comparing those two proves nothing.
 */
export async function assertDerivedAddressMatches(
  constants: SafeConstants,
  saltNonce: string,
  predicted: string,
): Promise<void> {
  if (!SALT_PATTERN.test(saltNonce)) {
    throw new Error(`saltNonce "${saltNonce}" is not a decimal integer.`)
  }
  const keccak256 = await createKeccak256()
  const derived = createAddressDeriver(constants, keccak256).deriveBig(BigInt(saltNonce))
  if (derived.toLowerCase() !== predicted.toLowerCase()) {
    throw new Error(
      `Address mismatch for saltNonce ${saltNonce}: our derivation gives ${derived}, ` +
        `protocol-kit gives ${predicted.toLowerCase()}. Refusing to deploy.`,
    )
  }
}

/** Builds — but never sends — the deployment transaction, after both cross-checks pass. */
export async function buildDeploymentPlan(input: {
  setup: SafeSetup
  saltNonce: string
  provider: Eip1193Provider
  signer: string
  chainId: number
}): Promise<DeploymentPlan> {
  const safe = await SafeSdk.init({
    provider: input.provider,
    signer: input.signer,
    predictedSafe: {
      safeAccountConfig: input.setup.safeAccountConfig,
      safeDeploymentConfig: {
        saltNonce: input.saltNonce,
        safeVersion: input.setup.safeVersion,
      },
    },
  } as SafeConfig)

  const address = await safe.getAddress()
  await assertDerivedAddressMatches(input.setup.constants, input.saltNonce, address)
  await verifyWithProtocolKit(input.setup, input.saltNonce, address)

  const transaction = await safe.createSafeDeploymentTransaction()
  return {
    address,
    chainId: input.chainId,
    transaction: { to: transaction.to, value: transaction.value, data: transaction.data },
  }
}
```

- [ ] **Step 4: Write `components/DeployPanel.tsx`**

```tsx
'use client'

import { formatScore, type Candidate } from '@safe-vanity-blockie/core'
import { useState } from 'react'
import { useAccount, useConnectorClient, useSwitchChain } from 'wagmi'
import type { MineConfig } from '../lib/config.js'
import { ShareConfig } from './ShareConfig.js'
import { Blockie } from './Blockie.js'

export function DeployPanel({ config, candidate }: { config: MineConfig; candidate: Candidate }) {
  const { isConnected, address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { data: client } = useConnectorClient()
  const [status, setStatus] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const wrongChain = isConnected && chainId !== config.chainId

  return (
    <section>
      <h2>Deploy</h2>
      <Blockie address={candidate.address} size={128} />
      <p>
        <strong>{formatScore(candidate.score, candidate.maxScore)}</strong> ·{' '}
        <code>{candidate.address}</code> · saltNonce <code>{candidate.saltNonce}</code>
      </p>
      <p className="notice">
        <strong>A matching identicon is cosmetic.</strong> Verify the full address before you
        send anything — a look-alike blockie is a known phishing vector.
      </p>
      <p>
        This config is counterfactual: the address exists whether or not you deploy, so you can
        copy it and deploy it later, on any chain with the canonical Safe contracts.
      </p>
      <ShareConfig config={{ ...config, saltNonce: candidate.saltNonce }} />

      {!isConnected && <p>Connect a wallet to deploy.</p>}
      {wrongChain && (
        <button type="button" onClick={() => switchChain({ chainId: config.chainId })}>
          Switch network to continue
        </button>
      )}
      {isConnected && !wrongChain && (
        <button
          type="button"
          onClick={() => {
            setError(undefined)
            setStatus('Building the deployment transaction…')
            // The deployment itself is wired in Step 5 below.
          }}
        >
          Deploy this Safe
        </button>
      )}
      {status && <p>{status}</p>}
      {error && <p role="alert">{error}</p>}
      {!client && isConnected && <p>Waiting for the wallet client…</p>}
    </section>
  )
}
```

- [ ] **Step 5: Wire the send path**

Replace the button's `onClick` body with a handler that loads the setup, builds the plan, sends the transaction through the connected wallet, waits for the receipt, and confirms the deployed address:

```tsx
onClick={async () => {
  if (!client || !address) return
  setError(undefined)
  try {
    setStatus('Reading Safe constants…')
    const { loadSafeConstants } = await import('@safe-vanity-blockie/safe-config')
    const { chainById } = await import('../lib/wagmi.js')
    const setup = await loadSafeConstants({
      rpcUrl: chainById(config.chainId).rpcUrls.default.http[0],
      owners: config.owners,
      threshold: config.threshold,
      safeVersion: config.safeVersion,
    })

    setStatus('Checking the address before spending anything…')
    const { buildDeploymentPlan } = await import('../lib/deploy.js')
    const plan = await buildDeploymentPlan({
      setup,
      saltNonce: candidate.saltNonce,
      provider: client.transport as never,
      signer: address,
      chainId: config.chainId,
    })

    setStatus(`Sending — confirm in your wallet to deploy ${plan.address}…`)
    const hash = await client.sendTransaction({
      to: plan.transaction.to as `0x${string}`,
      value: BigInt(plan.transaction.value),
      data: plan.transaction.data as `0x${string}`,
    })
    setStatus(`Sent ${hash}. Waiting for confirmation…`)

    const { createPublicClient, http } = await import('viem')
    const publicClient = createPublicClient({
      chain: chainById(config.chainId),
      transport: http(),
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') {
      setStatus(undefined)
      setError(`Deployment reverted. Gas was spent. Transaction ${hash}.`)
      return
    }
    setStatus(`Safe deployed at ${plan.address}.`)
  } catch (thrown) {
    setStatus(undefined)
    setError(thrown instanceof Error ? thrown.message : String(thrown))
  }
}}
```

- [ ] **Step 6: Run tests and the build**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — 54 tests.

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web build`
Expected: clean build.

**Do not send a real transaction as part of this task.** The offline test covers the cross-check; the send path is verified manually in Task 10 against Sepolia, where a mistake costs testnet gas only.

- [ ] **Step 7: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add the deploy flow with an independent address cross-check`.

---

### Task 10: `npx` handoff, documentation, and end-to-end verification

**Files:**
- Create: `packages/web/components/CliHandoff.tsx`, `packages/web/README.md`
- Modify: `packages/web/components/MiningView.tsx`, `README.md`
- Test: `packages/web/test/CliHandoff.test.tsx`

**Interfaces:**
- Consumes: `MineConfig` (Task 2).
- Produces: `npxCommandFor(config: MineConfig, options: { rpcUrl: string }): string`; `<CliHandoff config={MineConfig} rpcUrl={string} />`

- [ ] **Step 1: Write the failing test**

`packages/web/test/CliHandoff.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CliHandoff, npxCommandFor } from '../components/CliHandoff.js'

const config = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '0x' + '22'.repeat(20)],
  threshold: 2,
  safeVersion: '1.4.1' as const,
  chainId: 1,
}

describe('npxCommandFor', () => {
  it('produces a command that runs the CLI with the same config', () => {
    const command = npxCommandFor(config, { rpcUrl: 'https://rpc.example' })
    expect(command).toContain('npx safe-vanity-blockie')
    expect(command).toContain(`--owners ${config.owners.join(',')}`)
    expect(command).toContain('--threshold 2')
    expect(command).toContain('--safe-version 1.4.1')
    expect(command).toContain('--rpc https://rpc.example')
  })

  it('is a single line, so it can be pasted straight into a shell', () => {
    expect(npxCommandFor(config, { rpcUrl: 'https://rpc.example' })).not.toContain('\n')
  })
})

describe('CliHandoff', () => {
  it('explains why a user would want the CLI', () => {
    render(<CliHandoff config={config} rpcUrl="https://rpc.example" />)
    expect(screen.getByText(/longer/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test CliHandoff`
Expected: FAIL — `Failed to resolve import "../components/CliHandoff.js"`.

- [ ] **Step 3: Write `components/CliHandoff.tsx`**

```tsx
import type { MineConfig } from '../lib/config.js'

export function npxCommandFor(config: MineConfig, options: { rpcUrl: string }): string {
  return [
    'npx safe-vanity-blockie',
    `--owners ${config.owners.join(',')}`,
    `--threshold ${config.threshold}`,
    `--safe-version ${config.safeVersion}`,
    `--rpc ${options.rpcUrl}`,
  ].join(' ')
}

export function CliHandoff({ config, rpcUrl }: { config: MineConfig; rpcUrl: string }) {
  return (
    <details>
      <summary>Run a longer search on your machine</summary>
      <p className="hint">
        A browser tab is throttled when it loses focus, and mobile is roughly ten times slower.
        For a longer search, run the same config natively — it uses every core and can be
        resumed.
      </p>
      <pre>
        <code>{npxCommandFor(config, { rpcUrl })}</code>
      </pre>
    </details>
  )
}
```

Render `<CliHandoff config={config} rpcUrl={…} />` beneath the progress line in `MiningView`.

- [ ] **Step 4: Write the web README**

`packages/web/README.md`:

````markdown
# safe-vanity-blockie web

A Next.js app that mines a Safe `saltNonce` in your browser and deploys the result.

## Running

    mise exec -- pnpm -r build      # the app consumes core's compiled dist
    mise exec -- pnpm --filter @safe-vanity-blockie/web dev

## ⚠️ Security

A matching identicon is cosmetic and must never be trusted as proof of an address. Blockie
look-alikes are a known phishing vector — always verify the full address.

## How it mines

`core`'s mining loop is synchronous, which is what makes it fast, so a Web Worker running one
long call would never process a stop message. Rather than requiring cross-origin isolation to
get `SharedArrayBuffer` — which breaks wallet popups and injected providers — the worker mines
in ~50,000-nonce slices and awaits a macrotask between them. A stop is acted on at the next
slice boundary, within a few hundred milliseconds.

Each worker gets a disjoint block of nonces. Expect roughly 1.5–2M nonces/s aggregate on a
focused desktop tab, against 2.5–3M/s for the eight-core CLI.

## Wallets

Injected wallets only, discovered via EIP-6963. No WalletConnect, so the app needs no project
id and no secrets.
````

Add a short section to the root `README.md` pointing at the web app, immediately after the Packages list.

- [ ] **Step 5: Run the full suite**

Run: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm test:network`
Expected: every package green — core, safe-config, miner, web.

- [ ] **Step 6: Verify the whole flow by hand on Sepolia**

```bash
mise exec -- pnpm -r build
mise exec -- pnpm --filter @safe-vanity-blockie/web dev
```

Walk the app end to end and record each result in your report:

1. Configure with a real owner address you control, threshold 1, Sepolia.
2. Choose expressions; confirm the preview renders.
3. Mine — record the observed aggregate nonces/second and confirm results appear and improve.
4. Stop — confirm it halts within about a second.
5. Copy the share link, open it in a new tab, confirm the config is restored.
6. Connect an injected wallet on Sepolia and deploy the top result.
7. **Confirm the deployed address equals the address shown on the card.** This is the whole point of the project; if it differs, stop and report BLOCKED rather than continuing.

- [ ] **Step 7: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add the CLI handoff and document the app`.

---

## Self-review

**Spec coverage.** §8.1 step 1 (Configure, including the warning that owners change the address) → Task 2. Step 2 (preset expression sets, live `blo` preview) → Task 3; the freeform designer is explicitly deferred with its own plan. Step 3 (Web Workers importing `core`, live gallery, bounded search, pre-filled `npx` command) → Tasks 4, 5, 6, 10. Step 4 (result cards with real `blo` SVG, score, expression, address, saltNonce) → Task 6. Step 5 (wallet connect, protocol-kit deployment, address confirmation, copy-config counterfactual path) → Tasks 8 and 9. §8.2 (`?config=` deep link, portable config) → Task 7. §8.3/§8.4 (performance expectations) → measured in Tasks 5 and 10 and documented in Task 10. §1's phishing caveat → the header notice (Task 2), the deploy panel (Task 9), and both READMEs (Task 10).

**Carried-over hazards.** Every defect the CLI's review loop caught is pre-empted here rather than rediscovered: filtering-after-retention (`selectReported` with the 20× multiplier, Tasks 1 and 5), the `nextStart` positional-offset bug (`nextStartFrom`, with the counter-example in a test, Task 5), the tautological deploy self-check (`assertDerivedAddressMatches`, Task 9), untrusted input reaching a parser (`decodeConfigParam` re-validates, Task 7), and `saltNonce` string fidelity (pinned in Tasks 7 and 9).

**Type consistency.** `MineConfig`, `SharedConfig`, `SafeSetup`, `Candidate`, `FaceSpec`, `BrowserWorkerInput` and `WorkerEvent` are each defined once and imported everywhere. `selectReported`'s options shape is identical in the hook (Task 5) and the CLI, because both now import it from core (Task 1). `constantsHex` has the same three-hex-string shape from `SafeSetup` through `StartMiningInput` to `BrowserMineOptions`.

**Known ordering constraint.** Task 1 must land first: Tasks 2, 6 and 9 import `@safe-vanity-blockie/safe-config`, and Tasks 5 and 6 import `selectReported`/`formatScore` from core. Task 8 must precede Task 9's manual verification, since `chainById` and the wagmi provider are what the deploy path uses.

**One deliberate gap.** `useSafeConstants` (Task 6) reads the chain's default public RPC, which is rate-limited. If mining a busy chain fails at setup, the fix is a user-supplied RPC field — noted here rather than built, because it is speculative until someone hits it.
