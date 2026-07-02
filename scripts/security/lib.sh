# shellcheck shell=bash
# Shared helpers for the phax security-audit toolkit.
# Sourced by every scripts/security/*.sh script — not executed directly.

# Resolve repo root from this file's location so scripts work from any cwd.
SEC_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SEC_LIB_DIR}/../.." && pwd)"
export REPO_ROOT

# Report output lives under dist/ (gitignored) unless the caller overrides it.
: "${AUDIT_OUT_DIR:=${REPO_ROOT}/dist/security-audit}"
export AUDIT_OUT_DIR

# --- terminal colours (disabled when not a tty or NO_COLOR set) --------------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_GREEN=$'\033[32m'
  C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_YELLOW=""; C_GREEN=""; C_BLUE=""; C_DIM=""; C_BOLD=""; C_RESET=""
fi

# --- finding counters (per-script, aggregated by run-audit.sh via exit code) -
FINDINGS_HIGH=0
FINDINGS_MED=0
FINDINGS_LOW=0
FINDINGS_INFO=0

log()  { printf '%s\n' "$*" >&2; }
info() { printf '%s%s%s\n' "${C_DIM}" "$*" "${C_RESET}" >&2; }
head1() { printf '\n%s== %s ==%s\n' "${C_BOLD}${C_BLUE}" "$*" "${C_RESET}" >&2; }

# finding <severity: high|med|low|info> <title> [detail...]
# Prints to stderr for humans AND appends a machine-readable line to $AUDIT_JSONL
# (when set) so run-audit.sh can build a combined report.
finding() {
  local sev="$1"; shift
  local title="$1"; shift
  local detail="${*:-}"
  local colour label
  case "$sev" in
    high) colour="$C_RED";    label="HIGH"; FINDINGS_HIGH=$((FINDINGS_HIGH+1));;
    med)  colour="$C_YELLOW"; label="MED "; FINDINGS_MED=$((FINDINGS_MED+1));;
    low)  colour="$C_BLUE";   label="LOW "; FINDINGS_LOW=$((FINDINGS_LOW+1));;
    *)    colour="$C_DIM";    label="INFO"; sev="info"; FINDINGS_INFO=$((FINDINGS_INFO+1));;
  esac
  printf '%s[%s]%s %s\n' "$colour" "$label" "$C_RESET" "$title" >&2
  [[ -n "$detail" ]] && printf '       %s%s%s\n' "$C_DIM" "$detail" "$C_RESET" >&2
  if [[ -n "${AUDIT_JSONL:-}" ]]; then
    # crude but dependency-free JSON escaping of the two free-text fields
    local jt jd
    jt=$(json_escape "$title"); jd=$(json_escape "$detail")
    printf '{"check":"%s","severity":"%s","title":"%s","detail":"%s"}\n' \
      "${CHECK_NAME:-unknown}" "$sev" "$jt" "$jd" >>"$AUDIT_JSONL"
  fi
}

ok() { printf '%s[ OK ]%s %s\n' "$C_GREEN" "$C_RESET" "$*" >&2; }

json_escape() {
  # escape backslash, double-quote, and control chars for embedding in JSON
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' | tr -d '\n\r'
}

have() { command -v "$1" >/dev/null 2>&1; }

# Emit the per-check summary line and set the script's exit code:
#   0 = clean/low/info only, 1 = medium findings, 2 = high findings.
finish_check() {
  local total=$((FINDINGS_HIGH + FINDINGS_MED + FINDINGS_LOW + FINDINGS_INFO))
  info "${CHECK_NAME:-check}: ${FINDINGS_HIGH} high, ${FINDINGS_MED} med, ${FINDINGS_LOW} low, ${FINDINGS_INFO} info (${total} total)"
  if   ((FINDINGS_HIGH > 0)); then return 2
  elif ((FINDINGS_MED  > 0)); then return 1
  else return 0
  fi
}
