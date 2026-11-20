Write the phax plan "Revise a Draft artifact" for the approved spec `docs/specs/2610271505-artifact-revise.md`. It is
the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full. These are settled; do not reopen them:
- the operator's two decisions of 2026-11-13 in §9: Q1 `frozen-append`, Q2 `never`;
- the spec's 2026-11-13 corrections, checked against the code of 0.37.0: exit 14 and 64, the refusals before any
  session (§5.18), the amendment on stdin (§5.19), the session folder (§5.20), the report's `written` and `record`
  keys, and the revision record as a new persisted format keyed `revision/<Revision-Id>` (§5.16);
- everything §10 lists as settled, and its constraints. Above all: reuse decide's verdicts-mode writer path rather than
  build a second one.

Release context. 0.37.0 is released (tag v0.37.0) and installed; 0.38.0 is the opened version. Runs on this repository
use the installed phax. The revision record's format is new in 0.38.0, so it is stamped with the opened version and
gets a `next` snapshot until the cut.

What already exists (read it before planning):
- `src/app/decideVerdicts.ts`: the writer session. It resumes the kept session (provider and checkout), refuses a
  model routed to Vibe, runs read-only, makes the one corrective resume, checks for a concurrent edit, and writes,
  re-seeds and commits. Revise is a sibling of this path.
- `src/app/authorArtifact.ts`: headless authoring. It holds the kept `session.json` and `brief.md`, the skill text per
  kind (`phax-spec`, `phax-planning`), rendering, the sidecar, and the extraction cache seed.
- `src/cli/definitions/artifactDecide.ts`: decide on the command library's runner. Revise gets its own definition
  there, `artifactRevise.ts`, with its help, refusals, exit codes and `--json` report. `phax.usage.kdl` and
  `docs/cli/reference.md` are regenerated from the definitions (`pnpm gen:usage-spec`, `pnpm docs:cli`).
- `src/domain/artifact/` (`document.ts`, `questions.ts`, `sidecar.ts`, `render.ts`): the document, its questions,
  sidecar agreement and rendering. The question-freeze check (§5.5, §5.6) and the no-change check (§5.9) are pure domain
  logic.
- Records: `src/app/writeDecisionRecord.ts`, `writeAuthoringRecord.ts`, `writeRecord.ts`, `recordPlumbing.ts`, and
  `src/app/recordsExplain.ts` (trailer resolution). The new format registers in `FORMAT_IDS`
  (`src/schemas/schemaUrl.ts`), with its schema under `src/schemas/`, the schemas package's format and snapshot
  (`packages/schemas/`), and `docs/json-output.md` if it lists record formats.
- The §11 docs page `docs/revising-drafts.md`: the docs site renders only the sources `site/build/sources.ts` lists,
  under the routes `site/pages.ts` maps (`docs/arbitration.md` is the closest model). Link it from
  `docs/arbitration.md`.

Settle in Technical arbitrations, with the dominant loss of each:
- how revise and decide share the writer path (one module both call, parameterized by what the answer is checked
  against, or decide's module extended), and what decide's code must not change;
- the question-freeze check: what counts as a change to an existing question (text, options, recommendation, verdict,
  history, order);
- the revision record's shape, beside the decision record's.

Shape. Every §8 criterion has its own named test. Pure domain checks first, then the record format, then the use case
on the shared writer path, then the CLI definition and its regenerated contract files, then `records explain`. Docs
come last: `docs/revising-drafts.md` and its site route, `docs/arbitration.md`, and `docs/upgrading.md` 0.38.0.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a
space in it (`pnpm add`, `pnpm gen:usage-spec`) covers only itself, never a longer command.
