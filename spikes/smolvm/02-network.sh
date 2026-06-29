#!/bin/sh
# 02-network.sh — smolvm per-domain network allowlist probe
#
# Five-case matrix that determines whether smolvm's --allow-host is:
#   (a) deny-by-default egress filtering, and
#   (b) a real egress boundary (not just DNS-name filtering).
#
# The DECISIVE test is case 3: if a non-allowed host reached by hard-coded IP
# succeeds, the allowlist is DNS/SNI filtering only, not a true egress boundary.
#
# Run AFTER 00-preflight.sh confirms smolvm is installed.
# Paste the full output into findings/02-network.md ## Results, then fill ## Verdict.
#
# smolvm flag reference (all used below):
#   smolvm machine run --image <image>          ephemeral VM, cleaned up on exit
#   --net                                       enable networking (off by default)
#   --allow-host <HOSTNAME>                     add hostname to egress allowlist
#   --allow-cidr <CIDR>                         add CIDR block to egress allowlist
#   -v HOST:CONTAINER[:ro]                      mount host dir into guest
#   -e KEY=VALUE                                set guest env var
#   -- COMMAND ARGS                             command to execute inside the guest
#
# Smolfile equivalent (for reference — not used here, script uses CLI flags):
#   [network]
#   net = true
#   allow_hosts = ["example.com"]
set -eu

IMAGE="alpine"

# The single domain we allow. Pick something lightweight and reliable.
ALLOWED_DOMAIN="example.com"

# A blocked domain (should be denied by the allowlist).
BLOCKED_DOMAIN="httpbin.org"

# Resolve the blocked domain's IP on the HOST (before the VM boots, using host DNS).
# This IP is passed into the guest and used to probe case 3.
BLOCKED_IP=$(nslookup "$BLOCKED_DOMAIN" 2>/dev/null \
  | awk '/^Address: / { print $2; exit }' \
  || true)

# Fallback: use dig if nslookup produces no result.
if [ -z "$BLOCKED_IP" ]; then
  BLOCKED_IP=$(dig +short "$BLOCKED_DOMAIN" A 2>/dev/null | head -1 || true)
fi

if [ -z "$BLOCKED_IP" ]; then
  printf 'WARN: could not resolve %s on host; case 3 will use 93.184.216.34 (example.com IP as stand-in)\n' \
    "$BLOCKED_DOMAIN"
  BLOCKED_IP="93.184.216.34"
fi

PASS=0
FAIL=0
SKIP=0

pass()    { printf 'PASS:   %s\n' "$1"; PASS=$((PASS + 1)); }
fail()    { printf 'FAIL:   %s\n' "$1"; FAIL=$((FAIL + 1)); }
skip()    { printf 'SKIP:   %s\n' "$1"; SKIP=$((SKIP + 1)); }
section() { printf '\n── %s ──\n' "$1"; }

# Throwaway workspace dir so every VM boot has a writable mount (some images need it).
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

printf '=== smolvm per-domain network allowlist probe ===\n'
printf 'Image:          %s\n' "$IMAGE"
printf 'Allowed domain: %s\n' "$ALLOWED_DOMAIN"
printf 'Blocked domain: %s\n' "$BLOCKED_DOMAIN"
printf 'Blocked IP:     %s  (resolved on host before VM boot)\n' "$BLOCKED_IP"
printf 'Host arch:      %s\n' "$(uname -m)"
printf 'Host OS:        %s\n' "$(uname -s -r)"

# Helper: run a curl probe inside the guest, capturing exit code.
# Usage: run_probe <case_label> <url_or_target> <extra_flags>
# The guest runs: curl --max-time 8 --silent --output /dev/null --write-out "%{http_code}" <url>
# Exit 0 with a real HTTP code = reachable. Exit non-0 or code 000 = blocked/unreachable.

# ── Case 1: Allowed domain reachable ──────────────────────────────────────────
section "Case 1: Allowed domain reachable (by name)"

printf 'Flag: --net --allow-host %s\n' "$ALLOWED_DOMAIN"
printf 'Guest command: curl --max-time 8 http://%s/\n' "$ALLOWED_DOMAIN"

smolvm machine run --image "$IMAGE" \
  --net --allow-host "$ALLOWED_DOMAIN" \
  -v "$WORK_DIR:/workspace" \
  -- /bin/sh -c "
apk add --quiet --no-cache curl 2>/dev/null || true
echo '--- curl to allowed domain by name ---'
HTTP_CODE=\$(curl --max-time 8 --silent --output /dev/null \
  --write-out '%{http_code}' http://$ALLOWED_DOMAIN/ 2>/dev/null || echo '000')
echo \"HTTP code: \$HTTP_CODE\"
if [ \"\$HTTP_CODE\" != '000' ] && [ \"\$HTTP_CODE\" != '' ]; then
  echo 'RESULT: REACHABLE'
else
  echo 'RESULT: UNREACHABLE'
fi
"

# ── Case 2: Non-allowed domain blocked (by name) ───────────────────────────────
section "Case 2: Non-allowed domain blocked (by name)"

printf 'Flag: --net --allow-host %s  (NO allowance for %s)\n' "$ALLOWED_DOMAIN" "$BLOCKED_DOMAIN"
printf 'Guest command: curl --max-time 8 http://%s/\n' "$BLOCKED_DOMAIN"

smolvm machine run --image "$IMAGE" \
  --net --allow-host "$ALLOWED_DOMAIN" \
  -v "$WORK_DIR:/workspace" \
  -- /bin/sh -c "
apk add --quiet --no-cache curl 2>/dev/null || true
echo '--- curl to blocked domain by name ---'
HTTP_CODE=\$(curl --max-time 8 --silent --output /dev/null \
  --write-out '%{http_code}' http://$BLOCKED_DOMAIN/ 2>/dev/null || echo '000')
echo \"HTTP code: \$HTTP_CODE\"
if [ \"\$HTTP_CODE\" = '000' ] || [ \"\$HTTP_CODE\" = '' ]; then
  echo 'RESULT: BLOCKED (expected)'
else
  echo 'RESULT: REACHABLE (unexpected — domain filtering may not be active)'
fi
"

# ── Case 3: Non-allowed host by hard-coded IP (THE DECISIVE TEST) ─────────────
section "Case 3: Non-allowed host by hard-coded IP — DECISIVE"

printf '*** This is the go/no-go signal for the network boundary. ***\n'
printf 'If this PASSES (request succeeds), --allow-host is DNS-name filtering only,\n'
printf 'NOT a true egress boundary. An attacker can bypass it by avoiding DNS lookup.\n\n'
printf 'Blocked domain %s resolved to %s on host.\n' "$BLOCKED_DOMAIN" "$BLOCKED_IP"
printf 'Flag: --net --allow-host %s  (no allowance for IP %s)\n' "$ALLOWED_DOMAIN" "$BLOCKED_IP"
printf 'Guest command: curl --max-time 8 http://%s/\n' "$BLOCKED_IP"

smolvm machine run --image "$IMAGE" \
  --net --allow-host "$ALLOWED_DOMAIN" \
  -v "$WORK_DIR:/workspace" \
  -- /bin/sh -c "
apk add --quiet --no-cache curl 2>/dev/null || true
echo '--- curl to blocked domain by raw IP ---'
HTTP_CODE=\$(curl --max-time 8 --silent --output /dev/null \
  --write-out '%{http_code}' http://$BLOCKED_IP/ 2>/dev/null || echo '000')
echo \"HTTP code: \$HTTP_CODE\"
if [ \"\$HTTP_CODE\" = '000' ] || [ \"\$HTTP_CODE\" = '' ]; then
  echo 'RESULT: BLOCKED (expected — real egress boundary)'
else
  echo 'RESULT: REACHABLE (DNS-name filtering only — not a security boundary)'
fi
"

# ── Case 4: Allowed host by raw IP ────────────────────────────────────────────
section "Case 4: Allowed host by raw IP"

# Resolve the allowed domain's IP on the host.
ALLOWED_IP=$(nslookup "$ALLOWED_DOMAIN" 2>/dev/null \
  | awk '/^Address: / { print $2; exit }' \
  || true)
if [ -z "$ALLOWED_IP" ]; then
  ALLOWED_IP=$(dig +short "$ALLOWED_DOMAIN" A 2>/dev/null | head -1 || true)
fi

if [ -z "$ALLOWED_IP" ]; then
  printf 'WARN: could not resolve %s on host; skipping case 4\n' "$ALLOWED_DOMAIN"
  SKIP=$((SKIP + 1))
else
  printf 'Allowed domain %s resolved to %s on host.\n' "$ALLOWED_DOMAIN" "$ALLOWED_IP"
  printf 'Flag: --net --allow-host %s\n' "$ALLOWED_DOMAIN"
  printf 'Guest command: curl --max-time 8 http://%s/\n' "$ALLOWED_IP"
  printf '(Reveals whether enforcement is SNI/DNS-based: if IP is blocked,\n'
  printf ' allowlist uses hostname comparison; if IP is allowed, it may bypass SNI.)\n'

  smolvm machine run --image "$IMAGE" \
    --net --allow-host "$ALLOWED_DOMAIN" \
    -v "$WORK_DIR:/workspace" \
    -- /bin/sh -c "
apk add --quiet --no-cache curl 2>/dev/null || true
echo '--- curl to allowed domain by its raw IP ---'
HTTP_CODE=\$(curl --max-time 8 --silent --output /dev/null \
  --write-out '%{http_code}' http://$ALLOWED_IP/ 2>/dev/null || echo '000')
echo \"HTTP code: \$HTTP_CODE\"
if [ \"\$HTTP_CODE\" = '000' ] || [ \"\$HTTP_CODE\" = '' ]; then
  echo 'RESULT: BLOCKED (enforcement may be SNI/hostname-based, not IP-based)'
else
  echo 'RESULT: REACHABLE (enforcement may pass traffic to IPs of allowed hosts)'
fi
"
fi

# ── Case 5: ICMP (ping) — smolvm docs say TCP/UDP only ───────────────────────
section "Case 5: ICMP — smolvm allows TCP/UDP only (no ICMP)"

printf 'smolvm documentation: TCP and UDP are forwarded; ICMP is not supported.\n'
printf 'Attempting ping inside guest to record actual behaviour.\n'
printf 'Flag: --net --allow-host %s\n' "$ALLOWED_DOMAIN"
printf 'Guest command: ping -c 2 -W 5 %s\n' "$ALLOWED_DOMAIN"

smolvm machine run --image "$IMAGE" \
  --net --allow-host "$ALLOWED_DOMAIN" \
  -v "$WORK_DIR:/workspace" \
  -- /bin/sh -c "
echo '--- ping to allowed domain (ICMP, expect failure) ---'
ping -c 2 -W 5 $ALLOWED_DOMAIN 2>&1 && echo 'RESULT: ICMP SUCCEEDED (unexpected)' \
  || echo 'RESULT: ICMP BLOCKED or UNSUPPORTED (expected)'
"

# ── Summary ────────────────────────────────────────────────────────────────────
printf '\n=== Probe complete: %d PASS, %d FAIL, %d SKIP ===\n' "$PASS" "$FAIL" "$SKIP"
printf '\nKey question for ## Verdict:\n'
printf '  1. Is egress deny-by-default?  (Did case 2 block the non-allowed domain?)\n'
printf '  2. Is --allow-host a security boundary?  (Did case 3 block the raw IP?)\n'
printf '\nPaste this output into findings/02-network.md ## Results\n'
printf 'then fill in ## Verdict.\n'
