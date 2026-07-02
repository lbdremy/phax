#!/usr/bin/env bash
# Static source scan for injection & unsafe-execution patterns, tuned to phax.
#   - semgrep with the bundled ruleset when installed (deep)
#   - always: dependency-free grep checks for the repo's specific hazards:
#       * shell:true / string-interpolated exec  -> command injection
#       * eval / new Function                    -> arbitrary code execution
#       * child_process/fs/git outside src/infra -> architecture boundary breach
#       * git argv without `--` separator        -> argument injection
#
# Usage: scripts/security/code-scan.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
CHECK_NAME="code"
cd "$REPO_ROOT"
mkdir -p "$AUDIT_OUT_DIR"

head1 "Static source scan (injection & unsafe execution)"

SRC_GLOB=(src scripts npm)

# gnu/bsd grep both support -rnE; -I skips binaries.
gg() { grep -rnE -I "$@" 2>/dev/null; }

# --- 1. command injection via shell interpretation ---------------------------
if m=$(gg 'shell:\s*true' "${SRC_GLOB[@]}" --include='*.ts' --include='*.js'); then
  while IFS= read -r line; do
    finding high "spawn/exec with shell:true" "$line — enables shell metacharacter injection; use array argv instead."
  done <<<"$m"
else
  ok "No 'shell: true' subprocess calls"
fi

# execSync / exec / execFileSync with an interpolated (\$ or \`) command string.
if m=$(gg '(execSync|exec)\(\s*[`"'"'"']?[^)]*[`$]\{' "${SRC_GLOB[@]}" --include='*.ts' --include='*.js' \
        | grep -vE 'execFile'); then
  while IFS= read -r line; do
    finding high "Interpolated command string in exec()/execSync()" "$line — prefer execFile/spawn with an argv array."
  done <<<"$m"
else
  ok "No interpolated exec()/execSync() command strings"
fi

# --- 2. arbitrary code execution --------------------------------------------
if m=$(gg '(^|[^.\w])eval\(|new Function\(' "${SRC_GLOB[@]}" --include='*.ts' --include='*.js'); then
  while IFS= read -r line; do
    finding high "Dynamic code execution (eval / new Function)" "$line"
  done <<<"$m"
else
  ok "No eval / new Function usage"
fi

# --- 3. architecture boundary: side effects only in src/infra ----------------
# child_process / node:fs / simple-git must not appear in domain/app/cli.
boundary_hit=0
if m=$(gg "from ['\"]node:child_process" src/domain src/app src/cli --include='*.ts'); then
  while IFS= read -r line; do
    # loadConfig/shell command legitimately shell out; flag as low for review.
    finding low "child_process imported outside src/infra" "$line — confirm this belongs behind a port (see effect-services skill)."
    boundary_hit=1
  done <<<"$m"
fi
if m=$(gg "from ['\"]node:fs" src/domain --include='*.ts'); then
  while IFS= read -r line; do
    finding med "node:fs imported in src/domain (pure layer)" "$line — domain must stay I/O-free; route through the fs port."
    boundary_hit=1
  done <<<"$m"
fi
(( boundary_hit == 0 )) && ok "No side-effect imports leaking into domain/app/cli (beyond known shell-outs)"

# --- 4. git argument injection (defense in depth) ----------------------------
# execFile('git', [...]) with positional args that could be attacker-influenced
# should separate options from operands with `--`. Flag git worktree/branch/
# checkout calls that pass a variable positional without a `--` guard.
if [[ -f src/infra/git.ts ]]; then
  if grep -qE '"--"' src/infra/git.ts; then
    ok "git adapter uses '--' argument separators"
  else
    finding low "git adapter never uses '--' to separate options from operands" \
      "src/infra/git.ts — a branch/path value beginning with '-' is parsed as a git flag (argument injection). Add '--' before positional refs/paths."
  fi
fi

# --- 5. semgrep (optional deep pass) ----------------------------------------
if have semgrep; then
  info "Running semgrep (p/javascript, p/typescript, p/command-injection)"
  semgrep --error --json --quiet \
    --config p/javascript --config p/typescript --config p/command-injection \
    --output "$AUDIT_OUT_DIR/semgrep.json" src >/dev/null 2>&1 || true
  if [[ -s "$AUDIT_OUT_DIR/semgrep.json" ]]; then
    n=$(grep -o '"check_id"' "$AUDIT_OUT_DIR/semgrep.json" | wc -l | tr -d ' ')
    if (( n > 0 )); then
      finding med "semgrep reported ${n} result(s)" "Triage $AUDIT_OUT_DIR/semgrep.json"
    else
      ok "semgrep: no findings"
    fi
  fi
else
  info "semgrep not installed (optional deep pass). Install: brew install semgrep"
fi

finish_check
