#!/usr/bin/env sh
set -e

# Step 1: Compile host binary
mkdir -p dist/bin
echo "Compiling host binary..."
deno task compile

# Step 2: Verify startup
VERSION="$(./dist/bin/phax --version)"
if [ "$VERSION" != "0.1.0" ]; then
  echo "FAIL: expected 0.1.0, got $VERSION" >&2
  exit 1
fi
echo "OK: dist/bin/phax --version = $VERSION"

# Step 3: Denial probe — verify curl is denied under restricted --allow-run
PROBE="$(mktemp /tmp/phax-denial-probe.XXXXXX.ts)"
cat > "$PROBE" << 'PROBE_EOF'
import { spawn } from "node:child_process";
const p = spawn("curl", ["--version"]);
let denied = false;
p.on("error", () => { denied = true; });
p.on("close", () => {
  if (!denied) {
    console.error("FAIL: curl ran without permission denial");
    Deno.exit(1);
  }
  console.log("OK: curl denied as expected");
});
PROBE_EOF

deno run --allow-run=git "$PROBE"
rm -f "$PROBE"
echo "OK: permission denial verified"
