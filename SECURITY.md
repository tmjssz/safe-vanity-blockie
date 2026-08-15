# Security policy

This is a personal, MIT-licensed side project, not an official Safe product and not covered by any
Safe bug bounty. Reports are handled on a best-effort basis by one maintainer.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on this repository. That opens
a draft advisory only the maintainer can see.

Please do not open a public issue for anything that could put someone's funds at risk.

Useful things to include: the affected package, the version or commit, what an attacker gains, and
the smallest reproduction you can manage. You should get an acknowledgement within a week; a fix,
if one is warranted, ships on `main` and — for `packages/miner` — as a new npm release.

## Supported versions

Only the latest commit on `main` and the latest published version of the `safe-vanity-blockie` CLI.
Older versions get no backports.

## Where private keys are involved

- **The web app never sees a private key.** It connects an injected wallet, and that wallet signs
  the deployment. Mining happens entirely in Web Workers in your browser.
- **The CLI's `deploy` command does take one**, via `--pk` or the `SAFE_VANITY_DEPLOYER_KEY`
  environment variable. Prefer the environment variable — a key passed as a flag lands in your shell
  history and in the process list on a shared machine. The key is used to sign the deployment
  transaction and is never written to disk or sent anywhere but the RPC endpoint you chose.

A flaw that leaks, logs, or transmits that key is in scope and is the most serious class of bug this
project can have.

## In scope

- Incorrect address derivation in `packages/core` — anything that makes the tool report an address
  the config does not actually produce.
- The deploy path in `packages/miner` and `packages/web`, including the post-deploy address
  cross-check.
- Share-link (`?config=`) parsing that could be used to feed a user a config other than the one
  displayed.
- Dependency vulnerabilities with a plausible path to exploitation here.

## Not vulnerabilities

**Identicon look-alikes are the point of the tool, not a bug in it.** Anyone can mine a *different*
address whose blockie looks the same to a human eye. That is inherent to a 4×4 identicon: the picture
carries far less information than the address. A matching face is cosmetic and must never be treated
as proof of an address — always verify the full address. See the security caveat near the top of the
[README](README.md).

**A mined config is not a secret.** The address is counterfactual and derived from public inputs
(owners, threshold, `saltNonce`, Safe version). Anyone holding your share link can deploy that same
Safe. This does not give them control of it — ownership is fixed by the owner set baked into the
config — but do not treat a `?config=` URL as private.

**Public RPC defaults.** The tools fall back to public RPC endpoints, which can see your queries and
can lie about chain state. Point them at an endpoint you trust for anything that matters.
