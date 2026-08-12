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
- `packages/web` — browser app: mine in a Web Worker pool, connect a wallet, deploy the result

## Web app

`packages/web` is a Next.js app that mines a `saltNonce` across a pool of Web Workers, shows
live results as real `blo` SVGs, restores a config from a `?config=` share link, and deploys a
chosen result with a connected injected wallet. It cross-checks the deployed address twice
before showing success — see [`packages/web/README.md`](packages/web/README.md) for how it
mines, its performance figures, and its wallet support. Below the results it also offers a
ready-to-paste `npx safe-vanity-blockie` command for the current search, for runs long enough to
want every CPU core and resumability.

    mise exec -- pnpm -r build
    mise exec -- pnpm --filter @safe-vanity-blockie/web dev

It is hosted on Vercel: `main` is production, and every pull request gets its own preview URL. See
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
