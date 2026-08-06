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

## Development

    mise install
    pnpm install
    pnpm test
