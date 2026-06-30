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
# Two things this script accounts for (learned by running it on smolvm 1.3.2):
#   1. smolvm applies --allow-host to the IMAGE PULL too, and an ephemeral `machine run`
#      re-pulls every boot. So the Docker registry + CDN hosts must be on the allowlist or
#      the pull dies with "no such host" before any case runs. They are added below; they do
#      NOT affect case 3 (the blocked host's IP is still not allowlisted).
#   2. `apk add curl` cannot work under the allowlist (the package CDN is not allowed), so
#      this probe uses Alpine's built-in busybox `wget` — no install, no extra egress.
#
# smolvm flag reference (all used below):
#   smolvm machine run --image <image>          ephemeral VM, cleaned up on exit
#   --net                                       enable networking (off by default)
#   --allow-host <HOSTNAME>                     add hostname to egress allowlist
#   --timeout <DURATION>                        kill the VM after DURATION (safety)
#   -v HOST:CONTAINER[:ro]                      mount host dir into guest
#   -e KEY=VALUE                                set guest env var
#   -- COMMAND ARGS                             command to execute inside the guest
set -eu

IMAGE="alpine"

# The single domain we allow. Pick something lightweight and reliable.
ALLOWED_DOMAIN="example.com"

# A blocked domain (should be denied by the allowlist).
BLOCKED_DOMAIN="httpbin.org"

# Docker registry + CDN hosts the image pull needs while the allowlist is active. Unquoted
# on use so it word-splits into multiple --allow-host args (intentional).
REGISTRY_ALLOW="--allow-host index.docker.io --allow-host auth.docker.io --allow-host registry-1.docker.io --allow-host registry.docker.io --allow-host production.cloudfront.docker.com --allow-host production.cloudflare.docker.com --allow-host docker.io"

# Resolve a host IP using whichever resolver tool is present. Empty on failure.
resolve_ip() {
  ip=$(nslookup "$1" 2>/dev/null | awk '/^Address: / { print $2; exit }')
  if [ -z "$ip" ]; then
    ip=$(dig +short "$1" A 2>/dev/null | head -1)
  fi
  printf '%s' "$ip"
}

BLOCKED_IP=$(resolve_ip "$BLOCKED_DOMAIN")
if [ -z "$BLOCKED_IP" ]; then
  printf 'ERROR: could not resolve %s on host; case 3 (the decisive test) needs its IP.\n' "$BLOCKED_DOMAIN" >&2
  exit 1
fi
ALLOWED_IP=$(resolve_ip "$ALLOWED_DOMAIN")

# Guest-side classifier (busybox wget). Distinguishes a real egress block (DNS or connect
# failure) from an application-layer HTTP error, which still proves the connection went
# through. Defined here as a literal (single quotes → no host expansion of $1/$MSG) and
# interpolated into the guest payload below.
GUEST_PROBE='
probe() {
  # $1 = label, $2 = url
  if wget -T 8 -q -O /dev/null "$2" 2>/tmp/werr; then
    printf "  %-32s REACHABLE (HTTP 2xx)\n" "$1"; return 0
  fi
  MSG=$(cat /tmp/werr 2>/dev/null)
  case "$MSG" in
    *"server returned error"*) printf "  %-32s REACHABLE (connected; %s)\n" "$1" "$MSG" ;;
    *"bad address"*)           printf "  %-32s BLOCKED (DNS denied: %s)\n" "$1" "$MSG" ;;
    *"Connection refused"*|*"timed out"*|*"unreachable"*|*"timeout"*)
                               printf "  %-32s BLOCKED (egress denied: %s)\n" "$1" "$MSG" ;;
    *)                         printf "  %-32s UNKNOWN (%s)\n" "$1" "$MSG" ;;
  esac
}'

# Throwaway workspace dir so the VM boot has a writable mount (some images need it).
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

printf '=== smolvm per-domain network allowlist probe ===\n'
printf 'Image:          %s\n' "$IMAGE"
printf 'Allowed domain: %s  (IP %s)\n' "$ALLOWED_DOMAIN" "${ALLOWED_IP:-unresolved}"
printf 'Blocked domain: %s  (IP %s)\n' "$BLOCKED_DOMAIN" "$BLOCKED_IP"
printf 'Host arch:      %s\n' "$(uname -m)"
printf 'Host OS:        %s\n' "$(uname -s -r)"
printf '\nThe matrix runs in a single VM boot under: --allow-host %s (+ registry hosts).\n' "$ALLOWED_DOMAIN"
printf 'Tool: busybox wget (built into Alpine; no apk install).\n'
printf '\nCase legend:\n'
printf '  case1  allowed host by NAME    — does egress work at all?\n'
printf '  case2  blocked host by NAME    — deny-by-default for unlisted hosts?\n'
printf '  case3  blocked host by RAW IP  — DECISIVE: real boundary or DNS filter?\n'
printf '  case4  allowed host by RAW IP  — enforcement layer (IP vs SNI/DNS)?\n'
printf '  case5  ICMP ping               — TCP/UDP-only behaviour\n'

section() { printf '\n── %s ──\n' "$1"; }
section "Running matrix (single boot)"

# Only test case 4 if the allowed IP resolved.
CASE4_LINE=":"
if [ -n "$ALLOWED_IP" ]; then
  CASE4_LINE="probe 'case4 allowed RAW IP' \"http://$ALLOWED_IP/\""
fi

smolvm machine run --image "$IMAGE" \
  --net --allow-host "$ALLOWED_DOMAIN" $REGISTRY_ALLOW --timeout 120s \
  -v "$WORK_DIR:/workspace" \
  -- /bin/sh -c "$GUEST_PROBE
echo '[HTTP egress]'
probe 'case1 allowed by NAME' \"http://$ALLOWED_DOMAIN/\"
probe 'case2 blocked by NAME' \"http://$BLOCKED_DOMAIN/\"
probe 'case3 blocked RAW IP'  \"http://$BLOCKED_IP/\"
$CASE4_LINE
echo '[ICMP]'
if ping -c 2 -W 3 $ALLOWED_DOMAIN >/dev/null 2>&1; then
  echo '  case5 ICMP ping                  SUCCEEDED (unexpected — ICMP forwarded)'
else
  echo '  case5 ICMP ping                  BLOCKED/UNSUPPORTED (expected — TCP/UDP only)'
fi
"

# ── Summary ────────────────────────────────────────────────────────────────────
printf '\n=== Probe complete ===\n'
printf '\nKey questions for ## Verdict:\n'
printf '  1. Is egress deny-by-default?  (case2 + case3 both BLOCKED?)\n'
printf '  2. Is --allow-host a security boundary?  (case3 — raw IP to a non-allowed\n'
printf '     host — BLOCKED? If REACHABLE, it is DNS-name filtering only, not a boundary.)\n'
printf '  3. Enforcement layer?  (case4 REACHABLE => IP-based; note the shared-CDN-IP caveat.)\n'
printf '\nPaste this output into findings/02-network.md ## Results, then fill ## Verdict.\n'
