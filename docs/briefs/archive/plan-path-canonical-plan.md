Write the phax plan "One canonical form for a plan's paths" for the approved spec
`docs/specs/2611141103-plan-path-canonical.md`. It is the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the operator's decision of 2026-11-14 in §9: q-rewrite `rewrite-reading`. Rewrite a plannable non-canonical path when
  phax reads a plan.md (the deterministic reading and the extraction answer); refuse it in a plan document (a headless
  planner's answer, a plan's JSON sidecar);
- everything §10 lists as settled, and its constraints. One plan-path schema on every route. Readers do not normalize.
  `phax-plan`, the plan document and `phax-plan-extraction` move to the next release's stamp, each with a frozen 0.33.0
  decoder. No back-compat shim. The rule is pure domain logic that never reads the working tree. The extraction
  answer's JSON Schema still admits a plannable non-canonical path. The two tests of pull request #205 pass unchanged.

Release context. 0.37.0 is released and installed; 0.38.0 is the opened version, and `artifact-revise` has already
landed in it (a new `revision-record-manifest` format with a `next` snapshot). Runs on this repository use the
installed phax.

What already exists (read it before planning):
- The two routes the brief names: `ExtractedPhaseFields` in `src/schemas/phaxPlan.ts`, `PlanExtractionAnswerSchema` in
  `src/schemas/planExtraction.ts`, `PlanDocumentPhaseSchema` in `src/schemas/planDocument.ts`, and the deterministic
  reading in `src/domain/plan/parsePlanMarkdown.ts`.
- The readers that must agree across spellings (§5.6): `src/domain/reconciliation/reconcile.ts`,
  `src/domain/plan/lint.ts`, `src/domain/plan/assignmentCheck.ts`, `src/domain/planOverlap/compute.ts` and
  `fromPhaxPlan.ts`, and `src/app/planStaleness.ts`. Also the skill-edit grant's private normalizer, which §10 lets go
  once its output is unchanged.
- `posix.normalize` already in the domain: `src/domain/decide/verdicts.ts`.
- Persisted formats: `src/schemas/persisted.ts` (readers, frozen decoders, lifts), `src/schemas/history/`,
  `src/schemas/schemaUrl.ts` (`FORMAT_IDS`), and the schemas package (`packages/schemas/`): formats, `next` snapshots,
  `scripts/schemas-check.ts --write`. `phax artifact migrate-documents` (`src/domain/artifact/documentMigration.ts`)
  for §5.9.
- The extracted-plan cache (`src/domain/planCache/`) and how its key changes when the extractor changes.
- The behaviour corpus (`tests/behaviourCorpus/`, `tests/unit/behaviourCorpus/`). A format whose shape changes gets
  `next`-shaped cases. Since 2026-11-13, a case's `shape: "next"` reads as the release its document's `$schema` names
  once the ledger lists it (`shapeAt` in `tests/behaviourCorpus/corpus.ts`). Read CONTRIBUTING's "The behaviour corpus"
  before writing cases.

Settle in Technical arbitrations, with the dominant loss of each:
- where the plan-path schema lives and how one rule yields both behaviours: a rewriting decode on the plan.md routes,
  a refusing one on the plan document;
- how the frozen 0.33.0 decoders lift an earlier shape: a canonical path passes, and a non-canonical one is a refused
  lift (§5.8, §5.9);
- how the extracted-plan cache drops entries written before the change (§10 left open).

Shape. Every §8 criterion has its own named test. The pure rule and its schema come first, then the persisted
formats and their frozen decoders, then the two routes, then the readers' cross-spelling criteria (the #205 tests
included), then migrate-documents, then docs: the phax-planning skill line §11 allows, and `docs/upgrading.md` 0.38.0.

Two lessons from the last run on this repository:
- **knip runs at every phase's gate.** An export that only a later phase uses fails the gate. Test it in the phase
  that creates it, or export it in the phase that first uses it.
- **CI rehearses the release cut and the next opening on every pull request** (`scripts/release.sh --rehearse`). A
  test that names the opened version, or expects a `next` shape literally, fails there. Write such checks so they hold
  on both sides of a cut.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a
space in it (`pnpm exec tsx`, `pnpm gen:usage-spec`) covers only itself, never a longer command.
