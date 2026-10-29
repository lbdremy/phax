---
status: Completed
source-spec: docs/specs/2610291023-protected-paths.md
completes-spec: true
approved:
  date: 2026-10-29
  baseline: b048a15
---
# Protected paths

Implements the whole of the protected-paths spec: §5.1 to §5.23, every §6 surface and every acceptance criterion. A project lists in phax.json's top-level `protectedPaths` the files whose change is the operator's decision. The phax.json phax loaded is protected too, by its repo-relative path. No phase of a run may land a change to them. Prevention is the providers' own: Claude Code gets `Edit(//…)` deny rules and Mistral Vibe gets `write_file`/`edit` denylist entries, for every glob that is a literal path or `**/` followed by one. Codex and unsafe mode get none. The guarantee is one deterministic check of the phase's files against the phase base. It runs after every gate attempt in the fix loop, at a commit-only resume, after the handoff turn and at a held phase's hold-point re-entry, and never at a stop's close. The work runs in this order:

1. An oracle pair freezes the pure contract (phase-01, phase-02): the protected list, case-folded matching, the changes an observation yields, the Claude Code and Vibe rule strings, enforcement and the submodule refusal. phase-02 also adds the helpers later phases use, with in-phase tests.
2. The config key, its refusals and `phax validate`'s line land with a snapshot that pins today's behaviour for a project that declares nothing (phase-03).
3. security.json moves to version 3 and gate-attribution.json to 0.31.0, each with a required `protectedPaths` (phase-04).
4. The native rules, the skill-edit-grant refusal and the phase prompt's section follow (phase-05).
5. A new git observation of a worktree against its base is added (phase-06).
6. The fix loop fails an attempt on a protected change and tells the agent and the operator (phase-07).
7. The commit-only resume, the handoff and hold-point checks and the docs close the work (phase-08).

Tests never read ~/.phax, a real ~/.claude, ~/.codex or ~/.vibe, the global git config or the real gh. They use tests/helpers/isolateGit.ts, temporary directories, the fake backend, tests/helpers/fakeProviderCli.ts, the fake `vibe` of tests/helpers/vibe3Fixtures.ts and makeFakeGitHub(). The two real-CLI acceptance criteria live in tests/e2e/ behind `PHAX_E2E_RUN=1`. The phase gate does not run them; the review runs them by name.

## Required commands

- (none)

No new command. The configured `standard` gate verifies every phase. The phases also run commands that `security.agentCommands` in phax.json already allows: `pnpm dev schema upgrade` (phase-03, regenerates phax.schema.json), `pnpm exec tsx scripts/schemas-check.ts --write` (phase-04, writes the gate-attribution `next` snapshot, the history lock, src/schemas/release.ts and the generated index), and `pnpm gen:usage-spec` and `pnpm docs:cli` (phase-08, after the help text changes). No skill file is edited, so the run needs no `--allow-skill-edits`.

## Technical arbitrations

- Where the check lives. src/domain/security/protectedPaths.ts is pure. It holds the protected list, case-folded matching, the changes derived from an observation, the native rule forms, enforcement and the submodule conflict. The git reads sit behind one new Git port method, `observeWorktree(path, base, trackedPaths)` in src/ports/git.ts, implemented in src/infra/git.ts. The method builds the worktree tree with the effect behind `snapshotWorktree` (`snapshotWorktreeEffect`): a temporary index seeded from HEAD, so the real index's skip-worktree and assume-unchanged bits never hide an edit. It diffs that tree against the base with `git diff-tree -z -r -M --name-status`, read by the NUL parser `changedPathsBetween` already uses, `parseDiffTreeNameStatusZ` in src/infra/git.ts, which gains a rename mode: with it, an `R<score>` status carries the old and the new path; without it, the parser refuses `R` as today, and `changedPathsBetween` keeps `--no-renames` and its port signature, so its callers (closeStop, resetPhase, reviewCode, interactiveStop) never see a rename row. The adapter maps the rows to the domain's ObservedEntry. It compares each protected tracked path of the base with its base blob by lstat and `git hash-object`. It lists untracked ignored files with `git ls-files -z --others --ignored --exclude-standard`, leaving out `.phax-context/`. The use case src/app/protectedPathsCheck.ts reads the base tree (`readTree`), keeps the protected tracked paths (domain), observes and derives the changes. No name-status parser is added to the domain, and src/domain/reconciliation/parseNameStatus.ts (newline-separated and trimmed, for file reconciliation) stays as it is. Loss accepted: the one NUL parser now serves two callers in two modes, so a fault in it reaches the stop, reset and review paths as well as the check; and every check in a declaring project walks the base tree, rebuilds a temporary index and lists every ignored file, node_modules included.
- Native rule sets come from one domain function. `nativeProtectedGlobs` classifies each glob of the list as `literal` (none of `*`, `?`, `[`, `]`) or `any-depth` (`**/` followed by such a path), or gives it no native form. `claudeProtectedDenyRules`, `vibeProtectedDenylist` and `protectedEnforcement` all read that classification, so Claude Code and Vibe never disagree on which globs are exact. Rules are passed only when the policy mode is `secure`, and enforcement reads the same condition. Loss accepted: a wildcard glob that a provider could express approximately gets no native rule. The providers' gitignore-style and fnmatch matching would refuse more than phax protects, so such a glob relies on the check alone (enforcement `partial`).
- Where the check runs in the fix loop. It runs inside `runGatesWithFixLoop`'s loop, right after `runGates` returns, on a pass, a failure or a refusal alike, and only when the loop's new required option `protectedPaths` (`{ list, base }`) is not null. closeStop calls `runGates` directly, so a stop's close never runs the check. Loss accepted: the check is a fix-loop concern. A future caller of `runGates` that wants it has to call the use case itself.
- How gate-attribution carries the check without an optional field. A required `protectedPaths` is one of three values: `null`, `{ result: "pass", changes: [] }`, or `{ result: "fail", changes: <non-empty> }`, each change being `{ path, kind, entry }`. Each variant is explicit, with no permissive superset. `runGates` writes `protectedPaths: null` in the attempt's step record and in the phase's gate-attribution.json. When a list is declared, the fix loop rewrites both with the check's result after each attempt. The 0.26.0 shape is frozen in src/schemas/history/gate-attribution/0.26.0.ts. A 0.26.0 or pre-schema document is lifted to `protectedPaths: null` in memory, and the `next` snapshot is stamped 0.31.0. A stop's close writes `null`, because its gate is not checked (§5.18): `null` means not checked, either because no list is declared or because the gate was a stop's close. Loss accepted: an attempt's record is written twice and reads `null` between the two writes, and the field alone cannot tell a stop's close in a declaring project from a project that declares nothing.
- How the implied phax.json is named (operator decision on q-config-path, option B). "phax.json is protected" names the config file phax actually loaded: `loadConfig`'s `findPhaxConfig` walks up from the cwd to the git root, and the implied entry is that file's path relative to the git root, in POSIX form, for example `pkg/phax.json`, and `phax.json` when it sits at the root. `protectedList(declared, configPath)` takes that path. A declared glob's entry is `protectedPaths[N]`, counted from 0. The loaded config, appended when no declared glob is exactly its path, has its path as both glob and entry. When several globs match a path, the first in list order names it. Loss accepted: the spec's literal entry name `phax.json` and the `phax validate` line show the loaded file's path instead (`pkg/phax.json` for a nested config), and the `entry` field holds two forms.
- How a protected failure travels in memory. The events GateFailed and FixAttemptsExhausted, which are interfaces, become unions discriminated by `failedStep`. The step variant (`configured` or `oracle`) keeps `command` and `exitCode` and gains `protectedChanges`, which may be empty. The `protected-paths` variant carries non-empty `protectedChanges` and no command or exit code. GateAttemptsExhaustedError stays one `Data.TaggedError` class, since `Data.TaggedError("E")<A | B>` does not compile (TS2509): its `command`, `exitCode` and `failedStep` fields give way to one required field `failure`, a union discriminated by `failedStep`: `{ failedStep: "configured" | "oracle"; command; exitCode; protectedChanges }` or `{ failedStep: "protected-paths"; protectedChanges }` with non-empty changes. GateStepRefused and GateStepRefusedError gain `protectedChanges`. None of these is persisted: run-status.json keeps only `lastError`, so no persisted shape changes. Loss accepted: every consumer of those events switches on `failedStep`, and every reader of GateAttemptsExhaustedError reads its command, exit code and step through `failure`.
- How a protected change after the commit pauses the phase. A new event, `HandoffProtectedPathsChanged { changes }`, takes the transitions HandoffMissing takes, to `handoff_failed`. It persists `lastError` naming the paths and no new `stoppedReason`, so run-status.json's shape does not change. The handoff check runs inside generatePhaseHandoff, between the turn and the validation, through a new required option. A hold-point re-entry runs the check before `holdPoint`. Both compare against the phase commit that status.json records. A commit-only resume checks against the phase base before `commitPhase` and pauses through the existing CommitFailed, with a reason naming each change. Loss accepted: the phase reads `handoff_failed` with no missing section, and only `lastError` says why.
- In-memory carriers stay optional where nothing is persisted, so a project that declares nothing builds exactly today's argv, prompt and options. ResolvedConfig gains `protectedPaths?: ProtectedList`, from phax.json alone, as `assignments` is. AgentRunOptions and BuildPhasePromptOptions carry it optionally, beside `skillEditGrants`, and VibeFlagsInput carries it optionally with the worktree's resolved root. Loss accepted: absence stands for nothing declared in memory, and the type does not force each caller to say so.
- The malformed-list message. `protectedPaths` is checked before the full decode of phax.json. Each entry gets the glob dialect's own refusal text, exported from src/schemas/architecture.ts, so `phax validate` prints `protectedPaths[N]: <rule>` as §6 shows. PhaxConfigSchema also declares the key with ArchitectureGlobSchema, so phax.schema.json documents it. Loss accepted: the dialect rule is applied twice, once before the decode and once in it.
- A skill edit grant on a protected path is refused by a new `SkillEditProtectedError`, which exits 11 beside SkillEditConsentError. It is checked in freshRunPreflight (before the run is named) and in the `skill-edit-consent` preflight (on resume), with a pure conflict function in src/domain/security/skillEditGrants.ts. Loss accepted: one more error class for one refusal.
- The no-change guarantee (§5.5) is pinned by a snapshot written in phase-03, before any behaviour changes. Later phases may not update it. Only phase-04 changes the test's explicit expectations for security.json (version 3, `protectedPaths: null`) and gate-attribution.json (0.31.0, `protectedPaths: null`), which is exactly what the spec allows. Loss accepted: an unrelated, intended change to argv or prompts during this run would have to be split out of it.

---

## phase-01 — Protected-path contract and its oracles {#phase-01-protected-oracles}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs a contract no code in the repository holds yet (an observation model, change precedence, native rule forms and enforcement), and freezes it as oracles the next phase cannot adjust.
**Oracle phase:** discharged by phase-02
**Oracle files:** `tests/unit/security/protectedPaths.test.ts`

Fix the pure contract the protected-path guarantee rests on, with stub functions: the protected list, case-folded matching, the changes an observation of a worktree yields, the rule strings for Claude Code and Vibe, enforcement, and the submodule refusal. Freeze its table of cases as oracles that phase-02 discharges.

### Detailed instructions

- Create `src/domain/security/protectedPaths.ts`, pure, with no I/O and no `node:` import. Its only imports are `matchesGlob` from `../architecture/glob.js`, the `ProviderId` type from `../routing/types.js` and the `SecurityMode` type from `./types.js`.
- Export exactly these:

  - `ProtectedEntry` { glob: string; entry: string }.
  - `ProtectedList` = readonly ProtectedEntry[].
  - `ProtectedChangeKind` = `created` | `edited` | `deleted` | `renamed`.
  - `ProtectedChange` { path: string; kind: ProtectedChangeKind; entry: string; glob: string }.
  - `ObservedEntry` = { status: `added` | `modified` | `deleted` | `type-changed`; path } | { status: `renamed`; path; oldPath }.
  - `TrackedState` = `same` | `content` | `type` | `missing`.
  - `ProtectedObservation` { entries: readonly ObservedEntry[]; tracked: readonly { path: string; state: TrackedState }[]; untracked: readonly string[] }.
  - `ProtectedEnforcement` = `enforced` | `partial` | `commit-check-only`.
  - `SubmoduleConflict` { index: number; glob: string; submodule: string }.

  The module exports no constant: knip, in the gate, fails an export nothing imports, and the oracle test imports every export. The config file's path comes in as a parameter, never as a constant.
- Also export these functions, each with a body that throws `new Error("not implemented: <function name>")` and parameters prefixed `_`:

  - `protectedList(declared: readonly string[] | undefined, configPath: string): ProtectedList | null`
  - `matchProtected(list: ProtectedList, path: string): ProtectedEntry | undefined`
  - `protectedChanges(list: ProtectedList, observation: ProtectedObservation): readonly ProtectedChange[]`
  - `claudeProtectedDenyRules(worktreeRoot: string, list: ProtectedList): readonly string[]`
  - `vibeProtectedDenylist(worktreeRoot: string, list: ProtectedList): readonly string[]`
  - `protectedEnforcement(list: ProtectedList, provider: ProviderId, mode: SecurityMode): ProtectedEnforcement`
  - `submoduleConflict(declared: readonly string[], submodules: readonly string[]): SubmoduleConflict | undefined`

  The oracles compile and load against these stubs. The helpers later phases need (`protectedTrackedPaths`, `nativeProtectedGlobs`) are phase-02's, with their own tests.
- Document the contract in a module comment, which phase-02 implements:

  - `protectedList` gives null for undefined. Otherwise it gives each declared glob with entry `protectedPaths[N]` in order, then `{ glob: configPath, entry: configPath }` unless a declared glob is exactly `configPath`. `configPath` is the repo-relative POSIX path of the phax.json phax loaded, such as `phax.json` or `pkg/phax.json`.
  - `matchProtected` gives the first entry in list order whose glob matches the path, matching phax's dialect with both glob and path lowercased (`toLowerCase`), with no Unicode normalization.
  - `protectedChanges` gives one change per protected path, sorted by path:
    - a `renamed` entry names each side that matches as `renamed`;
    - `added` gives `created`, and an untracked path gives `created`;
    - `modified` or `type-changed` gives `edited`, and a tracked state of `content` or `type` gives `edited`;
    - `deleted` gives `deleted`, and a tracked state of `missing` gives `deleted`;
    - the path is spelt as observed.

    Which kind wins when the evidence for one path disagrees is phase-02's to fix, and no oracle pins it.
  - Native forms: a glob holding none of `*`, `?`, `[`, `]` is a literal path. A glob that is `**/` followed by such a rest is an any-depth path. Every other glob has no native form.
  - `claudeProtectedDenyRules` gives `Edit(/<root>/<glob>)` per glob with a native form, in list order, where `<root>` is the worktree root with trailing slashes removed, so an absolute root gives `Edit(//…)`.
  - `vibeProtectedDenylist` gives, in list order, `<root>/<path>` per literal glob, and `<root>/<rest>` then `<root>/**/<rest>` per any-depth glob.
  - `protectedEnforcement`:
    - `commit-check-only` for codex-cli or any mode but `secure`;
    - otherwise `enforced` when every entry has a native form;
    - `partial` when some entries do;
    - `commit-check-only` when none do.
  - `submoduleConflict` gives the first declared glob whose leading literal segments reach a submodule, or undefined. The leading literal segments are the segments before the first one holding `*` or `?`. They reach a submodule when, case-folded, their joined path equals the submodule's path or starts with it followed by `/`.
- Create `tests/unit/security/protectedPaths.test.ts`:

  - Every test carries the `it.fails` marker and has a distinct title.
  - It imports only from `src/domain/security/protectedPaths.ts`, and imports every export of it (types with `import type`), so knip sees each one used.
  - Its fixtures are written inline, with no generator and no helper module.
  - Assert with `toEqual` on whole values.

  Write the cases in the next entries. Every list is built with config path `phax.json` unless stated. The fixtures hold no disagreeing evidence for one path: that precedence is phase-02's.
- Cases for the list and matching:

  - (a) `protectedList(["**/steme.baseline.json"], "phax.json")` equals `[{glob "**/steme.baseline.json", entry "protectedPaths[0]"}, {glob "phax.json", entry "phax.json"}]`. `protectedList(["phax.json", "a.json"], "phax.json")` holds two entries, `protectedPaths[0]` and `protectedPaths[1]`, with no extra phax.json. `protectedList(["a.json"], "pkg/phax.json")` equals `[{glob "a.json", entry "protectedPaths[0]"}, {glob "pkg/phax.json", entry "pkg/phax.json"}]`. `protectedList(undefined, "phax.json")` is null.
  - (b) `matchProtected` on the list from `["**/steme.baseline.json"]`:
    - `packages/a/STEME.Baseline.json` gives entry `protectedPaths[0]`;
    - `PHAX.JSON` gives entry `phax.json`;
    - `src/a.ts` gives undefined.
- Cases for `protectedChanges`, on the list from `["**/steme.baseline.json"]` unless stated:

  - (d) The kinds:
    - entries: added `packages/a/steme.baseline.json`; deleted `packages/b/steme.baseline.json`; renamed from `packages/c/steme.baseline.json` to `packages/c/old.json`; renamed from `packages/d/x.json` to `packages/d/steme.baseline.json`;
    - tracked: b `missing`;
    - untracked: none;
    - expected: exactly a `created`, b `deleted`, `packages/c/steme.baseline.json` `renamed` and `packages/d/steme.baseline.json` `renamed`, each with entry `protectedPaths[0]` and its glob, in that order, and nothing for `packages/c/old.json`.
  - (e) Type change and non-ASCII, on the list from `["**/steme.baseline.json", "**/règles.json"]`:
    - entries: type-changed `packages/a/steme.baseline.json`;
    - tracked: a `type`;
    - untracked: `packages/b/RÈGLES.json`;
    - expected: a `edited` with `protectedPaths[0]`, and `packages/b/RÈGLES.json` `created` with `protectedPaths[1]` and glob `**/règles.json`, spelt as given.
  - (f) No entries and tracked `packages/a/steme.baseline.json` `content` give one `edited` change.
  - (g) On the list from `["**/allow.json"]`, untracked `generated/allow.json` and `node_modules/x/index.js` give only `generated/allow.json` `created`.
  - (h) On the list from `["**/x.json"]`, entries modified `phax.json` give `{ path phax.json, kind edited, entry phax.json, glob phax.json }`.
  - (i) Entries modified `src/a.ts` and untracked `dist/b.js` give `[]`.
  - (j) An entry modified `packages/a/steme.baseline.json` with tracked a `content` gives one change, not two.
- Cases for native rules and enforcement:

  - (l) `claudeProtectedDenyRules("/wt", …)` and `claudeProtectedDenyRules("/wt/", …)` of the list from `["**/steme.baseline.json", "config/*.json", "locks/[a].json"]` both equal `["Edit(//wt/**/steme.baseline.json)", "Edit(//wt/phax.json)"]`.
  - (m) `vibeProtectedDenylist("/wt", …)` of the list from `["**/steme.baseline.json", "config/*.json"]` equals `["/wt/steme.baseline.json", "/wt/**/steme.baseline.json", "/wt/phax.json"]`.
  - (n) One table test of `protectedEnforcement`:
    - on the list from `["**/steme.baseline.json"]`: claude-code secure and mistral-vibe secure give `enforced`; codex-cli secure, claude-code unsafe, mistral-vibe unsafe and claude-code isolated give `commit-check-only`;
    - on the list from `["**/steme.baseline.json", "config/*.json"]`: claude-code secure and mistral-vibe secure give `partial`.

  `protectedTrackedPaths`, `nativeProtectedGlobs` and the precedence between disagreeing evidence are tested in phase-02, in-phase, not here.
- Cases for the submodule refusal:

  - (o) `submoduleConflict(["**/allow.json", "vendor/lint-rules/allow.json"], ["vendor/lint-rules"])` gives `{ index 1, glob vendor/lint-rules/allow.json, submodule vendor/lint-rules }`.
  - `["vendor/lint-rules"]` gives index 0.
  - `["Vendor/Lint-Rules/a.json"]` gives index 0.
  - `["vendor/**"]` gives undefined.
  - `["vendor/lint-rules-extra/a.json"]` gives undefined.
  - `["**/allow.json"]` gives undefined.
- Run the configured gate. Every oracle passes while it is marked, because its stub throws.

### Planned files to create

- `src/domain/security/protectedPaths.ts`
- `tests/unit/security/protectedPaths.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: src/domain/security/protectedPaths.ts (domain). Consumers:

- the config loader (phase-03): the list and the submodule conflict;
- the security.json writer (phase-04): enforcement;
- the Claude Code and Vibe adapters (phase-05): the deny rules and denylist;
- the git port and the check use case (phase-06): the observation shape and the changes;
- the fix loop, commit and handoff checks (phase-07, phase-08): the changes.

The stable shapes are ProtectedList, ProtectedObservation and ProtectedChange. The module does no I/O: infra observes, and the domain judges.

### Test strategy

- a case variant of a protected path matches its entry, so packages/a/STEME.Baseline.json names protectedPaths[0] — small · example · the matching entry · oracle · ac-case
- the protected list appends the loaded phax.json by its repo-relative path unless declared, is null when nothing is declared, and a change to phax.json is named with its entry — small · table · the expected list and change · oracle · ac-self
- created, deleted and renamed protected paths are named, a rename on each side that matches, once per path and sorted, from evidence that agrees — small · table · the expected change list · oracle · ac-kinds
- a type change counts as edited and an untracked non-ASCII case variant as created, spelt as observed — small · example · the expected change list · oracle · ac-type-nonascii
- a tracked protected file whose content differs from its base blob is edited although no name-status entry shows it — small · example · one edited change · oracle · ac-skip-worktree
- an untracked ignored protected file is created, and an ignored file no glob matches is not named — small · example · one created change · oracle · ac-ignored
- Claude deny rules hold one Edit(//root/glob) per literal or **/ literal glob, phax.json included, and none for a wildcard or bracket glob — small · table · the expected rule strings · oracle · ac-claude-flags
- Vibe denylist entries hold one entry per literal glob and two per **/ glob, and none for any other — small · table · the expected denylist entries · oracle · ac-vibe-flags
- enforcement is enforced, partial or commit-check-only by provider, mode and the list's native forms — small · table · the enforcement table · oracle · ac-codex-unsafe
- a glob whose leading literal segments reach a submodule is refused naming its index and the submodule, while a **/ glob or one above the submodule is accepted — small · table · the expected conflict or none · oracle · ac-submodule
- changes to paths no glob matches yield no protected change — small · example · the empty change list · oracle

### Implementation order

1. Write the types and the stub functions in src/domain/security/protectedPaths.ts, with the contract comment.
2. Write the case table in tests/unit/security/protectedPaths.test.ts, every test marked it.fails.
3. Run the gate and confirm every oracle fails on its stub and passes as marked.

### Excluded scope

- Any implementation of the functions (phase-02).
- The helpers `protectedTrackedPaths` and `nativeProtectedGlobs`, and the precedence between disagreeing evidence (phase-02, in-phase tests).
- The config key, the git observation, provider flags, records and the fix loop (phase-03 onward).

### Verification

The `standard` gate profile in phax.json, whose oracle step the configured oracles provider judges (`authored` verdict on tests/unit/security/protectedPaths.test.ts).

### Expected handoff content

The exact exports of `src/domain/security/protectedPaths.ts` and their signatures, and confirmation that the oracle test imports each one. The case list of `tests/unit/security/protectedPaths.test.ts` with each expected value, and any case added beyond the plan, with the reason. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(security): oracles for the protected-path check`

### Commit body

Fix the protected-path contract in src/domain/security/protectedPaths.ts, with stub functions that throw: the protected list with the loaded phax.json implied by its repo-relative path, case-folded matching, the changes an observation of a worktree yields (created, edited, deleted, renamed), the Claude Code and Vibe rule strings, enforcement by provider and mode, and the submodule conflict. Freeze the case table as expected-failure oracles.

---

## phase-02 — Protected-path matching, changes and native rule forms {#phase-02-protected-domain}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Implement the protected-path contract so every oracle passes as written, and discharge them. Add the helpers later phases use, with in-phase tests.

### Detailed instructions

- Implement every function of `src/domain/security/protectedPaths.ts` exactly as its module comment states. Keep the module pure, with the same imports.
- `protectedList`: append `{ glob: configPath, entry: configPath }` unless a declared glob is exactly `configPath`. `matchProtected`: call `matchesGlob(entry.glob.toLowerCase(), path.toLowerCase())` over the list in order. Do not change `src/domain/architecture/glob.ts`: the architecture parts and assignment bounds keep matching case-sensitively.
- `protectedChanges`: collect evidence per path from `entries`, `tracked` and `untracked`, and name each path that `matchProtected` matches. When the evidence for one path disagrees, `renamed` wins over `created`, `created` over `deleted`, and `deleted` over `edited`: a rename's source is also tracked `missing`, and it stays `renamed`. Sort by path with the default string comparison.
- Add and export two helpers:

  - `protectedTrackedPaths(list: ProtectedList, paths: readonly string[]): readonly string[]` keeps the paths some entry matches, in input order. The check use case (phase-06) calls it.
  - `NativeProtectedGlob` { glob: string; form: `literal` | `any-depth`; path: string } and `nativeProtectedGlobs(list: ProtectedList): readonly NativeProtectedGlob[]`, in list order, with the native forms the module comment states (path = the glob, or the rest after `**/`). `claudeProtectedDenyRules`, `vibeProtectedDenylist` and `protectedEnforcement` all read it, so Claude Code and Vibe never disagree on which globs are exact.
- `submoduleConflict`: compare case-folded paths, and require a segment boundary, so `vendor/lint-rules-extra` does not reach `vendor/lint-rules`.
- Create `tests/unit/security/protectedPathsHelpers.test.ts`, plain tests importing from `src/domain/security/protectedPaths.ts`:

  - `protectedTrackedPaths` of the list from `["**/steme.baseline.json"]` (config path `phax.json`) over `["a/steme.baseline.json", "src/x.ts", "PHAX.json"]` equals `["a/steme.baseline.json", "PHAX.json"]`.
  - `nativeProtectedGlobs` of the list from `["**/steme.baseline.json", "config/*.json", "locks/[a].json", "a/**/b.json", "**/x/?.json", "**/config/limits.json", "docs/limits.json"]` equals, in order: any-depth `steme.baseline.json`, any-depth `config/limits.json`, literal `docs/limits.json`, literal `phax.json`.
  - A precedence table of `protectedChanges`: renamed from `packages/c/steme.baseline.json` with tracked c `missing` gives `renamed`; added and untracked for one path gives `created`; deleted with tracked `content` gives `deleted`; modified with tracked `missing` gives `deleted`; each with one change per path.
- Remove every `it.fails` marker from `tests/unit/security/protectedPaths.test.ts`, turning each `it.fails(` into `it(`. That is the only change allowed to that file. If an oracle cannot pass unchanged, stop and say so in the handoff: that is a spec question, not a bug to work around.
- Run the configured gate.

### Planned files to create

- `tests/unit/security/protectedPathsHelpers.test.ts`

### Planned files to edit

- `src/domain/security/protectedPaths.ts`
- `tests/unit/security/protectedPaths.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: src/domain/security/protectedPaths.ts, as phase-01 fixed it, plus `protectedTrackedPaths` (consumed by the check use case, phase-06) and `nativeProtectedGlobs`. No consumer changes in this phase.

### Test strategy

- protectedTrackedPaths keeps the base paths some entry matches, case-folded, in input order — small · example · the kept path list · in-phase
- nativeProtectedGlobs classifies literal and **/ globs in list order, phax.json included, and leaves wildcard, bracket and inner ** globs out — small · table · the expected classification · in-phase
- when the evidence for one path disagrees, renamed wins over created, created over deleted and deleted over edited, with one change per path — small · table · the expected change kinds · in-phase

### Implementation order

1. protectedList, matchProtected and protectedTrackedPaths.
2. protectedChanges, with its precedence.
3. nativeProtectedGlobs, then claudeProtectedDenyRules, vibeProtectedDenylist and protectedEnforcement.
4. submoduleConflict.
5. Write the helpers' tests, remove the markers and run the gate.

### Excluded scope

- Any caller of the module (phase-03 onward).
- Any change to the glob dialect or its matcher.

### Verification

The `standard` gate profile in phax.json, whose oracle step the configured oracles provider judges (`discharged` verdict on tests/unit/security/protectedPaths.test.ts).

### Expected handoff content

The implemented functions, the two helpers and their signatures, the precedence as implemented, and any behaviour the module comment left implicit that you had to decide. Confirmation that the only change to tests/unit/security/protectedPaths.test.ts is the removal of the markers. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(security): protected-path matching, changes and native rule forms`

### Commit body

Implement the protected list with the loaded phax.json implied, case-folded matching on every host, the protected changes an observation yields (a rename on both sides, a type change as edited, untracked and ignored creations, and a precedence when evidence disagrees), the native rule forms shared by Claude Code and Vibe with their rule strings, enforcement by provider and mode, and the submodule conflict. Discharges the oracles written in the previous phase.

---

## phase-03 — Declare protectedPaths in phax.json {#phase-03-protected-config}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Besides the config work, the phase builds a regression harness that drives a phase on each of three providers through the fake CLIs and pins argv, environment, prompts and output together, which no existing test does in one place.

A project declares `protectedPaths` in phax.json. `phax validate` lists it, and every command that loads the configuration refuses a malformed list, a list set in a user overlay, or a glob inside a submodule, with exit 2. A snapshot pins what a project that declares nothing sees, before any behaviour changes.

### Detailed instructions

- First, before touching any source file, create `tests/integration/protectedPathsAdditive.test.ts`, modelled on tests/integration/declaredStopProviderArgv.test.ts and tests/integration/networkPause.test.ts. It drives one phase per provider (claude-code, codex-cli, mistral-vibe, secure mode) through `executePlan` with the real backend and the fake CLIs (tests/helpers/fakeProviderCli.ts for claude and codex, the fake `vibe` of tests/helpers/vibe3Fixtures.ts for Vibe). Each run has a phax.json with no `protectedPaths` and a gate of one shell step that fails on its first attempt and passes on its second. Use isolateGit and temporary directories.
- For each provider, `toMatchSnapshot` these:

  - each invocation's argv;
  - the environment variables phax sets for it, filtered to the names phax adds, such as `VIBE_*`;
  - the phase prompt and the fix prompt;
  - the gate attempt logs;
  - the run's output port lines.

  Normalize temporary paths, session ids, instants and commit hashes to placeholders. If a fake CLI does not log what you need, extend its log in tests/helpers/fakeProviderCli.ts or tests/helpers/vibe3Fixtures.ts. Also assert the phase's security.json and gate-attribution.json with explicit `toEqual` expectations of today's values, not a snapshot: phase-04 changes exactly those expectations. Run the test once, so it writes `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap` from today's code. No later phase may change that snapshot.
- Export the dialect's refusal text from `src/schemas/architecture.ts`. Rename `globProblem` to an exported `architectureGlobProblem`, keep its messages, and have ArchitectureGlobSchema use it as today.
- In `src/schemas/phaxConfig.ts`, add to PhaxConfigSchema `protectedPaths: Schema.optional(Schema.NonEmptyArray(ArchitectureGlobSchema))`. Its annotation says: the files whose change is the operator's decision, which no phase of a run may create, change, delete or rename; the phax.json phax loads is protected too, by its repo-relative path; accepted in phax.json only; the glob dialect (GLOB_DIALECT), matched ignoring letter case. Add `readonly protectedPaths?: ProtectedList` to ResolvedConfig, documented as coming from phax.json alone. Then run `pnpm dev schema upgrade` to regenerate `phax.schema.json`. tests/unit/phaxConfigJsonSchema.test.ts compares it.
- Create `src/domain/config/gitmodules.ts`, pure, exporting `parseGitmodulesPaths(text: string): readonly string[]`. It returns the value of every `path = <value>` line, with whitespace trimmed, surrounding double quotes removed and trailing slashes dropped, in file order. It ignores comments (`#`, `;`) and every other key.
- In `src/app/loadConfig.ts`, refuse `protectedPaths` in a user overlay in `readUserOverlay`, before its decode, beside the `assignments` refusal. The message is exactly `"protectedPaths" is accepted only in phax.json`, and the error's path is the overlay file.
- In `src/app/loadConfig.ts`, check phax.json's raw `protectedPaths` before its full decode, when present:

  - A value that is not an array, or an empty array, is refused with `protectedPaths: a non-empty list of globs is required`.
  - Every entry that is not a string, or for which `architectureGlobProblem` returns a message, is refused with `protectedPaths[N]: <message>`, for example `protectedPaths[0]: "../shared/allow.json" has a .. segment`.
  - Then read `<git root>/.gitmodules` when it exists, with node:fs as the loader already does, and refuse the first `submoduleConflict` with `protectedPaths[N]: "<glob>" is inside the submodule <path>`.

  Each error's path is the phax.json path. Resolve `protectedPaths: protectedList(config.protectedPaths, configPath)` only when the key is declared, where `configPath` is the path of the phax.json that `findPhaxConfig` found, relative to the git root, with POSIX separators (`phax.json`, or `pkg/phax.json` for a config found below the root).
- In `src/cli/commands/validate.ts`, when `config.protectedPaths` is set, print `  protected paths: <glob>, <glob>` right after the `global:` line, with every glob of the list including the loaded phax.json's repo-relative path, joined by `, `.
- Tests:

  - Create `tests/unit/config/gitmodules.test.ts`.
  - Extend `tests/unit/loadConfig.test.ts` with the overlay refusal for phax.local.json and for ~/.phax/config.json, the empty list, `../shared/allow.json`, `/abs/x.json`, the submodule refusal, the resolved list, and the resolved list of a config found at `pkg/phax.json` from a cwd of `pkg/`, ending with `{ glob: "pkg/phax.json", entry: "pkg/phax.json" }`. For the ~/.phax/config.json case, call `isolatePhaxHome()` from tests/helpers/isolatePhaxHome.ts and write `<home>/.phax/config.json`, then `restore()`.
  - Extend `tests/unit/cli/validate.test.ts` with the `protected paths: **/steme.baseline.json, phax.json` line.
  - Create `tests/integration/protectedPathsConfig.test.ts`: in temporary git repositories, it runs the CLI's validate and run entries, the way existing CLI integration tests do. Every spawned CLI gets `env: phaxHomeEnv()` from tests/helpers/isolatePhaxHome.ts, since tests/setup/phaxHomeGuard.ts does not watch child processes; the ~/.phax/config.json overlay case calls `isolatePhaxHome()` first and writes the overlay in that home, which `phaxHomeEnv()` then hands the child. For each refusal (overlay, submodule) it asserts exit 2 and the message on both commands, and for the declared list it asserts exit 0 and the line on validate.
- In README.md, edit only hand-written text, outside the `<!-- BEGIN GENERATED CLI REFERENCE -->` block: `pnpm docs:cli` regenerates that block and tests/integration/docsCliDrift.test.ts checks it, so phase-08 refreshes it. Add `"protectedPaths": ["**/steme.baseline.json"]` to the `phax.json` example under "Set up a project", and a `protectedPaths` bullet to the key list after it: the files whose change is the operator's decision, which no phase may create, change, delete or rename; the loaded phax.json is protected too; accepted in phax.json only; `phax validate` lists them.
- Run the configured gate.

### Planned files to create

- `src/domain/config/gitmodules.ts`
- `tests/unit/config/gitmodules.test.ts`
- `tests/integration/protectedPathsConfig.test.ts`
- `tests/integration/protectedPathsAdditive.test.ts`
- `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap`

### Planned files to edit

- `src/schemas/architecture.ts`
- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `src/cli/commands/validate.ts`
- `phax.schema.json`
- `README.md`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/cli/validate.test.ts`

### Optional files that may be edited

- `tests/helpers/fakeProviderCli.ts`
- `tests/helpers/vibe3Fixtures.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `phax.user.schema.json`

### Boundary contracts

Config to domain: loadConfig decodes phax.json's raw `protectedPaths` and hands the domain only a decoded glob list. The domain returns the ProtectedList, or a SubmoduleConflict, which the config layer words. CLI to app: validate reads `ResolvedConfig.protectedPaths` and prints it. It holds no rule of its own.

### Test strategy

- phax validate prints protected paths: **/steme.baseline.json, phax.json and exits 0 for a declared list — medium · smoke · stdout and exit code · in-phase · ac-declare
- a phax.json found at pkg/phax.json implies the entry pkg/phax.json, not a root phax.json — small · example · the resolved list · in-phase
- an empty list, a .. segment and a leading / are each refused with exit 2, the last two naming protectedPaths[0] and the rule broken — medium · table · stderr and exit code · in-phase · ac-malformed
- protectedPaths in phax.local.json or ~/.phax/config.json is refused by validate and run with exit 2, naming the overlay file, with the CLI child's HOME in a temporary home — medium · table · the refusal message, its at path and exit 2 · in-phase · ac-overlay
- a glob inside a .gitmodules submodule is refused by validate and by run with exit 2, naming protectedPaths[0] and vendor/lint-rules — medium · example · stderr and exit code · in-phase · ac-submodule
- .gitmodules paths are read from path lines, quoted or not, and a file with none gives none — small · example · the parsed path list · in-phase
- a phase on each provider through the fake CLIs, with a red then a green gate attempt, keeps its argv, environment, phase prompt, fix prompt, gate logs and output — medium · smoke · the snapshot taken before any behaviour change · in-phase · ac-nothing

### Implementation order

1. Write the additive snapshot test and record its snapshot against today's code.
2. Export architectureGlobProblem and add the schema key, then regenerate phax.schema.json.
3. Add the gitmodules parser.
4. Add the overlay refusal, the pre-decode check, the submodule refusal and the resolved list in loadConfig.
5. Add the validate line.
6. Add the tests and README text, then run the gate.

### Excluded scope

- Any use of the list at run time: records (phase-04), provider rules and prompt (phase-05), and the check (phase-06 onward).
- Help text in src/cli/cliDocs.ts and the generated usage spec (phase-08).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact messages of each refusal, and where in loadConfig they sit. The `ResolvedConfig.protectedPaths` field, and how the loaded config's repo-relative path is computed. The path of the additive snapshot test, how it normalizes paths and ids, what it records per provider, and which helper logs you extended. Confirm that the snapshot was written before any source change. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(config): declare protectedPaths in phax.json`

### Commit body

phax.json gains a top-level protectedPaths list in phax's glob dialect, with the phax.json phax loaded protected too, named by its repo-relative path. Every command that loads the configuration refuses, with exit 2, an empty list, an entry that breaks the dialect (named protectedPaths[N]), the key in phax.local.json or ~/.phax/config.json, and a glob that reaches into a submodule declared in .gitmodules. phax validate lists the protected paths. A snapshot test pins the argv, environment, prompts, gate logs and output of a phase on each provider for a project that declares nothing.

---

## phase-04 — Record protected paths in security.json and gate-attribution.json {#phase-04-protected-records}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every phase's security.json is written at version 3, with a required `protectedPaths` (null, or the globs and the phase's enforcement), and version 1 and 2 files read as version 3. gate-attribution.json moves to the 0.31.0 shape with a required `protectedPaths`, written as null until the check lands, and 0.26.0 documents still read.

### Detailed instructions

- Edit `src/schemas/securityPosture.ts`:

  - `SecurityPostureSchema` becomes `version: Literal(3)` with a required `protectedPaths: NullOr(Struct({ globs: NonEmptyArray(NonEmptyString), enforcement: Literal("enforced", "partial", "commit-check-only") }))`. Keys go in the order spec §6 shows: version, the base fields up to `skillEditGrants`, `protectedPaths`, `providerSkippedForSecurity`, `stop`.
  - Keep the 0.25.0 shape as `SecurityPostureV1Schema`, and add `SecurityPostureV2Schema`, today's version 2 shape with `stop`.
  - `readSecurityPosture` reads version 3 strictly, lifts version 2 with `protectedPaths: null`, and lifts version 1 with `protectedPaths: null` and `stop: null`.
  - `decodeSecurityPosture` and `encodeSecurityPosture` are version 3.
- In `src/app/executePlan.ts`'s `resolvePhaseAgent`, write `version: 3`. Set `protectedPaths` to null when `config.protectedPaths` is undefined, and otherwise to `{ globs: list.map(e => e.glob), enforcement: protectedEnforcement(list, resolution.selected.provider, securityPolicy.mode) }`. src/app/interactiveFiles.ts reads and rewrites the posture through readSecurityPosture and encodeSecurityPosture, so a stop's close keeps the field.
- Freeze gate-attribution first:

  - Create `src/schemas/history/gate-attribution/0.26.0.ts`, a self-contained copy of today's GateAttributionFileSchema with its own `$schema` URL pattern. It imports only `effect`, as src/schemas/history/run-list/0.26.0.ts does, and is never edited afterwards.
  - Wire it in `src/schemas/persisted.ts`: `readGateAttributionFile` reads a 0.26.0 stamp through the frozen decoder and lifts it to `protectedPaths: null`, and lifts a pre-schema attribution the same way.
  - In `packages/schemas/src/formats/recordTimeline.ts`, list 0.26.0 as a release of gate-attribution, with a `toLatestGateAttribution` overload.
  - Export the frozen types from `packages/schemas/src/index.ts`, and add the module to the closure allowlist in `tests/unit/architecturalGuards.test.ts`.
- In `src/schemas/gateAttribution.ts`, add `protectedPaths` to the attribution's fields. It is required and is the union `null` | `{ result: "pass", changes: Tuple() }` | `{ result: "fail", changes: NonEmptyArray({ path: NonEmptyString, kind: Literal("created", "edited", "deleted", "renamed"), entry: NonEmptyString }) }`. Define the kind literals in this schema file, so the schemas package closure gains no domain module.
- In `src/app/gates.ts`, `writeAttribution` writes `protectedPaths: null` in the step record and in gate-attribution.json.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/gate-attribution/next.schema.json`, the history lock entry, `src/schemas/release.ts` (gate-attribution at 0.31.0) and `packages/schemas/src/generated/index.ts`. Then make every exhaustive format registry in the schemas package tests and `tests/type/schemasPackage.ts` name the new release. `pnpm test:type` names every fixture that builds a GateAttribution or a SecurityPosture: give each `protectedPaths: null` and, for a posture, `version: 3`. That includes the SecurityPosture fixtures of tests/unit/continueCommands.test.ts and the GateAttribution fixtures of tests/unit/verifiedSurfaces.test.ts.
- In `tests/integration/protectedPathsAdditive.test.ts`, change only the explicit security.json and gate-attribution.json expectations: `version: 3`, `protectedPaths: null`, the 0.31.0 `$schema` and `protectedPaths: null`. Its snapshot must not change.
- Add tests:

  - In `tests/unit/security/posture.test.ts`: version 2 and version 1 files read as version 3, and a version 3 file with an unknown key is refused.
  - In `tests/unit/gateAttribution.reader.test.ts`: a 0.26.0 and a pre-schema attribution read with `protectedPaths: null`, and a 0.31.0 pass and fail value round-trips.
  - An integration assertion that a phase in a project declaring `["**/steme.baseline.json"]` on claude-code secure writes `{ globs: ["**/steme.baseline.json", "phax.json"], enforcement: "enforced" }`. Put it in tests/integration/protectedPathsAdditive.test.ts, in a new describe block.
- In `docs/upgrading.md`, add a `### 0.31.0` section above 0.30.0, for records readers. security.json is written at version 3 with a required `protectedPaths` (null, or `globs` and `enforcement`), and phax reads version 1 and 2 files as version 3. gate-attribution.json is stamped 0.31.0 with a required `protectedPaths` (null, or `result` and `changes`), and 0.26.0 documents still read. An older `@lbdremy/phax-schemas` cannot read 0.31.0 attributions.
- Run the configured gate.

### Planned files to create

- `src/schemas/history/gate-attribution/0.26.0.ts`
- `packages/schemas/snapshots/gate-attribution/next.schema.json`

### Planned files to edit

- `src/schemas/securityPosture.ts`
- `src/schemas/gateAttribution.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/app/gates.ts`
- `src/app/executePlan.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/architecturalGuards.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/security/posture.test.ts`
- `tests/unit/gateAttribution.reader.test.ts`
- `tests/integration/protectedPathsAdditive.test.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `docs/upgrading.md`
- `tests/unit/continueCommands.test.ts`
- `tests/unit/verifiedSurfaces.test.ts`

### Optional files that may be edited

- `packages/schemas/json/gate-attribution.schema.json`
- `src/app/interactiveFiles.ts`
- `src/app/finalReport.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/attemptFiles.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/integration/finalReport.test.ts`
- `tests/integration/stopSecurityRecord.test.ts`
- `tests/integration/gates.test.ts`

### Boundary contracts

Schemas to readers: gate-attribution.json is published through @lbdremy/phax-schemas, and records readers must parse 0.26.0 and 0.31.0 documents and say which shape each is. security.json is read only by phax, through readSecurityPosture. App to schemas: executePlan writes the posture and runGates writes the attribution, only through the current encoders.

### Test strategy

- a version 2 and a version 1 security.json read as version 3 with protectedPaths null, the version 1 file also with stop null — small · table · the decoded posture · in-phase · ac-lift
- a gate-attribution.json is stamped 0.31.0 with protectedPaths null, and a 0.26.0 or pre-schema one reads with protectedPaths null — small · example · the decoded attribution · in-phase · ac-attribution
- the schemas package parses gate-attribution at 0.26.0 and at 0.31.0 and names each shape — small · example · the parsed shape name and value · in-phase
- a project with no protectedPaths differs only by security.json version 3 with protectedPaths null and gate-attribution 0.31.0 with protectedPaths null — medium · smoke · the phase-03 snapshot and the explicit record expectations · in-phase · ac-nothing
- a declaring project on claude-code secure records its globs, phax.json included, and enforcement enforced — medium · example · the written security.json · in-phase

### Implementation order

1. Freeze gate-attribution 0.26.0 and wire its reader and package release.
2. Add protectedPaths to the gate-attribution schema and have runGates write null, then run schemas-check --write.
3. Move security.json to version 3 with the lifts, and write the field in executePlan.
4. Update the fixtures, registries and the additive test's record expectations.
5. Write docs/upgrading.md 0.31.0 and run the gate.

### Excluded scope

- Running the check or writing a pass or fail result (phase-07).
- Native rules (phase-05).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact shapes of security.json version 3 and gate-attribution 0.31.0. The reader lifts in readSecurityPosture and readGateAttributionFile. The files `scripts/schemas-check.ts --write` touched. Confirmation that the additive snapshot did not change. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): record protected paths in security.json and gate-attribution`

### Commit body

security.json is written at version 3 with a required protectedPaths: null when phax.json declares none, otherwise the protected globs and the phase's enforcement (enforced, partial or commit-check-only). Version 1 and 2 files read as version 3. gate-attribution.json moves to the 0.31.0 shape with a required protectedPaths, written as null until the check runs, and its 0.26.0 shape is frozen so older records still read.

---

## phase-05 — Native protected-path rules, the grant refusal and the phase prompt {#phase-05-native-rules}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase makes 19 planned edits across two providers (Claude Code's merged settings and Vibe's denylists with its resolved root and read-back), the run preflight and its exit code, the phase prompt, integration scenarios on three providers and two real-CLI e2e files.

In secure mode, Claude Code's file-editing tools and Mistral Vibe's write_file and edit refuse every protected literal and `**/` path natively, in the phase turn, each fix attempt and the handoff turn. Codex and unsafe mode get no rule. A skill edit grant on a protected path is refused at preflight with exit 11. The phase prompt tells the agent which files are the operator's.

### Detailed instructions

- `src/ports/backend.ts`: add `readonly protectedPaths?: ProtectedList | undefined` to AgentRunOptions, documented beside `skillEditGrants`: the protected list, from which the claude and Vibe adapters derive native rules in secure mode, and which codex ignores. In `src/app/executePlan.ts`, add it to every AgentRunOptions a phase builds (the places that set `skillEditGrants`), only when `config.protectedPaths` is defined. The fix loop and the handoff reuse those options, so the three turns share them.
- Claude Code. In `src/infra/providers/claudeSkillEditSettings.ts`, add `buildClaudeSessionSettings(worktreeRoot, grants, denyRules): object | undefined`. It merges the skill-edit hooks object (or nothing) with `permissions: { deny: denyRules }` when denyRules is non-empty, and returns undefined when both are empty. With deny rules and no grants it is exactly `{"permissions":{"deny":[…]}}`. Keep `buildSkillEditGrantSettings` for the hooks part.
- In `src/infra/providers/claudeCode.ts` `buildArgs`, pass `claudeProtectedDenyRules(resolveWorktreeRoot(options.cwd), options.protectedPaths)` only when `options.security.mode === "secure"` and a list is set. Keep today's grant condition for the hooks. Pass the merged object through the existing `grantSettings` field of `src/domain/session/claudePermissionFlags.ts`, keeping its name (src/domain/session/claude.ts sets it too), and update only its comments: one inline `--settings` object holding the skill-edit hooks and the protected-path deny rules, passed only when either exists.
- Mistral Vibe. In `src/domain/session/vibeFlags.ts`:

  - Add `readonly protectedPaths?: { readonly root: string; readonly list: ProtectedList } | undefined` to VibeFlagsInput, where `root` is the worktree's resolved path.
  - In the secure, non-read-only branch, append `vibeProtectedDenylist(root, list)` to the `write_file` and `edit` denylists, after the `.vibe`/`.agents` guards. Use the worktree only, not the extra roots.
  - Read-only and unsafe sessions get nothing.
  - `vibeConfigMismatch` already rebuilds the expected tools from the input. Check that it then accepts an export whose denylists hold the protected entries.

  In `src/infra/providers/mistralVibe.ts`, `vibeFlagsInputOf` resolves `options.cwd` with `realpathSync`, falling back to the path as given, as claudeCode.ts's `resolveWorktreeRoot` does, and sets `protectedPaths: { root, list: options.protectedPaths }` when a list is set. Spec §10 puts the entries under the worktree's resolved path, and Vibe's fnmatch compares resolved paths (macOS `/var` is `/private/var`). Build the turn's environment from the same `flagsInput` the post-turn `vibeConfigMismatch(flagsInput, config)` reads, instead of calling `vibeFlagsOf` a second time, so both see the same resolved entries. Leave `cwd`, `--workdir` and the guards as given, so a project that declares nothing builds today's argv and environment. The codex adapter is untouched.
- Grant refusal. In `src/domain/security/skillEditGrants.ts`, add a pure `skillEditProtectedConflicts(phases, list)`. It gives `{ phaseId, file, entry }` for each granted file (`phaseSkillEditGrants`) that `matchProtected` matches.
- In `src/domain/errors.ts`, add `SkillEditProtectedError { message, conflicts }`. Its message starts `Security preflight failed: a skill edit grant names a protected path.` and gives one line per conflict, `  <phaseId>: <file> (<entry> <glob>)`. Add `skillEditProtectedRefusal(phases, allowSkillEdits, list)` in `src/app/skillEditConsent.ts`, which refuses only when consent is given and a list is set.
- Call `skillEditProtectedRefusal` in `src/app/runPreflight.ts`'s `freshRunPreflight`, right after the consent refusal, and in the `skill-edit-consent` preflight entry, over the phases from `startIndex`. Map the error to exit 11 in `src/cli/commands/runLayers.ts`, beside SkillEditConsentError. `src/cli/commands/run.ts` prints SkillEditConsentError's message as is when the preflight refuses (`if (err instanceof SkillEditConsentError)`, near line 424); give SkillEditProtectedError the same branch if it would otherwise print under `phax run failed:`.
- Phase prompt. In `src/app/promptGeneration.ts`, add `readonly protectedPaths?: readonly string[] | undefined` to BuildPhasePromptOptions. When it is set, render a `## Protected paths` section right before `## Execution rules`, with the text of spec §6:

  - These files are the operator's decision. No phase may create, change, delete or rename them, by any tool or command.
  - One `- <glob>` line per glob, the loaded phax.json's repo-relative path included.
  - If a hole cannot be fixed in the code, leave the gate failing and explain the hole in your reply. Never accept it in a protected file, and never work around it.

  Pass the list's globs from executePlan when `config.protectedPaths` is defined.
- Tests:

  - `tests/unit/providers/claudeSkillEditSettings.test.ts`: the merged object for grants plus deny rules, deny rules alone, and neither.
  - `tests/unit/session/vibeFlags.test.ts`: the denylists for `["**/steme.baseline.json", "config/*.json"]`, with phax.json implied, after the guards and under `root`, not `cwd`; nothing for unsafe and read-only sessions; `vibeConfigMismatch` accepting the matching export and naming a denylist that lacks an entry.
  - `tests/unit/security/skillEditGrants.test.ts`: the conflict function.
  - `tests/integration/skillEditConsent.test.ts`: `phax run --allow-skill-edits` with `.claude/skills/release/SKILL.md` planned and `protectedPaths: [".claude/skills/**"]` exits 11 before any phase folder exists, naming the file and `protectedPaths[0]`.
  - `tests/unit/promptGeneration.test.ts`: the section, and its absence when nothing is declared. The existing snapshot must not change.
- Create `tests/integration/protectedPathsNativeRules.test.ts`. Through the fake CLIs and the real backend:

  - A claude-code secure phase in a worktree, with `["**/steme.baseline.json", "config/*.json", "locks/[a].json"]` and one planned skill file run with `--allow-skill-edits`. Its phase turn, a fix attempt (red gate, then green) and its handoff turn each carry one `--settings` holding the hooks and exactly `Edit(//<wt>/**/steme.baseline.json)` and `Edit(//<wt>/phax.json)`, and security.json records `partial`.
  - A mistral-vibe secure phase with `["**/steme.baseline.json", "config/*.json"]` in a temporary worktree (a symlinked path on macOS), whose VIBE_TOOLS denylists hold the three entries after the guards under the worktree's realpath, whose post-turn read-back accepts them, and whose security.json records `partial`.
  - A codex-cli secure phase and a claude-code `--security unsafe` phase, whose argv carry no protected-path rule and whose security.json files record `commit-check-only`.
- Real-CLI e2e, which the phase gate does not run (`PHAX_E2E_RUN=1` only). Create `tests/e2e/claudeProtectedPaths.test.ts`, modelled on tests/e2e/claudeSkillEditGrant.test.ts. With `buildArgs` in secure mode and `["**/steme.baseline.json"]`, ask the real Claude Code to Write and then Edit `packages/a/steme.baseline.json`, and assert that the file is unchanged and that the transcript shows a denied tool result for each call. In `tests/e2e/vibeSecure.test.ts`, add a case with `["config/limits.json", "**/allow.json"]`: the agent is asked to write_file and edit `config/limits.json`, `allow.json` at the worktree root and `packages/a/allow.json`, and every call is refused with every file unchanged.
- Run the configured gate. The additive snapshot of phase-03 must stay unchanged.

### Planned files to create

- `tests/integration/protectedPathsNativeRules.test.ts`
- `tests/e2e/claudeProtectedPaths.test.ts`

### Planned files to edit

- `src/ports/backend.ts`
- `src/infra/providers/claudeSkillEditSettings.ts`
- `src/infra/providers/claudeCode.ts`
- `src/domain/session/claudePermissionFlags.ts`
- `src/domain/session/vibeFlags.ts`
- `src/infra/providers/mistralVibe.ts`
- `src/app/executePlan.ts`
- `src/domain/security/skillEditGrants.ts`
- `src/domain/errors.ts`
- `src/app/skillEditConsent.ts`
- `src/app/runPreflight.ts`
- `src/cli/commands/runLayers.ts`
- `src/app/promptGeneration.ts`
- `tests/unit/providers/claudeSkillEditSettings.test.ts`
- `tests/unit/session/vibeFlags.test.ts`
- `tests/unit/security/skillEditGrants.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/e2e/vibeSecure.test.ts`

### Optional files that may be edited

- `tests/unit/providers/claudeCode.test.ts`
- `tests/unit/sessionAdapters.test.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/helpers/vibe3Fixtures.ts`
- `src/app/dryRun.ts`
- `tests/integration/skillEditGrants.test.ts`
- `src/cli/commands/run.ts`

### Boundary contracts

App to backend port: AgentRunOptions carries the protected list, and the adapters own how it becomes argv or environment. Domain to infra: the rule strings come from claudeProtectedDenyRules and vibeProtectedDenylist (phase-02), so both providers read one classification. App to CLI: SkillEditProtectedError reaches the CLI and exits 11, beside the other grant refusals.

### Test strategy

- a claude-code secure phase turn, fix attempt and handoff turn each carry one --settings with the grant hooks and the two protected deny rules, none for the wildcard or bracket glob, and security.json records partial — medium · example · the recorded argv and security.json · in-phase · ac-claude-flags
- --settings holds only permissions.deny with protected paths and no grant, and no --settings is passed with neither — small · example · the settings object · in-phase · ac-nothing
- a mistral-vibe secure turn's write_file and edit denylists hold the literal, root and nested entries after the guards under the worktree's realpath, nothing for config/*.json, and the post-turn read-back accepts them — medium · example · VIBE_TOOLS, vibeConfigMismatch and security.json · in-phase · ac-vibe-flags
- a codex-cli secure phase and a claude-code unsafe phase carry no protected-path rule and record commit-check-only — medium · example · the recorded argv and security.json · in-phase · ac-codex-unsafe
- phax run --allow-skill-edits refuses with exit 11, before any phase, a granted skill file that a protected glob matches, naming the file and protectedPaths[0] — medium · example · stderr, exit code and no phase folder · in-phase · ac-grant-conflict
- the phase prompt carries a Protected paths section listing the globs and the loaded phax.json and the instruction to leave an unfixable hole failing, and carries none when nothing is declared — small · example · the prompt text · in-phase · ac-phase-prompt
- the real Claude Code CLI denies Write and Edit of a protected file and leaves it unchanged; run by the review under PHAX_E2E_RUN=1, not by the gate — large · smoke · the file content and the denied tool results · in-phase · ac-claude-e2e
- the real Vibe CLI refuses write_file and edit of a literal, a root **/ and a nested **/ protected file; run by the review under PHAX_E2E_RUN=1, not by the gate — large · smoke · the file contents and the refused calls · in-phase · ac-vibe-e2e

### Implementation order

1. Add the protected list to AgentRunOptions and pass it from executePlan.
2. Build the merged Claude settings and pass the deny rules.
3. Extend the Vibe denylists and the read-back.
4. Add the grant conflict, its error, both preflight checks and exit 11.
5. Add the phase prompt section.
6. Write the unit, integration and e2e tests, then run the gate.

### Excluded scope

- Any check of the phase's files (phase-06 onward).
- Codex permission profiles, which are a non-goal.
- Native rules for read-only sessions.

### Verification

The `standard` gate profile in phax.json. The two e2e tests are skipped without PHAX_E2E_RUN=1, and the review runs them by name.

### Expected handoff content

The AgentRunOptions field and every place executePlan sets it. The signature of buildClaudeSessionSettings and the exact --settings JSON for each case. Where the Vibe entries join the denylists, and where the adapter resolves the worktree root. The SkillEditProtectedError message. The phase prompt section's text and its position. The names of the e2e tests, for the reviewer to run. Confirmation that the additive snapshot did not change. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(security): native protected-path rules on Claude Code and Vibe`

### Commit body

In secure mode, Claude Code's file-editing tools get one Edit(//<worktree>/<glob>) deny rule per protected literal or **/ path, merged into the inline settings that skill edit grants use. Vibe's write_file and edit denylists get the same paths beside the .vibe and .agents guards, and its post-turn read-back expects them. Codex and unsafe mode get no rule. A skill edit grant on a protected path is refused at preflight with exit 11, and the phase prompt names the protected paths and says an unfixable hole is left failing.

---

## phase-06 — Observe a phase worktree against its base {#phase-06-worktree-observation}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase adds a git observation no adapter method makes today: a temporary-index tree diffed with NUL paths and renames through a shared parser that must keep its current callers unchanged, a per-file comparison with base blobs that bypasses the index, and a listing of ignored files.

phax can observe, through the Git port, every way a worktree differs from a commit: tracked changes with renames and type changes, read with NUL-separated paths; protected tracked files compared with their base blobs whatever the index says; and untracked ignored files. phax can also turn that observation into the phase's protected changes.

### Detailed instructions

- In `src/infra/git.ts`, give `parseDiffTreeNameStatusZ` a rename mode instead of adding a parser. With renames on, an `R<score>` status is followed by two NUL-terminated paths, the old then the new, and gives a row `{ status: "R"; oldPath; path }`; `A`, `M`, `D` and `T` read as today. With renames off, `R` and every other code stay refused with a GitError, exactly as today. `changedPathsBetween` calls it with renames off and keeps `--no-renames`, its port signature and its ChangedPath rows, so closeStop, resetPhase, reviewCode and interactiveStop see no change. Keep the rename row type local to src/infra/git.ts. Paths are kept as written, with no trimming. Leave src/domain/reconciliation/parseNameStatus.ts unchanged: file reconciliation relies on it as it is.
- `src/ports/git.ts`: add `observeWorktree(path: string, base: string, trackedPaths: readonly string[]): Effect.Effect<ProtectedObservation, GitError>`. Document it: the worktree at `path`, as it stands on disk, against commit `base`. `entries` is the name-status, with renames, of base against a tree of the worktree built in a temporary index seeded from HEAD, `.phax-context/` left out. `tracked` holds, for each given path, how the file on disk compares with its blob at base. `untracked` holds the untracked files git ignores, outside `.phax-context/`. The real index is never touched.
- In `src/infra/git.ts`, implement `observeWorktree`:

  - Build the tree with `snapshotWorktreeEffect`, the effect behind `snapshotWorktree`.
  - Run `git diff-tree -z -r -M --name-status --no-ext-diff <base> <tree>` and read it with `parseDiffTreeNameStatusZ` in rename mode. Map `A` to `added`, `M` to `modified`, `D` to `deleted`, `T` to `type-changed`, and `R` to `renamed` with `oldPath`.
  - For `trackedPaths`, read their modes and blob ids at base with `git ls-tree -z <base> -- <paths>`. Then lstat each worktree file: absent gives `missing`; a symbolic link against a non-link base mode, or the reverse, gives `type`; a symbolic link gives `content` when its target, hashed as a blob, differs; a regular file gives `content` when `git hash-object --path=<path> -- <file>` differs or the executable bit differs from the base mode; otherwise `same`. Skip submodule (160000) entries.
  - Run `git ls-files -z --others --ignored --exclude-standard` for `untracked`, dropping `.phax-context/` paths.
  - Decode every path as UTF-8.
- In `src/infra/fakes/git.ts`, implement `observeWorktree`. It records the call and returns a scripted observation per path, defaulting to the empty observation `{ entries: [], tracked: trackedPaths.map(p => ({ path: p, state: "same" })), untracked: [] }`.
- Create `src/app/protectedPathsCheck.ts`, exporting `checkProtectedPaths({ worktree, base, list }): Effect.Effect<readonly ProtectedChange[], GitError, Git>`. It reads the base's paths with `readTree(worktree, base)`, keeps `protectedTrackedPaths(list, paths)`, calls `observeWorktree` and returns `protectedChanges(list, observation)`. Changes are judged against `base`, never HEAD, so a commit the agent made during its turn is still checked.
- Create `tests/integration/protectedPathsCheck.test.ts`, which runs `checkProtectedPaths` with the real git adapter in temporary repositories (isolateGit). Each case commits a base, then changes the worktree:

  - Create `packages/a/steme.baseline.json`, delete `packages/b/steme.baseline.json`, `git mv packages/c/steme.baseline.json packages/c/old.json`, and `git mv packages/d/x.json packages/d/steme.baseline.json`. Expect a created, b deleted, c renamed, d renamed.
  - Replace `packages/a/steme.baseline.json` with a symbolic link and create `packages/b/RÈGLES.json` under `["**/steme.baseline.json", "**/règles.json"]`. Expect a edited, and `packages/b/RÈGLES.json` created, spelt as written.
  - Run `git update-index --skip-worktree packages/a/steme.baseline.json`, then edit it. Expect a edited, while `git diff` prints nothing.
  - With a .gitignore of `generated/`, create `generated/allow.json` under `["**/allow.json"]`. Expect it created.
  - Commit an edit of the protected file in the worktree. Expect it edited against the base.
  - A clean worktree gives `[]`.

  Add a case whose renamed and created names hold a tab, a newline, a leading space and non-ASCII characters, which the adapter reports spelt as written. Add one contract case: the fake's default observation equals the real adapter's observation of a clean worktree for the same tracked paths.
- Run the configured gate.

### Planned files to create

- `src/app/protectedPathsCheck.ts`
- `tests/integration/protectedPathsCheck.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`

### Optional files that may be edited

- `tests/helpers/tempGit.ts`
- `tests/helpers/isolateGit.ts`

### Boundary contracts

App to Git port: the use case needs every difference between a worktree on disk and a commit, without trusting the real index. The port provides ProtectedObservation, a domain type. The adapter owns git invocations, the temporary index and file stats. The domain owns which paths are protected and what kind each change is.

### Test strategy

- a real worktree's protected creations, deletions and renames, a rename on both sides, are named against the base — medium · example · the change list checked in a temporary repository · in-phase · ac-kinds
- a symbolic link replacing a protected file is edited and a non-ASCII case variant is created, spelt as written — medium · example · the change list · in-phase · ac-type-nonascii
- an edit under git update-index --skip-worktree is edited although git diff shows nothing — medium · example · the change list beside an empty git diff · in-phase · ac-skip-worktree
- a protected file created under a .gitignore folder is created — medium · example · the change list · in-phase · ac-ignored
- a protected edit the agent committed itself is judged against the phase base, not HEAD — medium · example · the change list · in-phase
- the adapter's NUL name-status read keeps T as type-changed and both paths of a rename, whatever characters a name holds — medium · example · the observation of a temporary repository · in-phase
- the fake git's default observation equals the real adapter's observation of a clean worktree — medium · contract · the same case run on both · in-phase

### Implementation order

1. Give parseDiffTreeNameStatusZ its rename mode, leaving changedPathsBetween as it is.
2. Add the port method and its adapter, reusing snapshotWorktreeEffect.
3. Add the fake method.
4. Write the use case and the real-git tests, then run the gate.

### Excluded scope

- Any caller of checkProtectedPaths in the run (phase-07, phase-08).
- Any change to parseNameStatus, file reconciliation, or changedPathsBetween's behaviour and signature.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact signature of `Git.observeWorktree` and `checkProtectedPaths` (src/app/protectedPathsCheck.ts). The git commands the adapter runs, how `parseDiffTreeNameStatusZ` gained its rename mode, and confirmation that `changedPathsBetween` is unchanged. How the fake is scripted. The cost observed on a worktree with node_modules, if you measured it. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(git): observe a phase worktree against its base`

### Commit body

The Git port gains observeWorktree. It diffs a temporary-index tree of the worktree against a base commit with rename detection, read by the NUL name-status parser changedPathsBetween already uses, which gains a rename mode. It compares given tracked files on disk with their base blobs, so skip-worktree and assume-unchanged bits cannot hide an edit, and it lists untracked ignored files. checkProtectedPaths turns that observation into the protected changes of a phase, judged against its base and never against HEAD.

---

## phase-07 — Fail a gate attempt on a protected change {#phase-07-gate-check}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The change crosses several parts at once: the in-memory event and error unions, the reducer, the fix loop, the records, the fix prompt, the resume instructions and the CLI rendering.

In a project that declares `protectedPaths`, every gate attempt of a phase checks the phase's files against its base after the gate steps. A protected change fails the attempt whatever the steps' exit codes. The fix loop is told whose file it is. What the loop cannot fix pauses the phase in `gates_exhausted` with exit 4, naming each path, the last fix transcript and the two ways on. gate-attribution.json records the check.

### Detailed instructions

- `src/app/fixLoop.ts`: add a required option `protectedPaths: { readonly list: ProtectedList; readonly base: string } | null`. In `loop`, right after `runGates` returns (success, GateFailedError or GateStepRefusedError alike), when the option is non-null:

  - Run `checkProtectedPaths({ worktree: cwd, base, list })`.
  - Rewrite the attempt's step record (`stepRecordPathFor(logPath(attempt))`) and the phase's gate-attribution.json with `protectedPaths` set to `{ result: "pass", changes: [] }`, or to `{ result: "fail", changes: [{ path, kind, entry }…] }`. Add the rewrite as a helper in `src/app/gateAttribution.ts`.

  When the option is null, call nothing: no git observation, no rewrite.
- Then decide the attempt:

  - A passed gate with no change stays GatePassed.
  - A passed gate with changes is a failed attempt with `failedStep: "protected-paths"`.
  - A failed step keeps its own kind and carries the changes.
  - A refused step pauses as today and carries the changes.

  In `src/app/executePlan.ts`, pass `{ list: config.protectedPaths, base }` when a list is declared, else null. `base` is the `base` the phase's status.json records (createPhaseFolder writes it, and phaseFactsFor reads it). Add `protectedPaths: null` at the other two callers, `tests/integration/fixLoop.test.ts` and `tests/integration/telemetry/adapterFailures.test.ts`.
- Events and errors, which are in memory only:

  - In `src/domain/events.ts`, GateFailed and FixAttemptsExhausted, which are interfaces, become unions discriminated by `failedStep`. The step variant (`configured` | `oracle`) keeps `command` and `exitCode` and adds `protectedChanges: readonly ProtectedChange[]`. The `protected-paths` variant has non-empty `protectedChanges` and no command or exit code. GateStepRefused gains `protectedChanges`.
  - In `src/domain/errors.ts`, GateAttemptsExhaustedError stays one `Data.TaggedError` class: `Data.TaggedError("E")<A | B>` does not compile (TS2509). Replace its `command`, `exitCode` and `failedStep` fields with one required field `failure: { readonly failedStep: "configured" | "oracle"; readonly command: string; readonly exitCode: number; readonly protectedChanges: readonly ProtectedChange[] } | { readonly failedStep: "protected-paths"; readonly protectedChanges: readonly [ProtectedChange, ...ProtectedChange[]] }`, keeping `message`, `logPath`, `attempt` and `phaseId`. Every reader of the old fields reads them through `failure`. GateStepRefusedError gains `protectedChanges`, which `src/app/gates.ts` sets to `[]`. GateFailedError stays as it is.
  - Adapt `src/app/eventAdapter.ts`.
  - In `src/domain/reducer.ts`, keep the transitions. `lastError` for the protected variant reads `Gate failed: protected paths changed (<path>, …)`.
  - Pass `protectedChanges` and the last fix transcript through the effect context in `src/domain/effects.ts` and `src/app/effectRunner.ts` to the resume instructions.
  - Widen every `"configured" | "oracle"` failedStep type that these reach to include `"protected-paths"`.
  - Give every test fixture that builds these events or errors, or a BuildFixPromptInput, its new field: tests/unit/events.test.ts, tests/unit/reducer.test.ts, tests/unit/reducerGateRefusal.test.ts, tests/integration/dispatcher.test.ts, tests/unit/whatsNext.test.ts, tests/unit/reportVocabulary.test.ts, tests/unit/cli/run.test.ts, tests/unit/readmeExitCodes.test.ts and tests/unit/stopTelemetry.test.ts.
- Telemetry. The gate-evaluated reason for the protected variant reads `protected paths: <n> changed`. Record no system error report for it, since no command failed.
- Fix prompt, in `src/domain/gate/fixPrompt.ts`. BuildFixPromptInput gains `protectedChanges`, and `failedStep` admits `protected-paths`.

  - For `protected-paths`, render:
    - `# Gate checks failed — fix required`;
    - the attempt line;
    - `**Failed step:** protected paths`;
    - `## Protected paths changed`, with one `- <path> — <kind> (<entry> <glob>)` line per change;
    - `## Required action`, saying the paths are the operator's decision, to put each path back to its content at the phase base, then fix the hole in the code or leave the gate failing, and if the tools cannot put a path back, to say so.
  - For a step failure with changes, keep today's prompt for the step and insert the same `## Protected paths changed` section before `## Required action`, adding the put-back sentence to the required action.
  - With no changes, the prompt is exactly today's.
- Resume instructions and next steps:

  - In `src/domain/whatsNext.ts`, the `gates_exhausted` scenario gains `protectedChanges` and `lastFixTranscript: string | null`, and `gate_refused` gains `protectedChanges`. With changes, the exhausted headline and steps name each path. They say no phase of the run may change it, and they give the two ways on: put each file back to its content at the phase base and run `phax resume <run> --yes`, or make the change on the base branch and start a new run. They never offer `phax reset-phase` as the remedy.
  - In `src/app/resumeInstructions.ts`, list each path still changed with its kind. Point to the last fix transcript, the highest-numbered `fix-attempt-NN.jsonl` in the phase folder (`fixTranscriptName`), or say none was made. For a refusal with changes, list both the refused step and the protected paths.
  - In `src/cli/commands/run.ts` and `src/cli/commands/resume.ts`, print the same lines on GateAttemptsExhaustedError and GateStepRefusedError.

  The wording is free beyond what spec §6 shows.
- Create `tests/integration/protectedPathsGate.test.ts`, in temporary repositories with isolateGit and the real git adapter:

  - (ac-agent-tool) On codex-cli through the fake CLI, with `["**/steme.baseline.json"]`, the agent adds an entry to `packages/rust/steme-formats/steme.baseline.json` and every step passes. The attempt fails naming the path, `edited` and `protectedPaths[0]`, the session is resumed with the fix prompt, and nothing is committed.
  - (ac-gate-step) A step `node scripts/accept-debt.js` writes `packages/a/steme.baseline.json` and exits 0. The attempt fails naming the path.
  - (ac-shell) On claude-code secure through the fake CLI, the agent runs the allowlisted gate command `pnpm snapshot:update`, scripted to rewrite a protected snapshot. The attempt fails naming it.
  - (ac-self) The agent removes the key from phax.json. The attempt fails naming `phax.json`.
  - (ac-both) First, a failed `steme audit` step plus an edit: the fix prompt carries both. Second, a refused gate-report step plus an edit: the phase pauses with no fix attempt, and the output and resume-instructions.md name the refused step and the path.
  - (ac-exhausted) The agent leaves the file changed at every attempt. The phase ends in `gates_exhausted`, the command exits 4, and the output and resume-instructions.md name the path, say no phase may change it, point to the last `fix-attempt-NN.jsonl`, and give the two ways on.
  - (ac-codex-unsafe) A codex-cli secure phase and a claude-code unsafe phase each fail a protected write at the gate.
  - (ac-attribution) The phase's gate-attribution.json carries the 0.31.0 `$schema` and `protectedPaths: { result: "fail", changes: [{ path: "packages/a/steme.baseline.json", kind: "edited", entry: "protectedPaths[0]" }] }`.
  - With no declared list, no `observeWorktree` call is made. Provide a spy Git that spreads `realGit` (`Effect.runSync(Effect.provide(Git, NodeGitLayer))`, as tests/integration/stopTranscripts.test.ts builds it) and overrides `observeWorktree` to count its calls before delegating; assert zero calls.
- Extend `tests/unit/fixPrompt.test.ts` and `tests/unit/resumeInstructions.test.ts` with the protected-only, step-plus-protected and refusal-plus-protected cases. The additive snapshot of phase-03 must stay unchanged.
- Run the configured gate.

### Planned files to create

- `tests/integration/protectedPathsGate.test.ts`

### Planned files to edit

- `src/app/fixLoop.ts`
- `src/app/gateAttribution.ts`
- `src/app/gates.ts`
- `src/app/executePlan.ts`
- `src/app/eventAdapter.ts`
- `src/app/effectRunner.ts`
- `src/app/resumeInstructions.ts`
- `src/domain/errors.ts`
- `src/domain/events.ts`
- `src/domain/effects.ts`
- `src/domain/reducer.ts`
- `src/domain/whatsNext.ts`
- `src/domain/gate/fixPrompt.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/unit/fixPrompt.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/integration/telemetry/adapterFailures.test.ts`
- `tests/unit/events.test.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/reducerGateRefusal.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/unit/whatsNext.test.ts`
- `tests/unit/reportVocabulary.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/unit/stopTelemetry.test.ts`

### Optional files that may be edited

- `src/domain/matrix.ts`
- `src/app/closeStop.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `src/cli/commands/runLayers.ts`
- `tests/integration/gateRefusal.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/__snapshots__/stateMachineContract.test.ts.snap`
- `tests/e2e/gateExhaustionResume.test.ts`

### Boundary contracts

Fix loop to check use case: the loop needs the protected changes of the worktree against the phase base after each attempt, and src/app/protectedPathsCheck.ts provides them (phase-06). Fix loop to records: the attempt's step record and gate-attribution.json carry the check result, in the gate-attribution 0.31.0 shape (phase-04). Domain to CLI: the GateAttemptsExhaustedError and GateStepRefusedError variants carry the changes, and the CLI only renders them, through buildWhatsNext.

### Test strategy

- a codex-cli agent's edit to a protected file fails a gate attempt whose steps all passed, naming path, edited and protectedPaths[0], resumes the session and commits nothing — medium · example · the fix-loop events, the fix prompt and the git log · in-phase · ac-agent-tool
- a gate step that writes a protected file and exits 0 fails the attempt naming the path — medium · example · the failed attempt and its named change · in-phase · ac-gate-step
- an allowlisted command that rewrites a protected snapshot on claude-code secure fails the attempt naming the snapshot — medium · example · the failed attempt and its named change · in-phase · ac-shell
- removing protectedPaths from phax.json in the worktree fails the attempt naming phax.json — medium · example · the failed attempt and its named change · in-phase · ac-self
- the fix prompt names each change, says the path is the operator's decision, asks it back to the phase base and says the hole is fixed in code or left failing — small · example · the prompt text · in-phase · ac-fix-prompt
- a failed step with a protected change gives a fix prompt carrying both, and a refused report with one names both in the output and resume-instructions.md with no fix attempt — medium · example · the fix prompt, the output lines and resume-instructions.md · in-phase · ac-both
- exhausted attempts with a protected change pause in gates_exhausted with exit 4, naming the path, the last fix-attempt-NN.jsonl and the two ways on — medium · example · the phase state, exit code, output and resume-instructions.md · in-phase · ac-exhausted
- a codex-cli secure phase and a claude-code unsafe phase each fail a protected write at the gate — medium · example · the failed attempt in both runs · in-phase · ac-codex-unsafe
- gate-attribution.json carries the 0.31.0 $schema and the fail result with path, kind and entry for a green-stepped attempt that edited a protected file — medium · example · the written gate-attribution.json · in-phase · ac-attribution
- with no declared list the fix loop makes no observation and the additive snapshot is unchanged — medium · smoke · the spy Git's observeWorktree call count and the phase-03 snapshot · in-phase · ac-nothing

### Implementation order

1. Widen the events, errors and failedStep types, and adapt the reducer and event adapter.
2. Run the check in the fix loop and rewrite the attempt's records.
3. Extend the fix prompt.
4. Extend whatsNext, the resume instructions and the CLI rendering.
5. Write the tests, then run the gate.

### Excluded scope

- The commit-only resume, the handoff turn and the hold point (phase-08).
- Help text and docs/security.md (phase-08).
- Any check at a stop's close.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The new shapes of GateFailed, FixAttemptsExhausted, GateStepRefused, GateAttemptsExhaustedError (with its `failure` field) and GateStepRefusedError. The `protectedPaths` option of runGatesWithFixLoop and how executePlan reads the base. The attribution rewrite helper's name. The fix-prompt and resume-instructions wording chosen. Confirmation that closeStop is untouched and the additive snapshot unchanged. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(gate): fail a gate attempt on a protected change`

### Commit body

In a project that declares protectedPaths, every gate attempt checks the phase's files against its base after the gate steps and fails on a protected change, whatever the steps' exit codes. A failed or refused step keeps its own kind and carries the changes too. The fix prompt names each change and asks for it to be put back. An exhausted loop pauses in gates_exhausted with exit 4, naming each path, the last fix transcript and the two ways on. gate-attribution.json records the result. A stop's close is not checked.

---

## phase-08 — Check the commit-only resume, the handoff turn and the hold point {#phase-08-commit-handoff-checks}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** A new pause event runs through the reducer and the transition matrix, and is reached from three resume re-entries (commit-only, handoff, hold point) whose order executePlan already juggles.

A commit-only resume refuses to commit a protected change. A protected change after the handoff turn, at a resume out of a failed handoff, or at a held phase's hold-point re-entry pauses the phase as a failed handoff, before the handoff is validated and copied and without a phase record. A stop's close stays unchecked. The help text and docs/security.md say how protected paths behave.

### Detailed instructions

- Commit-only resume. In `src/app/executePlan.ts`'s `isResumeFromCommit` branch, before `commitPhase`, when `config.protectedPaths` is defined, run `checkProtectedPaths` against the phase base. If any change is found, dispatch `CommitFailed` with the reason `protected paths changed: <path> (<kind>), …` and fail with CommitPausedError, as a failed commit already does. No commit is made.
- Handoff turn. In `src/app/handoffGeneration.ts`, add to `generatePhaseHandoff` a required option `protectedPaths: { list; phaseCommit } | null`. After the handoff turn returns and before the handoff is read, validated and copied, run `checkProtectedPaths({ worktree, base: phaseCommit, list })`. If any change is found, fail with a new `HandoffProtectedPathsError { message, changes }` from `src/domain/errors.ts`. `phaseCommit` is the phase commit's hash as the phase's status.json records it. In executePlan, pass it whenever a list is declared, both for the first handoff and for every resume out of a failed handoff, and pass null otherwise.
- In executePlan, catch HandoffProtectedPathsError beside HandoffValidationError. Dispatch a new event, `HandoffProtectedPathsChanged { changes }`, and fail with HandoffPausedError, so no handoff is copied and no phase record is written.
- Hold point. In the `resumeAtHoldPoint` path, before `holdPoint` runs, check against the phase commit when a list is declared. If any change is found, dispatch the same event and pause as a failed handoff, so no stop is opened.
- The new event, in `src/domain/events.ts`, `src/domain/reducer.ts` and `src/domain/matrix.ts`. It takes exactly HandoffMissing's transitions, from `passed`, `committed` and `handoff_failed` to `handoff_failed` with `missing: []`, in every run state. It also persists `lastError` reading `Protected paths changed after the commit: <path>, …`, as HandoffTurnFailed persists its failure line. It persists no new stoppedReason, so run-status.json's shape is unchanged. The resume instructions for this pause name each path and the two ways on, as the gates_exhausted ones do.
- A stop's close. Leave `src/app/closeStop.ts` unchanged: its runGates call and its commit run no check, and the person's changes stay reviewCorrections.
- Help text. In `src/cli/cliDocs.ts`, extend validate's long help to say it lists the protected paths and refuses `protectedPaths` in phax.local.json and ~/.phax/config.json. Extend run's long help to say a gate attempt fails when the phase changed a path listed in protectedPaths, and that a skill edit grant on one is refused with exit 11. Run `pnpm gen:usage-spec` and `pnpm docs:cli`. The drift tests keep `phax.usage.kdl`, `docs/cli/reference.md` and README.md's `<!-- BEGIN GENERATED CLI REFERENCE -->` block in step; that block changes only when a command's first help paragraph does.
- In `docs/security.md`, add a `### Protected paths` section between `### Skill edit grants (Claude Code)` and `### Shell command execution`, written for the reader of spec §11 with its steme example. It covers:

  - the phax.json key, and the phax.json phax loaded protected itself by its repo-relative path;
  - the provider table of spec §6 (native rule and enforcement per provider);
  - that the check after each gate attempt is the guarantee and catches what a native rule misses (a shell command, a gate step, Codex, unsafe mode, a wildcard glob);
  - letter case ignored on every host;
  - the commit-only resume and handoff checks;
  - that a stop's close is not checked;
  - the two ways on after a pause;
  - the refusals (overlay, submodule, skill edit grant);
  - the cost of listing ignored files at every check.
- Create `tests/integration/protectedPathsHandoff.test.ts`, in temporary repositories with isolateGit, the real git adapter and the fake backend or heldRunFixture:

  - (ac-commit-resume) A phase paused as a failed commit (`passed`), with a protected path changed in its worktree since. `phax resume` makes no commit and pauses again as a failed commit, with the reason naming the path.
  - (ac-handoff) A green gate, then a handoff turn that writes `packages/a/steme.baseline.json`. The phase commit holds the file at its phase-base content, the phase pauses as a failed handoff naming the path, no phase-handoff.md is copied and no phase record is written.
  - A resume out of that failed handoff whose new handoff turn leaves the file changed pauses again.
  - (ac-handoff-resume) A held phase paused as a failed handoff, with its handoff already validated and copied, and the file changed since. `phax resume` re-enters at the hold point with no handoff turn, pauses again as a failed handoff naming the path, and opens no stop.
  - (ac-stop) At a held stop, a person edits the file. `phax resume` closes the stop with a green gate, the review commit carries the change, and file-reconciliation.json lists it under reviewCorrections.

  Add the new event to the transition table the state machine contract test checks, to the event fixtures of tests/unit/events.test.ts and tests/unit/reducer.test.ts, and to docs/state-machine.md, as the network-failure pause did (commit 7da48d04).
- Run the configured gate. The additive snapshot of phase-03 must stay unchanged.

### Planned files to create

- `tests/integration/protectedPathsHandoff.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/app/handoffGeneration.ts`
- `src/domain/errors.ts`
- `src/domain/events.ts`
- `src/domain/reducer.ts`
- `src/domain/matrix.ts`
- `src/app/resumeInstructions.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/security.md`
- `tests/unit/events.test.ts`
- `tests/unit/reducer.test.ts`
- `docs/state-machine.md`

### Optional files that may be edited

- `src/domain/whatsNext.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/__snapshots__/stateMachineContract.test.ts.snap`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/unit/reducerHandoffPause.test.ts`
- `README.md`

### Boundary contracts

executePlan and handoffGeneration to the check use case: both need the protected changes against a given commit (the phase base before the commit, the phase commit after it), and src/app/protectedPathsCheck.ts provides them. Domain: HandoffProtectedPathsChanged is a new event through the reducer, and RunState and PhaseState change only through the existing transitions to handoff_failed and interrupted.

### Test strategy

- a commit-only resume with a protected change since the pause makes no commit and pauses again as a failed commit naming the path — medium · example · the git log, the phase state and the pause reason · in-phase · ac-commit-resume
- a handoff turn's protected write pauses the phase as a failed handoff naming the path, with the commit at base content, no handoff copied and no phase record — medium · example · the commit tree, the phase state, the phase folder and the records branch · in-phase · ac-handoff
- a held phase's resume at its hold point with a protected change pauses again as a failed handoff and opens no stop — medium · example · the phase state and the absence of a review-stop document · in-phase · ac-handoff-resume
- a resume out of a failed handoff checks again after the new handoff turn — medium · example · the phase state after the resume · in-phase
- a held stop's close with a person's edit to a protected file passes its gate, commits it and lists it under reviewCorrections — medium · example · the review commit and file-reconciliation.json · in-phase · ac-stop
- the new handoff event takes HandoffMissing's transitions in every run and phase state — small · table · the transition matrix · in-phase

### Implementation order

1. Add the event, its reducer transitions and the matrix row.
2. Add the commit-only resume check.
3. Add the handoff check option and its catch in executePlan.
4. Add the hold-point check.
5. Update the help text, regenerate the usage spec and CLI reference, and write docs/security.md.
6. Write the tests, then run the gate.

### Excluded scope

- Any check at a stop's close, or any route to change a protected file while a phase is paused (non-goals).
- Plan lint or preflight checks of planned files (a non-goal).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Where each check sits in executePlan and handoffGeneration, and which commit each compares against. The new event's name and transitions, and the `lastError` it persists. The help text added, and confirmation that `pnpm gen:usage-spec` and `pnpm docs:cli` ran. The docs/security.md section's headings. Confirmation that closeStop is untouched and the additive snapshot unchanged. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(run): check protected paths at the commit-only resume and after the handoff`

### Commit body

A commit-only resume refuses to commit a protected change and pauses again as a failed commit naming each path. After the handoff turn, at every resume out of a failed handoff, and at a held phase's hold-point re-entry, a protected path that differs from the phase commit pauses the phase as a failed handoff, before the handoff is validated and copied and without a phase record. A stop's close stays unchecked. The help of phax validate and phax run, and docs/security.md, say how protected paths behave.
