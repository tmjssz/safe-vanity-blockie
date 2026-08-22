# @safe-vanity-blockie/safe-config

Resolves the canonical Safe contract addresses for a chain and turns a Safe setup (owners,
threshold, version) into the initializer and `saltNonce` inputs that
[`@safe-vanity-blockie/core`](https://www.npmjs.com/package/@safe-vanity-blockie/core) needs to
derive a counterfactual address.

Unlike `core`, this package talks to a chain: it reads the chain ID from an RPC endpoint once, then
looks up the proxy factory and singleton deployed there.

## Install

Requires Node.js >= 22.

```
npm install @safe-vanity-blockie/safe-config
```

## Exports

| Export | Purpose |
| --- | --- |
| `loadSafeConstants` | resolve proxy factory, singleton and init code hash for a chain |
| `verifyWithProtocolKit` | cross-check a derived address against the official Safe Protocol Kit |
| `ZKSYNC_CHAIN_IDS` | chains whose CREATE2 derivation differs, so an address is not portable |
| `SafeSetup`, `SetupInput` | the setup shape and its input form |

`verifyWithProtocolKit` exists because deriving an address yourself is only trustworthy if it agrees
with the reference implementation. The CLI and the web app both run it before showing a result.

## zkSync

zkSync-family chains use a different CREATE2 scheme, so an address mined for one of them is **not**
the same on other chains. `ZKSYNC_CHAIN_IDS` is how callers detect that case and say so.

## Links

- [Repository](https://github.com/tmjssz/safe-vanity-blockie)
- [`safe-vanity-blockie`](https://www.npmjs.com/package/safe-vanity-blockie) — the CLI

MIT
