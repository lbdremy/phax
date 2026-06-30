#!/bin/sh
# 01-filesystem.sh — smolvm filesystem isolation probe
#
# Tests five properties of the microVM filesystem boundary:
#   A. Mounted /workspace: sentinel visible from guest, writable, write-back to host
#   B. Host $HOME not accessible from inside the guest
#   C. Host repo root not accessible from inside the guest
#   D. Host /etc content not leaking into guest (hostname / passwd comparison)
#   E. Read-only mount: guest write is rejected (:ro suffix per smolvm -v flag)
#
# Run AFTER 00-preflight.sh confirms smolvm is installed.
# Paste the full output into findings/01-filesystem.md ## Results, then fill ## Verdict.
#
# smolvm flag reference (all used below):
#   smolvm pack create -I <image> -o <path>  bake image into a self-contained artifact
#   smolvm machine run --from <artifact>     boot the baked artifact (no pull, no network)
#   -v HOST:CONTAINER[:ro]                    mount host dir into guest (optional :ro)
#   -- COMMAND ARGS                           command to execute inside the guest
set -eu

IMAGE="alpine"
GUEST_WORKSPACE="/workspace"

# smolvm re-pulls the image on every ephemeral `machine run`, and the pull needs the
# network — so a deliberately network-free filesystem probe cannot boot `--image` directly
# (the pull fails with "network is unreachable"). We bake the image ONCE into a
# self-contained artifact (that single pull runs under plain `--net`) and boot every check
# from it with `--from`, which needs neither network nor an allowlist. The artifact is
# cached between runs; set SMOLVM_SPIKE_CACHE to relocate it, or delete it to force a rebake.
CACHE_DIR="${SMOLVM_SPIKE_CACHE:-${TMPDIR:-/tmp}/smolvm-spike}"
ARTIFACT_BIN="$CACHE_DIR/alpine.smolmachine"
ARTIFACT="$ARTIFACT_BIN.smolmachine"   # `pack create` emits this .smolmachine sidecar; --from consumes it

ensure_artifact() {
    if [ -f "$ARTIFACT" ]; then
        printf 'Using cached artifact: %s\n' "$ARTIFACT"
        return 0
    fi
    mkdir -p "$CACHE_DIR"
    printf 'Baking %s artifact (one-time; pulls under --net)...\n' "$IMAGE"
    smolvm pack create -I "$IMAGE" -o "$ARTIFACT_BIN" --no-sign
}

PASS=0
FAIL=0

pass() { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }
section() { printf '\n── %s ──\n' "$1"; }

printf '=== smolvm filesystem isolation probe ===\n'
printf 'Image: %s (baked artifact)\n' "$IMAGE"
printf 'Host arch: %s\n' "$(uname -m)"
printf 'Host OS: %s\n' "$(uname -s -r)"

ensure_artifact

# Marker files written into real host paths for checks B and C. Defined up front so the
# trap can remove them even if the probe is interrupted mid-check (not just WORK_DIR).
MARKER_NAME=".smolvm-probe-$$"
HOST_HOME="$HOME"
HOST_REPO_ROOT="$(pwd)"
HOME_MARKER="$HOST_HOME/$MARKER_NAME"
REPO_MARKER="$HOST_REPO_ROOT/$MARKER_NAME"

# Throwaway dir for the workspace mount; cleaned up on exit.
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"; rm -f "$HOME_MARKER" "$REPO_MARKER"' EXIT INT TERM

# ── A. Workspace mount ─────────────────────────────────────────────────────
section "A. Workspace mount (-v HOST:/workspace)"

SENTINEL_VAL="spike-sentinel-$$"
printf '%s\n' "$SENTINEL_VAL" > "$WORK_DIR/sentinel.txt"
printf 'Sentinel written to host: %s/sentinel.txt\n' "$WORK_DIR"

smolvm machine run --from "$ARTIFACT" \
  -v "$WORK_DIR:$GUEST_WORKSPACE" \
  -- /bin/sh -c "
set -e
echo '--- guest /workspace contents ---'
ls -la /workspace/
echo '--- sentinel value ---'
cat /workspace/sentinel.txt
echo '--- writing writeback.txt from guest ---'
printf 'write-back-ok\n' > /workspace/writeback.txt
echo 'write succeeded'
"

if [ -f "$WORK_DIR/writeback.txt" ] && grep -q 'write-back-ok' "$WORK_DIR/writeback.txt"; then
    pass "write-back visible on host after guest write"
else
    fail "write-back NOT visible on host — guest writes may not propagate"
fi

# ── B. Host HOME invisible ─────────────────────────────────────────────────
section "B. Host HOME invisible"

printf 'host-home-probe\n' > "$HOME_MARKER"
printf 'Probing host path from guest: %s\n' "$HOME_MARKER"

smolvm machine run --from "$ARTIFACT" \
  -v "$WORK_DIR:$GUEST_WORKSPACE" \
  -- /bin/sh -c "
echo '--- ls of host HOME path: $HOST_HOME ---'
ls '$HOST_HOME' 2>&1 && echo 'VISIBLE' || echo 'NOT VISIBLE (expected)'
echo '--- cat of unique marker file ---'
cat '$HOME_MARKER' 2>&1 && echo 'VISIBLE' || echo 'NOT VISIBLE (expected)'
"

rm -f "$HOME_MARKER"

# ── C. Host repo root invisible ────────────────────────────────────────────
section "C. Host repo root invisible"

printf 'repo-probe\n' > "$REPO_MARKER"
printf 'Probing host path from guest: %s\n' "$REPO_MARKER"

smolvm machine run --from "$ARTIFACT" \
  -v "$WORK_DIR:$GUEST_WORKSPACE" \
  -- /bin/sh -c "
echo '--- ls of host repo root: $HOST_REPO_ROOT ---'
ls '$HOST_REPO_ROOT' 2>&1 && echo 'VISIBLE' || echo 'NOT VISIBLE (expected)'
echo '--- cat of unique marker file ---'
cat '$REPO_MARKER' 2>&1 && echo 'VISIBLE' || echo 'NOT VISIBLE (expected)'
"

rm -f "$REPO_MARKER"

# ── D. Host /etc not leaking into guest ───────────────────────────────────
section "D. Host /etc not leaking into guest"

HOST_HOSTNAME=$(hostname)
printf 'Host hostname (for comparison): %s\n' "$HOST_HOSTNAME"

smolvm machine run --from "$ARTIFACT" \
  -v "$WORK_DIR:$GUEST_WORKSPACE" \
  -- /bin/sh -c "
echo '--- guest hostname ---'
hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo '(hostname unavailable)'
echo '--- guest /etc/passwd (first 3 lines) ---'
head -3 /etc/passwd 2>/dev/null || echo '(no /etc/passwd)'
echo '--- guest /etc/hosts ---'
cat /etc/hosts 2>/dev/null || echo '(no /etc/hosts)'
echo '--- check for macOS /Users path in guest ---'
ls /Users 2>&1 || echo '/Users not present (expected on Linux guest)'
"

# ── E. Read-only mount ─────────────────────────────────────────────────────
section "E. Read-only mount (-v HOST:/workspace:ro)"

printf 'smolvm flag: -v %s:%s:ro\n' "$WORK_DIR" "$GUEST_WORKSPACE"
printf '(smolvm -v flag supports optional :ro suffix per CLI help)\n'

smolvm machine run --from "$ARTIFACT" \
  -v "$WORK_DIR:$GUEST_WORKSPACE:ro" \
  -- /bin/sh -c "
echo '--- /workspace contents (read-only mount) ---'
ls -la /workspace/
echo '--- attempting write to /workspace/ro-test.txt ---'
printf 'should-fail\n' > /workspace/ro-test.txt \
  && echo 'WRITE SUCCEEDED (unexpected — :ro not enforced)' \
  || echo 'WRITE REJECTED (expected — :ro is enforced)'
"

if [ -f "$WORK_DIR/ro-test.txt" ]; then
    fail "read-only mount: guest write propagated to host — :ro not enforced"
else
    pass "read-only mount: no write-through to host"
fi

# ── Summary ────────────────────────────────────────────────────────────────
printf '\n=== Probe complete: %d PASS, %d FAIL ===\n' "$PASS" "$FAIL"
printf 'Paste this output into findings/01-filesystem.md ## Results\n'
printf 'then fill in ## Verdict.\n'
