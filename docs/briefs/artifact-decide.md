Write the phax spec `artifact-decide`. This is the fourth draft.
- The third, `docs/specs/archive/2610140718-artifact-decide.md` (drafted and abandoned 2026-10-14), is the base: its re-grounding stands. Keep its structure, terminology, requirements, surfaces and criteria, its question ids (Q1–Q4, Q6, Q8–Q12, Q14–Q19), and its §9 options and losses. Change only what the decisions of 2026-10-14 below require. One of them goes against its recommendation, so its body must be revised wherever it relied on that recommendation.
- The second, `docs/specs/archive/2609250815-artifact-decide.md` (approved 2026-09-29 at baseline `bc84612`, abandoned 2026-10-14), is the origin of the design and of the carried-over answers.
- The ground notes below are what the third draft was re-grounded against; check them again only where a decision touches them.

What changed since `bc84612` (read these files; each change must reach every section that relies on the old ground):
1. **Approvals are one file per artifact.**
   - `docs/specs/approvals/<spec>.json` (format `spec-approval-record`) and `docs/plans/approvals/<plan>.json` (format `plan-approval-record`): `$schema` first, then `artifact`, then the record (`src/schemas/specApprovalRecord.ts`, `src/schemas/approvalRecord.ts`, `src/domain/artifact/approvalRecordFile.ts`, `src/app/artifactStatus.ts`).
   - The old `docs/{specs,plans}/approvals.json` ledgers are read only to migrate them, and approval commands refuse while one exists.
   - Rewrite every `approvals.json` mention (§1, §6's file section, the §8 criteria) against the record files. `artifact reopen` on an Approved artifact removes its record file.
2. **Persisted formats are versioned by shape.**
   - A file's `$schema` stamp names the release that last changed the format's shape (`src/schemas/release.ts` `CURRENT_STAMPS`: `spec-document` 0.17.0, `plan-document` 0.20.0, `spec-approval-record` and `plan-approval-record` 0.19.0).
   - A shape change is recorded as `packages/schemas/snapshots/<format>/next.schema.json` and released by the cut (`docs/release.md`).
   - The previous shape is frozen under `src/schemas/history/<format>/<release>.ts`, pinned by `packages/schemas/history.lock.json`. phax reads a file stamped below the current shape through that frozen decoder and lifts it (`src/schemas/persisted.ts`). Example: an `authoring-record-manifest` stamped 0.17.0 is lifted with `retry: "none"` (shipped in 0.23.0).
   - The spec names every format it changes and, for each, how an older file is lifted: `spec-document` gains `arbitratedQuestions`, `plan-document` gains `openQuestions` and `arbitratedQuestions`, and both approval record formats gain `approvedBy`.
   - Read NEXT_STEPS §"A persisted-format stability promise" for the rule on provider answers.
3. **The plan document carries `completesSpec`** (frontmatter `completes-spec`), and `artifact new plan --spec` requires `--last` or `--not-last`. Decide re-renders plan documents and must keep both.
4. **The authoring retry (0.23.0)** resumes a headless authoring session once, within the same process, to retry a refused document. No provider session id is persisted (`src/schemas/authoringRecord.ts`). Correct §1's sentence on resumable sessions.
5. **phax runs stay autonomous** (decided 2026-10-10): the `decision` class was dropped, `phase-decision-requests` stays parked, and a person reaches a run only through review notes after it. Decide is an artifact gesture before any run. Say so, and say it never runs inside one: the phase guard already refuses it in a phase worktree.
6. **No other repository's files are ground.** The second draft cited the steme corpus. The first consumer is still the steme roadmap-1.0 conductor (NEXT_STEPS), and the contract the second draft states for it stands. Cite no path outside this repository.

Carried over, decided by the author. Write each in §9 as decided, keeping its original date and decision, with " (Decided by the author on <its date>; not reopened.)" appended to the question:
- **Q1:** decide runs on Draft only. `phax artifact reopen` extends from Stale plans to Approved specs and plans and removes the approval record.
- **Q2:** the plan preamble gets `openQuestions`, in the decision-request shape plus `history`, rendered before the first phase. Settled arbitrations stay prose in `technicalArbitrations`.
- **Q3:** `--by operator | machine:<grant>`, required when not run from a terminal; from a terminal without it, the operator.
- **Q6:** decide reads and writes a hand-authored §9 in the §9 format.
- **Q8:** on a Draft, `decide --question <id>` re-arbitrates; the new decision joins the question's history.
- **Q9:** the approval lock covers every spec and plan, with or without a sidecar.
- **Q10:** a hand-authored question is decided when its last block is a `Decision:` block.
- **Q11:** arbitrating moves a question to `arbitratedQuestions` with everything it had, plus its verdict.
- **Q12:** the interactive session returns the revised document. phax checks it, shows the body diff, and writes only what the operator accepts.
- **Q14:** decide is interactive only. A headless mode is built later from the recorded sessions.

Drop Q5, Q7 and Q13, which Q14 superseded. With no headless mode there is no machine proposal, no escalation and no machine reversal: remove them from every section, including Q8's "a machine reversal escalates". `--by machine:<grant>` stays for approve and reopen.

Decided by the author on 2026-10-14, after the third draft. Write each in §9 as decided, with its options and losses from the third draft, " (Decided by the author on 2026-10-14; not reopened.)" appended to the question, and the rationale opening "Decided by the author on 2026-10-14, as recommended." or "…, against the recommendation (`<old option id>`)." as it applies. Where a decision departs from the third draft's recommendation, `recommendation` names the option chosen:
- **Q4, `lift`, as recommended.** A record stamped 0.19.0 is read through its frozen shape and lifted to `approvedBy: { kind: unattributed }`. `approvedBy` is required at the new shape.
- **Q15, `marked-move`, with a corrected rule.** The third draft required both the question suffix and the rationale prefix. The two other in-flight specs, `headless-review` and `oracle-phases` (13 decided questions), carry only the rationale prefix, so the rule is the rationale alone. A question whose `rationale` opens with `Decided by the author on <YYYY-MM-DD>` moves to `arbitratedQuestions` with a `lifted` verdict, and every other question stays open. The verdict holds the question's `recommendation` as chosen, its other options as abandoned, its rationale as why, the marker's date, and `by: unattributed`. When the author decided against a recommendation, `recommendation` was rewritten to the option chosen; both in-flight specs show it ("against the previous recommendation (`structural`)" with `recommendation: new-oracle-surface`). So the recommendation is the choice. Rewrite the option text, the loss ("phax recognizes a prose prefix inside a field; a rationale that departs from the prefix by one character stays open") and criterion 25: a question marked only in its question stays open, and add one marked only in its rationale, which lifts. A 0.20.0 plan document lifts with both arrays empty.
- **Q16, `migrate-command`, against the recommendation (`frozen-layout`).**
  - A one-time command lifts every live spec and plan sidecar stamped below the new document shapes (by Q15's rule) and re-renders its body in the new layout. No 0.17.0 §9 layout is kept for agreement.
  - Until it has run, the approval commands refuse, naming it, as they refuse while an old `approvals.json` ledger exists (`migrate-approvals`). Decide refuses too.
  - Loss accepted: re-rendering an Approved artifact edits it after its approval, so a migrated Approved spec reads edited since approval and its bound plans go stale (`spec-changed`). The command says so, naming each artifact.
  - Specify the command: name it beside `migrate-approvals`. Specify its refusal on a body that diverges from its sidecar's own-shape rendering (a hand edit must not be overwritten unseen), its output, and its single path-scoped commit. Rewrite every requirement, surface, criterion and planning-note constraint written for `frozen-layout`, and remove the kept-layout constraint.
- **Q17, `ids`, as recommended.** Headings render `### <id> — <question>`, option bullets and the `Recommendation:` line open with option ids, and `--question`, status, refusals and the decision log name ids. The migrate command's re-render is where existing artifacts change: the third draft's "the re-render that Q16 already defers" becomes the migrate command.
- **Q18, `allow`, as recommended.** Reopen proceeds, leaves bound plans as they are, and names them in its output.
- **Q19, `schema-stamped`, as recommended.** The decide session answers in the sidecar form, `$schema` first at the current shape. Any other stamp is refused by name and never lifted.

The planning note's "open" list is empty: every question is decided. If writing the revision surfaces a question no decision answers, pose it as a new open question with a new id (Q20 on); do not settle it silently.

Constraints:
- The CLI stays additive.
- A frozen-shape lift is the sanctioned way to read an older file; it is not a back-compat shim, and no field becomes optional. New persisted fields are required, as explicit per-variant enums (`approvedBy` kinds).
- Every example and fixture is made up.
- Keep the second draft's §11 docs page.
- Out of scope, named: headless arbitration, a decision queue UI, multi-human arbitration, `headless-review` (it reopens after this spec ships), and `oracle-phases`.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
