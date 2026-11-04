---
status: Draft
date: 2026-11-04
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Partial commands on gate steps

## 1. Context

A gate profile in `phax.json` is an ordered list of gate steps, each a `command` with a `surface` (local, structural, product) and a `firing` (every-phase, terminal). After a phase session ends, phax runs the phase's steps. A failing step resumes the same session with its output. The approved `phase-prompt-names-the-gate` spec (a prerequisite) gives the phase prompt a `## Gate` section. The section lists the steps phax will run for that phase, states that a failing step comes back to the session, and tells the agent to check each change, while it works, with the narrowest command that covers it.

In secure mode, phax decides which shell commands a phase agent may start. On Claude Code each frozen agent command becomes a `Bash(<command>:*)` rule, and any other Bash call is denied. On Mistral Vibe the same set is a prefix allowlist in `VIBE_TOOLS`. On Codex the OS sandbox confines every command and there is no per-command list. The frozen set is the union of `security.agentCommands`, every gate step command of the resolved profile (whatever its firing) and the brief provider's commands. It is recorded in `security.json` with a `source` per entry.

A probe on Claude Code 2.1.318 used phax's secure flags (headless, `--permission-mode acceptEdits --allowedTools …`). `wc -l $(ls *.txt)` was denied ("A nested command in this command can't be checked before it runs"), even when the exact string was allowed as one rule. `ls *.txt | xargs wc -l` ran with `Bash(ls:*)` and `Bash(xargs wc:*)`, and `wc -l one.txt two.txt` ran with `Bash(wc:*)`.

In a phase worktree nothing is committed before the gate runs, so the phase's current changes are the uncommitted changes. Many tools can read those directly (`vitest run --changed`).

Ground read:

- `docs/specs/2611041203-phase-prompt-names-the-gate.md` — Approved prerequisite. The phase prompt gains a `## Gate` section that lists the phase gate list, one `- <surface>: <command>` line per step, states the gate contract, and tells the agent to check each change with the narrowest command that covers it. The section's wording is the same for every provider and names no tool.
- `src/schemas/phaxConfig.ts` — GateStepSchema: `command`, `surface`, `firing`, `output` (default "log"), `input` (optional "gate-request"). GateProfilesSchema maps a profile name to a non-empty list of steps. A workspace and the user overlay can carry gateProfiles too. phax.schema.json is generated from it.
- `src/app/loadConfig.ts` — Config refusals name the path at fault, for example `gateProfiles.standard lists the command "…" twice (steps 2 and 5)` or `protectedPaths[0]: …`.
- `src/domain/session/claudePermissionFlags.ts` — gateCommandAllowRules turns each frozen agent command into one `Bash(<normalized command>:*)` rule. In secure mode `--permission-mode acceptEdits` auto-denies any Bash call that no rule matches.
- `src/domain/security/agentCommands.ts` — computeFrozenAgentCommands merges config, gate and brief commands, deduplicated, in that order of precedence. Each record carries `source` ("config" | "gate" | "brief"), `explicit`, `requiredByPlan`, `enforcement` and `degraded`. It is computed at phase start and again on resume.
- `src/schemas/securityPosture.ts` — security.json's `agentCommands[].source` is the literal set "config", "gate", "brief".
- `src/domain/session/vibeFlags.ts` — Vibe secure sessions get `VIBE_TOOLS` with `bash: { permission: "ask", allowlist: <agent commands> }`. This is a prefix allowlist, and in a headless turn any call outside it is refused.
- `docs/security.md` — "Shell command execution": Claude Code uses an exact per-command allowlist, Codex an OS sandbox with no per-command allowlist, Vibe a prefix allowlist. Every step's command is allowlisted whatever its firing. A known residual is already stated: a prefix allowlist checks how a command starts, not its options.
- `phax.json` — The `standard` profile has six local steps (format, typecheck, test:type, lint, format:check, test), three structural steps and four product terminal steps. No step carries a partial command.
- `docs/ideas/harness-from-records.md` — Measurements from 318 phase sessions: 27% of phase wall time goes to feedback commands the agent runs itself, and whole-suite runs take 6.7 h over 403 calls against 1.3 h over 1,193 targeted calls. Computing the scope from the import graph does not pay: `vitest related src/app/gates.ts` selects 99 of 613 test files and takes 203 s.

## 2. Problem

The prerequisite spec tells the agent to use the narrowest check, but it cannot say what that check is for a given project. Today the agent works it out again in every session. On phax's records, whole-suite test runs are the largest block of feedback time (6.7 h over 403 calls). Targeted runs are cheap: 1.3 h over 1,193 calls. In another project (steme) the right targeted command cannot be guessed at all. phax cannot work it out either: scoping by import graph selects 99 of 613 test files on this repository and takes 203 s. The project knows how to check part of a step, and today it has nowhere to say so.

Secure mode also gets in the way of the targeted form. A gate step's command is allowlisted, but its narrower form often starts differently: `pnpm lint` is allowed, while `pnpm exec oxlint src/a.ts` is denied on Claude Code. The only workaround is to copy each narrow form into `security.agentCommands`, away from the step it narrows, and to keep the two in step by hand.

## 3. Product goal

A project can write, next to a gate step, the command that checks part of what the step checks: on some files the agent names, or on the phase's current changes. phax shows that command to the agent under the step it narrows and allows it in secure mode as it allows the step. phax never runs it. The gate stays exactly as it is: same steps, same whole commands, same verdict.

> A partial command is something the project tells the agent. phax shows it and allows it, but never runs it and never judges a phase by it.

## 4. Terminology

- **gate step** — One entry of a gate profile: `command`, `surface`, `firing`, and optionally `output`, `input` and now `partial`.
- **partial command** — A command declared on a gate step that checks part of what the step's `command` checks. phax shows it and allows it, and never executes it.
- **files variant** — The partial command under `partial.files`. The agent runs it on files it chooses, filling them in where the command holds a placeholder.
- **diff variant** — The partial command under `partial.diff`. It runs on the phase's current changes, which in a phase worktree are the uncommitted changes. It holds no placeholder.
- **placeholder** — A `<name>` token in a partial command, `<` followed by a lowercase word (letters, digits, hyphens) and `>`, for example `<files>`. It marks where the agent puts its own arguments. A `<` that does not open a placeholder is a redirection.
- **pipe segment** — One part of a partial command split on `|`, trimmed and with whitespace normalized.
- **segment prefix** — The words of a pipe segment before its first placeholder, or the whole segment when it holds none. This is what phax allows for that segment in secure mode.
- **gate section** — The `## Gate` section of the phase prompt, as defined by the `phase-prompt-names-the-gate` spec.

## 5. Functional requirements

### 5.1 A gate step may declare partial commands

The system shall accept on any gate step, in phax.json, in a workspace's gate profiles and in the user overlay's gate profiles, an optional `partial` object whose keys are `files` and `diff`, each a non-empty command string.

### 5.2 An empty or unknown partial is refused

IF a gate step's `partial` holds neither `files` nor `diff`, or holds any other key, THEN the system SHALL refuse the configuration at load, naming the step's path.

### 5.3 A files variant holds a placeholder

IF a `partial.files` command holds no placeholder THEN the system SHALL refuse the configuration at load, naming the step's path and the variant.

### 5.4 A diff variant holds no placeholder

IF a `partial.diff` command holds a placeholder THEN the system SHALL refuse the configuration at load, naming the step's path and the variant.

### 5.5 Only pipes join commands

IF a partial command holds `;`, `&&`, `||`, a lone `&`, `$(`, a backtick, a line break, or a redirection (`>`, `>>`, or a `<` that does not open a placeholder) THEN the system SHALL refuse the configuration at load, naming the step's path, the variant and the construct found.

### 5.6 The gate section shows each step's partial commands

WHEN the gate section lists a gate step that declares `partial` THE system SHALL show, right under that step's line and in the order files then diff, one line per declared variant with the command verbatim: `on some files: <command>` for `files` and `on your changes: <command>` for `diff`.

### 5.7 The gate section explains partial commands

WHEN at least one step listed in the gate section declares `partial` THE system SHALL state in that section, in wording that names no tool, that a partial command checks part of what its step checks, that the agent replaces a placeholder with the files it chooses, and that phax does not run partial commands.

### 5.8 No partial, no change to the prompt

IF no step of the phase gate list declares `partial` THEN the system SHALL render the gate section byte-identical to the one the `phase-prompt-names-the-gate` spec defines.

### 5.9 phax never runs a partial command

The system shall never execute a partial command, nor a command derived from one, at the gate, in the fix loop, at preflight or anywhere else. Each phase's gate runs the same steps with the same commands, in the same order and with the same verdict, as without `partial`.

### 5.10 Partial commands are allowed like their step

WHILE a phase runs in secure mode on a provider with a per-command allowlist THE system SHALL add to the phase's frozen agent commands the segment prefix of every pipe segment of every partial command of every step in the resolved profile, whatever the step's firing, as it adds the step's own command.

### 5.11 security.json names where a prefix came from

The system shall record each segment prefix that is not already a config or gate command in `security.json`'s `agentCommands` with `source` set to "partial".

### 5.12 Resume keeps the same allowlist

WHEN `phax resume` restarts a phase THE system SHALL allow the same segment prefixes, and show the same partial lines, as the phase's first session.

### 5.13 Same partial lines for every provider

The system shall render the partial lines of the gate section byte-identically whichever provider runs the phase.

### 5.14 The published config schema describes partial

The system shall describe `partial`, its two variants and the placeholder in the generated config JSON Schema (phax.schema.json and phax.user.schema.json).

## 6. Surface

### config: gateProfiles.<profile>[].partial — normative

Summary: A project can write, next to a gate step, the commands that check part of it on some files or on the current changes, and phase agents are shown them and allowed to run them.

before:

    { "command": "pnpm lint", "surface": "local", "firing": "every-phase" }

after:

    {
      "command": "pnpm lint",
      "surface": "local",
      "firing": "every-phase",
      "partial": {
        "files": "pnpm exec oxlint <files>",
        "diff": "git diff --name-only --diff-filter=d | xargs pnpm exec oxlint"
      }
    }

### cli: config refusal of a partial command — indicative

Summary: A malformed partial command is refused when phax loads the config, with a message naming the step, the variant and what is wrong.

    $ phax validate
    ✗ gateProfiles.standard[3].partial.diff: "$(" is not allowed in a partial command; join commands with "|" only
    $? = 2

    $ phax validate
    ✗ gateProfiles.standard[5].partial.files: a files command needs a placeholder such as <files>
    $? = 2

    $ phax validate
    ✗ gateProfiles.standard[3].partial: declare "files", "diff" or both
    $? = 2

### internal: phase prompt gate section with partial commands — indicative

Summary: A phase agent sees, under each gate step, the project's commands for checking part of it, so it can check a change without running the whole step.

before:

    ## Gate

    After this session ends, phax runs these gate steps, in order:

    - local: pnpm lint
    - local: pnpm test
    ...

after:

    ## Gate

    After this session ends, phax runs these gate steps, in order:

    - local: pnpm lint
      - on some files: pnpm exec oxlint <files>
      - on your changes: git diff --name-only --diff-filter=d | xargs pnpm exec oxlint
    - local: pnpm test
      - on some files: pnpm exec vitest run <files>
    ...

    If a step fails, phax resumes this same session with its output and you fix it here.
    While you work, check each change with the narrowest command that covers it.
    A step's "on some files" and "on your changes" commands check part of what the step checks;
    replace a placeholder such as <files> with the files you choose. phax does not run them.
    You need not run a whole gate step before finishing: the gate runs it.

### file: <phase folder>/security.json agentCommands — normative

Summary: An operator auditing a secure phase sees each allowed prefix that came from a partial command, marked with the source "partial".

before:

    "agentCommands": [
      { "command": "pnpm lint", "source": "gate", "explicit": false, "requiredByPlan": false, "enforcement": "exact", "degraded": false }
    ]

after:

    "agentCommands": [
      { "command": "pnpm lint", "source": "gate", "explicit": false, "requiredByPlan": false, "enforcement": "exact", "degraded": false },
      { "command": "pnpm exec oxlint", "source": "partial", "explicit": false, "requiredByPlan": false, "enforcement": "exact", "degraded": false },
      { "command": "git diff --name-only --diff-filter=d", "source": "partial", "explicit": false, "requiredByPlan": false, "enforcement": "exact", "degraded": false },
      { "command": "xargs pnpm exec oxlint", "source": "partial", "explicit": false, "requiredByPlan": false, "enforcement": "exact", "degraded": false }
    ]

### internal: Claude Code secure allow rules — indicative

Summary: A secure Claude Code phase may run a step's partial commands, each pipe segment matched by its own prefix rule, and nothing beyond what the step and its partials allow.

before:

    --allowedTools Bash(pnpm lint:*),Bash(pnpm test:*),...

after:

    --allowedTools Bash(pnpm lint:*),Bash(pnpm test:*),...,Bash(pnpm exec oxlint:*),Bash(git diff --name-only --diff-filter=d:*),Bash(xargs pnpm exec oxlint:*),Bash(pnpm exec vitest run:*)

## 7. Non-goals

- phax executing a partial command, timing it, or judging a phase on its result.
- phax deriving a partial command or a file list from the diff or the import graph.
- Changing the gate: its steps, commands, order, firing, fix budget or verdict.
- Splitting a gate step into tiers (`pnpm test` → `pnpm test:unit` + `pnpm test:integration`). That is a project choice and worth doing on its own.
- Editing this repository's own `phax.json` to add `partial` in the run that ships this feature.
- Partial commands for any target other than files and the current diff (a package, a test name, a workspace).
- Warning in the prompt or refusing at load a diff command that runs on the whole repository when the diff is empty.
- Authoring, decide, review, brief and plan-extraction prompts, and the guide printed for an interactive stop.
- Watching for or refusing whole-step runs inside a session.

## 8. Acceptance criteria

### A step with both variants is accepted

Given a phax.json whose `pnpm lint` step carries `"partial": { "files": "pnpm exec oxlint <files>", "diff": "git diff --name-only --diff-filter=d | xargs pnpm exec oxlint" }`, and a user overlay profile whose step carries only `partial.files`, when `phax validate` runs, then it succeeds, and the resolved config carries both partial commands verbatim on their steps. (refs §5.1)

### An empty or unknown partial is refused

Given a step at `gateProfiles.standard[3]` with `"partial": {}`, and in a second config a step with `"partial": { "all": "pnpm exec oxlint ." }`, when `phax validate` runs on each, then each exits non-zero with a config refusal naming `gateProfiles.standard[3].partial`. (refs §5.2)

### A files command without a placeholder is refused

Given a step whose `partial.files` is `pnpm exec oxlint src`, when `phax validate` runs, then it exits non-zero with a refusal naming the step's path and `partial.files`. (refs §5.3)

### A diff command with a placeholder is refused

Given a step whose `partial.diff` is `pnpm exec oxlint <files>`, when `phax validate` runs, then it exits non-zero with a refusal naming the step's path and `partial.diff`. (refs §5.4)

### Compound and nested forms are refused

Given one config per construct, each with a `partial.diff` holding one of `;`, `&&`, `||`, a lone `&`, `$(`, a backtick, a line break, `>`, `>>` and a bare `<`, when `phax validate` runs on each, then each exits non-zero with a refusal naming the step's path, `partial.diff` and the construct, while `ls | xargs wc -l` and `pnpm exec oxlint <files>` are accepted. (refs §5.5)

### The prompt shows partial lines under their step

Given a two-phase plan run with a profile whose `pnpm lint` step declares both variants and whose `pnpm test` step declares only `files`, when phax writes the first phase's prompt.md, then under `- local: pnpm lint` come `on some files: pnpm exec oxlint <files>` then `on your changes: git diff --name-only --diff-filter=d | xargs pnpm exec oxlint`, under `- local: pnpm test` comes only its `on some files:` line, and steps without `partial` have no partial line. (refs §5.6)

### The prompt explains partial commands

Given a phase whose gate list holds a step with `partial`, when its prompt is generated, then the gate section says that these commands check part of what their step checks, that a placeholder is replaced with the files the agent chooses, and that phax does not run them, and with the step and partial commands removed the section contains none of `pnpm`, `npm`, `vitest`, `oxlint`, `git` or `cargo`. (refs §5.7, §5.13)

### A terminal step's partial lines follow its step

Given a profile whose terminal `pnpm build` step declares `partial.files`, run on a two-phase plan, when phax writes both phases' prompt.md, then the first phase's gate section has no line for `pnpm build` or its partial command, and the terminal phase's section shows the partial line under `- product: pnpm build`. (refs §5.6)

### No partial leaves the prompt as before

Given a profile in which no step declares `partial`, when a phase prompt is generated, then its gate section is byte-identical to the section generated without this change. (refs §5.8)

### phax never runs a partial command

Given a run in a fixture repository whose steps declare `partial.files` and `partial.diff` commands that each create a marker file when executed, and one phase whose gate fails once and passes after a fix attempt, when the run completes, then no marker file exists in the worktree or the state root, and the commands each gate attempt executed, in order, equal the step commands of the phase gate list. (refs §5.9)

### A secure Claude Code phase allows each segment

Given a secure run on Claude Code with the `pnpm lint` step of ac-accepted and a terminal step declaring `partial.files: "pnpm exec vitest run <files>"`, when the first phase's session is spawned, then its `--allowedTools` value contains `Bash(pnpm exec oxlint:*)`, `Bash(git diff --name-only --diff-filter=d:*)`, `Bash(xargs pnpm exec oxlint:*)` and `Bash(pnpm exec vitest run:*)`, and no rule holds a placeholder or a `|`. (refs §5.10)

### The piped diff command runs under phax's secure flags on Claude Code

Given the real Claude Code CLI under phax's secure flags with the segment rules of ac-claude-rules, in a worktree with an uncommitted change, when the session is asked to run the `partial.diff` command verbatim, and then `pnpm exec oxlint $(git diff --name-only)`, then the stream shows the first call ran and the second was denied. (refs §5.10, §5.5)

### The piped diff command is checked on Mistral Vibe

Given the real Vibe CLI under phax's secure flags with every segment prefix of the `partial.diff` command on its bash allowlist, when the session is asked to run that command verbatim, then the real-CLI suite records from the stream's tool calls whether it ran, and docs/security.md states that result for Vibe. (refs §5.10)

### security.json records the partial source

Given the secure run of ac-claude-rules, with `pnpm exec oxlint` also listed in `security.agentCommands`, when the phase's security.json is written, then `pnpm exec oxlint` is recorded once with `source` "config", `git diff --name-only --diff-filter=d` and `xargs pnpm exec oxlint` are recorded with `source` "partial", and no entry holds a placeholder. (refs §5.11)

### Resume keeps lines and allowlist

Given a secure run interrupted during a phase whose steps declare partial commands, when `phax resume` restarts that phase, then its regenerated prompt shows the same partial lines and its frozen agent commands hold the same segment prefixes as the phase's first session. (refs §5.12)

### Same partial lines for every provider

Given the same phase routed once to Claude Code, once to Codex and once to Vibe, when each prompt is generated, then the three gate sections, partial lines included, are byte-identical. (refs §5.13)

### The generated schema describes partial

Given the generated phax.schema.json and phax.user.schema.json, when they are read, then each gate step's properties include `partial`, an object whose only properties are `files` and `diff` and which needs at least one of them, and the descriptions name the placeholder and that phax never runs these commands. (refs §5.14)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-placeholder — How does a files command mark where the agent's files go, given that phax never fills it in but must find each segment's runnable prefix to allow it?

- named-placeholder — A documented `<name>` placeholder (lowercase word in angle brackets). A segment's allowed prefix is its words before the first placeholder. A files command without one, or a diff command with one, is refused at load. — abandons: Free spelling: a project that writes `FILES` or `{files}` is refused and has to learn the convention.
- free-text — Plain text the agent reads. phax checks nothing and allows each segment's words up to the first token that looks like an argument. — abandons: A deterministic prefix: phax would have to guess where the command ends and the arguments begin, and would sometimes allow too much or too little.
- fixed-files — Exactly `<files>`, one spelling for every project — abandons: Naming what the step wants (`<test-files>`, `<packages>`), which tells the agent what to put there.

Recommendation: named-placeholder — phax must compute an allow prefix for each segment, and only a token phax recognises makes that prefix deterministic. A named placeholder keeps that while still letting a project say what goes there. Learning one documented convention is a small cost next to an allowlist built on a guess.

Decision: named-placeholder — by operator (Rémy Loubradou), 2026-11-04
Why: phax must compute an allow prefix for each segment, and only a token phax recognises makes that prefix deterministic. A named placeholder keeps that while still letting a project say what goes there. Learning one documented convention is a small cost next to an allowlist built on a guess. Advocate: The strongest case for fixed-files: one spelling for every project is the simplest convention to document and check, and the agent always sees the same token. Principles: S1, S3, S5. Reversibility: cheap. Revised: none.

### q-compound — Which ways of joining commands may a partial command use, given that each part must be allowed in secure mode?

- pipes-only — Split on `|` only. Refuse `;`, `&&`, `||`, `&`, `$(…)`, backticks, line breaks and redirections at load, naming the step and the variant. Each segment becomes a prefix rule, and docs/security.md states the known prefix residual. — abandons: Commands that need sequencing or a subshell (`cd pkg && …`, `tool $(git diff --name-only)`); a project must rewrite them as a pipe or a script.
- pipes-and-and — Also accept `&&`, allowing each side as its own prefix — abandons: A small, explicit grammar: more constructs to parse and refuse correctly, for a form that a pipe or a package script already covers.
- unchecked — Accept any string, allow its first word's prefix, and let the provider deny what it cannot check — abandons: A partial command that is known to run: a command phax shows but the provider denies wastes a turn in every session that tries it, and nothing tells the project at load.

Recommendation: pipes-only — The probe shows Claude Code denies `$(…)` even when the exact string is allowed, so allowing nested forms buys nothing. A pipe is enough to feed a file list to a tool. Refusing everything else at load means a project learns at `phax validate` time, not from a denied call in a phase. Rewriting the rare sequenced command as a script is the acceptable loss.

Decision: pipes-only — by operator (Rémy Loubradou), 2026-11-04
Why: The probe shows Claude Code denies `$(…)` even when the exact string is allowed, so allowing nested forms buys nothing. A pipe is enough to feed a file list to a tool. Refusing everything else at load means a project learns at `phax validate` time, not from a denied call in a phase. Rewriting the rare sequenced command as a script is the acceptable loss. Advocate: The strongest case for pipes-and-and: `cd pkg && tool` is a common monorepo form, and allowing each side as its own prefix would let such projects write their partial command directly instead of wrapping it in a script. Principles: S1, S3, S5. Reversibility: cheap. Revised: none.

### q-vibe — Mistral Vibe's prefix allowlist has not been checked on a pipe whose every segment is allowed. How does this spec handle Vibe?

- check-and-record — Show and allow on Vibe the same way. The acceptance includes a real-CLI Vibe check, and docs/security.md records the result. A refused pipe becomes a documented limit, with no Vibe-specific workaround. — abandons: Certainty before shipping: until the check runs, a Vibe phase may be shown a diff command its provider refuses.
- hide-on-vibe — Leave the partial lines out of Vibe phases until a check passes — abandons: The prerequisite's rule that every provider gets a byte-identical gate section, and the files variant on Vibe, which needs no pipe.
- block-on-check — Do not ship until the Vibe check passes — abandons: The feature on Claude Code and Codex, held back for an unknown on one provider.

Recommendation: check-and-record — The gate section stays the same on every provider, as the prerequisite requires. The files variant usually needs no pipe and works on any prefix allowlist. The real-CLI check turns the unknown into a recorded fact. In the worst case a Vibe agent is denied one piped call and falls back to a narrower command or leaves the check to the gate. That costs one turn and puts no run at risk.

Decision: check-and-record — by operator (Rémy Loubradou), 2026-11-04
Why: The gate section stays the same on every provider, as the prerequisite requires. The files variant usually needs no pipe and works on any prefix allowlist. The real-CLI check turns the unknown into a recorded fact. In the worst case a Vibe agent is denied one piped call and falls back to a narrower command or leaves the check to the gate. That costs one turn and puts no run at risk. Advocate: The strongest case for block-on-check: shipping before the check means a Vibe phase can be shown a command its provider refuses, whereas waiting guarantees that what the prompt shows actually runs. Principles: S1, S5. Reversibility: cheap. Revised: none.

### q-empty-diff — With an empty diff, `xargs` may run the tool with no path, which means on the whole repository. Does phax act on that?

- docs-only — phax says nothing. The docs example uses a form that handles an empty diff, and the docs page names the trap, along with untracked new files, which `git diff` does not list. — abandons: Protection for a project that copies a naive form: its diff command quietly turns into a whole-repository run when nothing has changed.
- prompt-warns — The gate section warns the agent that a diff command may check everything when there are no changes — abandons: Tool-agnostic wording: the warning describes one tool's behaviour (xargs) in the fixed text that every project gets.
- refuse-at-load — Refuse an `xargs` segment without `-r` at load — abandons: phax knowing no tool: phax would start encoding one tool's flags, and the rule is wrong on platforms where xargs already skips empty input.

Recommendation: docs-only — The trap belongs to the tool the project chose, and phax knows no tool. A whole-repository run on an empty diff costs one slow check, no worse than what the agent does today. Documenting the safe form where projects copy it from is the cheapest fix that keeps phax tool-agnostic.

Decision: docs-only — by operator (Rémy Loubradou), 2026-11-04
Why: The trap belongs to the tool the project chose, and phax knows no tool. A whole-repository run on an empty diff costs one slow check, no worse than what the agent does today. Documenting the safe form where projects copy it from is the cheapest fix that keeps phax tool-agnostic. Advocate: The strongest case for refuse-at-load: refusing at load is the only option that makes the trap structurally impossible, instead of leaving a project to discover a whole-repository run on its first empty diff. Principles: S1, S10. Reversibility: cheap. Revised: none.

### q-own-profile — When does this repository's own phax.json gain `partial`, given that runs use the released phax, whose config decoder refuses unknown keys?

- follow-up — In a follow-up commit, after the release that accepts `partial` is installed — abandons: Dogfooding in the run itself: the feature ships without phax's own profile using it, and the first real use comes a release later.
- in-run — In the run that ships the feature — abandons: Working runs: the installed phax refuses its own phax.json until the release ships, which breaks every run and record command on this repository in the meantime.

Recommendation: follow-up — Breaking the repository's own config for the released binary is not acceptable. Waiting one release to use the feature here costs only time.

Decision: follow-up — by operator (Rémy Loubradou), 2026-11-04
Why: Breaking the repository's own config for the released binary is not acceptable. Waiting one release to use the feature here costs only time. Advocate: The strongest case for in-run: the run that ships the feature would exercise it on phax's own profile, so a defect shows up before the release instead of a release later. Principles: S1, S4. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- `partial` is optional on a gate step, with exactly two named variants, `files` and `diff`. When present it holds at least one of them. The same shape applies in phax.json, workspace profiles and the user overlay.
- Partial commands are shown, never run. The gate is unchanged: same steps, same whole commands, same verdict.
- The prompt shows each partial command under its step, as `on some files:` and `on your changes:`, and only for steps in the phase gate list.
- In secure mode a partial command is allowed like its step, from every step in the resolved profile whatever its firing. A project does not duplicate it in `security.agentCommands`.
- Wording is project- and provider-agnostic: phax knows no tool.
- The requirements follow the recommendations of the open questions. A different decision on q-placeholder or q-compound changes the files-needs-placeholder, diff-no-placeholder and refuse-compound requirements and their criteria. A different decision on q-vibe changes the Vibe criterion.

Left open:

- The exact prompt wording and the indentation of partial lines (the prompt sketch is indicative).
- The exact refusal messages and the exit code, which follows whatever a config refusal uses today.
- The precedence of "partial" among the agent-command sources (after "gate", before "brief" is the natural place).
- Whether segment prefixes count toward a plan's `requiredCommands` coverage. The default is that they do not: coverage stays as it is today.
- Whether `security.json`'s `$schema` release changes with the new `source` literal, following the repository's schema versioning rules.

Constraints:

- Build the gate section's partial lines from the same resolved steps the gate runs (profile, workspace, firing), as the prerequisite requires for the step lines.
- The frozen agent commands are computed both at phase start and on resume. Both paths must add the segment prefixes.
- No back-compat shims: `partial` is optional by design (a step may have none), but an unknown key under it or an empty `partial` is refused, never ignored.
- Regenerate phax.schema.json and phax.user.schema.json from the schema. Do not hand-edit them.
- Update docs/security.md ("Shell command execution"). Partial segments are allowlisted with their step. State the known prefix residual (an allowed segment prefix accepts any further options, as gate commands already do) and the Vibe result from the real-CLI check.
- The real-CLI checks (Claude Code and Vibe) live in the e2e tier and run deliberately, not in `pnpm check:full`.
- Ship in a release before this repository's phax.json uses `partial`, since runs use the installed phax.

## 11. Docs page

Page: README.md — the gate profiles section (beside "Gate report steps" and "Gate request"), plus a paragraph in docs/security.md "Shell command execution"

Reader: A project maintainer writing phax.json who wants phase agents to check their changes cheaply, with the project's own targeted commands, instead of rerunning whole gate steps.

Example: Add `"partial": { "files": "pnpm exec vitest run <files>", "diff": "pnpm exec vitest run --changed" }` to the `pnpm test` step. Each phase prompt then shows these two commands under the step, and a secure phase may run them without listing them in `security.agentCommands`. phax never runs them, and the gate still runs `pnpm test`. The page names the traps of a diff command written as a pipe: with an empty diff, `xargs` may run the tool on the whole repository unless it skips empty input (`xargs -r`), and `git diff` does not list new untracked files, which a phase worktree holds until phax commits.

## 12. Decision log

- 2026-11-04 q-placeholder decided named-placeholder — operator (Rémy Loubradou)
- 2026-11-04 q-compound decided pipes-only — operator (Rémy Loubradou)
- 2026-11-04 q-vibe decided check-and-record — operator (Rémy Loubradou)
- 2026-11-04 q-empty-diff decided docs-only — operator (Rémy Loubradou)
- 2026-11-04 q-own-profile decided follow-up — operator (Rémy Loubradou)
