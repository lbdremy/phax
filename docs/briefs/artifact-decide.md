Write the phax spec `artifact-decide`. This is the third draft. The second, `docs/specs/archive/2609250815-artifact-decide.md` (approved 2026-09-29 at baseline `bc84612`, abandoned 2026-10-14), stands in its design and in the §9 answers listed below. The ground under it changed, and its §1, its §6 file section and the criteria built on them describe storage phax no longer has. Read it first and keep its structure, its terminology, its requirements and criteria wherever the current code still holds them. Re-ground everything else in the code as it is today; do not trust its §1.

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

Reopened by the ground change. Pose each in §9 with its options, what each abandons, and a recommendation:
- **Q4, approval records without `approvedBy`.** The second draft decided to refuse such a record and rewrite the in-repo ledgers, at a time when approvals were unversioned ledgers. Today phax lifts its own older files through their frozen shape. Weigh lifting a record stamped 0.19.0 to `approvedBy: { kind: unattributed }` against the old refusal. Neither may present an old approval as an operator's.
- **Lifting existing spec and plan documents.** Today a decided question stays in `openQuestions`, marked by convention: " (Decided by the author on <date>; not reopened.)" appended to `question`, and `rationale` prefixed "Decided by the author on <date>, …".
  - Lifted as open, such questions meet the approval lock at the next approval. Draft and Approved artifacts in flight would be affected; Completed and Abandoned ones are never approved again.
  - Decide whether the lift moves marked questions to `arbitratedQuestions`, leaves them open, or does something else. Say what a lifted verdict holds when no structured decision was ever recorded.
- **Anything else the current code contradicts in the second draft's design:** pose it as a question; do not settle it silently.

Constraints:
- The CLI stays additive.
- A frozen-shape lift is the sanctioned way to read an older file; it is not a back-compat shim, and no field becomes optional. New persisted fields are required, as explicit per-variant enums (`approvedBy` kinds).
- Every example and fixture is made up.
- Keep the second draft's §11 docs page.
- Out of scope, named: headless arbitration, a decision queue UI, multi-human arbitration, `headless-review` (it reopens after this spec ships), and `oracle-phases`.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
