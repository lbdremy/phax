# Plan 17 — Install the PHAX planning skill into agent CLIs

Implements `docs/specs/08-install-planning-skill.md`: a `phax skills install`
command that copies the bundled `phax-planning` skill into the native skill
directory of a selected agent target (`claude` | `codex` | `agent`) at a selected
scope (`project` | `user`).

Two prerequisites precede the command:

1. **Inline the phase-handoff guidance.** `phax-phase-handoff` is consumed
   mid-run by the agent inside the worktree phax drives. Referencing it by a
   repo-relative path is broken for end users (their repo has no such file), so
   its guidance moves directly into the phase prompts and the doc is deleted.
2. **Relocate the remaining skills.** Convert the other flat `.skills/*.md` files
   into the standard `.claude/skills/<name>/SKILL.md` Agent Skills layout, so phax
   dogfoods its own skills via Claude Code discovery and the bundled
   `phax-planning` skill is a real, discoverable directory the command can copy.

## Problem

PHAX ships planning guidance as a flat `.skills/phax-planning.md` file. There is
no way for a user to install it into their own project so their agent picks it up
when authoring a `plan.md` for `phax extract-plan`. The spec asks PHAX to *own*
the installation of its planning skill — copy the bundled skill directly to the
target agent's native skill location, with no `node_modules` dependency and no
separate skill installer.

A second, related defect: the phase prompts tell the executing agent to "consult
`.skills/phax-phase-handoff.md`", a path that only resolves when phax runs on its
own repo. On any user project that file is absent, so the pointer is dead.

## Desired behavior

```bash
phax skills install --target claude --scope project
```

copies the bundled `phax-planning` skill to the target's native skill directory,
idempotently, and reports target / scope / skill name / destination / whether it
was created, updated, or already present.

Target → base directory mapping (skill dir is always `<base>/phax-planning`):

| target | project scope        | user scope               |
| ------ | -------------------- | ------------------------ |
| claude | `<cwd>/.claude/skills` | `<home>/.claude/skills` |
| codex  | `<cwd>/.agents/skills` | `<home>/.agents/skills` |
| agent  | `<cwd>/.agents/skills` | `<home>/.agents/skills` |

`codex` and `agent` map to the same `.agents/skills` location today; they are kept
as distinct targets so Codex-specific behavior can diverge later (spec §5.2).

## Scope decisions

- **Two kinds of skill, handled differently.**
  - `phax-planning` is consulted *before* a run, while authoring `plan.md`. Its
    whole purpose is to live in the user's repo, so it is the shippable skill the
    install command copies.
  - `phax-phase-handoff` is consulted *during* a run by the agent inside the
    driven worktree. It cannot rely on a file being present in an arbitrary
    repo, so its guidance is inlined into the phase prompts and the standalone
    doc is removed (phase-01). It is never installed.
- **Relocate skills to `.claude/skills/`, expose only `phax-planning`.** Convert
  the remaining `.skills/<name>.md` files into the standard Claude Code layout
  `.claude/skills/<name>/SKILL.md` (a directory with a `SKILL.md` carrying
  `name`/`description` frontmatter). This puts phax's own skills where Claude Code
  discovers them and replaces the custom `.skills/` folder. Only `phax-planning`
  becomes installable; the rest remain internal dev guidance (spec §2). A small
  **exposed-skill catalog** is the single source of truth for what
  `phax skills install` can install — internal skills are simply absent.
- **Ship only the planning skill.** The bundled skill source is
  `.claude/skills/phax-planning/`. `package.json` gains a `files` whitelist of
  `["dist", ".claude/skills/phax-planning"]` so the release includes the compiled
  CLI and exactly the one shippable skill — internal dev skills are not shipped.
- **`--target` required; `--scope` defaults to `project`.** `--target` is a
  required option; `--scope` is optional and defaults to `project`. Invalid
  values fail with exit code 2 and a message listing valid values. No
  `--target all` (spec §3, AC 8). Per the "explicit per-variant enums" doctrine,
  the valid targets and scopes are literal unions, not a permissive string.
- **Idempotency is explicit and overwrites our own files.** Status is computed by
  comparing the bundled file content against what is on disk: `created` (skill
  dir absent), `already-present` (every manifest file present and byte-identical),
  `updated` (present but differing — we rewrite it). We only ever write the files
  in the skill's manifest; we never delete unrelated files in the directory and
  never touch `AGENTS.md` / `CLAUDE.md` / `.cursorrules` / copilot instructions
  (spec §8).
- **No new `FileSystem` port methods.** The skill is copied by iterating a known
  file manifest (`["SKILL.md"]`) and using existing `readText` / `exists` /
  `writeAtomic`. This is deterministic and forward-compatible (a future skill
  with extra files just lists them) and avoids adding `readDir`/`copyTree`.
- **Package-relative bundle resolution.** The bundle root is
  `join(import.meta.dirname, "../../..", ".claude", "skills")` from the CLI
  command file, which resolves to the package root in both `tsx src/...` (dev) and
  `dist/...` (built), since `cli/commands` sits 3 levels under each. The published
  package preserves `.claude/skills/phax-planning/SKILL.md` at the package root
  via the `files` whitelist.

## Affected gate profile

All phases verify against the project's configured `full` gate profile in
`phax.json`.

---

## phase-01 — Inline phase-handoff guidance and remove the doc {#phase-01-inline-handoff}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Move the phase-handoff guidance out of the standalone `.skills/phax-phase-handoff.md`
file and directly into the phax prompt builders, then delete the doc. phax already
inlines the four required section headings and validates them; what is missing
from the prompt is the per-section *guidance* the agent currently has to open a
repo file to read — a file that does not exist in a user's project. After this
phase the prompts are self-contained.

### Detailed instructions

- Create `src/app/handoffGuidance.ts` as the single source of truth:
  - Move `REQUIRED_HANDOFF_SECTIONS` here (currently a local const in
    `handoffGeneration.ts`, and duplicated as literal headings in
    `promptGeneration.ts`); export it.
  - Export `HANDOFF_GUIDANCE_LINES: readonly string[]` — a condensed,
    prompt-ready distillation of the deleted doc: one short line of guidance per
    section (what to write under each heading), plus the tone/quality rules
    (150–400 words; bullet lists; no transcript summaries; name decisions, risks,
    and known gaps; explain any reconciliation file-plan deviations under "What
    the next phase needs to know"). Keep it tight — this is injected into every
    phase prompt.
  - Optionally export a small helper that returns the full handoff block (section
    headings + guidance) so both call sites stay identical.
- `src/app/handoffGeneration.ts`: import `REQUIRED_HANDOFF_SECTIONS` and the
  guidance from `handoffGuidance.ts`; replace the
  `"Consult \`.skills/phax-phase-handoff.md\` …"` line in `buildHandoffPrompt`
  with the inlined `HANDOFF_GUIDANCE_LINES`. Keep `validateHandoffSections`
  behavior unchanged.
- `src/app/promptGeneration.ts`: replace the
  `"Consult \`.skills/phax-phase-handoff.md\` …"` line (around line 107) with the
  inlined guidance; reuse `REQUIRED_HANDOFF_SECTIONS` from `handoffGuidance.ts`
  instead of the duplicated literal headings if practical.
- Delete `.skills/phax-phase-handoff.md`.
- `tests/unit/skills.test.ts`: remove the `phax-phase-handoff.md skill` describe
  block (the file no longer exists). Leave the `phax-planning` block as-is for now
  (phase-02 updates its path).
- Regenerate snapshots: `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
  changes because the prompt text changed — run the prompt tests with `-u` and
  review the diff so the new inlined guidance is what gets snapshotted.
- Add focused coverage in `tests/unit/handoffGuidance.test.ts`: assert
  `REQUIRED_HANDOFF_SECTIONS` has the four headings in order and that
  `HANDOFF_GUIDANCE_LINES` is non-empty and mentions the 150–400 word bound.

### Planned files to create

- `src/app/handoffGuidance.ts`
- `tests/unit/handoffGuidance.test.ts`

### Planned files to edit

- `src/app/handoffGeneration.ts`
- `src/app/promptGeneration.ts`
- `tests/unit/skills.test.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`

### Optional files that may be edited

- `tests/unit/promptGeneration.test.ts`
- `tests/unit/handoffGeneration.test.ts`

### Boundary contracts

None inside `src/` layers — `handoffGuidance.ts` is an `app/` module consumed by
two other `app/` modules. The semantic contract is with the executing agent: the
phase prompt must be self-sufficient (no external file reference) and still name
the four headings `phax` validates.

### Test strategy

Application command level via the existing prompt tests (`promptGeneration.test.ts`,
`handoffGeneration.test.ts`): regenerate and review the snapshot so the inlined
guidance is asserted, plus a small unit test over `handoffGuidance.ts`. Write the
`handoffGuidance.test.ts` assertions alongside the module (stable contract: the
four headings and their order).

### Implementation order

`handoffGuidance.ts` (+ test) → wire into `handoffGeneration.ts` and
`promptGeneration.ts` → delete the doc and trim `skills.test.ts` → regenerate the
snapshot.

### Excluded scope

- Relocating the other skills (phase-02).
- Any install command or domain/app/CLI work (phase-03+).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact path and exports of `src/app/handoffGuidance.ts`
  (`REQUIRED_HANDOFF_SECTIONS`, `HANDOFF_GUIDANCE_LINES`, any helper).
- Confirmation `.skills/phax-phase-handoff.md` is deleted and both prompt builders
  no longer reference it.
- That the `promptGeneration` snapshot was regenerated and reviewed (the prompt
  text intentionally changed).

### Commit subject

refactor(handoff): inline phase-handoff guidance into prompts, drop the doc

### Commit body

Move the phase-handoff guidance into a new src/app/handoffGuidance.ts consumed by
buildHandoffPrompt and the phase prompt builder, and delete
.skills/phax-phase-handoff.md. The phase prompt no longer points at a repo-relative
file that does not exist in user projects; the guidance now travels with the
prompt. Snapshot and skills test updated.

---

## phase-02 — Relocate `.skills/` into `.claude/skills/` Agent Skills format {#phase-02-skills-format}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Move every remaining flat `.skills/<name>.md` file into the standard Claude Code
skills location in the proper Agent Skills layout: a `.claude/skills/<name>/`
directory containing a `SKILL.md` with YAML frontmatter (`name`, `description`)
followed by the existing body. Update the remaining references and the skills test.
This is a pure relocation/restructure and is the prerequisite for the bundled
`phax-planning` skill to be a real, discoverable directory the install command can
copy.

### Detailed instructions

- For each of these files, `git mv .skills/<name>.md .claude/skills/<name>/SKILL.md`,
  then prepend YAML frontmatter to the moved file:
  - `boundaries`, `cli-view-layer`, `effect-services`,
    `infrastructure-adapters`, `model-routing`, `observability`,
    `phax-planning`, `state-machines`, `validation-boundaries`.
  - (`phax-phase-handoff` is already gone — phase-01.)
- Frontmatter shape (the body follows after one blank line):
  ```markdown
  ---
  name: <directory-slug>
  description: <one sentence: when an agent should use this skill>
  ---

  <existing file body unchanged>
  ```
  - `name` must equal the directory slug exactly (kebab-case).
  - `description` is a single line. Suggested descriptions:
    - `phax-planning`: "Write or review a plan.md that `phax extract-plan` will
      turn into phax-plan.json — phase structure, required fields, model/effort,
      commit metadata."
    - `boundaries`: "Respect the PHAX four-layer architecture (cli → app → domain
      ← ports ← infra) when adding or moving code."
    - `effect-services`, `infrastructure-adapters`, `cli-view-layer`,
      `model-routing`, `observability`, `state-machines`,
      `validation-boundaries`: derive a concise one-line description from each
      file's opening section.
- Update remaining references to the old `.skills/` paths:
  - `tests/unit/architecturalGuards.telemetry.test.ts`: the ~9 error-message
    strings referencing `.skills/observability.md` →
    `.claude/skills/observability/SKILL.md`.
  - `tests/unit/skills.test.ts`: point `SKILLS_DIR` at `.claude/skills`, read
    `phax-planning/SKILL.md`, and add an assertion that the skill begins with YAML
    frontmatter containing `name:` and `description:`.
- Grep the whole repo (`rg "\.skills/"`) for any remaining references (README,
  docs, other source/tests) and update them to `.claude/skills/...`. Do not
  rewrite the skill *bodies* — only add frontmatter and fix paths.

### Planned files to create

- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/boundaries/SKILL.md`
- `.claude/skills/cli-view-layer/SKILL.md`
- `.claude/skills/effect-services/SKILL.md`
- `.claude/skills/infrastructure-adapters/SKILL.md`
- `.claude/skills/model-routing/SKILL.md`
- `.claude/skills/observability/SKILL.md`
- `.claude/skills/state-machines/SKILL.md`
- `.claude/skills/validation-boundaries/SKILL.md`

### Planned files to edit

- `tests/unit/skills.test.ts`
- `tests/unit/architecturalGuards.telemetry.test.ts`

### Optional files that may be edited

- `.skills/phax-planning.md`
- `.skills/boundaries.md`
- `.skills/cli-view-layer.md`
- `.skills/effect-services.md`
- `.skills/infrastructure-adapters.md`
- `.skills/model-routing.md`
- `.skills/observability.md`
- `.skills/state-machines.md`
- `.skills/validation-boundaries.md`
- `README.md`

### Boundary contracts

None — documentation relocation plus error-message/test path updates.

### Test strategy

Page/CLI smoke level via the existing `tests/unit/skills.test.ts` (updated read
path + frontmatter assertion) and the telemetry guard test (updated strings). No
new test file. `git mv` renames will surface in end-of-phase reconciliation as
old→new renames; that is expected.

### Implementation order

1. `git mv` each file into its `.claude/skills/<name>/SKILL.md` directory.
2. Prepend frontmatter to each.
3. Update `skills.test.ts` and the telemetry guard test.
4. Grep for stragglers and fix.

### Excluded scope

- The exposed-skill catalog and any install logic (phase-03+).
- Editing skill bodies beyond adding frontmatter.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that the nine skills now live at `.claude/skills/<name>/SKILL.md`
  with `name`/`description` frontmatter, and the exact `name` chosen for
  `phax-planning` (must be `phax-planning`).
- Note that the old `.skills/*.md` paths were removed via `git mv` (renames are an
  expected, explained deviation if reconciliation flags them).

### Commit subject

refactor(skills): relocate skills to .claude/skills in SKILL.md format

### Commit body

Move each remaining flat `.skills/<name>.md` into `.claude/skills/<name>/SKILL.md`
with `name`/`description` YAML frontmatter so they are valid, Claude-discoverable
Agent Skills. Update the skills test and telemetry guard test to the new paths.
Pure relocation; skill bodies are unchanged. Prerequisite for shipping
`phax-planning` as an installable skill directory.

---

## phase-03 — Domain: targets, scopes, destination paths, exposed-skill catalog {#phase-03-skills-domain}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add the pure domain layer for skill installation: the `target`/`scope` enums with
parsing, the destination-path resolver, and the exposed-skill catalog that is the
single source of truth for what is installable. No I/O — all functions take their
inputs explicitly so they are unit-testable.

### Detailed instructions

- `src/domain/skills/types.ts`:
  - `export type SkillTarget = "claude" | "codex" | "agent";`
  - `export type SkillScope = "project" | "user";`
  - `export const SKILL_TARGETS: readonly SkillTarget[]` and
    `export const SKILL_SCOPES: readonly SkillScope[]`.
  - `export function parseSkillTarget(value: string): SkillTarget | null` and
    `parseSkillScope(value: string): SkillScope | null` (return `null` on
    invalid; the CLI turns `null` into an error message listing valid values).
- `src/domain/skills/catalog.ts`:
  - `export interface ExposedSkill { readonly name: string; readonly sourceDir: string; readonly files: readonly string[]; readonly requiredFile: string; }`
    where `sourceDir` is relative to the bundle root (e.g. `"phax-planning"`),
    `files` is the manifest to copy (`["SKILL.md"]`), and `requiredFile` is the
    file that must exist post-install (`"SKILL.md"`).
  - `export const EXPOSED_SKILLS: readonly ExposedSkill[]` containing only the
    `phax-planning` entry.
  - `export function findExposedSkill(name: string): ExposedSkill | null`.
  - `export const PHAX_PLANNING_SKILL = "phax-planning";`.
- `src/domain/skills/destination.ts`:
  - `export interface SkillDestinationInput { target: SkillTarget; scope: SkillScope; projectRoot: string; homeDir: string; skillName: string; }`
  - `export function resolveSkillDestination(input): { baseDir: string; skillDir: string }`
    implementing the target→base table from this plan (use `node:path` `join`;
    `claude` → `.claude/skills`, `codex`/`agent` → `.agents/skills`; project uses
    `projectRoot`, user uses `homeDir`; `skillDir = join(baseDir, skillName)`).
  - `domain/` may import only `effect` and std libs — `node:path` is allowed
    (matches existing domain usage); do not import `app`/`infra`/ports.

### Planned files to create

- `src/domain/skills/types.ts`
- `src/domain/skills/catalog.ts`
- `src/domain/skills/destination.ts`
- `tests/unit/skills/destination.test.ts`
- `tests/unit/skills/catalog.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

**Producer** for phases 04–05: the domain exposes the target/scope enums, the
exposed-skill catalog, and `resolveSkillDestination`. Consumers (app use case,
CLI) depend on these stable shapes: `SkillTarget`, `SkillScope`, `ExposedSkill`,
and the `{ baseDir, skillDir }` return. Be strict on the semantics (six valid
combinations, skill dir is `<base>/<name>`); the exact field names are the
contract.

### Test strategy

Domain → unit tests, written before implementation (stable contract):
- `destination.test.ts`: all six target×scope combinations resolve to the exact
  expected paths for a fixed `projectRoot` and `homeDir`; `skillDir` ends with
  `/phax-planning`.
- `catalog.test.ts`: `EXPOSED_SKILLS` contains exactly `phax-planning` with
  `files: ["SKILL.md"]`; `findExposedSkill("phax-planning")` returns it and an
  unknown name returns `null`; `parseSkillTarget`/`parseSkillScope` accept valid
  values and reject invalid ones.

### Implementation order

Tests first (paths are a stable contract), then `types.ts`, `catalog.ts`,
`destination.ts`.

### Excluded scope

- Any filesystem access or copying (phase-04).
- The CLI command (phase-05).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact module paths and exported names: `src/domain/skills/types.ts`
  (`SkillTarget`, `SkillScope`, `SKILL_TARGETS`, `SKILL_SCOPES`,
  `parseSkillTarget`, `parseSkillScope`), `src/domain/skills/catalog.ts`
  (`ExposedSkill`, `EXPOSED_SKILLS`, `findExposedSkill`, `PHAX_PLANNING_SKILL`),
  `src/domain/skills/destination.ts` (`resolveSkillDestination`,
  `SkillDestinationInput`).
- The exact `{ baseDir, skillDir }` return shape for the next phase.

### Commit subject

feat(skills): add skill target/scope domain types and destination resolver

### Commit body

Add the pure domain layer for skill installation: SkillTarget/SkillScope enums
with parsers, the exposed-skill catalog (single source of truth, phax-planning
only), and resolveSkillDestination mapping target+scope to the native skill
directory. Covered by unit tests over all six target/scope combinations.

---

## phase-04 — App use case: copy the bundled skill idempotently {#phase-04-install-usecase}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the `installSkill` application use case: given the resolved skill, target,
scope, project/home roots and the bundle root, it validates the bundle, copies
the skill's file manifest into the destination through the `FileSystem` port, and
returns a structured result with the computed `created` / `updated` /
`already-present` status. All filesystem effects go through the injected port.

### Detailed instructions

- Add `SkillInstallError` to `src/domain/errors.ts` as a `Data.TaggedError`
  (matching the existing error style, with a `message` field).
- `src/app/skills/installSkill.ts`:
  - `export interface InstallSkillInput { skillName: string; target: SkillTarget; scope: SkillScope; projectRoot: string; homeDir: string; bundleRoot: string; }`
  - `export interface InstallSkillResult { target: SkillTarget; scope: SkillScope; skillName: string; destination: string; status: "created" | "updated" | "already-present"; }`
  - `export function installSkill(input): Effect.Effect<InstallSkillResult, SkillInstallError, FileSystem>`:
    1. `findExposedSkill(skillName)`; fail `SkillInstallError` if not exposed.
    2. Resolve `{ skillDir }` via `resolveSkillDestination`.
    3. **Validate bundle (spec §10):** for each manifest file, read
       `join(bundleRoot, skill.sourceDir, file)`; fail clearly if any is missing.
    4. **Compute status:** if `skillDir` does not exist → `created`. Else read
       each destination file (when present) and compare to the bundled content;
       if all present and byte-identical → `already-present`; otherwise
       `updated`.
    5. If status is `already-present`, do not rewrite (idempotent no-op). Else
       write each manifest file to `join(skillDir, file)` via `writeAtomic`
       (which mkdir-p's the directory).
    6. **Post-validate (spec §10):** confirm `join(skillDir, skill.requiredFile)`
       exists after the write; fail otherwise.
    - Return `{ target, scope, skillName, destination: skillDir, status }`.
  - Map `FsError` to `SkillInstallError` with a descriptive message (follow the
    `Effect.mapError` pattern in `vibeSetup.ts`).
  - Only write files in the manifest; never remove or enumerate other files in
    the destination directory (spec §8).

### Planned files to create

- `src/app/skills/installSkill.ts`
- `tests/unit/skills/installSkill.test.ts`

### Planned files to edit

- `src/domain/errors.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

**Consumer** of phase-03 domain (`findExposedSkill`, `resolveSkillDestination`,
`SkillTarget`/`SkillScope`). **Producer** for phase-05 CLI: the use case is the
stable seam — it takes `bundleRoot`, `projectRoot`, `homeDir` as inputs (the CLI
computes them) and the `FileSystem` port as an Effect requirement (the CLI
provides `NodeFileSystemLayer`). The `InstallSkillResult` shape is the contract
the CLI renders.

### Test strategy

Application command with the real `NodeFileSystemLayer` over OS temp dirs
(integration-flavored unit test, the cheapest reliable option here since copying
is the behavior under test). Write before implementation:
- `created` when the destination is empty.
- `already-present` on a second identical run (idempotency, spec §7/§11).
- `updated` when the destination `SKILL.md` differs from the bundle.
- Bundle-missing → `SkillInstallError` (point `bundleRoot` at an empty temp dir).
- Unknown skill name → `SkillInstallError`.
- Build a tiny fake bundle root in the temp dir
  (`<bundleRoot>/phax-planning/SKILL.md`) so the test does not depend on the real
  `.claude/skills/` contents.

### Implementation order

Tests first (idempotency + validation are stable contracts), then the use case,
then the `SkillInstallError` addition.

### Excluded scope

- CLI parsing, flag validation, diagnostics output (phase-05).
- Packaging / release verification (phase-06).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact path and signature: `src/app/skills/installSkill.ts` `installSkill(input):
  Effect.Effect<InstallSkillResult, SkillInstallError, FileSystem>`.
- The `InstallSkillInput` and `InstallSkillResult` field names (the CLI depends
  on them).
- That the use case requires the `FileSystem` service and the caller must provide
  `NodeFileSystemLayer` plus the three computed roots (`bundleRoot`,
  `projectRoot`, `homeDir`).

### Commit subject

feat(skills): add installSkill use case with idempotent copy and validation

### Commit body

Add the installSkill application use case: validate the bundled skill, copy its
file manifest into the resolved destination through the FileSystem port, and
return a created/updated/already-present status computed by content comparison.
Adds SkillInstallError. Covered by temp-dir tests for create, idempotent re-run,
update-on-diff, and missing-bundle/unknown-skill failures.

---

## phase-05 — CLI: `phax skills install --target --scope` {#phase-05-skills-cli}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the `phax skills install` command. It validates `--target`/`--scope`, computes
the bundle root (package-relative) and project/home roots, runs `installSkill`
with `NodeFileSystemLayer`, and prints the spec §9 diagnostics. Wire it into
`main.ts` next to the other `registerXCommand` calls.

### Detailed instructions

- `src/cli/commands/skills.ts`, following `agent.ts` / `security.ts`:
  - `export function registerSkillsCommand(program: Command, out: OutputPort): void`
    creating a parent `skills` command with an `install` subcommand: a required
    option `--target <target>` and an optional `--scope <scope>` defaulting to
    `project` (descriptions list the valid values; use commander's default-value
    form for `--scope`).
  - `export async function runSkillsInstall(opts: { target: string; scope?: string }, out: OutputPort): Promise<number>`:
    - `parseSkillTarget(opts.target)` and `parseSkillScope(opts.scope ?? "project")`;
      on `null`, `out.error` listing valid values and return `2`.
    - `bundleRoot = join(import.meta.dirname, "../../..", ".claude", "skills")`
      (resolves to package root in dev and built — `cli/commands` is 3 levels deep
      in both).
    - `projectRoot = process.cwd()`, `homeDir = homedir()` (from `node:os`).
    - Run `installSkill({ skillName: PHAX_PLANNING_SKILL, target, scope,
      projectRoot, homeDir, bundleRoot })` with
      `Effect.either(...).pipe(Effect.provide(NodeFileSystemLayer))`.
    - On `Left`, `out.error` the message and return `2`.
    - On `Right`, print the spec §9 block and return `0`:
      ```txt
      Installed PHAX planning skill.

      Target: <target>
      Scope: <scope>
      Skill: phax-planning
      Destination: <destination>
      Status: <created|updated|already present>
      ```
      Render `already-present` as `already present`.
  - The action calls `process.exit(exitCode)` (matches existing commands).
- `src/cli/main.ts`: import and call `registerSkillsCommand(program, consoleOutput)`
  alongside the other `registerXCommand` calls.
- Importing `NodeFileSystemLayer` from `infra/fs` in the CLI is consistent with
  `agent.ts` / `security.ts` (they import infra layers for DI wiring).

### Planned files to create

- `src/cli/commands/skills.ts`
- `tests/unit/skillsArgv.test.ts`

### Planned files to edit

- `src/cli/main.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

**Consumer** of phase-04 (`installSkill`, `InstallSkillResult`) and phase-03
(`parseSkillTarget`, `parseSkillScope`, `PHAX_PLANNING_SKILL`). The CLI provides
the `FileSystem` adapter (`NodeFileSystemLayer`) and the three computed roots —
the composition root for this feature.

### Test strategy

CLI smoke via an argv/parse test following `tests/unit/runArgv.test.ts` /
`resumeArgv.test.ts`: assert the `skills install` command is registered with a
required `--target` and an optional `--scope` (defaulting to `project`), that
invalid target/scope values are rejected (exit code 2), and that omitting
`--scope` resolves to `project` — using a stubbed output port. Do not perform a
real install in the argv test — the copy behavior is covered in phase-04.

### Implementation order

Command surface (`registerSkillsCommand` + `runSkillsInstall`) → wire into
`main.ts` → argv test.

### Excluded scope

- The copy/idempotency logic (phase-04, consumed here).
- Packaging / release verification (phase-06).

### Verification

The project's configured `full` gate profile in `phax.json`. Manual smoke (not a
gate), run from a scratch directory so the destination differs from the bundle
source: `cd /tmp/x && node <repo>/dist/cli/main.js skills install --target claude`
writes `.claude/skills/phax-planning/SKILL.md` and a second run reports "already
present". (Running in the phax repo itself with `--target claude --scope project`
targets the bundle source directory and will simply report "already present".)

### Expected handoff content

- Exact command path (`phax skills install`), the flags (`--target` required,
  `--scope` optional defaulting to `project`), and the exit codes (`0` success,
  `2` invalid flag / install error).
- That `bundleRoot` is computed as `join(import.meta.dirname, "../../..",
  ".claude", "skills")` and why it resolves correctly in both dev and built
  layouts.
- Confirmation `registerSkillsCommand` is wired in `main.ts`.

### Commit subject

feat(skills): add `phax skills install` command for the planning skill

### Commit body

Add `phax skills install --target <claude|codex|agent> [--scope <project|user>]`,
which validates the flags (scope defaults to project), resolves the
package-relative bundle root, runs the installSkill use case with
NodeFileSystemLayer, and prints target/scope/skill/destination/status
diagnostics. Wired into main.ts. Covered by an argv test for registration and
invalid-flag rejection.

---

## phase-06 — Package the bundle and verify it at release time {#phase-06-release-packaging}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Make the release include the bundled planning skill and fail the build if it is
missing (spec §11, AC 15–16). Add a `files` whitelist to `package.json` and a
test that asserts the bundled `phax-planning/SKILL.md` resolves at the exact
package-relative path the CLI uses.

### Detailed instructions

- `package.json`: add `"files": ["dist", ".claude/skills/phax-planning"]` so
  `npm pack` includes the compiled CLI and exactly the one shippable skill (the
  bundle currently is not packaged because there is no `files` field and `dist/`
  is gitignored; internal dev skills are intentionally not shipped).
- `tests/unit/skills/bundled.test.ts`:
  - Resolve the bundle root the same way the CLI does, from the test file
    location, to the repo's `.claude/skills`, and assert
    `.claude/skills/phax-planning/SKILL.md` exists and is non-empty (this fails
    the `full` gate — and therefore any release that runs it — if the bundle is
    missing, satisfying AC 16).
  - Assert each file in the `phax-planning` catalog manifest exists under
    `.claude/skills/phax-planning/`.
  - Read `package.json` and assert `files` includes
    `.claude/skills/phax-planning` (so the bundle is actually shipped).
- Optionally add a `verify:skill-bundle` npm script wrapping the same check for
  CI, and/or a `prepublishOnly` that runs it; not required if the `full` gate
  test is the release gate. Confirm with `npm pack --dry-run` that
  `.claude/skills/phax-planning/SKILL.md` appears in the tarball — and that no
  other `.claude/skills/*` entries do (manual check; note the result in the
  handoff, since npm's handling of dot-directories in `files` needs verifying).

### Planned files to create

- `tests/unit/skills/bundled.test.ts`

### Planned files to edit

- `package.json`

### Optional files that may be edited

- (none)

### Boundary contracts

None — packaging configuration plus a guard test that reads the catalog manifest
from phase-03.

### Test strategy

Release smoke at unit level: the bundled-skill test runs inside the `full` gate
(`pnpm test`), so a missing bundle fails the gate that gates the release. Verify
the `npm pack --dry-run` tarball contents manually since there is no automated
publish pipeline in the repo to assert against.

### Implementation order

Add `files` to `package.json` → add the bundled-skill guard test → confirm with
`npm pack --dry-run`.

### Excluded scope

- A full npm publish pipeline / CI workflow (none exists in the repo today; out
  of scope for this spec).
- Shipping the internal dev skills; only `.claude/skills/phax-planning` ships.

### Verification

The project's configured `full` gate profile in `phax.json`. Manual:
`npm pack --dry-run | grep phax-planning` shows the bundled SKILL.md.

### Expected handoff content

- The final `files` array in `package.json`.
- Confirmation that the bundled-skill guard test passes and that
  `npm pack --dry-run` lists `.claude/skills/phax-planning/SKILL.md` (and no other
  `.claude/skills` entries).
- Any `verify:skill-bundle` / `prepublishOnly` script added.

### Commit subject

chore(skills): package the bundled planning skill and verify it at release

### Commit body

Add a package.json files whitelist (dist + .claude/skills/phax-planning) so
releases include exactly the bundled phax-planning skill, and a guard test that
fails the full gate if the bundled SKILL.md is missing or unpackaged. Satisfies
the spec's release-packaging requirement.

---

## Acceptance-criteria coverage

| Spec AC | Where |
| ------- | ----- |
| 1 (one exposed skill) | phase-03 catalog (`EXPOSED_SKILLS` = phax-planning) |
| 2 (install command) | phase-05 |
| 3–5 (targets claude/codex/agent) | phase-03 enums + phase-05 flags |
| 6–7 (scopes project/user) | phase-03 enums + phase-05 flags |
| 8 (no `--target all`) | phase-03/05 (literal union, no `all`) |
| 9–10 (project/user destinations) | phase-03 `resolveSkillDestination` |
| 11 (idempotent) | phase-04 status logic + tests |
| 12 (reports destination) | phase-05 diagnostics |
| 13 (no instruction-file edits) | phase-04 (manifest-only writes) |
| 14 (no node_modules dependency) | phase-05 package-relative bundle root |
| 15 (release includes skill) | phase-06 `files` whitelist |
| 16 (pipeline fails if missing) | phase-06 guard test in `full` gate |

## Resolved decisions

1. **`phax-phase-handoff` is inlined, not installed.** Its guidance lives in the
   phase prompts (phase-01); the standalone doc is deleted. Only `phax-planning`
   is a shippable/installable skill.
2. **Ship only `phax-planning`, relocate skills to `.claude/skills/`.** The
   internal skills move into the standard `.claude/skills/<name>/SKILL.md` layout
   (Claude-discoverable, dogfooded); the `files` whitelist ships only
   `.claude/skills/phax-planning`.
3. **Three distinct targets — `claude`, `codex`, `agent`.** Kept separate so users
   pick the right one; `codex` and `agent` map to `.agents/skills` today and can
   diverge later.
4. **`--scope` defaults to `project`.** `--target` stays required.

One thing to watch (handled in phase-06): npm's treatment of dot-directories in
the `files` whitelist — `npm pack --dry-run` is the verification that
`.claude/skills/phax-planning/SKILL.md` actually ships.
