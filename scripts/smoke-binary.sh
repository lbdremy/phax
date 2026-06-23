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

USAGE_OUT="$(./dist/bin/phax --usage 2>&1)"
if ! echo "$USAGE_OUT" | grep -q 'name "phax"'; then
  echo "FAIL: dist/bin/phax --usage did not print the spec (no 'name \"phax\"' found)" >&2
  echo "Output was: $USAGE_OUT" >&2
  exit 1
fi
echo "OK: dist/bin/phax --usage prints a non-empty spec"

BINARY_SIZE="$(wc -c < dist/bin/phax | tr -d ' ')"
MAX_BYTES=157286400  # 150 MB — any regression to the un-bundled path would be ~360 MB
if [ "$BINARY_SIZE" -gt "$MAX_BYTES" ]; then
  MB="$(echo "$BINARY_SIZE" | awk '{printf "%.0f", $1/1048576}')"
  echo "FAIL: dist/bin/phax is ${MB} MB, exceeds the 150 MB bound — check that the esbuild bundle step ran" >&2
  exit 1
fi
MB="$(echo "$BINARY_SIZE" | awk '{printf "%.0f", $1/1048576}')"
echo "OK: dist/bin/phax size = ${MB} MB (within 150 MB bound)"
