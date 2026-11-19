---
status: Draft
source-spec: docs/specs/2611180902-vibe-model-flags.md
completes-spec: true
---
# Vibe model and thinking level by Vibe's own flags

phax stops installing model aliases into the user's `~/.vibe/config.toml`. It chooses a Mistral Vibe session's model and thinking level with Vibe 3.1.3's own `--model` and `--thinking` flags, using Vibe's built-in `mistral-medium-3.5` alias, and after each confined turn it checks that the turn ran under that model and level. The catalog, the version floor, the provider-config and routing-table loaders, the setup commands, the review-stop fresh start and the docs change to match. This plan covers every requirement §5.1–§5.18, every §6 surface and every §8 criterion of `docs/specs/2611180902-vibe-model-flags.md`.

The plan has ten phases, ordered core to surface. There are four acceptance pairs, each an acceptance phase that writes failing `it.fails` tests in new, dedicated files, followed by the phase that passes them: (1) the catalog and retired ids, phases 01–02; (2) the argv, environment, version floor and post-turn model/level check, phases 03–04; (3) the providers.json and model-routing.json refusals and the setup rewrite, phases 05–06; (4) the fresh-start level note and the removal of the alias installer, phases 08–09. Phase 07 moves the real-CLI e2e off the alias path, and phase 10 writes the docs.

The facts about the real Vibe 3.1.3 export, probed on 2026-11-18, close the items §10 left open:
- `config.active_model` holds the alias given to `--model`, also with Mistral's model catalog on.
- `config.models` is an object keyed by alias, and the level of a turn is `config.models[config.active_model].thinking`.
- A resumed turn keeps the model and level.
- A resumed turn given `--model` exits 1 with `Error: --model only applies to a new session`.

Execution caveats:
- Phases 02 and 04 regenerate `.claude/skills/phax-planning/SKILL.md` and `.claude/skills/model-routing/SKILL.md` through `pnpm gen:model-catalog`, so run this plan with `phax run --allow-skill-edits`.
- `tests/e2e/vibeSecure.test.ts` is updated by phases 04 and 07 but never run by a phase: it needs `PHAX_E2E_RUN=1`, a real `vibe` and `MISTRAL_API_KEY`. The operator runs `pnpm test:e2e:real` at review.
- Tests never run a real `vibe`, read a real `~/.phax` or `~/.vibe`, or reach the Mistral API.
- 0.40.0 is released and the opened version is 0.41.0 (`package.json`). The upgrade notes therefore go into a new `### 0.41.0` section at the top of "Release by release" in `docs/upgrading.md`, which phase 10 creates. No test names a version literally.
- Generated files (`phax.usage.kdl`, `docs/cli/reference.md`, the README CLI region) are only ever regenerated with their scripts, never edited by hand.

## Required commands

- `pnpm gen:model-catalog`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `pnpm test:unit`
- `pnpm test:integration`

Every command above is already an entry of `security.agentCommands` in `phax.json`, so no PHAX security configuration change is needed. `pnpm gen:model-catalog` rewrites two `.claude/skills/` files (phases 02 and 04), so start the run with `phax run --allow-skill-edits`. Snapshot files are edited by hand: `pnpm test:integration -u` is not an allowed command.

## Technical arbitrations

- Flag placement: a new headless session (a phase's first turn, a read-only session, a sealed completion or an extraction) gets `--model <options.model> --thinking <options.effort>` right after its agent flags (`--agent …` with any `--enabled-tools`/`--disabled-tools`) and before `--output`. A resumed turn gets neither flag; Vibe 3.1.3 refuses `--model` on a resume. The pair is built in `src/infra/providers/mistralVibe.ts`, not in `vibeFlags.ts`, because it selects a model and does not confine the session. Loss accepted: tests pin the presence and value of each pair (by adjacency), never its absolute position, so a reordering inside the argv goes unnoticed.
- Inherited variable: every headless turn and sealed completion removes any `VIBE_ACTIVE_MODEL` it inherits from phax's own environment before spawning. Loss accepted: an operator can no longer steer phax's Vibe sessions by exporting `VIBE_ACTIVE_MODEL`. That was never a supported control, since routing chooses the model, and the post-turn check would refuse the result anyway.
- Reading the level: after the existing confinement comparisons, which stay first and unchanged, `vibeConfigMismatch` compares `config.active_model` with the model phax resolved. Only when that matches does it read `config.models[<model>].thinking`. A `models` that is absent, not a plain object (a list included), an entry that is absent, or an entry with no `thinking` reports `thinking of <model> is absent, phax set "<effort>"` and refuses the turn. The messages are `active_model is "<got>", phax set "<model>"` and `thinking of <model> is "<got>", phax set "<effort>"`, inside the existing refusal sentence that names the export path. The check covers confined turns only, new and resumed. Loss accepted: if a future Vibe reshapes `config.models`, every confined Vibe turn is refused until phax follows (fail-closed).
- `phax agent setup providers --json` gains two string arrays: `retiredReplaced` (each successor id listed in place of a retired one, once, in config order) and `fieldsDropped` (dotted paths such as `providers.mistral-vibe.modelEnvVar`). These are the names of the spec's indicative example. Loss accepted: a richer per-family shape (which family received which successor, with what efforts) is not offered.
- Successors: every retired `phax-mistral-medium-3.5-*` id (`-low`, `-medium`, `-max`, `-off`, `-high`) maps to `mistral-medium-3.5`. The rewrite inserts the built-in catalog entry from `DEFAULT_PROVIDER_CONFIG` (same provider and family) where the first retired id stood, unless the family already lists it. The routing-table refusal names the same successor. Loss accepted: the rewrite now adds a catalog entry the user did not write (decided in q-retired-successor).
- `modelEnvVar` is detected on the raw JSON before the strict decode. `loadProviderConfig` refuses obsolete fields first, then decodes strictly, then refuses retired ids, so a pre-upgrade file shows the fields message and, once that is fixed, the ids message. Only `phax agent setup providers` reads the file leniently: it strips the field and reports it. Loss accepted: a file with both defects needs two reads to see both messages; the one rewrite command fixes both at once.
- Fresh-start note: the session adapter gains `freshStartNote({ model, effort })`, which returns the sentence for Vibe and null for Claude Code and Codex. The note is carried on the in-memory stop report as `freshStartNote: string | null`, printed under the fresh-start command by `phax run`/`phax resume`, and given as an info notice by `phax enter-phase`. `review-stop.json` and its `{ cwd, argv, env }` command are untouched. The fresh start names `VIBE_ACTIVE_MODEL` itself in `src/domain/session/mistral.ts`. Loss accepted: the `--json` stop report of `phax run`/`phax resume` (not a persisted format) gains a field.
- Acceptance tests live in new, dedicated files, never in an existing suite, so each passing phase can still update the existing tests its change shifts. The shared fake `vibe` (`tests/helpers/vibe3Fixtures.ts`) is extended in phase 03 to mirror Vibe 3.1.3 and is frozen with that pair, because its flag resolution is what those tests judge with. Loss accepted: until phase 04 merges, any later fix to the fake needs a new acceptance phase.
- Phase cut: the retired-id refusal lands with the catalog in phase 02, because adding the alias ids to `RETIRED_MODEL_IDS` refuses such a file at once. The successor listing and the routing-table refusal land in phase 06 with `modelEnvVar`, in the brief's order. Loss accepted: between phases 02 and 06 a `providers.json` rewritten by `--write` would drop the Vibe family. No user sees that intermediate state, because the run merges as one pull request.

---

## phase-01 — Acceptance tests for the mistral-medium-3.5 Vibe catalog {#phase-01-catalog-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-02
**Acceptance test files:** `tests/unit/routing/vibeModelCatalog.test.ts`

Write, as failing acceptance tests, what the catalog change must show: Claude requests routed to Vibe reach Vibe's own `mistral-medium-3.5` alias at `off` and `high` through `equivalent` edges, the built-in family lists only that alias, and a `providers.json` that still lists the phax alias ids is refused by name.

### Detailed instructions

- Create `tests/unit/routing/vibeModelCatalog.test.ts`. Mark every test in it with `it.fails(...)`, the acceptance provider's expected-failure marker, so `pnpm test` stays green. Never use `skip`, `todo` or `only`, and give every test a distinct title.
- Test only through entries that exist today and that phase-02 keeps: `DEFAULT_MODEL_ROUTING` and `DEFAULT_PROVIDER_CONFIG` (`src/domain/routing/defaults.ts`), `resolveModel` (`src/domain/routing/resolve.ts`), and `loadModelRouting`, `loadProviderConfig` and `PROVIDER_CONFIG_PATH` (`src/app/loadRouting.ts`) over `makeFakeFileSystem` (`src/infra/fakes/fs.ts`), exactly as `tests/unit/routing/loadRouting.test.ts` runs them. The file must typecheck (`pnpm test:type`) against today's code: import no helper that does not exist.
- Test `Claude requests reach mistral-medium-3.5` (ac-catalog-routing): with no file in the fake file system, load both configs (the built-in ones). Enable `mistral-vibe` in memory by copying the provider config with `enabled: true` on its `mistral-vibe` entry, and assert `routing.providerPriority[0]` is `mistral-vibe`. `resolveModel({ model: "claude-sonnet-4-6", effort: "high" }, routing, providers)` must select provider `mistral-vibe`, family `mistral-medium`, concreteModel `mistral-medium-3.5` and thinking `high`, with relationship `equivalent`. `claude-haiku-4-5-20251001` at `none` must select concreteModel `mistral-medium-3.5` and thinking `off`, with relationship `equivalent`. Finally, `DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"].families["mistral-medium"].models` must equal exactly `[{ id: "mistral-medium-3.5", efforts: ["off", "high"], status: "active" }]`.
- Test `the built-in equivalence keys Vibe's edges on mistral-medium-3.5` (ac-catalog-routing): `DEFAULT_MODEL_ROUTING.equivalence["mistral-medium-3.5"]` equals `{ off: { claude: "claude-haiku-4-5-20251001", effort: "none", relation: "equivalent" }, high: { claude: "claude-sonnet-4-6", effort: "high", relation: "equivalent" } }`, and no key of `DEFAULT_MODEL_ROUTING.equivalence` starts with `phax-mistral-medium-3.5`.
- Test `a providers.json listing the phax alias ids is refused` (ac-retired-refused): in the fake file system, set `PROVIDER_CONFIG_PATH` to a providers.json holding the built-in `claude-code` entry (copied from `DEFAULT_PROVIDER_CONFIG`) and a `mistral-vibe` entry with `enabled: true`, `executable: "vibe"` and `defaultAgent: "auto-approve"`, with no `modelEnvVar`. Its `mistral-medium` family lists `{ id: "phax-mistral-medium-3.5-off", efforts: ["off"], status: "active" }` and `{ id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" }`. `loadProviderConfig()` must fail with a `ConfigValidationError` whose `path` is `PROVIDER_CONFIG_PATH` and whose message contains `phax-mistral-medium-3.5-off`, `phax-mistral-medium-3.5-high` and `phax agent setup providers --write`. Do not assert the reason wording.
- Check that each test fails on its own assertion, not on a missing export: today the resolution names `phax-mistral-medium-3.5-high`, the family lists the two alias ids, the equivalence is keyed on them, and the file loads. To read a failure, run `pnpm test:unit` with one marker removed locally, then restore the marker before committing.
- Change no source file and no other test.

### Planned files to create

- `tests/unit/routing/vibeModelCatalog.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: the routing defaults (`src/domain/routing/defaults.ts`) and the provider-config loader (`src/app/loadRouting.ts`). Consumer: these acceptance tests, through `resolveModel`, the two default tables and `loadProviderConfig`. Stable shape: a resolution's `selected.{provider, family, concreteModel, thinking}` and `relationship`, and a `ConfigValidationError` carrying `message` and `path`.

### Test strategy

- claude-sonnet-4-6/high and claude-haiku-4-5-20251001/none resolve to mistral-vibe's mistral-medium-3.5 at high and off, both equivalent, and the built-in mistral-medium family lists exactly mistral-medium-3.5 with off and high — small · example · expected resolutions and catalog entry · acceptance · ac-catalog-routing
- the built-in equivalence keys both Vibe edges on mistral-medium-3.5 and none on a phax-mistral-medium-3.5-* id — small · example · expected equivalence table · acceptance · ac-catalog-routing
- a providers.json listing phax-mistral-medium-3.5-off and -high is refused, naming both ids and phax agent setup providers --write — small · example · ConfigValidationError message and path · acceptance · ac-retired-refused

### Implementation order

1. Write the three `it.fails` tests in the new file
2. Confirm each fails today on its own assertion, then restore every marker

### Excluded scope

- Any change under `src/`
- Updating existing tests that name the alias ids (phase-02)
- The successor listing, the `modelEnvVar` refusal and the routing-table refusal (phases 05–06)

### Verification

The `standard` gate profile of `phax.json`; the acceptance provider judges the file with its `authored` verdict.

### Expected handoff content

The test file's path, each test's title with the criterion it proves, and the exact values each asserts, so that phase-02 knows what it must produce. Also explain any deviation from the planned file lists.

### Commit subject

`test(routing): acceptance tests for the mistral-medium-3.5 Vibe catalog`

### Commit body

Add expected-failure acceptance tests for the Vibe catalog change. A Claude Sonnet 4.6/high or Haiku 4.5/none request routed to Vibe must reach Vibe's own mistral-medium-3.5 alias at high or off through equivalent edges. The built-in family and equivalence must name only that alias. A providers.json still listing the phax-mistral-medium-3.5-off and -high aliases must be refused by name. The next phase removes the markers.

---

## phase-02 — Ship mistral-medium-3.5 in the Vibe catalog and retire the alias ids {#phase-02-vibe-catalog}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Routing now sends Vibe-bound requests to Vibe's own `mistral-medium-3.5` alias at `off` or `high`. The two phax alias ids become retired ids, so a providers.json that still lists them is refused, and run, phase and authoring records name the new id from now on while old records still read.

### Detailed instructions

- In `src/domain/routing/defaults.ts`, make the `mistral-vibe` entry's `mistral-medium` family list exactly one model, `{ id: "mistral-medium-3.5", efforts: ["off", "high"], status: "active" }`. Keep `executable`, `modelEnvVar` and `defaultAgent` on the entry for now: phase-04 stops headless turns reading `modelEnvVar`, and phase-06 removes it. Update the `claude-haiku` comment, which mentions the old `off` alias, to name `mistral-medium-3.5` at `off`.
- In `DEFAULT_MODEL_ROUTING.equivalence`, replace the keys `phax-mistral-medium-3.5-off` and `phax-mistral-medium-3.5-high` with one key `mistral-medium-3.5` holding `off: { claude: "claude-haiku-4-5-20251001", effort: "none", relation: "equivalent" }` and `high: { claude: "claude-sonnet-4-6", effort: "high", relation: "equivalent" }`. Rewrite the comment above them: these are Vibe's own alias at the two levels the Mistral API serves, chosen per run with `--thinking`.
- Add `phax-mistral-medium-3.5-off` and `phax-mistral-medium-3.5-high` to `RETIRED_MODEL_IDS`, with the reasons `phax runs Vibe's mistral-medium-3.5 with --thinking off` and `phax runs Vibe's mistral-medium-3.5 with --thinking high`. Keep the `-low`, `-medium` and `-max` entries and their reasons. The existing `loadProviderConfig` refusal and `phax agent setup providers --write` then refuse and drop the two ids with no code change.
- Check that hub-to-spoke and spoke-to-hub routing in `src/domain/routing/catalog.ts` still handle one spoke model whose two efforts anchor to two different Claude models. `claude-haiku-4-5-20251001/none` must reach `off`, `claude-sonnet-4-6/high` must reach `high`, and `claude-sonnet-4-6` at `low` or `medium` must still take `high` as an upgrade (nearest edge). Change `catalog.ts` only if a test shows otherwise.
- In `scripts/generate-model-catalog.ts`, the model-routing skill's example table row that names `phax-mistral-medium-3.5-high` now names `mistral-medium-3.5`. Then run `pnpm gen:model-catalog`, which rewrites the planning skill's model-catalog region and the whole model-routing skill. Commit both regenerated skill files and never edit them by hand.
- Remove the `it.fails` markers from `tests/unit/routing/vibeModelCatalog.test.ts`. That is the only change allowed to this acceptance test file; never retype a test's title.
- Update the existing tests that use an alias id as a live catalog id so that they use `mistral-medium-3.5` (find them with `git grep -n phax-mistral-medium-3.5 tests/`): resolve, catalog, effort-levels, preflight, provider-setup and loadRouting unit suites, and `tests/integration/routing.test.ts`. A test about retired ids keeps the alias ids as its retired input. Tests that only replay a recorded model string in a record, a transcript or the behaviour corpus may keep the old id: they prove old ids still read. `tests/e2e/__snapshots__/semanticTrace.providers.test.ts.snap` names the alias as a resolved model; update it by hand only if it records a routing resolution, since the e2e is not run here.
- Create `tests/integration/vibeModelRecords.test.ts` (ac-records), using the harness of `tests/integration/writeRecord.test.ts`. (a) Write a Vibe phase record through `writeRecord` whose model is the `concreteModel` that `resolveModel` gives for `claude-sonnet-4-6/high` over the built-in tables with `mistral-vibe` enabled. Do not hard-code the model. Assert that the record's manifest names `mistral-medium-3.5`. (b) In the same records repository, write a record whose model is `phax-mistral-medium-3.5-high`, and assert that it reads back unchanged and without error through the same reader. (c) Decode two runs' `cost-ledger.json` documents through the cost-ledger schema (`src/schemas/costLedger.ts`): one whose invocation's `models` is keyed `phax-mistral-medium-3.5-high`, one keyed `mistral-medium-3.5`. Assert that both decode and that the sum of their `costUsd` totals is the sum of both. Read `src/app/recordPlumbing.ts` and `src/app/costLedger.ts` for the readers the app uses, and use them when they exist.
- Docs (`docs/model-catalog.md`, `docs/model-routing.md`, the README) are phase-10's; do not touch them here.

### Planned files to create

- `tests/integration/vibeModelRecords.test.ts`

### Planned files to edit

- `src/domain/routing/defaults.ts`
- `scripts/generate-model-catalog.ts`
- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/model-routing/SKILL.md`
- `tests/unit/routing/vibeModelCatalog.test.ts`
- `tests/unit/routing/resolve.test.ts`
- `tests/unit/routing/catalog.test.ts`
- `tests/unit/routing/effortLevels.test.ts`
- `tests/unit/routing/preflight.test.ts`
- `tests/unit/routing/providerSetup.test.ts`
- `tests/unit/routing/loadRouting.test.ts`
- `tests/integration/routing.test.ts`

### Optional files that may be edited

- `src/domain/routing/catalog.ts`
- `tests/unit/routing/sameFamilyPreservation.test.ts`
- `tests/unit/decide/model.test.ts`
- `tests/unit/telemetry/modelResolved.test.ts`
- `tests/unit/providerDispatcher.test.ts`
- `tests/integration/stopRecords.test.ts`
- `tests/integration/stopTranscripts.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/e2e/__snapshots__/semanticTrace.providers.test.ts.snap`

### Boundary contracts

Producer: `DEFAULT_PROVIDER_CONFIG`, `DEFAULT_MODEL_ROUTING` and `RETIRED_MODEL_IDS` in `src/domain/routing/defaults.ts`. Consumers: `resolveModel` and the hub/spoke tables (domain), `loadProviderConfig` and `phax agent setup providers` (app), the record writer, and the generated skill catalogs. Stable shape: a catalog entry `{ id, efforts, status }`, equivalence edges `{ claude, effort, relation }` keyed by spoke id then effort, and retired ids keyed by id with a one-line reason.

### Test strategy

- every routing suite expectation that reached a phax alias id now reaches mistral-medium-3.5 at the same effort and relation, including the nearest-edge upgrade of claude-sonnet-4-6 at low and medium — small · table · updated resolve and catalog expectations · in-phase · ac-catalog-routing
- a providers.json listing -low, -medium or -max is still refused with its own reason, and setup providers --write still drops it — small · example · ConfigValidationError message and planned config · in-phase
- a new Vibe phase record names mistral-medium-3.5, a record naming phax-mistral-medium-3.5-high reads unchanged, and the two runs' cost ledgers decode and sum — medium · example · decoded record manifests and summed cost-ledger totals · in-phase · ac-records
- the skills' generated catalog regions match the shipped catalog — small · example · pnpm gen:model-catalog --check · in-phase

### Implementation order

1. Catalog family, equivalence edges and retired ids in `defaults.ts`
2. Run the routing suites and fix `catalog.ts` only if needed
3. Generator text, then `pnpm gen:model-catalog`
4. Remove the acceptance markers
5. Update the existing tests, then write the records test

### Excluded scope

- `--model`/`--thinking`, the env variable and the version floor (phase-04)
- Removing `modelEnvVar`, the successor listing and the routing-table refusal (phase-06)
- Docs (phase-10)

### Verification

The `standard` gate profile of `phax.json` (it includes `pnpm gen:model-catalog --check`); the acceptance provider judges `tests/unit/routing/vibeModelCatalog.test.ts` with its `passed` verdict.

### Expected handoff content

Report the new `mistral-vibe` family and equivalence entries, the reasons added to `RETIRED_MODEL_IDS`, and whether `catalog.ts` needed a change. List the tests updated and the ones deliberately left naming old ids, and say which reader the records test used. Explain any file-plan deviation.

### Commit subject

`feat(routing): route Vibe to its own mistral-medium-3.5 alias and retire the phax aliases`

### Commit body

The mistral-vibe catalog lists Vibe's built-in mistral-medium-3.5 with efforts off and high. The equivalence edges move to it edge for edge: off to Haiku 4.5/none and high to Sonnet 4.6/high, both equivalent. phax-mistral-medium-3.5-off and -high join RETIRED_MODEL_IDS, so a providers.json that still lists them is refused by name. The skills' generated catalogs are regenerated. Records written from now on name mistral-medium-3.5, and a records test shows old ids still read and their costs still sum.

---

## phase-03 — Acceptance tests for Vibe's model and thinking flags and the post-turn check {#phase-03-flags-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** This phase extends the shared fake vibe that every acceptance test of the pair judges with, and the fake is frozen. It must mirror Vibe 3.1.3's flag resolution, resume restore and resume refusal exactly, because the passing phase cannot repair the fake or a test that is red for the wrong reason.
**Acceptance phase:** passed by phase-04
**Acceptance test files:** `tests/unit/providers/vibeModelFlags.test.ts`, `tests/helpers/vibe3Fixtures.ts`

Write, as failing acceptance tests against a fake `vibe` that behaves like Vibe 3.1.3, the invocation contract. Every new headless session carries `--model` and `--thinking`, a resumed turn carries neither, no headless turn has `VIBE_ACTIVE_MODEL`, a Vibe older than 3.1.3 is refused before spawning, and a confined turn that ran under another model or level, or reports no level, is refused.

### Detailed instructions

- Extend the fake `vibe` in `tests/helpers/vibe3Fixtures.ts` (`FAKE_VIBE_SCRIPT`, `writeFakeVibe`, `FakeVibeOptions`) to mirror Vibe 3.1.3 as probed on 2026-11-18. Keep every existing option and behaviour.
- (a) The default `version` becomes `vibe 3.1.3`.
- (b) A `-p` turn that has `--resume` together with `--model` or `--thinking` writes `Error: --model only applies to a new session` (or the same sentence naming `--thinking`) to stderr and exits 1. It prints no stream and writes no export, but its invocation and trace are still recorded.
- (c) On a new session (`-p` without `--resume`), `--model M` sets the resolved `config.active_model` to `M`. `--thinking L` sets `config.models[<active_model>]` to `{ ...that entry if the template has one, alias: <active_model>, thinking: L }` and keeps the template's other `models` entries. `models` is an object keyed by alias, as real 3.1.3 writes it. When the turn passed either flag, remember its `active_model` and that `models` entry in a state file in the fake's directory, keyed by the export template's `session_id`.
- (d) On a resumed turn (`--resume S`), if a remembered entry exists for `S`, lay its `active_model` and `models` entry onto the resolved config, as Vibe restores a session's model and level.
- (e) `configOverride` is still laid over everything, last.
- A turn with neither flag and no remembered session must keep today's resolved config byte for byte, so every existing suite passes unchanged. Update the fake's comment block and the option docs.
- Create `tests/unit/providers/vibeModelFlags.test.ts`. Mark every test `it.fails(...)`, or `it.fails.each(...)` for a table, and give every test a distinct title.
- Drive the adapter's entries, `runVibeAgent` and `runVibeCompletion` (`src/infra/providers/mistralVibe.ts`), against `writeFakeVibe` in a fresh temporary directory per test. Copy the fixture pattern of `tests/unit/providers/mistralVibe.test.ts`: a mkdtemp root, a `phase-01` folder, transcript `output.jsonl`, and `removeTempDir` afterwards.
- Build the provider entry as `const entry = { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, executable: fake.executable }`, held in a const. Never write an object literal naming `modelEnvVar`: phase-06 removes the field.
- Use a secure policy whose `filesystem.allowWrite` and `allowRead` are `[root]`, and `exportText: vibe3ExportText(VIBE3_EXPORT_SHORT)` for every agent turn. Read each turn's argv and environment from `fake.traces()`. Assert a flag's value by adjacency (the element right after `--model`), never by absolute position.
- Test (ac-first-turn-flags): a secure first turn at `mistral-medium-3.5`/`high` answers. Its argv has `--model` followed by `mistral-medium-3.5` and `--thinking` followed by `high`, and its environment has no `VIBE_ACTIVE_MODEL`.
- Table test (ac-every-new-session), one row per session kind, each at `mistral-medium-3.5`/`off`: authoring, code-review, compliance-review and decide run `runVibeAgent` as a new session; extraction and the sealed completion run `runVibeCompletion`. For each `runVibeAgent` row, mirror the options its use case passes to the backend (`readOnly`, `security`, `answerSchema`); find them in the use cases under `src/app/` for headless authoring, code review, compliance review and decide. Each row: the call succeeds, its argv carries `--model mistral-medium-3.5` and `--thinking off`, and its environment has no `VIBE_ACTIVE_MODEL`.
- Test (ac-resume-no-flags): a secure first turn at `mistral-medium-3.5`/`high`, then a resume of that session (`VIBE3_SESSION_ID`) into a second transcript `fix-attempt-01.jsonl`. The resumed argv has `--resume` followed by the session id and neither `--model` nor `--thinking`; the resumed environment has no `VIBE_ACTIVE_MODEL`; the resumed turn answers.
- Test (ac-floor): with `version: "vibe 3.1.2"`, `runVibeAgent` fails with an `AgentInvocationError` whose message is exactly `mistral-vibe 3.1.2 is installed; phax needs 3.1.3 or later.\nUpgrade it: uv tool upgrade mistral-vibe`, and `fake.turns()` is 0. `runVibeCompletion` on a second fake of the same version refuses the same way, also with 0 turns.
- Test (ac-model-mismatch): a secure first turn at `mistral-medium-3.5`/`high` with `configOverride: { active_model: "mistral-large-4-0" }` fails with an `AgentInvocationError` whose message contains `active_model`, `"mistral-large-4-0"`, `"mistral-medium-3.5"` and the export path `<phase folder>/output.vibe-export/export.json`. The phase folder holds no `claude-session-id.txt`, so no answer was recorded.
- Test (ac-level-mismatch): a secure first turn at `mistral-medium-3.5`/`off` with `configOverride: { models: { "mistral-medium-3.5": { alias: "mistral-medium-3.5", thinking: "high" } } }` fails with an `AgentInvocationError` whose message contains `thinking`, `"high"`, `"off"` and the export path, and no session id file exists.
- Test (ac-level-absent): the same at `off`, with `configOverride: { models: { "mistral-medium-3.5": { alias: "mistral-medium-3.5" } } }`. The message contains `thinking`, `absent`, `"off"` and the export path, and no session id file exists.
- Check that each test fails today on its own assertion, never on a missing module or type: today no flag is passed, `VIBE_ACTIVE_MODEL` is set from the default entry's `modelEnvVar`, the floor is 3.0.3, and no model or level is compared. To read a failure, run `pnpm test:unit` with one marker removed locally, then restore it.
- Change no source file. The existing suites (`pnpm test:unit`, `pnpm test:integration`) must stay green with the extended fake.

### Planned files to create

- `tests/unit/providers/vibeModelFlags.test.ts`

### Planned files to edit

- `tests/helpers/vibe3Fixtures.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: the Vibe adapter (`runVibeAgent`, `runVibeCompletion`). Consumer: Vibe 3.1.3, stood in for by the fake. Contract: a new session's argv carries `--model <catalog model>` and `--thinking <resolved effort>`; a resumed one carries neither; no headless environment holds `VIBE_ACTIVE_MODEL`; a turn refused after the fact is an `AgentInvocationError` naming the field, the reported value (or `absent`), the value phax set and the export path, and it records no session id.

### Test strategy

- a secure phase's first turn at mistral-medium-3.5/high passes --model mistral-medium-3.5 and --thinking high and no VIBE_ACTIVE_MODEL — medium · example · fake vibe's recorded argv and environment · acceptance · ac-first-turn-flags
- authoring, code-review, compliance-review, decide, extraction and sealed-completion sessions each pass --model mistral-medium-3.5 --thinking off and no VIBE_ACTIVE_MODEL — medium · table · fake vibe's recorded argv and environment per row · acceptance · ac-every-new-session
- a resumed turn passes --resume with the session id and neither --model nor --thinking, and no VIBE_ACTIVE_MODEL — medium · example · fake vibe's recorded argv and environment of the resumed turn · acceptance · ac-resume-no-flags
- a vibe printing 3.1.2 is refused with the exact floor message and no session process is spawned, for agent turns and completions — medium · example · exact refusal text and zero recorded turns · acceptance · ac-floor
- a confined turn whose export reports active_model mistral-large-4-0 is refused naming active_model, both values and the export path, and records no answer — medium · example · AgentInvocationError message and absent session id file · acceptance · ac-model-mismatch
- a confined turn resolved at off whose export reports thinking high for mistral-medium-3.5 is refused naming the level, both values and the export path — medium · example · AgentInvocationError message and absent session id file · acceptance · ac-level-mismatch
- a confined turn whose export holds no thinking level for the active alias is refused naming the level as absent, the value set and the export path — medium · example · AgentInvocationError message and absent session id file · acceptance · ac-level-absent

### Implementation order

1. Extend the fake vibe and confirm the existing suites stay green
2. Write the acceptance tests with their markers
3. Confirm each fails today on its own assertion, then restore every marker

### Excluded scope

- Any change under `src/`
- Updating existing Vibe tests (phase-04)
- The real-CLI e2e (phases 04 and 07)

### Verification

The `standard` gate profile of `phax.json`; the acceptance provider judges both files with its `authored` verdict.

### Expected handoff content

Describe the fake's new behaviour (flag resolution, the remembered-session state file and its key, the resume refusal and the default version), each test's title with its criterion, and the option shape used for each session-kind row and where it came from. Explain any file-plan deviation.

### Commit subject

`test(vibe): acceptance tests for --model/--thinking and the post-turn model and level check`

### Commit body

Extend the fake vibe to behave like Vibe 3.1.3. --model and --thinking set config.active_model and config.models[alias].thinking on a new session, a resume restores them, and --model on a resume exits 1. The default version is 3.1.3. Add expected-failure acceptance tests: new sessions of every kind carry the two flags, resumed turns carry neither, no headless turn carries VIBE_ACTIVE_MODEL, a vibe older than 3.1.3 is refused before spawning, and a confined turn under another model or level, or with no level, is refused. The next phase removes the markers.

---

## phase-04 — Pick the Vibe model and level by flag and check both after each confined turn {#phase-04-vibe-flags}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The post-turn check adds two comparisons whose resumed-turn behaviour rests on a frozen fake. The change also shifts the argv, environment and version floor under every Vibe suite (unit, integration, snapshot, e2e), and each must be updated without loosening a check.

Every new headless Vibe session runs with `--model <model> --thinking <effort>`, resumed turns pass neither, no headless turn sets or inherits `VIBE_ACTIVE_MODEL`, Vibe older than 3.1.3 is refused before spawning, and a confined turn whose export shows another model or thinking level, or no level, is refused.

### Detailed instructions

- `src/infra/providers/mistralVibe.ts`: remove `modelEnvVar` from `VibeProviderEntry`. In `buildVibeArgs`, when `resumeSessionId` is undefined, insert `"--model", options.model, "--thinking", options.effort` right after `...flags.agent` and before `"--output"`; on a resume insert neither. Replace the comment that says the model goes through `modelEnvVar` with one that states the rule, including that Vibe refuses `--model` on a resume.
- `runVibeCompletion`: build its argv as `-p <prompt>`, `...flags.agent`, `--model options.model --thinking options.effort`, `--output streaming`, `...flags.scope`. A sealed completion is always a new session.
- `spawnVibe`: drop the `modelAlias` parameter. Its environment is `process.env` with any `VIBE_ACTIVE_MODEL` removed, then `envAdditions`. Add a comment saying an inherited variable is dropped so that only `--model` chooses the model.
- Version floor: set `MIN_VIBE_VERSION` to 3.1.3 and `MIN_VIBE_VERSION_TEXT` to `3.1.3`. The comment above them now gives the reason: the first release whose headless new sessions take `--model` and `--thinking`. Update `requireSupportedVibe`'s doc comment. The refusal sentences stay the same apart from the version.
- Post-turn check: pass `{ model: options.model, thinking: options.effort }` to `vibeConfigMismatch` for new and resumed turns alike. The refusal sentence that wraps the mismatch is unchanged.
- `src/domain/session/vibeFlags.ts`: give `vibeConfigMismatch` a third parameter, `selection: { readonly model: string; readonly thinking: string }`. Keep its early return for unconfined sessions, and keep the existing confinement comparisons first and unchanged.
- Then compare `config.active_model` with `selection.model`, giving `active_model is <shown>, phax set "<model>"`.
- Only when `active_model` matches, read `config.models`. When it is a plain object (not an array), take its entry `[selection.model]`; when that entry is an object, take its `thinking`. Compare that value with `selection.thinking`, giving `thinking of <model> is <shown>, phax set "<thinking>"`. Anything missing along that path shows as `absent` through the existing `shown` helper.
- Update the file's header comment and the function's doc comment. `buildVibeFlags`, `buildSealedVibeFlags` and the confinement stay unchanged.
- Remove the `it.fails` markers from `tests/unit/providers/vibeModelFlags.test.ts`; that is its only change. Never edit `tests/helpers/vibe3Fixtures.ts`: it is a frozen acceptance test file of this pair.
- Update `tests/unit/providers/mistralVibe.test.ts`:
- - Drop `modelEnvVar` from `baseEntry` and `entryOf`.
- - Replace the test titled `does not pass --target or the model alias (selection is env-only)` with one asserting that a new session carries the `--model`/`--thinking` pair and no `--target`.
- - Make the argv-order test expect the pair right after the agent flags, and only on a new session.
- - Expectations that `VIBE_ACTIVE_MODEL` is `mistral-large` become expectations that it is absent.
- - The floor tests refuse `vibe 3.1.2` with the 3.1.3 text and accept `vibe 3.1.3`, `vibe 3.1.4`, `vibe 3.2.0` and `vibe 4.0.0`.
- - A confined resumed turn with no first turn in the same fake now has no remembered level. Run the first turn in that fake, or align the options' model with the template's `mistral-medium-3.5` and give the level through `configOverride`. Never loosen the check.
- `tests/unit/session/vibeFlags.test.ts`: add the selection argument to every `vibeConfigMismatch` call, and add a table test over the model/level cases: match; `active_model` differs; `models` missing; `models` an array; entry missing; `thinking` missing; `thinking` differs; an unconfined session ignored.
- Integration suites that drive the fake through a run (`tests/integration/protectedPathsAdditive.test.ts`, `tests/integration/protectedPathsNativeRules.test.ts`, `tests/integration/providerSessionFailures.test.ts`, `tests/integration/stopTranscripts.test.ts`): update whatever the change shifts — the argv pair, `VIBE_ACTIVE_MODEL` no longer in the environment, and the floor. Edit `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap` by hand, changing only the lines this change shifts: the gate runs vitest without `-u`.
- `tests/e2e/vibeSecure.test.ts` is not run. Only keep it compiling and consistent: drop `modelEnvVar` from its entry literals, use model `mistral-medium-3.5`, and make its version guard require 3.1.3. Phase-07 rewrites the rest.
- In `scripts/generate-model-catalog.ts`, the model-routing skill's file-tree line `mistralVibe.ts ← vibe spawn logic (VIBE_ACTIVE_MODEL env)` now says `(--model/--thinking flags)`. Run `pnpm gen:model-catalog` and commit the regenerated skill.
- In-phase tests in `tests/unit/providers/mistralVibe.test.ts`:
- - (ac-model-match) After a first turn at `mistral-medium-3.5`/`high`, a confined resumed turn whose export reports that model and level is accepted, and its answer and session id are returned.
- - With `VIBE_ACTIVE_MODEL` stubbed in phax's environment (`vi.stubEnv`, then `vi.unstubAllEnvs`), neither an agent turn nor a sealed completion sees it.
- - The floor boundary cases.

### Planned files to create

- (none)

### Planned files to edit

- `src/infra/providers/mistralVibe.ts`
- `src/domain/session/vibeFlags.ts`
- `scripts/generate-model-catalog.ts`
- `.claude/skills/model-routing/SKILL.md`
- `tests/unit/providers/vibeModelFlags.test.ts`
- `tests/unit/providers/mistralVibe.test.ts`
- `tests/unit/session/vibeFlags.test.ts`
- `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap`
- `tests/e2e/vibeSecure.test.ts`

### Optional files that may be edited

- `tests/integration/protectedPathsAdditive.test.ts`
- `tests/integration/protectedPathsNativeRules.test.ts`
- `tests/integration/providerSessionFailures.test.ts`
- `tests/integration/stopTranscripts.test.ts`
- `src/schemas/vibeExport.ts`
- `src/infra/providers/dispatcher.ts`

### Boundary contracts

Infra → Vibe CLI: the adapter produces the argv and environment and Vibe consumes them; Vibe produces `export.json` and the adapter consumes `config.active_model` and `config.models[<alias>].thinking`. Infra → domain: the adapter hands the decoded `config` and the session's resolved `{ model, thinking }` to `vibeConfigMismatch`, which returns the first mismatch as text, or undefined. Port: `AgentRunOptions`/`CompletionOptions` already carry `model` and `effort`, and their shape does not change.

### Test strategy

- a confined resumed turn whose export reports the model and level phax resolved for the session is accepted with its answer — medium · example · runVibeAgent answer and returned session id · in-phase · ac-model-match
- vibeConfigMismatch returns the expected text for every model and level case and none for a match or an unconfined session — small · table · expected mismatch strings per case · in-phase · ac-level-absent
- an inherited VIBE_ACTIVE_MODEL never reaches a headless turn or a sealed completion — medium · example · fake vibe's recorded environment · in-phase · ac-every-new-session
- 3.1.2 is refused and 3.1.3, 3.1.4, 3.2.0 and 4.0.0 are accepted — medium · boundary · floor refusal text or a spawned turn · in-phase · ac-floor
- the confinement suites and their snapshot show the flag pair on new turns only and no VIBE_ACTIVE_MODEL — medium · example · updated argv and environment snapshot · in-phase

### Implementation order

1. `vibeConfigMismatch` with its selection parameter and table test
2. Adapter argv, completion argv, spawn environment and floor
3. Remove the acceptance markers
4. Update the existing unit and integration suites and the snapshot
5. Keep the e2e compiling
6. Generator text, then `pnpm gen:model-catalog`

### Excluded scope

- Removing `modelEnvVar` from the provider-config schema, the defaults or the fresh-start command (phase-06)
- The fresh-start note (phase-09)
- The full e2e rewrite (phase-07)
- Any change to the secure confinement

### Verification

The `standard` gate profile of `phax.json`; the acceptance provider judges `tests/unit/providers/vibeModelFlags.test.ts` and `tests/helpers/vibe3Fixtures.ts` with its `passed` verdict.

### Expected handoff content

Give the new `vibeConfigMismatch` signature and the exact mismatch texts, and where the flag pair sits in each argv. State how an inherited `VIBE_ACTIVE_MODEL` is dropped. List every existing test changed and why, especially resumed-turn tests that needed a first turn, and the snapshot lines edited by hand. Say what was changed in the e2e and what phase-07 still owes. Explain any file-plan deviation.

### Commit subject

`feat(vibe): choose model and thinking level with --model/--thinking and check both after each turn`

### Commit body

New headless Vibe sessions (phase turns, read-only sessions, extraction and sealed completions) pass --model and --thinking from the resolved routing. Resumed turns pass neither, since Vibe keeps the session's model and level and refuses --model on a resume. phax no longer sets or passes on VIBE_ACTIVE_MODEL on headless turns. The version floor moves to 3.1.3. After a confined turn, phax compares the export's config.active_model and config.models[active_model].thinking with what it resolved, and refuses a turn that ran under another model or level, or that reports no level.

---

## phase-05 — Acceptance tests for refusing and rewriting pre-upgrade providers.json and model-routing.json {#phase-05-upgrade-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-06
**Acceptance test files:** `tests/integration/vibeProviderUpgrade.test.ts`

Write, as failing acceptance tests through the loaders and `phax agent setup providers`, how an older config is handled. A providers.json carrying `modelEnvVar` is refused by name. One `--write` lists `mistral-medium-3.5` in place of the alias ids, drops the field and makes the file load. A model-routing.json keyed on a retired id is refused, naming its replacement.

### Detailed instructions

- Create `tests/integration/vibeProviderUpgrade.test.ts`. Mark every test `it.fails(...)` and give every test a distinct title.
- Isolate the PHAX home exactly as `tests/integration/agentGroupJson.test.ts` does: `vi.mock("node:os", …isolatedOs…)` from `tests/helpers/isolatePhaxHome.ts`, so that `PROVIDER_CONFIG_PATH` and `MODEL_ROUTING_PATH` point into a temporary home. Write the input files with `node:fs` and clean them up per test.
- Run the command through the runner: copy that file's `group()` (a fake Shell on which `claude` and `vibe` are found and `codex` is not, over `NodeFileSystemLayer`) and its `call()` (`runnerCall` from `tests/helpers/runnerCall.ts`). Load the configs with `loadProviderConfig()` and `loadModelRouting()` (`src/app/loadRouting.ts`) provided with `NodeFileSystemLayer`, and use `Effect.flip` for a refusal.
- Fixtures: the §6 `before` mistral-vibe entry, with `enabled: true`, `executable: "vibe"`, `modelEnvVar: "VIBE_ACTIVE_MODEL"`, `defaultAgent: "auto-approve"`, and family `mistral-medium` listing `phax-mistral-medium-3.5-off` (efforts `["off"]`) and `phax-mistral-medium-3.5-high` (efforts `["high"]`), both `active`. Put it beside a `claude-code` entry copied from `DEFAULT_PROVIDER_CONFIG`.
- Test (ac-env-refused): a providers.json whose mistral-vibe entry is the §6 `after` entry (family listing only `mistral-medium-3.5` with efforts off and high) plus `"modelEnvVar": "VIBE_ACTIVE_MODEL"`. `loadProviderConfig()` fails, and its message contains `providers.mistral-vibe.modelEnvVar` and `phax agent setup providers --write`.
- Test (ac-successor): a providers.json with the `before` entry minus `modelEnvVar`. Run `agent setup providers --write`; it exits 0. The rewritten file's `providers["mistral-vibe"].families["mistral-medium"].models` equals exactly `[{ id: "mistral-medium-3.5", efforts: ["off", "high"], status: "active" }]`. The printed text names `phax-mistral-medium-3.5-off` and `phax-mistral-medium-3.5-high`, and once both of those ids are removed from it, the text still contains `mistral-medium-3.5`. A file named `providers.json.phax-backup-*` exists beside it.
- Test (ac-one-command): a providers.json with the full `before` entry, `modelEnvVar` included. Run `agent setup providers --write`. Afterwards the rewritten mistral-vibe entry has no `modelEnvVar` key and its family lists `mistral-medium-3.5`, the printed text contains `providers.mistral-vibe.modelEnvVar`, and `loadProviderConfig()` then succeeds.
- Test (ac-routing-file): a model-routing.json equal to `DEFAULT_MODEL_ROUTING` plus an equivalence key `phax-mistral-medium-3.5-high` holding `{ high: { claude: "claude-sonnet-4-6", effort: "high", relation: "equivalent" } }`. `loadModelRouting()` fails with a `ConfigValidationError` whose message contains `phax-mistral-medium-3.5-high`, and which, once every `phax-mistral-medium-3.5-high` is removed from it, still contains `mistral-medium-3.5`.
- Never assert the final wording beyond these names: §10 leaves the sentences open.
- Check that each test fails today on its own assertion: today `modelEnvVar` is accepted, the rewrite drops the emptied family and keeps the field, and the routing loader checks no key. To read a failure, run `pnpm test:integration` with one marker removed locally, then restore it.
- Change no source file and no other test.

### Planned files to create

- `tests/integration/vibeProviderUpgrade.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producers: `loadProviderConfig`, `loadModelRouting` and the `agent setup providers` command. Consumer: an operator upgrading phax with an older `~/.phax/providers.json` or `~/.phax/model-routing.json`. Stable contract: a refusal names each offending field path or id and its one fix, and the rewrite leaves a file the loader accepts.

### Test strategy

- a providers.json whose mistral-vibe entry carries modelEnvVar is refused naming providers.mistral-vibe.modelEnvVar and phax agent setup providers --write — medium · example · ConfigValidationError message · acceptance · ac-env-refused
- setup providers --write lists exactly the mistral-medium-3.5 entry in place of the two alias ids, names the dropped ids and the successor, and writes a backup — medium · example · rewritten file, printed text and backup file · acceptance · ac-successor
- one --write of a pre-upgrade providers.json drops modelEnvVar, lists mistral-medium-3.5, names the dropped field, and leaves a file the loader accepts — medium · example · rewritten file, printed text and a successful load · acceptance · ac-one-command
- a model-routing.json keyed on phax-mistral-medium-3.5-high is refused naming it and mistral-medium-3.5 — medium · example · ConfigValidationError message · acceptance · ac-routing-file

### Implementation order

1. Write the isolated-home harness and the fixtures
2. Write the four `it.fails` tests
3. Confirm each fails today on its own assertion, then restore every marker

### Excluded scope

- Any change under `src/`
- The JSON field names of `--json` (asserted in phase-06's in-phase tests)
- The fresh start and its note (phases 06 and 09)

### Verification

The `standard` gate profile of `phax.json`; the acceptance provider judges the file with its `authored` verdict.

### Expected handoff content

Give each test's title with its criterion, the fixture shapes, and how the harness isolates the PHAX home and runs the command, so that phase-06 knows exactly which loader and command paths are exercised. Explain any file-plan deviation.

### Commit subject

`test(routing): acceptance tests for refusing and rewriting pre-upgrade provider and routing files`

### Commit body

Add expected-failure acceptance tests through the loaders and phax agent setup providers. A providers.json carrying modelEnvVar is refused by name. One --write replaces the phax alias ids with mistral-medium-3.5, drops the field, writes a backup and leaves a file that loads. A model-routing.json keyed on a retired alias id is refused, naming mistral-medium-3.5 as the key to use. The next phase removes the markers.

---

## phase-06 — Refuse and rewrite pre-upgrade providers.json and model-routing.json, and drop modelEnvVar {#phase-06-config-upgrade}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** One coherent change crosses the schema, the app loaders, a domain rewrite rule, the CLI answer and the stop plumbing, with a hand-edited behaviour corpus. The refusal order and the lenient-only-for-setup read must be designed so that no loader becomes lenient.

An older `providers.json` or `model-routing.json` is refused by name and fixed by one documented step, never read leniently. `modelEnvVar` leaves the provider schema and every place that used it, so the review-stop fresh start names `VIBE_ACTIVE_MODEL` itself.

### Detailed instructions

- `src/schemas/providerConfig.ts`: remove `modelEnvVar` from the provider entry schema, with no shim. The strict decode then refuses it as an unexpected key.
- `src/domain/routing/defaults.ts`: remove `modelEnvVar` from the `mistral-vibe` entry. Add `RETIRED_MODEL_SUCCESSORS`, mapping each of the five retired `phax-mistral-medium-3.5-*` ids to `mistral-medium-3.5`.
- `src/domain/routing/providerSetup.ts`: when `withoutRetiredModels` removes from a family a retired id that has a successor, it puts the successor's built-in catalog entry (from `DEFAULT_PROVIDER_CONFIG`, same provider and family) where the first retired id stood, unless the family already lists that id. A family that still ends empty is dropped, as today.
- `ProviderConfigPlan` gains `retiredReplaced` (the successor ids listed, each once, in config order) and `fieldsDropped`.
- Add pure functions over the raw JSON: `obsoleteProviderFields(raw: unknown)`, returning `{ path, reason }` for each `providers.<key>` object that carries `modelEnvVar` (path `providers.<key>.modelEnvVar`, reason `phax picks the Vibe model with --model`), and a function returning the raw value with those fields removed. Also add `retiredEquivalenceKeys(routing)`, returning the equivalence keys found in `RETIRED_MODEL_IDS`.
- `src/app/loadRouting.ts`: factor the file read and `JSON.parse` (with today's messages) into one helper.
- `loadProviderConfig` checks in this order. (1) Obsolete fields refuse with `"<path>" carries fields phax no longer reads:` followed by one `  - <field path>: <reason>` line per field, then `Run \`phax agent setup providers --write\` to drop them, or delete them from the file.`. (2) The strict decode. (3) The existing retired-id refusal.
- `readProviderConfigFile`, which only `phax agent setup providers` uses, strips the obsolete fields before decoding and returns them with the config.
- `loadModelRouting`, after its decode, refuses retired keys with `"<path>" keys equivalence edges on models phax no longer routes to:` and one line per key: `  - <id>: use mistral-medium-3.5` when the key has a successor, `  - <id>: <reason>` otherwise. The last line is `Rename the key, keeping its edges, or delete the file to use phax's built-in table.`.
- `src/app/providerSetup.ts`: carry the dropped fields into the plan and the result. The written file is the plan's config, which no longer has the field.
- `src/cli/definitions/agent.ts` (`setup providers`): add `retiredReplaced` and `fieldsDropped` (string arrays) to the output schema.
- After the dropped-models line, render `Listed in their place: <ids>` and `Dropped fields phax no longer reads (<n>): <paths>`; on a dry run these read `Would list in their place: …` and `Would drop fields phax no longer reads …`.
- Update the file header comment.
- Remove the `modelEnvVar` plumbing. `src/domain/session/types.ts` drops `FreshStartCommandOpts.modelEnvVar`. `src/domain/session/mistral.ts` sets `env: { VIBE_ACTIVE_MODEL: opts.model }`, with a comment that Vibe's TUI takes no `--model`, so the variable is the only way to set the model there. `src/app/interactiveStop.ts` and `src/app/enterPhase.ts` stop passing the field; update the `providerEntry` doc comment of `HeldStopInput`.
- Remove the `it.fails` markers from `tests/integration/vibeProviderUpgrade.test.ts`; that is its only change.
- Update the existing tests:
- - `tests/unit/routing/loadRouting.test.ts` and `tests/unit/routing/providerSetup.test.ts`: the new refusals, the successor and the new plan fields.
- - `tests/unit/cli/agent.test.ts` and `tests/integration/agentGroupJson.test.ts`: the providers answer has the two new fields.
- - `tests/integration/declaredStop.test.ts`: the vibe `providerEntry` has no `modelEnvVar`, and the in-phase ac-fresh-start assertion is added there.
- - `tests/unit/continueCommands.test.ts` and `tests/integration/providerSessionFailures.test.ts`: drop the entry literals' `modelEnvVar`.
- - `tests/behaviourCorpus/cases/config/provider-config.json`: remove `modelEnvVar` from the inputs and decoded expectations of cases not about it, and remove `"modelEnvVar"` from the unexpected-key refusal's list of expected keys. Follow CONTRIBUTING.md, section `The behaviour corpus`: the expectations are edited by hand because the decoder's behaviour changed.
- Run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit what they change (generated files are never edited by hand).
- In-phase tests: a table for the obsolete-field detection (no `providers`, a non-object entry, several providers, a field on `claude-code` too); the successor listed once when the family already lists it or both aliases retire, and in the first retired id's position; the `--json` answer's `retiredReplaced` and `fieldsDropped` and the dry run's `Would` lines; a routing key `phax-mistral-medium-3.5-max` refused naming `mistral-medium-3.5`; and in `declaredStop.test.ts` (ac-fresh-start), a Vibe stop at `mistral-medium-3.5`/`off` whose fresh-start command has env exactly `{ VIBE_ACTIVE_MODEL: "mistral-medium-3.5" }` and an argv with neither `--model` nor `--thinking`.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/providerConfig.ts`
- `src/domain/routing/defaults.ts`
- `src/domain/routing/providerSetup.ts`
- `src/app/loadRouting.ts`
- `src/app/providerSetup.ts`
- `src/cli/definitions/agent.ts`
- `src/domain/session/types.ts`
- `src/domain/session/mistral.ts`
- `src/app/interactiveStop.ts`
- `src/app/enterPhase.ts`
- `tests/integration/vibeProviderUpgrade.test.ts`
- `tests/unit/routing/loadRouting.test.ts`
- `tests/unit/routing/providerSetup.test.ts`
- `tests/unit/cli/agent.test.ts`
- `tests/integration/agentGroupJson.test.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/unit/continueCommands.test.ts`
- `tests/integration/providerSessionFailures.test.ts`
- `tests/behaviourCorpus/cases/config/provider-config.json`

### Optional files that may be edited

- `docs/cli/reference.md`
- `phax.usage.kdl`
- `README.md`
- `tests/unit/sessionAdapters.test.ts`
- `tests/unit/providers/mistralVibe.test.ts`
- `tests/unit/interactive/commandLine.test.ts`
- `tests/unit/routing/schemas.test.ts`
- `src/infra/providers/mistralVibe.ts`

### Boundary contracts

Schema → app: the strict provider schema no longer has `modelEnvVar`. Only `readProviderConfigFile` (used by `agent setup providers`) sees the raw field, through the pure domain function, and only to strip and report it. Domain → app → CLI: `ProviderConfigPlan` gains `retiredReplaced` and `fieldsDropped`, which the use case returns and the command renders and answers under `--json`. Domain → app (stop): `FreshStartCommandOpts` loses `modelEnvVar`, and the Vibe adapter names `VIBE_ACTIVE_MODEL` itself. The persisted stop command stays `{ cwd, argv, env }`.

### Test strategy

- obsolete-field detection finds every providers.<key>.modelEnvVar and nothing else across raw shapes — small · table · expected field paths per raw input · in-phase · ac-env-refused
- the rewrite lists the successor once, in the first retired id's place, also when the family already lists it — small · example · planned config and retiredReplaced · in-phase · ac-successor
- setup providers --json answers retiredReplaced and fieldsDropped, and a dry run says what it would list and drop — medium · example · decoded JSON answer and printed lines · in-phase · ac-one-command
- a model-routing.json keyed on phax-mistral-medium-3.5-max is refused naming mistral-medium-3.5 — small · example · ConfigValidationError message · in-phase · ac-routing-file
- a Vibe stop's fresh-start command sets VIBE_ACTIVE_MODEL to mistral-medium-3.5 and passes neither --model nor --thinking — medium · example · review-stop fresh-start command · in-phase · ac-fresh-start
- the provider-config corpus cases replay with modelEnvVar gone from the schema — small · table · hand-edited case expectations · in-phase

### Implementation order

1. Domain: successors, obsolete fields, retired keys, plan fields
2. Schema: drop `modelEnvVar`
3. App: loaders and the setup use case
4. CLI: providers output and render
5. Stop plumbing: types, Vibe adapter, `interactiveStop`, `enterPhase`
6. Remove the acceptance markers, update the tests and the corpus
7. Regenerate the usage spec and the CLI docs

### Excluded scope

- The fresh-start level note (phase-09)
- Removing `phax agent setup mistral-vibe` (phase-09)
- Scaffolding or rewriting `model-routing.json` for the user
- Docs prose (phase-10)

### Verification

The `standard` gate profile of `phax.json`; the acceptance provider judges `tests/integration/vibeProviderUpgrade.test.ts` with its `passed` verdict.

### Expected handoff content

Give the exact refusal texts of both loaders, the names and module of the new domain functions, `RETIRED_MODEL_SUCCESSORS`, the new `--json` fields and text lines, and the new `buildFreshStartCommand` environment. Say which corpus cases changed and how, and what the regeneration changed. Explain any file-plan deviation.

### Commit subject

`feat(routing): refuse and rewrite pre-upgrade providers.json and model-routing.json; drop modelEnvVar`

### Commit body

modelEnvVar leaves the provider schema. A providers.json carrying it is refused by its field path, naming phax agent setup providers --write, which now drops the field and reports it. The rewrite lists mistral-medium-3.5 in place of the retired phax alias ids instead of emptying the family. A model-routing.json keyed on a retired id is refused, naming mistral-medium-3.5 as the key to use. setup providers --json answers retiredReplaced and fieldsDropped. The review-stop fresh start names VIBE_ACTIVE_MODEL itself.

---

## phase-07 — Move the real-Vibe e2e off the alias path {#phase-07-vibe-e2e}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase writes a suite it cannot run: it needs PHAX_E2E_RUN=1, a real vibe and a Mistral key, and only typecheck checks it. The higher effort pays for the care a real-API test needs to be right the first time it runs.

Bring the real-CLI suite in line with the change. It needs Vibe 3.1.3 and no PHAX alias in Vibe's home, proves that a secure session runs at `mistral-medium-3.5` with `off` and with `high`, and proves that a resumed turn keeps the model and level, ready for the operator to run at review.

### Detailed instructions

- Edit `tests/e2e/vibeSecure.test.ts` only. Do not run it: it needs `PHAX_E2E_RUN=1`, a real `vibe` and a Mistral key. The gates typecheck it (`pnpm test:type`), and the operator runs `pnpm test:e2e:real` at review.
- Header comment: Vibe 3.1.3 or later on `$PATH`; no PHAX alias needed in Vibe's home; mistral-vibe enabled through `phax agent setup providers --write`; the `MISTRAL_API_KEY` cases skip without the key. List the new cases.
- Remove the import from `src/schemas/vibeConfig.ts` and `BASE_MODEL`. The loose-config case's hostile `config.toml` holds no `# Added by PHAX.` block; it still checks that the file is byte-identical afterwards.
- Every `runVibeAgent` call uses model `mistral-medium-3.5` at `off` or `high`, with an entry that has no `modelEnvVar`.
- Add the case ac-real-off-high, in its own temporary repository with a temporary `VIBE_HOME` whose `config.toml` holds no PHAX block. Like the existing key-dependent case, it needs `MISTRAL_API_KEY` and is skipped, with its reason, without one. It runs one secure session at `mistral-medium-3.5`/`off` and one at `mistral-medium-3.5`/`high`. Both complete; each turn's `export.json` (`vibeExportFileOf`) has `config.active_model` `mistral-medium-3.5` and `config.models["mistral-medium-3.5"].thinking` equal to the level set; and the `config.toml` sha256 is unchanged.
- Add the case ac-real-resume, set up the same way: start a secure session at `mistral-medium-3.5`/`high`, then resume it with its session id into a second transcript. The resumed turn's export reports `active_model` `mistral-medium-3.5` and thinking `high`, and `runVibeAgent` returns its answer, so phax accepted it.
- If removing the import leaves an export of `src/schemas/vibeConfig.ts` with no user and `pnpm knip` flags it (for example the `VibeBaseModel` type), remove that `export` keyword only. Phase-09 deletes the file.
- Update `tests/e2e/__snapshots__/semanticTrace.providers.test.ts.snap` by hand only if it still names a phax alias as a routed model.

### Planned files to create

- (none)

### Planned files to edit

- `tests/e2e/vibeSecure.test.ts`

### Optional files that may be edited

- `src/schemas/vibeConfig.ts`
- `tests/e2e/__snapshots__/semanticTrace.providers.test.ts.snap`
- `tests/e2e/helpers/providers.ts`

### Boundary contracts

Test → real Vibe 3.1.3: the suite relies on the real export carrying `config.active_model` and `config.models[<alias>].thinking`, the shape probed on 2026-11-18, and on a resume restoring both.

### Test strategy

- real Vibe 3.1.3 runs secure sessions at mistral-medium-3.5/off and /high without PHAX aliases, each export reporting the model and level phax set, with config.toml unchanged — large · smoke · real export.json fields and config.toml sha256 · in-phase · ac-real-off-high
- a real resumed turn without flags keeps mistral-medium-3.5 at high and phax accepts it — large · smoke · resumed export.json fields and the returned answer · in-phase · ac-real-resume
- a hostile VIBE_HOME config without PHAX blocks still cannot widen a session and stays byte-identical — large · smoke · stream tool-call entries and config.toml sha256 · in-phase · ac-no-vibe-write

### Implementation order

1. Header, version guard and imports
2. Move the existing cases to `mistral-medium-3.5`
3. Add the off/high case and the resume case
4. `pnpm test:type` and `pnpm knip` through the gate

### Excluded scope

- Running the e2e
- Deleting `src/schemas/vibeConfig.ts` or the installer (phase-09)
- Any change under `src/` beyond dropping an `export` keyword that knip flags

### Verification

The `standard` gate profile of `phax.json`, which typechecks the e2e; the operator runs `pnpm test:e2e:real` at review.

### Expected handoff content

List the e2e cases after the change, the skip conditions, the export fields asserted, and any `export` keyword dropped from `vibeConfig.ts`. Tell the operator plainly that the suite was not run and how to run it. Explain any file-plan deviation.

### Commit subject

`test(e2e): move the real-Vibe suite to mistral-medium-3.5 by flag`

### Commit body

The real-CLI Vibe suite needs Vibe 3.1.3 and no PHAX alias blocks. It runs secure sessions at mistral-medium-3.5 with --thinking off and high and checks each export's active_model and thinking level, and checks that a resumed turn keeps the model and level. The hostile-config case no longer writes alias blocks, and Vibe's config.toml must stay byte-identical. The suite is run by the operator at review.

---

## phase-08 — Acceptance tests for the fresh-start level note and the removed alias installer {#phase-08-stop-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-09
**Acceptance test files:** `tests/integration/vibeFreshStartNote.test.ts`, `tests/integration/vibeInstallerRemoved.test.ts`

Write, as failing acceptance tests, two things the person and operator see. A Vibe review stop prints, next to its fresh-start command, that the interactive session starts at the model's default thinking level, naming the phase's level, while the stop record keeps exactly `{ cwd, argv, env }`. And `phax agent setup mistral-vibe` no longer exists.

### Detailed instructions

- Create `tests/integration/vibeFreshStartNote.test.ts` and `tests/integration/vibeInstallerRemoved.test.ts`. Mark every test `it.fails(...)` and give every test a distinct title.
- `vibeFreshStartNote.test.ts` (ac-fresh-note) drives `stopAtDeclaredPhase` (`src/app/interactiveStop.ts`) for provider `mistral-vibe` at model `mistral-medium-3.5` and effort `off`. Its `providerEntry` is a const spread from `DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]` with `enabled: true`, and a fake backend answers the first reading. Copy into this file the minimal world of `tests/integration/declaredStop.test.ts`: the temporary git repository, worktree, run and phase folders, the run and phase status fixtures, the plan phases and sections, and the layers. Import nothing from another test file, and leave `declaredStop.test.ts` unchanged.
- Render the report with `renderStop` (`src/cli/commands/stopOutput.ts`). Find the line holding the fresh-start command (it contains `VIBE_ACTIVE_MODEL='mistral-medium-3.5'`). Some line after it and before the line starting with `    or: ` must contain `default thinking level` and `off`.
- Read the written `review-stop.json` (at `report.reviewStopPath`). Its `commands.freshStart` keys, sorted, are exactly `argv`, `cwd` and `env`; its `env` equals `{ VIBE_ACTIVE_MODEL: "mistral-medium-3.5" }`; its `argv` contains neither `--model` nor `--thinking`.
- `vibeInstallerRemoved.test.ts` (ac-setup-removed) runs the agent group through `runnerCall` (`tests/helpers/runnerCall.ts`) over `makeAgentGroup`, with a fake Shell and `NodeFileSystemLayer` under an isolated PHAX home, exactly as `tests/integration/agentGroupJson.test.ts` does.
- First test: `agent setup mistral-vibe` ends with a non-zero code, and its error output reports an unknown command naming `mistral-vibe`; check the runner's unknown-command shape in `tests/integration/cliErrors.test.ts`. Today the command exists, so this fails on that assertion, not on the exit code alone.
- Second test: the output of `agent setup --help` names `providers` and does not contain `mistral-vibe`.
- Never pin wording beyond what is given here: the note's final wording is left open by §10.
- Check that each test fails today on its own assertion (no note is printed; the command exists and is listed). To read a failure, run `pnpm test:integration` with one marker removed locally, then restore it.
- Change no source file and no other test.

### Planned files to create

- `tests/integration/vibeFreshStartNote.test.ts`
- `tests/integration/vibeInstallerRemoved.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producers: the stop use case with its renderer, and the `agent` command group. Consumers: the person reviewing a Vibe phase, and the operator. Stable contract: the printed stop places a level note next to the fresh-start command, `review-stop.json`'s command stays `{ cwd, argv, env }`, and `agent setup` has no `mistral-vibe` subcommand.

### Test strategy

- a Vibe stop at mistral-medium-3.5/off prints next to its fresh-start command that the session starts at the model's default thinking level, naming off, and its recorded command keeps exactly cwd, argv and env — medium · example · rendered stop lines and review-stop.json command · acceptance · ac-fresh-note
- phax agent setup mistral-vibe fails as an unknown command and agent setup --help lists no mistral-vibe subcommand — medium · example · runner exit code, error output and help text · acceptance · ac-setup-removed

### Implementation order

1. Copy the minimal declared-stop world and write the note test
2. Write the two installer tests
3. Confirm each fails today on its own assertion, then restore every marker

### Excluded scope

- Any change under `src/`
- The held stop's and `enter-phase`'s notes (phase-09's in-phase tests)
- The no-write check of Vibe's home (phase-09's in-phase test)

### Verification

The `standard` gate profile of `phax.json`; the acceptance provider judges both files with its `authored` verdict.

### Expected handoff content

Give each test's title with its criterion, the stop inputs used, and the exact line-search rule for the note, so that phase-09 knows where the note must be printed. Give the unknown-command shape asserted. Explain any file-plan deviation.

### Commit subject

`test(vibe): acceptance tests for the fresh-start level note and the removed alias installer`

### Commit body

Add expected-failure acceptance tests. A Vibe review stop at mistral-medium-3.5/off must print, next to its fresh-start command, that Vibe's interactive session starts at the model's default thinking level, naming off, and its recorded command must keep exactly cwd, argv and env. phax agent setup mistral-vibe must be an unknown command, missing from agent setup --help. The next phase removes the markers.

---

## phase-09 — Print the fresh-start level note and remove the Vibe alias installer {#phase-09-note-and-removal}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A Vibe review stop and `phax enter-phase` tell the person that Vibe's interactive session starts at the model's default thinking level, naming the phase's level. phax no longer has any code that reads or writes `~/.vibe/config.toml`: `phax agent setup mistral-vibe`, its use case and its TOML schema are gone.

### Detailed instructions

- Note, domain: add `freshStartNote(opts: { readonly model: string; readonly effort: string }): string | null` to `SessionAdapter` in `src/domain/session/types.ts`. `src/domain/session/mistral.ts` returns a sentence such as `Vibe's interactive mode takes no --thinking: this session starts at <model>'s default thinking level, not the phase's level (<effort>).`; `claude.ts` and `codex.ts` return null.
- Note, app: `buildStopCommands` in `src/app/interactiveStop.ts` also returns the adapter's note for the phase's model and effort, and both stop reports carry it. In `src/domain/errors.ts`, `DeclaredStopReport` and `HeldStopReport` (beside `unverifiedProvider`) gain a required `freshStartNote: string | null`. `src/cli/definitions/runOutcome.ts`'s `StopReportSchema` gains `freshStartNote: Schema.NullOr(Schema.String)` in both its `declared` and `held` variants, beside their `unverifiedProvider`.
- Note, printing: in `src/cli/commands/stopOutput.ts`, `sessionAndCloseLines` prints `    <note>` directly under the command line when the command printed is the fresh start (`commands.continue` is null) and the note is not null.
- Note, enter-phase: `src/app/enterPhase.ts` adds `info(<note>)` to the notices it returns with a fresh-start command, when the note is not null.
- Note, record: `asReviewStopCommand` and `src/schemas/reviewStop.ts` stay untouched, so no persisted format changes.
- Installer: in `src/cli/definitions/agent.ts`, delete the `mistral-vibe` command, its output schema, `aliasLines` and the `vibeSetup` import. The `setup` group lists `providers` only. Update the header comment.
- Delete `src/app/vibeSetup.ts`, `src/schemas/vibeConfig.ts`, `tests/unit/routing/vibeSetup.test.ts` and `tests/behaviourCorpus/cases/config/vibe-config.json`. In `tests/behaviourCorpus/subjects.ts`, remove the `config/vibe-config` subject entry, the `extractBaseModel` import from `src/schemas/vibeConfig.ts` and the `readTomlInput` import. In `tests/behaviourCorpus/corpus.ts`, remove `TomlInput` and `readTomlInput`. Find each by name, not by line number: the files have moved since this plan was written.
- In `tests/unit/cli/agent.test.ts`, drop the `vibeSetup` mock and the mistral-vibe tests. In `tests/integration/agentGroupJson.test.ts`, drop the `VIBE_CONFIG_PATH` import and the mistral-vibe cases, and keep every other contract it checks.
- Add `freshStartNote` beside `unverifiedProvider` in every stop-report literal in tests (`git grep -n unverifiedProvider tests/`; today that is `tests/unit/cli/run.test.ts` and `tests/integration/declaredStopProviderArgv.test.ts`, one literal each).
- Run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit what they regenerate (`phax.usage.kdl`, `docs/cli/reference.md`, the README's generated CLI region). Never edit those by hand.
- Remove the `it.fails` markers from `tests/integration/vibeFreshStartNote.test.ts` and `tests/integration/vibeInstallerRemoved.test.ts`; that is their only change.
- In-phase tests: in `tests/unit/sessionAdapters.test.ts`, a table of `freshStartNote` per adapter (Vibe names the model and level, Claude Code and Codex give null). The held stop carries and prints the same note: assert it in the suite that already drives `stopAtHeldPhase` (`git grep -n stopAtHeldPhase tests/`). `enter-phase`'s fresh start for Vibe returns the note as an info notice (`tests/unit/cli/enterPhase.test.ts`).
- Create `tests/integration/vibeHomeUntouched.test.ts` (ac-no-vibe-write). Run a Vibe phase to its review stop with the fake vibe, modelling the harness on the Vibe case of `tests/integration/stopTranscripts.test.ts`. Stub `VIBE_HOME` (`vi.stubEnv`, unstubbed after) to a temporary directory holding a `config.toml`, using `it.each` over one with a `# Added by PHAX.` `[[models]]` block and one without. List every file path and its sha256 under `VIBE_HOME` before and after: the listings are equal, and no `*.phax-backup-*` file exists.

### Planned files to create

- `tests/integration/vibeHomeUntouched.test.ts`

### Planned files to edit

- `src/domain/session/types.ts`
- `src/domain/session/mistral.ts`
- `src/domain/session/claude.ts`
- `src/domain/session/codex.ts`
- `src/app/interactiveStop.ts`
- `src/app/enterPhase.ts`
- `src/domain/errors.ts`
- `src/cli/definitions/runOutcome.ts`
- `src/cli/commands/stopOutput.ts`
- `src/cli/definitions/agent.ts`
- `src/app/vibeSetup.ts`
- `src/schemas/vibeConfig.ts`
- `tests/unit/routing/vibeSetup.test.ts`
- `tests/behaviourCorpus/cases/config/vibe-config.json`
- `tests/behaviourCorpus/subjects.ts`
- `tests/behaviourCorpus/corpus.ts`
- `tests/unit/cli/agent.test.ts`
- `tests/integration/agentGroupJson.test.ts`
- `tests/unit/sessionAdapters.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/integration/vibeFreshStartNote.test.ts`
- `tests/integration/vibeInstallerRemoved.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `tests/unit/cli/enterPhase.test.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/integration/stopRecords.test.ts`
- `tests/unit/cli/runnerCommandContracts.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `docs/cli/inventory.md`

### Boundary contracts

Domain → app: the `SessionAdapter` port of the session adapters gains `freshStartNote`, which every adapter implements. App → CLI: both stop reports carry `freshStartNote: string | null`, which `stopOutput` prints and the `--json` stop report encodes. The persisted `review-stop.json` and its `{ cwd, argv, env }` commands are unchanged. CLI: the `agent setup` group loses its `mistral-vibe` command; its other commands' answers are unchanged.

### Test strategy

- each session adapter's fresh-start note names Vibe's model and the phase's level, and is null for Claude Code and Codex — small · table · expected note per adapter · in-phase · ac-fresh-note
- a held Vibe stop and enter-phase's Vibe fresh start carry and print the same note — medium · example · held stop report, printed lines and enter-phase notices · in-phase · ac-fresh-note
- running a Vibe phase to its review stop creates or modifies no file under VIBE_HOME and leaves no phax backup, with or without PHAX alias blocks — medium · example · VIBE_HOME path and sha256 listing before and after · in-phase · ac-no-vibe-write
- the agent group's remaining commands answer as before once mistral-vibe setup is gone — medium · example · runner output of agentGroupJson contracts · in-phase · ac-setup-removed

### Implementation order

1. Adapter port method and the three adapters
2. Stop reports, run outcome schema, stop renderer, enter-phase notice
3. Remove the installer: command, use case, schema, tests, corpus subject
4. Remove the acceptance markers and update the report literals
5. Regenerate the usage spec and CLI docs
6. The Vibe-home test

### Excluded scope

- Editing, deleting or reporting the user's PHAX alias blocks
- Any `--model`/`--thinking` support in Vibe's TUI, or Vibe interactive resume
- Any change to `review-stop.json` or another persisted format
- Docs prose (phase-10)

### Verification

The `standard` gate profile of `phax.json`; the acceptance provider judges `tests/integration/vibeFreshStartNote.test.ts` and `tests/integration/vibeInstallerRemoved.test.ts` with its `passed` verdict.

### Expected handoff content

Give the note's exact wording and where it prints (stop and enter-phase), the new report field and its `--json` encoding, the files deleted, the corpus subject removed, and what the regeneration changed. Confirm that no code under `src/` still names `~/.vibe/config.toml` (except the existing `accept-edits.toml` confinement check). Explain any file-plan deviation.

### Commit subject

`feat(vibe): note the TUI's default thinking level at review stops; remove the alias installer`

### Commit body

A Vibe review stop and phax enter-phase now say, next to the fresh-start command, that Vibe's interactive session starts at the model's default thinking level and not at the phase's level. The note is carried on the stop report, and review-stop.json is unchanged. phax agent setup mistral-vibe is removed with its use case and TOML schema, so phax no longer reads or writes ~/.vibe/config.toml to choose a model. The usage spec and CLI docs are regenerated.

---

## phase-10 — Document Vibe's model flags, the 3.1.3 floor and the upgrade steps {#phase-10-vibe-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An operator turning on Mistral Vibe, or upgrading a setup that used the PHAX alias blocks, finds in the docs how phax picks Vibe's model and level, the 3.1.3 floor, the one rewrite command, and how to remove the old blocks by hand.

### Detailed instructions

- `docs/model-routing.md`, the Mistral Vibe setup section (the spec's §11 docs page):
- - Replace the installer step with `uv tool upgrade mistral-vibe` (phax needs 3.1.3 or later) and `phax agent setup providers --write` (enables vibe, lists `mistral-medium-3.5`, drops `modelEnvVar` and the old alias ids).
- - Show that each new session runs `vibe -p … --agent accept-edits --model mistral-medium-3.5 --thinking high --output streaming …` and that nothing in `~/.vibe/config.toml` is needed or touched.
- - State that a resumed turn passes neither flag, and that phax refuses a confined turn whose export reports another `active_model` or thinking level.
- - Note that a review stop's fresh start sets `VIBE_ACTIVE_MODEL=mistral-medium-3.5` and starts at the model's default level.
- `docs/model-routing.md` elsewhere: the equivalence examples are keyed on `mistral-medium-3.5` with `off` and `high`; the providers example drops `modelEnvVar`; the command list no longer shows the installer; and a routing table still keyed on an old id is refused, with the rename that fixes it.
- `docs/model-catalog.md`: list `mistral-medium-3.5` (efforts `off`, `high`) in place of `phax-mistral-medium-3.5-{off,high}`, and add a change-log line dated 2026-11-18 saying that the alias ids are retired and Vibe is driven with `--model`/`--thinking`.
- `README.md`, Vibe setup: drop the `phax agent setup mistral-vibe --install-model-aliases` line, and state the 3.1.3 floor with `uv tool upgrade mistral-vibe`. Leave the generated CLI region between `<!-- BEGIN GENERATED CLI REFERENCE -->` and `<!-- END GENERATED CLI REFERENCE -->` untouched.
- `docs/security.md`, the Mistral Vibe section: its line saying Vibe 3.0.3 or later is required now says 3.1.3 or later (`uv tool upgrade mistral-vibe`). Change nothing else there.
- `docs/upgrading.md`: 0.40.0 is released, and the version is `package.json`'s opened version, 0.41.0. Create a new `### 0.41.0` section at the top of "Release by release", directly above the existing `### 0.40.0`, and leave every existing section as it is, in its order:
- - phax picks the Vibe model with `--model` and `--thinking` and needs mistral-vibe 3.1.3 (`uv tool upgrade mistral-vibe`).
- - Run `phax agent setup providers --write` once: it lists `mistral-medium-3.5` in place of `phax-mistral-medium-3.5-off` and `-high` and drops `modelEnvVar`, and phax refuses the old file until you do.
- - A `model-routing.json` keyed on the old ids is refused: rename each key to `mistral-medium-3.5`, keeping its edges.
- - `phax agent setup mistral-vibe` is gone and phax no longer reads `~/.vibe/config.toml`. The `# Added by PHAX.` blocks still work in your own Vibe sessions; to remove them, delete each comment line and the `[[models]]` table under it.
- - Run, phase and authoring records written before keep the old model ids.
- - End the section with `No step is needed in a repository.`: every step above is on the operator's machine (Vibe, `~/.phax`), none in a repository.
- Earlier upgrade entries and archived specs or plans that mention the installer stay as history: do not edit them.
- Write plain, factual prose that matches each page's existing style. Run no generator: no generated file changes here.

### Planned files to create

- (none)

### Planned files to edit

- `docs/model-routing.md`
- `docs/model-catalog.md`
- `README.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `docs/security.md`

### Test strategy

- (none)

### Implementation order

1. `docs/model-routing.md`
2. `docs/model-catalog.md`
3. README Vibe setup
4. `docs/security.md` Vibe floor
5. `docs/upgrading.md` new 0.41.0 section

### Excluded scope

- Generated files (CLI reference, usage spec, the README CLI region, skill catalogs)
- Earlier upgrade entries and archived artifacts
- Any code or test change

### Verification

The `standard` gate profile of `phax.json` (its terminal steps include `pnpm site:build`).

### Expected handoff content

List each docs page and section changed, the new 0.41.0 upgrade section as written, and any mention of the installer deliberately left as history. Explain any file-plan deviation.

### Commit subject

`docs(vibe): document --model/--thinking, the 3.1.3 floor and the upgrade steps`

### Commit body

The Mistral Vibe setup in docs/model-routing.md and the README now has the operator upgrade to mistral-vibe 3.1.3 and run phax agent setup providers --write, with no alias installer. It shows the --model/--thinking invocation, the post-turn model and level check, and the fresh-start note. docs/security.md names the 3.1.3 floor. docs/model-catalog.md lists mistral-medium-3.5 with a change-log line. A new 0.41.0 upgrade entry gives the steps: upgrade Vibe, rewrite providers.json, rename routing keys, and optionally delete the PHAX alias blocks by hand.
