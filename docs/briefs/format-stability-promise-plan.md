Write the phax plan "Format stability promise" for the approved spec
`docs/specs/2611231918-format-stability-promise.md`. It is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/format-stability-promise.md`. These are settled;
do not reopen them:
- the operator's verdicts of 2026-11-24 in §9b: q-floor-at-one `keep-0-17`, q-floor-moves `major-only`, q-newer
  `refuse`, q-mixed `refuse-command`, q-one-time-step `breaking-only` (blocking steps only; a non-blocking document
  upgrade may ship at any release, §5.11), q-config `config-breaking-only` (model catalog values excepted, §5.20);
- the revision of 2026-11-24 (§5.8, §5.9, §5.11, §5.18, §5.20): within a breaking line a shape only adds, every
  added field computed or `unknown` for older documents;
- everything §10 lists as settled, and its constraints; the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion.

## Facts read on main at 63baa7f (2026-11-24)

- **The package's reader.** `packages/schemas/src/shapes.ts` (285 lines, `defineFormat`), the formats under
  `packages/schemas/src/formats/` (eleven files), `FIRST_SUPPORTED_RELEASE = "0.17.0"` in
  `packages/schemas/src/generated/index.ts`, the snapshots and `history.lock.json`.
- **phax's reader.** `src/schemas/persisted.ts` (2,270 lines) reads older shapes for only some formats; the frozen
  decoders live under `src/schemas/history/<format>/`. `src/schemas/release.ts` (55 lines) holds the current shapes.
  The spec's "left open" asks the plan to inventory which `durable` formats phax reads only at their current shape.
- **A blocking step exists today.** `src/app/headlessWriter.ts` (about line 151) and `src/app/artifactStatus.ts`
  (about line 561) refuse an older sidecar with "run `phax artifact migrate-documents` first";
  `src/app/migrateDocuments.ts` is the one writer of older spec and plan sidecars. §5.10 removes the refusal; the
  plan says whether `migrate-documents` becomes the non-blocking document upgrade of §5.11.
- **The cut.** `scripts/release.sh` calls `scripts/release-cut.ts` and `scripts/release-open.ts`, each refusing
  before it writes anything. The cut renames the `next` snapshots; that is the natural source for "which formats
  changed shape" (§5.3) and "what was dropped or renamed" (§5.9). CI rehearses the cut and the next opening on
  every push and pull request.
- **The registry and properties.** `tests/helpers/property/formatRegistry.ts` (1,234 lines) and
  `docs/property-tests.md` (`reads every frozen shape`, `registers a frozen shape for every module of its history`).
- **Retired models.** The routing catalog (`src/domain/routing/catalog.ts`) carries a status per model, and
  `src/domain/routing/preflight.ts` checks a plan's models; check what a configuration naming a model absent from the
  catalog gets today before planning §5.20, and whether it already refuses by name.
- **Docs.** `docs/release.md` (the cut, the stamp rule), `docs/upgrading.md`, the README's "A file stays readable as
  phax evolves" paragraph; the new page is `docs/format-stability.md` (spec §11), linked from the README,
  `docs/upgrading.md` and the site's navigation.

## Settle in Technical arbitrations, with the dominant loss of each

- **Where each format's class lives** (the registry in `packages/schemas`, or beside it in phax) and how the docs
  page's table is generated from it rather than written by hand.
- **How the cut compares the new snapshot with the previous one** to tell an added field from a dropped or renamed
  one, a variant and a format included, and how it matches changed formats against the release's upgrading entry.
- **How the below-floor refusal names the release line** that still reads a document.
- **The frozen decoders and lifts phax adds** to read every `durable` shape the package reads, in an order that
  keeps every phase's gate green; whether this part is large enough to be its own phases.
- **Whether `migrate-documents` becomes the non-blocking upgrade**, and the wording its refusals lose.

## Shape

Indicatively: the classes and the registry checks first (every format stamped, one class each, a snapshot per
shape); then phax's readers catching up with the package, with the newer, below-floor and mixed-records refusals;
then the cut's new refusals (undocumented shape change, a dropped or renamed field in a non-breaking release, a
floor raised outside a major); then the blocking step removed and configuration (§5.18 to §5.20); the docs page
last. Models: `claude-opus-5-5` at medium for the reasoning phases; a mechanical docs phase may run on
`claude-sonnet-5`.

No acceptance phase: the surface is file formats, refusals and a release script, all read in full by tests.

## Footprint

This plan runs beside `security-high-fixes` and `launcher-release-fixes`. Keep it off `src/infra/git.ts`,
`src/app/worktree.ts`, `src/domain/records/assemble.ts`, `src/app/reviewCode.ts`, `npm/`, `deno.json` and the
workflows; if a phase needs one of them, say so in Technical arbitrations. `src/app/loadConfig.ts`
is shared with later waves: touch it only if §5.20 needs it.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version;
  a test of the cut's refusals runs it in a scratch copy, never on the repository's own snapshots.
- **No test or step runs `scripts/release.sh` for real**, publishes, or reaches the network.
- **Tests never read `~/.phax`, a real provider home or the global git config.** A test that spawns a child goes
  through `tests/helpers/boundedSpawn.ts`.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`,
`pnpm test:property:deep`, `pnpm dev schema upgrade`, `git log`, `git grep` are `agentCommands`; `pnpm test` is a
gate command.
