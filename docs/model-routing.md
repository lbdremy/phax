# Multi-provider model routing

PHAX can route phase execution through three provider families — Claude Code, Mistral Vibe, and OpenAI Codex — selected by a user-editable global routing config while preserving a reasonable approximation of the requested capability.

## Model families

Routing speaks in stable **model families**, not versioned model IDs:

| Family           | Providers                                                      |
| ---------------- | -------------------------------------------------------------- |
| `claude-haiku`   | claude-code                                                    |
| `claude-sonnet`  | claude-code, mistral-vibe (equivalent), codex-cli (equivalent) |
| `claude-opus`    | claude-code, codex-cli (fallback/downgrade)                    |
| `mistral-medium` | mistral-vibe                                                   |
| `openai-chatgpt` | codex-cli                                                      |

## Effort / thinking axis

Effort is normalized to a `ThinkingLevel`: `off | low | medium | high | xhigh | max`.

Plan phases use `low | medium | high` — the routing layer maps these to full thinking levels.

## PHAX routing tiers

Tiers represent capability levels independent of provider:

| Tier          | Typical use                         |
| ------------- | ----------------------------------- |
| `cheap`       | haiku-class, no thinking            |
| `fast`        | haiku-class with minimal effort     |
| `standard`    | sonnet/medium — default             |
| `strong`      | sonnet/high or codex/medium         |
| `very_strong` | sonnet/xhigh                        |
| `frontier`    | opus/medium or codex/xhigh fallback |
| `max`         | opus/max                            |

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
    "claude-opus-4-7": "claude-opus",
    "claude-haiku-4-5-20251001": "claude-haiku"
  }
}
```

The `tiers` object maps each tier to each provider's offering:

```json
"standard": {
  "claude-code":   { "family": "claude-sonnet" },
  "mistral-vibe":  { "family": "mistral-medium", "thinking": "medium", "relationship": "equivalent" },
  "codex-cli":     { "family": "openai-chatgpt", "thinking": "medium", "relationship": "equivalent" }
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
6. **Concrete model**: resolve via `providerCfg.providers[provider].families[family].model` (claude/codex) or the Vibe alias map.

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
- Priority: `codex-cli` first → entry `{ family: "openai-chatgpt", thinking: "medium", relationship: "equivalent" }`
- **Result**: `codex-cli`, `gpt-5.5`, thinking `medium`, relationship `equivalent`

### Example 3 — opus/medium, mistral priority, allowDowngrade true

- Request: `claude-opus-4-7` / `medium`
- Normalized: family `claude-opus`, tier `frontier`
- Priority: `codex-cli` → `{ thinking: "xhigh", relationship: "fallback" }` — allowed because `allowDowngrade: true`
- **Result**: `codex-cli`, thinking `xhigh`, relationship `fallback`

### Example 4 — opus/high, allowDowngrade false vs. true

- Request: `claude-opus-4-7` / `high`, tier `max`
- **allowDowngrade: true**: codex-cli → `{ thinking: "max", relationship: "downgrade" }` → selected
- **allowDowngrade: false**: `downgrade` skipped → falls through to `claude-code` / `claude-opus`

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
