#!/usr/bin/env bash
# phax security-audit orchestrator.
# Runs every check under scripts/security/, aggregates findings into a single
# JSONL + Markdown report, and exits non-zero when high-severity issues remain.
#
# Usage:
#   scripts/security/run-audit.sh [check ...]
#     (no args)   run all checks: deps, secrets, code, release
#     deps        dependency & supply-chain (pnpm audit, SBOM)
#     secrets     secret/credential scan (gitleaks or fallback)
#     code        static source scan (injection, boundaries)
#     release     release/distribution & CI hardening
#
# Env:
#   AUDIT_OUT_DIR   report directory (default dist/security-audit)
#   FAIL_ON=high|med|none   exit-code gate (default high)
set -uo pipefail
SEC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SEC_DIR/lib.sh"

: "${FAIL_ON:=high}"
mkdir -p "$AUDIT_OUT_DIR"
export AUDIT_JSONL="$AUDIT_OUT_DIR/findings.jsonl"
: >"$AUDIT_JSONL"

ALL_CHECKS=(deps secrets code release)
CHECKS=("$@")
[[ ${#CHECKS[@]} -eq 0 ]] && CHECKS=("${ALL_CHECKS[@]}")

# bash 3.2 (macOS default) has no associative arrays — use a lookup function.
script_for() {
  case "$1" in
    deps)    echo "deps-audit.sh";;
    secrets) echo "secrets-scan.sh";;
    code)    echo "code-scan.sh";;
    release) echo "release-audit.sh";;
    *)       echo "";;
  esac
}

printf '%s\n' "${C_BOLD}phax security audit${C_RESET} — $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'no-git')" >&2
info "Output: $AUDIT_OUT_DIR"

worst=0
for c in "${CHECKS[@]}"; do
  s="$(script_for "$c")"
  if [[ -z "$s" ]]; then log "unknown check: $c (valid: ${ALL_CHECKS[*]})"; continue; fi
  AUDIT_JSONL="$AUDIT_JSONL" bash "$SEC_DIR/$s"
  rc=$?
  (( rc > worst )) && worst=$rc
done

# --- aggregate report --------------------------------------------------------
# grep -c prints 0 but exits 1 when there are no matches; swallow the exit so
# the count is never doubled by a fallback.
count_sev() { local n; n=$(grep -c "\"severity\":\"$1\"" "$AUDIT_JSONL" 2>/dev/null) || true; echo "${n:-0}"; }
H=$(count_sev high); M=$(count_sev med); L=$(count_sev low); I=$(count_sev info)

report="$AUDIT_OUT_DIR/report.md"
{
  echo "# phax security audit"
  echo
  echo "- Commit: \`$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)\`"
  echo "- Checks: ${CHECKS[*]}"
  echo "- Findings: **${H} high**, **${M} medium**, ${L} low, ${I} info"
  echo
  for sev in high med low info; do
    label=$(printf '%s' "$sev" | tr '[:lower:]' '[:upper:]')
    rows=$(grep "\"severity\":\"$sev\"" "$AUDIT_JSONL" 2>/dev/null || true)
    [[ -z "$rows" ]] && continue
    echo "## ${label}"
    echo
    while IFS= read -r line; do
      chk=$(printf '%s' "$line" | sed -n 's/.*"check":"\([^"]*\)".*/\1/p')
      ttl=$(printf '%s' "$line" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p')
      det=$(printf '%s' "$line" | sed -n 's/.*"detail":"\([^"]*\)".*/\1/p')
      echo "- **[${chk}]** ${ttl}"
      [[ -n "$det" ]] && echo "  - ${det}"
    done <<<"$rows"
    echo
  done
} >"$report"

head1 "Summary"
printf '%s%s high%s, %s%s medium%s, %s low, %s info\n' \
  "$C_RED" "$H" "$C_RESET" "$C_YELLOW" "$M" "$C_RESET" "$L" "$I" >&2
info "Markdown report: $report"
info "Raw findings:    $AUDIT_JSONL"

case "$FAIL_ON" in
  none) exit 0;;
  med)  (( H > 0 || M > 0 )) && exit 1 || exit 0;;
  *)    (( H > 0 )) && exit 1 || exit 0;;
esac
