#!/bin/sh
# 03-agents.sh — smolvm in-guest agent execution probe
#
# Confirms three AI provider CLIs (claude, codex, vibe) run inside the libkrun
# Linux guest with env-injected credentials, edit a mounted worktree, and that
# denied egress (no network) produces an observable error rather than a silent
# hang. Two steps per provider:
#
#   STEP A — allowed egress:  --net --allow-host <provider-api-domain>
#     Agent performs a trivial task (create hello.txt); file must appear on host.
#   STEP B — denied egress:  no --net flag (zero egress to anything)
#     Capture exactly how the CLI surfaces a total network loss:
#     clear error / timeout + exit / silent hang / retry loop.
#     This observation motivates the capability-preamble prompt in phase-05.
#
# Usage:
#   sh spikes/smolvm/03-agents.sh                # probe all three providers
#   PROBE_PROVIDER=claude sh spikes/smolvm/03-agents.sh
#   PROBE_PROVIDER=codex  sh spikes/smolvm/03-agents.sh
#   PROBE_PROVIDER=vibe   sh spikes/smolvm/03-agents.sh
#
# Required host env vars (read but NEVER printed or echoed):
#   ANTHROPIC_API_KEY   — Claude Code (claude)
#   OPENAI_API_KEY      — Codex CLI  (codex)
#   MISTRAL_API_KEY     — Mistral Vibe (vibe)
#
# Run AFTER 00-preflight.sh confirms smolvm is installed.
# Paste full output into findings/03-agents.md ## Results, then fill ## Verdict.
#
# smolvm flag reference (all used below):
#   smolvm machine run --image <image>     ephemeral VM, cleaned up on exit
#   --net                                  enable networking (off by default)
#   --allow-host <HOSTNAME>                add hostname to egress allowlist
#   -v HOST:CONTAINER[:ro]                 mount host dir into guest
#   -e KEY=VALUE                           inject guest env var from host env
#   -- COMMAND ARGS                        command to run inside the guest
set -eu

IMAGE="alpine"
TRIVIAL_PROMPT="Create a file called hello.txt in /workspace containing exactly one line: hello from smolvm"

# Step B timeout: seconds before declaring a hang. Enforced by smolvm's own --timeout flag
# (NOT the host `timeout` binary, which is absent on macOS and would always report a false
# hang). This prevents the harness from blocking if the CLI loops on retries.
STEP_B_TIMEOUT=60

# Step A installs the CLI live (apk + npm), so the package mirrors AND the Docker registry
# must be on the allowlist alongside the provider API domain — otherwise the allowlist
# blocks them and the install fails. Unquoted on use so each splits into --allow-host args.
# (A production isolated mode would instead ship a PRE-BAKED image with the CLI already in
# it; live install is shown here only to surface that requirement — see findings doc.)
REGISTRY_ALLOW="--allow-host index.docker.io --allow-host auth.docker.io --allow-host registry-1.docker.io --allow-host registry.docker.io --allow-host production.cloudfront.docker.com --allow-host production.cloudflare.docker.com --allow-host docker.io"
MIRROR_ALLOW="--allow-host dl-cdn.alpinelinux.org --allow-host registry.npmjs.org"

# Step B boots with ZERO egress. smolvm cannot pull an image without network, so Step B
# boots from a pre-baked artifact (`--from`) instead of `--image`. This is also the honest
# shape of the finding: with no network the CLI cannot be installed live, so a real isolated
# mode needs the CLI already in the image. The artifact is baked once and cached.
CACHE_DIR="${SMOLVM_SPIKE_CACHE:-${TMPDIR:-/tmp}/smolvm-spike}"
ARTIFACT_BIN="$CACHE_DIR/alpine.smolmachine"
ARTIFACT="$ARTIFACT_BIN.smolmachine"   # `pack create` emits this .smolmachine sidecar; --from consumes it

ensure_artifact() {
  if [ -f "$ARTIFACT" ]; then
    return 0
  fi
  mkdir -p "$CACHE_DIR"
  printf 'Baking %s artifact for Step B (one-time; pulls under --net)...\n' "$IMAGE"
  smolvm pack create -I "$IMAGE" -o "$ARTIFACT_BIN" --no-sign
}

# ── Helpers ────────────────────────────────────────────────────────────────────
section() { printf '\n══ %s ══\n' "$1"; }
step()    { printf '\n── %s ──\n' "$1"; }
note()    { printf 'NOTE:   %s\n' "$1"; }

printf '=== smolvm in-guest agent execution probe ===\n'
printf 'Image:           %s\n' "$IMAGE"
printf 'Host arch:       %s\n' "$(uname -m)"
printf 'Host OS:         %s\n' "$(uname -s -r)"
printf 'Probe provider:  %s\n' "${PROBE_PROVIDER:-all}"
printf 'Step B timeout:  %ds\n' "$STEP_B_TIMEOUT"

# Throwaway workspace dir shared across probes; each step creates its own subdir.
BASE_WORK_DIR=$(mktemp -d)
trap 'rm -rf "$BASE_WORK_DIR"' EXIT INT TERM

# ── probe_provider ─────────────────────────────────────────────────────────────
# Arguments:
#   $1  PNAME    short name (claude | codex | vibe)
#   $2  DOMAIN   provider API hostname to allowlist
#   $3  KEY_VAR  name of the host env var holding the API key
#   $4  INSTALL  shell snippet run in guest to install the CLI (may be slow)
#   $5  RUN_A    shell snippet that runs the trivial task (non-interactive)
#                Must create /workspace/hello.txt. Receives the key as an env var.
probe_provider() {
  PNAME="$1"
  DOMAIN="$2"
  KEY_VAR="$3"
  INSTALL="$4"
  RUN_A="$5"

  section "Provider: $PNAME  (api domain: $DOMAIN)"

  # -- key check ----------------------------------------------------------------
  eval "KEY_VALUE=\${${KEY_VAR}:-}"
  if [ -z "$KEY_VALUE" ]; then
    printf 'SKIP: %s not set in host env — cannot test %s\n' "$KEY_VAR" "$PNAME"
    return 0
  fi
  # Confirm key is set but print nothing about its value.
  printf 'Key:   %s is set (%d chars)\n' "$KEY_VAR" "$(printf '%s' "$KEY_VALUE" | wc -c | tr -d ' ')"
  unset KEY_VALUE

  WORK_DIR="$BASE_WORK_DIR/$PNAME"
  mkdir -p "$WORK_DIR"

  # ── STEP A: allowed egress + key injected ──────────────────────────────────
  step "STEP A — task execution with allowed network ($DOMAIN)"
  printf 'Flags: --net --allow-host %s, -e %s=<redacted>\n' "$DOMAIN" "$KEY_VAR"
  printf 'Guest install: %s\n' "$INSTALL"
  printf 'Guest task:    %s\n' "$TRIVIAL_PROMPT"

  # Evaluate KEY_VAR name to get its value for injection — value never printed.
  eval "KEY_FOR_INJECT=\${${KEY_VAR}}"

  smolvm machine run --image "$IMAGE" \
    --net --allow-host "$DOMAIN" $REGISTRY_ALLOW $MIRROR_ALLOW --timeout 180s \
    -v "$WORK_DIR:/workspace" \
    -e "${KEY_VAR}=${KEY_FOR_INJECT}" \
    -- /bin/sh -c "
echo '--- installing CLI in guest ---'
$INSTALL
echo '--- CLI version / confirm binary ---'
which $PNAME && $PNAME --version 2>/dev/null || echo '(version flag not supported)'
echo '--- guest arch ---'
uname -m
echo '--- running trivial task ---'
$RUN_A
echo '--- /workspace contents after task ---'
ls -la /workspace/
if [ -f /workspace/hello.txt ]; then
  echo '--- hello.txt content ---'
  cat /workspace/hello.txt
  echo 'RESULT: TASK COMPLETE'
else
  echo 'RESULT: hello.txt NOT CREATED'
fi
" || printf 'STEP A: VM exited non-zero (see output above)\n'

  if [ -f "$WORK_DIR/hello.txt" ]; then
    printf 'HOST-SIDE CHECK: hello.txt visible on host — write-back confirmed\n'
  else
    printf 'HOST-SIDE CHECK: hello.txt NOT on host — write-back failed or task failed\n'
  fi

  unset KEY_FOR_INJECT

  # ── STEP B: zero egress, observe denial UX ────────────────────────────────
  step "STEP B — denied egress (no --net, smolvm --timeout ${STEP_B_TIMEOUT}s)"
  printf 'Flags: --from <baked artifact> -e %s=<redacted>  (no --net — all egress blocked)\n' "$KEY_VAR"
  printf 'Goal: capture how the CLI surfaces network loss (error / hang / retry)\n'
  printf 'Hitting the smolvm --timeout means the CLI is silently retrying or hanging.\n'

  # Boot offline: with no network smolvm cannot pull, so Step B runs the pre-baked artifact.
  # A bare Alpine artifact has no provider CLI (live install needs network), which is itself
  # the finding — a real isolated mode must ship the CLI in the image.
  ensure_artifact
  eval "KEY_FOR_INJECT=\${${KEY_VAR}}"

  STEP_B_WORK="$BASE_WORK_DIR/${PNAME}-step-b"
  mkdir -p "$STEP_B_WORK"

  # smolvm's own --timeout bounds the boot so a hanging CLI cannot block the harness
  # (the host `timeout` binary is absent on macOS — do not use it).
  smolvm machine run --from "$ARTIFACT" --timeout "${STEP_B_TIMEOUT}s" \
    -v "$STEP_B_WORK:/workspace" \
    -e "${KEY_VAR}=${KEY_FOR_INJECT}" \
    -- /bin/sh -c "
echo '--- CLI present in guest? (no net, no live install possible) ---'
command -v $PNAME >/dev/null 2>&1 && echo 'CLI present' \
  || echo 'CLI ABSENT — no pre-baked image, so it cannot run offline (this is the finding)'
echo '--- attempting task without network ---'
$RUN_A 2>&1 || true
echo 'CLI exited (exit captured above)'
" && printf 'STEP B: VM exited within %ds\n' "$STEP_B_TIMEOUT" \
  || printf 'STEP B: VM hit %ds smolvm --timeout — CLI may be hanging/retrying\n' "$STEP_B_TIMEOUT"

  unset KEY_FOR_INJECT

  printf '\n-- %s probe complete --\n' "$PNAME"
}

# ── Provider: claude ────────────────────────────────────────────────────────────
# CLI:     claude   (from @anthropic-ai/claude-code)
# Domain:  api.anthropic.com
# Key var: ANTHROPIC_API_KEY
# Non-interactive: `claude --print --dangerously-skip-permissions -p "<prompt>"`
#   --print                   non-interactive, outputs result then exits
#   --dangerously-skip-permissions  bypass all tool-call approval prompts
CLAUDE_INSTALL="apk add --quiet --no-cache nodejs npm 2>/dev/null && npm install --quiet -g @anthropic-ai/claude-code 2>/dev/null"
CLAUDE_RUN="claude --print --dangerously-skip-permissions -p '$TRIVIAL_PROMPT'"

# ── Provider: codex ─────────────────────────────────────────────────────────────
# CLI:     codex   (from @openai/codex, the 2025 Codex CLI)
# Domain:  api.openai.com
# Key var: OPENAI_API_KEY
# Non-interactive: prompt via stdin, exec subcommand
#   codex exec -C /workspace --skip-git-repo-check --json
#   The prompt is written to stdin before exec.
#   NOTE: `echo "..." | codex exec ...` feeds prompt as stdin.
CODEX_INSTALL="apk add --quiet --no-cache nodejs npm 2>/dev/null && npm install --quiet -g @openai/codex 2>/dev/null"
CODEX_RUN="printf '%s' '$TRIVIAL_PROMPT' | codex exec -C /workspace --skip-git-repo-check --json 2>&1 || true"

# ── Provider: vibe (Mistral Vibe) ───────────────────────────────────────────────
# CLI:     vibe   (Mistral's agent CLI)
# Domain:  api.mistral.ai
# Key var: MISTRAL_API_KEY
# Non-interactive: `vibe -p "<prompt>" --agent auto-approve --workdir /workspace`
#   -p                       prompt text
#   --agent auto-approve     skip approval prompts (non-interactive agent preset)
#   --workdir                scope the agent's working directory
#   --output streaming       JSONL streaming output (matches phax's invocation)
#
# NOTE: the npm package name is UNKNOWN. `@mistralai/vibe`, `mistral-vibe`, and
# `@mistralai/vibe-cli` all 404 on npm (verified 2026-06-30). Find the real Vibe CLI
# distribution from Mistral's docs and export VIBE_NPM_PKG=<pkg> before running, or this
# provider's install will fail. The phax executable name is `vibe`
# (src/domain/routing/defaults.ts:117).
VIBE_NPM_PKG="${VIBE_NPM_PKG:-@mistralai/vibe}"
VIBE_INSTALL="apk add --quiet --no-cache nodejs npm 2>/dev/null && npm install --quiet -g $VIBE_NPM_PKG 2>/dev/null"
VIBE_RUN="vibe -p '$TRIVIAL_PROMPT' --agent auto-approve --workdir /workspace --output streaming 2>&1 || true"

# ── Dispatch ────────────────────────────────────────────────────────────────────
case "${PROBE_PROVIDER:-all}" in
  claude)
    probe_provider "claude" "api.anthropic.com" "ANTHROPIC_API_KEY" "$CLAUDE_INSTALL" "$CLAUDE_RUN"
    ;;
  codex)
    probe_provider "codex" "api.openai.com" "OPENAI_API_KEY" "$CODEX_INSTALL" "$CODEX_RUN"
    ;;
  vibe)
    probe_provider "vibe" "api.mistral.ai" "MISTRAL_API_KEY" "$VIBE_INSTALL" "$VIBE_RUN"
    ;;
  all)
    probe_provider "claude" "api.anthropic.com" "ANTHROPIC_API_KEY" "$CLAUDE_INSTALL" "$CLAUDE_RUN"
    probe_provider "codex"  "api.openai.com"    "OPENAI_API_KEY"    "$CODEX_INSTALL"  "$CODEX_RUN"
    probe_provider "vibe"   "api.mistral.ai"    "MISTRAL_API_KEY"   "$VIBE_INSTALL"   "$VIBE_RUN"
    ;;
  *)
    printf 'ERROR: unknown PROBE_PROVIDER=%s (valid: claude | codex | vibe | all)\n' "$PROBE_PROVIDER"
    exit 1
    ;;
esac

printf '\n=== All requested providers probed ===\n'
printf 'Paste this output into findings/03-agents.md ## Results\n'
printf 'then fill the per-provider table and ## Verdict.\n'
