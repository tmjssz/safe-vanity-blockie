# safe-vanity-blockie

Brute-force a Safe deployment config (`saltNonce`) so the resulting Safe address renders a chosen
two-color face when drawn by [`blo`](https://github.com/bpierre/blo), the identicon library used by
the Safe UI.

The address is **counterfactual**: mining only finds a config. The address exists deterministically
whether or not the Safe is deployed, and on non-zkSync chains it is identical on every chain that
has the canonical Safe contracts.

> [!CAUTION]
> **A matching identicon is cosmetic and must never be trusted as proof of an address.** Blockie
> look-alikes are a known phishing vector: an attacker can mine a different address whose identicon
> looks the same to a human. Always verify the full address, never the picture.

> [!NOTE]
> This is a personal side project, not an official Safe product. It is not built, reviewed, or
> supported by Safe, and it carries no bug bounty.

## Install

Requires Node.js >= 22.

```
npx safe-vanity-blockie --help
```

Or install it:

```
npm install -g safe-vanity-blockie
```

## Mine

```
safe-vanity-blockie --owners 0xAbC...,0xDeF... --rpc https://ethereum-rpc.publicnode.com
```

It scans `saltNonce` values across a pool of worker threads and keeps a leaderboard of the best
matches. Run it until you like a result, then stop with Ctrl+C — the printed `nextStart` lets you
resume where you left off.

| Option | Default | Meaning |
| --- | --- | --- |
| `--owners <0x..,0x..>` | required | comma-separated Safe owners |
| `--threshold <n>` | `1` | signatures required |
| `--safe-version <v>` | `1.4.1` | Safe contract version |
| `--rpc <url>` | required | used once, for chainId and canonical contract addresses |
| `--target <name\|file>` | `faces` | builtin template (`faces`, or one expression), a comma-separated list of expressions (`smile,open`), or a FaceSpec JSON file |
| `--two-color` / `--no-two-color` | on | only report blockies using exactly two colours |
| `--min-contrast <n>` | `0` | drop results whose two colours are closer than this (0–442) |
| `--min-match <n>` | `0` | drop results matching the face less closely than this (0–100%) |
| `--workers <n>` | cores − 1 | worker threads |
| `--max-iterations <n>` | unbounded | total nonces to scan |
| `--start <n>` | `0` | first `saltNonce`; use the printed `nextStart` to resume |
| `--keep <n>` | `20` | leaderboard size |
| `--out <file.json>` | `safe-vanity-blockie-<UTC>.json` | machine-readable results; written even when the run is stopped with `Ctrl+C` |
| `--no-out` | | do not write the results file |
| `--gallery <file.html>` | | self-contained HTML gallery of real `blo` SVGs |
| `--l1-singleton` | | force the L1 Safe singleton on an L2 chain |

## Deploy

```
safe-vanity-blockie deploy --salt <n> --owners 0xAbC... --rpc <url>
```

> [!IMPORTANT]
> `deploy` needs a private key. Prefer the `SAFE_VANITY_DEPLOYER_KEY` environment variable over
> `--pk`: a key passed as a flag lands in your shell history and in the process list on a shared
> machine. The key signs the deployment transaction and is never written to disk or sent anywhere
> but the RPC endpoint you chose.

The command re-derives the address from your config and asks you to type `yes` before broadcasting.
Pass `--yes` to skip that (always skipped when stdin is not a TTY).

## Browser alternative

There is also a web app that mines in Web Workers and deploys with an injected wallet — no private
key involved. See the [project README](https://github.com/tmjssz/safe-vanity-blockie).

## Links

- [Repository](https://github.com/tmjssz/safe-vanity-blockie)
- [Security policy](https://github.com/tmjssz/safe-vanity-blockie/blob/main/SECURITY.md)

MIT
