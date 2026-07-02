#!/usr/bin/env bash
# Secret & credential scan.
#   - gitleaks (full history + working tree) when installed
#   - otherwise a dependency-free pattern scan of tracked files
#
# Usage: scripts/security/secrets-scan.sh
# Env:   SCAN_HISTORY=1  (also scan full git history when gitleaks is present)
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
CHECK_NAME="secrets"
cd "$REPO_ROOT"
mkdir -p "$AUDIT_OUT_DIR"

head1 "Secret & credential scan"

if have gitleaks; then
  info "Running gitleaks (working tree)"
  report="$AUDIT_OUT_DIR/gitleaks.json"
  if gitleaks detect --no-banner --redact --report-format json --report-path "$report" \
       --source "$REPO_ROOT" >/dev/null 2>&1; then
    ok "gitleaks: no secrets in working tree"
  else
    n=$(grep -o '"RuleID"' "$report" 2>/dev/null | wc -l | tr -d ' ')
    finding high "gitleaks flagged ${n} potential secret(s)" "See $report (values redacted)"
  fi
  if [[ "${SCAN_HISTORY:-0}" == "1" ]]; then
    info "Running gitleaks (full history) — this can be slow"
    gitleaks detect --no-banner --redact --report-format json \
      --report-path "$AUDIT_OUT_DIR/gitleaks-history.json" >/dev/null 2>&1 \
      && ok "gitleaks history: clean" \
      || finding high "gitleaks flagged secret(s) in git history" \
           "See $AUDIT_OUT_DIR/gitleaks-history.json"
  fi
  finish_check
  exit $?
fi

info "gitleaks not installed — falling back to built-in pattern scan (tracked files only)."
info "For thorough coverage install gitleaks: brew install gitleaks"

# Dependency-free fallback. Scans git-tracked files, skipping the audit output,
# lockfiles, and this scanner itself (whose patterns would self-match).
patterns=(
  'AKIA[0-9A-Z]{16}'                                  # AWS access key id
  'gh[pousr]_[A-Za-z0-9]{20,}'                         # GitHub tokens
  'xox[baprs]-[A-Za-z0-9-]{10,}'                       # Slack tokens
  'sk-[A-Za-z0-9]{20,}'                                # OpenAI-style keys
  'sk-ant-[A-Za-z0-9-]{20,}'                           # Anthropic keys
  '-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY'    # private keys
  '(api[_-]?key|secret|passwd|password|token)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9/+_-]{16,}'
)

hits=0
# Build a newline-safe list of tracked files, excluding known-noise paths.
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  case "$f" in
    scripts/security/secrets-scan.sh) continue;;    # avoid self-match
    pnpm-lock.yaml|deno.lock|*.min.js) continue;;
  esac
  for pat in "${patterns[@]}"; do
    if match=$(grep -nEo "$pat" "$f" 2>/dev/null | head -1); then
      [[ -z "$match" ]] && continue
      finding high "Possible secret in ${f}" "matched pattern near: ${match%%:*} (redacted match omitted)"
      hits=$((hits+1))
    fi
  done
done < <(git ls-files 2>/dev/null)

if (( hits == 0 )); then
  ok "Pattern scan: no obvious secrets in tracked files"
fi

# Warn on committed env/credential files.
while IFS= read -r f; do
  case "$f" in
    .env|.env.*|*.pem|*.key|*.p12|*.pfx|id_rsa|id_ed25519|*.keystore)
      finding med "Sensitive-looking file is tracked: ${f}" "Confirm it contains no live credentials.";;
  esac
done < <(git ls-files 2>/dev/null)

finish_check
