#!/bin/sh
# 00-preflight.sh — verify smolvm is installed and report version/backend/arch
# Does NOT boot a VM. Exit non-zero if smolvm is missing.
set -eu

fail() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

# Check smolvm is on PATH
if ! command -v smolvm > /dev/null 2>&1; then
    fail "smolvm not found on PATH. Install it before running this spike.
  See: https://github.com/wasm-forge/smolvm or your platform's package manager."
fi

printf '=== smolvm preflight ===\n\n'

# Version
printf '-- smolvm version --\n'
smolvm --version

# Host architecture
printf '\n-- host arch --\n'
uname -m

# OS/kernel
printf '\n-- host OS --\n'
uname -s -r

# Resolved binary location
printf '\n-- smolvm binary --\n'
command -v smolvm

# Attempt to surface the VMM backend smolvm will use.
# smolvm may expose this via a subcommand or env var; probe common options.
printf '\n-- VMM backend (best effort) --\n'
if smolvm info > /dev/null 2>&1; then
    smolvm info
elif smolvm config > /dev/null 2>&1; then
    smolvm config
else
    # Fall back to inspecting env hints
    if [ -n "${SMOLVM_BACKEND:-}" ]; then
        printf 'SMOLVM_BACKEND=%s\n' "$SMOLVM_BACKEND"
    else
        printf '(smolvm does not expose a backend info command; check docs for VMM selection)\n'
    fi
fi

printf '\n=== preflight OK ===\n'
