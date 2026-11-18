---
status: Draft
date: 2026-11-18
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Vibe model and thinking level by Vibe's own flags

## 1. Context

When phax first drove Mistral Vibe, Vibe had no per-run way to choose a model or a thinking level. phax worked around that in three places.

Setup: `phax agent setup mistral-vibe --install-model-aliases` appends one `[[models]]` block per thinking level to the user's `~/.vibe/config.toml`. Each block is marked `# Added by PHAX.` and has the alias `phax-mistral-medium-3.5-off` or `phax-mistral-medium-3.5-high`. It copies the base alias `mistral-medium-3.5`'s name, provider, temperature, prices and auto_compact_threshold, and sets `thinking = "<level>"`. The command writes a backup and reports any `-low`/`-medium`/`-max` aliases an older phax left behind.

Catalog: the `mistral-vibe` provider entry carries `"modelEnvVar": "VIBE_ACTIVE_MODEL"`. Its `mistral-medium` family lists the two alias ids, one effort each. The equivalence table anchors `phax-mistral-medium-3.5-off`/off to `claude-haiku-4-5-20251001`/none and `phax-mistral-medium-3.5-high`/high to `claude-sonnet-4-6`/high. `RETIRED_MODEL_IDS` already holds the `-low`, `-medium` and `-max` aliases. phax refuses a `providers.json` that lists them, and `phax agent setup providers --write` drops them, together with any family they leave empty.

Invocation: every headless turn runs `vibe -p <prompt> --agent … --output streaming [--output-dir <dir>] --workdir … [--resume <id>]` and sets `VIBE_ACTIVE_MODEL=<alias>` in the environment. A sealed completion does the same. The fresh-start command a review stop prints runs Vibe's TUI: `cd '<worktree>' && VIBE_ACTIVE_MODEL='<alias>' 'vibe' '--workdir' '<worktree>' … '<prompt>'`. It is persisted as `{ cwd, argv, env }` in the stop record. After a confined turn, phax reads the export's `config` and compares it with the confinement it set: permissions, outside_workdir, MCP, tools and enabled_tools, but not the model. phax refuses a Vibe older than 3.0.3 before any session spawns, with `mistral-vibe <v> is installed; phax needs 3.0.3 or later.` and `Upgrade it: uv tool upgrade mistral-vibe`.

Mistral Vibe 3.1.3, installed 2026-11-18, adds what phax lacked. `--model ALIAS` selects a model for a new headless session without saving it, and an unknown alias is a usage error (exit 1). `--thinking LEVEL` selects the thinking level for a new headless session; a level that an agent profile or the admin config fixes is a usage error. Vibe's built-in table has the alias `mistral-medium-3.5`, with thinking levels off and high and a default of high. A resumed session keeps the model and agent it last ran. `--output-dir` still writes `export.json` at `schema_version: 1`, and its effective `config` includes `active_model`. phax's real-CLI Vibe e2e passes on 3.1.3 unchanged, on the alias path.

This authoring session read only recorded exports (vibe 3.0.3). They show `config.active_model` and no thinking level. Whether a 3.1.3 export records the level that `--thinking` set has not been checked on a real export.

Ground read:

- `src/infra/providers/mistralVibe.ts` — buildVibeArgs (no model flag; comment says model goes by modelEnvVar), spawnVibe (sets entry.modelEnvVar = model alias), runVibeCompletion, requireSupportedVibe (3.0.3 floor, refusal text and upgrade hint), the post-turn vibeConfigMismatch call and its refusal message.
- `src/domain/session/vibeFlags.ts` — The secure confinement (unchanged by this spec) and vibeConfigMismatch, which today compares bypass_tool_permissions, outside_workdir, enable_mcp/connectors, tools.* and enabled_tools, never the model.
- `src/domain/session/mistral.ts` — buildFreshStartCommand: `vibe --workdir <wt> [--add-dir|--trust] <prompt>` with env { VIBE_ACTIVE_MODEL (or modelEnvVar): model }.
- `src/app/interactiveStop.ts` — The stop passes providerEntry.modelEnvVar into the fresh-start command.
- `src/schemas/reviewStop.ts` — A persisted stop command is { cwd, argv, env }: no note field, so a printed note must not change this format.
- `src/domain/routing/defaults.ts` — mistral-vibe entry (modelEnvVar VIBE_ACTIVE_MODEL, family mistral-medium with the two phax alias ids), the two equivalence edges (off → claude-haiku-4-5-20251001 none, high → claude-sonnet-4-6 high), RETIRED_MODEL_IDS with -low/-medium/-max.
- `src/schemas/providerConfig.ts` — modelEnvVar is an optional key of a provider entry; decoding rejects excess properties.
- `src/app/loadRouting.ts` — loadProviderConfig refuses retired ids naming `phax agent setup providers --write`; readProviderConfigFile uses the same strict decode; loadModelRouting does no check of equivalence keys.
- `src/domain/routing/providerSetup.ts` — setup providers --write drops retired ids and drops a family they empty: a file listing only the two alias ids would lose the mistral-medium family.
- `src/app/vibeSetup.ts` — The alias installer: reads ~/.vibe/config.toml, writes a backup, appends blocks, reports retired aliases.
- `src/schemas/vibeConfig.ts` — The `# Added by PHAX.` [[models]] block it renders, with name, provider, temperature, thinking, prices, auto_compact_threshold copied from the base alias.
- `src/cli/definitions/agent.ts` — `phax agent setup mistral-vibe` (--dry-run, --install-model-aliases, JSON fields aliasesAdded/Skipped/Retired, backupPath) and `phax agent setup providers` output (retiredRemoved).
- `tests/behaviourCorpus/cases/answers/vibe-export.json` — Recorded exports (vibe 3.0.3) carry `config.active_model` ("phax-mistral-medium-3.5-high"); no thinking level appears in them.
- `README.md` — Vibe setup still tells the operator to run `phax agent setup mistral-vibe --install-model-aliases`.
- `docs/model-routing.md` — Shows the alias ids in equivalence examples, `modelEnvVar` in the providers example and the alias install step.
- `docs/model-catalog.md` — Lists `phax-mistral-medium-3.5-{off,high}` and the 2026-10-28 change-log line.
- `docs/upgrading.md` — Release-by-release entries; latest is 0.40.0 (package.json version 0.40.0).

## 2. Problem

phax edits a file it does not own. Before a Vibe phase can run, the user's `~/.vibe/config.toml` must carry blocks that phax wrote. phax copies prices and compaction thresholds into those blocks, and the copies drift as Vibe changes its own table. A user who never ran the installer gets a model alias Vibe does not know. A user who did run it keeps phax-shaped config in Vibe's home directory, with a backup file beside it. The catalog names models (`phax-mistral-medium-3.5-*`) that exist only because of the workaround. Each one needs equivalence edges, retirement entries and an installer to maintain.

Vibe now offers per-run `--model` and `--thinking` flags, so none of this machinery is needed. The model selection is also unchecked. A confined turn that ran under a model other than the one phax chose is accepted, because the post-turn check never looks at `active_model`. That can happen when an agent profile overrides it, or when a resumed session restores something else.

Removing the workaround has two traps. First, an existing `providers.json` lists only the two alias ids in its `mistral-medium` family, and today's rewrite drops a family that it empties. Second, a scaffolded `model-routing.json` keys its Vibe edges on those ids. Either way, Vibe would silently stop being routed.

## 3. Product goal

phax chooses a Vibe session's model and thinking level per invocation, with Vibe's own `--model` and `--thinking` flags and Vibe's own `mistral-medium-3.5` alias. It never writes Vibe's config to make this work. It confirms afterwards that a confined turn ran under the model it asked for. The catalog, the version floor, the stop command and the setup commands change to match. An old `providers.json` or `model-routing.json` is refused by name and fixed by one documented step, never read leniently or ignored silently.

> phax picks a Vibe model only through what Vibe exposes per run (its flags and its own model table), and never through files in Vibe's home directory.

## 4. Terminology

- **Vibe alias** — A model name in Vibe's model table that Vibe resolves to a provider model. `mistral-medium-3.5` is a built-in Vibe alias. `phax-mistral-medium-3.5-off` and `phax-mistral-medium-3.5-high` are the aliases phax used to install.
- **thinking level** — The value Vibe's `--thinking` takes. For `mistral-medium-3.5` phax uses `off` and `high`, which are the catalog's efforts for that model.
- **new headless session** — A Vibe invocation with `-p` and without `--resume`: a phase's first turn, an authoring, code-review, compliance-review, decide or extraction session, or a sealed completion.
- **resumed turn** — A headless Vibe invocation with `--resume <session-id>`, such as a fix-loop turn or a closing turn.
- **confined turn** — A headless Vibe turn that phax confines: a secure-mode session, or any read-only session. These are the only turns whose export phax compares with what it set.
- **PHAX alias blocks** — The `# Added by PHAX.` `[[models]]` blocks that `phax agent setup mistral-vibe --install-model-aliases` appended to `~/.vibe/config.toml`.
- **retired id** — A catalog id phax no longer routes to, listed with its reason. phax refuses a `providers.json` that lists one, and `phax agent setup providers --write` removes it.
- **fresh-start command** — The command a review stop prints, and records in its stop record, that starts a new interactive Vibe (TUI) session in the phase worktree.

## 5. Functional requirements

### 5.1 New sessions carry model and thinking flags

WHEN phax starts a new headless Vibe session THE system SHALL pass `--model <model>` and `--thinking <effort>`, where `<model>` is the catalog model and `<effort>` the effort that routing resolved for that session.

### 5.2 Resumed turns carry neither flag

WHEN phax runs a resumed Vibe turn THE system SHALL pass neither `--model` nor `--thinking`.

### 5.3 No model variable on headless turns

The system shall set no `VIBE_ACTIVE_MODEL` variable in the environment of any headless Vibe invocation.

### 5.4 A confined turn ran under the model phax chose

IF a confined Vibe turn's export reports a `config.active_model` other than the model phax resolved for the session, on a new or a resumed turn THEN the system SHALL refuse the turn's result, naming `active_model`, the reported value, the value phax set and the export it read.

### 5.5 The mistral-medium family lists Vibe's own alias

The system shall ship a `mistral-vibe` catalog whose `mistral-medium` family lists exactly one model, `mistral-medium-3.5`, with efforts `off` and `high`.

### 5.6 Equivalences move to the new id

The system shall ship equivalence edges keyed on `mistral-medium-3.5`: `off` to `claude-haiku-4-5-20251001` at `none` and `high` to `claude-sonnet-4-6` at `high`, both `equivalent`, and none keyed on a `phax-mistral-medium-3.5-*` id.

### 5.7 The alias ids are retired

IF `~/.phax/providers.json` lists `phax-mistral-medium-3.5-off` or `phax-mistral-medium-3.5-high` THEN the system SHALL refuse the file before any session spawns, naming each such id, why it is retired, and `phax agent setup providers --write`.

### 5.8 The rewrite lists the successor in place of the alias ids

WHEN `phax agent setup providers --write` removes a retired `phax-mistral-medium-3.5-*` id from a family THE system SHALL list `mistral-medium-3.5` with efforts `off` and `high` in that family, once, unless the family already lists it.

### 5.9 `modelEnvVar` is refused by name

IF a provider entry in `~/.phax/providers.json` carries `modelEnvVar` THEN the system SHALL refuse the file, naming the field's path and `phax agent setup providers --write`.

### 5.10 The rewrite drops `modelEnvVar`

WHEN `phax agent setup providers --write` reads a `providers.json` whose entries carry `modelEnvVar` THE system SHALL write the file back without that field and report each field it dropped.

### 5.11 Routing edges on retired ids are refused

IF `~/.phax/model-routing.json` keys an equivalence on a retired id THEN the system SHALL refuse the file, naming each such id and, for a `phax-mistral-medium-3.5-*` id, `mistral-medium-3.5` as the key to use instead.

### 5.12 Version floor 3.1.3

IF the installed `vibe` reports a version older than 3.1.3 THEN the system SHALL refuse before any Vibe session spawns, naming the installed version, 3.1.3 and `uv tool upgrade mistral-vibe`.

### 5.13 phax never writes Vibe's config

The system shall never write, back up or append to any file under Vibe's home directory (`~/.vibe` or `$VIBE_HOME`), and shall never read it to choose a model or a thinking level.

### 5.14 The alias installer is gone

The system shall offer no `phax agent setup mistral-vibe` command, so that invoking it fails as an unknown command and `phax agent setup` lists only its remaining subcommands.

### 5.15 The fresh-start command names the model by variable

WHEN a review stop of a Vibe phase builds its fresh-start command THE system SHALL set `VIBE_ACTIVE_MODEL` to the phase's catalog model (`mistral-medium-3.5`) in that command's environment and pass neither `--model` nor `--thinking`.

### 5.16 The stop says the TUI ignores the phase's level

WHEN a review stop of a Vibe phase prints its fresh-start command THE system SHALL print beside it that the interactive session starts at the model's default thinking level, naming the phase's resolved level.

### 5.17 Records name the new model id

The system shall record `mistral-medium-3.5` as the model of every Vibe run, phase and authoring record written from now on, and shall read records that name a `phax-mistral-medium-3.5-*` id unchanged.

## 6. Surface

### cli: vibe headless invocation — normative

Summary: A new Vibe session phax starts runs on the model and thinking level phax chose, with no PHAX alias needed in your Vibe config.

before:

    VIBE_ACTIVE_MODEL=phax-mistral-medium-3.5-high VIBE_OUTSIDE_WORKDIR=deny VIBE_BYPASS_TOOL_PERMISSIONS=false VIBE_TOOLS='{…}' \
      vibe -p '<prompt>' --agent accept-edits --output streaming --output-dir <export-dir> --workdir <worktree>

    # resumed turn
    VIBE_ACTIVE_MODEL=phax-mistral-medium-3.5-high … \
      vibe -p '<prompt>' --agent accept-edits --output streaming --output-dir <export-dir> --workdir <worktree> --resume <session-id>

after:

    VIBE_OUTSIDE_WORKDIR=deny VIBE_BYPASS_TOOL_PERMISSIONS=false VIBE_TOOLS='{…}' \
      vibe -p '<prompt>' --agent accept-edits --model mistral-medium-3.5 --thinking high --output streaming --output-dir <export-dir> --workdir <worktree>

    # sealed completion
    vibe -p '<prompt>' --agent accept-edits --disabled-tools '*' --model mistral-medium-3.5 --thinking off --output streaming --workdir <cwd>

    # resumed turn: Vibe keeps the session's model and level
    VIBE_OUTSIDE_WORKDIR=deny … \
      vibe -p '<prompt>' --agent accept-edits --output streaming --output-dir <export-dir> --workdir <worktree> --resume <session-id>

### file: export.json (Vibe's turn export) — normative

Summary: phax accepts a confined Vibe turn only when its export reports the model phax asked for.

before:

    {
      "schema_version": 1,
      "vibe_version": "3.0.3",
      "config": { "active_model": "phax-mistral-medium-3.5-high", "outside_workdir": "deny", … },
      …
    }

after:

    {
      "schema_version": 1,
      "vibe_version": "3.1.3",
      "config": { "active_model": "mistral-medium-3.5", "outside_workdir": "deny", … },
      …
    }

### cli: refused Vibe turn (model mismatch) — indicative

Summary: A confined Vibe turn that ran under a model phax did not choose is refused, naming both models.

    ✗ vibe ran this turn under a config phax did not set (active_model is "mistral-large-4-0", phax set "mistral-medium-3.5", read from .phax/runs/<run>/phase-02/vibe-export/export.json), so its result is refused. A Vibe agent profile or a resumed session's restored agent can override phax's settings.

### config: ~/.phax/providers.json mistral-vibe entry — normative

Summary: The Vibe provider entry names Vibe's own `mistral-medium-3.5` model and no longer carries a model environment variable.

before:

    "mistral-vibe": {
      "enabled": true,
      "executable": "vibe",
      "modelEnvVar": "VIBE_ACTIVE_MODEL",
      "defaultAgent": "auto-approve",
      "families": {
        "mistral-medium": {
          "models": [
            { "id": "phax-mistral-medium-3.5-off", "efforts": ["off"], "status": "active" },
            { "id": "phax-mistral-medium-3.5-high", "efforts": ["high"], "status": "active" }
          ]
        }
      }
    }

after:

    "mistral-vibe": {
      "enabled": true,
      "executable": "vibe",
      "defaultAgent": "auto-approve",
      "families": {
        "mistral-medium": {
          "models": [
            { "id": "mistral-medium-3.5", "efforts": ["off", "high"], "status": "active" }
          ]
        }
      }
    }

### cli: refused providers.json (old Vibe entry) — indicative

Summary: An older providers.json is refused with the fields and model ids to change, and the one command that changes them.

before:

    ✗ Invalid providers.json at "/Users/me/.phax/providers.json":
    providers.mistral-vibe.modelEnvVar: Unexpected key

after:

    ✗ "/Users/me/.phax/providers.json" carries fields phax no longer reads:
      - providers.mistral-vibe.modelEnvVar: phax picks the Vibe model with --model
    Run `phax agent setup providers --write` to drop them, or delete them from the file.

    ✗ "/Users/me/.phax/providers.json" lists models phax no longer routes to:
      - phax-mistral-medium-3.5-off: phax runs Vibe's mistral-medium-3.5 with --thinking off
      - phax-mistral-medium-3.5-high: phax runs Vibe's mistral-medium-3.5 with --thinking high
    Run `phax agent setup providers --write` to drop them (it also enables every installed provider), or delete them from the file.

### cli: phax agent setup providers --write — indicative

Summary: One run of the setup command turns an older providers.json into one phax reads, listing `mistral-medium-3.5` in place of the alias ids.

before:

    $ phax agent setup providers --write
    Dropped models phax no longer routes to (1): phax-mistral-medium-3.5-max
    All providers already up-to-date.

after:

    $ phax agent setup providers --write
    Dropped models phax no longer routes to (2): phax-mistral-medium-3.5-off, phax-mistral-medium-3.5-high
    Listed in their place: mistral-medium-3.5 (off, high)
    Dropped fields phax no longer reads (1): providers.mistral-vibe.modelEnvVar
    All providers already up-to-date.
    Backup written to: /Users/me/.phax/providers.json.phax-backup-1763450000000

    $ phax agent setup providers --write --json
    { "retiredRemoved": ["phax-mistral-medium-3.5-off", "phax-mistral-medium-3.5-high"], "retiredReplaced": ["mistral-medium-3.5"], "fieldsDropped": ["providers.mistral-vibe.modelEnvVar"], … }

### config: ~/.phax/model-routing.json equivalence — normative

Summary: Your routing table keys Vibe's edges on `mistral-medium-3.5`; one still keyed on an old alias id is refused instead of silently never routing to Vibe.

before:

    "equivalence": {
      "phax-mistral-medium-3.5-off":  { "off":  { "claude": "claude-haiku-4-5-20251001", "effort": "none", "relation": "equivalent" } },
      "phax-mistral-medium-3.5-high": { "high": { "claude": "claude-sonnet-4-6", "effort": "high", "relation": "equivalent" } }
    }

after:

    "equivalence": {
      "mistral-medium-3.5": {
        "off":  { "claude": "claude-haiku-4-5-20251001", "effort": "none", "relation": "equivalent" },
        "high": { "claude": "claude-sonnet-4-6",         "effort": "high", "relation": "equivalent" }
      }
    }

    # a file still keyed on an old id:
    ✗ "/Users/me/.phax/model-routing.json" keys equivalence edges on models phax no longer routes to:
      - phax-mistral-medium-3.5-high: use mistral-medium-3.5
    Rename the key, keeping its edges, or delete the file to use phax's built-in table.

### cli: phax agent setup mistral-vibe — indicative

Summary: phax no longer installs model aliases into your Vibe config; the command is gone.

before:

    $ phax agent setup mistral-vibe --install-model-aliases
    Appended 2 alias(es) to /Users/me/.vibe/config.toml:
      + phax-mistral-medium-3.5-off
      + phax-mistral-medium-3.5-high
    Backup written to: /Users/me/.vibe/config.toml.phax-backup-1763450000000

after:

    $ phax agent setup mistral-vibe
    ✗ unknown command "mistral-vibe" for "phax agent setup"
    $? = 2

### cli: Vibe fresh-start command at a review stop — normative

Summary: The interactive Vibe session a stop offers runs Vibe's own `mistral-medium-3.5` model, with no PHAX alias needed.

before:

    cd '<worktree>' && VIBE_ACTIVE_MODEL='phax-mistral-medium-3.5-high' 'vibe' '--workdir' '<worktree>' 'Read .phax-context/interactive-review.md, then review phase-02 with me.'

after:

    cd '<worktree>' && VIBE_ACTIVE_MODEL='mistral-medium-3.5' 'vibe' '--workdir' '<worktree>' 'Read .phax-context/interactive-review.md, then review phase-02 with me.'

### cli: Vibe fresh-start note — indicative

Summary: A stop tells you that the interactive Vibe session starts at the model's default thinking level, not the phase's.

    Start a fresh Vibe session:
      cd '<worktree>' && VIBE_ACTIVE_MODEL='mistral-medium-3.5' 'vibe' '--workdir' '<worktree>' '…'
      Vibe's interactive mode takes no --thinking: this session starts at mistral-medium-3.5's default thinking level, not the phase's level (off).

### cli: Vibe version refusal — normative

Summary: phax refuses a Vibe older than 3.1.3 before any session starts, and says how to upgrade.

before:

    ✗ mistral-vibe 3.0.2 is installed; phax needs 3.0.3 or later.
    Upgrade it: uv tool upgrade mistral-vibe

after:

    ✗ mistral-vibe 3.1.2 is installed; phax needs 3.1.3 or later.
    Upgrade it: uv tool upgrade mistral-vibe

### file: docs/upgrading.md — indicative

Summary: The upgrade notes tell a Vibe user the three steps to take: upgrade Vibe, rewrite providers.json, and optionally delete the PHAX alias blocks.

    ### 0.41.0

    - **phax picks the Vibe model with `--model` and `--thinking`, and needs mistral-vibe 3.1.3.** Run `uv tool upgrade mistral-vibe`.
    - **Run `phax agent setup providers --write` once.** It lists `mistral-medium-3.5` in place of `phax-mistral-medium-3.5-off` and `-high` and drops `modelEnvVar`; phax refuses the old file until you do.
    - **A `model-routing.json` keyed on the old ids is refused.** Rename each key to `mistral-medium-3.5`, keeping its edges.
    - **`phax agent setup mistral-vibe` is gone, and phax no longer reads `~/.vibe/config.toml`.** The `# Added by PHAX.` blocks still work in your own Vibe sessions. To remove them, delete each comment line and the `[[models]]` table under it.
    - Run, phase and authoring records written before keep the old model ids.

## 7. Non-goals

- Mistral Large 4 (`mistral-large-4-0`), any other Vibe model or family, and re-pointing routing defaults by cost.
- Vibe's `--time-limit`, `--max-tokens` and `--max-price` flags, and the export's `warnings` (denied tool calls).
- Vibe's new hook kinds (`pre_agent`, `pre_llm`, `post_llm`, `session_start`).
- Editing or deleting the user's PHAX alias blocks: phax neither removes them nor reports them. The upgrade notes say how to delete them by hand.
- Interactive resume for Vibe, and any `--model`/`--thinking` support in Vibe's TUI.
- Changing the secure-mode confinement: `--agent accept-edits`, the `VIBE_*` variables, `VIBE_TOOLS` and the existing refusals stay as they are.
- Checking a requested thinking level against Vibe's model table. A level an agent profile or the admin config fixes is Vibe's own usage error.
- Rewriting records written before this change, or any change to a persisted format (run, phase, authoring, cost history, stop record).
- Comparing the model of an unconfined (unsafe) Vibe turn, which phax does not read back today either.
- Scaffolding or rewriting `model-routing.json` for the user: `--with-routing` still never overwrites.

## 8. Acceptance criteria

### A phase's first turn picks model and level by flag

Given a secure Vibe phase that routing resolved to `mistral-medium-3.5` at effort `high`, when its first headless turn spawns, then the argv contains `--model mistral-medium-3.5` and `--thinking high`, and the spawned environment has no `VIBE_ACTIVE_MODEL`. (refs §5.1, §5.3)

### Every new-session kind carries the flags

Given an authoring session, a code-review session, a compliance-review session, a decide session, an extraction session and a sealed completion, each routed to Vibe at `mistral-medium-3.5`/`off`, when each spawns, then each argv contains `--model mistral-medium-3.5 --thinking off`, and no spawned environment has `VIBE_ACTIVE_MODEL`. (refs §5.1, §5.3)

### A resumed turn carries neither flag

Given a Vibe phase whose session `S` ran its first turn, when a fix-loop turn resumes it, then the argv contains `--resume S` and neither `--model` nor `--thinking`, and the environment has no `VIBE_ACTIVE_MODEL`. (refs §5.2, §5.3)

### A turn under another model is refused

Given a confined Vibe turn for which phax resolved `mistral-medium-3.5` and whose `export.json` reports `config.active_model` `"mistral-large-4-0"`, when the turn ends, then its result is refused, the message names `active_model`, `"mistral-large-4-0"`, `"mistral-medium-3.5"` and the export path, and the phase records no answer from that turn. (refs §5.4)

### A turn under the chosen model is accepted

Given a confined resumed Vibe turn whose `export.json` reports `config.active_model` `"mistral-medium-3.5"`, the model phax resolved for the session, when the turn ends with an answer, then the answer is accepted. (refs §5.4)

### Real Vibe runs both levels without PHAX aliases

Given Mistral Vibe 3.1.3 with `MISTRAL_API_KEY` set and a `VIBE_HOME` whose `config.toml` holds no PHAX alias blocks, when phax runs one secure session at `mistral-medium-3.5`/`off` and one at `mistral-medium-3.5`/`high`, then both complete, each `export.json` reports `config.active_model` `"mistral-medium-3.5"`, and the `config.toml` bytes are unchanged. (refs §5.1, §5.5, §5.13)

### Real Vibe resume keeps the model

Given a real Vibe 3.1.3 session that phax started at `mistral-medium-3.5`/`high`, when phax resumes it with `--resume` and neither flag, then the resumed turn's `export.json` reports `config.active_model` `"mistral-medium-3.5"` and phax accepts the turn. (refs §5.2, §5.4)

### An older Vibe is refused before spawning

Given a `vibe` executable that prints `vibe 3.1.2` for `--version`, when phax is about to start any Vibe session, then it refuses with `mistral-vibe 3.1.2 is installed; phax needs 3.1.3 or later.` and `Upgrade it: uv tool upgrade mistral-vibe`, and no session process is spawned. (refs §5.12)

### Claude requests reach the new id

Given no `~/.phax/providers.json` or `~/.phax/model-routing.json` and `mistral-vibe` first in provider priority and enabled, when phax resolves a `claude-sonnet-4-6`/`high` request and a `claude-haiku-4-5-20251001`/`none` request, then they resolve to `mistral-vibe`, `mistral-medium-3.5` at `high` and at `off`, both `equivalent`, and the built-in `mistral-medium` family lists exactly `mistral-medium-3.5` with efforts `off`, `high`. (refs §5.5, §5.6)

### A providers.json with the alias ids is refused

Given a `~/.phax/providers.json` without `modelEnvVar` whose `mistral-medium` family lists `phax-mistral-medium-3.5-off` and `phax-mistral-medium-3.5-high`, when `phax run` loads it, then it refuses before any session spawns, naming both ids and `phax agent setup providers --write`. (refs §5.7)

### The rewrite lists mistral-medium-3.5 in their place

Given that same `providers.json`, when `phax agent setup providers --write` runs, then the rewritten `mistral-medium` family lists exactly `{ "id": "mistral-medium-3.5", "efforts": ["off", "high"], "status": "active" }`, the output names both dropped ids and `mistral-medium-3.5`, and a backup of the old file exists. (refs §5.8)

### A providers.json with modelEnvVar is refused by name

Given a `~/.phax/providers.json` whose `mistral-vibe` entry carries `"modelEnvVar": "VIBE_ACTIVE_MODEL"`, when `phax run` loads it, then it refuses, naming `providers.mistral-vibe.modelEnvVar` and `phax agent setup providers --write`. (refs §5.9)

### One rewrite fixes a pre-upgrade providers.json

Given a `~/.phax/providers.json` as an older phax wrote it, with `modelEnvVar` and the two alias ids, when `phax agent setup providers --write` runs and then `phax run` loads the file, then the rewritten file has no `modelEnvVar` and lists `mistral-medium-3.5`, the output names the dropped field, and the load succeeds. (refs §5.10, §5.8)

### A routing table keyed on an alias id is refused

Given a `~/.phax/model-routing.json` whose `equivalence` has a key `phax-mistral-medium-3.5-high`, when phax loads it, then it refuses, naming `phax-mistral-medium-3.5-high` and `mistral-medium-3.5`. (refs §5.11)

### A Vibe run leaves Vibe's home untouched

Given a `VIBE_HOME` holding a `config.toml`, with or without PHAX alias blocks, when phax runs a Vibe phase to its review stop, then no file under `VIBE_HOME` was created or modified, and no `*.phax-backup-*` file exists there. (refs §5.13)

### The alias installer is gone

Given this release of phax, when `phax agent setup mistral-vibe` runs, then it exits non-zero as an unknown command, and `phax agent setup --help` lists no `mistral-vibe` subcommand. (refs §5.14)

### The fresh start names mistral-medium-3.5 by variable

Given a Vibe phase at `mistral-medium-3.5`/`off` that reaches a review stop, when the stop prints and records its fresh-start command, then the command's environment is `{ "VIBE_ACTIVE_MODEL": "mistral-medium-3.5" }`, and its argv contains neither `--model` nor `--thinking`. (refs §5.15)

### The stop warns the TUI ignores the phase's level

Given the same stop, when its instructions are printed, then next to the fresh-start command they say the interactive session starts at the model's default thinking level and name the phase's level `off`, and the stop record's command keeps exactly the fields `cwd`, `argv`, `env`. (refs §5.16)

### New records name the new id; old ones still read

Given a run recorded before this change whose phase names `phax-mistral-medium-3.5-high`, and a new run that completes a Vibe phase, when phax reads both runs' records and their cost history, then the new phase record names `mistral-medium-3.5`, the old one still reads `phax-mistral-medium-3.5-high` without error, and the cost history sums both. (refs §5.17)

## 9. Open questions

### q-setup-command — What happens to `phax agent setup mistral-vibe`?

- remove — Remove the command; the upgrade notes say how to delete the PHAX alias blocks by hand — abandons: Any in-product signal to a user who still has PHAX alias blocks in their Vibe config that phax no longer uses them
- report — Keep it as a read-only report of leftover PHAX alias blocks — abandons: The guiding rule that phax never reads Vibe's home: a phax command keeps parsing `~/.vibe/config.toml` only to tell users about blocks that still work and harm nothing
- remover — Turn it into a remover of the PHAX alias blocks — abandons: The promise that phax never writes Vibe's config: phax would edit the user's file once more, with backup and parsing risk, for blocks the user may now rely on in their own sessions

Recommendation: remove — The leftover blocks are harmless: they still work in the user's own Vibe sessions and phax ignores them. The lost signal is therefore cheap, and one upgrade-notes entry replaces it. Both alternatives keep phax in Vibe's home directory, which is exactly what this change exists to end.

### q-fresh-start — What does the interactive fresh-start command carry, given that Vibe's TUI takes neither `--model` nor `--thinking`?

- env-model — Keep `VIBE_ACTIVE_MODEL=mistral-medium-3.5` in the command, and print a note that the thinking level is the model's default, naming the phase's level — abandons: A headless-path purity: one place still selects the model through an environment variable, and a phase at `off` reopens interactively at Vibe's default level
- no-model — Print the command with no model at all — abandons: Model continuity: the person reviewing lands on Vibe's default model, now `mistral-large-4-0`, which is a different model, price and behaviour from the phase they are reviewing

Recommendation: env-model — Reviewing a phase on a different model than the one that wrote it is the worse loss, and it is silent. A thinking-level mismatch is named in the note, and the person can change it in the TUI. `VIBE_ACTIVE_MODEL` is Vibe's documented override, not a phax alias, so keeping it costs nothing in Vibe's home.

### q-model-env-var — Does `modelEnvVar` stay in the provider entry schema?

- drop — Drop the field: an old file carrying it is refused by name and `phax agent setup providers --write` rewrites it — abandons: Configurability of the TUI's model variable name: if Vibe renamed `VIBE_ACTIVE_MODEL`, the fix would be a phax release, not a config edit
- keep-for-tui — Keep the field, used only by the fresh-start command — abandons: A config surface that means what it says: a field named for model selection that the headless path ignores, kept for one interactive command, on Vibe only

Recommendation: drop — Vibe was the field's only user, and the variable is Vibe's own documented name, so the fresh-start command can name it itself. A Vibe rename would need a phax release anyway, for the flags. Dropping it follows the no-shim policy: the old file is refused and rewritten by the existing command.

### q-thinking-check — After a confined turn, does phax compare the thinking level as well as the model?

- model-only — Compare `config.active_model` only; trust `--thinking` and Vibe's own refusal of a profile-fixed level — abandons: Detection of a turn that ran at a level phax did not ask for without Vibe refusing it, for example a resumed session that restored another level
- model-and-level — Also compare the thinking level, from the export field that records it — abandons: A contract pinned on a field nobody has seen: no export read for this spec shows a thinking level, so the plan would have to find the field and might find there is none

Recommendation: model-only — A level fixed by a profile or by the admin config already makes Vibe exit with a usage error, so the silent case is narrow. The model is the costly and visible substitution, and `active_model` is known to be in the export. If a real 3.1.3 export does show the level, a later change can add the comparison against a field it has seen.

### q-retired-successor — When `phax agent setup providers --write` drops the two alias ids, does it list `mistral-medium-3.5` in their place?

- replace — List `mistral-medium-3.5` (off, high) in the family the alias ids leave — abandons: The rewrite's narrow role of only removing what phax retired: it now also adds a catalog entry the user did not write
- drop-only — Only drop them, as for the earlier retired aliases — abandons: Vibe routing for every upgraded user: their `mistral-medium` family empties and is dropped, so Vibe is never chosen again until they hand-edit the file, with nothing telling them so

Recommendation: replace — Dropping only turns the one documented fix into a silent loss of the provider. The added entry is exactly the built-in one, so the user ends up with what a fresh install would have.

### q-routing-file — What does phax do with a `model-routing.json` whose equivalence is keyed on a retired id?

- refuse — Refuse it, naming each id and `mistral-medium-3.5` as the key to use — abandons: Uninterrupted runs for a user whose table also carries edges for the earlier retired `-low`/`-medium`/`-max` ids, which were harmless until now
- ignore — Leave it as is: edges on ids that are not in the catalog are never selected — abandons: Vibe routing for any user with a scaffolded routing table: no edge points at `mistral-medium-3.5`, so hub-to-spoke never picks Vibe, and nothing says why

Recommendation: refuse — A silent loss of a provider is the failure this change must not introduce, and the refusal names its own fix. Edges on the earlier retired ids were dead weight, so refusing them costs one rename or deletion.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- New headless Vibe sessions pass `--model <model> --thinking <effort>`. Resumed turns pass neither, and Vibe keeps the session's model and level.
- No `VIBE_ACTIVE_MODEL` on any headless turn.
- phax never writes `~/.vibe/config.toml`: the alias installer goes, with its backup, its retired-alias report and its JSON answer fields (`installModelAliases`, `aliasesAdded`, `aliasesSkipped`, `aliasesRetired`, `backupPath`).
- The `mistral-medium` family lists one model, `mistral-medium-3.5`, with efforts `off` and `high`. `phax-mistral-medium-3.5-off` and `-high` join `RETIRED_MODEL_IDS`, and the equivalence edges move to the new id, edge for edge.
- The Vibe version floor is 3.1.3, enforced before any session spawns, like the 3.0.3 floor today.
- Mistral Large 4 is a separate change.
- The requirements follow each open question's recommendation. A different decision revises the matching requirement and criterion.

Left open:

- Where `--model`/`--thinking` sit in the argv. Tests check presence and values, not position.
- The final wording of the refusals, the setup output and the fresh-start note, and the JSON field names `setup providers --json` adds for replaced ids and dropped fields.
- Whether a real 3.1.3 export records the thinking level, and under which field. Record the finding in the plan whichever way q-thinking-check is decided.
- The release number of the upgrade entry. 0.41.0 assumes this ships in the next release after 0.40.0.

Constraints:

- No back-compat shims. An old `providers.json` or `model-routing.json` is refused and fixed by the existing setup command or by hand, never read leniently. Only `phax agent setup providers` may read the old `providers.json` shape, and only to rewrite it.
- phax never reads Vibe's home directory to choose a model. The flags, Vibe's own table and the export are the whole contract. The existing `accept-edits.toml` override check is confinement, not model choice, and stays.
- The secure-mode confinement is unchanged: `--agent accept-edits`, the `VIBE_*` variables, `VIBE_TOOLS` and the refusals. The model check joins the existing post-turn comparison and keeps its scope: confined turns only.
- Before relying on it, verify on a real 3.1.3 export that `config.active_model` holds the alias passed to `--model`, including with Mistral's model catalog on.
- The persisted stop command stays `{ cwd, argv, env }`. The fresh-start note is printed text only.
- The real-CLI e2e (`tests/e2e/vibeSecure.test.ts`) moves off the alias path. It covers `off`, `high`, a resumed turn and a `VIBE_HOME` without PHAX blocks; the `MISTRAL_API_KEY` case stays skippable.
- Docs to update: `docs/model-catalog.md` (catalog entry and a change-log line), `docs/model-routing.md` (examples, providers entry, Vibe setup steps), the README's Vibe setup (drop the installer line, add the 3.1.3 floor) and a `docs/upgrading.md` entry. Earlier upgrade entries that mention the installer stay as history.

## 11. Docs page

Page: docs/model-routing.md, its Mistral Vibe setup section

Reader: An operator turning on Mistral Vibe for phax, or upgrading a setup that used the PHAX alias blocks

Example: uv tool upgrade mistral-vibe          # phax needs 3.1.3 or later
phax agent setup providers --write    # enables vibe; lists mistral-medium-3.5, drops modelEnvVar and the old alias ids

# phax then runs each new Vibe session as:
vibe -p '<prompt>' --agent accept-edits --model mistral-medium-3.5 --thinking high --output streaming …
# and nothing in ~/.vibe/config.toml is needed or touched.
