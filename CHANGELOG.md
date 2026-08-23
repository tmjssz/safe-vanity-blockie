# Changelog

## [0.4.1](https://github.com/tmjssz/safe-vanity-blockie/compare/v0.4.0...v0.4.1) (2026-08-23)


### Bug Fixes

* escape interpolated values before they reach a RegExp ([#35](https://github.com/tmjssz/safe-vanity-blockie/issues/35)) ([0eb8678](https://github.com/tmjssz/safe-vanity-blockie/commit/0eb867867bb157f11100bdc6ba13d5ebee517bd9))
* Unsafe HTML constructed from library input ([#36](https://github.com/tmjssz/safe-vanity-blockie/issues/36)) ([54b5655](https://github.com/tmjssz/safe-vanity-blockie/commit/54b5655b3e69d05c321999e977d2f8b5b1fa9066))
* **web:** name the accepted expressions in the handed-off CLI command ([#30](https://github.com/tmjssz/safe-vanity-blockie/issues/30)) ([9224e75](https://github.com/tmjssz/safe-vanity-blockie/commit/9224e75ddba54e18707d985a062afde12c8ac145))

## [0.4.0](https://github.com/tmjssz/safe-vanity-blockie/compare/v0.3.0...v0.4.0) (2026-08-22)


### Features

* **web:** rework the results empty state and the tile's address row ([#22](https://github.com/tmjssz/safe-vanity-blockie/issues/22)) ([92850e5](https://github.com/tmjssz/safe-vanity-blockie/commit/92850e56be54be1d69a084e3d9616117da459bcb))


### Bug Fixes

* **release:** verify the packages are live before the job goes green ([#26](https://github.com/tmjssz/safe-vanity-blockie/issues/26)) ([b56a05b](https://github.com/tmjssz/safe-vanity-blockie/commit/b56a05b18b40c5a4254377befa279da6c638e19e))

## [0.3.0](https://github.com/tmjssz/safe-vanity-blockie/compare/v0.2.0...v0.3.0) (2026-08-22)


### Features

* add a minimum match percentage filter ([#17](https://github.com/tmjssz/safe-vanity-blockie/issues/17)) ([cec0064](https://github.com/tmjssz/safe-vanity-blockie/commit/cec00647ed6ea0a242cebfd9fe61d93566da4ef6))


### Bug Fixes

* **release:** skip packages already on the registry ([#25](https://github.com/tmjssz/safe-vanity-blockie/issues/25)) ([05c355e](https://github.com/tmjssz/safe-vanity-blockie/commit/05c355e4ba0821bfce0d2f4005439a0897b8058f))

## [0.2.0](https://github.com/tmjssz/safe-vanity-blockie/compare/v0.1.0...v0.2.0) (2026-08-21)


### Features

* **web:** redesign the results grid and the deploy flow ([#7](https://github.com/tmjssz/safe-vanity-blockie/issues/7)) ([2bed50d](https://github.com/tmjssz/safe-vanity-blockie/commit/2bed50d0be50fdf3585acec818008f7aaa5f7900))
* **web:** rework the mining screen's filter, wait state and CLI handoff ([#12](https://github.com/tmjssz/safe-vanity-blockie/issues/12)) ([e22a9bd](https://github.com/tmjssz/safe-vanity-blockie/commit/e22a9bdb3b5baee6cc30b04b709daf9741e59de2))
* **web:** show a brand mark for every chain the app names ([#11](https://github.com/tmjssz/safe-vanity-blockie/issues/11)) ([122addc](https://github.com/tmjssz/safe-vanity-blockie/commit/122addcf31b71f959524e9c7d44712bd5b33e782))

## [0.1.0](https://github.com/tmjssz/safe-vanity-blockie/releases/tag/v0.1.0) (2026-08-15)


### Features

* **core:** add hex helpers and the hash-wasm keccak-256 backend ([e96a1c2](https://github.com/tmjssz/safe-vanity-blockie/commit/e96a1c2c885c9570e0085611645c88e6cdd21b91))
* **core:** add the leaderboard, mining loop and public API surface ([9bcd262](https://github.com/tmjssz/safe-vanity-blockie/commit/9bcd262f58639bbe195c4c479d9f446e4dd94d08))
* **core:** bootstrap workspace and port the blo identicon algorithm ([c7e9189](https://github.com/tmjssz/safe-vanity-blockie/commit/c7e918998ebd22b1dd5972a1aef908c1a75b76da))
* **core:** compile face templates into an allocation-free integer scorer ([6140738](https://github.com/tmjssz/safe-vanity-blockie/commit/614073879aa5c1c0e388ad6026abe929a27d885f))
* **core:** derive Safe CREATE2 addresses from precomputed constants ([db8c494](https://github.com/tmjssz/safe-vanity-blockie/commit/db8c494c7ebdea1e7eb7dd441c613504cf0f13b5))
* **miner:** adapt the result grid to the terminal width ([2b6d76a](https://github.com/tmjssz/safe-vanity-blockie/commit/2b6d76a58b1be1d1185c7fbc391959e1601a8722))
* **miner:** add CLI argument parsing and JSON/HTML/ASCII reporting ([886599c](https://github.com/tmjssz/safe-vanity-blockie/commit/886599ca4f09c1eefe55e7ef40d5b3ce5d20baa7))
* **miner:** add the deploy subcommand and complete the README ([7819b5d](https://github.com/tmjssz/safe-vanity-blockie/commit/7819b5d45ea909318e19f53cb6fc8c73c1f5983e))
* **miner:** display scores as percentages throughout ([2085e9d](https://github.com/tmjssz/safe-vanity-blockie/commit/2085e9de0fdd9d5db930abaf27a2dd7f669d885b))
* **miner:** draw the current best face live while mining ([8097d88](https://github.com/tmjssz/safe-vanity-blockie/commit/8097d88ab87e4646d1bae0b2c1cb263539ad383b))
* **miner:** fan out disjoint nonce ranges across worker threads ([6f9f7e2](https://github.com/tmjssz/safe-vanity-blockie/commit/6f9f7e269d277103839ce2d2085ad48c6bb997aa))
* **miner:** pad the live result strip with blank lines for separation ([502ff2d](https://github.com/tmjssz/safe-vanity-blockie/commit/502ff2d9ba221ba45d184d5f1223e9b5d597a94b))
* **miner:** read Safe CREATE2 constants via protocol-kit with a predictSafeAddress self-check ([de69957](https://github.com/tmjssz/safe-vanity-blockie/commit/de69957030f5dc3a65e5ce496c9d9f9e04e42099))
* **miner:** report elapsed mining time live, in the summary and in the gallery ([4b0a69d](https://github.com/tmjssz/safe-vanity-blockie/commit/4b0a69d4b3173a2f95d4210e2a615b7fd7a2237d))
* **miner:** show compact runner-up blockies beneath the winning face ([e115724](https://github.com/tmjssz/safe-vanity-blockie/commit/e11572481393d9dce6fd2c25cbd5c85cdcc5df78))
* **miner:** show eight results with saltNonce captions and wider gutters ([761efef](https://github.com/tmjssz/safe-vanity-blockie/commit/761efef436ae8b265fa439ced3b1931d0749497d))
* **miner:** show the top five at full size in one row, live and in the report ([6760dcb](https://github.com/tmjssz/safe-vanity-blockie/commit/6760dcbc7a625494e9749592c795cd79d8bd6ad5))
* **miner:** wire up the CLI with live progress, self-check and outputs ([806518b](https://github.com/tmjssz/safe-vanity-blockie/commit/806518b8cb182c9b57b63d883e16461cb8d6fd60))
* **web:** add ?config= deep links ([93d6043](https://github.com/tmjssz/safe-vanity-blockie/commit/93d60435284fa4c832163b41dff11a30cc1122ac))
* **web:** add face selection with a live blo preview ([aa041e0](https://github.com/tmjssz/safe-vanity-blockie/commit/aa041e05b8c53b160e61d75399283999308ec0db))
* **web:** add the CLI handoff and document the app ([ab73025](https://github.com/tmjssz/safe-vanity-blockie/commit/ab73025cebbbf8808a461f8b44db5ef3fbe4d224))
* **web:** add the deploy flow with an independent address cross-check ([707fe46](https://github.com/tmjssz/safe-vanity-blockie/commit/707fe467667a1cffbf96947209db73f1782f6bb3))
* **web:** add the live mining view and result cards ([e706a29](https://github.com/tmjssz/safe-vanity-blockie/commit/e706a29c8ac35fab750b84b1a91da3d44ff607fa))
* **web:** add the mining worker and useMiner hook ([e791c27](https://github.com/tmjssz/safe-vanity-blockie/commit/e791c274541e5d27e9162c9fe0c640ed86ae94e0))
* **web:** add the sliced browser mining loop ([fdcd035](https://github.com/tmjssz/safe-vanity-blockie/commit/fdcd03505a872a19a3d6d8d2ba45a132bf6e33a4))
* **web:** connect injected wallets via wagmi ([ba3c2af](https://github.com/tmjssz/safe-vanity-blockie/commit/ba3c2afc22f5856ed07031295b095acb3c839d11))
* **web:** preview target patterns and expose two-colour and contrast filters ([a3dc279](https://github.com/tmjssz/safe-vanity-blockie/commit/a3dc279868349d8d5db61c9669970f403862b5d3))
* **web:** redesign the app on shadcn/ui ([#2](https://github.com/tmjssz/safe-vanity-blockie/issues/2)) ([eef241b](https://github.com/tmjssz/safe-vanity-blockie/commit/eef241b480708f35be2e11d96b5c2c03f9e8574e))
* **web:** scaffold the Next.js app and the config step ([8b54cd8](https://github.com/tmjssz/safe-vanity-blockie/commit/8b54cd817319b38017ce99774b058fcd75d61c69))


### Bug Fixes

* **core:** bound Leaderboard.seen, strengthen miner test coverage ([63260a9](https://github.com/tmjssz/safe-vanity-blockie/commit/63260a97a1841989233a1efac63eac877f6eab81))
* **core:** hexToBytes strict validation and extended tests ([b96cfe6](https://github.com/tmjssz/safe-vanity-blockie/commit/b96cfe6b328278f552dd639061348203a0e79605))
* **core:** reject non-object entries in parseFaceSpec ([0b1789f](https://github.com/tmjssz/safe-vanity-blockie/commit/0b1789fd22e211589d0a1e684227437901ec18e6))
* **core:** wrap deriveBig buffer cleanup in try-finally for invariant safety ([4f72039](https://github.com/tmjssz/safe-vanity-blockie/commit/4f72039278c37bfb9f2b704539288b8a2e21f567))
* harden the deploy path, packaging and template lookup after final review ([0be138b](https://github.com/tmjssz/safe-vanity-blockie/commit/0be138b39c412daf464f3675ae0b21a26e357e70))
* **miner:** correct nextStart to the highest worker end position, terminate on error ([2475331](https://github.com/tmjssz/safe-vanity-blockie/commit/2475331a821bef516c8727c37640e7d4553d0dce))
* **miner:** correct ZKSYNC_CHAIN_IDS to match protocol-kit's zkSync gate ([f9f40b8](https://github.com/tmjssz/safe-vanity-blockie/commit/f9f40b8307728b85b84f01afd2c94dee13ae8a95))
* **miner:** drop the raw max score from the startup banner ([04221b8](https://github.com/tmjssz/safe-vanity-blockie/commit/04221b8b16cc2360f3ce84bffffbe105a61d1b36))
* **miner:** erase the live block before the SIGINT notice ([cc4b648](https://github.com/tmjssz/safe-vanity-blockie/commit/cc4b648689f2908e186209b7130f5bedd014dc1e))
* **miner:** let a second Ctrl+C force-quit a wedged run ([5a9f16f](https://github.com/tmjssz/safe-vanity-blockie/commit/5a9f16f1243da48a5765dcaedbd8df31ba9c220b))
* **miner:** listen for resize on the stream the live block is drawn on ([0e8d132](https://github.com/tmjssz/safe-vanity-blockie/commit/0e8d132dd6c4f14d08e13851cb3fc5365b7e2e20))
* **miner:** over-retain before filtering, report drops, detect non-TTY progress ([0f2d6a3](https://github.com/tmjssz/safe-vanity-blockie/commit/0f2d6a32871cedbe4fb71dd3dac86e49f2108ea6))
* **miner:** report the filtered best in the non-TTY progress log ([725f4ca](https://github.com/tmjssz/safe-vanity-blockie/commit/725f4cae86ed2144d15a1c1ecd374b3309569f4f))
* **miner:** stop overshooting --max-iterations ([c1cef7e](https://github.com/tmjssz/safe-vanity-blockie/commit/c1cef7eda0f05a40ced403df361c4ed95b4673db))
* **miner:** stop untrusted region names shadowing result JSON fields ([0d2330c](https://github.com/tmjssz/safe-vanity-blockie/commit/0d2330cb5469d3852b738c212e44d4c79b7a3b62))
* **miner:** survive a failing --out / --gallery write ([880ee29](https://github.com/tmjssz/safe-vanity-blockie/commit/880ee2912b92c82401b00f219acfe487d5edadc1))
* **web:** guard chainId before BigInt and restore capitalised error copy ([2735915](https://github.com/tmjssz/safe-vanity-blockie/commit/2735915e722adaa01b371dd8b082254abe550878))
* **web:** ignore stale worker messages from superseded runs ([4e06e99](https://github.com/tmjssz/safe-vanity-blockie/commit/4e06e99b883e68bbbe6244428d8d385d8a1103a4))
* **web:** keep mining resumable after a share link and preserve results across a pause ([70606ae](https://github.com/tmjssz/safe-vanity-blockie/commit/70606aed1211c60b8cc994ce3672550acb3b727a))
* **web:** re-filter results without restarting the worker pool ([4682dbb](https://github.com/tmjssz/safe-vanity-blockie/commit/4682dbb758d06f02d81e2400a88fcea008426c82))
* **web:** reject share links with a malformed owner entry ([949162e](https://github.com/tmjssz/safe-vanity-blockie/commit/949162ecf2b937eb2a3474c122c178874ce66d96))
* **web:** reset deploy state per candidate, surface worker failures, deploy from share links ([4799ff4](https://github.com/tmjssz/safe-vanity-blockie/commit/4799ff4d1efed32b5b159194b44ea267bd75b334))
* **web:** verify the deployed address and guard the deploy button ([b2e95ef](https://github.com/tmjssz/safe-vanity-blockie/commit/b2e95efb3e4a524c7b95df69f40ebcf5e499c1a0))
