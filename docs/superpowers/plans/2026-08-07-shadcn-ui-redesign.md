# shadcn/ui Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `packages/web`'s hand-rolled UI with Tailwind v4 + shadcn/ui, restructured as a single scrolling page with a sticky mining bar and collapsible sections, without touching the logic that carries the correctness burden.

**Architecture:** shadcn is a generator, not a dependency — it copies component source into `components/ui/`, which then belongs to us and is reviewed like our code. Everything in `lib/` stays untouched, so the mining loop, worker protocol, deep-link parser, address derivation and deploy guards are all outside the blast radius. Only presentation and three named behaviour rules change.

**Tech Stack:** Tailwind CSS v4.3.3 (CSS-first, no config file) · `@tailwindcss/postcss` 4.3.3 · shadcn CLI 4.16.2 · Radix primitives · `class-variance-authority` 0.7.1 · `tailwind-merge` 3.6.0 · `clsx` 2.1.1 · `lucide-react` 1.31.0 · `next-themes` 0.4.6 · `sonner` 2.0.8. On Next 16.3, React 19.2, vitest 4 + jsdom 30.

**Source spec:** `docs/superpowers/specs/2026-08-07-shadcn-ui-redesign-design.md`

## Global Constraints

- **`packages/core`, `packages/safe-config` and `packages/miner` are never modified.** This plan touches `packages/web` only.
- **Nothing in `packages/web/lib/` changes**, with exactly one exception: `use-miner.ts` may gain nothing at all — the pause-trigger change in Task 6 lives in the components that call it. If a task believes it must edit `lib/`, that is a signal to stop and report, not to proceed.
- **Every address guard on the deploy path stays exactly as reviewed:** independent re-derivation via `createAddressDeriver`, the protocol-kit cross-check, the plan-vs-card comparison before sending, and the receipt-log check after. A restyle must not move, reorder or weaken them.
- **The phishing caveat is always visible and never collapses**: *a matching identicon is cosmetic and must never be trusted as proof of an address.*
- **Configure is address-determining.** Owners, threshold, safe version and chain determine the Safe address, so changing any of them requires an explicit "Start over" that clears results and the selected candidate. A result card must never outlive the config that produced it.
- **Face stays live-editable** — expression and filter changes apply without restarting the search.
- **Mining pauses when the deploy transaction is initiated**, not when a candidate is selected. Cancelling resumes.
- **Scores display as percentages** via `formatScore`; the raw integer remains the ranking key.
- **`saltNonce` is a decimal string everywhere.**
- **Relative imports in `packages/web` are extensionless** — Turbopack cannot resolve a `.js` specifier pointing at a `.ts`/`.tsx` source, unlike vitest.
- **Keep every existing assertion.** Change query strategy only where a primitive genuinely changed, so the suite keeps proving behaviour rather than markup.
- **Commit style:** conventional commits. Implementers stage with `git add -A` and do not commit; the controller commits.

## File structure

| File | Responsibility |
|---|---|
| `packages/web/app/globals.css` | Tailwind layers + shadcn design tokens, light and dark |
| `packages/web/lib/utils.ts` | `cn()` — the `clsx` + `tailwind-merge` helper every generated component imports |
| `packages/web/components/ui/*.tsx` | Generated shadcn primitives. Ours, but edited only when a task says so |
| `packages/web/components/ThemeToggle.tsx` | Light/dark switch |
| `packages/web/components/MiningStatusBar.tsx` | The sticky bar: best score, scanned, rate, workers, Pause/Resume |
| `packages/web/components/ConfigSection.tsx` | Collapsible wrapper around `ConfigForm` + the summary + "Start over" |
| `packages/web/components/FaceSection.tsx` | Collapsible wrapper around `FacePicker` + the summary |
| `packages/web/components/ResultsGrid.tsx` | The card grid, empty and loading states |
| `packages/web/components/DeployDialog.tsx` | Deploy confirmation, and the pause/resume trigger |
| `packages/web/app/page.tsx` | Composition and page-level state only |

---

### Task 1: Tailwind v4 + shadcn foundation

The riskiest task, deliberately first: if Tailwind v4 and Turbopack fight, it surfaces here rather than after eight tasks of UI work.

**Files:**
- Create: `packages/web/postcss.config.mjs`, `packages/web/components.json`, `packages/web/lib/utils.ts`, `packages/web/components/ThemeToggle.tsx`
- Create (generated): `packages/web/components/ui/{button,input,label,select,checkbox,card,badge,collapsible,alert,dialog,progress,separator,sonner,skeleton}.tsx`
- Modify: `packages/web/package.json`, `packages/web/app/globals.css`, `packages/web/app/layout.tsx`, `packages/web/app/providers.tsx`, `packages/web/vitest.setup.ts`, `packages/web/tsconfig.json`
- Test: `packages/web/test/ui-foundation.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `cn(...inputs: ClassValue[]): string` from `lib/utils`; the fifteen `components/ui/*` modules; `<ThemeToggle />`; a `vitest.setup.ts` that polyfills what Radix needs under jsdom.

- [ ] **Step 1: Install dependencies**

```bash
cd /home/tim.guest/safe-vanity-blockie
mise exec -- pnpm --filter @safe-vanity-blockie/web add tailwindcss@^4.3.3 @tailwindcss/postcss@^4.3.3 class-variance-authority@^0.7.1 tailwind-merge@^3.6.0 clsx@^2.1.1 lucide-react@^1.31.0 next-themes@^0.4.6 sonner@^2.0.8
```

- [ ] **Step 2: Wire Tailwind v4 into Next**

`packages/web/postcss.config.mjs` — v4 uses a dedicated PostCSS plugin and needs no `tailwind.config.js`:

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

Replace `packages/web/app/globals.css` entirely. The `@theme inline` block is v4's CSS-first configuration; the two `:root`/`.dark` blocks are shadcn's token set:

```css
@import 'tailwindcss';

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}
```

- [ ] **Step 3: Add the `cn` helper and the shadcn manifest**

`packages/web/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

`packages/web/components.json` — tells the CLI where to write:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

`tsconfig.json` already maps `"@/*": ["./*"]`; confirm that is present and leave it otherwise unchanged.

- [ ] **Step 4: Generate the components**

```bash
cd packages/web
mise exec -- pnpm dlx shadcn@4.16.2 add button input label select checkbox card badge collapsible alert dialog progress separator sonner skeleton --yes
```

This writes fifteen files under `components/ui/` and adds the Radix packages it needs to `package.json`. If the CLI cannot resolve the Tailwind config because v4 has none, re-run with `--cwd .` and confirm `components.json` has `"tailwind": { "config": "" }` — an empty string is correct for v4.

Read the generated files before proceeding. They are our code now.

- [ ] **Step 5: Polyfill what Radix needs under jsdom**

Radix primitives call browser APIs jsdom does not implement. Without these, every later task's tests fail with `hasPointerCapture is not a function` or `scrollIntoView is not a function`, and the cause is not obvious from the error.

Replace `packages/web/vitest.setup.ts`:

```ts
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(cleanup)

// Radix primitives use pointer capture and scrolling APIs that jsdom does not implement.
// Without these stubs, Select and Dialog throw during interaction tests.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as unknown as typeof matchMedia
```

- [ ] **Step 6: Add the theme provider and toggle**

In `packages/web/app/providers.tsx`, wrap the existing tree with `next-themes` — outermost, so both wagmi and the UI see it:

```tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState, type ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig } from '../lib/wagmi'

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  )
}
```

`packages/web/components/ThemeToggle.tsx`:

```tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from './ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const next = resolvedTheme === 'dark' ? 'light' : 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  )
}
```

In `app/layout.tsx`, add `suppressHydrationWarning` to the `<html>` element — `next-themes` sets the class before React hydrates, and without this React logs a mismatch on every load.

- [ ] **Step 7: Write the foundation test**

`packages/web/test/ui-foundation.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { cn } from '../lib/utils'

describe('cn', () => {
  it('merges conflicting tailwind classes, last one winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('drops falsy values', () => {
    expect(cn('p-2', false, undefined, 'text-sm')).toBe('p-2 text-sm')
  })
})

describe('generated primitives', () => {
  it('renders a Button as a real button element', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Deploy</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Deploy' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('drives a Select through Radix, which is a combobox rather than a native select', async () => {
    const onValueChange = vi.fn()
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="Chain">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Ethereum</SelectItem>
          <SelectItem value="11155111">Sepolia</SelectItem>
        </SelectContent>
      </Select>,
    )

    // This is the query shape every later task must use: role="combobox", not a native select.
    await userEvent.click(screen.getByRole('combobox', { name: 'Chain' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Sepolia' }))
    expect(onValueChange).toHaveBeenCalledWith('11155111')
  })
})
```

Add `vi` to the vitest import at the top of that file.

- [ ] **Step 8: Verify**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — the new foundation tests plus every pre-existing test. The existing components still use plain HTML at this point, so nothing else should change.

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web build`
Expected: a clean Next production build with Tailwind active. If PostCSS errors, confirm `postcss.config.mjs` uses `@tailwindcss/postcss` and not the v3 `tailwindcss` plugin name.

- [ ] **Step 9: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add Tailwind v4 and shadcn/ui foundation`.

---

### Task 2: App shell and the sticky mining bar

**Files:**
- Create: `packages/web/components/MiningStatusBar.tsx`
- Modify: `packages/web/app/layout.tsx`, `packages/web/components/SecurityNotice.tsx`, `packages/web/components/ConnectButton.tsx`
- Test: `packages/web/test/MiningStatusBar.test.tsx`

**Interfaces:**
- Consumes: `cn`, `Button`, `Badge`, `Progress`, `Alert`, `ThemeToggle` (Task 1); `formatScore` from `@safe-vanity-blockie/core`.
- Produces: `<MiningStatusBar status={MiningStatus} onPauseToggle={() => void} />` where

```ts
export interface MiningStatus {
  running: boolean
  paused: boolean
  scanned: number
  rate: number
  workers: number
  bestScore?: number
  bestMaxScore?: number
}
```

- [ ] **Step 1: Write the failing test**

`packages/web/test/MiningStatusBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MiningStatusBar } from '../components/MiningStatusBar'

const status = {
  running: true,
  paused: false,
  scanned: 4_200_000,
  rate: 1_030_000,
  workers: 5,
  bestScore: 120,
  bestMaxScore: 133,
}

describe('MiningStatusBar', () => {
  it('shows the best score as a percentage, not a raw fraction', () => {
    render(<MiningStatusBar status={status} onPauseToggle={vi.fn()} />)
    expect(screen.getByText('90.2%')).toBeDefined()
    expect(screen.queryByText(/120\/133/)).toBeNull()
  })

  it('shows scanned count, rate and worker count', () => {
    render(<MiningStatusBar status={status} onPauseToggle={vi.fn()} />)
    expect(screen.getByText(/4,200,000/)).toBeDefined()
    expect(screen.getByText(/1\.03M\/s/)).toBeDefined()
    expect(screen.getByText(/5 workers/)).toBeDefined()
  })

  it('offers Pause while running and Resume while paused', async () => {
    const onPauseToggle = vi.fn()
    const { rerender } = render(
      <MiningStatusBar status={status} onPauseToggle={onPauseToggle} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(onPauseToggle).toHaveBeenCalledOnce()

    rerender(
      <MiningStatusBar status={{ ...status, paused: true }} onPauseToggle={onPauseToggle} />,
    )
    expect(screen.getByRole('button', { name: /resume/i })).toBeDefined()
  })

  it('says so plainly before any candidate exists', () => {
    render(
      <MiningStatusBar
        status={{ ...status, bestScore: undefined, bestMaxScore: undefined }}
        onPauseToggle={vi.fn()}
      />,
    )
    expect(screen.getByText(/no candidates yet/i)).toBeDefined()
  })

  it('hides the pause control entirely when mining has not started', () => {
    render(
      <MiningStatusBar
        status={{ ...status, running: false, paused: false, scanned: 0 }}
        onPauseToggle={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /pause|resume/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test MiningStatusBar`
Expected: FAIL — `Failed to resolve import "../components/MiningStatusBar"`.

- [ ] **Step 3: Write the component**

`packages/web/components/MiningStatusBar.tsx`:

```tsx
'use client'

import { formatScore } from '@safe-vanity-blockie/core'
import { Pause, Play } from 'lucide-react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Progress } from './ui/progress'

export interface MiningStatus {
  running: boolean
  paused: boolean
  scanned: number
  rate: number
  workers: number
  bestScore?: number
  bestMaxScore?: number
}

function formatRate(rate: number): string {
  return rate >= 1e6 ? `${(rate / 1e6).toFixed(2)}M/s` : `${Math.round(rate / 1000)}k/s`
}

export function MiningStatusBar({
  status,
  onPauseToggle,
}: {
  status: MiningStatus
  onPauseToggle: () => void
}) {
  const hasBest = status.bestScore !== undefined && status.bestMaxScore !== undefined
  const percent = hasBest ? (status.bestScore! / status.bestMaxScore!) * 100 : 0
  const started = status.running || status.paused || status.scanned > 0

  return (
    <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        {hasBest ? (
          <>
            <Badge variant="secondary" className="font-mono">
              {formatScore(status.bestScore!, status.bestMaxScore!)}
            </Badge>
            <Progress value={percent} className="hidden h-2 w-32 sm:block" />
          </>
        ) : (
          <span className="text-muted-foreground">No candidates yet</span>
        )}

        <span className="text-muted-foreground">
          {status.scanned.toLocaleString('en-US')} nonces
        </span>
        <span className="text-muted-foreground">{formatRate(status.rate)}</span>
        <span className="text-muted-foreground">{status.workers} workers</span>

        {started && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onPauseToggle}
          >
            {status.paused ? (
              <>
                <Play className="mr-1 h-3 w-3" /> Resume
              </>
            ) : (
              <>
                <Pause className="mr-1 h-3 w-3" /> Pause
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Restyle the shell**

`packages/web/components/SecurityNotice.tsx` — same copy, now an `Alert` that stays visible:

```tsx
import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'

export function SecurityNotice() {
  return (
    <Alert>
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>A matching identicon is cosmetic.</AlertTitle>
      <AlertDescription>
        Never treat it as proof of an address — blockie look-alikes are a known phishing
        vector. Always verify the full address.
      </AlertDescription>
    </Alert>
  )
}
```

`packages/web/components/ConnectButton.tsx` — same logic and the same three states, with `Button` replacing the bare elements. Keep the accessible names the existing tests rely on.

In `app/layout.tsx`, give the header a max-width container holding the title, `<ThemeToggle />` and `<ConnectButton />`, and set `suppressHydrationWarning` on `<html>` if Task 1 did not.

- [ ] **Step 5: Verify**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — the five new bar tests plus everything before.

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web build`
Expected: clean.

- [ ] **Step 6: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add the sticky mining bar and restyle the app shell`.

---

### Task 3: Configure section — shadcn form, collapsible, Start over

This task carries an address-safety rule, so its tests matter more than its looks.

**Files:**
- Create: `packages/web/components/ConfigSection.tsx`
- Modify: `packages/web/components/ConfigForm.tsx`
- Test: `packages/web/test/ConfigSection.test.tsx`, `packages/web/test/ConfigForm.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Collapsible`, `Button`, `Input`, `Label`, `Select`, `Alert` (Task 1); `validateMineConfig`, `SUPPORTED_CHAINS`, `SUPPORTED_SAFE_VERSIONS`, `MineConfig` from `../lib/config` (unchanged).
- Produces: `<ConfigSection config={MineConfig | undefined} onSubmit={(config: MineConfig) => void} onStartOver={() => void} />`.

- [ ] **Step 1: Write the failing test**

`packages/web/test/ConfigSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfigSection } from '../components/ConfigSection'

const CONFIG = {
  owners: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  threshold: 1,
  safeVersion: '1.4.1' as const,
  chainId: 11155111,
}

describe('ConfigSection', () => {
  it('shows the form while no config is set', () => {
    render(<ConfigSection config={undefined} onSubmit={vi.fn()} onStartOver={vi.fn()} />)
    expect(screen.getByLabelText(/owners/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /start over/i })).toBeNull()
  })

  it('collapses to a one-line summary once a config is set', () => {
    render(<ConfigSection config={CONFIG} onSubmit={vi.fn()} onStartOver={vi.fn()} />)
    expect(screen.getByText(/1 owner/i)).toBeDefined()
    expect(screen.getByText(/threshold 1/i)).toBeDefined()
    expect(screen.getByText(/sepolia/i)).toBeDefined()
    expect(screen.queryByLabelText(/owners/i)).toBeNull()
  })

  it('pluralises the owner count', () => {
    render(
      <ConfigSection
        config={{ ...CONFIG, owners: [CONFIG.owners[0], '0x' + '22'.repeat(20)], threshold: 2 }}
        onSubmit={vi.fn()}
        onStartOver={vi.fn()}
      />,
    )
    expect(screen.getByText(/2 owners/i)).toBeDefined()
  })

  it('warns that starting over discards results, and only resets on confirmation', async () => {
    const onStartOver = vi.fn()
    render(<ConfigSection config={CONFIG} onSubmit={vi.fn()} onStartOver={onStartOver} />)

    await userEvent.click(screen.getByRole('button', { name: /start over/i }))
    expect(screen.getByText(/discard/i)).toBeDefined()
    expect(onStartOver).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^start over$/i, hidden: false }))
    expect(onStartOver).toHaveBeenCalledOnce()
  })

  it('explains why the config is locked, since owners determine the address', () => {
    render(<ConfigSection config={CONFIG} onSubmit={vi.fn()} onStartOver={vi.fn()} />)
    expect(screen.getByText(/determine the safe address/i)).toBeDefined()
  })
})
```

The confirmation is a `Dialog`; the second click targets the confirm button inside it. If both buttons resolve to the same accessible name, give the confirm button the name `Start over` and the trigger the name `Start over…` so the queries are unambiguous, and adjust the test's regexes to match.

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test ConfigSection`
Expected: FAIL — `Failed to resolve import "../components/ConfigSection"`.

- [ ] **Step 3: Rebuild `ConfigForm` on shadcn primitives**

Keep `validateMineConfig`, the `errors` shape, the submit contract and every message exactly as they are. Replace only the markup: `Input` for owners and threshold, `Select` for safe version and chain, `Label` for each, `Button` for submit, and the inline errors as `<p role="alert" className="text-sm text-destructive">`.

Two things must survive because tests depend on them: every control keeps a label that `getByLabelText` resolves, and the owners-are-part-of-the-address hint stays. Give each `SelectTrigger` an `aria-label` matching its `Label` text, since Radix's trigger is a `combobox` rather than a native select.

- [ ] **Step 4: Write `ConfigSection`**

```tsx
'use client'

import { useState } from 'react'
import { SUPPORTED_CHAINS, type MineConfig } from '../lib/config'
import { ConfigForm } from './ConfigForm'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

function summarise(config: MineConfig): string {
  const chain = SUPPORTED_CHAINS.find((entry) => entry.id === config.chainId)
  const owners = `${config.owners.length} owner${config.owners.length === 1 ? '' : 's'}`
  return `${owners} · threshold ${config.threshold} · Safe ${config.safeVersion} · ${chain?.name ?? config.chainId}`
}

export function ConfigSection({
  config,
  onSubmit,
  onStartOver,
}: {
  config: MineConfig | undefined
  onSubmit: (config: MineConfig) => void
  onStartOver: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Configure</CardTitle>
        </CardHeader>
        <CardContent>
          <ConfigForm onSubmit={onSubmit} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Configure</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{summarise(config)}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Start over…
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start over?</DialogTitle>
              <DialogDescription>
                Owners, threshold, Safe version and chain determine the Safe address, so
                changing them will discard every result found so far and any selected result.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Keep mining</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  setOpen(false)
                  onStartOver()
                }}
              >
                Start over
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          These fields determine the Safe address, so they are locked while mining.
        </p>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Update the existing `ConfigForm` tests for the new primitives**

Keep all three existing assertions. The owners field and the submit button still resolve by label and role. Add one test that drives the chain `Select` through Radix, which nothing covered before:

```tsx
it('submits the chain chosen from the Radix select', async () => {
  const onSubmit = vi.fn()
  render(<ConfigForm onSubmit={onSubmit} />)

  await userEvent.type(screen.getByLabelText(/owners/i), OWNER)
  await userEvent.click(screen.getByRole('combobox', { name: /chain/i }))
  await userEvent.click(await screen.findByRole('option', { name: /sepolia/i }))
  await userEvent.click(screen.getByRole('button', { name: /continue/i }))

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ chainId: 11155111 }))
})
```

- [ ] **Step 6: Verify**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS.

- [ ] **Step 7: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): rebuild the configure step with shadcn and a start-over reset`.

---

### Task 4: Face section — collapsible, shadcn controls

**Files:**
- Create: `packages/web/components/FaceSection.tsx`
- Modify: `packages/web/components/FacePicker.tsx`, `packages/web/components/TargetPreview.tsx`
- Test: `packages/web/test/FaceSection.test.tsx`, `packages/web/test/FacePicker.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Collapsible`, `Checkbox`, `Input`, `Label`, `Badge` (Task 1); `ALL_MOUTH_NAMES`, `targetGridFor` from `../lib/face-selection`; `FaceFilters`, `DEFAULT_FACE_FILTERS` from `../lib/config`.
- Produces: `<FaceSection mouths={string[]} filters={FaceFilters} onMouthsChange={(names: string[]) => void} onFiltersChange={(filters: FaceFilters) => void} />`.

- [ ] **Step 1: Write the failing test**

`packages/web/test/FaceSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FACE_FILTERS } from '../lib/config'
import { FaceSection } from '../components/FaceSection'

function renderSection(overrides: Partial<Parameters<typeof FaceSection>[0]> = {}) {
  const props = {
    mouths: ['smile', 'frown'],
    filters: DEFAULT_FACE_FILTERS,
    onMouthsChange: vi.fn(),
    onFiltersChange: vi.fn(),
    ...overrides,
  }
  render(<FaceSection {...props} />)
  return props
}

describe('FaceSection', () => {
  it('summarises the accepted expressions', () => {
    renderSection()
    expect(screen.getByText(/smile, frown/i)).toBeDefined()
  })

  it('stays editable — expression changes apply without a reset', async () => {
    const props = renderSection()
    await userEvent.click(screen.getByRole('checkbox', { name: /neutral/i }))
    expect(props.onMouthsChange).toHaveBeenCalledWith(['smile', 'frown', 'neutral'])
  })

  it('renders one target preview per accepted expression', () => {
    renderSection({ mouths: ['smile', 'frown', 'open'] })
    expect(screen.getAllByRole('img', { name: /target pattern/i })).toHaveLength(3)
  })

  it('reports a two-colour toggle change', async () => {
    const props = renderSection()
    await userEvent.click(screen.getByRole('checkbox', { name: /two colours only/i }))
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...DEFAULT_FACE_FILTERS,
      twoColor: false,
    })
  })

  it('reports a contrast change', async () => {
    const props = renderSection()
    const input = screen.getByLabelText(/minimum contrast/i)
    await userEvent.clear(input)
    await userEvent.type(input, '150')
    expect(props.onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ minContrast: 150 }),
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test FaceSection`
Expected: FAIL — `Failed to resolve import "../components/FaceSection"`.

- [ ] **Step 3: Rebuild `FacePicker` on shadcn primitives**

Keep the guard that refuses to remove the last expression, its `role="alert"` message, and both filter controls with their existing semantics. Replace the native checkboxes with shadcn `Checkbox` and pair each with a `Label`; Radix `Checkbox` renders `role="checkbox"`, so existing queries by accessible name keep working. Keep `min={0} max={442} step={1}` on the contrast `Input`.

`TargetPreview` keeps its SVG and its `aria-label`; only its wrapper classes change.

- [ ] **Step 4: Write `FaceSection`**

A `Card` whose header shows the title and a summary of the accepted expressions as `Badge`s, with `FacePicker` and the target previews in the content. Because face changes are live, this section does **not** lock — it stays expanded and editable for the whole session, which is the difference from Configure and is worth a one-line comment in the file.

- [ ] **Step 5: Verify**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — every existing `FacePicker` assertion still holds.

- [ ] **Step 6: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): restyle the face step and add a collapsible section`.

---

### Task 5: Results grid

**Files:**
- Create: `packages/web/components/ResultsGrid.tsx`
- Modify: `packages/web/components/ResultCard.tsx`
- Test: `packages/web/test/ResultsGrid.test.tsx`, `packages/web/test/ResultCard.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Badge`, `Skeleton`, `Button` (Task 1); `formatScore`, `Candidate` from `@safe-vanity-blockie/core`; `Blockie`.
- Produces: `<ResultsGrid candidates={Candidate[]} selectedAddress={string | undefined} droppedCount={number} mining={boolean} onSelect={(candidate: Candidate) => void} />`.

- [ ] **Step 1: Write the failing test**

`packages/web/test/ResultsGrid.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Candidate } from '@safe-vanity-blockie/core'
import { ResultsGrid } from '../components/ResultsGrid'

const candidate = (address: string, score: number): Candidate => ({
  saltNonce: '1885506',
  address,
  score,
  maxScore: 133,
  twoColor: true,
  contrast: 157,
  regions: { mouth: 'small' },
})

describe('ResultsGrid', () => {
  it('renders one card per candidate', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120), candidate('0xb', 119), candidate('0xc', 118)]}
        selectedAddress={undefined}
        droppedCount={0}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button', { name: /use this/i })).toHaveLength(3)
  })

  it('shows skeletons while mining with nothing found yet', () => {
    const { container } = render(
      <ResultsGrid
        candidates={[]}
        selectedAddress={undefined}
        droppedCount={0}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('explains an empty grid when mining is not running', () => {
    render(
      <ResultsGrid
        candidates={[]}
        selectedAddress={undefined}
        droppedCount={0}
        mining={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/no results yet/i)).toBeDefined()
  })

  it('reports how many candidates the filters removed', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120)]}
        selectedAddress={undefined}
        droppedCount={162}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/162/)).toBeDefined()
  })

  it('marks the selected card', () => {
    render(
      <ResultsGrid
        candidates={[candidate('0xa', 120), candidate('0xb', 119)]}
        selectedAddress="0xa"
        droppedCount={0}
        mining
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/selected/i)).toBeDefined()
  })
})
```

If the generated `Skeleton` does not carry `data-slot="skeleton"`, add that attribute to it — it is our file now — and note the edit in the report.

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test ResultsGrid`
Expected: FAIL — module not found.

- [ ] **Step 3: Rebuild `ResultCard` and write `ResultsGrid`**

`ResultCard` keeps every field it shows today — the `blo` SVG, the percentage via `formatScore`, the expression, two/three-colour, contrast, address and `saltNonce` — and keeps the "Use this" button name. Colour and contrast become `Badge`s; the card gains a ring when selected.

`ResultsGrid` renders a responsive grid (`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`), four `Skeleton` cards while mining with no candidates, a plain explanation when not mining, and a muted line reporting `droppedCount` when it is above zero.

- [ ] **Step 4: Verify**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS — including every existing `ResultCard` assertion.

- [ ] **Step 5: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add the results grid and restyle result cards`.

---

### Task 6: Deploy dialog and the pause-on-deploy trigger

The behaviour change in this plan. Everything about the address guards stays exactly as it is; only when mining pauses changes, and where the confirmation is read.

**Files:**
- Create: `packages/web/components/DeployDialog.tsx`
- Modify: `packages/web/components/DeployPanel.tsx`, `packages/web/components/MiningView.tsx`, `packages/web/app/page.tsx`
- Test: `packages/web/test/DeployDialog.test.tsx`, `packages/web/test/DeployPanel.test.tsx`

**Interfaces:**
- Consumes: `Dialog`, `Button`, `Alert`, `Card` (Task 1); the existing `buildDeploymentPlan` and `assertDerivedAddressMatches` from `../lib/deploy` (unchanged).
- Produces: `<DeployDialog open={boolean} candidate={Candidate} config={MineConfig} onOpenChange={(open: boolean) => void} onDeployStart={() => void} onDeploySettled={() => void} />`.

`onDeployStart` fires immediately before the first `await` of the deploy sequence; `onDeploySettled` fires in a `finally`. The page uses them to pause and resume mining.

- [ ] **Step 1: Write the failing test**

`packages/web/test/DeployDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  account: { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 11155111 },
}))

vi.mock('wagmi', () => ({
  useAccount: () => state.account,
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useConnectorClient: () => ({ data: { transport: {} } }),
}))

vi.mock('../lib/deploy', () => ({
  buildDeploymentPlan: vi.fn(() => new Promise(() => {})),
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
const config = {
  owners: ['0x' + '11'.repeat(20)],
  threshold: 1,
  safeVersion: '1.4.1' as const,
  chainId: 11155111,
}

beforeEach(() => {
  state.account = { isConnected: true, address: '0x' + '11'.repeat(20), chainId: 11155111 }
})

describe('DeployDialog', () => {
  it('repeats the phishing caveat where money is spent', async () => {
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByText(/cosmetic/i)).toBeDefined()
  })

  it('shows the address and saltNonce being deployed', async () => {
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByText(candidate.address)).toBeDefined()
    expect(screen.getByText(/1885506/)).toBeDefined()
  })

  it('pauses mining the moment a deploy is initiated', async () => {
    const onDeployStart = vi.fn()
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={onDeployStart}
        onDeploySettled={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /deploy this safe/i }))
    expect(onDeployStart).toHaveBeenCalledOnce()
  })

  it('asks for a wallet before offering to deploy', async () => {
    state.account = { isConnected: false, address: undefined as never, chainId: 11155111 }
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByText(/connect a wallet/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /deploy this safe/i })).toBeNull()
  })

  it('offers the counterfactual path alongside deploying', async () => {
    const { DeployDialog } = await import('../components/DeployDialog')
    render(
      <DeployDialog
        open
        candidate={candidate}
        config={config}
        onOpenChange={vi.fn()}
        onDeployStart={vi.fn()}
        onDeploySettled={vi.fn()}
      />,
    )
    expect(screen.getByText(/deploy it later/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test DeployDialog`
Expected: FAIL — module not found.

- [ ] **Step 3: Move the deploy body into `DeployDialog`**

Move the existing handler from `DeployPanel` **verbatim** — the salt guard, `buildDeploymentPlan`, the `plan.address` vs `candidate.address` comparison, `sendDispatched`, the receipt status check, `getSafeAddressFromDeploymentTx` and its mismatch branch, the busy/completed gating, and every message. This is a relocation, not a rewrite: those guards were reviewed line by line and must not drift.

Add exactly two things: call `onDeployStart()` immediately before the first `await` of the sequence, and `onDeploySettled()` in a `finally`.

`DeployPanel` becomes the section that shows the chosen candidate, the caveat, the share link and a button opening the dialog.

- [ ] **Step 4: Wire pause and resume in `page.tsx`**

Hold a `deploying` boolean. `onDeployStart` sets it true, `onDeploySettled` sets it false, and `MiningView` receives `paused={deploying}`. Selecting a candidate no longer pauses — remove that trigger and its wiring, and update `MiningView`'s doc comment to say the pause now comes from the deploy step.

- [ ] **Step 5: Update `DeployPanel`'s tests**

Keep every existing assertion that still applies to the section. Move the assertions about the deploy button, wrong-chain gate and error alert into `DeployDialog.test.tsx`, since that is where the behaviour now lives, and keep the `vi.hoisted` mock structure so each test controls the wagmi state.

- [ ] **Step 6: Verify**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS.

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web build`
Expected: clean.

**Broadcast nothing and use no key.** The send path is exercised by hand in Task 8.

- [ ] **Step 7: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): move deploy into a dialog and pause mining when it starts`.

---

### Task 7: Toasts, alerts and the share link

**Files:**
- Modify: `packages/web/components/ShareConfig.tsx`, `packages/web/components/MiningView.tsx`, `packages/web/app/layout.tsx`, `packages/web/components/CliHandoff.tsx`
- Test: `packages/web/test/ShareConfig.test.tsx`

**Interfaces:**
- Consumes: `sonner`'s `Toaster` and `toast`, `Alert`, `Button`, `Input` (Task 1).
- Produces: no new exports; existing components gain toast feedback.

- [ ] **Step 1: Extend the failing test**

Add to `packages/web/test/ShareConfig.test.tsx`:

```tsx
it('keeps the URL selectable even when the clipboard is unavailable', async () => {
  const original = navigator.clipboard
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

  render(<ShareConfig config={CONFIG} />)
  const field = screen.getByRole('textbox', { name: /share link/i })
  expect((field as HTMLInputElement).readOnly).toBe(true)
  expect((field as HTMLInputElement).value).toContain('?config=')

  fireEvent.click(screen.getByRole('button', { name: /copy/i }))
  expect(await screen.findByText(/could not copy/i)).toBeDefined()

  Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true })
})
```

Keep every existing `ShareConfig` assertion.

- [ ] **Step 2: Run to verify it fails**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test ShareConfig`
Expected: FAIL — the readonly field has no accessible name `share link` yet, or the failure message is missing.

- [ ] **Step 3: Restyle and wire toasts**

`ShareConfig` gets a labelled readonly `Input` holding the URL plus a copy `Button`; keep the existing `try`/`catch` and `.catch()` around the clipboard call and surface failures both inline and as a `toast.error`.

Mount `<Toaster />` once in `app/layout.tsx`. Use `toast.success` on a successful copy and `toast.error` for worker failures surfaced by `MiningView`. Keep the inline `role="alert"` messages as well — a toast disappears, and an error a user needs to act on should not.

`CliHandoff` becomes a `Collapsible` with the command in a `<pre>` and a copy button using the same pattern.

- [ ] **Step 4: Verify**

Run: `mise exec -- pnpm --filter @safe-vanity-blockie/web test`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): add toasts and a selectable share link`.

---

### Task 8: Page composition, docs and production verification

**Files:**
- Modify: `packages/web/app/page.tsx`, `packages/web/README.md`
- Test: `packages/web/test/page.test.tsx`

**Interfaces:**
- Consumes: every component from Tasks 2–7.
- Produces: the composed page.

- [ ] **Step 1: Extend the page test**

Keep every existing assertion in `packages/web/test/page.test.tsx` and add:

```tsx
it('locks the config once set and clears results when starting over', async () => {
  // Renders through to the collapsed Configure summary, clicks "Start over…", confirms,
  // and asserts the form is back and no result cards remain.
})
```

Write that test body out fully against the mocks the file already uses for `MiningView` and `useSafeConstants`; do not leave it as a comment.

- [ ] **Step 2: Compose the page**

`page.tsx` holds only state and composition: the deep-link decode, `config`, `mouths`, `filters`, `selected`, `deploying`, and the `startOver` handler that clears `config`, `selected` and any decoded link state. Order down the page: `SecurityNotice`, `ConfigSection`, `FaceSection`, `ResultsGrid`, `DeployPanel`. The sticky `MiningStatusBar` sits above them all, fed by `MiningView`'s state.

- [ ] **Step 3: Verify the whole workspace**

Run: `mise exec -- pnpm test && mise exec -- pnpm typecheck`
Expected: every package green.

- [ ] **Step 4: Verify the production bundle**

```bash
mise exec -- pnpm --filter @safe-vanity-blockie/web build
mise exec -- pnpm --filter @safe-vanity-blockie/web start
```

Drive it headlessly and confirm: Tailwind styles are applied, the theme toggle switches light and dark, mining runs and the sticky bar updates, pause and resume work, a filter change does not restart the run, and the config lock plus "Start over" behave. Record the observed nonces/second — a production bundle loads the worker chunk and WASM differently from `next dev`, so a clean `build` is not evidence they work.

- [ ] **Step 5: Update the web README**

Add a short "Interface" section describing the single-page layout, the sticky bar, dark mode, and the two rules a reader would otherwise find surprising: Configure requires "Start over" because those fields determine the address, and mining pauses when a deploy starts. Correct any statement the redesign has made untrue.

- [ ] **Step 6: Stage**

```bash
git add -A
```

Suggested commit message: `feat(web): compose the redesigned page and document the interface`.

---

## Self-review

**Spec coverage.** Stack → Task 1. Sticky bar → Task 2. Collapsible Configure with "Start over" → Task 3. Live-editable Face → Task 4. Results grid → Task 5. Deploy dialog and the pause trigger → Task 6. Always-visible caveat → Tasks 2 and 6. Toasts, alerts, share link → Task 7. Composition, docs, production verification → Task 8. Dark mode → Task 1 (provider and toggle) and Task 8 (verified). The thirteen named components are all generated in Task 1; nothing outside that list is introduced.

**Constraints honoured.** No task modifies `packages/core`, `packages/safe-config` or `packages/miner`. No task modifies `packages/web/lib/` — Task 6 moves the deploy handler between components but calls the same unchanged `lib/deploy` functions. The address guards are relocated verbatim in Task 6 Step 3 and explicitly must not drift.

**Known hazards, addressed up front.** Radix under jsdom needs pointer-capture, `scrollIntoView`, `ResizeObserver` and `matchMedia` stubs — added in Task 1 Step 5 rather than left for each task to rediscover. Radix `Select` is a `combobox`, not a native select — the foundation test in Task 1 Step 7 demonstrates the query shape every later task must use, and Task 3 adds the first real test that drives one. `next-themes` needs `suppressHydrationWarning` on `<html>`, called out in Task 1 Step 6.

**Type consistency.** `MiningStatus`, `FaceFilters`, `MineConfig` and `Candidate` are each defined once and imported everywhere. `onDeployStart`/`onDeploySettled` are named identically in Task 6's interface block, its component and its page wiring.

**One ordering constraint.** Task 1 must land first — every later task imports from `components/ui/`, and the jsdom polyfills it adds are what let Radix components be tested at all.
