#!/usr/bin/env bash
set -euo pipefail

# --rehearse cuts the release, typechecks it and runs the tests that read what
# a cut changes (the schemas package's formats and the docs site's served
# schemas), then stops: no commit, no tag, no push, and the cut stays in the
# working tree. CI rehearses every change this way, in seconds, so a test
# that holds only until the next cut fails on the pull request that adds it.
# A real release runs the whole suite on the cut before committing.
REHEARSE=false
if [[ "${1:-}" == "--rehearse" ]]; then
  REHEARSE=true
  shift
fi

VERSION="${1:-}"
VERSION="${VERSION#v}" # strip leading v if present

if [[ -z "$VERSION" ]]; then
  echo "usage: scripts/release.sh [--rehearse] <version>"
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
echo "stamping examples/hello-world/audit.mjs with gate-diagnostics ${VERSION}"
echo "stamping examples/hello-world/brief.mjs with brief-answer ${VERSION}"
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

CUT_TESTS=(pnpm test)
if [[ "$REHEARSE" == true ]]; then
  CUT_TESTS=(pnpm exec vitest run tests/unit/schemasPackage tests/unit/site)
fi

echo "testing the cut"
if ! { pnpm typecheck && pnpm test:type && "${CUT_TESTS[@]}"; }; then
  echo "error: the tests fail on the cut; nothing is committed or tagged"
  if [[ "$REHEARSE" == false ]]; then
    echo "undo the cut: git reset --hard HEAD && git clean -fd -- packages/schemas/snapshots"
  fi
  exit 1
fi

if [[ "$REHEARSE" == true ]]; then
  echo "done: the tests pass on a ${VERSION} cut (rehearsal, nothing committed)"
  exit 0
fi

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
