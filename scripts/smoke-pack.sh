#!/usr/bin/env bash
# Packs the three publishable packages and installs the CLI the way a consumer would, then runs
# it. Requires `pnpm -r build` to have run first: pack copies whatever is in dist/.
#
# miner depends on core and safe-config via workspace:*, which pnpm rewrites to 0.1.0 on pack.
# Neither is on the registry, so npm `overrides` redirect those specifiers to the sibling tarballs.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

cd "$repo_root"
pnpm --filter @safe-vanity-blockie/core pack --pack-destination "$work_dir" >/dev/null
pnpm --filter @safe-vanity-blockie/safe-config pack --pack-destination "$work_dir" >/dev/null
pnpm --filter safe-vanity-blockie pack --pack-destination "$work_dir" >/dev/null

core_tgz="$(ls "$work_dir"/safe-vanity-blockie-core-*.tgz)"
config_tgz="$(ls "$work_dir"/safe-vanity-blockie-safe-config-*.tgz)"
# The [0-9] keeps this from matching the two scoped tarballs above.
cli_tgz="$(ls "$work_dir"/safe-vanity-blockie-[0-9]*.tgz)"

mkdir -p "$work_dir/smoke"
cat > "$work_dir/smoke/package.json" <<EOF
{
  "name": "cli-smoke",
  "private": true,
  "version": "0.0.0",
  "dependencies": { "safe-vanity-blockie": "file:$cli_tgz" },
  "overrides": {
    "@safe-vanity-blockie/core": "file:$core_tgz",
    "@safe-vanity-blockie/safe-config": "file:$config_tgz"
  }
}
EOF

npm --prefix "$work_dir/smoke" install --no-audit --no-fund >/dev/null

# Invoked through node_modules/.bin, which npm creates as a symlink — the same path `npx` takes.
help_output="$("$work_dir/smoke/node_modules/.bin/safe-vanity-blockie" --help)"

if [[ -z "$help_output" ]]; then
  echo "FAIL: the packaged CLI produced no output. It exits 0 while doing nothing." >&2
  exit 1
fi
for expected in 'Usage:' '--owners' '--target'; do
  if ! grep -q -- "$expected" <<< "$help_output"; then
    echo "FAIL: --help output is missing '$expected'." >&2
    exit 1
  fi
done

echo "PASS: packaged CLI runs from a consumer install."
