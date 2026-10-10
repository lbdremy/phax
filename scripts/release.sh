#!/usr/bin/env bash
set -euo pipefail

# scripts/release.sh <X.Y.Z> releases the opened version package.json names:
# it cuts it, regenerates the usage spec and CLI docs, runs the whole suite,
# commits, tags, pushes, then opens the next minor and pushes that too.
#
# --rehearse cuts the release, typechecks it and runs the tests that read what
# a cut changes (the schemas package's formats and the docs site's served
# schemas), then stops: no commit, no tag, no push, and the cut stays in the
# working tree. CI rehearses every change this way, in seconds, so a test
# that holds only until the next cut fails on the pull request that adds it.
# A real release runs the whole suite on the cut before committing.
#
# --open <X.Y.Z> re-opens by hand, when the cycle turned out bigger or
# smaller than the opened version says: it sets the manifests, regenerates
# the stamps, the usage spec and the CLI docs, and commits. It never pushes:
# follow it with git push or a pull request.
REHEARSE=false
OPEN=false
if [[ "${1:-}" == "--rehearse" ]]; then
  REHEARSE=true
  shift
elif [[ "${1:-}" == "--open" ]]; then
  OPEN=true
  shift
fi

if [[ "${1:-}" == "--rehearse" || "${1:-}" == "--open" ]]; then
  echo "error: --open and --rehearse cannot be combined"
  exit 1
fi

VERSION="${1:-}"
VERSION="${VERSION#v}" # strip leading v if present

if [[ -z "$VERSION" ]]; then
  echo "usage: scripts/release.sh [--rehearse] <version>"
  echo "       scripts/release.sh --open <version>"
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

# Opens $1 and commits it as "chore: open v$1", without pushing. Every command
# checks its own status: set -e does not apply inside a function called from
# an if condition.
open_version() {
  local next="$1"
  local was open_output path
  local open_paths=()
  was="$(node -p 'require("./package.json").version')" || return 1
  # Prints every path it changed, one per line, having written nothing on refusal.
  open_output="$(pnpm exec tsx scripts/release-open.ts "${next}")" || return 1
  while IFS= read -r path; do
    if [[ -n "$path" ]]; then
      open_paths+=("$path")
    fi
  done <<< "${open_output}"
  if [[ ${#open_paths[@]} -eq 0 ]]; then
    echo "error: the opening changed nothing"
    return 1
  fi
  pnpm gen:usage-spec || return 1
  pnpm docs:cli || return 1
  git add -A -- "${open_paths[@]}" phax.usage.kdl docs/cli/reference.md README.md || return 1
  git commit -m "chore: open v${next}" || return 1
  echo "committed chore: open v${next} (was ${was})"
}

if [[ "$OPEN" == true ]]; then
  echo "opening ${VERSION}"
  if ! open_version "${VERSION}"; then
    echo "✗ ${VERSION} is not opened"
    echo "  discard a partial opening with: git reset --hard HEAD"
    exit 1
  fi
  echo "not pushed: finish with git push, or open a pull request"
  exit 0
fi

# On the release commit itself the opened version is already cut: the ledger
# ends at it and its snapshots carry its name, so there is nothing to rehearse
# until the opening that follows.
if [[ "$REHEARSE" == true ]]; then
  LAST_RELEASE="$(node -p 'require("./packages/schemas/releases.json").releases.at(-1)')"
  if [[ "$LAST_RELEASE" == "$VERSION" ]]; then
    echo "skipped: ${VERSION} is already cut on this commit (a release commit); nothing to rehearse"
    exit 0
  fi
fi

if git tag | grep -q "^v${VERSION}$"; then
  echo "error: tag v${VERSION} already exists"
  exit 1
fi

echo "cutting ${VERSION}: renaming snapshots/*/next.schema.json → ${VERSION}.schema.json"
echo "appending ${VERSION} to the release ledger"
# Refuses anything but the opened version package.json names. Runs before
# gen:usage-spec, which reads the release from the generated
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

# The release is out: open the next minor on main, so every commit until the
# next release names a version above the ledger. No test suite runs here, to
# keep the window between the tag and the opening short.
IFS=. read -r MAJOR MINOR _PATCH <<< "${VERSION}"
NEXT_VERSION="${MAJOR}.$((MINOR + 1)).0"
echo "opening ${NEXT_VERSION}"
if ! open_version "${NEXT_VERSION}"; then
  echo "✗ v${VERSION} is released but ${NEXT_VERSION} is not opened — finish with: scripts/release.sh --open ${NEXT_VERSION}"
  echo "  then: git push"
  echo "  first discard a partial opening with: git reset --hard HEAD"
  exit 1
fi
if ! git push; then
  echo "✗ v${VERSION} is released and the opening of ${NEXT_VERSION} is committed, but not pushed — finish with: git push"
  exit 1
fi

echo "approve the staged npm packages at:"
echo "  https://www.npmjs.com/package/@lbdremy/phax"
echo "  https://www.npmjs.com/package/@lbdremy/phax-schemas"
