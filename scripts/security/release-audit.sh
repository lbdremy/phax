#!/usr/bin/env bash
# Release & distribution audit — what actually ships to users.
#   - npm publish surface: `npm pack` dry run, file list, no stray secrets/junk
#   - npm wrapper installer: does it verify downloaded binaries? (checksum gap)
#   - release binaries: recompute SHA-256 and compare against .sha256 sidecars
#   - CI/CD hardening: are GitHub Actions pinned; are token scopes minimal
#
# Usage: scripts/security/release-audit.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
CHECK_NAME="release"
cd "$REPO_ROOT"
mkdir -p "$AUDIT_OUT_DIR"

head1 "Release & distribution audit"

# --- 1. npm publish surface --------------------------------------------------
# The published package is the npm/ wrapper (see npm/package.json).
npm_dir="$REPO_ROOT/npm"
if [[ -f "$npm_dir/package.json" ]] && have npm; then
  info "npm pack --dry-run (published tarball contents)"
  packlist="$AUDIT_OUT_DIR/npm-pack-files.txt"
  ( cd "$npm_dir" && npm pack --dry-run --json 2>/dev/null ) >"$AUDIT_OUT_DIR/npm-pack.json" || true
  ( cd "$npm_dir" && npm pack --dry-run 2>&1 ) | sed -n 's/^npm notice[[:space:]]*//p' >"$packlist" || true
  # Flag anything sensitive that would be published.
  if grep -qiE '(\.env|\.pem|\.key|\.local\.|id_rsa|\.npmrc|node_modules)' "$packlist" 2>/dev/null; then
    finding high "Sensitive/unexpected files in npm publish surface" "Review $packlist"
  else
    ok "npm publish surface contains no obviously sensitive files"
  fi
  # Lifecycle scripts run on the consumer's machine at install time.
  if grep -qE '"(pre|post)?install"\s*:' "$npm_dir/package.json"; then
    finding med "npm wrapper defines an install lifecycle script" \
      "Install-time scripts execute on every consumer machine — confirm intent in $npm_dir/package.json."
  else
    ok "npm wrapper has no install/postinstall lifecycle scripts"
  fi
else
  info "npm or npm/package.json missing — skipped publish-surface check"
fi

# --- 2. installer integrity: checksum verification --------------------------
# The release publishes <binary>.sha256 sidecars, so the installer SHOULD verify.
installer="$npm_dir/bin/phax"
if [[ -f "$installer" ]]; then
  dl=0; verify=0
  grep -qE 'https\.get|createWriteStream|download\(' "$installer" && dl=1
  grep -qiE 'sha256|createHash|\.sha256|digest|checksum|subtle\.digest' "$installer" && verify=1
  if (( dl == 1 && verify == 0 )); then
    finding high "npm installer runs a downloaded binary without checksum verification" \
      "$installer downloads the release binary over HTTPS, chmods it 0755 and executes it, but never checks the published .sha256. A tampered/compromised release asset (or a rogue redirect target) is executed silently. Fetch the matching <name>.sha256, recompute SHA-256, and refuse to run on mismatch."
  elif (( dl == 1 && verify == 1 )); then
    ok "npm installer verifies a checksum before executing the binary"
  else
    info "npm installer does not download a binary (nothing to verify)"
  fi
  # Redirect handling: following res.headers.location to an arbitrary host.
  if grep -qE 'headers\.location' "$installer" && ! grep -qiE 'github\.com|hostname|URL\(' "$installer"; then
    finding low "Installer follows HTTP redirects without host validation" \
      "$installer follows 30x Location to any host. Pin/validate the redirect target to the GitHub releases domain."
  fi
else
  info "No npm/bin installer found — skipped installer-integrity check"
fi

# --- 3. built release binaries: verify sidecar checksums --------------------
rel_dir="$REPO_ROOT/dist/release"
if compgen -G "$rel_dir/*.sha256" >/dev/null; then
  info "Verifying SHA-256 sidecars in $rel_dir"
  bad=0
  for sidecar in "$rel_dir"/*.sha256; do
    name=$(awk '{print $2}' "$sidecar")
    want=$(awk '{print $1}' "$sidecar")
    bin="$rel_dir/$name"
    [[ -f "$bin" ]] || { finding med "Checksum sidecar without binary: $name"; continue; }
    if have shasum; then got=$(shasum -a 256 "$bin" | awk '{print $1}')
    elif have sha256sum; then got=$(sha256sum "$bin" | awk '{print $1}')
    else info "no shasum/sha256sum tool"; break; fi
    if [[ "$got" == "$want" ]]; then ok "checksum OK: $name"
    else finding high "Checksum MISMATCH for $name" "expected $want, got $got"; bad=1; fi
  done
  (( bad == 0 )) && ok "All release-binary checksums match their sidecars"
else
  info "No built release binaries in dist/release (run 'pnpm deno:build-binaries' to audit them)."
fi

# --- 4. CI/CD hardening ------------------------------------------------------
wf_dir="$REPO_ROOT/.github/workflows"
if [[ -d "$wf_dir" ]]; then
  for wf in "$wf_dir"/*.yml "$wf_dir"/*.yaml; do
    [[ -f "$wf" ]] || continue
    base=$(basename "$wf")
    # Actions pinned to a mutable tag (vN) rather than a commit SHA.
    if grep -qE 'uses:\s+[^@]+@v[0-9]' "$wf"; then
      finding low "Actions in ${base} pinned to mutable tags, not SHAs" \
        "A compromised upstream tag re-points your CI. Pin third-party actions to a full commit SHA."
    fi
    # Overly broad token permissions.
    if grep -qE 'contents:\s*write' "$wf"; then
      finding info "${base} grants contents: write" "Expected for a release job; confirm least privilege."
    fi
    # curl | tar / curl | sh style installs (unpinned remote code).
    if grep -qE 'curl .*\|\s*(tar|sh|bash)' "$wf"; then
      finding low "${base} pipes a remote download straight into tar/sh" \
        "Unpinned remote fetch executed in CI (e.g. the usage CLI). Pin by version+checksum or vendor the tool."
    fi
  done
else
  info "No .github/workflows directory"
fi

# --- 5. package provenance ---------------------------------------------------
if grep -qE 'provenance' "$wf_dir"/*.yml 2>/dev/null; then
  ok "Release workflow requests npm provenance (--provenance)"
else
  finding low "npm publish does not request provenance" "Add --provenance for supply-chain attestation."
fi

finish_check
