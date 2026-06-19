#!/usr/bin/env sh
set -e

mkdir -p dist/bin
echo "Compiling host binary..."
deno task compile

VERSION="$(./dist/bin/phax --version)"
EXPECTED="$(node -e "process.stdout.write(require('./package.json').version)")"
if [ "$VERSION" != "$EXPECTED" ]; then
  echo "FAIL: expected $EXPECTED, got $VERSION" >&2
  exit 1
fi
echo "OK: dist/bin/phax --version = $VERSION"
