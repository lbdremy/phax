---
status: Draft
date: 2026-11-24
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Mistral Large 4 in the catalog, and a disabled provider never runs

## 1. Context

phax routes every plan phase and every agent job (code review, compliance review, spec and plan authoring and revise, decide verdicts) through one routing layer. A request names a model id and an effort. The provider catalog (`~/.phax/providers.json`, else the built-in one) lists each provider's families and entries. The routing table (`~/.phax/model-routing.json`, else the built-in one) orders the providers (`mistral-vibe`, `codex-cli`, `claude-code` by default) and stores the cross-provider equivalence edges, all stated hub-centric: spoke id + effort → Claude id + effort + relation.

The only Mistral entry is `mistral-medium-3.5`, in the `mistral-medium` family, with efforts `off` and `high`. Its `off` edge anchors Claude Haiku 4.5 at `none`, its `high` edge Claude Sonnet 4.6 at `high`. On every axis that scores both, it sits level with Claude Haiku 4.5 (ECI 141.6 vs 142.7; Vals SWE-bench Verified 66.4% vs 66.6%), so its `high` edge to Sonnet 4.6 (ECI 152.9) overstates it.

Mistral Large 4 (`mistral-large-4-0`) is Vibe 3.1.3's default model, served on the Mistral Pro subscription. Vibe's built-in table lists `thinking_levels = ["low", "medium", "high"]`, default `high`, $0.70 / $2.10 / $0.07 (cached input) per million tokens, a 1,048,576-token context. A real call per level on 2026-11-24 (`vibe -p … --model mistral-large-4-0 --thinking <level> --max-turns 1`) answered for `off`, `low`, `medium` and `high`, and got HTTP 400 `reasoning_effort … is not supported for this model, supported values: [high, low, medium]` for `xhigh` and `max`. Vibe's export records the level asked for under `config.models.mistral-large-4-0.thinking`.

Where it sits: on the Epoch Capabilities Index it scores 154.6 (CI 151.8–157.4), tied with Opus 4.5 (151.9), Sonnet 4.6 (152.9) and Opus 4.6 (156.3), below every Claude 5.x model read (Opus 4.8 159.9, Haiku 5.5 160.3, Sonnet 5.5 166.6). On AA Intelligence Index v5.0.1 it scores 26 at `high` and 23 at `medium`; on AA's Coding Agent Index, Vibe + `high` scores 40.6 ($1.34/task). AA re-scaled its index again in v5.0.1, so the Claude figures in the catalog record are from an older scale.

It already did real work for phax: the 2026-11-23 security audit ran on it at `high`, outside phax, because a plan cannot name it: preflight answers `model id "mistral-large-4-0" not found in catalog`. A configured job is not preflighted at all: with Vibe enabled, a job naming `mistral-large-4-0` today resolves by the `mistral` substring to `mistral-medium-3.5`.

The operator settled on 2026-11-24: routing to Large 4 is explicit (a phase or a job names it; a current Claude request never reaches it by equivalence); its edges state its level honestly, the Claude 4.x generation; the ECI picks the anchoring Claude generation and model, AA's Intelligence Index places efforts within one read, and the Coding Agent Index checks the harness phax runs.

Ground read:

- `docs/model-catalog.md` — The catalog decision record: sources of truth (Vibe: a real call per level), the single mistral-vibe entry `mistral-medium-3.5` (efforts `off`, `high`), hub-centric anchors and their rules, the cost table and default-per-job rule, the refresh checklist and log.
- `src/domain/routing/defaults.ts` — DEFAULT_PROVIDER_CONFIG lists mistral-vibe with one family `mistral-medium` and one entry; DEFAULT_MODEL_ROUTING puts `mistral-vibe` first in providerPriority and anchors `mistral-medium-3.5` `off` → Haiku 4.5 `none`, `high` → Sonnet 4.6 `high`.
- `src/domain/routing/resolve.ts` — resolveModel skips disabled providers in its priority loop (:384), then always calls terminalClaudeCode (:403), which never reads `enabled` and ends on `defaulted to claude-code/claude-sonnet`. resolveFamily maps any unknown id containing `mistral` to `mistral-medium` (:35), and pickActiveEntry resolves it to that family's first active entry: today `mistral-large-4-0` resolves to `mistral-medium-3.5` as `equivalent` when Vibe is enabled.
- `src/domain/routing/preflight.ts` — Plan phases only: an id outside the catalog fails with `model id "…" not found in catalog` (:94); a disabled provider fails unless an enabled provider has a permitted cross-family edge (:120-133).
- `src/domain/routing/catalog.ts` — hubToSpoke returns the first exact edge in table order and skips deprecated spokes; spokeToHub ignores status, so a deprecated spoke keeps its fallback edges.
- `src/app/loadRouting.ts` — A ~/.phax/providers.json on disk replaces the built-in catalog wholesale; a ~/.phax/model-routing.json replaces the built-in routing table.
- `src/domain/routing/providerSetup.ts` — `phax agent setup providers --write` enables installed providers and replaces retired ids, but never adds a built-in entry the file lacks.
- `src/schemas/phaxConfig.ts` — Job defaults: authoring and decide `claude-opus-5-5` high, verdicts and compliance `claude-sonnet-5-5` medium, extraction `claude-haiku-5-5`, code review `claude-opus-5-5` high; `review.code`, `review.compliance`, `authoring.spec|plan` and `agent.extractPlan` take a model and effort.
- `src/schemas/modelRouting.ts` — The family vocabulary (ModelFamilySchema) shared by model-routing.json, `phax agent resolve` output and telemetry.
- `src/cli/definitions/agent.ts` — `phax agent resolve --model --effort` prints the requested and selected provider, family, thinking, concrete model, relationship and reason.
- `.claude/skills/phax-planning/SKILL.md` — The planner's generated catalog table (Id | Family | Status | Efforts), rendered by `pnpm gen:model-catalog`.
- `docs/model-routing.md` — Resolution algorithm, the preflight rules, and the claim that disabling a provider makes resolution skip it.
- `README.md` — Models and providers, and the Vibe paragraph under Security modes; exit code 11 is the security or preflight refusal.
- `docs/briefs/single-provider.md` — Depends on this spec for the disabled-provider fix; owns decide and extraction on Vibe, the Vibe cost ledger and task floors.

## 2. Problem

An operator cannot run the Mistral model they pay for through phax. A plan naming `mistral-large-4-0` fails preflight. A job naming it runs on a different model, `mistral-medium-3.5`, without saying so.

The Mistral model phax does list sits a generation below its anchors.

A disabled provider still runs. resolveModel skips a disabled provider in its priority loop, then hands the request to its terminal Claude fallback, which never reads `enabled`. Its last resort is `No matching provider …; defaulted to claude-code/claude-sonnet.` Only plan phases are guarded, by preflight. So a job configured on Mistral with Vibe disabled runs on Claude without an error, and it still runs on Claude when Claude is the provider the operator disabled. The `enabled` switch in providers.json does not mean what it says.

An install that has Vibe enabled always has a providers.json, because that is where `enabled` lives. That file replaces the built-in catalog, and `phax agent setup providers --write` never adds an entry it lacks. A model added to the built-in catalog therefore never reaches the operators who could run it.

## 3. Product goal

phax lists Mistral Large 4 as `mistral-large-4-0`, with the efforts the Mistral API serves. A plan phase or a configured job that names it runs it on Vibe and records the model, the effort and the cost. Its equivalence edges place it honestly in the Claude 4.x generation, so a request for a current Claude model never reaches it. No phase or job ever starts a session on a provider the operator disabled: when no enabled provider can serve a request, phax refuses it before any work and names the request, the disabled provider and the setting that enables it.

> phax runs a model only on a provider the operator enabled, and runs Mistral Large 4 only where someone named it.

## 4. Terminology

- **Mistral Large 4 / `mistral-large-4-0`** — Mistral's model behind Vibe's built-in alias `mistral-large-4-0` (display name "Mistral Large 4"). phax passes the id with Vibe's `--model` and the effort with `--thinking`.
- **catalog** — The provider catalog: per provider, its families and their entries (`id`, `efforts`, `status`). The built-in one is used unless `~/.phax/providers.json` exists, which then replaces it entirely.
- **family** — A named line of models in the catalog (`claude-sonnet`, `mistral-medium`, …). Entries inside a family run newest first, and the first active entry is what an alias or an unrecognised id of that family resolves to.
- **effort** — The reasoning level a request asks for (`none`, `off`, `low`, `medium`, `high`, `xhigh`, `max`, `ultracode`, `ultra`). For Vibe it is passed as `--thinking`. A catalogued effort is one listed on the entry.
- **edge** — One equivalence row of the routing table: spoke id + spoke effort → Claude id + Claude effort + relation (`equivalent`, `upgrade`, `downgrade`), stated from the Claude side. Read Claude → spoke as written, spoke → Claude inverted.
- **anchor** — The Claude id and effort a spoke edge points to.
- **Claude 4.x / 5.x generation** — 4.x: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-8`. 5.x, the current models: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-sonnet-5`, `claude-opus-5-5`, `claude-opus-5`, `claude-fable-5-1`, `claude-fable-5`.
- **routed job** — An agent session other than a plan phase that phax resolves through the routing layer: code review, compliance review, spec and plan authoring and revise, decide verdicts, and decide and plan extraction wherever they consult routing.
- **configured job** — A routed job whose model and effort come from `phax.json` (`review.code`, `review.compliance`, `authoring.spec`, `authoring.plan`, `agent.extractPlan`) or from a job's `--model`/`--effort` flags.
- **enabled provider** — A provider whose providers.json entry has `"enabled": true`. A disabled provider is one with `"enabled": false`, or with no entry at all.
- **terminal fallback** — `claude-code` taking a request that no provider earlier in `providerPriority` served.
- **serve a request** — An enabled provider can run the request: natively in its own family, through a permitted edge (one `allowDowngrade` allows), or as the terminal fallback.
- **ECI** — Epoch Capabilities Index (`epoch.ai/data/eci_scores.csv`): one score per model, on one scale across generations.
- **AA Intelligence Index / Coding Agent Index** — Artificial Analysis's per-effort model score (v5.0.1, comparable only within one read) and its score of a model in its own agent harness (v2.1).

## 5. Functional requirements

### 5.1 Catalog entry

The built-in catalog shall list `mistral-large-4-0` as an active `mistral-vibe` entry whose efforts are exactly `low`, `medium` and `high`.

### 5.2 Unserved efforts refused

IF a plan phase names `mistral-large-4-0` at an effort outside its catalogued efforts THEN `phax plans lint` and the run-start preflight SHALL refuse the phase, naming the efforts the entry supports.

### 5.3 Plans can name it

WHEN `phax plans lint` checks a phase naming `mistral-large-4-0` at a catalogued effort while `mistral-vibe` is enabled THE system SHALL accept that phase's model and effort.

### 5.4 A phase runs it on Vibe

WHEN a phase naming `mistral-large-4-0` runs while `mistral-vibe` is enabled THE system SHALL run the phase with Vibe on `mistral-large-4-0`, with the phase's effort as Vibe's thinking level.

### 5.5 Model, effort and cost recorded

WHEN a phase that ran on `mistral-large-4-0` ends THE system SHALL record the provider, the model id, the effort and Vibe's cost in USD in the phase's record.

### 5.6 A configured job runs it on Vibe

WHERE a configured job names `mistral-large-4-0` and `mistral-vibe` is enabled THE system SHALL run that job with Vibe on `mistral-large-4-0` at the configured effort, never on another Mistral model.

### 5.7 Explicit routing only

IF a request names a Claude 5.x model THEN the system SHALL NOT select `mistral-large-4-0` for it, at any effort, whatever the provider priority and `allowDowngrade`.

### 5.8 Honest edges

The built-in routing table shall give `mistral-large-4-0` one edge per catalogued effort, each anchored on a Claude 4.x model, with the relation the recorded ECI read supports.

### 5.9 A disabled provider never runs

IF a provider is disabled THEN the system SHALL NOT start an agent session on it for any plan phase or routed job.

### 5.10 Claude fallback while enabled

WHILE `claude-code` is enabled THE system SHALL keep it as the terminal fallback for a request that no earlier provider in `providerPriority` serves.

### 5.11 Refusal names the way out

IF no enabled provider can serve a request THEN the system SHALL refuse it before starting any agent session, naming the request (the phase or job, its model and its effort), each disabled provider that would have served it, and the setting that enables a provider.

### 5.12 Jobs checked at run start

WHEN `phax run` or `phax resume` starts THE system SHALL check the code-review and compliance-review jobs the run will route along with its phases, and refuse the run before any agent or git work if one of them cannot be served.

### 5.13 Job defaults stay on Claude

The built-in defaults for code review, compliance review, spec and plan authoring, plan adjustment, plan extraction, decide and decide verdicts shall stay the Claude models and efforts they are today.

### 5.14 Planner sees the id

The planner's generated catalog table shall list `mistral-large-4-0` with its family, status and efforts, while the planning skill's default phase assignment keeps naming only Claude models.

### 5.15 Existing providers.json learns the id

WHEN `phax agent setup providers --write` rewrites a providers.json whose listed provider lacks a built-in catalog entry THE system SHALL add that entry and name it in its report, leaving every entry already listed as it is.

## 6. Surface

### config: ~/.phax/providers.json — mistral-vibe catalog — normative

Summary: `mistral-large-4-0` appears in the catalog with the efforts `low`, `medium` and `high`, so a plan or a job can name it.

before:

    "mistral-vibe": {
      "enabled": false,
      "executable": "vibe",
      "defaultAgent": "auto-approve",
      "families": {
        "mistral-medium": {
          "models": [{ "id": "mistral-medium-3.5", "efforts": ["off", "high"], "status": "active" }]
        }
      }
    }

after:

    "mistral-vibe": {
      "enabled": false,
      "executable": "vibe",
      "defaultAgent": "auto-approve",
      "families": {
        "mistral-large": {
          "models": [{ "id": "mistral-large-4-0", "efforts": ["low", "medium", "high"], "status": "active" }]
        },
        "mistral-medium": {
          "models": [{ "id": "mistral-medium-3.5", "efforts": ["off", "high"], "status": "deprecated" }]
        }
      }
    }

### config: ~/.phax/model-routing.json — equivalence — indicative

Summary: Mistral Large 4's edges place it beside Claude Sonnet 4.6, so it is reached only by naming it and falls back to a Claude model of its own level.

before:

    "equivalence": {
      "mistral-medium-3.5": {
        "off":  { "claude": "claude-haiku-4-5-20251001", "effort": "none", "relation": "equivalent" },
        "high": { "claude": "claude-sonnet-4-6", "effort": "high", "relation": "equivalent" }
      }
    }

after:

    "equivalence": {
      "mistral-large-4-0": {
        "low":    { "claude": "claude-sonnet-4-6", "effort": "low",    "relation": "equivalent" },
        "medium": { "claude": "claude-sonnet-4-6", "effort": "medium", "relation": "equivalent" },
        "high":   { "claude": "claude-sonnet-4-6", "effort": "high",   "relation": "equivalent" }
      },
      "mistral-medium-3.5": {
        "off":  { "claude": "claude-haiku-4-5-20251001", "effort": "none", "relation": "equivalent" },
        "high": { "claude": "claude-sonnet-4-6", "effort": "high", "relation": "equivalent" }
      }
    }

### cli: phax agent resolve --model mistral-large-4-0 — normative

Summary: Resolving `mistral-large-4-0` now selects Mistral Large 4 itself, where it used to pick Mistral Medium 3.5 by a name guess.

before:

    $ phax agent resolve --model mistral-large-4-0 --effort high
    Requested:        mistral-large-4-0 (mistral-medium) @ high
    Selected provider: mistral-vibe
    Selected family:  mistral-medium
    Selected thinking: high
    Concrete model:   mistral-medium-3.5
    Relationship:     equivalent
    Reason:           Provider priority selected mistral-vibe; mistral-medium/high (heuristic from "mistral-large-4-0") runs natively on mistral-vibe as mistral-medium-3.5/high (equivalent).

after:

    $ phax agent resolve --model mistral-large-4-0 --effort high
    Requested:        mistral-large-4-0 (mistral-large) @ high
    Selected provider: mistral-vibe
    Selected family:  mistral-large
    Selected thinking: high
    Concrete model:   mistral-large-4-0
    Relationship:     exact
    Reason:           Provider priority selected mistral-vibe; mistral-large/high runs natively on mistral-vibe as mistral-large-4-0/high (exact).

### cli: phax plans lint — mistral-large-4-0 phases — indicative

Summary: A plan can give a phase `mistral-large-4-0` at `low`, `medium` or `high`, and lint names those three when a phase asks for another effort.

before:

    $ phax plans lint docs/plans/2611241200-audit-plan.md
    ✗ phase "audit": model id "mistral-large-4-0" not found in catalog
    $? = 2

after:

    $ phax plans lint docs/plans/2611241200-audit-plan.md
    ✓ docs/plans/2611241200-audit-plan.md

    # a phase at xhigh:
    ✗ phase "audit": effort "xhigh" is not supported by mistral-large-4-0 (supports: low, medium, high)
    $? = 2

### config: phax.json — a job on Mistral Large 4 — normative

Summary: A review or authoring job can be configured to run on Mistral Large 4 by naming it.

    {
      "review": {
        "code": { "enabled": true, "model": "mistral-large-4-0", "effort": "high" },
        "compliance": { "enabled": true, "model": "mistral-large-4-0", "effort": "medium" }
      },
      "authoring": {
        "spec": { "model": "mistral-large-4-0", "effort": "high" }
      }
    }

### cli: refusal when no enabled provider serves a request — indicative

Summary: When every provider that could run a phase or job is disabled, phax stops before any work and says which providers to enable and where, instead of quietly running on Claude.

before:

    $ phax agent resolve --model mistral-medium-3.5 --effort high   # mistral-vibe and claude-code disabled
    Requested:        mistral-medium-3.5 (mistral-medium) @ high
    Selected provider: claude-code
    Selected family:  claude-sonnet
    Concrete model:   claude-sonnet-4-6
    Relationship:     equivalent

after:

    $ phax run docs/plans/2611241200-audit-plan.md   # mistral-vibe and claude-code disabled
    ✗ run refused before any work: no enabled provider can run
      review.code (mistral-large-4-0 @ high)
        mistral-vibe — disabled
        claude-code (fallback) — disabled
      Enable one: set "enabled": true under providers.<id> in ~/.phax/providers.json,
      or run `phax agent setup providers --write`.
    $? = 11

    $ phax agent resolve --model mistral-large-4-0 --effort high
    ✗ mistral-large-4-0 @ high: no enabled provider can run it (mistral-vibe disabled; claude-code disabled).
      Enable one in ~/.phax/providers.json, or run `phax agent setup providers --write`.
    $? = 11

### cli: phax agent setup providers --write — indicative

Summary: Rewriting providers.json now adds the catalog entries phax ships that the file is missing, and lists each one it added.

before:

    $ phax agent setup providers --write
    Enabled:   mistral-vibe
    Unchanged: claude-code, codex-cli
    Wrote ~/.phax/providers.json

after:

    $ phax agent setup providers --write
    Enabled:   mistral-vibe
    Unchanged: claude-code, codex-cli
    Added:     mistral-vibe/mistral-large-4-0 (low, medium, high)
    Wrote ~/.phax/providers.json

### file: .claude/skills/phax-planning/SKILL.md — catalog table — normative

Summary: Planners see `mistral-large-4-0` and its efforts in the model table the planning skill carries.

before:

    | `mistral-medium-3.5` | `mistral-medium` | active | `off` \| `high` |

after:

    | `mistral-large-4-0` | `mistral-large` | active | `low` \| `medium` \| `high` |
    | `mistral-medium-3.5` | `mistral-medium` | deprecated | `off` \| `high` |

## 7. Non-goals

- The catalog refresh that re-reads every other anchor on AA v5.0.1 and adds Claude Fable 5.2.
- Everything in the `single-provider` brief: decide and plan extraction on Vibe, a cost ledger and estimate for Vibe, planner doctrine per provider, task floors, whether a task may run on a lower generation than the plan's default.
- Changing any built-in job default or the planning skill's default phase assignment (`PHASE_MODEL_POLICY`) to a Mistral model.
- Reaching `mistral-large-4-0` by equivalence from any Claude 5.x request.
- A catalogued `xhigh` or `max` for Large 4: the API refuses both, and tbench.ai's "max" label is not a level the API serves.
- Retiring `claude-haiku-4-5-20251001`, even if its last stated reason to stay active goes.
- Interactive resume or pre-prompted sessions for Vibe.
- New persisted record fields: records already carry the model id and Vibe's `costUsd`.
- Rewriting a `model-routing.json` the operator keeps on disk: it keeps its own equivalence table.

## 8. Acceptance criteria

### The catalog lists Large 4

Given no `~/.phax/providers.json`, so the built-in catalog applies, when `phax agent models` runs, then it lists `mistral-large-4-0` under `mistral-vibe` as active with exactly the efforts `low`, `medium` and `high`. (refs §5.1)

### Lint accepts the id

Given `mistral-vibe` enabled and a plan whose one phase names `mistral-large-4-0` at `high`, when `phax plans lint` runs on it, then it reports no model or effort failure for the phase and exits 0. (refs §5.3)

### Lint refuses an effort the API does not serve

Given a plan whose phase names `mistral-large-4-0` at `xhigh`, and another at `max`, when `phax plans lint` runs on each, then each is refused, the failure naming `mistral-large-4-0` and its supported efforts `low, medium, high`. (refs §5.2)

### A real Vibe session at each catalogued effort

Given Vibe 3.1.3 or later on a Mistral Pro subscription, in the real-provider suite (`pnpm test:e2e:real`), when phax runs one Vibe turn on `mistral-large-4-0` at each of `low`, `medium` and `high`, then each turn exits 0 and its export records `config.models.mistral-large-4-0.thinking` equal to the level asked for. (refs §5.4, §5.1)

### A one-phase run records model, effort and cost

Given `mistral-vibe` enabled and a one-phase plan naming `mistral-large-4-0` at `medium`, in the real-provider suite, when `phax run` runs the plan, then the phase record names provider `mistral-vibe`, model `mistral-large-4-0`, effort `medium`, and a USD cost greater than zero. (refs §5.4, §5.5)

### A configured job runs on Large 4, not Medium 3.5

Given `mistral-vibe` enabled and `"review": { "code": { "enabled": true, "model": "mistral-large-4-0", "effort": "high" } }` in `phax.json`, when a run reaches code review, then the review session runs on `mistral-vibe` with model `mistral-large-4-0` at thinking level `high`, and never on `mistral-medium-3.5`. (refs §5.6)

### No Claude 5.x request reaches Large 4

Given every provider enabled, `mistral-vibe` first in `providerPriority`, `allowDowngrade` true, when `phax agent resolve` runs for every Claude 5.x model at every effort it lists, then no resolution selects `mistral-large-4-0`. (refs §5.7)

### Large 4 falls back on its 4.x anchor

Given `mistral-vibe` disabled and `claude-code` enabled, when `phax agent resolve --model mistral-large-4-0 --effort <level>` runs for `low`, `medium` and `high`, then each selects `claude-code` on a Claude 4.x model at its edge's anchor effort, with the edge's relation inverted. (refs §5.8, §5.10)

### A Mistral job with Vibe and Claude disabled is refused

Given `review.code` on `mistral-large-4-0` at `high`, and `mistral-vibe` and `claude-code` both disabled, when `phax run <plan>` starts, then it exits 11 before creating a worktree or starting any agent session, and the message names `review.code`, `mistral-large-4-0 @ high`, `mistral-vibe`, `claude-code` and the `enabled` setting in `~/.phax/providers.json`. (refs §5.11, §5.12, §5.9)

### Resolve refuses rather than substitutes

Given `mistral-vibe` and `claude-code` both disabled, when `phax agent resolve --model mistral-large-4-0 --effort high` runs, then it exits non-zero, prints no selected provider, and names both disabled providers and the setting that enables them. (refs §5.11)

### Claude disabled is never Claude run

Given `claude-code` disabled, `mistral-vibe` enabled, and code review left on its default `claude-opus-5-5` at `high`, when `phax run <plan>` starts, then it is refused before any work, naming code review, `claude-opus-5-5 @ high` and `claude-code`, and no session starts on `claude-code`. (refs §5.9, §5.12)

### Every routed job honours a disabled provider

Given `mistral-vibe` and `claude-code` both disabled, when compliance review, spec authoring, plan authoring, revise and decide verdicts are each started naming `mistral-large-4-0` at `high`, then each is refused with the request, the disabled providers and the enabling setting named, and no agent session starts. (refs §5.9, §5.11)

### Job defaults unchanged

Given a `phax.json` with no `review`, `authoring` or `agent.extractPlan` key, when phax resolves its job defaults, then code review, authoring, plan adjustment and decide are `claude-opus-5-5` at `high`, compliance review and decide verdicts are `claude-sonnet-5-5` at `medium`, and plan extraction is `claude-haiku-5-5` at `low`. (refs §5.13)

### The planner's table lists Large 4

Given the catalog with `mistral-large-4-0`, when `pnpm gen:model-catalog` runs, then the phax-planning skill's table carries the row `| \`mistral-large-4-0\` | \`mistral-large\` | active | \`low\` \| \`medium\` \| \`high\` |`, the default phase assignment still names only Claude models, and its drift check passes. (refs §5.14)

### An existing providers.json gains the id

Given a `~/.phax/providers.json` whose `mistral-vibe` entry lists only `mistral-medium-3.5`, when `phax agent setup providers --write` runs, then the file lists `mistral-large-4-0` with `low`, `medium` and `high`, the report names it as added, and every entry the file already listed keeps its efforts and status. (refs §5.15)

## 9. Open questions

### q-anchor — Which Claude rung anchors Large 4's efforts?

- sonnet-4-6 — Claude Sonnet 4.6, straight across (`low`/`medium`/`high` → the same effort, `equivalent`), from the ECI tie and the catalog's straight-across rule — abandons: a Large 4 phase falling back to Claude runs on Sonnet 4.6, which is weaker than Sonnet 5.5 and costs more ($3/$15 against $2/$10)
- sonnet-5-5-low — Claude Sonnet 5.5 `low` for Large 4 `high` (26 = 26 on AA v5.0.1) — abandons: explicit routing: with Vibe enabled and first in priority, every Sonnet 5.5 `low` phase would reach Large 4 as `equivalent`, against the operator's settled point 1 and r-explicit

Recommendation: sonnet-4-6 — Nobody names Sonnet 4.6 any more, so the anchor keeps routing explicit in practice, and it is the rung the ECI ties Large 4 to. Falling back to Claude is the rare case, so paying Sonnet 4.6's price there is the acceptable loss.

### q-medium — What becomes of `mistral-medium-3.5`?

- deprecate — Deprecate it: kept in the catalog, never deleted; its edges serve fallback only — abandons: Vibe's `off` level, the only Mistral route for a Haiku 4.5 `none` request
- keep-reanchored — Keep it active, re-anchored on the ECI (`high` → Claude Haiku 4.5) — abandons: one Mistral spoke per Claude rung: two active Mistral spokes, a rule the spec must add for which one a hub request picks, and Haiku 4.5 serves only `none`, so both of Medium 3.5's levels would anchor the same Claude rung

Recommendation: deprecate — Its `high` edge overstates it by a generation, and Large 4 serves `low`, `medium` and `high`, cheap levels included. The lost `off` → Haiku 4.5 `none` route only matters to a request that names Haiku 4.5, which only that edge kept alive. Unless the effort check finds Large 4 serves no cheap level, that is the acceptable loss.

### q-off — Does Large 4 list `off` among its efforts?

- leave-out — Leave it out: efforts `low`, `medium`, `high`, as Vibe's own table lists — abandons: a cheap no-reasoning level on Large 4, which matters only if `mistral-medium-3.5` is deprecated and its `off` route to Haiku 4.5 `none` goes with it
- list-off — List it, anchored to Claude Haiku 4.5 `none` as Medium 3.5's `off` is today — abandons: a catalog that rests only on what the publisher states: the level rests on an API leniency Mistral may close without notice, and nothing shows it disables reasoning beyond a shorter answer

Recommendation: leave-out — Vibe's table, the publisher's word, omits `off`, and the only evidence for it is one call that answered with fewer tokens. The catalog's rule is efforts exactly as read from the provider's ground truth.

### q-disabled — What does phax do with a request whose provider is disabled?

- claude-while-enabled — Claude stays the terminal fallback only while `claude-code` is enabled; with nothing enabled to serve the request, refuse — abandons: an install with Claude disabled and a gap in its edges stops instead of running
- refuse-requested — Refuse whenever the requested provider is disabled, even with Claude enabled — abandons: the fallback AGENTS.md promises ("Claude Code is the default and fallback"), and every existing edge's fallback use
- warn — Keep the fallback as it is and print the substitution as a warning — abandons: the meaning of the operator's switch: a disabled provider, Claude included, still runs

Recommendation: claude-while-enabled — It is the smallest change that makes `enabled` true for every provider, Claude included. It keeps the documented fallback for the common install. The only install that loses anything is one that disabled Claude itself, and stopping is what that operator asked for.

### q-family — Is Large 4 a new `mistral-large` family, or does it join `mistral-medium`?

- new-family — A new family `mistral-large` — abandons: a closed family vocabulary: one more value that `model-routing.json`, `phax agent resolve` output and telemetry accept, an unknown `mistral-*` id still guessed as `mistral-medium`, and a deprecated Medium 3.5 with no same-family alternative to suggest
- join-medium — Prepend `mistral-large-4-0` to the `mistral-medium` family — abandons: a family name that describes its models: with Large 4 first, every `mistral-medium` request by alias or unknown id lands on a different model line under the wrong name

Recommendation: new-family — It is a different model line. A family's first active entry is what aliases and guessed ids resolve to, so joining would hide a model swap behind a name. Widening the family vocabulary by one value is a contained cost.

### q-existing-catalog — How does an install with its own `providers.json` get the new id?

- setup-adds — `phax agent setup providers --write` adds the built-in entries a listed provider lacks, and reports each — abandons: a hand-trimmed catalog: an entry the operator deleted from providers.json comes back on the next `--write`
- by-hand — Document the entry in `docs/upgrading.md` for the operator to add by hand, or to delete the file — abandons: the feature for every operator who could use it: any install with Vibe enabled has a providers.json, so `mistral-large-4-0` stays "not found in catalog" there until someone edits JSON

Recommendation: setup-adds — The operators this spec serves are exactly the ones with a providers.json. `--write` already rewrites the file, re-enables providers and replaces retired ids. Adding missing built-in entries is the same kind of change, and the report names what it added.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- Operator, 2026-11-24: routing to Large 4 is explicit; its edges state its level (the Claude 4.x generation), not task equivalence; the ECI picks the anchoring Claude generation and model, AA's Intelligence Index places efforts within one read, and the Coding Agent Index checks the harness.
- Large 4's efforts come from the real calls of 2026-11-24: `low`, `medium`, `high` are served; `xhigh` and `max` are refused by the API.
- Plan extraction and decide stay hard-coded on Claude; the `single-provider` brief owns moving them.
- `PHASE_MODEL_POLICY` keeps naming Claude models only.
- Vibe is driven with `--model` and `--thinking`; the export's `config.models.<alias>.thinking` is how a turn checks its level.
- The defaults re-check (catalog record §4) keeps code review, compliance and authoring where they are: Large 4 sits below Sonnet 5.5 and Opus 5.5 on every axis read; the re-check is recorded either way.

Left open:

- Every §9 question; the requirements, surface and criteria are written for the recommended options, and a different decision revises the affected ones (q-disabled → r-fallback-enabled, r-refuse and the refusal criteria; q-existing-catalog → r-existing-catalog and ac-setup-adds; q-family → the family name in the surface and ac-planner-table).
- Which decide and extraction paths consult routing today, and so fall under r-disabled-never and r-refuse; those that do not stay hard-coded Claude and are out of scope.
- If q-medium keeps Medium 3.5 active: the rule that picks between two active Mistral spokes anchoring the same Claude rung (table order decides today).
- Whether the refusal for a job named only at its start (a decide or authoring session) shares the run-start refusal's wording.

Constraints:

- Unit and integration tests never reach the Mistral API; the real-session and one-phase-run criteria run only in `pnpm test:e2e:real`.
- No persisted format change beyond what the new catalog id needs (and the family value, if q-family picks `new-family`); records already carry the model id and Vibe's `costUsd`.
- Catalog rules hold: entries newest-first inside a family, a deprecated id is kept and never deleted, `ultracode` never anchored cross-provider, every edge hub-centric.
- The refusal for a request no enabled provider serves uses the preflight refusal exit code (11), and happens before any worktree or agent session.
- If Medium 3.5 is deprecated, a phase still naming it is refused as deprecated and the refusal names `mistral-large-4-0` as the alternative.
- Docs in the same change: `docs/model-catalog.md` §1 (ECI, AA Intelligence Index v5.0.1, AA Coding Agent Index v2.1 as sources, with read dates; BenchLM and LLM Stats recorded as rejected), §2 (the entry and its read), §3 (the edges with the three axes and their numbers), §4 (the cost row $0.70/$2.10/$0.07 and the defaults re-check), §6 (a refresh-log row); `docs/model-routing.md` if a family is added and for the new disabled-provider rule; the README's Vibe paragraph; `docs/upgrading.md` if Medium 3.5 is deprecated, and for `setup providers --write` adding entries.

## 11. Docs page

Page: docs/model-catalog.md

Reader: An operator choosing a Mistral model for a plan phase or a configured job, who needs to know which id to name, which efforts it serves, where it sits against Claude, and what happens when Vibe or Claude is disabled.

Example: | `mistral-large-4-0` | `mistral-large` | `low medium high` | Vibe 3.1.3 built-in table and a real call per level, 2026-11-24 (`xhigh`, `max`: HTTP 400) | 2026-11-24 |

| `mistral-large-4-0` | `claude-sonnet-4-6` (low/medium/high) | `equivalent` | ECI 154.6 (CI 151.8–157.4) vs Sonnet 4.6 152.9; AA v5.0.1 26 at `high`; AA Coding Agent Index Vibe + `high` 40.6 | 2026-11-24 |
