# @safe-vanity-blockie/core

Pure, isomorphic building blocks for mining a Safe `saltNonce` whose resulting address renders a
chosen two-color face as a [`blo`](https://github.com/bpierre/blo) identicon.

No Node built-ins and no DOM — it runs unchanged in Node, in a browser, and in a Web Worker. This
package is the engine behind the [`safe-vanity-blockie`](https://www.npmjs.com/package/safe-vanity-blockie)
CLI and the project's web app.

> [!CAUTION]
> A matching identicon is cosmetic and must never be trusted as proof of an address. Blockie
> look-alikes are a known phishing vector. Always verify the full address, never the picture.

## Install

Requires Node.js >= 22.

```
npm install @safe-vanity-blockie/core
```

## What's in it

| Area | Exports |
| --- | --- |
| Identicon | `bloData`, `bloDataInto`, `bloImage`, `bloSvg`, `randSeed`, `seedInto`, `randomColor`, `nextRandom` |
| Address derivation | `createAddressDeriver`, `AddressDeriver`, `SafeConstants` |
| Mining | `createMiner`, `Leaderboard`, `compareCandidates`, `Candidate`, `MineOptions`, `MineResult` |
| Scoring | `makeScorer`, `compileFace`, `describeMatch`, `isTwoColor`, `colorContrast`, `apportion`, `hslToRgb` |
| Result selection | `selectReported`, `filterCandidates`, `formatScore`, `scorePercent`, `SelectReportedResult` |
| Templates | `TEMPLATES`, `getTemplate`, `parseFaceSpec`, `faceWithMouths`, `BASE_TARGET`, `BASE_WEIGHTS`, `MOUTHS`, `MOUTH_INDICES`, `MOUTH_BUDGET`, `MOUTH_BG_WEIGHT`, `MOUTH_STROKE_WEIGHT` |
| Types | `FaceSpec`, `CompiledFace`, `FaceRegion`, `RegionAlternative`, `FixedCell`, `BloImage`, `Palette`, `Hsl` |
| Primitives | `createKeccak256`, `Keccak256`, `bytesToHex`, `hexToBytes` |

`bloDataInto` and `seedInto` write into a caller-supplied buffer, which is what makes a tight mining
loop allocation-free.

## Why a `blo` port

The identicon has to be computed millions of times per run, from raw bytes, with no DOM. This
package reimplements `blo`'s algorithm against that constraint while producing byte-identical output
to the original for the same address.

## Links

- [Repository](https://github.com/tmjssz/safe-vanity-blockie)
- [`safe-vanity-blockie`](https://www.npmjs.com/package/safe-vanity-blockie) — the CLI

MIT
