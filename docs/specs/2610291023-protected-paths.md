---
status: Draft
date: 2026-10-29
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Protected paths: files no phase of a run may change

## 1. Context

Some files of a project record a human decision, and a gate reads them. steme's debt file is one. `steme audit` exits non-zero on a violated leg unless the unit's `steme.baseline.json` accepts it. Each entry carries `acceptedAt`, `acceptedBy` and a `why`, and the gate then reports it as a review note. Lint-exception allowlists, accepted test snapshots and a standard's list that a gate enforces are the same kind of file: the gate's tolerance is written in them.

phax bounds a phase's writes to the worktree and the state root, never to a path inside the worktree. The phase guard refuses phax state commands inside a phase, but it guards against mistakes and is not a boundary. Shell access differs by provider. Claude Code allowlists exactly the gate commands, Codex runs any command inside its OS sandbox, and Vibe matches commands by prefix. The skill edit grants are the inverse case: Claude Code protects `.claude/` by itself, and phax opens declared files through an inline `--settings` object, which it passes only when grants exist. Vibe's `write_file` and `edit` already deny `<root>/.vibe/**` and `<root>/.agents/**`, and phax checks the list in each turn's `export.json`.

A phase runs its agent turn, then its gate with a same-session fix loop. When the gate passes, phax commits, reconciles the commit (created, edited, deleted, renamed) and runs the handoff turn. An exhausted loop pauses the phase in `gates_exhausted` with exit 4. A commit failure pauses it as interrupted, and a commit-only resume runs no gate. A person's change at an interactive or held stop is a `reviewCorrections` entry. security.json is at version 2.

Provider facts, from the operator's check of the installed CLIs on 2026-10-29. This session could not read the installed CLIs and did not re-check them; the real-CLI e2e criteria below are where they are confirmed.
- Claude Code 2.1.312. `permissions.deny` rules hold in the inline `--settings` object. For file writes only `Edit(<pattern>)` matches, and it covers Edit, Write, MultiEdit and NotebookEdit. `//<path>` is absolute. Deny rules hold in headless `-p` and under `acceptEdits`, but not under `bypassPermissions` (phax's unsafe mode). They also check Bash `>` redirects, but not `sed -i`, `cp` or scripts.
- Mistral Vibe 3.0.3. The `denylist` of `write_file` and `edit` in `VIBE_TOOLS` is matched by `fnmatch` against the absolute resolved path. In fnmatch, `*` and `?` cross `/`, and `[` opens a class.
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

## 2. Problem

An agent that cannot fix a hole can write its acceptance into the file the gate reads, and the gate then passes. In steme-lab's run `steme-gates-steme-2` (2026-10-28), phase-05's agent (Sonnet, medium effort) wrote nine entries into `packages/rust/steme-formats/steme.baseline.json`. Each was signed `"acceptedBy": "the author"`, and the author saw none of them before the phase's commit. The plan's preamble allowed it, since it said an unfixable hole "is accepted as debt" in that file. Nothing in phax could have stopped it. A plan's prose is not a boundary, and the write sandbox lets the agent, or any command it runs, write anywhere in the worktree. Once an agent may edit the file that decides whether its own work passes, the gate no longer checks the work. It checks only whether the agent agrees with itself. A project has no way to say which files are the operator's decision.

## 3. Product goal

A project names, in phax.json, the files whose change is the operator's decision. No phase of a run may create, change, delete or rename them: not the agent, not its fix loop, not its handoff turn, not a gate command. Prevention is the providers' own: phax carries the list into each provider's native write rules where the provider can express it exactly, and adds no write interception of its own. The guarantee is one check of what the phase's commit would carry. A phase that would change a protected path fails its gate as any phase that cannot meet its gate does, and the change becomes the operator's to make outside the run's phases. A project that declares nothing sees no change.

> A phase never lands a change to a file that decides whether its own work passes; what it cannot fix stays failing and reaches the operator.

## 4. Terminology

- **Protected list** — The globs of phax.json's top-level `protectedPaths`, in phax's glob dialect, followed by `phax.json` itself unless already listed. A declared entry is named `protectedPaths[N]`, counted from 0.
- **Protected path** — A working-tree-root-relative POSIX path that a glob of the protected list matches (see q-case for letter case).
- **Phase base** — The commit a phase started from: the run's base for the first phase, the previous phase's commit otherwise.
- **Protected change** — A protected path that the phase's commit would create, edit or delete relative to the phase base. A rename counts on both its old and its new path. Only what the commit would hold counts: tracked files, and untracked files git does not ignore.
- **Protected-path check** — phax's comparison of what the phase's commit would carry with the protected list. It is the guarantee, and it holds whatever wrote the file: an edit tool, a shell command, a gate step, or a provider whose native rule does not apply.
- **Native rule** — A provider's own refusal of a write to a path, which phax configures for each session.
- **Enforcement** — For a phase and its provider, how much of the protected list native rules cover: `enforced` (every glob), `partial` (some globs) or `commit-check-only` (none).

## 5. Functional requirements

### 5.1 Declaring the protected list

WHERE phax.json declares a top-level `protectedPaths` THE system SHALL accept it only as a non-empty list of globs that phax's glob dialect admits, and refuse any other value with exit 2, naming the offending entry as `protectedPaths[N]`.

### 5.2 The project layer only

IF phax.local.json or ~/.phax/config.json carries `protectedPaths` THEN loading the configuration SHALL fail with exit 2 before that overlay is decoded, with the message `"protectedPaths" is accepted only in phax.json`, naming the overlay file.

### 5.3 phax.json protects itself

WHERE phax.json declares `protectedPaths` THE system SHALL treat `phax.json` as a protected path too.

### 5.4 Nothing declared, nothing changes

WHILE phax.json declares no `protectedPaths` THE system SHALL run every phase with the same provider argv and environment, phase prompt, fix prompts, gate attempts and output as before this change.

### 5.5 Native rule on Claude Code

WHERE a phase's session runs on claude-code in secure mode THE system SHALL deny Claude Code's file-editing tools every glob of the protected list that holds neither `[` nor `]`, as an absolute `Edit(//<worktree>/<glob>)` rule in the session's inline settings, merged with any skill edit grants, for the phase turn, each fix attempt and the handoff turn.

### 5.6 Native rule on Mistral Vibe

WHERE a phase's session runs on mistral-vibe in secure mode THE system SHALL add to the `write_file` and `edit` denylists `<worktree>/<glob>` for every glob of the protected list that holds none of `*`, `?`, `[` and `]`, the two entries `<worktree>/<path>` and `<worktree>/**/<path>` for every glob that is `**/` followed by such a path, and give every other glob no native rule.

### 5.7 No native rule elsewhere

WHERE a phase runs on codex-cli, or in a mode other than secure, THE system SHALL pass no native rule for the protected list and record its enforcement as `commit-check-only`.

### 5.8 The check fails the gate attempt

WHEN a gate attempt of a phase has run its steps THE system SHALL fail that attempt if the phase holds a protected change, whatever its steps' exit codes, naming each protected change with its kind and its matching entry.

### 5.9 The commit carries no protected change

IF a phase's commit would carry a protected change when no gate attempt has run in that entry (a commit-only resume) THEN the system SHALL refuse the commit and pause the phase as a failed commit, naming each protected change.

### 5.10 Telling the fix loop

WHEN a gate attempt fails on protected changes THE system SHALL resume the agent through the usual fix loop with a prompt that names each change, says the path is the operator's decision, asks that it be put back to its content at the phase base, and says the hole is fixed in code or left failing.

### 5.11 What is left goes to the operator

WHEN the fix attempts of a phase are exhausted with protected changes in its last failed attempt THE system SHALL pause the phase in `gates_exhausted` with exit 4, with resume-instructions.md naming each protected path still changed and saying that phax refuses any change to it within the run's phases.

### 5.12 The handoff turn after the commit

IF the handoff turn leaves a protected path in the worktree different from the phase's commit THEN the system SHALL pause the phase as a failed handoff, naming each such path, without recording the phase as done.

### 5.13 Telling the agent up front

WHERE phax.json declares `protectedPaths` THE phase prompt SHALL carry a Protected paths section naming every glob of the protected list and saying that a hole the agent cannot fix in code is left failing and explained, never accepted in a protected file or worked around.

### 5.14 A stop's close is the person's

WHILE phax closes a declared or held stop THE system SHALL not apply the protected-path check to the close's gate or commit, the person's changes being `reviewCorrections` as today.

### 5.15 Recording the protection

The system shall write every phase's security.json at version 3, with a required `protectedPaths` field that is `null` when phax.json declares none, and otherwise holds the protected list's `globs` and the phase's `enforcement`.

### 5.16 Reading older records

WHEN phax reads a version 2 security.json, or a version 1 one, THE system SHALL read it as version 3 with `protectedPaths: null`, a version 1 file also gaining `stop: null`.

### 5.17 Letter case

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

Summary: Running `phax validate` lists the protected paths and refuses a malformed list or one set outside phax.json.

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
      local:   /work/steme-lab/phax.local.json
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

### cli: phax run — indicative

Summary: During a run the operator sees a gate attempt fail on each protected file the phase changed, and an exhausted phase names the files left for them to decide.

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
    They are yours to decide, outside this run's phases. Put them back to the phase base
    before you resume, or reset the phase once you have made the change.
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

Summary: Claude Code and Mistral Vibe refuse an edit to a protected file before it is written, for every glob they can express exactly.

before:

    claude -p … --permission-mode acceptEdits --allowedTools "Bash(steme audit:*)"

    VIBE_TOOLS='{…,"write_file":{"allowlist":[],"denylist":["/wt/.vibe/**","/wt/.agents/**"],"outside_workdir":"deny"},"edit":{…}}'

after:

    claude -p … --permission-mode acceptEdits --allowedTools "Bash(steme audit:*)" \
      --settings '{"permissions":{"deny":["Edit(///wt/**/steme.baseline.json)","Edit(///wt/phax.json)"]}}'

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
    | `claude-code`  | `Edit(//…)` deny, globs without `[` `]`        | enforced or partial    |
    | `mistral-vibe` | `write_file`/`edit` denylist, literal and `**/` paths | enforced or partial |
    | `codex-cli`    | none (permission profiles: later)              | commit-check-only      |

    ### Shell command execution

## 7. Non-goals

- Detecting or restoring protected files after each turn: phax checks what the commit would carry, and restores nothing.
- Telling an operator's change from an agent's within a phase.
- A route to change a protected file while a phase is paused.
- Plan lint and preflight checks of planned files: a plan that plans a protected file fails at that phase's gate.
- `phax security status` columns and a final-report table for protected paths.
- Codex permission profiles: replacing the `sandbox_mode` overrides is the later route to a native rule on Codex.
- The commands a project's own tool offers to change such a file, such as steme's `debt accept`.
- Paths outside the worktree.
- What a protected file means or whether its content is valid.

## 8. Acceptance criteria

### The list is read and shown

Given phax.json with `"protectedPaths": ["**/steme.baseline.json"]`, when `phax validate` runs, then it exits 0 and prints `protected paths: **/steme.baseline.json, phax.json`. (refs §5.1, §5.3)

### A malformed list is refused

Given phax.json with `"protectedPaths": []`, then `["../shared/allow.json"]`, then `["/abs/x.json"]`, when `phax validate` runs on each, then each exits 2; the second and third name `protectedPaths[0]` and the rule the entry breaks. (refs §5.1)

### An overlay cannot set the list

Given phax.json declaring `protectedPaths` and a phax.local.json carrying `"protectedPaths": []`, then the same key in ~/.phax/config.json, when `phax validate` or `phax run` loads the configuration, then it exits 2 with `"protectedPaths" is accepted only in phax.json`, naming the overlay file. (refs §5.2)

### A project that declares nothing

Given a project whose phax.json has no `protectedPaths`, when a phase runs on each provider through the fake CLIs, with a red gate attempt then a green one, then the argv, environment, phase prompt, fix prompt, gate logs and run output equal those of the current release, and security.json differs only by `"version": 3` and `"protectedPaths": null`. (refs §5.4, §5.15)

### An agent's edit fails the gate attempt

Given `protectedPaths` ["**/steme.baseline.json"] on codex-cli and a fake agent that adds an entry to packages/rust/steme-formats/steme.baseline.json and makes every gate step pass, when the gate attempt runs, then the attempt fails naming the path, `edited` and `protectedPaths[0]`, the fix loop resumes the session, and nothing is committed. (refs §5.8, §5.7)

### A gate step that writes a protected file

Given a gate profile whose step `node scripts/accept-debt.js` writes packages/a/steme.baseline.json and exits 0, and every other step passes, when the gate attempt runs, then the attempt fails naming the path, although every step exited 0. (refs §5.8)

### An allowed shell command that writes one

Given a phase on claude-code in secure mode whose agent runs the allowlisted gate command `pnpm snapshot:update`, which rewrites a protected snapshot through a script, when the gate attempt runs, then the attempt fails naming the snapshot path, although Claude Code's native rule did not stop the write. (refs §5.8, §5.5)

### Creations, deletions and renames count

Given a fake agent that creates packages/a/steme.baseline.json, deletes packages/b/steme.baseline.json and renames packages/c/steme.baseline.json to packages/c/old.json, when the gate attempt runs, then the attempt fails naming packages/a (created), packages/b (deleted) and packages/c/steme.baseline.json (renamed); a rename of packages/d/x.json to packages/d/steme.baseline.json is named too. (refs §5.8)

### phax.json cannot empty its own list

Given phax.json declaring `protectedPaths` and a fake agent that removes the key from phax.json in the phase worktree, when the gate attempt runs, then the attempt fails naming `phax.json`. (refs §5.3, §5.8)

### The fix prompt says whose file it is

Given a gate attempt failed on packages/a/steme.baseline.json, when the fix loop resumes the agent, then the fix prompt names the path and its change, says it is the operator's decision, asks that it be put back to the phase base, and says the hole is fixed in code or left failing. (refs §5.10)

### What the loop cannot fix reaches the operator

Given a fake agent that leaves packages/a/steme.baseline.json changed at every attempt, when the fix attempts are exhausted, then the phase is in `gates_exhausted`, phax exits 4, and the output and resume-instructions.md name the path and say no phase may change it. (refs §5.11)

### A commit-only resume cannot carry one

Given a phase paused as a failed commit, and a protected path changed in its worktree since, when `phax resume` reaches the commit, then no commit is made, the phase pauses again as a failed commit and the reason names the path. (refs §5.9)

### A handoff turn's write stops the phase

Given a green gate and a fake agent whose handoff turn writes packages/a/steme.baseline.json, when the handoff turn ends, then the phase commit holds the file at its phase-base content, the phase pauses as a failed handoff naming the path, and no phase record is written. (refs §5.12)

### The agent is told up front

Given `protectedPaths` ["**/steme.baseline.json"], when phax builds the phase prompt, then it carries a `## Protected paths` section listing `**/steme.baseline.json` and `phax.json` and the instruction to leave an unfixable hole failing and explain it. (refs §5.13)

### Claude Code gets the deny rules

Given a phase on claude-code in secure mode with `protectedPaths` ["**/steme.baseline.json", "locks/[a].json"] and one skill edit grant, when phax spawns the phase turn, a fix attempt and the handoff turn, then each argv carries one `--settings` object holding the grant's hooks and `Edit(//<worktree>/**/steme.baseline.json)` and `Edit(//<worktree>/phax.json)` deny rules, none for `locks/[a].json`, and security.json records `"enforcement": "partial"`. (refs §5.5, §5.15)

### Claude Code refuses the edit natively

Given the real Claude Code CLI in secure mode and `protectedPaths` ["**/steme.baseline.json"], when the agent is asked to Write, Edit and MultiEdit packages/a/steme.baseline.json in the real-CLI e2e suite, then every call is denied and the file is unchanged. (refs §5.5)

### Vibe gets literal and `**/` paths

Given a phase on mistral-vibe in secure mode with `protectedPaths` ["**/steme.baseline.json", "config/*.json"], when phax spawns a turn, then the `write_file` and `edit` denylists hold `<worktree>/steme.baseline.json`, `<worktree>/**/steme.baseline.json` and `<worktree>/phax.json` after the `.vibe` and `.agents` guards, nothing for `config/*.json`, the post-turn read-back accepts that list, and security.json records `"enforcement": "partial"`. (refs §5.6, §5.15)

### Vibe refuses the edit natively

Given the real Vibe CLI in secure mode and `protectedPaths` ["config/allow.json"], when the agent is asked to write_file and edit config/allow.json in the real-CLI e2e suite, then both calls are refused and the file is unchanged. (refs §5.6)

### Codex and unsafe mode rely on the check

Given `protectedPaths` declared, a phase on codex-cli in secure mode, then a phase on claude-code with `--security unsafe`, when phax spawns each phase turn, then neither argv carries a protected-path rule, both security.json files record `"enforcement": "commit-check-only"`, and a write to a protected path fails the gate attempt in both. (refs §5.7, §5.8)

### A stop's close is not checked

Given a held stop where a person edits packages/a/steme.baseline.json in the phase worktree, when `phax resume` closes the stop with a green gate, then the close's gate passes, the review commit carries the change and file-reconciliation.json lists it under reviewCorrections. (refs §5.14)

### Older records read as version 3

Given a version 2 security.json and a version 1 one, when phax reads each, then both read as version 3 with `protectedPaths: null`, the version 1 file also with `stop: null`. (refs §5.16)

### A case variant is caught

Given `protectedPaths` ["**/steme.baseline.json"] and a fake agent that creates packages/a/STEME.Baseline.json, when the gate attempt runs, on a case-sensitive and on a case-insensitive filesystem, then the attempt fails naming packages/a/STEME.Baseline.json on both. (refs §5.17, §5.8)

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
- The guarantee is the protected-path check of what the phase's commit would carry, relative to the phase base. It fails a gate attempt and feeds the usual fix loop. No new phase or run state: an exhausted loop ends in `gates_exhausted` (exit 4), and a commit-only resume refuses the commit as a failed commit.
- A rename counts on both paths. Only tracked files and untracked files git does not ignore are protected.
- Native rules are passed in secure mode only. Read-only sessions (a stop's first and closing turns, decide, authoring) need nothing more, as they have no writing tool.
- Codex gets no native rule: making exact paths read-only needs permission profiles, which replace phax's `sandbox_mode` `-c` overrides, so that migration is the later route.
- Claude Code: a glob holding `[` or `]` gets no native rule, as Claude reads them as a class. Vibe: a glob with none of `*`, `?`, `[`, `]` gets one entry, and `**/` followed by such a path gets two (`<worktree>/<path>` and `<worktree>/**/<path>`, which fnmatch matches at the root and at any depth below it); every other glob gets none, as fnmatch's `*` and `?` cross `/` and a pattern is matched against the absolute path.
- security.json moves to version 3 with a required `protectedPaths`; version 2 and version 1 files are lifted on read, as version 1 was lifted with `stop: null`.
- Accepted loss: on Claude Code, a protected write that got past the native rule came through the shell, and the agent has no tool to put it back, so the fix loop can only run to exhaustion.

Left open:

- The three §9 questions.
- The exact wording of the gate failure line, the fix-prompt and phase-prompt sections and the resume-instructions.md lines; the security.json field names and values and the overlay refusal message are normative.
- Where in the gate attempt the check sits relative to the configured steps and the oracle step, so long as it sees every step's writes and runs before the attempt passes.
- How the check reads the phase's change when the agent made a commit of its own during its turn: relative to the phase base, not to HEAD.

Constraints:

- Additive: a project with no `protectedPaths` sees the same argv, environment, prompts and output, and its security.json gains only `protectedPaths: null` at version 3.
- Reuse ArchitectureGlobSchema for the entries; refuse the key in a user overlay before decode, as `assignments` is.
- Claude Code: the deny rules merge into the one inline `--settings` object with the skill edit grants' hooks; with neither, no `--settings` is passed.
- Vibe: the protected entries join the existing `.vibe`/`.agents` denylist, under the worktree's resolved path, and the post-turn `export.json` read-back compares the extended list.
- The provider facts above were not re-checked in the installed CLIs by this authoring session; the real-CLI e2e criteria confirm them, and a provider whose rule does not hold there records no native rule for that glob form.
- docs/security.md gains a Protected paths section; phax.usage.kdl and docs/cli/reference.md are updated for `phax run` and `phax validate`.

## 11. Docs page

Page: docs/security.md#protected-paths

Reader: A project owner whose gates read a file in which a person records what the gate tolerates (a debt baseline, a lint allowlist, accepted snapshots), and who wants no phase of a run to change it.

Example: steme-lab lists `**/steme.baseline.json` in phax.json. Claude Code refuses the agent's edit to the baseline; when a gate command rewrites it anyway, the gate attempt fails naming the file, the fix loop is told the file is the operator's, and the phase pauses with the path named, for the author to decide outside the run.

## 12. Decision log

- 2026-10-29 q-case decided fold-always — operator (Rémy Loubradou)
- 2026-10-29 q-handoff decided pause-handoff — operator (Rémy Loubradou)
- 2026-10-29 q-report decided paths-and-pointer — operator (Rémy Loubradou)
