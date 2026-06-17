# Remove Misleading Network Controls

Status: Draft

Date: 2026-06-17

Audience: implementation planning with Claude Code

Scope: functional behavior only

## 1. Context

PHAX exposes a network-control surface in the `security` block of `phax.json`:

```json
{
  "security": {
    "network": {
      "profile": "provider-only",   // "provider-only" | "dev-allowlist" | "open"
      "allowDomains": ["example.com"]
    }
  }
}
```

The naming promises per-domain network filtering: `provider-only` reads as "only the
provider's API domain is allowed", `dev-allowlist` reads as "provider domain plus the listed
domains", and `allowDomains` reads as an allowlist that is enforced.

None of that is true. Inspection of the provider adapters and the security capability table
confirms:

- **No provider enforces a domain allowlist.** `allowDomains` and the `dev-allowlist` profile
  are carried into the policy and recorded in `security.json`, but no provider applies
  per-domain filtering.
- **Claude Code** has no native domain-allowlist flag. The profile is recorded but not
  enforced; the `claude` process reaches its API intrinsically.
- **Mistral Vibe** has no network control at all.
- **Codex** is the only provider that enforces anything: a single on/off egress toggle
  (`sandbox_workspace_write.network_access`). Under `provider-only` it is `false` (subprocess
  network blocked); under `dev-allowlist`/`open` it is `true`. The listed domains are ignored —
  `dev-allowlist` merely *enables* egress exactly like `open`.

In short, the configuration surface describes a capability (per-domain network restriction)
that PHAX does not have. The only real control is a binary "egress on/off", and only for one
provider.

## 2. Problem

A security affordance that does not enforce what it appears to enforce is worse than no
affordance:

- a user can set `provider-only` with `allowDomains: []` and reasonably believe outbound
  traffic is restricted, when for Claude and Vibe it is not restricted at all;
- `security.json` records the network posture as though it were applied, so the audit
  artifact misrepresents what actually happened;
- the documentation has already had to be walked back to explain that the profile is "intent,
  enforced only where the provider supports it" — a sign the surface is wrong, not the docs;
- `dev-allowlist` is actively misleading: it reads as "restrict to these domains" but in
  practice opens the network.

The three-value profile and the domain allowlist should be removed. PHAX should expose only
network controls it actually enforces, described in honest terms.

## 3. Product goal

Remove the non-functional network-control surface from PHAX and replace it, at most, with a
single honest control that reflects what is genuinely enforced.

The guiding rule:

> PHAX must not expose a security setting that implies an enforcement it does not perform.

After this change, a user reading the config or the applied-posture artifact must be able to
trust that what is shown is what is actually enforced.

## 4. Terminology

### Network egress

Outbound network access available to the agent process and the subprocesses it spawns inside
a phase. This is the only network dimension PHAX can affect today, and only for providers
whose sandbox supports it.

### Enforced vs recorded

A control is **enforced** when the provider's sandbox actually applies it. A control is
**recorded** when it is written to `security.json` for audit but has no runtime effect. The
current network profile is recorded but, for Claude and Vibe, not enforced. This split is the
problem; the target state has no "recorded but not enforced" network controls.

## 5. Functional requirements

### 5.1 Remove the network profile enum

The three-value `security.network.profile` (`provider-only` | `dev-allowlist` | `open`) must
be removed from the PHAX configuration schema.

### 5.2 Remove the domain allowlist

`security.network.allowDomains` must be removed. PHAX must not present a domain-allowlist
concept anywhere in configuration, applied policy, or artifacts, because no provider enforces
it.

### 5.3 Remove network configuration entirely (decided)

The replacement is **no replacement**: PHAX exposes no network configuration at all.

- There is no `security.network` block in `phax.json`.
- In `secure` mode, each provider runs under its most conservative native default. For Codex
  this means egress disabled (the behavior `provider-only` produces today); for Claude and
  Mistral Vibe it means the provider's own native default, which PHAX does not restrict.
- `unsafe` mode keeps full host network access as today.
- The applied-posture artifact carries no network restriction field beyond a plain
  description of the effective default per provider (see §5.4).

Codex's egress toggle is not surfaced as a user-facing knob. If a future need arises to vary
it, that control belongs to the external-sandbox `isolated` mode, not to this configuration
surface. A single honest `allowEgress` boolean was considered and explicitly rejected for 1.0
to keep the surface minimal and avoid a per-provider "enforced here, not there" split.

### 5.4 Applied posture must reflect only enforced controls

The per-phase `security.json` and the final report must stop recording a network posture that
was not enforced. The artifact states the effective network default per provider (e.g.
"Codex: egress disabled", "Claude: provider-native default, not restricted by PHAX").

The artifact must never present an unenforced network restriction as if it were applied.

### 5.5 No back-compat shim

Consistent with PHAX's persisted-schema policy, the removed fields are removed, not retained
as ignored-optional.

A `phax.json` that still carries any `security.network` field must be rejected at config
validation with a clear, actionable message telling the user to remove the block, rather than
being silently ignored.

Example message intent:

```
The security.network block has been removed because no provider enforced domain filtering.
Remove security.network from phax.json — see docs/security.md.
```

### 5.6 `unsafe` mode is unchanged

`unsafe` mode continues to grant full host network access and continues to print its warning.
This spec does not touch `unsafe`.

### 5.7 Documentation must be corrected, not footnoted

`docs/security.md` and `README.md` must be updated to remove the network profile table, the
network-profile list, and the "intent, enforced only where supported" caveats that exist only
because the surface was wrong. The honest description of what remains (per chosen direction)
replaces them.

## 6. Non-goals

This spec does not:

- implement the planned external-sandbox `isolated` mode (that is the real path to enforced,
  provider-independent network isolation and is specified separately);
- change the filesystem jail behavior or the per-provider jail strength;
- change MCP controls;
- change shell-command enforcement;
- attempt to add per-domain filtering to any provider — that capability is explicitly
  abandoned, not deferred;
- change `unsafe`-mode behavior.

## 7. Acceptance criteria

### Profile removed

Given a `phax.json` with `security.network.profile`, when PHAX validates the config, it
reports the field as removed and does not run with it.

### Allowlist removed

Given a `phax.json` with `security.network.allowDomains`, when PHAX validates the config, it
reports the field as removed.

### No unenforced network claim in artifacts

Given any run in `secure` mode, the per-phase `security.json` and final report contain no
network restriction that was not actually enforced by the provider's sandbox.

### No network configuration surface

Given `phax.json`, there is no `security.network` block to set, and the applied posture shows
only the effective per-provider network default — never an unenforced restriction.

### Codex behavior preserved

Given a phase routed to Codex in `secure` mode, egress is disabled by default — the same
behavior today's `provider-only` produces. Removing the configuration surface does not change
Codex's default network behavior.

### Docs corrected

Given `docs/security.md` and `README.md`, neither describes a network profile enum or a domain
allowlist, and neither carries the "recorded but not enforced" caveat.

## 8. Open questions for implementation planning

- Should removing the old fields be a hard validation error (recommended, per §5.5) or a
  one-release loud warning before becoming an error? Default to hard error unless the planner
  finds a strong reason otherwise.
- Does any test, fixture, or example config reference the removed fields, and must they be
  updated in the same change?
- What is the exact effective network default PHAX should record for Claude and Mistral Vibe
  in `security.json` now that no PHAX-level restriction applies (a plain "provider-native
  default, not restricted by PHAX" string is the expected answer)?

## 9. Implementation-planning note

The functional contract is subtractive: PHAX stops claiming a network capability it does not
have. The decision is settled — remove the `security.network` block entirely (profile enum and
domain allowlist), keep no replacement knob, preserve Codex's conservative egress default, and
ensure configuration, applied-posture artifacts, and documentation all describe only enforced
behavior. Real provider-independent network isolation remains the job of the future
external-sandbox `isolated` mode, not of this surface.
