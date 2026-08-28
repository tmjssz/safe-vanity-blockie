# safe-vanity-blockie

[![CI](https://github.com/tmjssz/safe-vanity-blockie/actions/workflows/ci.yml/badge.svg)](https://github.com/tmjssz/safe-vanity-blockie/actions/workflows/ci.yml?query=branch%3Amain)
[![Nightly](https://github.com/tmjssz/safe-vanity-blockie/actions/workflows/nightly.yml/badge.svg)](https://github.com/tmjssz/safe-vanity-blockie/actions/workflows/nightly.yml)
[![npm](https://img.shields.io/npm/v/safe-vanity-blockie.svg)](https://www.npmjs.com/package/safe-vanity-blockie)
[![Live app](https://img.shields.io/badge/live-app-000?logo=vercel)](https://safe-vanity-blockie-web.vercel.app/)
[![License: MIT](https://img.shields.io/npm/l/safe-vanity-blockie.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/safe-vanity-blockie.svg)](package.json)

Brute-force a Safe deployment config (`saltNonce`) so the resulting Safe address renders a chosen
two-color face when drawn by [`blo`](https://github.com/bpierre/blo), the identicon library used by
the Safe UI.

The address is **counterfactual**: mining only finds a config. The address exists deterministically
whether or not the Safe is deployed, and on non-zkSync chains it is identical on every chain that has
the canonical Safe contracts.

## Security caveat

> [!CAUTION]
> **A matching identicon is cosmetic and must never be trusted as proof of an address.** Blockie
> look-alikes are a known phishing vector: an attacker can mine a different address whose identicon
> looks the same to a human. Always verify the full address, never the picture.

> [!NOTE]
> **This is a personal side project, not an official Safe product.** It is not built, reviewed, or
> supported by Safe, and it carries no bug bounty. See [SECURITY.md](SECURITY.md) for what is in
> scope and how to report a problem privately.

## Packages

- `packages/core` — pure, isomorphic library: `blo` port, CREATE2 derivation, scoring, templates
- `packages/miner` — multi-core CLI
- `packages/web` — browser app: mine in a Web Worker pool, connect a wallet, deploy the result

## Web app

`packages/web` is a Next.js app that mines a `saltNonce` across a pool of Web Workers, shows
live results as real `blo` SVGs, restores a config from a `?config=` share link, and deploys a
chosen result with a connected injected wallet. It cross-checks the deployed address twice
before showing success — see [`packages/web/README.md`](packages/web/README.md) for how it
mines, its performance figures, and its wallet support. Below the results it also offers a
ready-to-paste `npx safe-vanity-blockie` command for the current search, for runs long enough to
want every CPU core and resumability. Mining also stops on the app's own account — while a deploy
is in flight, and while a share link's `saltNonce` is being re-derived — so the Pause control is
your reason combined with those, not a single switch.

    mise exec -- pnpm -r build
    mise exec -- pnpm --filter @safe-vanity-blockie/web dev

It is hosted on Vercel at <https://safe-vanity-blockie-web.vercel.app/>: `main` is production, and
every pull request gets its own preview URL. See
[Hosting](packages/web/README.md#hosting) for the project settings and why the build command is not
plain `next build`.

## Development

    mise install
    pnpm install
    pnpm test

### CI

Every pull request runs two jobs:

- **`lint`** — `biome ci .` (formatting and lint, no build required)
- **`build-test`** — `pnpm -r build`, then `pnpm -r typecheck`, `pnpm -r test`, then
  `scripts/smoke-pack.sh`, which packs the CLI and runs it from a consumer-style npm install

Once branch protection is enabled on `main`, both are required checks. Reproduce them locally
with:

    pnpm lint
    pnpm -r build && pnpm -r typecheck && pnpm -r test
    ./scripts/smoke-pack.sh

The build must precede the typecheck: packages resolve `@safe-vanity-blockie/core` through its
`dist` types, and `packages/web` additionally needs the types `next build` generates.

The RPC-dependent suites (`pnpm -r test:network`) are **not** run on pull requests — they hit a
live public endpoint. They run nightly, and on demand with `gh workflow run nightly.yml`.

Formatting is Biome, pinned in `package.json`. Run `pnpm format` before pushing. The commit that
first reformatted the repo is listed in `.git-blame-ignore-revs`; to skip it in blame output:

    git config blame.ignoreRevsFile .git-blame-ignore-revs

### Releases

Versioning is lockstep: the root `package.json` and all four packages always carry the same
version, and one tag `vX.Y.Z` names the whole repo. Nobody edits a version by hand — release-please
writes all five from the conventional-commit history.

To release:

1. Merge your work to `main` with conventional-commit subjects (`feat:`, `fix:`, `chore:` …). Only
   `feat` and `fix` move the version; a run of `chore`/`docs` commits produces no release PR, which
   is correct rather than broken.
2. Release-please opens a release PR, titled by its default pattern (like `chore: release 0.3.1`,
   possibly with a `(main)` scope); find it by the `autorelease: pending` label. It stays up to date
   as more commits land and shows the pending changelog and the five version bumps. Open one early
   with `gh workflow run release-please.yml` if you want to see it before pushing more.
3. **Merging that PR is the release.** It tags `vX.Y.Z`, publishes the GitHub Release from the
   changelog, and `release.yml` then builds, tests, smoke-packs, checks all five versions against
   the tag, and publishes the three npm packages with provenance.

Vercel deploys every push to `main` independently of this. The footer's `v0.3.0 (a1b2c3d)` names
the release the build descends from plus the commit actually deployed, so a deploy ahead of the
last tag is still identifiable.

A breaking change needs an explicit `feat!:` or a `BREAKING CHANGE:` footer — release-please cannot
infer one from prose. Pre-1.0 a minor bump for a breaking change is semver-legal anyway.

Check what a release would contain without creating one:

    gh workflow run release.yml -f dry-run=true

Verify versions agree at any time:

    ./scripts/check-versions.sh

The **first** release PR will show a large diff in three of the four packages'
`package.json` files — roughly 30 changed lines in `packages/core/package.json`, of which one is
the version. That's release-please's `extra-files` updater re-serialising the whole file (those
three currently use compact inline JSON), not a change to their contents; it happens once and then
stays formatted. Nothing breaks — Biome's JSON formatter is disabled — but the diff isn't a useful
review signal by eye. Check it semantically instead:

    for f in package.json packages/*/package.json; do
      diff <(git show origin/main:$f | jq -S 'del(.version)') <(jq -S 'del(.version)' $f) \
        || echo "SEMANTIC CHANGE in $f"
    done

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

Results are written to `safe-vanity-blockie-<UTC>.json` in the working directory unless you name a
file with `--out` or suppress it with `--no-out` — so a run you stopped, or a terminal you closed,
does not take its results with it. The name marks when the run started, so successive runs sit
beside each other rather than overwriting one another.

### Targets

`--target` accepts a builtin name (`faces`, `smile`, `frown`, `neutral`, `open`, `small`), a
comma-separated list of expressions, or a path to a `FaceSpec` JSON file. `faces` pins the eyes and
accepts any of the five expressions, crediting each candidate with its best-fitting one.

A list narrows that set to the expressions you want and nothing else — `--target smile,open`
accepts either of those two mouths. It is what the web app's "Run on your machine" command uses, so
a native run searches exactly the target the browser was searching:

    npx safe-vanity-blockie --owners 0xYourOwner --rpc <url> --target smile,open

### Resuming and merging runs

Each run prints a resume line. Start the next run there, with the same `--workers`, and merge the
JSON files by deduping on `address`:

    npx safe-vanity-blockie … --start 8400000000 --workers 8 --out results-2.json

### What score to expect

A mathematically perfect face (all 32 cells exact) is roughly a 1-in-4×10¹¹ event, so it is not
brute-forceable. Scoring pushes residual error into the lowest-weight corner cells, which makes
96–98% the practical ceiling — one or two faint stray pixels, never in the eyes or mouth.

| quality | ~nonces | CLI (~2.5–3M/s on 8 cores) |
|---|---|---|
| recognisable face (~91%) | ~3–10M | seconds |
| clean face (~94%) | ~0.1–0.4B | seconds to 2 min |
| very clean (~95–96%) | ~0.7–4B | 4–25 min |
| near-perfect (~98%) | ~8B | 45–55 min |

The figures above (other than the first row) are modelled estimates from the design spec, not
measurements. The measured rate is ~470k nonces/s per worker core (1.89M/s aggregate on 4 workers of
a 6-core machine); only the first row has been observed directly, in a 6M-nonce run that reached
92%. The table assumes 8 cores, so times roughly double on a 4-core laptop.

### Deploying

The mined config is counterfactual — deploy whenever you like, on any chain with the canonical Safe
contracts (zkSync-based chains are rejected: they derive addresses differently).

Set the deployer key via an environment variable rather than `--pk`, so it never lands in shell
history or `ps` output:

    export SAFE_VANITY_DEPLOYER_KEY=0xYourDeployerKey
    npx safe-vanity-blockie deploy \
      --salt 5254976178 --owners 0xYourOwner --threshold 1 \
      --rpc https://…

`deploy` prints the plan (address, chain, saltNonce, owners, threshold) and, when run at an
interactive terminal, asks you to type `yes` before broadcasting. Pass `--yes` to skip the prompt
for scripted use; anything other than `yes` aborts with no transaction sent.

## Testing

    pnpm test           # offline: unit + worker-pool integration
    pnpm test:network   # additionally hits a public RPC and protocol-kit

Set `TEST_RPC_URL` to use your own endpoint.

## Prior art

Austin Griffith's [`vanity-blockie-miner`](https://github.com/austintgriffith/vanity-blockie-miner)
brute-forces EOA private keys against the older `ethereum/blockies` algorithm. This project targets a
Safe CREATE2 `saltNonce` — a deploy config, not a key — against `blo` specifically, with a two-colour,
multi-expression scoring model.
