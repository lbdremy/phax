# Multi-provider model routing

PHAX can route phase execution through three provider families — Claude Code, Mistral Vibe, and OpenAI Codex — selected by a user-editable global routing config while preserving a reasonable approximation of the requested capability.

## Model families

Routing speaks in stable **model families**, not versioned model IDs:

| Family           | Providers                                                          |
| ---------------- | ------------------------------------------------------------------ |
| `claude-haiku`   | claude-code                                                        |
| `claude-sonnet`  | claude-code, mistral-vibe (equivalent), codex-cli (equivalent)     |
| `claude-opus`    | claude-code, codex-cli (equivalent at low–xhigh; downgrade at max) |
| `mistral-medium` | mistral-vibe                                                       |
| `openai-gpt`     | codex-cli                                                          |

## Effort / thinking axis

Effort is normalized to an `EffortLevel` (superset: `none | off | low | medium | high | xhigh | max | ultracode`). `ThinkingLevel` is an alias for the same type. Valid efforts are per family:

| Family           | Valid efforts                                                  |
| ---------------- | -------------------------------------------------------------- |
| `claude-haiku`   | `none`                                                         |
| `claude-sonnet`  | `low` \| `medium` \| `high` \| `max`                           |
| `claude-opus`    | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `mistral-medium` | `off` \| `low` \| `medium` \| `high` \| `max`                  |
| `openai-gpt`     | `low` \| `medium` \| `high` \| `xhigh`                         |

Plan phases prefer Claude-oriented naming (`low | medium | high | max`) because Claude is the routing reference scale.

## PHAX routing tiers

Tiers represent capability levels independent of provider:

| Tier              | Typical use                                  |
| ----------------- | -------------------------------------------- |
| `cheap`           | Haiku-class, no thinking                     |
| `fast`            | Sonnet/low — fast path, stays Sonnet         |
| `standard`        | Sonnet/medium — default                      |
| `strong`          | Sonnet/high or codex/medium                  |
| `very_strong`     | Sonnet/max or codex/high                     |
| `frontier-low`    | Opus/low; codex gpt/high (`equivalent`)      |
| `frontier-medium` | Opus/medium; codex gpt/xhigh (`equivalent`)  |
| `frontier-high`   | Opus/high; codex gpt/xhigh (`equivalent`)    |
| `frontier-xhigh`  | Opus/xhigh; codex gpt/xhigh (`equivalent`)   |
| `frontier-max`    | Opus/max; codex gpt/xhigh (`downgrade`)      |
| `frontier-ultra`  | Opus/ultracode only — no Mistral/OpenAI peer |

## Default routing table (`~/.phax/model-routing.json`)

The built-in defaults (`DEFAULT_MODEL_ROUTING`) implement the spec §12 multi-provider routing table with `providerPriority: ["mistral-vibe", "codex-cli", "claude-code"]` and `allowDowngrade: true`. **This is non-breaking**: on a clean install, mistral-vibe and codex-cli ship `enabled: false` in the default provider config, so resolution skips them and every phase routes through Claude Code exactly as before. Enabling them (via `phax agent setup providers` or by editing `~/.phax/providers.json`) activates the richer routing with no config edit.

```json
{
  "version": 1,
  "providerPriority": ["mistral-vibe", "codex-cli", "claude-code"],
  "allowDowngrade": true,
  "defaultTier": "standard",
  "families": { ... },
  "tiers": { ... },
  "normalization": { ... },
  "requestedModelNormalization": {
    "claude-sonnet-4-6": "claude-sonnet",
    "claude-opus-4-8": "claude-opus",
    "claude-haiku-4-5-20251001": "claude-haiku"
  }
}
```

The `tiers` object maps each tier to each provider's offering:

```json
"standard": {
  "claude-code":   { "family": "claude-sonnet" },
  "mistral-vibe":  { "family": "mistral-medium", "effort": "medium", "relationship": "equivalent" },
  "codex-cli":     { "family": "openai-gpt", "effort": "medium", "relationship": "equivalent" }
}
```

## Default provider config (`~/.phax/providers.json`)

```json
{
  "providers": {
    "claude-code":   { "enabled": true, "executable": "claude", ... },
    "mistral-vibe":  { "enabled": true, "executable": "vibe", "modelEnvVar": "VIBE_ACTIVE_MODEL", "aliases": { "mistral-medium/medium": "phax-mistral-medium-3.5-medium" } },
    "codex-cli":     { "enabled": true, "executable": "codex", ... }
  }
}
```

## Resolution pipeline

```
requested model id  ──normalize──▶  family + effort
family + effort     ──normalize──▶  PHAX tier
tier + providerPriority           ▶  selected provider
selected provider   ──relationship─▶  classification
selected provider   ──providerCfg─▶  concrete model/alias
                                  ▶  agent.model.resolved
```

1. **Model → family**: look up `requestedModelNormalization`, then heuristic substring match.
2. **Family + effort → tier**: `normalization[family]` returns either `{ defaultTier }` or a per-effort map.
3. **Tier + priority → provider**: walk `providerPriority` in order; for each provider skip it if its `providers.json` entry is `enabled: false`; pick first provider present in `tiers[tier]`.
4. **Relationship classification**: classify the substitution.
5. **Downgrade gate**: when `allowDowngrade: false` and requested family is `claude-opus`, skip candidates with `downgrade` or `no_equivalent` relationship.
6. **Same-family preservation**: when requested family is a Claude family and provider is `claude-code`, the resolved family is forced to match the requested Claude family (effort is clamped to `FAMILY_EFFORTS`). This invariant holds regardless of the routing table.
7. **Concrete model**: resolve via `providerCfg.providers[provider].families[family].model` (claude/codex) or the Vibe alias map.

## Relationship semantics

| Relationship    | Meaning                                               |
| --------------- | ----------------------------------------------------- |
| `exact`         | Same family, same thinking level                      |
| `equivalent`    | Different provider/family, same capability tier       |
| `fallback`      | Same provider family at a lower thinking level        |
| `downgrade`     | Different provider, lower capability tier             |
| `no_equivalent` | No meaningful mapping; only falls back to claude-code |

## Worked examples (spec §15)

### Example 1 — sonnet/medium, mistral priority

- Request: `claude-sonnet-4-6` / `medium`
- Normalized: family `claude-sonnet`, tier `standard`
- Priority: `mistral-vibe` first → entry `{ family: "mistral-medium", thinking: "medium", relationship: "equivalent" }`
- Alias: `phax-mistral-medium-3.5-medium`
- **Result**: `mistral-vibe`, `phax-mistral-medium-3.5-medium`, relationship `equivalent`

### Example 2 — sonnet/high, codex priority

- Request: `claude-sonnet-4-6` / `high`
- Normalized: family `claude-sonnet`, tier `strong`
- Priority: `codex-cli` first → entry `{ family: "openai-gpt", effort: "medium", relationship: "equivalent" }`
- **Result**: `codex-cli`, `gpt-5.5`, effort `medium`, relationship `equivalent`

### Example 3 — opus/medium, codex priority, allowDowngrade true

- Request: `claude-opus-4-8` / `medium`
- Normalized: family `claude-opus`, tier `frontier-medium`
- Priority: `codex-cli` → `{ family: "openai-gpt", effort: "xhigh" }` — classified `equivalent`; allowed because `allowDowngrade: true`
- **Result**: `codex-cli`, `gpt-5.5`, effort `xhigh`, relationship `equivalent`

### Example 4 — opus/max, allowDowngrade false vs. true

- Request: `claude-opus-4-8` / `max`, tier `frontier-max`
- **allowDowngrade: true**: codex-cli → `{ effort: "xhigh", relationship: "downgrade" }` → selected
- **allowDowngrade: false**: `downgrade` skipped → falls through to `claude-code` / `claude-opus`

### Example 4b — opus/ultracode, any priority

- Request: `claude-opus-4-8` / `ultracode`, tier `frontier-ultra`
- No codex-cli or mistral-vibe entry on `frontier-ultra`
- **Result**: `claude-code`, `claude-opus/ultracode`, relationship `exact` (regardless of `allowDowngrade`)

### Example 5 — sonnet/low, same-family preservation

- Request: `claude-sonnet-4-6` / `low`
- Normalized: family `claude-sonnet`, tier `fast`
- `tiers.fast.claude-code = { family: "claude-sonnet", effort: "low" }` — stays Sonnet
- **Result**: `claude-code`, `claude-sonnet`, effort `low`, relationship `exact` (NOT claude-haiku)

## Editing the routing config

**To enable Mistral Vibe** as first priority:

1. Run `phax agent setup mistral-vibe --install-model-aliases` to install the PHAX aliases.
2. Set `providerPriority: ["mistral-vibe", "claude-code"]` in `~/.phax/model-routing.json`.

**To disable a provider**: set `enabled: false` in `providers.json`. Resolution skips disabled providers even if they appear in `providerPriority` and their aliases exist.

**No silent Opus downgrade**: when `allowDowngrade: false` (the default), resolution will not silently route `claude-opus` phases to a weaker provider. It falls through to `claude-code`.

### Per-invocation override with `--provider-priority`

Both `phax run` and `phax resume` accept a `--provider-priority <list>` flag that overrides `providerPriority` for that single invocation without writing any file on disk:

```bash
phax run --provider-priority mistral-vibe,claude-code
phax resume my-run --yes --provider-priority codex-cli,claude-code
```

`<list>` is a comma-separated sequence of provider ids. Valid ids: `claude-code`, `mistral-vibe`, `codex-cli`. Whitespace around commas is trimmed; trailing commas and duplicates are silently dropped (first-seen order is preserved). An empty or invalid list fails fast with a non-zero exit and a descriptive error.

The flag replaces `routing.providerPriority` in memory for that invocation only. Every other routing field (`allowDowngrade`, `tiers`, `normalization`, etc.) is preserved.

**Important**: `claude-code` remains the guaranteed terminal fallback inside `resolveModel`, regardless of the override. If the override list omits `claude-code` and no listed provider can serve a tier, resolution still falls through to `claude-code`. This is by design — it is not a bug.

## phax agent commands

```bash
phax agent models                             # print routing table + provider priority
phax agent resolve --model claude-sonnet-4-6 --effort medium [--json]
phax agent probe                              # check provider executable availability
phax agent setup mistral-vibe [--dry-run]     # list aliases that would be appended
phax agent setup mistral-vibe --install-model-aliases  # append PHAX Vibe aliases
```
