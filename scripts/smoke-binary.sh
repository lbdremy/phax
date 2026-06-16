#!/usr/bin/env sh
set -e

mkdir -p dist/bin
echo "Compiling host binary..."
deno task compile

VERSION="$(./dist/bin/phax --version)"
if [ "$VERSION" != "0.1.0" ]; then
  echo "FAIL: expected 0.1.0, got $VERSION" >&2
  exit 1
fi
echo "OK: dist/bin/phax --version = $VERSION"
