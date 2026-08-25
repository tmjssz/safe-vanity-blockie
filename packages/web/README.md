# safe-vanity-blockie web

A Next.js app that mines a Safe `saltNonce` in your browser and deploys the result.

## Running

    mise exec -- pnpm -r build      # the app consumes core's compiled dist
    mise exec -- pnpm --filter @safe-vanity-blockie/web dev

## Interface

One page, top to bottom: a sticky header carrying the theme toggle and the wallet button, a sticky
mining bar pinned directly below it, the security caveat, **Configure** (with an *Advanced*
disclosure for the starting saltNonce), **Face**, and **Results** — with a "Run on your machine"
disclosure beside the grid's heading that hands you the equivalent `npx` command.

The chain is named with its brand mark wherever it appears: in the header selector and its list,
in the confirmation for a switch that costs results, on the deploy dialog's wrong-chain button and
in the deploy outcome. Each mark is a brand-coloured disc with the chain's glyph knocked out in
white — one shape for all seven, which is what makes them a set rather than seven adjacent logos,
and what lets them keep their contrast on both themes without following `currentColor` the way
every lucide icon in the app does. They are inline SVG in
[`components/ChainIcon.tsx`](components/ChainIcon.tsx), so there is no icon dependency and no
request at runtime, and the glyphs come from [`@web3icons/core`](https://github.com/0xa3k5/web3icons)
(MIT) rather than being redrawn, so no chain is represented by an approximation of its own logo.
Sepolia is the exception it has to be: a testnet has no mark, so it takes Ethereum's diamond on an
amber disc — the one hue no supported chain has claimed.

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

Once the search stops — paused, exhausted, or halted by a worker error — **Checkpoint** appears as
the last item of the bar's config line, alongside the owners and the Safe version, and the panel
behind it holds the run's **resume point**: the nonce a follow-up run should begin at, with a copy
button, the worker count that belongs with it and the caveat below. It stays out of the way while
the search is working, because a running search resumes from its own checkpoint by itself. The
number is the highest end position any one of the run's workers reached, which is what makes it
safe to resume from: nothing already scanned is rescanned. It is *not* a measure of how far the
search got, and on a multi-worker machine it sits far above the nonce count on the row above,
because the workers' blocks lie side by side rather than end to end — a five-worker run that has
scanned a million nonces reports a resume point four trillion above where it began. Coverage is not
complete either: each worker keeps to a block of its own, so whatever its neighbours had not
reached when the run stopped is skipped rather than picked up later, and resuming with a different
worker count skips a different amount — which is why the panel hands over `--workers` alongside the
number rather than the number alone.

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

A run does not have to begin at 0. **Start from saltNonce**, under *Advanced* on the Configure card,
takes the first nonce to try — normally the resume point off a previous run, in this tab or from the
CLI's own printed `nextStart`. It accepts digits only, which is stricter than the CLI's `--start`
(that one parses with `Number` and would take `4.12e10`): a value pasted from a locale-grouped
number or a BigInt literal is refused with a message rather than reinterpreted as some other nonce.
Its ceiling depends on this machine, because the last worker's block sits `workers × 10^12` above
the start and that far end has to stay a safe integer — `core`'s deriver rejects anything else — so
a 32-core desktop accepts a slightly lower start than a laptop does, and the message says which
limit it is quoting. That ceiling bounds the first plan and only the first: a pause and resume
re-plans from the run's own resume point, which is higher than where it began, and nothing checks
the limit again — so a run started near the advertised maximum can put its last worker past 2^53
after a single Pause/Resume. Nothing is mis-mined if it does: the deriver throws, the worker reports
it, and the run stops with the error on screen. There is no guard, deliberately, since no fixed
ceiling can bound an unbounded run of resumes; start well below the limit if you mean to mine for
hours.

Where the search began is deliberately absent from `?config=` share links. A link names an address,
and an address does not depend on the search that found it. "Run on your machine" does carry it:
once anything has been scanned — not whether any result reached the grid — the generated command
grows `--workers` and `--start`, as a pair, so the native run continues the browser's search instead
of repeating it. That is a looser gate than the bar's Checkpoint trigger, which waits for the run to
stop: the dialog is worth opening mid-run, and what it writes is where the search had got to when
you opened it. Pinning `--workers`
to the browser's pool has a price worth knowing: it can hold a big machine to a browser tab's worth
of workers. No-rescan does not require it — any pool starting at the resume point rescans nothing —
only the symmetry does, so that the tail the native run leaves behind is the same width as the one
the browser left. Edit the flag out if you would rather have the cores.

## Wallets

Injected wallets only, discovered via EIP-6963. No WalletConnect, so the app needs no project
id and no secrets.

## Hosting

Hosted on Vercel, wired to this GitHub repo:

- **Production** — every push to `main`, at <https://safe-vanity-blockie-web.vercel.app/>.
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
