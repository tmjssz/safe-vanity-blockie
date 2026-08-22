#!/usr/bin/env bash
# Asserts that every package.json in the workspace carries the same version, and — when given an
# argument — that the shared version is exactly that.
#
# Versioning here is lockstep: release-please owns the root version and fans it out to the four
# packages via extra-files. A partial fan-out would publish a tarball whose version disagrees with
# the tag that produced it, which is unfixable after the fact because npm versions are immutable.
# So this runs as a release gate, and is runnable locally for the same reason.
set -euo pipefail

# Resolved from the script's own path rather than `git rev-parse --show-toplevel`: this must also
# work when invoked by absolute path from a CWD that isn't inside a git work tree at all, and this
# script always lives one directory below the repo root, so BASH_SOURCE is enough on its own.
# Without this, running from anywhere but the repo root (e.g. `cd packages/core && ../../scripts/
# check-versions.sh`) reports every file below as missing instead of checking it.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Empty means "no expectation" — only check that the five agree with each other. release.yml calls
# it that way on a workflow_dispatch dry run, where there is no tag to compare against.
expected="${1:-}"

files=(
  package.json
  packages/core/package.json
  packages/safe-config/package.json
  packages/miner/package.json
  packages/web/package.json
)

versions=()
status=0

for f in "${files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "::error::$f does not exist"
    status=1
    continue
  fi

  # -e makes jq exit non-zero when the result is null, so a package.json that has lost its version
  # field fails loudly here instead of comparing an empty string against an empty string later.
  if ! v="$(jq -er '.version' "$f" 2>/dev/null)"; then
    echo "::error::$f: could not read .version (missing key, malformed JSON, or jq unavailable)"
    status=1
    continue
  fi

  printf '%-40s %s\n' "$f" "$v"
  versions+=("$v")
done

if [ "$status" -ne 0 ]; then
  exit 1
fi

# Guarded rather than expanded bare: under `set -u` an empty array expansion is an error on bash
# before 4.4, and this script is also run locally on whatever bash the developer has.
if [ "${#versions[@]}" -eq 0 ]; then
  echo "::error::no package.json files were read"
  exit 1
fi

distinct="$(printf '%s\n' "${versions[@]}" | sort -u | tr '\n' ' ')"
if [ "$(printf '%s\n' "${versions[@]}" | sort -u | wc -l)" -ne 1 ]; then
  echo "::error::package versions disagree: ${distinct}"
  exit 1
fi

if [ -n "$expected" ] && [ "${versions[0]}" != "$expected" ]; then
  echo "::error::expected version $expected but every package is at ${versions[0]}"
  exit 1
fi

if [ -n "$expected" ]; then
  echo "all ${#versions[@]} packages are at $expected"
else
  echo "all ${#versions[@]} packages agree at ${versions[0]}"
fi
