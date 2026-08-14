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

Each worker gets a disjoint block of nonces. Measured aggregate throughput across 5 workers on a
6-core sandbox VM has ranged ~810,000–1,100,000 nonces/s between separate runs — i.e. well under
one full core's worth per worker, consistent with a shared/contended CPU whose availability
varies run to run, rather than a dedicated desktop. The CLI's measured rate is ~470k nonces/s per
worker core. Treat both as a starting point for your own hardware, not a guarantee: a real
focused desktop tab with dedicated cores should do at least as well as the sandbox figures above,
and a background or mobile tab will do considerably worse.

## Wallets

Injected wallets only, discovered via EIP-6963. No WalletConnect, so the app needs no project
id and no secrets.

## Hosting

Hosted on Vercel, wired to this GitHub repo:

- **Production** — every push to `main`.
- **Preview** — every push to any other branch. Vercel comments the URL on the PR.

Settings in the Vercel dashboard, set once when the project is created:

| Setting | Value |
|---|---|
| Root Directory | `packages/web` |
| Include files outside of the Root Directory | enabled |
| Build Command | leave unset — `vercel.json` takes precedence |
| Environment Variables | leave empty |

Everything else is in [`vercel.json`](vercel.json), which Vercel reads from the Root Directory.
The build command there is `pnpm --filter "@safe-vanity-blockie/web..." build` rather than the
default `next build`, because this app consumes `core` and `safe-config` as compiled `dist/` and
`pnpm install` does not produce it: those packages declare `prepublishOnly`, which runs on publish
and not on install. The trailing `...` is pnpm's "and its dependencies", so the two libraries
compile first, in topological order.

There are no environment variables and no secrets. The transports use each chain's default public
RPC and the only connector is `injected()`, with EIP-6963 discovery, so a fork deploys and runs
with nothing configured.
