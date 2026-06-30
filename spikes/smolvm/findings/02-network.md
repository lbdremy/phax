# Findings: Per-domain network allowlist probe

## Environment

- smolvm version:
- Host OS / arch:
- Guest arch: arm64 Linux (Alpine, via libkrun on Apple Silicon)
- Date of run:
- Operator:

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

<!-- Paste the raw output of `sh spikes/smolvm/02-network.sh` here. Leave empty until run. -->

## Verdict

<!-- Fill in after results are captured. Format: PASS / FAIL / PARTIAL + one-line conclusion. -->

**Status:** (not yet run)

**Is egress deny-by-default?**

**Is `--allow-host` a security boundary or DNS convenience?**

**Conclusion:**

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
