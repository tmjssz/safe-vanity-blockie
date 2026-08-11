# shadcn/ui Redesign — Design

**Status:** approved 2026-08-07
**Scope:** `packages/web` only. `packages/core`, `packages/safe-config` and `packages/miner` are untouched.

## Problem

`packages/web` works — it mines in the browser at ~1M nonces/s, streams results live, shares configs by link, and deploys through an injected wallet with four independent address checks. But its front end is a functional prototype: eleven components built from plain HTML on about twenty lines of CSS, with no design system, no dark mode, and a layout that grows unreadable as results accumulate.

This redesign gives it a real front end without touching the logic underneath.

## Stack

- **Tailwind CSS v4** (`4.3.3`) — CSS-first configuration via `@theme`, no `tailwind.config.js`.
- **shadcn CLI** (`4.16.2`) — copies component source into `packages/web/components/ui/`. It is a generator, not a runtime dependency; the components become our code and are reviewed like our code.
- `class-variance-authority`, `tailwind-merge`, `clsx` — required by the generated components.
- `lucide-react` — icons.
- `next-themes` — dark mode.

Components generated: `Button`, `Input`, `Label`, `Select`, `Checkbox`, `Card`, `Badge`, `Collapsible`, `Alert`, `Dialog`, `Progress`, `Separator`, `Sonner`, `Skeleton`.

`app/globals.css` is replaced by Tailwind's layer setup plus shadcn's design-token block for light and dark.

## Layout

One scrolling page.

```
┌────────────────────────────────────────────────┐
│ ▓ 92.1% · 4.2M nonces · 1.03M/s · [Pause]      │  sticky
│                              [Connect wallet]  │
├────────────────────────────────────────────────┤
│ ⚠ A matching identicon is cosmetic…            │  always visible
├────────────────────────────────────────────────┤
│ ▸ Configure   1 owner · threshold 1 · Sepolia  │  collapsible
│ ▾ Face        smile, frown, neutral            │  collapsible
├────────────────────────────────────────────────┤
│ Results                                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │ ▓▓▓ │ │ ▓▓▓ │ │ ▓▓▓ │ │ ▓▓▓ │              │
│  │92.1%│ │89.5%│ │88.7%│ │88.0%│              │
│  └─────┘ └─────┘ └─────┘ └─────┘              │
├────────────────────────────────────────────────┤
│ Deploy   0x70e9…04eed5   [ Deploy this Safe ]  │
└────────────────────────────────────────────────┘
```

- The **sticky bar** carries best score, scanned count, rate, worker count, a Pause/Resume control and the wallet button. It is the one thing always in view during a long search.
- **Configure** and **Face** are `Collapsible` cards that collapse to a one-line summary once set.
- The **phishing caveat** is an `Alert` that never collapses. It is the one piece of copy that must not become scenery.
- **Results** are `Card`s in a responsive grid, each with the real `blo` SVG, the percentage score, expression, two-colour and contrast badges, address and saltNonce.
- **Deploy** appears once a card is chosen.

## Behaviour

Three deliberate rules, each following from the fact that owners, threshold, version and chain determine the Safe address:

1. **Face stays live-editable.** Expression and filter changes already apply without restarting the search — `setFilters` re-publishes from the existing leaderboard. That keeps working.

2. **Configure requires an explicit "Start over".** Editing any address-determining field clears the results and the selected candidate. A result card must never outlive the config that produced it; the alternative is a card showing an address that the current config no longer predicts, which is the exact mismatch every guard on the deploy path exists to prevent.

3. **Mining keeps running while a result is inspected, and pauses when the deploy transaction is initiated.** The wallet confirmation is the one moment a user must read an address carefully, and it should happen on a quiet machine against a still surface. Cancelling the deploy resumes mining. This reuses the existing `resume: true` path — only the trigger moves, from "candidate selected" to "deploy initiated".

## Testing

All logic lives in `lib/` and is untouched: `browser-miner`, `use-miner`, `worker-protocol`, `deep-link`, `config`, `deploy`, `face-selection`. Their tests are unaffected.

Component tests need less rework than a redesign usually implies:

- `FacePicker` queries `getAllByRole('checkbox')` and by accessible name. Radix `Checkbox` renders `role="checkbox"`, so these survive.
- `ConfigForm` types into the owners field and submits with defaults; it never drives the two `<select>`s. Radix `Select` renders `role="combobox"` rather than a native select, so only tests that drive them would need rewriting — and none do today.

New tests cover the collapsible sections, the "Start over" reset clearing results and selection, and the pause-on-deploy trigger.

Every existing assertion is kept. Query strategy changes only where a primitive genuinely changed, so the suite keeps proving behaviour rather than markup.

## Explicitly unchanged

- `packages/core`, `packages/safe-config`, `packages/miner`.
- Every address guard on the deploy path: independent re-derivation via `createAddressDeriver`, the protocol-kit cross-check, the plan-vs-card comparison before sending, and the receipt-log check after.
- The share-link encoder and decoder, including its rejection of malformed owner entries.
- The worker protocol, the slicing loop, and the `runIdRef` stale-message guard.

## Risks

- **Tailwind v4 + Next 16 + Turbopack** is a recent combination. If the PostCSS wiring fights, it surfaces in the first task rather than late.
- **The diff touches every component.** Mitigated by leaving `lib/` alone, so the logic that carries the correctness burden is not in the blast radius.
- **A design system invites scope creep.** The component list above is the whole list; anything beyond it is a separate piece of work.

## Out of scope

The freeform 8×8 template designer and `FaceSpec` JSON import/export remain deferred to their own plan. This redesign does not add features — it restyles and restructures what exists, plus the three behaviour rules above.
