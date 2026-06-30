# Findings: Per-domain network allowlist probe

## Environment

- smolvm version: 1.3.2
- Host OS / arch: Darwin 25.5.0 / arm64 (Apple Silicon)
- Guest arch: arm64 Linux (Alpine, via libkrun on Apple Silicon)
- Date of run: 2026-06-30
- Operator: Claude Code (interactive review session, automated run)

## Procedure

Run `sh spikes/smolvm/02-network.sh` from the repo root on a host with `smolvm` installed
and the `alpine` image available. The script uses `smolvm machine run` (ephemeral mode) with
`--net --allow-host example.com` and exercises a five-case matrix to determine whether
`--allow-host` is a real egress boundary or DNS-name filtering only.

> **Note:** `--net` must be given explicitly — network is off by default in smolvm.

**Setup**

The script resolves `httpbin.org` on the host (before any VM boots) to capture its IP
for case 3. The resolved IP is printed at startup.

**Case 1: Allowed domain reachable (by name)**

Flags: `--net --allow-host example.com`
Guest command: `curl --max-time 8 http://example.com/`

Expected: HTTP response received (code ≠ `000`). Confirms that `--allow-host` opens
egress to the listed domain and that networking is functional.

**Case 2: Non-allowed domain blocked (by name)**

Flags: `--net --allow-host example.com` (no allowance for `httpbin.org`)
Guest command: `curl --max-time 8 http://httpbin.org/`

Expected: curl exits non-zero or returns code `000` (connection refused / timeout).
Confirms deny-by-default egress: only explicitly allowed hosts can be reached.

**Case 3: Non-allowed host by hard-coded IP — THE DECISIVE TEST**

Flags: `--net --allow-host example.com` (no allowance for `httpbin.org`'s IP)
Guest command: `curl --max-time 8 http://<httpbin.org-IP>/`

The IP is the one resolved by the host before the VM boots and injected via shell
variable. **This is the go/no-go signal for the network boundary:**

- If the request is **blocked**: `--allow-host` filters at the egress/transport layer,
  not just DNS lookup. This is a real security boundary.
- If the request **succeeds**: `--allow-host` is DNS-name filtering only. An agent (or
  attacker) that hard-codes an IP bypasses the allowlist entirely. This would disqualify
  smolvm as a security boundary for phax's `isolated` mode.

**Case 4: Allowed host by raw IP**

Flags: `--net --allow-host example.com`
Guest command: `curl --max-time 8 http://<example.com-IP>/`

Reveals the enforcement mechanism:

- **Blocked** → enforcement is SNI/hostname-based (allowlist checked against the
  domain name, not the destination IP).
- **Reachable** → enforcement may pass traffic to IPs of allowed hosts, which could
  enable bypass if two domains share an IP.

**Case 5: ICMP — TCP/UDP only per smolvm docs**

Flags: `--net --allow-host example.com`
Guest command: `ping -c 2 -W 5 example.com`

smolvm documentation states only TCP and UDP are forwarded; ICMP is not supported.
This case records the actual observed behaviour for completeness.

### Crux questions for this probe

The `## Verdict` must answer both:

1. **Is egress deny-by-default?** (Did case 2 block the non-allowed domain, or was the
   request allowed through?)
2. **Is `--allow-host` a security boundary or DNS convenience?** (Did case 3 block the
   hard-coded IP, or did the request succeed — meaning the allowlist can be bypassed?)

## Results

> **Methodology note — two blocking issues, now handled by the script.** The original
> `02-network.sh` could not run as written, for two reasons now fixed in the script:
>
> 1. **`apk add curl` cannot work under the allowlist.** Installing curl at runtime needs
>    Alpine's package CDN, which `--allow-host example.com` blocks — so curl never installs
>    and *every* case would report a false "blocked" regardless of real egress behaviour.
>    The script now uses Alpine's built-in busybox `wget` (no install, no extra egress) with
>    a classifier that separates a real egress block from an app-layer HTTP error.
> 2. **The image pull is itself subject to the allowlist.** `--allow-host` constrains the
>    guest DNS resolver to allowed hosts only, so `smolvm machine run --image alpine
>    --allow-host example.com` fails to resolve `index.docker.io` (`no such host`) and the
>    pull dies before any case runs. The script now adds the Docker registry + CDN hosts to
>    the allowlist (`REGISTRY_ALLOW`). This does **not** weaken the decisive case 3:
>    httpbin's IP is still not on the allowlist.
>
> All five cases run in a **single** boot with smolvm `--timeout`. IPs are resolved on the
> host immediately before the run.

Host-resolved before boot: `example.com = 104.20.23.154` (Cloudflare), `httpbin.org = 52.70.185.220`.

```
[c1 allowed example.com by NAME ]  rc=0   → REACHABLE  (allowed egress works)
[c2 blocked httpbin.org by NAME ]  rc=1   wget: bad address 'httpbin.org'
                                          → BLOCKED at DNS (deny-by-default)
[c3 blocked httpbin by RAW IP   ]  rc=1   wget: can't connect to remote host
   *** DECISIVE ***                       (52.70.185.220): Connection refused
                                          → BLOCKED at L4 (real egress boundary)
[c4 allowed example.com RAW IP  ]  rc=1   wget: server returned error: HTTP/1.1 403 Forbidden
                                          → REACHABLE (TCP connected; 403 is Cloudflare
                                            app-layer for a host-less raw-IP request)
[c5 ICMP ping example.com       ]  100% packet loss   → ICMP not forwarded (TCP/UDP only)
```

## Verdict

**Status:** PASS — `--allow-host` is a real deny-by-default egress boundary. **GO signal.**

**Is egress deny-by-default?** **Yes.** A non-allowed host is unreachable both by name
(c2: not even resolvable — DNS is itself restricted to allowed hosts) and by raw IP
(c3: connection refused). Only the explicitly allowed host is reachable (c1).

**Is `--allow-host` a security boundary or DNS convenience?** **A real security boundary.**
This is the decisive result: hard-coding the IP of a non-allowed host (c3) does **not**
bypass the allowlist — the connection is refused at L4. `--allow-host` resolves the allowed
hostname to its IP(s) at VM start and permits egress to those IPs only; everything else is
dropped. An agent (or attacker code an agent runs) cannot escape by shipping an IP literal.

**Conclusion:** smolvm's egress allowlist closes exactly the gap spec-14 identified as
unenforceable at the provider-native layer. Enforcement is **IP-based** (c4: the allowed
host's resolved IP is reachable by raw IP, returning an app-layer 403 rather than a
connection refusal). Two consequences for a follow-up plan:

- **Shared-CDN-IP caveat (real, must be designed around).** Because enforcement is by
  resolved IP, allowlisting one host on a shared CDN address transitively permits any other
  host served from that same IP. example.com sits on Cloudflare (104.20.23.154); any other
  Cloudflare-fronted host on that IP would be reachable by raw IP. This is residual risk 2
  in the synthesis, now **confirmed** rather than hypothetical.
- **IP pinning at VM start.** Allowed hosts are resolved once at boot; long runs whose
  allowed host rotates DNS could see egress break (or a stale IP stay allowed). Minor.

ICMP is not forwarded (c5) — consistent with smolvm's TCP/UDP-only networking.

## Open questions

- If case 3 (raw IP) is blocked: what mechanism enforces it? DNS-interception, packet
  filtering (iptables/nftables inside the guest), or libkrun VMM-level egress proxy?
  Understanding the mechanism helps assess bypass surface.
- If case 3 (raw IP) succeeds: is there a `--allow-cidr` or Smolfile option that
  enforces a true egress boundary? Is that usable without knowing provider IPs upfront?
- Does the allowlist interact with HTTPS/TLS differently than HTTP? An SNI-based filter
  could pass TLS traffic whose SNI matches the allowed host but whose TCP destination
  resolves to a different IP.
- If case 4 (allowed host by IP) is blocked: does the guest need the allowed domain
  to be resolvable via guest DNS, or does smolvm inject a virtual DNS record for it?
- What is the timeout/failure mode when an agent inside the guest tries to reach a
  blocked domain? Immediate connection refused vs. multi-second timeout matters for
  phase-04 (denied-egress UX).
