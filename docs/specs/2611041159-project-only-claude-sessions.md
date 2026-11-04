---
status: Approved
date: 2026-11-04
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-04
  baseline: 0bd98d6
---
# Project-only Claude sessions

## 1. Context

phax launches Claude Code in two ways. Headless sessions run `claude --print --output-format stream-json --verbose` with phax's own permission flags, model and effort: phase sessions and their fix attempts (resumed), handoff generation, headless authoring (`phax artifact new … --headless`), decide's headless handback, headless and compliance review, and the sealed structured completions. Interactive sessions are the ones a person drives: `phax enter`, a stop's continue and fresh-start commands, the interactive part of `phax artifact decide`, interactive review. A third launch, the usage probe, runs from the OS temp directory and deliberately keeps the user's settings, because they can hold the authentication (`apiKeyHelper`) its verdict must see.

Every headless launch inherits the phax process environment unchanged and passes no `--setting-sources`, so Claude Code loads every settings layer it knows: the user's (`~/.claude/settings.json`, user skills, plugins, hooks, `~/.claude/CLAUDE.md` and `~/.claude/rules`), the project's (`.claude/settings.json`, `.claude/skills`, `.claude/rules`, `CLAUDE.md`), the local one (`.claude/settings.local.json`, gitignored), and the operator's auto-memory index under `~/.claude/projects/<repo>/memory/`. On top of those, secure sessions receive one inline `--settings` object from phax: the PermissionRequest hooks that grant `.claude/skills/**` edits and the `permissions.deny` rules for protected paths.

Measured on phax's own records (2026-11-04, 465 sessions): phase sessions load a median 64 skills (max 77, up from 32 in three months) of which the repository supplies 16; 465 of 465 sessions loaded the operator's auto-memory index (~7 KB of personal notes); the first turn of a phase starts with a median ~50k tokens in context (30k–87k), re-read from cache on every turn. The headless session writing this very spec received the operator's `~/.claude/rules/context7.md` and their auto-memory index alongside the repository's `CLAUDE.md`.

Probed on Claude Code 2.1.318 with OAuth (Max subscription), one turn in this repository, reading the `init` event: today's flags load 75 skills, a non-builtin plugin, 7 MCP servers, auto-memory and user rules, 35.5k first-turn context. `--setting-sources project` (or `project,local`) loads 35 skills, no non-builtin plugin, 2 MCP servers, no user rules, 25.1k. Adding `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` to the process environment also drops the auto-memory: 21.4k. A user SessionEnd hook fired only under today's flags. OAuth kept working in every row. What remains is the repository's 16 skills, the 19 skills bundled with Claude Code, the builtin `cc-plugin-*` plugins, and the account's claude.ai connectors (dropped by `--strict-mcp-config`, which phase sessions already pass under their MCP policy). `--bare` goes further but accepts only `ANTHROPIC_API_KEY` or an `apiKeyHelper` passed in `--settings`: no OAuth.

Ground read:

- `docs/ideas/harness-from-records.md` — The harness brainstorm: feed-forward too wide and partly the operator's, the isolation probe table, and open question 1 (isolation per mode).
- `src/infra/providers/claudeCode.ts` — spawnClaude spawns `claude` with no env override (the phax process environment is inherited); buildArgs builds read-only, secure and unsafe headless sessions; buildCompletionArgs builds sealed completions; buildProbeArgs reuses the completion flags and documents that user settings must still load for the usage probe (apiKeyHelper).
- `src/infra/providers/claudeSkillEditSettings.ts` — The one inline `--settings` object: PermissionRequest hooks for skill-edit grants and permissions.deny for protected paths.
- `src/domain/session/claudePermissionFlags.ts` — The permission flag set shared by headless sessions and by the interactive stop commands (continue, fresh start); carries --strict-mcp-config per mcp.mode and the inline --settings.
- `src/domain/session/claude.ts` — Interactive launches: decide's interactive session, a stop's continue and fresh-start commands, enter's resume and pre-prompted invocations.
- `src/app/decideArtifact.ts` — decide runs an interactive session, then resumes it headless for the handback (and once more on a refused answer).
- `src/schemas/runRecord.ts` — The phase record manifest (`record.json`) fields: runId, phaseId, shape, sourceSha, model, effort, provider, outcome, usage, verifiedSurfaces, acceptance, mode, stop.
- `src/schemas/securityPosture.ts` — security.json version 3, the per-phase posture record.
- `src/domain/session/signatures.ts` — The provider verdict classification table (network, rate limit, usage limit); no authentication signature today.
- `docs/security.md` — What phax confines per provider and what it reads from a provider's session store; states phax never reads a provider's credentials or configuration.

## 2. Problem

The harness phax hands an agent is meant to be the repository's: two maintainers running the same plan on the same commit should give the agent the same feed-forward. Today each headless session also receives whatever the person running phax installed for themselves, and that has three costs.

It costs tokens on every turn: about 10k–14k tokens of first-turn context per session on the maintainer's machine (35.5k → 21.4k in the probe), skills for video tooling, Cloudflare and office documents that no phase uses, re-read from cache on every turn of every session.

It is invisible to the records. A record's `sourceSha` recovers the repository's harness (`CLAUDE.md`, `.claude/skills`, `.claude/rules`, the gate profile), never `~/.claude`. A change in a phase's cost or behaviour can come from a skill the operator installed last week, and no record can say so.

It makes a run depend on who launched it. A user hook fires inside a phase; a user rule tells the agent to call an external CLI; a personal memory note about another branch steers an authoring session. None of it was reviewed in a diff, and none of it travels to the next maintainer.

phax passes neither of the switches Claude Code offers to prevent this.

## 3. Product goal

Every headless Claude Code session phax launches runs on the harness the project committed and on nothing the operator installed for themselves: no user-level skills, plugins, hooks, instructions or settings, and no auto-memory. phax gets there with Claude Code's own per-invocation switches and never touches the operator's configuration. Sessions a person drives keep that person's setup, and an operator whose authentication depended on their user settings is told so by name, never left with a silent failure.

> A headless session sees what the repository committed, and only that; a session a person drives is theirs.

## 4. Terminology

- **headless session** — A Claude Code session phax launches with `--print` and reads to its end with no person at the terminal: a phase session and every fix attempt that resumes it, handoff generation, headless authoring, decide's headless handback and its corrective retry, headless review, compliance review, and a structured completion. The usage probe is not one (see usage probe).
- **interactive session** — A Claude Code session a person drives in their terminal: `phax enter`, a stop's continue or fresh-start command, the interactive part of `phax artifact decide`, interactive review.
- **usage probe** — The one-turn, tool-less Claude Code call phax makes from the OS temp directory to read the account's usage verdict. It keeps loading the user's settings.
- **user layer** — Everything Claude Code loads from the operator's own configuration rather than the repository: user settings (permissions, env, hooks, model defaults, apiKeyHelper), user skills, user and marketplace plugins, user instructions (`~/.claude/CLAUDE.md`, `~/.claude/rules`), user-scope MCP servers, and the auto-memory index.
- **project-only launch** — A Claude Code invocation whose setting sources are limited to the project's committed settings and whose process environment disables auto-memory, so that no part of the user layer loads.
- **inline settings** — The one `--settings` object phax passes to a secure headless session: the PermissionRequest hooks granting `.claude/skills/**` edits and the `permissions.deny` rules for protected paths.
- **auto-memory** — Claude Code's per-project memory index under the operator's home (`~/.claude/projects/<repo>/memory/MEMORY.md`), loaded into every session of that project unless disabled.

## 5. Functional requirements

### 5.1 Project setting sources only

The system shall launch every headless Claude Code session with Claude Code's setting sources limited to the project's committed settings, so that no user-level settings, skills, plugins, hooks or instructions load.

### 5.2 Auto-memory disabled

The system shall launch every headless Claude Code session with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the session's process environment.

### 5.3 phax's memory switch wins

IF the environment phax runs in sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY` to any other value THEN the system SHALL still launch the headless session with the value `1`.

### 5.4 The rest of the environment is kept

The system shall pass every other variable of the environment phax runs in to a headless Claude Code session unchanged, so that environment-borne authentication (`ANTHROPIC_API_KEY`) and a moved configuration root (`CLAUDE_CONFIG_DIR`) keep working.

### 5.5 Resumed headless sessions too

WHEN the system resumes a Claude Code session headless (a phase fix attempt, decide's handback or its corrective retry) THE system SHALL launch the resume project-only, whatever setup the resumed session was started under.

### 5.6 Inline settings keep applying

WHILE a secure headless session runs project-only THE system SHALL keep its inline settings in effect: a granted `.claude/skills/**` file stays editable and a protected path stays denied, exactly as under today's launch.

### 5.7 Interactive sessions unchanged

The system shall launch every interactive Claude Code session with the person's own setting sources and auto-memory, unchanged from today.

### 5.8 Usage probe unchanged

The system shall launch the usage probe with the user's settings loaded, as today.

### 5.9 The operator's configuration is never touched

The system shall isolate a headless session only through switches on that session's own invocation, and shall not read, write, move or rename any file of the operator's Claude Code configuration to do so.

### 5.10 A lost authentication is named

IF a project-only headless Claude Code session ends because Claude Code reports it is not authenticated THEN the system SHALL fail the session with a message naming the authentication failure, stating that phax's headless sessions do not load Claude Code user settings, and naming the remedies (log in with `claude /login`, or set `ANTHROPIC_API_KEY` in the environment phax runs in).

### 5.11 The record says which layer ran

The system shall record, as a required field of each phase record manifest, whether the operator's user-level provider configuration was loaded for the phase's headless sessions: excluded for a Claude Code phase, loaded for a Codex or Mistral Vibe phase.

## 6. Surface

### internal: headless Claude Code launch — normative

Summary: The agent in a headless phax session sees only the repository's committed harness: no user skills, plugins, hooks, instructions, settings or auto-memory of the person who ran phax.

before:

    claude --print --output-format stream-json --verbose \
      --permission-mode acceptEdits --add-dir /Users/me/.phax \
      --allowedTools "Bash(pnpm check:fast:*)" --strict-mcp-config \
      --settings '{"permissions":{"deny":["Edit(//…/phax.json)"]}}' \
      --model claude-sonnet-5-5 --effort medium
    # environment: inherited from phax as is

    # init event: 75 skills, plugin cloudflare, 7 MCP servers,
    #             auto-memory loaded, ~/.claude/rules loaded

after:

    claude --print --output-format stream-json --verbose \
      --setting-sources project \
      --permission-mode acceptEdits --add-dir /Users/me/.phax \
      --allowedTools "Bash(pnpm check:fast:*)" --strict-mcp-config \
      --settings '{"permissions":{"deny":["Edit(//…/phax.json)"]}}' \
      --model claude-sonnet-5-5 --effort medium
    # environment: inherited from phax, plus CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

    # init event: repository skills + Claude Code's bundled skills,
    #             builtin cc-plugin-* only, no auto-memory, no user rules

### file: <run>/<phase>/record.json — indicative

Summary: A phase record now says whether the operator's own provider configuration was in play for the phase's headless sessions.

before:

    {
      "$schema": "https://docs.phax.run/schemas/phase-record-manifest/0.30.0.json",
      "runId": "…",
      "phaseId": "02-reader",
      …
      "model": "claude-sonnet-5-5",
      "effort": "medium",
      "provider": "claude-code",
      "outcome": …
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/phase-record-manifest/0.33.0.json",
      "runId": "…",
      "phaseId": "02-reader",
      …
      "model": "claude-sonnet-5-5",
      "effort": "medium",
      "provider": "claude-code",
      "userConfig": "excluded",
      "outcome": …
    }

    # a codex-cli or mistral-vibe phase: "userConfig": "loaded"

### cli: authentication failure of a headless session — indicative

Summary: An operator whose Claude Code login lived in their user settings is told that phax's headless sessions skip those settings and how to authenticate instead.

before:

    $ phax run docs/plans/2611050900-reader-plan.md
    ✗ phase 01-schema: claude session failed (exit 1)
      Invalid API key · Please run /login
    $? = 1

after:

    $ phax run docs/plans/2611050900-reader-plan.md
    ✗ phase 01-schema: Claude Code is not authenticated
      phax's headless sessions do not load your Claude Code user settings
      (~/.claude/settings.json), so an apiKeyHelper or env set there is not used.
      Log in with `claude /login`, or set ANTHROPIC_API_KEY where you run phax.
    $? = 1

## 7. Non-goals

- The harness manifest per record (which feed-forward each session received, with hashes): a separate spec, which this one makes smaller by removing the user layer from what it must list.
- The skills bundled with Claude Code (`debug`, `simplify`, `loop`, `claude-api`…): no switch removes them short of `--disable-slash-commands`, which drops the repository's skills too.
- Managed (organisation policy) settings: they are not the operator's personal layer and keep loading wherever Claude Code loads them.
- MCP servers: which servers a headless session loads stays governed by the security policy's `mcp` settings (`--strict-mcp-config`, `--mcp-config`); this spec only notes that user-scope servers no longer load under `provider-default`.
- Codex (`CODEX_HOME`, profiles) and Mistral Vibe isolation: named as follow-ups; their records say `loaded` until they are designed.
- Interactive sessions a person drives: `phax enter`, a stop's continue and fresh-start commands, the interactive part of decide, interactive review keep the person's setup.
- Changing what the repository ships (`CLAUDE.md`, `.claude/skills`, `.claude/rules`, `.claude/settings.json`).
- `--bare`: it refuses OAuth, so it cannot run on a subscription.
- Forwarding any part of the user layer (an apiKeyHelper, an env block) into a headless session: phax would have to read the operator's configuration to do it.

## 8. Acceptance criteria

### A phase session launches project-only

Given a secure claude-code phase in a run, with `claude` replaced by a recording stub that captures its argv and environment, when `phax run` launches the phase session, then the argv carries `--setting-sources project` and the environment carries `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. (refs §5.1, §5.2)

### Every headless kind launches project-only

Given the recording stub, and one invocation each of a read-only, a secure and an unsafe headless session, a structured completion, headless authoring (`phax artifact new spec … --headless`), handoff generation, headless review and compliance review, when each invocation launches Claude Code, then every captured argv carries `--setting-sources project` and every captured environment carries `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. (refs §5.1, §5.2)

### The user layer does not reach a real session

Given a real Claude Code install whose operator has a user skill, a non-builtin plugin, a `~/.claude/rules` file, a user `SessionEnd` hook and an auto-memory index for the repository, when phax launches one headless session in the repository, then the session's `init` event lists the repository's skills and Claude Code's bundled skills only, no non-builtin plugin, no auto-memory and no user rule, the user hook does not fire, and the session authenticates and answers. (refs §5.1, §5.2)

### phax's memory switch overrides the operator's

Given phax run with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=0` in its environment and the recording stub, when a headless session launches, then the captured environment carries `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. (refs §5.3)

### Other variables pass through

Given phax run with `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR` and an unrelated variable set, and the recording stub, when a headless session launches, then the captured environment holds all three with their values unchanged. (refs §5.4)

### Fix attempts and handbacks resume project-only

Given a phase whose gate fails once, and a decide whose interactive session ends and whose first handback answer is refused, with the recording stub, when phax resumes the phase session for its fix attempt and resumes the decide session for its handback and its corrective retry, then each resume's argv carries `--resume <id>` and `--setting-sources project` and its environment carries `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. (refs §5.5)

### A skill-edit grant still works

Given a real secure claude-code phase run with `--allow-skill-edits` granting one `.claude/skills/**` file, when the phase session edits that file, then the edit lands, and an edit of an ungranted `.claude/` file in the same session is denied. (refs §5.6)

### A protected path stays denied

Given a real secure claude-code phase run with `protectedPaths` declared in `phax.json`, when the phase session tries to edit a protected file, then the edit is denied, as under today's launch. (refs §5.6)

### Interactive launches are unchanged

Given the recording stub, when `phax enter`, a stop's continue and fresh-start commands and the interactive part of `phax artifact decide` launch Claude Code, then no captured argv carries `--setting-sources` and no captured environment carries a `CLAUDE_CODE_DISABLE_AUTO_MEMORY` that phax set. (refs §5.7)

### The usage probe keeps the user's settings

Given the recording stub, when phax runs its usage probe, then the captured argv carries no `--setting-sources` and the environment carries no `CLAUDE_CODE_DISABLE_AUTO_MEMORY` that phax set. (refs §5.8)

### The operator's configuration is untouched

Given a Claude Code configuration root whose files' paths, contents and modification times are snapshotted, and the recording stub, when a run with one claude-code phase completes, then the snapshot is identical, and phax opened no file under the configuration root other than the session transcripts it already reads. (refs §5.9)

### A lost authentication is named

Given a recording stub that ends the session with Claude Code's not-authenticated verdict (`Invalid API key · Please run /login`), when `phax run` launches a claude-code phase, then the phase fails with a message naming the authentication failure, stating that phax's headless sessions do not load Claude Code user settings, and naming `claude /login` and `ANTHROPIC_API_KEY`, and the failure is not retried as a network or rate-limit failure. (refs §5.10)

### The record says excluded or loaded

Given a run with one claude-code phase and one codex-cli phase that both complete, when phax writes their phase records, then the claude-code phase's `record.json` carries `"userConfig": "excluded"`, the codex-cli phase's carries `"userConfig": "loaded"`, and a manifest of the new version without the field is refused on decode. (refs §5.11)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-sources — Which setting sources does a headless session keep: `project` alone, or `project,local`?

- project — `--setting-sources project`: committed configuration only — abandons: the operator's gitignored `.claude/settings.local.json` in the main checkout, where authoring, decide's handback and review run: a personal permission or env set there stops applying to those sessions
- project-local — `--setting-sources project,local`: committed plus the checkout's local settings — abandons: portability where it matters least visibly: authoring and review sessions in the main checkout would again depend on a personal, unrecorded file, while phase worktrees (which have no local file) would not, so the two kinds of session would differ per operator

Recommendation: project — Only committed configuration is portable and recoverable from `sourceSha`. The local file is already absent from every phase worktree, so dropping it changes nothing for phases and makes authoring and review behave like them. An operator who needs a setting in those sessions can commit it.

Decision: project — by operator (Rémy Loubradou), 2026-11-04
Why: Only committed configuration is portable and recoverable from `sourceSha`. The local file is already absent from every phase worktree, so dropping it changes nothing for phases and makes authoring and review behave like them. An operator who needs a setting in those sessions can commit it. Advocate: The strongest case for project-local: an operator who keeps a personal permission or env in `.claude/settings.local.json` loses it in authoring, decide and review sessions run in the main checkout, with no way to restore it short of committing it. Principles: S1, S2. Reversibility: cheap. Revised: none.

### q-auth — What happens to an operator whose Claude Code authentication lives in user settings (`apiKeyHelper`, an `env` block for a key, Bedrock or Vertex)?

- refuse-named — Fail the session with a named cause and the remedies (§6 message); no fallback — abandons: those operators' ability to run phax headless at all until they move their authentication to OAuth or to the environment phax runs in: a hard break on upgrade for a minority setup
- opt-out — Name the cause, and offer a per-operator opt-out that keeps user settings for headless sessions — abandons: the guarantee that every claude-code record ran on the committed harness: an opted-out operator's records say `loaded`, and the opt-out is a key phax must carry and document
- preflight — Check authentication before a run's first headless session, with one project-only probe call, and refuse the run early with the named cause — abandons: one extra paid call per run, and a probe that can disagree with the usage probe (which still loads user settings) in the very case it exists to catch

Recommendation: refuse-named — OAuth (the subscription case, probed) and `ANTHROPIC_API_KEY` in the environment both keep working, so the loss falls on a setup that can move its authentication in one step. A named failure at the first session costs nothing extra and is never silent; it can grow into an opt-out if real users hit it, which `q-opt-out` keeps out of this slice.

Decision: refuse-named — by operator (Rémy Loubradou), 2026-11-04
Why: OAuth (the subscription case, probed) and `ANTHROPIC_API_KEY` in the environment both keep working, so the loss falls on a setup that can move its authentication in one step. A named failure at the first session costs nothing extra and is never silent; it can grow into an opt-out if real users hit it, which `q-opt-out` keeps out of this slice. Advocate: The strongest case for opt-out: an operator on Bedrock, Vertex or an apiKeyHelper cannot run phax headless at all after upgrading, and an opt-out would keep them working at the price of a recorded `loaded`. Principles: S1, S3. Reversibility: cheap. Revised: none.

### q-opt-out — Should an operator be able to keep the user layer for headless sessions?

- no-opt-out — No opt-out in this slice — abandons: an operator who relied on a user-scope MCP server under `mcp.mode: provider-default`, a user hook or a user skill inside phases has no way back except an older phax
- user-opt-out — A key in `phax.user.json` (the operator's own, uncommitted file) restoring the user layer — abandons: the guarantee the spec exists for: two maintainers on the same commit can again hand the agent different harnesses, recorded but no longer prevented
- project-opt-out — A key in `phax.json` (committed) restoring the user layer for everyone — abandons: the point of the change: a committed key that makes the project's harness depend on each operator's home

Recommendation: no-opt-out — The user layer phax would restore is exactly the unreviewed, unrecorded part the problem names. What an operator wants in phases belongs in the repository, where it is reviewed and recovered by `sourceSha`. Adding a `phax.user.json` key later is cheap if a real need appears; taking one away is not.

Decision: no-opt-out — by operator (Rémy Loubradou), 2026-11-04
Why: The user layer phax would restore is exactly the unreviewed, unrecorded part the problem names. What an operator wants in phases belongs in the repository, where it is reviewed and recovered by `sourceSha`. Adding a `phax.user.json` key later is cheap if a real need appears; taking one away is not. Advocate: The strongest case for user-opt-out: an operator who relies on a user-scope MCP server, hook or skill inside phases has no way back except an older phax, while an uncommitted key would restore it for them alone. Principles: S1, S4. Reversibility: cheap. Revised: none.

### q-record — Where, if anywhere, does a record say which provider configuration layer was in play?

- record-manifest — A required field on the phase record manifest (`record.json`), `excluded` or `loaded` — abandons: a new manifest version for one field, and a field that only says 'the user layer was or was not loaded', not what it held
- security-json — A required field on `security.json`, beside the other posture facts — abandons: discoverability for cost and behaviour analysis: the harness is not a security posture, and readers of records would have to open a second file to attribute a change
- not-recorded — Not recorded: the argv in the session's error log is enough — abandons: attribution: a record could not distinguish a phase run before this change from one after, nor a Claude Code phase from a Codex one that still loads its user layer

Recommendation: record-manifest — The records are where the harness is meant to be read from, and the manifest is what every analysis already opens. One required, per-provider value is the smallest honest statement; the harness manifest spec can later replace it with the full list.

Decision: record-manifest — by operator (Rémy Loubradou), 2026-11-04
Why: The records are where the harness is meant to be read from, and the manifest is what every analysis already opens. One required, per-provider value is the smallest honest statement; the harness manifest spec can later replace it with the full list. Advocate: The strongest case for not-recorded: a manifest version for a single two-valued field is a persisted-schema cost, and the harness manifest spec will replace it with the full list anyway. Principles: S1, S5. Reversibility: costly. Revised: none.

## 10. Implementation-planning note

Settled:

- Scope is headless Claude Code sessions only, as listed under 'headless session'. Interactive sessions, including the interactive part of decide, keep the person's setup; decide's headless handback and its corrective retry are in scope.
- The mechanism is Claude Code's own switches, per invocation: `--setting-sources` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the spawned process's environment, added to the inherited environment rather than replacing it. phax never edits, moves or reads the operator's Claude Code configuration; it keeps reading only the session transcripts it reads today.
- phax's inline `--settings` (skill-edit grants, protected-path deny rules) keeps applying; the acceptance proves it with real sessions under the new setting sources.
- Claude Code only. Codex and Mistral Vibe records say `loaded` until their own isolation is specified.
- The usage probe keeps loading the user's settings.
- The §6 argv sketch assumes `q-sources` resolves to `project`; `project,local` would revise the normative flag value only.

Left open:

- The four §9 questions: setting sources, the authentication fallback, an opt-out, and where the record states the layer.
- The field name and values on the record manifest (`userConfig`: `excluded` | `loaded` is indicative), and the wording of the authentication failure.
- Whether user instructions in `~/.claude/CLAUDE.md` follow `~/.claude/rules` out under project-only sources: probed for rules only; the real-session criterion must cover both, and report if CLAUDE.md still loads.

Constraints:

- The permission flag set is shared by headless sessions and the interactive stop commands, and the probe reuses the completion flags: the project-only switches must reach every headless launch and none of those.
- No back-compat shim on the record manifest: the field is required in the new manifest version, and older manifests keep reading through the existing per-version readers.
- The authentication failure must be its own classified kind, never matched as a network, rate-limit or usage-limit failure, and never retried as one.
- Real-session criteria (`init` event, skill grant, protected path) run in the e2e tier against an installed Claude Code; the argv and environment criteria run against a recording stub.
- docs/security.md must stop implying the user layer loads in headless sessions, and must state what still loads (bundled skills, builtin plugins, managed settings, MCP per the security policy).

## 11. Docs page

Page: docs/security.md — a new 'What a Claude Code session loads' section under Provider-Specific Behavior

Reader: An operator who runs phax with their own Claude Code setup (skills, plugins, hooks, rules, memory) and wants to know which of it a phase agent sees, and a maintainer comparing records across people.

Example: A table with two rows, headless and interactive, and columns for repository harness, user skills and plugins, user hooks, user rules and CLAUDE.md, auto-memory, bundled skills: headless loads the repository's and the bundled ones only, interactive loads everything. Then the argv of a secure phase session showing `--setting-sources project` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, the `"userConfig": "excluded"` line of its `record.json`, and the authentication failure an `apiKeyHelper` user sees, with the two remedies.

## 12. Decision log

- 2026-11-04 q-sources decided project — operator (Rémy Loubradou)
- 2026-11-04 q-auth decided refuse-named — operator (Rémy Loubradou)
- 2026-11-04 q-opt-out decided no-opt-out — operator (Rémy Loubradou)
- 2026-11-04 q-record decided record-manifest — operator (Rémy Loubradou)
