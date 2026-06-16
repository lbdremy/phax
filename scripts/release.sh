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

echo "bumping to ${VERSION}"
npm pkg set version="${VERSION}"
(cd npm && npm pkg set version="${VERSION}")

echo "committing"
git add package.json npm/package.json
git commit -m "chore: release v${VERSION}"

echo "tagging"
git tag -s "v${VERSION}" -m "Release v${VERSION}"

echo "pushing"
git push
git push origin "v${VERSION}"

echo "done: v${VERSION} tagged and pushed"
echo "approve the staged npm package at: https://www.npmjs.com/package/@lbdremy/phax"
