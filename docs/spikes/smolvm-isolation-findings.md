# smolvm isolation — findings synthesis and go/no-go

This document synthesizes the three probe findings from the smolvm isolation spike
(`spikes/smolvm/findings/01-filesystem.md`, `02-network.md`, `03-agents.md`) into a
single decision document for phax's reserved `isolated` security mode.

> **Resolved (2026-06-30).** The probes have now been run on smolvm 1.3.2 (macOS /
> arm64). Probe 01 (filesystem) is **PASS**; probe 02 (network) is **PASS** — the decisive
> hard-coded-IP egress case (`02-network.sh`, case 3) **blocks** (`Connection refused`).
> The go/no-go below is therefore no longer conditional: it is a **GO** on the security
> question. Probe 03 (agents) could not be run — no API keys were available — so the
> provider-execution questions remain open; see its findings doc. Two execution facts
> surfaced during the runs that change the *integration shape* (not the verdict) and are
> folded in below: the probe scripts could not run verbatim, and **a pre-baked image and
> `--allow-host` do not compose in smolvm 1.3.2**.

## Per-probe summary

### Probe 01 — Filesystem isolation (`findings/01-filesystem.md`)

The harness boots an Alpine guest with `smolvm machine run --image alpine -v
$WORK_DIR:/workspace` and checks five things: (A) the worktree mount round-trips
between host and guest, (B) the host `$HOME` is invisible, (C) the host repo root is
invisible, (D) the guest `/etc` reflects the Alpine image (not the macOS host), and
(E) a `:ro` mount rejects guest writes.

Verdict: **PASS (confirmed by run).** The guest is a Linux Alpine rootfs in libkrun, so
macOS host paths like `/Users/` simply do not exist except as explicit `-v` mounts —
`$HOME`, the repo root, and `/Users` were all absent from the guest. The key result is
(E): **smolvm enforces `:ro` at the hypervisor layer** (`Read-only file system` on a guest
write attempt, no write-through to host), so a future `isolated` mode can mount the
worktree read-only and require explicit `allowWrite` shares — `allowRead` and `allowWrite`
are distinguishable at the VM boundary. (One operational caveat from the run: an ephemeral
`--image` boot re-pulls every time and the pull needs network, so a pre-baked image /
`--from` artifact is required to boot — `01-filesystem.sh` as written omits `--net` and
cannot pull. See findings doc.)

### Probe 02 — Per-domain network allowlist (`findings/02-network.md`) — the decisive probe

The harness exercises a five-case matrix with `--net --allow-host example.com`:

| Case | Test                                       | Decides                                                      |
| ---- | ------------------------------------------ | ------------------------------------------------------------ |
| 1    | Allowed domain by name                     | Egress works at all                                          |
| 2    | Non-allowed domain by name                 | Deny-by-default for unlisted hosts                           |
| 3    | **Non-allowed host by hard-coded IP**      | **Whether `--allow-host` is a real boundary or DNS filter**  |
| 4    | Allowed host by raw IP                     | Enforcement layer (SNI/DNS vs egress filter)                 |
| 5    | ICMP                                       | Behavioural detail (smolvm docs: TCP/UDP only)               |

**Case 3 is the go/no-go signal for the entire spike.** If a guest process can reach a
non-allowed host by hard-coding its IP, the allowlist is a DNS convenience rather than
a security boundary — any agent (or attacker code an agent runs) that ships an IP
literal escapes the constraint. In that case, smolvm is not viable as the foundation
for `isolated` mode without an additional egress layer (e.g. a host-side L4 filter or
an enforced HTTP proxy).

Conversely, if case 3 blocks **and** case 2 blocks, `--allow-host` is a real
deny-by-default egress boundary — the gap that spec-14 identified as unenforceable at
the provider-native layer would finally be closeable.

**Run result (2026-06-30): both block.** Case 2 (non-allowed host by name) fails to even
resolve, and case 3 (non-allowed host by raw IP) is refused at L4 (`Connection refused`).
`--allow-host` resolves the allowed hostname to its IP(s) at VM start and permits egress to
those IPs only — it is a **real egress boundary**, not DNS-name filtering. Enforcement is
**IP-based**: case 4 (allowed host by its raw IP) connects (app-layer 403 from Cloudflare),
which confirms the mechanism and exposes the shared-CDN-IP caveat now folded into the risks
below. ICMP is not forwarded (case 5). The scripted probe could not be run verbatim — the
`apk add curl` step and the image pull are both blocked by the allowlist; busybox `wget`
and an extended allowlist (Docker registry hosts) were used instead. See findings doc.

### Probe 03 — Agents-in-guest (`findings/03-agents.md`)

The harness installs the three provider CLIs (`claude`, `codex`, `vibe`) in an
Alpine guest via `apk add nodejs npm && npm install -g <package>`, injects keys via
`smolvm -e KEY=VALUE`, and runs a trivial "create `hello.txt` in `/workspace`" task
in two configurations: **Step A** with `--net --allow-host <provider-api-domain>` and
**Step B** with no `--net` flag at all (zero egress).

What the synthesis cares about regardless of the per-provider details:

1. **In-guest install.** Step B requires the CLI to already be present in the guest
   image, because `apk` and `npm install` themselves need internet. The harness
   intentionally installs fresh per step so this surfaces as a finding. The
   implication for production `isolated` mode is unambiguous: it needs a **pre-baked
   guest image** with each provider CLI installed, not a live `npm install`.
2. **Denied-egress UX.** The harness's 60s `timeout` wrapper captures whether each
   CLI exits cleanly, times out, or hangs in a retry loop when its API endpoint is
   unreachable. Whatever the per-provider outcome, the design implication is the
   same: the agent must be **told up-front** what it can and cannot reach, or it will
   spend wall-clock retrying behind a wall it can't see (motivating the
   capability-preamble prompt below).
3. **Vibe package name.** `@mistralai/vibe` **does not exist on npm** (verified: it,
   `mistral-vibe`, and `@mistralai/vibe-cli` all 404). The real Vibe CLI distribution
   must be identified before this provider can be probed.

**Run status (2026-06-30): NOT RUN — no API keys available** (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `MISTRAL_API_KEY` all unset). The provider-task questions (install, task
completion, write-back, denial UX) are unanswered. The infrastructure facts above were,
however, confirmed in passing — and one of them (point 1, that live in-guest install is
blocked by the allowlist) is now hard fact, not hypothesis: `--allow-host` restricts the
guest DNS resolver, so package mirrors return `no such host`. A pre-baked image carrying the
provider CLIs is therefore **mandatory**, not optional.

## Go / no-go

**GO on the security question** (confirmed by run), with one integration constraint to
design around and one probe still open.

The deciding fact — the hard-coded-IP egress test (probe 02 case 3) — **blocks**. Combined
with smolvm's deny-by-default `$HOME`/repo-root isolation and hypervisor-enforced `:ro`
mounts (probe 01, PASS), smolvm provides a real filesystem **and** egress boundary:
`--allow-host` cannot be bypassed by shipping an IP literal. smolvm is therefore sufficient
to back `isolated` mode at the boundary level. The earlier no-go branch (case 3 succeeds →
need a host-side L4 filter or in-guest proxy) **does not apply**.

Two things temper the GO without reversing it:

- **Integration constraint (new).** A pre-baked image and `--allow-host` do not compose in
  smolvm 1.3.2 — `machine run --from <artifact> --allow-host …` is rejected, while a live
  `--image` boot pulls under the allowlist (forcing the Docker registry hosts onto it). The
  follow-up plan must account for this; see the integration sketch and residual risk 8.
- **Probe 03 open.** Provider CLIs were not executed in-guest (no keys). Write-back and the
  `:ro` boundary are proven (probe 01), but per-provider install/task/denial-UX behaviour is
  unverified. This is a gap to close in the follow-up plan, not a disqualifier.

A follow-up implementation plan may now be written, with probe 03 re-run as one of its early
validation steps.

## Integration sketch (not for implementation in this spike)

This is the shape a follow-up plan would take. Nothing here is implemented; the
synthesis only fixes terms so a future plan can be written from it without re-reading
the three probe docs.

### Adapter location

A new infrastructure adapter under `src/infra/providers/` (e.g.
`isolatedSandbox.ts`) wraps the existing provider spawn instead of replacing it. The
adapter is selected by the dispatcher when `SecurityPolicy.mode === "isolated"`; for
each provider invocation it:

1. Builds the smolvm argv from the resolved `SecurityPolicy`:
   - `-v <worktreePath>:/workspace[:ro]` from `filesystem.allowRead`/`allowWrite`.
   - `--net --allow-host <domain>` once per allowed domain (provider API + each
     allowed MCP domain — see below). If the resolved policy has no allowed domains,
     omit `--net` entirely (Step B in probe 03).
   - `-e KEY=VALUE` for each provider credential, read from host env.
2. Replaces the inner argv with the existing provider CLI invocation (the same one
   `claudeCode.ts` / `codexCli.ts` / `mistralVibe.ts` already build), but resolved to
   the in-guest path (the pre-baked image installs it at a known location).
3. Streams stdout/stderr back through the existing `Shell` port; the host sees one
   process (smolvm) and the existing telemetry/session capture continues to work.

**Image acquisition vs. the allowlist (constraint surfaced by the run).** The probes
proved that in smolvm 1.3.2 the image pull obeys the run's egress allowlist, and the
pull-free path (`--from <artifact>`) **rejects `--allow-host`**. So the adapter cannot
"pre-bake an image and add `--allow-host`". The two workable shapes are:

1. **Ephemeral `--image` boot, registry hosts on the allowlist.** Every boot allowlists the
   provider/MCP domains *plus* the Docker registry + CDN hosts (`index.docker.io`,
   `auth.docker.io`, `registry-1.docker.io`, `production.cloudfront.docker.com`, …) so the
   pull can run. Re-pulls per boot; registry hosts are reachable from the guest for the
   pull window. The follow-up plan must decide whether that egress is acceptable.
2. **Offline/pre-pulled image store** (preferred if smolvm supports it, or a newer smolvm
   that lifts the `--from` + `--allow-host` restriction): boot from a locally-cached image
   with only the provider/MCP domains allowlisted and no registry egress at all.

This is tracked as residual risk 8. The stub at `src/cli/commands/run.ts:152-158` (currently
rejecting `isolated` mode with a "planned but not available" message) is the entry point
that switches from rejection to dispatching the wrapped adapter.

### Reuse of `SecurityPolicy`

No new domain type is needed. The existing `SecurityPolicy` in
`src/domain/security/types.ts` already has:

- `filesystem.allowRead` / `filesystem.allowWrite` → `-v` mounts (with `:ro` for
  read-only entries).
- `network.profile` → `--net` toggle; `provider-only` means only the provider API
  domain is allowed.
- `mcp.allow` → see below.
- `agentCommands` → unchanged; the in-guest CLI is one of these.

The `isolated` literal already exists in `SecurityMode` and `SecurityProfileSchema`
(`src/schemas/securityConfig.ts:4`). Removing the stub in `run.ts` and dispatching to
the new adapter is the entire surface-area change at the boundary.

### `secure` vs `isolated` are complementary, not exclusive

`secure` ("agent knows its limits", provider-native) and `isolated` (microVM
enclosure) are layered. `isolated` mode should still spawn each provider CLI with the
same provider-native flags `secure` uses — defence in depth, not either/or. The VM is
the boundary the agent **cannot** see past; the provider-native flags keep the agent
behaving reasonably inside it.

### MCP domain declaration

The VM cannot infer an MCP server's outbound hosts. The follow-up plan must extend
the existing `mcp.allow` config so each entry declares the domains it talks to. The
proposed shape is to widen `McpConfigSchema.allow` from `Array<string>` to
`Array<{ name: string; domains: ReadonlyArray<string> }>` (or a parallel
`mcp.domains` map keyed by `name`, if back-compat with existing configs matters —
schemas in this repo deliberately do not carry back-compat shims, so the wider shape
is preferable). At resolution time, the union of declared domains is added to
`--allow-host`.

If an MCP server in the user's config has no declared domains, `isolated` mode
**refuses to start the run** rather than guess. Silent allow-everything would defeat
the boundary.

### Capability-preamble prompt

Motivated directly by probe 03's denied-egress UX: when the agent has no visibility
into what it can and cannot reach, it wastes wall-clock retrying or hangs. The
adapter must inject — once, at the top of the agent's prompt — a deterministic
preamble describing the sandbox:

> You are running inside a microVM sandbox. You can read and write `/workspace`
> (which is your worktree on the host). You cannot see any other host paths. You can
> make network requests to the following domains only: `<list>`. Any other network
> request will fail. Do not attempt to install packages or reach other hosts; report
> the limitation and proceed with what is available.

The preamble is generated from the same `SecurityPolicy` the adapter uses to build
the smolvm argv, so the prompt and the actual sandbox cannot drift.

## Residual risks

1. **~~Case 3 may not block.~~ RESOLVED — it blocks.** The decisive test passed: a raw IP
   to a non-allowed host is refused at L4. `--allow-host` is a real egress boundary. No
   re-scope needed.
2. **Shared-CDN-IP bypass surface (CONFIRMED).** Enforcement is by IP resolved at VM start
   (case 4: the allowed host's raw IP connects). Therefore allowlisting one host on a shared
   CDN address transitively permits any other host served from that same IP — example.com's
   Cloudflare IP is the worked example. A follow-up plan must treat the allowlist as
   IP-granular, not host-granular, and decide whether that precision is acceptable for the
   provider/MCP domains in scope (many sit behind shared CDNs).
3. **~~Volume-mount maturity.~~ RESOLVED favourably.** Probe 01 case E confirmed `:ro` is
   enforced at the hypervisor layer (guest write → EROFS, no host write-through). The
   worktree can be mounted read-only and `allowRead`/`allowWrite` are distinguishable at the
   VM boundary.
4. **Cross-arch guest.** Apple Silicon hosts run an arm64 Linux guest; some provider
   CLIs may not ship arm64 Linux binaries or compatible Node engine versions. A
   pre-baked image is required regardless of architecture; the image-bake recipe
   must be cross-arch.
5. **Boot/perf cost.** Each phase boots a microVM. The spike does not measure this;
   if boot adds multiple seconds per phase, large multi-phase runs may be noticeably
   slower than `secure` mode. Acceptable trade-off, but worth measuring before
   release.
6. **Credential handling.** Keys pass via `-e KEY=VALUE`. Logs and telemetry must
   never echo the values; the existing `agentErrorLog` and session writers in
   `src/infra/providers/` must be audited before `isolated` ships.
7. **Pre-baked image distribution.** `isolated` mode cannot run if the user has no
   image with the provider CLIs installed. The follow-up plan must decide whether
   phax ships an image, builds one on first run, or requires the user to bake one.
   Confirmed mandatory by the run: live `apk`/`npm` install in-guest is blocked by the
   egress allowlist, so the CLIs must already be in the image.
8. **Pre-baked image and `--allow-host` do not compose (smolvm 1.3.2).** `machine run
   --from <artifact> --allow-host …` is rejected, and a live `--image` boot pulls under the
   allowlist (requiring the Docker registry hosts on the allowlist). The follow-up plan must
   pick one of the two shapes in the integration sketch (ephemeral `--image` + registry
   allowlist, or an offline image store / newer smolvm) and verify it before committing to
   the adapter design. This is the single biggest open integration question.

## Recommended next step

Case 3 blocked, so the GO path is active:

1. ✅ **Done.** The `## Results` and `## Verdict` of all three probe docs are filled
   (01 PASS, 02 PASS, 03 BLOCKED-no-keys) and the provisional marker is removed.
2. **Resolve residual risk 8 first** (image acquisition vs. allowlist) — it is a
   prerequisite for the adapter design, not a detail. Spike whether a newer smolvm lifts
   the `--from` + `--allow-host` restriction or whether an offline image store exists;
   otherwise commit to the ephemeral-`--image`-plus-registry-allowlist shape and confirm
   that registry egress during the pull window is acceptable.
3. **Re-run probe 03 with real API keys** and a reworked harness (pre-baked image carrying
   the CLIs; provider/MCP + registry hosts allowlisted; `--timeout 60s` instead of the host
   `timeout`; the correct Vibe CLI distribution). This closes the only open probe before any
   code is written.
4. Write a follow-up implementation plan (`plan.md`) covering: the new `isolatedSandbox`
   adapter in `src/infra/providers/`, the dispatcher switch on
   `SecurityPolicy.mode === "isolated"`, the widened `mcp.allow` schema, the
   capability-preamble prompt builder, the pre-baked guest image recipe, and an e2e test
   under `pnpm test:e2e:real` that boots a real VM.
5. Remove the stub rejection in `src/cli/commands/run.ts:152-158` only at the end of the
   implementation plan, gated on all of the above.

The probe scripts have since been fixed so a future re-run is verbatim: `01` bakes a
`--from` artifact (no `--net` pull problem); `02` uses busybox `wget` and allowlists the
registry hosts; `03` uses smolvm's `--timeout`, allowlists the package mirrors for Step A,
and boots Step B offline from the artifact. Two items remain operator-supplied: real API
keys, and the correct Vibe CLI distribution (`VIBE_NPM_PKG` — `@mistralai/vibe` 404s). The
argv-key-exposure nit (residual risk 6) has no clean fix within smolvm's `-e KEY=VALUE` and
is left documented.
