# Multi-provider model routing

PHAX routes phase execution through three provider families — Claude Code, Mistral Vibe, and OpenAI Codex — using a **versioned model catalog** and a **Claude-hub equivalence table**. A concrete versioned model id and effort resolve natively when a provider serves the same family; they translate through the Claude hub when they don't.

## Model families

Five families span the three providers:

| Family           | Providers                              |
| ---------------- | -------------------------------------- |
| `claude-haiku`   | claude-code                            |
| `claude-sonnet`  | claude-code, mistral-vibe (equivalent) |
| `claude-opus`    | claude-code, codex-cli (equivalent)    |
| `mistral-medium` | mistral-vibe                           |
| `openai-gpt`     | codex-cli                              |

## Versioned catalog

The provider config (`~/.phax/providers.json`) holds the catalog. Every entry is a concrete versioned model id with its own effort set and status:

```json
{
  "providers": {
    "claude-code": {
      "enabled": true,
      "executable": "claude",
      "families": {
        "claude-sonnet": {
          "models": [
            { "id": "claude-sonnet-4-6", "efforts": ["low", "medium", "high", "max"], "status": "active" }
          ]
        },
        "claude-opus": {
          "models": [
            { "id": "claude-opus-4-8", "efforts": ["low", "medium", "high", "xhigh", "max", "ultracode"], "status": "active" }
          ]
        }
      }
    }
  }
}
```

Efforts are **per catalog entry** (per versioned id), not per family. A deprecated entry stays in the catalog so existing plans referencing it get an actionable error with current alternatives rather than a silent miss.

Valid effort values: `none | off | low | medium | high | xhigh | max | ultracode`. Different entries support different subsets.

## Claude-hub equivalence table

Cross-family translation uses a **star topology** rooted at Claude. Every edge in `model-routing.json`'s `equivalence` field is a directed edge from a non-Claude ("spoke") catalog id at a given effort to a Claude ("hub") catalog id at a given effort:

```json
{
  "equivalence": {
    "gpt-5.5": {
      "low":    { "claude": "claude-sonnet-4-6", "effort": "low",    "relation": "equivalent" },
      "medium": { "claude": "claude-sonnet-4-6", "effort": "medium", "relation": "equivalent" },
      "high":   { "claude": "claude-sonnet-4-6", "effort": "high",   "relation": "equivalent" },
      "xhigh":  { "claude": "claude-opus-4-8",   "effort": "medium", "relation": "equivalent" }
    },
    "phax-mistral-medium-3.5-medium": {
      "medium": { "claude": "claude-sonnet-4-6", "effort": "medium", "relation": "equivalent" }
    }
  }
}
```

Resolution uses this table in three directions:

- **hub → spoke**: find the spoke id whose edge points at the requested Claude id + effort and belongs to the target family. The stored relation applies as-is.
- **spoke → hub**: direct lookup `equivalence[id][effort]`; the relation is **inverted** (`downgrade ↔ upgrade`).
- **spoke → spoke**: compose the two hops (spoke1 → hub, hub → spoke2). The resulting relation is the composition of both hops.

## Resolution algorithm

```
resolveModel(request, routing, providerCfg, securityFilter?) → RoutingResolution
```

1. **Derive plan family** from `request.model`: catalog lookup → `requestedModelNormalization` → substring heuristic → default `claude-sonnet`.
2. **Walk `routing.providerPriority`**; for each provider skip it when `providers.json` has `enabled: false` or a caller-supplied `securityFilter` returns `allowed: false`.
3. **Same-family provider**: if the provider serves the plan family, resolve the concrete id and effort directly from the catalog. Relationship is `exact` (id + effort match) or `equivalent` (effort clamped to the entry's supported set).
4. **Cross-family provider**: look up the equivalent via the Claude hub using `equivalentFor`. Skip when `allowDowngrade: false` and the relation is `downgrade` or `no_equivalent`.
5. **Terminal `claude-code` fallback**: if no priority provider resolves, fall back to `claude-code`. Same-family Claude requests resolve natively; spoke requests translate through the hub. Relationship `no_equivalent` on a complete miss.

`resolveModel` is total — it never throws and always returns a `RoutingResolution`.

## Relationship semantics

| Relationship    | Meaning                                                   |
| --------------- | --------------------------------------------------------- |
| `exact`         | Same id, same effort                                      |
| `equivalent`    | Different provider/family, same capability level          |
| `upgrade`       | Spoke → hub direction of a hub-to-spoke `downgrade` edge  |
| `fallback`      | Same provider family at a lower effort                    |
| `downgrade`     | Different provider, lower capability level                |
| `no_equivalent` | No meaningful mapping; fell through to claude-code        |

The `relation` stored in the `equivalence` table is stated **hub-centric**. A hub → spoke lookup uses it directly; a spoke → hub lookup inverts it (`downgrade ↔ upgrade`).

## `allowDowngrade` floor

`allowDowngrade` in `model-routing.json` is the sole policy knob for cross-family capability decisions:

- **`true`** (default): `downgrade` and `no_equivalent` relations are permitted. A spoke provider with a weaker Claude anchor is still selected.
- **`false`**: edges with `downgrade` or `no_equivalent` are skipped. Resolution falls through to the next priority provider or the `claude-code` terminal.

`allowDowngrade` has no effect on same-family resolution — that path is always permitted.

## Run-start preflight

Before any phase agent spawns, `phax run` validates every phase's model and effort against the catalog:

- The model id exists in the catalog.
- The effort is in that entry's supported effort set.
- The entry is not marked `deprecated`.
- The entry's provider is enabled (or a permitted cross-family equivalence route exists under `allowDowngrade`).

If any phase fails, the run exits non-zero with the offending phase ids, failure reasons, and catalog-derived alternatives — so the planning agent can self-correct without starting any expensive work.

## Default routing config (`~/.phax/model-routing.json`)

Config version 2. Old `tiers`, `normalization`, and `defaultTier` fields are rejected with an error — there is no back-compat shim.

```json
{
  "version": 2,
  "providerPriority": ["mistral-vibe", "codex-cli", "claude-code"],
  "allowDowngrade": true,
  "equivalence": {
    "gpt-5.5": {
      "low":    { "claude": "claude-sonnet-4-6",         "effort": "low",    "relation": "equivalent" },
      "medium": { "claude": "claude-sonnet-4-6",         "effort": "medium", "relation": "equivalent" },
      "high":   { "claude": "claude-sonnet-4-6",         "effort": "high",   "relation": "equivalent" },
      "xhigh":  { "claude": "claude-opus-4-8",           "effort": "medium", "relation": "equivalent" }
    },
    "phax-mistral-medium-3.5-off":    { "off":    { "claude": "claude-haiku-4-5-20251001", "effort": "none",   "relation": "equivalent" } },
    "phax-mistral-medium-3.5-low":    { "low":    { "claude": "claude-sonnet-4-6",         "effort": "low",    "relation": "equivalent" } },
    "phax-mistral-medium-3.5-medium": { "medium": { "claude": "claude-sonnet-4-6",         "effort": "medium", "relation": "equivalent" } },
    "phax-mistral-medium-3.5-high":   { "high":   { "claude": "claude-sonnet-4-6",         "effort": "high",   "relation": "equivalent" } },
    "phax-mistral-medium-3.5-max":    { "max":    { "claude": "claude-sonnet-4-6",         "effort": "max",    "relation": "equivalent" } }
  },
  "requestedModelNormalization": {
    "haiku":  "claude-haiku",
    "sonnet": "claude-sonnet",
    "opus":   "claude-opus"
  }
}
```

**Non-breaking default**: `mistral-vibe` and `codex-cli` ship `enabled: false` in the default provider config. Resolution skips disabled providers, so every phase routes through Claude Code on a clean install. Enabling them via `phax agent setup providers --write` activates the richer routing with no config edit.

## Default provider config (`~/.phax/providers.json`)

```json
{
  "providers": {
    "claude-code":   { "enabled": true,  "executable": "claude", "families": { ... } },
    "mistral-vibe":  { "enabled": false, "executable": "vibe",   "modelEnvVar": "VIBE_ACTIVE_MODEL", "families": { ... } },
    "codex-cli":     { "enabled": false, "executable": "codex",  "families": { ... } }
  }
}
```

Each `families` entry contains a `models` array of versioned entries with `id`, `efforts`, and `status`.

## Worked examples

### Example 1 — claude-sonnet-4-6/medium, claude-code only (native passthrough)

- Request: `claude-sonnet-4-6` / `medium`
- Plan family: `claude-sonnet` (catalog lookup)
- Priority: `claude-code` (others disabled)
- Provider serves `claude-sonnet` natively → entry `claude-sonnet-4-6`, effort `medium` ✓
- **Result**: `claude-code`, `claude-sonnet-4-6`, effort `medium`, relationship `exact`

### Example 2 — claude-sonnet-4-6/medium, mistral-vibe first (cross-family translation)

- Request: `claude-sonnet-4-6` / `medium`
- Plan family: `claude-sonnet`
- Priority: `mistral-vibe` first (enabled)
- Provider serves `mistral-medium`, not `claude-sonnet` → hub → spoke lookup
- Find spoke whose edge is `{claude: "claude-sonnet-4-6", effort: "medium"}` in `mistral-medium` → `phax-mistral-medium-3.5-medium`
- **Result**: `mistral-vibe`, `phax-mistral-medium-3.5-medium`, effort `medium`, relationship `equivalent`

### Example 3 — gpt-5.5/xhigh, codex-cli enabled (native passthrough)

- Request: `gpt-5.5` / `xhigh`
- Plan family: `openai-gpt` (catalog lookup)
- Priority: `codex-cli` first (enabled) → serves `openai-gpt` natively
- **Result**: `codex-cli`, `gpt-5.5`, effort `xhigh`, relationship `exact`

If `codex-cli` is disabled, the terminal translates spoke → hub: `equivalence["gpt-5.5"]["xhigh"]` → `{claude: "claude-opus-4-8", effort: "medium"}` (relation inverted to `equivalent`).
- **Fallback result**: `claude-code`, `claude-opus-4-8`, effort `medium`, relationship `equivalent`

### Example 4 — opus/max, cross-family lookup miss

- Request: `claude-opus-4-8` / `max`, `codex-cli` first (enabled)
- Plan family: `claude-opus`; provider serves `openai-gpt`, not `claude-opus` → hub → spoke lookup
- No `gpt-5.5` spoke has `{claude: "claude-opus-4-8", effort: "max"}` in its edge → no match
- Falls through to `claude-code` terminal → same-family natively
- **Result**: `claude-code`, `claude-opus-4-8`, effort `max`, relationship `exact`

### Example 5 — opus/ultracode, any priority

- Request: `claude-opus-4-8` / `ultracode`
- No spoke equivalence edge for any id at effort `ultracode`
- Falls to `claude-code` terminal → same-family natively
- **Result**: `claude-code`, `claude-opus-4-8`, effort `ultracode`, relationship `exact`

## Editing the routing config

**To enable Mistral Vibe** as first priority:

1. Run `phax agent setup mistral-vibe --install-model-aliases` to install the PHAX aliases.
2. Set `providerPriority: ["mistral-vibe", "claude-code"]` in `~/.phax/model-routing.json`.

**To disable a provider**: set `enabled: false` in `providers.json`. Resolution skips disabled providers even if they appear in `providerPriority`.

**No silent capability downgrade**: when `allowDowngrade: false`, resolution will not route to a weaker cross-family equivalent. It falls through to the next priority provider or the `claude-code` terminal.

### Per-invocation override with `--provider-priority`

Both `phax run` and `phax resume` accept a `--provider-priority <list>` flag that overrides `providerPriority` for that single invocation without writing any file on disk:

```bash
phax run --provider-priority mistral-vibe,claude-code
phax resume my-run --yes --provider-priority codex-cli,claude-code
```

`<list>` is a comma-separated sequence of provider ids. Valid ids: `claude-code`, `mistral-vibe`, `codex-cli`. Whitespace around commas is trimmed; trailing commas and duplicates are silently dropped. An empty or invalid list fails fast with a non-zero exit and a descriptive error.

The flag replaces `routing.providerPriority` in memory for that invocation only. `claude-code` remains the guaranteed terminal fallback in `resolveModel` regardless of the override.

## phax agent commands

```bash
phax agent models                             # print catalog + provider priority + equivalence table
phax agent resolve --model claude-sonnet-4-6 --effort medium [--json]
phax agent probe                              # check provider executable availability
phax agent setup mistral-vibe [--dry-run]     # list aliases that would be appended
phax agent setup mistral-vibe --install-model-aliases  # append PHAX Vibe aliases
```
