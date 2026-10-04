#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
VERSION="${VERSION#v}" # strip leading v if present

if [[ -z "$VERSION" ]]; then
  echo "usage: scripts/release.sh <version>"
  echo "example: scripts/release.sh 0.1.2"
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must be semver (e.g. 0.1.2 or v0.1.2)"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty, commit or stash changes first"
  exit 1
fi

if git tag | grep -q "^v${VERSION}$"; then
  echo "error: tag v${VERSION} already exists"
  exit 1
fi

echo "bumping to ${VERSION} (package.json, npm/package.json, packages/schemas/package.json)"
echo "renaming snapshots/*/next.schema.json → ${VERSION}.schema.json"
echo "appending ${VERSION} to the release ledger"
# Runs before gen:usage-spec, which reads the release from the generated
# src/schemas/release.ts. Prints every path it changed, one per line.
if ! CUT_OUTPUT="$(pnpm exec tsx scripts/release-cut.ts "${VERSION}")"; then
  echo "error: the release cut failed"
  exit 1
fi
CUT_PATHS=()
while IFS= read -r path; do
  if [[ -n "$path" ]]; then
    CUT_PATHS+=("$path")
  fi
done <<< "${CUT_OUTPUT}"
if [[ ${#CUT_PATHS[@]} -eq 0 ]]; then
  echo "error: the release cut changed nothing"
  exit 1
fi

echo "regenerating usage spec and CLI docs"
pnpm gen:usage-spec
pnpm docs:cli

echo "committing"
# -A stages the cut's renames and removals too.
git add -A -- "${CUT_PATHS[@]}" phax.usage.kdl docs/cli/reference.md README.md
git commit -m "chore: release v${VERSION}"

echo "tagging"
git tag -s "v${VERSION}" -m "Release v${VERSION}"

echo "pushing"
git push
git push origin "v${VERSION}"

echo "done: v${VERSION} tagged and pushed"
echo "approve the staged npm packages at:"
echo "  https://www.npmjs.com/package/@lbdremy/phax"
echo "  https://www.npmjs.com/package/@lbdremy/phax-schemas"
