---
status: Draft
date: 2026-10-29
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Protected paths: files no phase of a run may write

## 1. Context

Some files of a project record a human decision that a gate reads. steme's debt file is one: `steme audit` exits non-zero on a violated leg unless the unit's `steme.baseline.json` accepts it, each entry carrying `acceptedAt`, `acceptedBy` and a `why`, and the gate then reports the entry as a review note. Lint-exception allowlists, accepted test snapshots and a standard's list that a gate enforces are the same kind of file: the gate's tolerance is written in them.

phax today bounds a phase's writes to the worktree and the state root (the write sandbox), never to a path inside the worktree. Inside a phase, the phase guard refuses phax commands that act on state, but it is a guard against mistakes, not a boundary. Shell access differs by provider: Claude Code allowlists exactly the gate commands, Codex runs any command inside its OS sandbox, Vibe matches commands by prefix. The skill edit grants are the inverse case: Claude Code protects `.claude/` by itself, and phax opens declared skill files one by one for a run started with `--allow-skill-edits`, through an inline `--settings` JSON; a plan that declares skill files without the flag is refused before the run with exit 11, and `security.json` records the grants for every provider.

phax already knows every path a phase created, edited, deleted or renamed (file reconciliation), and a path a person changed at an interactive or held stop is a `reviewCorrections` entry, never a deviation. A phase runs: worktree and setup, the agent's turn, the gate with a same-session fix loop up to `agent.maxFixAttempts`, the handoff turn, then phax commits. When the fix loop is exhausted the phase pauses in `gates_exhausted` (exit 4), and `resume-instructions.md` tells the operator to fix the gate by hand in the worktree, then `phax resume`, which re-runs the gate first.

Ground read:

- `docs/briefs/protected-paths.md` — The brief: the steme-lab case, what phax has today, what the spec must cover, the four required arbitrations.
- `docs/security.md` — Configuration, Provider Capabilities, Skill edit grants (inline --settings, exit 11 preflight, skillEditGrants in security.json for every provider), Shell command execution (Claude exact allowlist, Codex OS sandbox with any command, Vibe prefix allowlist), Security Artifacts (security.json version 2, the stop section added at a close).
- `src/domain/security/skillEditGrants.ts` — The inverse case: exact repo-relative files resolved from a phase's create, edit and optional lists, and the preflight refusal naming phases and files.
- `src/domain/security/phaseGuard.ts` — The phase guard refuses state-acting phax commands inside a phase worktree; it is a guard against mistakes, not a boundary.
- `src/domain/reconciliation/types.ts` — Reconciliation already classifies every added, modified, deleted and renamed path; reviewCorrections holds paths a person changed at a stop and is never a deviation.
- `src/domain/gate/fixPrompt.ts` — The fix prompt: failed step, findings or raw log, then a Required action section.
- `src/app/resumeInstructions.ts` — At gates_exhausted the run pauses and resume-instructions.md says: fix the gate manually in the worktree, then resume; the gate is re-run first.
- `src/domain/state.ts` — PhaseState already has gates_exhausted (non-terminal) and awaiting_review; no new state is needed.
- `src/app/loadConfig.ts` — A user overlay that carries assignments is refused before decode with '"assignments" is accepted only in phax.json'; the overlay schema accepts the whole security block.
- `src/schemas/securityConfig.ts` — security.filesystem holds allowRead and allowWrite only; the security block is settable from phax.local.json and ~/.phax/config.json.
- `src/schemas/securityPosture.ts` — security.json version 2, decoded strictly; marks, agentCommands with per-command enforcement, skillEditGrants, stop.
- `src/domain/architecture/glob.ts` — phax's own glob dialect: ** whole segment, * within a segment, ? one character, every other character literal, case-sensitive, same on every host.
- `src/app/securityStatus.ts` — phax security status prints a provider table: Available, Filesystem Jail, MCP Allowlist, Secure Default.
- `README.md` — Phase order: worktree, setup, agent turn, gate with same-session fix loop up to agent.maxFixAttempts, handoff turn, commit, reconciliation; interactive and held stops are closed by phax resume.
- `docs/cli/reference.md` — phax run, phax resume and the stop close: the close runs the gate first, a red gate returns the phase to the person with exit 4; closing-turn edits are set aside with exit 5.

## 2. Problem

An agent that cannot fix a hole can write its acceptance into the file the gate reads, and the gate passes. In steme-lab's run `steme-gates-steme-2` (2026-10-28), phase-05's agent (Sonnet, medium effort) wrote nine entries into `packages/rust/steme-formats/steme.baseline.json`, each signed `"acceptedBy": "the author"`. The author saw none of them before the phase committed. The plan's preamble even allowed it: an engine defect or an unfixable hole "is accepted as debt", in that file.

Nothing in phax could have stopped it. A plan's prose is not a boundary, the write sandbox lets the agent write anywhere in the worktree, and a gate command, or a script the agent runs, can rewrite the file as easily as the agent's edit tools. Once an agent may edit the file that decides whether its own work passes, the gate no longer checks the work. It checks only whether the agent agrees with itself. A project has no way to say which files are the operator's decision.

## 3. Product goal

A project names, in its phax configuration, the files whose change is the operator's decision. No phase of a run creates, changes, deletes or renames them: not the agent, not its fix loop, not its handoff turn, not a gate or setup command. phax guarantees this by comparing the worktree with the phase's reference at every point where something other than a person could have written, on every provider and in every security mode, and putting any protected path back. Where the provider can, phax also denies the write before it happens, which spares the agent a wasted turn. A phase that would need to change a protected file fails its gate as any phase that cannot meet its gate does, and the change becomes the operator's to make, at a stop or by a commit while the run is paused. A project that declares nothing sees no change.

> The gate's tolerance is the operator's: what a phase cannot fix stays failing and reaches a person, it is never accepted by the phase itself.

## 4. Terminology

- **Protected path** — A repository path, relative to the working-tree root in POSIX form, matched by at least one glob of the project's protected list. Matching uses phax's glob dialect (** as a whole segment for zero or more segments, * within a segment, ? one character, every other character literal, case-sensitive).
- **Protected list** — The ordered, non-empty list of globs a project declares; an entry is named by its position, protectedPaths[N], counted from 0.
- **Reference** — The content each protected path must have in a phase's worktree: its content (or absence) at the phase's base commit, updated by each operator commit and by each stop close. A path absent from the reference must stay absent.
- **Protected change** — A protected path whose worktree content differs from the reference: created, modified or deleted. A rename counts as the deletion of its old path and the creation of its new one; each side that is protected is a protected change. Only files git would commit count: tracked files and untracked files that are not ignored.
- **Check point** — A moment at which phax compares every protected path with the reference: after setup, after the agent's turn, after each fix attempt, after each gate step, after the handoff turn, before a pause, before the phase commit, and after each step of a close's gate.
- **Refusal** — A protected change found at a check point that is not the operator's: phax restores the path to the reference and records it, naming the path, the change, the check point and the matching entry.
- **Operator change** — A protected change phax attributes to a person: present in the worktree when a stop is closed, before the close's gate runs, or committed on the run's branch while the run was paused. Never a refusal.
- **Enforcement** — Per phase and provider, how far phax goes beyond detection: enforced (the provider's file-editing tools are denied every protected path before they write, and detection still runs) or detected-only (detection alone). Detection runs in every case.

## 5. Functional requirements

### 5.1 Declaring the protected list

WHERE phax.json declares `protectedPaths` THE system SHALL read it as a non-empty ordered list of globs in phax's glob dialect, each matched against working-tree-root-relative POSIX paths.

### 5.2 Refusing a malformed list

IF `protectedPaths` is empty, or an entry is not a string, is empty, is absolute or holds a `..` segment, THEN loading phax.json SHALL fail with exit 2, naming the entry as protectedPaths[N].

### 5.3 The project layer only

IF phax.local.json or ~/.phax/config.json carries `protectedPaths` THEN loading the configuration SHALL fail with exit 2, saying that `protectedPaths` is accepted only in phax.json.

### 5.4 Nothing declared, nothing changes

WHILE the project declares no `protectedPaths` THE system SHALL produce the same argv, prompts, fix prompts, security.json, reconciliation, records and output as a phax without this feature.

### 5.5 Detection on every provider and mode

The system shall run every protected-path check point on every provider and in every security mode, whatever the provider's enforcement.

### 5.6 Checking after setup and every agent turn

WHEN setup, the agent's turn, a fix attempt or the handoff turn of a phase ends THE system SHALL compare every protected path with the reference before the next gate step, agent turn or commit runs.

### 5.7 Checking after every gate step

WHEN a gate step finishes THE system SHALL compare every protected path with the reference before the next step runs.

### 5.8 Restoring a refused change

WHEN a check point finds a protected change that is not an operator change THE system SHALL restore the path to the reference, removing it where the reference has no such path, and record the refusal.

### 5.9 Saying what was refused

WHEN a refusal is recorded THE system SHALL print one line naming the phase, the path, the kind of change, the check point and the matching protectedPaths entry, and saying the path was restored.

### 5.10 A gate that rewrote its tolerance cannot pass

IF a gate step's run produced a protected change THEN the system SHALL count that gate attempt as failed, whatever the exit codes and gate reports of its steps, naming the step and the path as the failure.

### 5.11 No phase commit carries a refused change

WHEN phax is about to commit a phase THE system SHALL run a final check point, so that the commit holds every protected path at the reference except for operator changes.

### 5.12 A handoff turn's write is discarded

IF the handoff turn produced a protected change THEN the system SHALL restore it, record the refusal and commit the gated tree, without opening a fix attempt.

### 5.13 Telling the agent up front

WHERE `protectedPaths` is declared THE phase prompt SHALL carry a Protected paths section naming every glob, saying the files are the operator's decision, and instructing the agent that a hole it cannot fix in the code is left failing and reported in its handoff, never worked around.

### 5.14 Telling the agent in the fix loop

WHERE `protectedPaths` is declared THE fix prompt SHALL carry the same Protected paths section, plus each refusal recorded since the previous gate attempt with its path, change and check point.

### 5.15 What is left goes to the operator

WHEN a phase with at least one refusal exhausts its fix attempts THE system SHALL pause it in gates_exhausted with exit 4 as any exhausted phase, and the pause output and resume-instructions.md SHALL name each refused path and how the operator changes one.

### 5.16 A pause leaves the reference in place

WHEN phax pauses a phase (gates exhausted, a rate or usage limit, a refused gate report) THE system SHALL run a check point first and record the head of the phase's branch.

### 5.17 The operator's commit while paused

WHEN `phax resume` restarts a paused phase THE system SHALL take each protected path changed by commits made on the phase's branch since the recorded head as an operator change, make its committed content the reference, and list it under the phase reconciliation's reviewCorrections.

### 5.18 Unattributable change at resume

IF at `phax resume` a protected path in the paused phase's worktree differs from the reference without a commit THEN resume SHALL refuse with exit 1, naming the path and the two remedies (commit it, or restore it), and change nothing.

### 5.19 A person's change at a stop

WHEN a declared or held stop is closed THE system SHALL take each protected change present in the worktree before the close's gate runs as an operator change, list it under reviewCorrections and commit it with the close, without a refusal.

### 5.20 A close's gate may not write

IF a step of a close's gate produced a protected change THEN the system SHALL restore the path to the person's content, count the close's gate as red and return the phase to the person with exit 4, the run staying in awaiting_review.

### 5.21 Plans that plan a protected file

IF a phase not declared interactive lists a protected path in its files to create, edit or optionally edit THEN `phax plans lint` SHALL report an error naming the phase, the path and the matching protectedPaths entry.

### 5.22 Refused before the run

IF a phase not declared interactive lists a protected path in its planned files THEN the start and resume preflights SHALL refuse with exit 11 and "Protected-path preflight failed", naming each phase and path, before a run is named or a phase restarts.

### 5.23 An interactive phase may plan a protected file

WHERE a phase is declared interactive THE system SHALL accept a protected path among its planned files.

### 5.24 Prevention on Claude Code

WHERE a phase runs on claude-code in secure mode and `protectedPaths` is declared THE system SHALL deny every protected glob to Claude Code's file-editing tools in the session's settings, for the phase turn, the fix attempts and the handoff turn.

### 5.25 Prevention on Mistral Vibe

WHERE a phase runs on mistral-vibe in secure mode and `protectedPaths` is declared THE system SHALL deny every protected glob to Vibe's file-writing tools in the turn's tool configuration.

### 5.26 Recording the protection

WHERE `protectedPaths` is declared THE phase's security.json SHALL carry a protectedPaths section with the globs, the provider's enforcement (enforced or detected-only) and every refusal of the phase.

### 5.27 Seeing what each provider can do

WHEN `phax security status` runs THE system SHALL show, per provider, whether it enforces protected paths or detects them only, and the project's protected globs when phax.json declares any.

### 5.28 Refusals in the final report

WHERE a run recorded at least one refusal THE final report's Security section SHALL list, per phase, each refused path with its change and check point.

## 6. Surface

### config: phax.json protectedPaths — indicative

Summary: A project lists, in phax.json, the files whose change is the operator's decision, and no phase of a run may create, change, delete or rename them.

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

Summary: Running `phax validate` counts the protected globs, and refuses an empty or malformed list or one set outside phax.json.

before:

    $ phax validate
    ✓ phax.json is valid
    2 assignment bounds (1 part, 1 globs)

after:

    $ phax validate
    ✓ phax.json is valid
    2 assignment bounds (1 part, 1 globs)
    1 protected path glob

    $ phax validate    # phax.json: "protectedPaths": ["../shared/allow.json"]
    Config validation failed: protectedPaths[0]: "../shared/allow.json" holds a ".." segment
    $? = 2

    $ phax validate    # phax.local.json: "protectedPaths": []
    Config validation failed: "protectedPaths" is accepted only in phax.json
    $? = 2

### cli: phax run — indicative

Summary: During a run the operator sees each refused write to a protected file, restored on the spot, and an exhausted phase names the protected files left for them to decide.

before:

    ✗ phase-05 gate attempt 3 failed: steme audit (exit 1)
    This run paused because its gate checks failed after exhausting all fix attempts.
    Fix the gate manually in the worktree, then resume — the gate is re-run first on
    resume, and if it passes the phase commits with no fresh agent invocation.
    $? = 4

after:

    ✗ phase-05 · protected path refused: packages/rust/steme-formats/steme.baseline.json modified during fix attempt 2 (protectedPaths[0] **/steme.baseline.json) — restored
    ✗ phase-05 · protected path refused: packages/rust/steme-formats/steme.baseline.json modified by gate step "node scripts/accept-debt.js" (protectedPaths[0] **/steme.baseline.json) — restored, gate attempt 3 failed
    This run paused because its gate checks failed after exhausting all fix attempts.
    Protected paths the phase tried to change, left to you:
      packages/rust/steme-formats/steme.baseline.json (fix attempt 2, gate attempt 3)
    To change one yourself, commit it on phax/steme-gates-steme-2--phase-05 in the phase worktree,
    then phax resume steme-gates-steme-2. Fix anything else manually in the worktree, as before.
    $? = 4

### internal: phase prompt and fix prompt — indicative

Summary: The agent is told which files are the operator's and that a hole it cannot fix stays failing and is reported in its handoff, and the fix loop tells it which of its writes were put back.

before:

    ## Required action

    Fix all issues revealed by the gate output above.
    Make the minimum changes required to pass the gate.

after:

    ## Protected paths

    These files are the operator's decision. No phase may create, change, delete or rename
    them, by any tool or command; phax puts back every change to them.
    - **/steme.baseline.json

    Changes put back since the last attempt:
    - packages/rust/steme-formats/steme.baseline.json (modified during fix attempt 2)

    If a hole cannot be fixed in the code, leave the gate failing and report it in your
    handoff. Never work around it.

    ## Required action

    Fix all issues revealed by the gate output above.

### file: <run>/<phase-id>/security.json — normative

Summary: A phase's security record shows the protected globs, whether its provider prevented writes to them or only detected them, and every write that was put back.

before:

    {
      "version": 2,
      "mode": "secure",
      "provider": "claude-code",
      "skillEditGrants": [],
      "providerSkippedForSecurity": [],
      "stop": null
    }

after:

    {
      "version": 2,
      "mode": "secure",
      "provider": "claude-code",
      "skillEditGrants": [],
      "protectedPaths": {
        "globs": ["**/steme.baseline.json"],
        "enforcement": "enforced",
        "refusals": [
          { "path": "packages/rust/steme-formats/steme.baseline.json", "change": "modified", "point": "fix-attempt", "attempt": 2, "entry": 0 },
          { "path": "packages/rust/steme-formats/steme.baseline.json", "change": "modified", "point": "gate-step", "attempt": 3, "command": "node scripts/accept-debt.js", "entry": 0 }
        ]
      },
      "providerSkippedForSecurity": [],
      "stop": null
    }

### cli: phax plans lint — indicative

Summary: Linting a plan reports every headless phase that plans to touch a protected file.

    $ phax plans lint docs/plans/2610281012-steme-gates-plan.md
    error    protected  phase-05  plans to edit packages/rust/steme-formats/steme.baseline.json, protected by protectedPaths[0] (**/steme.baseline.json); only an interactive phase may plan it
    $? = 1

### cli: phax run preflight — normative

Summary: A plan whose headless phases plan a protected file is refused before the run is named, so nothing is left behind.

    $ phax run --plan docs/plans/2610281012-steme-gates-plan.md
    Protected-path preflight failed: these phases plan files that are the operator's decision.
      phase-05: packages/rust/steme-formats/steme.baseline.json (protectedPaths[0])
    Declare the phase interactive, or drop the file from its plan.
    $? = 11

### cli: phax resume — indicative

Summary: Resuming a paused phase takes the operator's commits to protected files as theirs, and refuses an uncommitted change it cannot attribute.

    $ phax resume steme-gates-steme-2
    ✗ phase-05: packages/rust/steme-formats/steme.baseline.json differs from its reference without a commit.
    If the change is yours, commit it on phax/steme-gates-steme-2--phase-05; if not,
    restore it with git checkout -- packages/rust/steme-formats/steme.baseline.json. Then resume again.
    $? = 1

### cli: phax security status — indicative

Summary: Running `phax security status` shows which providers prevent writes to protected files and which only detect them, and the project's protected globs.

before:

    Provider          | Available | Filesystem Jail | MCP Allowlist | Secure Default
    ------------------------------------------------------------------------
    claude-code      | ✓         | strong          | supported    | ✓
    codex-cli        | ✓         | strong          | supported    | ✓
    mistral-vibe     | ✓         | strong          | unsupported  | ✓

after:

    Provider          | Available | Filesystem Jail | MCP Allowlist | Protected Paths | Secure Default
    ------------------------------------------------------------------------------------------
    claude-code      | ✓         | strong          | supported    | enforced        | ✓
    codex-cli        | ✓         | strong          | supported    | detected-only   | ✓
    mistral-vibe     | ✓         | strong          | unsupported  | enforced        | ✓

    Protected paths (phax.json): **/steme.baseline.json

    Legend:
      Protected Paths: enforced = file tools denied, and detected | detected-only = detected and restored

### file: final-report.md — indicative

Summary: The final report lists, per phase, each write to a protected file that was put back.

    ### Protected Paths

    | Phase    | Path                                             | Change   | When                                   |
    | -------- | ------------------------------------------------ | -------- | -------------------------------------- |
    | phase-05 | packages/rust/steme-formats/steme.baseline.json  | modified | fix attempt 2                          |
    | phase-05 | packages/rust/steme-formats/steme.baseline.json  | modified | gate step node scripts/accept-debt.js  |

### internal: provider prevention — indicative

Summary: Claude Code and Mistral Vibe refuse an edit to a protected file before it is written, so the agent learns at once instead of losing a turn.

before:

    claude … --settings '{"hooks":{"PermissionRequest":[…]}}'

after:

    claude … --settings '{"permissions":{"deny":["Edit(**/steme.baseline.json)","Write(**/steme.baseline.json)","MultiEdit(**/steme.baseline.json)"]}}'

    VIBE_TOOLS='{"write_file":{"deny":[…,"**/steme.baseline.json"]},"edit":{"deny":[…,"**/steme.baseline.json"]}}'

### file: phax.usage.kdl — indicative

Summary: The CLI help of run, resume, validate, plans lint and security status says how protected paths behave.

before:

    cmd "security" {
        cmd "status" {
            help "Show provider security capabilities and availability"
        }
    }

after:

    cmd "security" {
        cmd "status" {
            help "Show provider security capabilities and availability, including protected-path enforcement"
            long_help "…Protected Paths: enforced (the provider's file tools are denied the project's protectedPaths, and phax detects) or detected-only (phax detects and restores)…"
        }
    }

## 7. Non-goals

- The commands a project's own tool offers to change a protected file (steme's `debt accept` and `debt withdraw`) stay the project's.
- Protecting paths outside the worktree.
- Signing or attributing an operator's change beyond telling it from a phase's: phax does not record who made a commit or check its author.
- Reading or validating what a protected file means.
- Git-ignored files: they never enter a commit, so they are not protected.
- Per-workspace protected lists: one project-level list, whose globs can name any workspace's files.
- A flag that lets a headless phase write a protected file, in the manner of `--allow-skill-edits`.
- A new phase or run state, or a new stop kind: refusals use gates_exhausted and awaiting_review as they are.
- Preventing a gate or setup command's own writes before they happen: they are detected and restored.

## 8. Acceptance criteria

### The list is read and counted

Given phax.json with `"protectedPaths": ["**/steme.baseline.json"]`, when `phax validate` runs, then it exits 0 and prints `1 protected path glob`. (refs §5.1)

### A malformed list is refused

Given phax.json with `"protectedPaths": []`, then with `["../shared/allow.json"]`, then with `["/abs/x.json"]`, when `phax validate` runs on each, then each exits 2; the second and third name protectedPaths[0] and the offending rule, the first names protectedPaths. (refs §5.2)

### An overlay cannot set or empty the list

Given phax.json declaring `protectedPaths` and a phax.local.json carrying `"protectedPaths": []`, then the same in ~/.phax/config.json, when `phax validate` or `phax run` loads the configuration, then it exits 2 with `"protectedPaths" is accepted only in phax.json` naming the overlay file. (refs §5.3)

### Nothing declared, nothing changes

Given a project whose phax.json has no `protectedPaths`, when a phase runs on each provider through the fake CLIs, with a red gate then a green one, then the argv, phase prompt, fix prompt, security.json, file-reconciliation.json and run output equal those of the same run on the current release. (refs §5.4)

### An agent's edit is put back before the gate

Given `protectedPaths` ["**/steme.baseline.json"] and a fake agent whose turn adds an entry to packages/rust/steme-formats/steme.baseline.json, when the agent's turn ends, then the file holds its base content before the first gate step runs, the refusal line names the path, `modified`, the agent turn and protectedPaths[0], and security.json's protectedPaths.refusals holds one entry with point `agent-turn`. (refs §5.6, §5.8, §5.9, §5.26)

### Creations, deletions and renames are put back

Given the same list and a fake agent that creates packages/a/steme.baseline.json, deletes packages/b/steme.baseline.json and renames packages/c/steme.baseline.json to packages/c/old.json, when the agent's turn ends, then packages/a/steme.baseline.json no longer exists, packages/b/steme.baseline.json and packages/c/steme.baseline.json hold their base content, and three refusals are recorded (added, deleted, deleted). (refs §5.8)

### A setup command's write is put back

Given `commands.setup` running a script that rewrites packages/a/steme.baseline.json, when setup ends, then the file holds its base content before the agent's turn starts and a refusal with point `setup` is recorded. (refs §5.6, §5.8)

### A gate command that writes a protected file fails its attempt

Given a gate profile whose step `node scripts/accept-debt.js` writes an entry into packages/a/steme.baseline.json and exits 0, and a later step that passes, when the gate runs, then the file is restored before the later step runs, the attempt is failed although every step exited 0, the fix prompt names the step and the path, and the refusal has point `gate-step` with the attempt and the command. (refs §5.7, §5.10, §5.8)

### A fix attempt's edit is put back and reported

Given a red gate and a fake agent whose first fix attempt writes packages/a/steme.baseline.json, when the fix attempt ends and the gate runs again, then the gate runs on the restored file, and the next fix prompt's Protected paths section lists the path as modified during fix attempt 1. (refs §5.6, §5.14)

### Work that passes without the protected change goes on

Given a fake agent that fixes the code and also writes packages/a/steme.baseline.json, when the restored tree passes the gate, then the phase commits with the file at its base content, the refusal is recorded in security.json and the final report, and no fix attempt is spent on it. (refs §5.8, §5.11, §5.28)

### What the loop cannot fix reaches the operator

Given a fake agent that writes the protected file at every attempt and never fixes the code, when the fix attempts are exhausted, then the phase is in gates_exhausted, phax exits 4, the output and resume-instructions.md name the path and the commit-then-resume route, and the worktree holds the file at its base content. (refs §5.15, §5.16)

### A handoff turn's write never lands

Given a green gate and a fake agent whose handoff turn writes packages/a/steme.baseline.json, when the phase commits, then the commit holds the file at its base content, a refusal with point `handoff-turn` is recorded, and no fix attempt runs. (refs §5.12, §5.11)

### An agent's own commit does not carry it through

Given a phase on codex-cli whose fake agent commits a change to packages/a/steme.baseline.json during its turn, when the phase commits, then the phase branch's tip holds the file at its base content, a refusal is recorded, and security.json's protectedPaths.enforcement is `detected-only`. (refs §5.11, §5.6, §5.26)

### The agent is told up front

Given `protectedPaths` ["**/steme.baseline.json"], when phax builds a phase prompt, then it carries a `## Protected paths` section listing `**/steme.baseline.json` and the instruction to leave an unfixable hole failing and report it in the handoff. (refs §5.13)

### Claude Code is denied the write up front

Given a phase on claude-code in secure mode with the list declared, when phax spawns the phase turn, a fix attempt and the handoff turn, then each invocation's inline settings deny every protected glob to Edit, Write and MultiEdit, and security.json's protectedPaths.enforcement is `enforced`. (refs §5.24, §5.26)

### Vibe is denied the write up front

Given a phase on mistral-vibe in secure mode with the list declared, when phax spawns a turn, then the turn's tool configuration denies every protected glob to write_file and edit, and security.json's protectedPaths.enforcement is `enforced`. (refs §5.25, §5.26)

### Detection holds in unsafe mode

Given `phax run --security unsafe` on claude-code with the list declared and a fake agent that writes the protected file, when the agent's turn ends, then the file is restored, the refusal is recorded, and protectedPaths.enforcement is `detected-only`. (refs §5.5, §5.8)

### The operator's commit while paused is theirs

Given a phase paused in gates_exhausted after a refusal, and the operator committing an entry in packages/a/steme.baseline.json on the phase branch in its worktree, when `phax resume` runs, then the gate runs with the committed content, no refusal is recorded, the phase commit keeps it, and file-reconciliation.json lists it under reviewCorrections. (refs §5.17)

### An uncommitted change at resume is refused

Given a paused phase whose worktree holds an uncommitted change to a protected path, when `phax resume` runs, then it exits 1 naming the path and both remedies, and the worktree, the run state and the records are unchanged. (refs §5.18)

### A person's change at a stop is theirs

Given a held stop and a person editing packages/a/steme.baseline.json in the phase worktree, when `phax resume` closes the stop with a green gate, then the review commit carries the change, file-reconciliation.json lists it under reviewCorrections, no refusal is recorded, and the next phase's reference holds the new content. (refs §5.19)

### A close's gate may not rewrite it

Given a declared stop whose close runs the step `node scripts/accept-debt.js`, which writes the protected file, when `phax resume` closes the stop, then the file holds the person's content again, phax exits 4 and the run stays in awaiting_review. (refs §5.20)

### Lint reports a headless phase that plans a protected file

Given a plan whose headless phase-05 lists packages/rust/steme-formats/steme.baseline.json among its files to edit, when `phax plans lint` runs, then it reports one `protected` error naming phase-05, the path and protectedPaths[0], and exits 1. (refs §5.21)

### The run is refused before it is named

Given the same plan, when `phax run --plan` runs, and `phax resume` runs on a run whose phax.json gained the list since it started, then each exits 11 with `Protected-path preflight failed` naming phase-05 and the path; `phax run` names no run and leaves nothing behind. (refs §5.22)

### An interactive phase may plan it

Given the same file listed in a phase declared `**Mode:** interactive`, when `phax plans lint` and `phax run --plan` run, then lint reports no `protected` finding and the run starts. (refs §5.23)

### The operator sees each provider's enforcement

Given a project declaring `protectedPaths`, when `phax security status` runs, then its table has a Protected Paths column reading `enforced` for claude-code and mistral-vibe and `detected-only` for codex-cli, followed by the project's globs. (refs §5.27)

## 9. Open questions

### q-key-location — Where does the key live: top level of phax.json, or inside the security block?

- top-level — A top-level `protectedPaths` list — abandons: Grouping with the other filesystem settings, where a reader of the security block would look first.
- security-filesystem — `security.filesystem.protect` — abandons: One layering rule for the security block (overlays may set it, except this one key) and the reading that the protection holds whatever the security mode, which a key under `security` suggests it depends on.

Recommendation: top-level — The protection is the gate's integrity, not the sandbox's: it holds in every mode, unsafe included, and only in phax.json. A key outside the overlay-settable security block keeps both facts visible, as `assignments` does.

### q-on-refusal — What does a refused write do: restore it and let the gate and fix loop go on, or stop the phase at the first refusal?

- restore-and-loop — Restore, record, let the gate judge the restored tree and the fix loop go on — abandons: An immediate stop that shows the operator the agent's attempt at once; the attempt is reported, and reaches a person only if the loop ends red.
- stop-on-first — Pause the phase in gates_exhausted at the first refusal — abandons: The agent's chance to fix the hole in the code once told the file is not its own; one stray write, or a gate command that always writes, ends the phase.

Recommendation: restore-and-loop — The guarantee is that no refused change lands, and restoring gives it as fully as stopping. The loop then does what it does for any red gate, and what it cannot fix pauses the phase as an exhausted gate does.

### q-plan-declares — What happens to a plan that lists a protected path among a phase's planned files?

- refuse-headless — Refused at lint and preflight in a headless phase, accepted in an interactive phase — abandons: A plan's ability to have an agent make a deliberate, approved change to a protected file without a person at the keyboard.
- refuse-always — Refused in every phase — abandons: Any plan route to a protected change: the operator must make it outside the plan, between runs.
- allow-with-flag — Allowed with a run flag, as `--allow-skill-edits` — abandons: The protection itself: the person who passes the flag approves the whole file without seeing each entry the agent will write.

Recommendation: refuse-headless — An interactive phase is the existing place where a person does the work and phax enforces nothing on them, so it is the plan's route to an operator change. A flag would recreate the steme-lab case with a signature on it.

### q-layers — Which configuration layers may set the protected list?

- project-only — phax.json only; overlays carrying it are refused — abandons: A workstation's ability to add protections of its own on top of the project's.
- project-plus-add-only — phax.json, plus overlays that may add globs but never remove one — abandons: The rule that a run's protection is the repository's alone: the same plan would be protected differently on two machines, and the merge needs a rule no other key has.

Recommendation: project-only — The files are the project's decisions, reviewed with its code, as the assignment bounds are. An overlay that cannot empty the list could still make records differ across machines, and nobody has asked for a local addition.

### q-operator-route — How does the operator change a protected file while a run is paused?

- commit — Commit the change on the phase branch, then `phax resume`; an uncommitted change is refused at resume — abandons: One gesture for every manual fix at a pause: other fixes stay uncommitted in the worktree, as resume-instructions.md says today.
- uncommitted — Any protected change present at resume is the person's, committed or not — abandons: Determinism after an interrupted phase: phax cannot restore before a crash, so an agent's change left in the worktree would be taken as the person's.

Recommendation: commit — A commit is an act a person makes on purpose and phax can date against the head it recorded at the pause, on every pause kind. The extra gesture is confined to protected files, and the refusal names it.

### q-record-field — Is the protectedPaths section of security.json present when the project declares nothing?

- absent-when-none — Present only when `protectedPaths` is declared — abandons: The rule that new persisted fields are required: a reader cannot tell a phase with no protection from one written before this feature.
- always-present — Always present, `null` when nothing is declared — abandons: The additive promise that a project declaring nothing sees no change: every security.json and phase record gains a field.

Recommendation: absent-when-none — The brief makes the additive promise a constraint and adds the section at the current version. Both cases mean no protection applied, so what is lost is only telling an older file from a project that declared nothing.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- Detection by comparing the worktree with the reference at every check point is the guarantee, on every provider and in every security mode; prevention is a convenience and is recorded as enforced or detected-only.
- A refused change is restored, never committed; the gate judges the restored tree; a gate attempt during which a gate step produced a protected change fails.
- No new phase state, run state or stop kind: refusals end in gates_exhausted (exit 4) or, at a close, in awaiting_review with exit 4.
- At a stop, protected changes present before the close's gate runs are the person's and go to reviewCorrections; at a pause, only commits on the phase branch since the recorded head are the operator's.
- A rename is two changes, a deletion and a creation; only tracked and untracked-not-ignored files are protected.
- Globs use phax's existing glob dialect, the one the architecture report and assignment bounds use.

Left open:

- The six §9 questions; the key's name and place in §6 follow q-key-location.
- The exact wording of the refusal line, the lint finding, the resume refusal and the prompt section; the security.json field names are normative.
- How the head of the phase branch is recorded at a pause, in which persisted file, as an added field at its current version.
- Whether a pending phase branches from the previous phase's branch tip or from its recorded commit, which decides whether an operator commit made between two phases reaches the next phase's base without further work.

Constraints:

- Additive: a project that declares no protected path sees byte-identical argv, prompts, security.json, reconciliation, records and output; persisted formats change only by adding fields, at their current version.
- The real-CLI e2e suite must show that Claude Code's deny rules block Edit, Write and MultiEdit on a path matched by each glob form phax accepts, and that Vibe's write_file and edit deny lists do likewise; where a glob form cannot be expressed exactly in a provider's rule syntax, that provider records detected-only, never enforced.
- Prevention is passed in secure mode only; in unsafe mode every provider records detected-only, and detection still runs.
- Restoring must never touch a non-protected path, and must leave the worktree's other uncommitted changes as they are.
- The overlay refusal follows the `assignments` one: refused before decode, naming the remedy.
- docs/security.md gains a Protected paths section; the CLI reference, README run section and phax.usage.kdl help of run, resume, validate, plans lint and security status are updated with it.

## 11. Docs page

Page: docs/security.md#protected-paths

Reader: A project owner whose gates read a file in which a person records what the gate tolerates (a debt baseline, a lint allowlist, accepted snapshots), and who wants no phase of a run to rewrite it.

Example: steme-lab lists `**/steme.baseline.json` in phax.json; an agent that cannot fix a hole writes an acceptance into the baseline, phax puts the file back, the fix loop is told the file is the operator's, and the phase pauses with the path named, so the author decides whether to accept the debt and commits it before `phax resume`.
