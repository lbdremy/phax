---
status: Completed
date: 2026-10-29
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-29
  baseline: 501e7f0
---
# Protected paths: files no phase of a run may change

## 1. Context

Some files of a project record a human decision, and a gate reads them. steme's debt file is one. `steme audit` exits non-zero on a violated leg unless the unit's `steme.baseline.json` accepts it. Each entry carries `acceptedAt`, `acceptedBy` and a `why`, and the gate then reports it as a review note. Lint-exception allowlists, accepted test snapshots and a standard's list that a gate enforces are the same kind of file: the gate's tolerance is written in them.

phax bounds a phase's writes to the worktree and the state root, never to a path inside the worktree. The phase guard refuses phax state commands inside a phase, but it guards against mistakes and is not a boundary. Shell access differs by provider. Claude Code allowlists exactly the gate commands, Codex runs any command inside its OS sandbox, and Vibe matches commands by prefix. The skill edit grants are the inverse case: Claude Code protects `.claude/` by itself, and phax opens declared files through an inline `--settings` object, which it passes only when grants exist. Vibe's `write_file` and `edit` already deny `<root>/.vibe/**` and `<root>/.agents/**`, and phax checks the list in each turn's `export.json`.

A phase runs its agent turn, then its gate with a same-session fix loop. When the gate passes, phax commits, reconciles the commit (created, edited, deleted, renamed) and runs the handoff turn. An exhausted loop pauses the phase in `gates_exhausted` with exit 4. A commit failure pauses it as interrupted, and a commit-only resume runs no gate. A person's change at an interactive or held stop is a `reviewCorrections` entry. security.json is at version 2.

Provider facts, checked by the operator in the installed CLIs on 2026-10-29. The real-CLI e2e criteria below hold them.
- Claude Code 2.1.312. `permissions.deny` rules hold in the inline `--settings` object. For file writes only `Edit(<pattern>)` rules match. `//<path>` is absolute. Write and Edit check edit-deny rules in their own input validation, whatever the permission mode, so the rules hold under `acceptEdits` in headless `-p`. Bash `>` redirects are checked too, but not `sed -i`, `cp` or scripts. Rules are matched gitignore-style by the `ignore` library: a path also matches when one of its parent folders does, and letter case is ignored. `[` opens a class.
- Mistral Vibe 3.0.3. The `denylist` key of `write_file` and `edit` in `VIBE_TOOLS` is matched by `fnmatch.fnmatch` against the absolute resolved path (vibe/core/tools/utils.py, `resolve_path_permission`). The match is case-sensitive on POSIX. In fnmatch, `*` and `?` cross `/`, and `[` opens a class. For a literal path `x`, the two entries `<worktree>/x` and `<worktree>/**/x` match exactly the paths phax's `**/x` matches, letter case aside.
- Codex 0.165. Permission profiles can make exact paths read-only under the OS sandbox, but they replace phax's `sandbox_mode` overrides.

Ground read:

- `docs/security.md` — Provider Capabilities, Skill edit grants (inline --settings, exit 11 preflight, skillEditGrants recorded for every provider), Shell command execution (Claude exact allowlist, Codex OS sandbox, Vibe prefix allowlist), Security Artifacts (security.json version 2).
- `src/domain/security/skillEditGrants.ts` — The inverse case: exact repo-relative files opened for a run started with --allow-skill-edits; globs, absolute paths and .. segments are dropped.
- `src/infra/providers/claudeSkillEditSettings.ts` — Builds the inline --settings object (PermissionRequest hooks only), and returns undefined when there are no grants.
- `src/domain/session/claudePermissionFlags.ts` — Secure Claude flags: acceptEdits, --add-dir, Bash allowlist of the agent commands, and --settings only when grant settings exist.
- `src/domain/session/vibeFlags.ts` — VIBE_TOOLS: write_file and edit already carry denylist [<root>/.vibe/**, <root>/.agents/**] for every root.
- `src/schemas/architecture.ts` — ArchitectureGlobSchema and GLOB_DIALECT: root-relative POSIX globs, ** as a whole segment, * and ? within a segment, every other character literal, matched case-sensitively.
- `src/domain/architecture/glob.ts` — phax's matcher for that dialect.
- `src/app/loadConfig.ts` — A user overlay (phax.local.json, ~/.phax/config.json) carrying assignments is refused before decode with '"assignments" is accepted only in phax.json'.
- `src/schemas/securityPosture.ts` — security.json version 2, read strictly; version 1 is lifted with stop: null by readSecurityPosture.
- `src/app/executePlan.ts` — Phase order: agent turn, gate with fix loop (runGatesWithFixLoop), commitPhase, reconciliation, generatePhaseHandoff; a commit failure pauses the phase as interrupted; a commit-only resume runs no gate.
- `src/app/commit.ts` — commitPhase commits whatever the worktree holds after the gate passed.
- `src/app/fixLoop.ts` — A failed attempt dispatches GateFailed, then resumes the same session with buildFixPrompt until agent.maxFixAttempts; then FixAttemptsExhausted pauses the phase in gates_exhausted (exit 4).
- `src/domain/gate/fixPrompt.ts` — The fix prompt: failed step, findings or raw log, then a Required action section.
- `src/app/cleanup.ts` — Cleanup of a non-final phase refuses a dirty worktree; the final phase skips cleanup and stays open for review.
- `src/app/resumeInstructions.ts` — At gates_exhausted, resume-instructions.md says: fix the gate manually in the worktree, then resume; the gate re-runs first.
- `docs/specs/archive/2610290829-protected-paths.md` — The abandoned first draft (detection at every check point, restore, operator attribution, plan lint and preflight), kept only as the scope this spec drops.
- `src/app/worktree.ts` — preparePhaseBranch creates the phase branch from the previous phase's branch (after a held stop its tip is the review commit) and returns its commit as the base, which createPhaseFolder (src/app/phaseFolder.ts) records in status.json.
- `src/domain/reconciliation/parseNameStatus.ts` — Parses `--name-status` output split on newlines and drops the `T` (type change) code.
- `src/schemas/gateAttribution.ts` — gate-attribution.json: phase and steps; published as packages/schemas/snapshots/gate-attribution, latest release 0.26.0.
- `src/app/closeStop.ts` — A stop's close calls runGates too, so the check sits in the fix loop, not in runGates.

## 2. Problem

An agent that cannot fix a hole can write its acceptance into the file the gate reads, and the gate then passes. In steme-lab's run `steme-gates-steme-2` (2026-10-28), phase-05's agent (Sonnet, medium effort) wrote nine entries into `packages/rust/steme-formats/steme.baseline.json`. Each was signed `"acceptedBy": "the author"`, and the author saw none of them before the phase's commit. The plan's preamble allowed it, since it said an unfixable hole "is accepted as debt" in that file. Nothing in phax could have stopped it. A plan's prose is not a boundary, and the write sandbox lets the agent, or any command it runs, write anywhere in the worktree. Once an agent may edit the file that decides whether its own work passes, the gate no longer checks the work. It checks only whether the agent agrees with itself. A project has no way to say which files are the operator's decision.

## 3. Product goal

A project names, in phax.json, the files whose change is the operator's decision. No phase of a run may create, change, delete or rename them: not the agent, not its fix loop, not its handoff turn, not a gate command. Prevention is the providers' own: phax carries the list into each provider's native write rules where the provider can express it exactly, and adds no write interception of its own. The guarantee is one check of the phase's files against the phase base. A phase that would change a protected path fails its gate as any phase that cannot meet its gate does, and the change becomes the operator's to make outside the run's phases. A project that declares nothing sees no change.

> A phase never lands a change to a file that decides whether its own work passes; what it cannot fix stays failing and reaches the operator.

## 4. Terminology

- **Protected list** — The globs of phax.json's top-level `protectedPaths`, in phax's glob dialect, followed by `phax.json` itself unless already listed. A declared entry is named `protectedPaths[N]`, counted from 0.
- **Protected path** — A working-tree-root-relative POSIX path that a glob of the protected list matches (see q-case for letter case).
- **Phase base** — The commit a phase started from: the `base` that the phase's status.json records when phax creates the phase's branch. It is the run's base for the first phase. For a later phase it is the tip of the previous phase's branch, which after a held stop is the person's review commit.
- **Protected change** — A protected path whose file in the phase worktree differs from the phase base: created, edited or deleted. A rename counts on both its old and its new path. A type change, such as a protected file replaced by a symbolic link, counts as edited. The file on disk counts, not what git's index says of it, and an untracked file counts whether git ignores it or not.
- **Protected-path check** — phax's comparison of the phase's files with the protected list. It is the guarantee, and it holds whatever wrote the file: an edit tool, a shell command, a gate step, or a provider whose native rule does not apply. It runs in the phase's fix loop, after the gate steps, and reads the files themselves, not git's diff alone.
- **Native rule** — A provider's own refusal of a write to a path, which phax configures for each session.
- **Enforcement** — For a phase and its provider, how much of the protected list native rules cover: `enforced` (every glob), `partial` (some globs) or `commit-check-only` (none).

## 5. Functional requirements

### 5.1 Declaring the protected list

WHERE phax.json declares a top-level `protectedPaths` THE system SHALL accept it only as a non-empty list of globs that phax's glob dialect admits, and refuse any other value with exit 2, naming the offending entry as `protectedPaths[N]`.

### 5.2 The project layer only

IF phax.local.json or ~/.phax/config.json carries `protectedPaths` THEN loading the configuration SHALL fail with exit 2 before that overlay is decoded, with the message `"protectedPaths" is accepted only in phax.json`, naming the overlay file.

### 5.3 phax.json protects itself

WHERE phax.json declares `protectedPaths` THE system SHALL treat `phax.json` as a protected path too.

### 5.4 No glob inside a submodule

IF a glob of the protected list lies inside a submodule declared in the repository's `.gitmodules`, its leading literal segments being the submodule's path or a path below it, THEN `phax validate` and every command that loads the configuration SHALL refuse it with exit 2, naming the entry as `protectedPaths[N]` and the submodule's path.

### 5.5 Nothing declared, nothing changes

WHILE phax.json declares no `protectedPaths` THE system SHALL run every phase with the same provider argv and environment, phase prompt, fix prompts, gate attempts and output as before this change.

### 5.6 Native rule on Claude Code

WHERE a phase's session runs on claude-code in secure mode THE system SHALL deny Claude Code's file-editing tools every glob of the protected list that is a literal path (none of `*`, `?`, `[` and `]`) or `**/` followed by one, as one `Edit(/<worktree>/<glob>)` rule, `<worktree>` being the worktree's absolute path so that the rule starts with `//`, in the session's inline settings, merged with any skill edit grants, for the phase turn, each fix attempt and the handoff turn, and give every other glob no native rule.

### 5.7 Native rule on Mistral Vibe

WHERE a phase's session runs on mistral-vibe in secure mode THE system SHALL add to the `write_file` and `edit` denylists `<worktree>/<glob>` for every glob of the protected list that holds none of `*`, `?`, `[` and `]`, the two entries `<worktree>/<path>` and `<worktree>/**/<path>` for every glob that is `**/` followed by such a path, and give every other glob no native rule.

### 5.8 No native rule elsewhere

WHERE a phase runs on codex-cli, or in a mode other than secure, THE system SHALL pass no native rule for the protected list and record its enforcement as `commit-check-only`.

### 5.9 The check fails the gate attempt

WHEN a gate attempt of a phase has run its steps THE system SHALL run the protected-path check in the phase's fix loop and fail that attempt if the phase holds a protected change, whatever its steps' exit codes, naming each protected change with its kind and its matching entry.

### 5.10 Type changes and non-ASCII paths

The protected-path check shall count a type change of a protected path, such as a protected file replaced by a symbolic link, as edited, and shall read git's path lists NUL-separated, so that a path holding non-ASCII characters is matched and case-folded as it is written.

### 5.11 Changes git does not show

The protected-path check shall compare, for every tracked path of the phase base that the protected list matches, the file in the phase worktree with its blob at the phase base, whatever git's index records for that path, counting a missing file as deleted and a different type as edited, and shall count every untracked file that the list matches as created, whether git ignores it or not.

### 5.12 The commit carries no protected change

IF a phase's worktree holds a protected change when no gate attempt has run in that entry (a commit-only resume) THEN the system SHALL refuse the commit and pause the phase as a failed commit, naming each protected change.

### 5.13 Telling the fix loop

WHEN a gate attempt fails on protected changes THE system SHALL resume the agent through the usual fix loop with a prompt that names each change, says the path is the operator's decision, asks that it be put back to its content at the phase base, and says the hole is fixed in code or left failing.

### 5.14 A step failure and a protected change together

WHEN a gate attempt holds protected changes and one of its steps also failed or was refused THE system SHALL name both: the fix prompt SHALL carry the step's failure and the protected changes, and a refused gate report that pauses the phase before any fix attempt SHALL name the protected changes in the output and in resume-instructions.md.

### 5.15 What is left goes to the operator

WHEN the fix attempts of a phase are exhausted with protected changes in its last failed attempt THE system SHALL pause the phase in `gates_exhausted` with exit 4, with resume-instructions.md naming each protected path still changed, pointing to the last fix attempt's transcript (`fix-attempt-NN.jsonl` in the phase folder), saying that phax refuses any change to it within the run's phases, and giving the two ways on: put each file back to its content at the phase base and run `phax resume <run> --yes`, or make the change on the base branch and start a new run.

### 5.16 The handoff turn after the commit

IF a protected path in the phase worktree differs from the phase's commit, checked after the handoff turn and again at every resume out of a failed handoff, a held phase's resume at its hold point with no new handoff turn included, THEN the system SHALL pause the phase as a failed handoff, naming each such path, before the handoff is validated and copied, and without recording the phase as done.

### 5.17 Telling the agent up front

WHERE phax.json declares `protectedPaths` THE phase prompt SHALL carry a Protected paths section naming every glob of the protected list and saying that a hole the agent cannot fix in code is left failing and explained, never accepted in a protected file or worked around.

### 5.18 A stop's close is the person's

WHILE phax closes a declared or held stop THE system SHALL not apply the protected-path check to the close's gate or commit, the person's changes being `reviewCorrections` as today.

### 5.19 A skill edit grant on a protected path

IF a run's skill edit grants (`--allow-skill-edits`) include a file that the protected list matches THEN `phax run` and `phax resume` SHALL refuse the run at preflight with exit 11, as other grant refusals are, naming the granted file and the matching entry, before any phase runs.

### 5.20 Recording the protection

The system shall write every phase's security.json at version 3, with a required `protectedPaths` field that is `null` when phax.json declares none, and otherwise holds the protected list's `globs` and the phase's `enforcement`.

### 5.21 Reading older records

WHEN phax reads a version 2 security.json, or a version 1 one, THE system SHALL read it as version 3 with `protectedPaths: null`, a version 1 file also gaining `stop: null`.

### 5.22 Recording the check in gate-attribution.json

The system shall write the phase's gate-attribution.json at the shape of release 0.31.0, with a required `protectedPaths` field that is `null` when phax.json declares none, and otherwise holds the check's `result` and its `changes`, each change with its `path`, `kind` and `entry`.

### 5.23 Letter case

The system shall match the protected list against the phase's changed paths ignoring letter case, on every host.

## 6. Surface

### config: phax.json protectedPaths — normative

Summary: A project lists, in phax.json, the files whose change is the operator's decision, and no phase of a run may land a change to them.

before:

    {
      "version": 1,
      "gateProfiles": {
        "default": [{ "command": "steme audit" }]
      },
      "security": { "profile": "secure" }
    }

after:

    {
      "version": 1,
      "gateProfiles": {
        "default": [{ "command": "steme audit" }]
      },
      "protectedPaths": ["**/steme.baseline.json"],
      "security": { "profile": "secure" }
    }

### cli: phax validate — normative

Summary: Running `phax validate` lists the protected paths and refuses a malformed list, one set outside phax.json, or a glob inside a submodule.

before:

    $ phax validate
    ✓ config is valid (project: steme-lab)
      project: /work/steme-lab/phax.json
      local:   (none)
      global:  (none)

after:

    $ phax validate
    ✓ config is valid (project: steme-lab)
      project: /work/steme-lab/phax.json
      local:   (none)
      global:  (none)
      protected paths: **/steme.baseline.json, phax.json

    $ phax validate          # phax.json: "protectedPaths": ["../shared/allow.json"]
    Config validation failed: protectedPaths[0]: "../shared/allow.json" has a .. segment
      at: /work/steme-lab/phax.json
    $? = 2

    $ phax validate          # phax.local.json: "protectedPaths": []
    Config validation failed: "protectedPaths" is accepted only in phax.json
      at: /work/steme-lab/phax.local.json
    $? = 2

    $ phax validate          # phax.json: "protectedPaths": ["vendor/lint-rules/allow.json"]; .gitmodules: vendor/lint-rules
    Config validation failed: protectedPaths[0]: "vendor/lint-rules/allow.json" is inside the submodule vendor/lint-rules
      at: /work/steme-lab/phax.json
    $? = 2

### cli: phax run — indicative

Summary: During a run the operator sees a gate attempt fail on each protected file the phase changed, and an exhausted phase names the files left for them to decide, the agent's last fix transcript and the two ways on.

before:

    ✗ phase-05 gate attempt 3 failed: steme audit (exit 1)
    This run paused because its gate checks failed after exhausting all fix attempts.
    Fix the gate manually in the worktree, then resume — the gate is re-run first on
    resume, and if it passes the phase commits with no fresh agent invocation.
    $? = 4

after:

    ✗ phase-05 gate attempt 3 failed: protected paths changed
        packages/rust/steme-formats/steme.baseline.json  edited  (protectedPaths[0] **/steme.baseline.json)
    This run paused because its gate checks failed after exhausting all fix attempts.
    Protected paths this phase changed, which no phase may change:
      packages/rust/steme-formats/steme.baseline.json (edited)
    The agent's last fix attempt: ~/.phax/runs/steme-lab.audit-legs/phase-05/fix-attempt-02.jsonl
    They are yours to decide, outside this run's phases. Either put each file back to its
    content at the phase base and run `phax resume audit-legs --yes`, or make the change
    on the base branch and start a new run.
    $? = 4

### internal: phase prompt and fix prompt — indicative

Summary: The agent is told which files are the operator's, and when its gate fails on one, that it must put the file back and fix the hole in code or leave it failing.

before:

    ## Required action

    Fix all issues revealed by the gate output above.
    Make the minimum changes required to pass the gate.

after:

    ## Protected paths

    These files are the operator's decision. No phase may create, change, delete or rename
    them, by any tool or command:
    - **/steme.baseline.json
    - phax.json

    If a hole cannot be fixed in the code, leave the gate failing and explain the hole in
    your reply. Never accept it in a protected file, and never work around it.

    (fix prompt)
    **Failed step:** protected paths

    ## Protected paths changed

    - packages/rust/steme-formats/steme.baseline.json — edited (protectedPaths[0] **/steme.baseline.json)

    ## Required action

    Put each path above back to its content at the phase base, then fix the hole in the
    code or leave the gate failing. If your tools cannot put a path back, say so.

### internal: provider native rules — indicative

Summary: Claude Code and Mistral Vibe refuse an edit to a protected file before it is written, for every glob that is a literal path or `**/` followed by one.

before:

    claude -p … --permission-mode acceptEdits --allowedTools "Bash(steme audit:*)"

    VIBE_TOOLS='{…,"write_file":{"allowlist":[],"denylist":["/wt/.vibe/**","/wt/.agents/**"],"outside_workdir":"deny"},"edit":{…}}'

after:

    claude -p … --permission-mode acceptEdits --allowedTools "Bash(steme audit:*)" \
      --settings '{"permissions":{"deny":["Edit(//wt/**/steme.baseline.json)","Edit(//wt/phax.json)"]}}'

    VIBE_TOOLS='{…,"write_file":{"allowlist":[],"denylist":["/wt/.vibe/**","/wt/.agents/**","/wt/steme.baseline.json","/wt/**/steme.baseline.json","/wt/phax.json"],"outside_workdir":"deny"},"edit":{…}}'

### file: <run>/<phase-id>/security.json — normative

Summary: A phase's security record shows the protected paths and how much of the list its provider refused natively, or `null` when the project declares none.

before:

    {
      "version": 2,
      "mode": "secure",
      "provider": "mistral-vibe",
      "skillEditGrants": [],
      "providerSkippedForSecurity": [],
      "stop": null
    }

after:

    {
      "version": 3,
      "mode": "secure",
      "provider": "mistral-vibe",
      "skillEditGrants": [],
      "protectedPaths": {
        "globs": ["**/steme.baseline.json", "phax.json"],
        "enforcement": "enforced"
      },
      "providerSkippedForSecurity": [],
      "stop": null
    }

    "protectedPaths": null        (no protectedPaths in phax.json)
    "enforcement": "enforced" | "partial" | "commit-check-only"

### file: <run>/<phase-id>/gate-attribution.json — normative

Summary: A phase's gate attribution shows the protected-path check's result and each protected change, or `null` when the project declares none.

before:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/0.26.0.json",
      "phase": "phase-05",
      "steps": [
        { "command": "steme audit", "surface": "local", "result": "pass" }
      ]
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/0.31.0.json",
      "phase": "phase-05",
      "steps": [
        { "command": "steme audit", "surface": "local", "result": "pass" }
      ],
      "protectedPaths": {
        "result": "fail",
        "changes": [
          {
            "path": "packages/rust/steme-formats/steme.baseline.json",
            "kind": "edited",
            "entry": "protectedPaths[0]"
          }
        ]
      }
    }

    "protectedPaths": null        (no protectedPaths in phax.json)
    "result": "pass" | "fail"     ("changes" is [] on pass)
    "kind": "created" | "edited" | "deleted" | "renamed"

### file: phax.usage.kdl — indicative

Summary: The help of `phax run` and `phax validate` says how protected paths behave.

before:

    cmd "validate" {
        help "Validate phax.json and its user overlays without any side effects; pass --plan to also validate a phax-plan.json"
        long_help "…"
    }

after:

    cmd "validate" {
        help "Validate phax.json and its user overlays without any side effects; pass --plan to also validate a phax-plan.json"
        long_help "… Lists the protected paths; protectedPaths is refused in phax.local.json and ~/.phax/config.json …"
    }
    cmd "run" {
        long_help "… A gate attempt fails when the phase changed a path listed in protectedPaths …"
    }

### file: docs/security.md — indicative

Summary: The security guide gains a Protected paths section saying what each provider refuses natively and what the commit check catches.

before:

    ### Skill edit grants (Claude Code)
    …
    ### Shell command execution

after:

    ### Skill edit grants (Claude Code)
    …
    ### Protected paths

    | Provider       | Native rule                                   | Enforcement            |
    | -------------- | --------------------------------------------- | ---------------------- |
    | `claude-code`  | `Edit(//…)` deny, literal and `**/` paths      | enforced or partial    |
    | `mistral-vibe` | `write_file`/`edit` denylist, literal and `**/` paths | enforced or partial |
    | `codex-cli`    | none (permission profiles: later)              | commit-check-only      |

    ### Shell command execution

## 7. Non-goals

- Detecting or restoring protected files after each turn: phax checks the phase's files against the phase base, and restores nothing.
- Telling an operator's change from an agent's within a phase.
- A route to change a protected file while a phase is paused.
- Plan lint and preflight checks of planned files: a plan that plans a protected file fails at that phase's gate.
- `phax security status` columns and a final-report table for protected paths.
- Codex permission profiles: replacing the `sandbox_mode` overrides is the later route to a native rule on Codex.
- The commands a project's own tool offers to change such a file, such as steme's `debt accept`.
- Paths outside the worktree.
- Files inside a submodule: a glob that reaches into one is refused.
- What a protected file means or whether its content is valid.

## 8. Acceptance criteria

### The list is read and shown

Given phax.json with `"protectedPaths": ["**/steme.baseline.json"]`, when `phax validate` runs, then it exits 0 and prints `protected paths: **/steme.baseline.json, phax.json`. (refs §5.1, §5.3)

### A malformed list is refused

Given phax.json with `"protectedPaths": []`, then `["../shared/allow.json"]`, then `["/abs/x.json"]`, when `phax validate` runs on each, then each exits 2; the second and third name `protectedPaths[0]` and the rule the entry breaks. (refs §5.1)

### An overlay cannot set the list

Given phax.json declaring `protectedPaths` and a phax.local.json carrying `"protectedPaths": []`, then the same key in ~/.phax/config.json, when `phax validate` or `phax run` loads the configuration, then it exits 2 with `"protectedPaths" is accepted only in phax.json`, naming the overlay file. (refs §5.2)

### A glob inside a submodule is refused

Given a .gitmodules declaring the submodule `vendor/lint-rules`, and phax.json with `"protectedPaths": ["vendor/lint-rules/allow.json"]`, when `phax validate` runs, then `phax run`, then each exits 2 naming `protectedPaths[0]` and the submodule `vendor/lint-rules`. (refs §5.4)

### A project that declares nothing

Given a project whose phax.json has no `protectedPaths`, when a phase runs on each provider through the fake CLIs, with a red gate attempt then a green one, then the argv, environment, phase prompt, fix prompt, gate logs and run output equal those of the current release, security.json differs only by `"version": 3` and `"protectedPaths": null`, and gate-attribution.json only by its 0.31.0 `$schema` and `"protectedPaths": null`. (refs §5.5, §5.20, §5.22)

### An agent's edit fails the gate attempt

Given `protectedPaths` ["**/steme.baseline.json"] on codex-cli and a fake agent that adds an entry to packages/rust/steme-formats/steme.baseline.json and makes every gate step pass, when the gate attempt runs, then the attempt fails naming the path, `edited` and `protectedPaths[0]`, the fix loop resumes the session, and nothing is committed. (refs §5.9, §5.8)

### A gate step that writes a protected file

Given a gate profile whose step `node scripts/accept-debt.js` writes packages/a/steme.baseline.json and exits 0, and every other step passes, when the gate attempt runs, then the attempt fails naming the path, although every step exited 0. (refs §5.9)

### An allowed command that writes one

Given a phase on claude-code in secure mode, through the fake CLI, whose agent runs the allowlisted gate command `pnpm snapshot:update`, which rewrites a protected snapshot through a script, when the gate attempt runs, then the check fails the attempt naming the snapshot path: a write made by an allowed command is caught whatever the native rules. (refs §5.9)

### Creations, deletions and renames count

Given a fake agent that creates packages/a/steme.baseline.json, deletes packages/b/steme.baseline.json and renames packages/c/steme.baseline.json to packages/c/old.json, when the gate attempt runs, then the attempt fails naming packages/a (created), packages/b (deleted) and packages/c/steme.baseline.json (renamed); a rename of packages/d/x.json to packages/d/steme.baseline.json is named too. (refs §5.9)

### A type change and a non-ASCII path count

Given `protectedPaths` ["**/steme.baseline.json", "**/règles.json"] and a fake agent that replaces packages/a/steme.baseline.json with a symbolic link and creates packages/b/RÈGLES.json, when the gate attempt runs, then the attempt fails naming packages/a/steme.baseline.json (edited) and packages/b/RÈGLES.json (created), spelt as written. (refs §5.10, §5.9)

### An edit hidden from git's diff is caught

Given `protectedPaths` ["**/steme.baseline.json"] and a fake agent that runs `git update-index --skip-worktree packages/a/steme.baseline.json`, then adds an entry to that file, when the gate attempt runs, then the attempt fails naming packages/a/steme.baseline.json (edited), although `git diff` shows no change. (refs §5.11, §5.9)

### A protected file created under an ignored folder is caught

Given a .gitignore listing `generated/`, `protectedPaths` ["**/allow.json"] and a fake agent that creates generated/allow.json, when the gate attempt runs, then the attempt fails naming generated/allow.json (created). (refs §5.11, §5.9)

### phax.json cannot empty its own list

Given phax.json declaring `protectedPaths` and a fake agent that removes the key from phax.json in the phase worktree, when the gate attempt runs, then the attempt fails naming `phax.json`. (refs §5.3, §5.9)

### The fix prompt says whose file it is

Given a gate attempt failed on packages/a/steme.baseline.json, when the fix loop resumes the agent, then the fix prompt names the path and its change, says it is the operator's decision, asks that it be put back to the phase base, and says the hole is fixed in code or left failing. (refs §5.13)

### A failed step and a protected change are both named

Given a gate attempt where `steme audit` exits 1 and packages/a/steme.baseline.json is edited, then one where a gate-report step's report is refused and the same file is edited, when the fix loop resumes the agent after the first, and the phase pauses after the second, then the fix prompt carries the `steme audit` failure and the protected path; after the refusal, with no fix attempt made, the output and resume-instructions.md name the refused step and the protected path. (refs §5.14)

### What the loop cannot fix reaches the operator

Given a fake agent that leaves packages/a/steme.baseline.json changed at every attempt, when the fix attempts are exhausted, then the phase is in `gates_exhausted`, phax exits 4, and the output and resume-instructions.md name the path, say no phase may change it, point to the last fix attempt's `fix-attempt-NN.jsonl`, and give the two ways on: put the file back and run `phax resume <run> --yes`, or make the change on the base branch and start a new run. (refs §5.15)

### A commit-only resume cannot carry one

Given a phase paused as a failed commit, and a protected path changed in its worktree since, when `phax resume` reaches the commit, then no commit is made, the phase pauses again as a failed commit and the reason names the path. (refs §5.12)

### A handoff turn's write stops the phase

Given a green gate and a fake agent whose handoff turn writes packages/a/steme.baseline.json, when the handoff turn ends, then the phase commit holds the file at its phase-base content, the phase pauses as a failed handoff naming the path, no handoff is copied, and no phase record is written. (refs §5.16)

### A resume at the hold point is checked too

Given a held phase paused as a failed handoff with its handoff already validated and copied, and packages/a/steme.baseline.json changed in its worktree since, when `phax resume` re-enters the phase at its hold point, with no handoff turn, then the phase pauses again as a failed handoff naming the path, and no stop is opened. (refs §5.16)

### The agent is told up front

Given `protectedPaths` ["**/steme.baseline.json"], when phax builds the phase prompt, then it carries a `## Protected paths` section listing `**/steme.baseline.json` and `phax.json` and the instruction to leave an unfixable hole failing and explain it. (refs §5.17)

### Claude Code gets the deny rules

Given a phase on claude-code in secure mode in the worktree `/wt`, with `protectedPaths` ["**/steme.baseline.json", "config/*.json", "locks/[a].json"] and one skill edit grant, when phax spawns the phase turn, a fix attempt and the handoff turn, then each argv carries one `--settings` object holding the grant's hooks and the deny rules `Edit(//wt/**/steme.baseline.json)` and `Edit(//wt/phax.json)`, none for `config/*.json` or `locks/[a].json`, and security.json records `"enforcement": "partial"`. (refs §5.6, §5.20)

### Claude Code refuses the edit natively

Given the real Claude Code CLI in secure mode and `protectedPaths` ["**/steme.baseline.json"], when the agent is asked to Write and Edit packages/a/steme.baseline.json in the real-CLI e2e suite, then the file is unchanged, and the transcript shows a denied tool result for each call. (refs §5.6)

### Vibe gets literal and `**/` paths

Given a phase on mistral-vibe in secure mode with `protectedPaths` ["**/steme.baseline.json", "config/*.json"], when phax spawns a turn, then the `write_file` and `edit` denylists hold `<worktree>/steme.baseline.json`, `<worktree>/**/steme.baseline.json` and `<worktree>/phax.json` after the `.vibe` and `.agents` guards, nothing for `config/*.json`, the post-turn read-back accepts that list, and security.json records `"enforcement": "partial"`. (refs §5.7, §5.20)

### Vibe refuses the edit natively

Given the real Vibe CLI in secure mode and `protectedPaths` ["config/limits.json", "**/allow.json"], when the agent is asked to write_file and edit config/limits.json, allow.json at the worktree root and packages/a/allow.json in the real-CLI e2e suite, then every call is refused and every file is unchanged. (refs §5.7)

### Codex and unsafe mode rely on the check

Given `protectedPaths` declared, a phase on codex-cli in secure mode, then a phase on claude-code with `--security unsafe`, when phax spawns each phase turn, then neither argv carries a protected-path rule, both security.json files record `"enforcement": "commit-check-only"`, and a write to a protected path fails the gate attempt in both. (refs §5.8, §5.9)

### A stop's close is not checked

Given a held stop where a person edits packages/a/steme.baseline.json in the phase worktree, when `phax resume` closes the stop with a green gate, then the close's gate passes, the review commit carries the change and correction-reconciliation.json lists it under reviewCorrections. (refs §5.18)

### A skill edit grant on a protected path is refused

Given a plan whose phase declares the skill file `.claude/skills/release/SKILL.md`, and phax.json with `"protectedPaths": [".claude/skills/**"]`, when `phax run --allow-skill-edits` starts the plan, then it exits 11 before any phase runs, naming `.claude/skills/release/SKILL.md` and `protectedPaths[0]`. (refs §5.19)

### Older records read as version 3

Given a version 2 security.json and a version 1 one, when phax reads each, then both read as version 3 with `protectedPaths: null`, the version 1 file also with `stop: null`. (refs §5.21)

### gate-attribution.json records the check

Given a gate attempt whose every step passed and that edited packages/a/steme.baseline.json, when phax writes the phase's gate-attribution.json, then it carries the 0.31.0 `$schema` and `"protectedPaths": {"result": "fail", "changes": [{"path": "packages/a/steme.baseline.json", "kind": "edited", "entry": "protectedPaths[0]"}]}`, and a project that declares none gets `"protectedPaths": null`. (refs §5.22)

### A case variant is caught

Given the protected list ["**/steme.baseline.json", "phax.json"], when phax's protected-path matcher is given packages/a/STEME.Baseline.json, as a unit test with no filesystem, then it matches, naming `protectedPaths[0]`, so the check names the path on every host. (refs §5.23)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-case — How does the protected-path check treat letter case, when phax's glob dialect matches case-sensitively?

- fold-always — Ignore case on every host — abandons: One matcher for the dialect: protectedPaths matches unlike the architecture parts and assignment bounds, and a file whose name differs from a protected one only by case is protected too on a case-sensitive host.
- fold-where-insensitive — Ignore case only where the worktree's filesystem is case-insensitive — abandons: Host independence: the same phase diff passes on Linux and fails on macOS, and the check depends on probing the filesystem.
- exact-case — Match case-sensitively, as the dialect does — abandons: The guarantee on case-insensitive filesystems: an agent that creates `STEME.Baseline.json` where none existed lands a file the gate reads as the baseline on macOS.

Recommendation: fold-always — Git reports an existing file under its tracked spelling, so the only gap is a new case variant, and closing it everywhere costs only a name that differs from a protected one by case alone, which is suspect in itself. Native rules stay as each provider matches them: the check is the guarantee.

Decision: fold-always — by operator (Rémy Loubradou), 2026-10-29
Why: Git reports an existing file under its tracked spelling, so the only gap is a new case variant, and closing it everywhere costs only a name that differs from a protected one by case alone, which is suspect in itself. Native rules stay as each provider matches them: the check is the guarantee. Advocate: The strongest case for exact-case: it keeps one matcher for the whole dialect, so protectedPaths behaves like the architecture parts and assignment bounds, and a legitimately distinct file such as `Steme.Baseline.json` on a case-sensitive host is not swept in. Principles: S1, S2. Reversibility: cheap. Revised: none.

### q-handoff — The handoff turn runs after the phase commit. What happens to a protected path it leaves changed in the worktree?

- pause-handoff — Check after the handoff turn and pause the phase as a failed handoff, naming each path — abandons: A single check point: the check runs once more, after the one turn that follows the commit.
- leave-to-next — No check; the change stays uncommitted — abandons: A named refusal: a non-final phase pauses at cleanup on a generic dirty worktree, and after the final phase the change sits in the review worktree, where a reviewer may commit it unaware.

Recommendation: pause-handoff — The handoff turn has write tools on Codex and on globs without a native rule, and the final phase's leftovers reach a person who would not know the file is protected. One more check, at the one turn after the commit, keeps the guarantee for every turn of the phase.

Decision: pause-handoff — by operator (Rémy Loubradou), 2026-10-29
Why: The handoff turn has write tools on Codex and on globs without a native rule, and the final phase's leftovers reach a person who would not know the file is protected. One more check, at the one turn after the commit, keeps the guarantee for every turn of the phase. Advocate: The strongest case for leave-to-next: the commit is already made and gated, so the check keeps a single check point, and the stray change sits uncommitted where cleanup or the reviewer sees it as a dirty worktree. Principles: S1, S3. Reversibility: cheap. Revised: none.

### q-report — No handoff turn runs at `gates_exhausted`. Where does the agent's account of a hole it could not fix reach the operator?

- paths-and-pointer — resume-instructions.md names the paths and points to the last fix transcript — abandons: Reading the agent's reasons in the pause file: the operator opens the transcript to see why the agent could not fix the hole.
- quote-reply — resume-instructions.md quotes the agent's last fix reply — abandons: A short, fixed-shape pause file: it would carry free text of any length, which the agent writes, into the one file the operator reads to resume.

Recommendation: paths-and-pointer — The pause file states facts phax checked, and the agent's account is one link away in the transcript phax already keeps. Quoting the reply would let the agent write into the operator's instructions.

Decision: paths-and-pointer — by operator (Rémy Loubradou), 2026-10-29
Why: The pause file states facts phax checked, and the agent's account is one link away in the transcript phax already keeps. Quoting the reply would let the agent write into the operator's instructions. Advocate: The strongest case for quote-reply: the operator reads the agent's reasons in the one file they open to resume, without a second hop to a transcript. Principles: S1, S5. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- Prevention is the providers' own; phax adds no write interception, no per-turn detection and no restore.
- The guarantee is the protected-path check of the phase's files, relative to the phase base. It runs in the phase's fix loop (src/app/fixLoop.ts) after `runGates` returns, whatever it returned, and not inside `runGates`, which closeStop shares. It fails a gate attempt and feeds the usual fix loop. No new phase or run state: an exhausted loop ends in `gates_exhausted` (exit 4), and a commit-only resume refuses the commit as a failed commit.
- A rename counts on both paths. A type change (git's `T`, which src/domain/reconciliation/parseNameStatus.ts drops today) counts as edited. Git's path lists are read with `-z`, so a non-ASCII path is matched and folded as it is written.
- The check does not rely on git's diff alone. For every tracked path of the phase base that the list matches, it compares the worktree's file with the base blob, so `git update-index --skip-worktree` or `--assume-unchanged` cannot hide an edit, and a deleted or type-changed file counts too. It also lists untracked files, ignored ones included (`git ls-files --others` with and without `--exclude-standard`, or equivalent), so a protected file created under a .gitignore entry is caught.
- Native rules are passed in secure mode only. Read-only sessions (a stop's first and closing turns, decide, authoring) need nothing more, as they have no writing tool.
- Codex gets no native rule: making exact paths read-only needs permission profiles, which replace phax's `sandbox_mode` `-c` overrides, so that migration is the later route.
- Both providers get native rules for the same glob forms: a literal path (none of `*`, `?`, `[`, `]`), or `**/` followed by one. Claude Code: one `Edit(...)` deny rule per glob, built as the skill edit grants build theirs (src/infra/providers/claudeSkillEditSettings.ts: `/${root}/${glob}` with an absolute root gives `//abs/…`). Claude matches its rules gitignore-style, also matching parent folders and ignoring case, so a wildcard glob such as `config/*` would refuse more than phax protects. Vibe: one entry for a literal path, and two for a `**/` one (`<worktree>/<path>` and `<worktree>/**/<path>`, which fnmatch matches at the root and at any depth below it). Every other glob gets no native rule on either provider and relies on the check (enforcement `partial`).
- security.json moves to version 3 with a required `protectedPaths`; version 2 and version 1 files are lifted on read, as version 1 was lifted with `stop: null`.
- The failure is named. The failed step's kind gains `protected-paths` beside `configured` and `oracle` (src/app/resumeInstructions.ts, src/domain/errors.ts, src/domain/events.ts, src/domain/whatsNext.ts, src/domain/gate/fixPrompt.ts). It is the kind when every step passed and only the check failed; a failed or refused step keeps its own kind, and the failure carries the protected changes either way. GateFailed and FixAttemptsExhausted get a variant that carries the changes instead of a command and an exit code.
- gate-attribution.json gains a required `protectedPaths` field. Its published schema moves through a `next` snapshot in packages/schemas/snapshots/gate-attribution, which the release names 0.31.0, the opened version; every field is required and none is optional. An older gate-attribution.json reads with `protectedPaths: null`, as security.json is lifted.
- A glob inside a submodule is refused: the phase's commit carries a submodule as one commit id, so the check cannot see the files in it. Only a glob whose leading literal segments reach the submodule's path is refused; a glob such as `**/allow.json` is accepted and matches no file inside a submodule.
- A skill edit grant that a protected glob covers is refused at preflight with exit 11, where the other grant refusals are (src/app/skillEditConsent.ts, src/app/runPreflight.ts).
- After a pause on a protected path, the remedy is one of two: put the file back to its content at the phase base and run `phax resume <run> --yes`, or make the change on the base branch and start a new run. `phax reset-phase` is no remedy: the phase's branch is re-created from the previous phase's branch, so a change made on the base branch does not reach it.
- Accepted loss: on Claude Code, a protected write that got past the native rule came through the shell, and the agent has no tool to put it back, so the fix loop can only run to exhaustion.

Left open:

- The exact wording of the gate failure line, the fix-prompt and phase-prompt sections and the resume-instructions.md lines; the security.json and gate-attribution.json field names and values and the overlay refusal message are normative.
- How the check reads the phase's change when the agent made a commit of its own during its turn: relative to the phase base, not to HEAD.

Constraints:

- Additive: a project with no `protectedPaths` sees the same argv, environment, prompts and output; its security.json gains only `protectedPaths: null` at version 3, and its gate-attribution.json only `protectedPaths: null` at 0.31.0.
- Reuse ArchitectureGlobSchema for the entries; refuse the key in a user overlay before decode, as `assignments` is.
- Claude Code: the deny rules merge into the one inline `--settings` object with the skill edit grants' hooks; with neither, no `--settings` is passed.
- Vibe: the protected entries join the existing `.vibe`/`.agents` denylist, under the worktree's resolved path. The post-turn `export.json` read-back (`vibeConfigMismatch` in src/domain/session/vibeFlags.ts) rebuilds the expected list from `VibeFlagsInput`, so the protected globs are part of that input.
- The real-CLI e2e criteria hold the provider facts of §1; a glob form whose rule fails there gets no native rule.
- Cost: listing ignored files walks every ignored folder of the worktree, node_modules included, at every gate attempt and at the commit and handoff checks. A `**/` glob also matches an ignored file that a setup or gate command writes, such as a dependency's own file under node_modules, and fails the phase on it.
- docs/security.md gains a Protected paths section; phax.usage.kdl and docs/cli/reference.md are updated for `phax run` and `phax validate`.

## 11. Docs page

Page: docs/security.md#protected-paths

Reader: A project owner whose gates read a file in which a person records what the gate tolerates (a debt baseline, a lint allowlist, accepted snapshots), and who wants no phase of a run to change it.

Example: steme-lab lists `**/steme.baseline.json` in phax.json. Claude Code refuses the agent's edit to the baseline; when a gate command rewrites it anyway, the gate attempt fails naming the file, the fix loop is told the file is the operator's, and the phase pauses with the path named, for the author to decide outside the run.

## 12. Decision log

- 2026-10-29 q-case decided fold-always — operator (Rémy Loubradou)
- 2026-10-29 q-handoff decided pause-handoff — operator (Rémy Loubradou)
- 2026-10-29 q-report decided paths-and-pointer — operator (Rémy Loubradou)
