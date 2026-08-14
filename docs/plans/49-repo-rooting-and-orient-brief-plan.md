---
status: Draft
source-spec: null
---

# Repo Rooting and Orient Brief

## Overview

Two spec-less follow-ups from `NEXT_STEPS.md`, carried by one run because each is a
single reviewable commit and neither is large enough to justify its own approve → run →
review → publish cycle.

**1. Path rooting (phases 01–02).** phax claims to be an extension of git, but only its
git side keeps git's contract of working from anywhere in the tree: git operations are
rooted at `config.repoRoot`, while the `FileSystem` port resolves relative paths against
`process.cwd()`. The two disagree the moment you invoke phax from a subdirectory — the
staleness gate reads the real baseline through git but misses `docs/plans/approvals.json`
through the port, reports a spurious `missing-record`, and refuses an approved run. The
repo-relative literals that break are concrete: `docs/plans` in `src/app/artifactStatus.ts`
and `src/app/planStaleness.ts`, and `APPROVALS_FILE_PATH` in `src/domain/artifact/lineage.ts`.
Paths that are already absolute — `stateRoot`, `PHAX_HOME_DIR`, `MODEL_ROUTING_PATH` — are
unaffected either way, because a rooted view passes absolute paths through unchanged.

The mechanism already exists: plan 48 added `FileSystemOps.rootedAt(root)` to the port and
to both adapters. What is left is the composition decision — build the layer rooted at
`repoRoot` — plus the input hygiene that decision requires: a path a user types on the
command line must be resolved against the invocation directory *before* it crosses the
port, or rooting would silently reinterpret it as repo-relative. That hygiene lands first
(phase-01) so no commit on this branch ever holds the half-state.

**2. Orientation brief artifact (phase-03).** The orientation index computed per phase is
woven into `prompt.md` and counted in one telemetry event, then discarded — the rows the
prompt truncated away are unrecoverable, and a run where the orient provider failed is
indistinguishable after the fact from a run with no provider configured. Persist it as
`orient-brief.json` in the phase folder next to `prompt.md`, as a tagged record covering
all three outcomes. This amends the behavior of archived spec 17; it adds no CLI surface
and nothing reads the file yet.

## Technical arbitrations

Settled with the user before the phases were written:

- **One plan for both follow-ups**, not two. Accepted loss: independent revert and review
  — a red gate or a rejected review on the rooting work parks the brief work in the same
  branch. Each phase is still its own commit, so the PR stays reviewable commit by commit.
- **A shared rooted-layer helper plus an architectural guard**, not a factory each command
  calls freely. Accepted loss: per-command freedom — commands that legitimately run
  without a resolved config must be named in an explicit allowlist rather than each site
  deciding for itself. Bought: a new command cannot silently forget to root and
  reintroduce this exact bug in one line.
- **`orient-brief.json` is a tagged record** (`ok` | `failed` | `not-configured`), not a
  rows-only file written on success. Accepted loss: simplicity — the file needs a variant
  schema and any future reader must switch on the tag. Bought: the negative evidence,
  which is most of the reason to inspect the file at all. This follows the repo
  convention of explicit per-variant shapes over one permissive superset.
- **CLI path arguments are absolutized, not rewritten repo-relative.** Accepted loss:
  consistency with `phax artifact`, which converts to repo-relative because its
  path-scoped commit needs that form. Bought: a path typed on the command line keeps
  meaning "relative to where I typed it" — git's own contract — and `rootedAt` passes
  absolute paths through untouched, so the port never reinterprets user input.

## Required commands

- (none)

## phase-01 — CLI path arguments resolve against the invocation directory {#phase-01-cli-path-args}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Every path a user types on the command line resolves against the directory they typed it
in, explicitly rather than by accident of `process.cwd()` being the repo root. This is the
precondition for phase-02: once the port is rooted at `repoRoot`, any relative path that
reaches it means "repo-relative", so user input must already be absolute by then.

### Detailed instructions

- Audit every CLI surface that accepts a filesystem path and make the resolution explicit
  at the command layer, before any port or `node:fs` call:
  - `phax run --plan <path>` — already resolves via `resolve(cwd, opts.plan)`; keep and
    cover with a test.
  - `phax extract-plan --plan-md <path> --out <path>` — already resolves both; keep and
    cover with a test.
  - `phax artifact <path>` — already absolutizes, then converts to repo-relative for the
    path-scoped commit; leave the repo-relative conversion alone, it is required by
    spec 25's write-set scoping.
  - `phax adjust-plan <plan>` — passes the raw argument to `readFile`; resolve it against
    `process.cwd()` first.
  - `phax validate --plan <path>` — passes the raw option to `loadPlan`; resolve it
    against `process.cwd()` first.
- Keep the error messages quoting the path the user typed, not the resolved absolute path
  — a "file not found" naming a path the user never wrote is worse than the current
  message.
- Do not change how the resolved path is passed onward; this phase changes resolution
  only, never the consumer.
- Record in the handoff the exhaustive list of path-accepting CLI surfaces you found and
  what each does now, since phase-02 relies on that list being complete.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/commands/adjustPlan.ts`
- `src/cli/commands/validate.ts`
- `tests/unit/cli/validate.test.ts`

### Optional files that may be edited

- `tests/integration/adjustPlanCommand.test.ts`
- `tests/unit/cli/run.test.ts`

### Boundary contracts

CLI → application. The command layer is the only place that may consult
`process.cwd()`; everything below it receives an absolute path or a repo-relative one it
was explicitly handed. No application or domain module gains a new parameter in this
phase.

### Test strategy

Write the tests first — they encode the contract phase-02 depends on. At the CLI layer
(unit tests with a fake or temporary directory): invoking `validate --plan` and
`adjust-plan` with a relative path from a directory that is not the repo root resolves
against that directory. Add the equivalent assertion for `run --plan` and
`extract-plan` only if the existing tests do not already cover it — do not duplicate
coverage.

### Implementation order

Tests first, then `validate.ts`, then `adjustPlan.ts`. Both are one-line resolutions; the
work is in the audit and the tests.

### Excluded scope

- `phax orient --file <path>` — that path is sent to the orient provider as an opaque
  string in the request body, not resolved through the `FileSystem` port, so rooting does
  not affect it. Leave it alone.
- Any change to the `FileSystem` layer or its wiring (phase-02).
- Replacing `adjustPlan.ts`'s direct `node:fs` `readFile` with a port call — a real
  boundary violation, but a separate concern from path resolution and out of scope here.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exhaustive list of path-accepting CLI surfaces, and for each: whether it already
  resolved against cwd, what it does after this phase, and whether it converts to
  repo-relative afterwards.
- Confirmation that no consumer signature changed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(cli): resolve path arguments against the invocation directory

### Commit body

Resolve the `adjust-plan` plan argument and `validate --plan` against process.cwd()
explicitly, matching what `run`, `extract-plan` and `artifact` already do. Today these
work only because the CLI is invoked from the repo root; once the FileSystem layer is
rooted at repoRoot, a relative path reaching a port means repo-relative, so user input
must be absolute before it crosses that boundary.

Error messages keep quoting the path as typed.

## phase-02 — Root the FileSystem layer at the repo root {#phase-02-repo-rooted-fs}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

`phax` commands behave identically from any directory in the repository, matching git's
own contract: relative paths crossing the `FileSystem` port resolve against `repoRoot`,
not against the process working directory.

### Detailed instructions

- In `src/infra/fs.ts`, add a layer factory that builds the ops rooted at a given root
  (reuse `makeNodeFileSystemOps` and the existing `rootedAt`; do not reimplement path
  resolution). Keep the current identity `NodeFileSystemLayer` export — it stays correct
  for the commands that run without a resolved config, and for layers whose paths are
  already absolute.
- In the CLI layer, add one helper — put it in `src/cli/commands/runLayers.ts`, which is
  already the shared layer-composition module — that turns a `ResolvedConfig` into the
  repo-rooted `FileSystem` layer. Route `provideRunLayers` through it.
- Migrate every command that has a resolved config to the helper. From the current tree
  those are: `adjustPlan`, `agent`, `archive`, `artifact`, `extractPlan`, `ls`, `orient`,
  `plans`, `plansOverlap`, `publishPr`, `report`, `resetPhase`, `resume`, `reviewCode`,
  `reviewCompliance`, `reviewHandoff`, `run`. Verify each one against the tree rather than
  trusting this list, and report any correction in the handoff.
- Leave on the identity layer, and record the final allowlist in the handoff: commands
  that run before or without a resolved config (`init`, `skills`, `security` — verify),
  and `makeGlobalTelemetryJournalLayer(PHAX_HOME_DIR)`, whose paths are absolute.
- Add the guard to `tests/unit/architecturalGuards.test.ts`: no file under
  `src/cli/commands/` may import the identity `NodeFileSystemLayer` unless it is in the
  allowlist, so a new command cannot silently reintroduce cwd-rooting. The failure message
  must name the helper to use instead.
- `phax artifact` already converts its path argument to repo-relative before handing it
  down; confirm that still lands on the same file under a rooted layer and that spec 25's
  path-scoped commit is unaffected.

### Planned files to create

- `tests/integration/repoRootedCli.test.ts`

### Planned files to edit

- `src/infra/fs.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/adjustPlan.ts`
- `src/cli/commands/agent.ts`
- `src/cli/commands/archive.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/commands/extractPlan.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/orient.ts`
- `src/cli/commands/plans.ts`
- `src/cli/commands/plansOverlap.ts`
- `src/cli/commands/publishPr.ts`
- `src/cli/commands/report.ts`
- `src/cli/commands/resetPhase.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/reviewCode.ts`
- `src/cli/commands/reviewCompliance.ts`
- `src/cli/commands/reviewHandoff.ts`
- `src/cli/commands/run.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/ports/fs.ts`
- `src/cli/commands/init.ts`
- `src/cli/commands/security.ts`
- `src/cli/commands/skills.ts`
- `tests/unit/cli/plans.test.ts`
- `tests/unit/cli/artifact.test.ts`

### Boundary contracts

CLI → ports. The composition root decides what a relative path means; no application or
domain module learns about `repoRoot` as a result of this phase, and no port signature
changes — `rootedAt` already exists. Consumers keep passing the same repo-relative
literals (`docs/plans`, `docs/plans/approvals.json`) and keep getting the same files, now
regardless of the working directory.

### Test strategy

Write the integration test before the migration. In a temporary git repository with a
`phax.json` and a `docs/plans/` tree, invoke the command path from a nested subdirectory
and assert it reads the same artifacts it reads from the root — `phax plans status` is
the sharpest case, since the cwd/`repoRoot` disagreement is exactly what produced the
spurious `missing-record`. Add an assertion that an absolute path argument still resolves
to itself under the rooted layer. The architectural guard is itself a unit test; assert it
fails for a command that imports the identity layer without being allowlisted.

### Implementation order

Infra factory → CLI helper and `provideRunLayers` → per-command migration → architectural
guard last, so it lands green against the finished allowlist.

### Excluded scope

- Rooting the base layer at anything other than `repoRoot` (worktree rooting already has
  its consumer in `completeRunArtifacts` and is unchanged here).
- Any change to `loadConfig`'s direct `node:fs` / `execSync` use. It runs before the
  layers exist and is what supplies `repoRoot`; reworking it is a separate concern.
- Migrating `adjustPlan.ts`'s direct `readFile` to the port.
- Changing what any command reads or writes — this phase changes only where relative
  paths resolve from.

### Expected handoff content

- The final allowlist of commands still on the identity layer, with the reason each is on
  it, and the guard's exact failure message.
- Any correction to the migration list above, with the reason.
- The exported name and signature of the rooted-layer helper in `runLayers.ts`.
- Confirmation that `phax artifact`'s repo-relative conversion and spec 25's path-scoped
  commit still land on the same files.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(cli): root the filesystem layer at the repo root

### Commit body

phax's git operations are rooted at config.repoRoot while the FileSystem port resolved
relative paths against process.cwd(), so invoking phax from a subdirectory made the two
disagree: the staleness gate read the real git baseline but missed
docs/plans/approvals.json, reported a spurious missing-record, and refused an approved
run.

Build the FileSystem layer rooted at repoRoot for every command that has a resolved
config, through a single helper in runLayers.ts, using the rootedAt port method added by
plan 48. Commands that run without a config, and layers whose paths are already absolute,
stay on the identity layer and are named in an allowlist enforced by an architectural
guard, so a new command cannot silently reintroduce cwd-rooting.

Covered by an integration test invoking the CLI from a nested subdirectory.

## phase-03 — Persist the orientation brief as an artifact {#phase-03-orient-brief-artifact}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Every phase folder gains an `orient-brief.json` next to `prompt.md` recording what the
orient provider was asked, what it answered, and how much of that answer the prompt
actually carried — including when the provider failed or none was configured.

### Detailed instructions

- Add a schema for the artifact in `src/schemas/orientBrief.ts` as a tagged union on a
  `kind` field with exactly three variants — no permissive superset, no optional fields
  standing in for a variant:
  - `ok` — the files queried, the full row set returned (not the truncated set), the
    number of rows the prompt actually wove, and the row count.
  - `failed` — the files queried and the provider error message, bounded the same way
    `orient.ts` bounds a stderr excerpt.
  - `not-configured` — no `orient` block in `phax.json`; no query was made.
- Write the file from `executePlan` in the same place the brief is computed today, next to
  `prompt.md` in the phase folder, through the `FileSystem` port, for all three variants.
  Write it before dispatch, so an interrupted phase still leaves the evidence.
- The rows written must be the provider's full response. `buildPhasePrompt` truncates at
  `MAX_ORIENTATION_ROWS`; the count it wove is data in the artifact, not a reason to drop
  rows.
- Do not change the advisory contract: a provider failure must still never fail, block, or
  retry the phase, and must still leave the prompt unchanged. A failure to write
  `orient-brief.json` must be treated the same way — it is evidence, not a gate.
- Keep the existing `orient.brief.computed` telemetry event exactly as it is; the artifact
  complements it and does not replace it.
- Nothing reads the file yet. Do not add a CLI command, a report section, or a decoder
  call site.

### Planned files to create

- `src/schemas/orientBrief.ts`
- `tests/unit/orientBrief.test.ts`
- `tests/integration/orientBriefArtifact.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`

### Optional files that may be edited

- `src/app/promptGeneration.ts`

### Boundary contracts

Application → ports. `executePlan` produces the record and writes it through the
`FileSystem` port; the schema is the shape any future reader decodes. The orient
application module (`src/app/orient.ts`) keeps returning its typed `Either` and learns
nothing about persistence.

### Test strategy

Schema tests first (unit): each variant round-trips, and a record with a `kind` outside
the three variants is rejected. Then an integration test with fake ports driving
`executePlan` past the orient step three times — provider answers, provider fails, no
provider configured — asserting the file exists in the phase folder with the right variant
each time, that the `ok` variant carries the full row set when the prompt truncated, and
that the failing case still dispatched the phase with an unchanged prompt.

### Implementation order

Schema and its tests → the integration test → the `executePlan` write.

### Excluded scope

- Any consumer of the file: no CLI command, no report section, no review-handoff input.
- Changes to `MAX_ORIENTATION_ROWS` or to how the prompt weaves the index.
- Changes to the `orient.brief.computed` telemetry event or to `phax orient`'s own pull
  path.
- Backfilling the artifact into existing run folders.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/schemas/orientBrief.ts`, the exported decoder name, and the three
  variant shapes as implemented.
- The phase-folder filename and where in `executePlan` the write happens relative to
  prompt generation and dispatch.
- Confirmation that a provider failure still leaves the prompt unchanged and the phase
  dispatched.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(orient): persist the orientation brief as a phase artifact

### Commit body

The per-phase orientation index was woven into prompt.md and counted in one telemetry
event, then discarded: the rows the prompt truncated were unrecoverable, and a run whose
orient provider failed was indistinguishable afterwards from a run with no provider
configured.

Write orient-brief.json next to prompt.md in the phase folder as a tagged record — ok
(files queried, the full row set, how many rows the prompt wove), failed (bounded provider
error), or not-configured — for every phase, before dispatch. The channel stays advisory:
a provider failure, or a failure to write the brief, still never fails, blocks, or retries
the phase.

Nothing consumes the file yet.
