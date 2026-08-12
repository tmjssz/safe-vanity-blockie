# safe-vanity-blockie web

A Next.js app that mines a Safe `saltNonce` in your browser and deploys the result.

## Running

    mise exec -- pnpm -r build      # the app consumes core's compiled dist
    mise exec -- pnpm --filter @safe-vanity-blockie/web dev

## Interface

One page, top to bottom: a sticky mining bar, the security caveat, **Configure**, **Face**,
**Results**, and — once a result is picked — **Deploy**.

The bar is pinned to the top of the viewport for the whole run and carries the best score so far,
the nonces scanned, the current rate, the worker count and a Pause/Resume control. It only exists
once mining has started, and it is fed by the mining state itself, so it keeps reporting while you
scroll through results far below it.

Light and dark themes both ship; the toggle sits in the header next to the wallet button and
follows the system setting until you choose one.

Three rules are worth knowing before you meet them:

- **Configure locks once you submit it, and the only way back is "Start over".** Owners,
  threshold, Safe version and chain are the inputs the Safe address is derived from, so editing
  one would silently invalidate every result on screen. "Start over" says so and asks for
  confirmation, then clears the config, the results and anything a `?config=…` link brought with
  it.
- **Face does not lock, and changing it does not throw away the run.** Expressions and the
  two-colour/contrast filters are scoring and display concerns, so they apply live: the filters
  re-select from candidates already found without restarting anything, and changing the accepted
  expressions starts a new search only because it changes what "a match" means.
- **Mining pauses when a deploy starts, not when you select a result.** Inspecting a candidate
  leaves the search running; confirming the transaction in your wallet is the one moment you must
  read an address carefully, so that is when the grid stops moving underneath you. It resumes from
  where it left off — keeping the leaderboard and the cumulative counts — whichever way the deploy
  attempt settles.

The results grid only ever shows the best candidates found so far, so the card you picked can drop
out of it as better ones arrive — taking its highlight ring and "Selected" badge with it, which
looks like the selection was lost. It was not: the Deploy panel below still holds exactly the
candidate you chose, address and `saltNonce` unchanged, until you pick another or go back to
mining.

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
6-core sandbox VM has ranged ~810,000–2,200,000 nonces/s between separate runs and separate
sandbox hosts — the spread is the machine, not the code: a shared CPU whose availability varies
run to run. The top of that range is from production builds (`next build && next start`), where
two runs minutes apart measured 1.78M/s and 2.20M/s; the lower figures are from earlier runs on a
different host. The CLI's measured rate is ~470k nonces/s per worker
core. Treat all of them as a starting point for your own hardware, not a guarantee: a real focused
desktop tab with dedicated cores should do at least as well, and a background or mobile tab will
do considerably worse.

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
