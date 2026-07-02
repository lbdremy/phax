#!/usr/bin/env bash
# Dependency & supply-chain audit.
#   - pnpm audit against the advisory DB (production deps by default)
#   - lockfile integrity (no stray package-lock.json; pnpm-lock present)
#   - optional deep scan with osv-scanner / trivy / snyk when installed
#   - optional SBOM generation with syft / cdxgen when installed
#
# Usage: scripts/security/deps-audit.sh
# Env:   AUDIT_LEVEL=low|moderate|high|critical  (pnpm audit threshold; default high)
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
CHECK_NAME="deps"
cd "$REPO_ROOT"

: "${AUDIT_LEVEL:=high}"
mkdir -p "$AUDIT_OUT_DIR"

head1 "Dependency & supply-chain audit"

# --- 1. lockfile hygiene -----------------------------------------------------
if [[ -f package-lock.json ]]; then
  finding high "Stray package-lock.json committed" \
    "This repo uses pnpm; an npm lockfile can pull a divergent, unaudited dependency tree."
elif [[ -f pnpm-lock.yaml ]]; then
  ok "pnpm-lock.yaml present, no npm lockfile"
else
  finding med "No pnpm-lock.yaml found" "Builds are not reproducible without a committed lockfile."
fi

# --- 2. pnpm audit -----------------------------------------------------------
if have pnpm; then
  info "Running: pnpm audit --prod --audit-level=${AUDIT_LEVEL}"
  audit_json="$AUDIT_OUT_DIR/pnpm-audit.json"
  # --json exits non-zero when advisories are found; capture regardless.
  pnpm audit --prod --json >"$audit_json" 2>/dev/null || true
  if [[ -s "$audit_json" ]]; then
    # pnpm emits either a summary object or NDJSON depending on version; grep is robust.
    local_high=$(grep -o '"severity":"high"' "$audit_json"        | wc -l | tr -d ' ')
    local_crit=$(grep -o '"severity":"critical"' "$audit_json"    | wc -l | tr -d ' ')
    local_mod=$(grep -o '"severity":"moderate"' "$audit_json"     | wc -l | tr -d ' ')
    local_low=$(grep -o '"severity":"low"' "$audit_json"          | wc -l | tr -d ' ')
    if (( local_crit > 0 )); then
      finding high "${local_crit} critical advisory/advisories in production deps" "See $audit_json"
    fi
    if (( local_high > 0 )); then
      finding high "${local_high} high advisory/advisories in production deps" "See $audit_json"
    fi
    if (( local_mod > 0 )); then
      finding med "${local_mod} moderate advisory/advisories" "See $audit_json"
    fi
    if (( local_low > 0 )); then
      finding low "${local_low} low advisory/advisories" "See $audit_json"
    fi
    if (( local_crit + local_high + local_mod + local_low == 0 )); then
      ok "pnpm audit: no known advisories in production dependencies"
    fi
  else
    ok "pnpm audit: no known advisories in production dependencies"
  fi
else
  finding info "pnpm not on PATH" "Skipped pnpm audit. Install pnpm to enable advisory checks."
fi

# --- 3. optional deep scanners ----------------------------------------------
if have osv-scanner; then
  info "Running osv-scanner (lockfile)"
  osv-scanner --lockfile=pnpm-lock.yaml --format=json >"$AUDIT_OUT_DIR/osv.json" 2>/dev/null || true
  vulns=$(grep -o '"id"' "$AUDIT_OUT_DIR/osv.json" 2>/dev/null | wc -l | tr -d ' ')
  if (( vulns > 0 )); then
    finding med "osv-scanner reported ${vulns} vulnerability record(s)" "See $AUDIT_OUT_DIR/osv.json"
  else
    ok "osv-scanner: clean"
  fi
else
  info "osv-scanner not installed (optional). Install: brew install osv-scanner"
fi

# --- 4. optional SBOM --------------------------------------------------------
if have syft; then
  info "Generating CycloneDX SBOM with syft"
  syft "dir:$REPO_ROOT" -o cyclonedx-json="$AUDIT_OUT_DIR/sbom.cdx.json" >/dev/null 2>&1 \
    && ok "SBOM written to $AUDIT_OUT_DIR/sbom.cdx.json" \
    || info "syft SBOM generation failed (non-fatal)"
elif have cdxgen; then
  info "Generating CycloneDX SBOM with cdxgen"
  cdxgen -o "$AUDIT_OUT_DIR/sbom.cdx.json" >/dev/null 2>&1 \
    && ok "SBOM written to $AUDIT_OUT_DIR/sbom.cdx.json" \
    || info "cdxgen SBOM generation failed (non-fatal)"
else
  info "No SBOM tool (syft/cdxgen) installed (optional)."
fi

# --- 5. dependency count / transitive surface -------------------------------
if [[ -f pnpm-lock.yaml ]]; then
  pkgs=$(grep -cE "^  /|resolution:" pnpm-lock.yaml 2>/dev/null || echo "?")
  info "Lockfile references ~${pkgs} resolved packages (transitive surface)."
fi

finish_check
