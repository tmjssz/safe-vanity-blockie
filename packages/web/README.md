# safe-vanity-blockie web

A Next.js app that mines a Safe `saltNonce` in your browser and deploys the result.

## Running

    mise exec -- pnpm -r build      # the app consumes core's compiled dist
    mise exec -- pnpm --filter @safe-vanity-blockie/web dev

## Interface

One page, top to bottom: a sticky header carrying the theme toggle and the wallet button, a sticky
mining bar pinned directly below it, the security caveat, **Configure**, **Face**, and **Results** —
with a "Run this search on your machine instead" disclosure above the grid that hands you the
equivalent `npx` command.

There is no separate deploy step: **clicking any result card opens its deploy dialog**, carrying
that candidate's score, a full-size identicon, its address and `saltNonce`, its share link and the
button that spends the gas. Closing the dialog puts you straight back on a grid that never stopped
mining.

The bar carries the best result found so far as a percentage, how many candidates the run is
keeping, the nonces scanned, the current rate, the worker count and a Pause/Resume control. It
appears as soon as a config is submitted and the Safe constants resolve —
which is not the same as "once mining has started": on a `?config=…` link that carries a saltNonce
it shows up already paused, offering Resume, before a single nonce has been scanned, because the
link's address is being re-derived first. It is fed by the mining state itself, so it keeps
reporting while you scroll through results far below it.

The badge on the **Results** heading is the number of cards below it, after the filters. Raise the
contrast floor past everything and it goes to 0 while the bar keeps reporting the best result
found — the bar reads the leaderboard, which the filters never touch, so it goes on answering "how
well is this search going" while the grid answers "what currently qualifies". The search has not
got worse; only the filter has got stricter.

Pause is not one flag. What the bar shows is your own pause combined with the app's: a deploy in
flight and a share link still being reconstructed both hold mining stopped on their own account. So
a Resume click during either can look like it did nothing — it means "run as soon as you are
allowed to", and mining starts the moment the other reason clears, without a second click.

Light and dark themes both ship; the toggle sits in the header next to the wallet button and
follows the system setting until you choose one. The header stays in view, so you can connect a
wallet without scrolling back to the top after a long search.

Three rules are worth knowing before you meet them:

- **Configure locks once you submit it, and the only way back is "Start over".** Owners,
  threshold, Safe version and chain are the inputs the Safe address is derived from, so editing
  one would silently invalidate every result on screen. "Start over" says so and asks for
  confirmation, then clears the config, the results and anything a `?config=…` link brought with
  it.
- **Face does not lock, but only the filters are free.** Expressions and the two-colour/contrast
  filters are both scoring and display concerns, so neither is ever locked — but they cost
  different things. The filters re-select from candidates already found, without restarting
  anything. Changing the accepted expressions restarts the search from nonce 0 and discards the
  leaderboard, because it changes what "a match" means and previously scored candidates are no
  longer comparable. There is no warning and no undo, so decide the expressions early. (Face is a
  collapsible card, open by default; collapsing it keeps the accepted expressions in its header.)
- **Mining pauses when a deploy starts, not when you open a result.** Reading a candidate in its
  dialog leaves the search running; confirming the transaction in your wallet is the one moment you
  must read an address carefully, so that is when the grid stops moving underneath you. It resumes
  from where it left off — keeping the leaderboard and the cumulative counts — whichever way the
  deploy attempt settles, and also if you dismiss the dialog while the wallet prompt is still open.

The results grid only ever shows the best candidates found so far, so the card you opened can drop
out of it as better ones arrive. That does not affect the open dialog: it holds exactly the
candidate you clicked, address and `saltNonce` unchanged, until you close it. Closing it while a
transaction is in flight is allowed — nothing can recall a transaction the wallet already has — and
the outcome then arrives as a toast, since the dialog that would have shown it inline is gone.

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
