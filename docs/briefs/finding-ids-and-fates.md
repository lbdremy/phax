Write the phax spec "Finding ids and fates". Every review finding phax records gets a stable id, and its fate is recorded: fixed by which commits, dismissed by whom and why, or still open. A finding stops being a line in a JSON file nobody follows up; it becomes something the records can join to the change that resolved it.

**Why.** The knowledge index (`docs/briefs/knowledge-index.md`, "What it is for", use 3) is meant to let phax's agents learn the doctrine and stop repeating errors: "last time a test like this missed, what did the better test look like?". With steme, a recurring escape becomes a candidate for a test pattern or a new guarantee. That needs, for each finding, why the tests missed it (already recorded: `lens`, `escape`) **and what became of it** (not recorded). Literature: no dataset found pairs review findings with their outcome; 68% of rejected agent PRs carry no stated reason (`spikes/harness-data/records-questions-literature.md`).

**What the records hold today (phax repository, 2026-11-04):**
- 10 headless code reviews, 51 findings (`code-review.json`): `severity` (bug 4, deviation 9, concern 25, info 13), `file`, `line`, `message`, `lens`, `escape` (untestable 19, omission 12, unexplored-input 9, fake-drift 5, same-author 5, weakened 1), `criterion`, `suggestion`. No id.
- 10 compliance reviews (`compliance-review.json`): `perPhase[].findings[]` with `dimension`, `severity`, `message`. No id.
- 68 review-fix commits on `main` since September carry `Short-Name: <run>` (no `Run-Id`), with free bullet bodies; nothing links a commit to the finding it addresses. A finding's fate is known only to the operator's memory.

**Prior design to stay consistent with.** The Draft spec `docs/specs/2609250823-headless-review.md` (2026-09-25, not implemented beyond the headless code review that was split out) defines **Finding id** — run-unique, assigned by phax, `F<n>` for review findings and `C<n>` for compliance findings, numbering continued across passes — and finding **outcomes** (`fixed`, `open`, `dismissed`, `awaiting`) with an append-only decision history in the decided-verdict shape of `phax artifact decide`. This spec takes the id and the fate alone, without `review-plan` or `run --append`, uses the same terms, and says what headless-review then reuses instead of redefining.

**Settled (do not reopen):**
1. **phax assigns the ids**, when it persists a review's output; the review session never invents them. `F<n>` for code-review findings, `C<n>` for compliance findings, unique within the run.
2. **A finding always has a fate**, from a closed set; a new finding is `open`. Nothing is dropped.
3. **Git stays the source of truth.** A fate is read from Git (the run branch, `main` after merge, the records branch), never kept only in an index or a local file, so the knowledge index can rebuild it.
4. **A machine may fix a finding but never dismisses one.** Dismissal is the operator's, with a reason, by and at stamped like a decide verdict.
5. **Read surface:** the fates of a run's findings are readable through the CLI with `--json` (versioned answer, per the command-contracts spec), so the index and the operator read the same thing.

**What exists (read it first):**
- `src/schemas/codeReview.ts` (the `code-review` answer and file, strict, `$schema`-stamped; closed severity, lens, escape ids shared with the bundled `phax-review` skill), `src/schemas/complianceReview.ts`, `src/schemas/reviewRecord.ts` (the review record manifest).
- Where phax persists a review and commits a review record to `phax/records/v1` (`phax review-code --headless`, `phax review-compliance`), and `phax records explain`.
- Commit trailers phax already reads and writes (`Run-Id`, `Phase-Id`, `Short-Name`, `Decision-Id`, `Authoring-Id`) and the release-notes reading of `Short-Name`.
- The decision record and the decided-verdict shape (`phax artifact decide --verdicts`), for the dismissal's stamp and history.
- `.claude/skills/phax-decide-review/SKILL.md`: the severity threshold (`info` never planned, written to the handoff).
- `docs/specs/2609250823-headless-review.md` §4 (terminology) and its R-requirements on outcomes.

**Out of scope:** `review-plan`, `run --append`, review loops; the knowledge index itself; classifying a fix with a model; steme guarantees; blocking a merge or a publication on open findings.

**Open questions for §9 (each with a recommendation):**
1. **How a fix names its finding.** A commit trailer (`Finding: F3`, repeatable) on the fixing commit, a command run after the fact (`phax review fixed <run> F3 <commit>`), or both. Recommendation: the trailer — it is written where the fix is made, by a person or an agent, survives the merge, and phax already lives on trailers; phax derives `fixed` from the run's commits that carry it.
2. **Where a dismissal lives.** A record on `phax/records/v1` written by a command (`phax review dismiss <run> F3 --why …`), an empty commit with a trailer on the run branch, or a file on the run branch. Recommendation: the records branch, through a command, in the decided-verdict shape — like decide's records, no noise on the run branch, readable after the run is archived.
3. **A fourth fate for deferred work.** Some findings become a brief, a spec or a `NEXT_STEPS.md` line rather than a fix now. Recommendation: `deferred`, with a required pointer (the artifact path) and the operator's stamp — an `open` finding that stays open forever reads as neglect, and the pointer is what the index joins on.
4. **What "how it was fixed" records.** Derived from the fixing commits (did they add or change a test, a gate step, a doc, only code), declared on the trailer, or not recorded. Recommendation: derived from the fixing commits' diff by path class (tests, gate config, docs, code), recorded with the fate — no declaration to forget, and it is exactly what "last time, what did the better test look like" needs.
5. **Reviews recorded before this change** (10 code reviews, 51 findings). Recommendation: their shape lifts with ids by position (`F1`… in document order) and the explicit fate `unrecorded` — no back-compat shim, no guessing; the operator may set fates afterwards with the same commands.
6. **The PR and open findings.** Recommendation: the run's PR description lists findings by fate (open and deferred named, fixed counted), and nothing blocks — runs stay autonomous and the operator decides.
7. **Findings the operator raises by hand** (interactive review, reading the PR). Recommendation: out of this slice; named as the follow-up (`phax review add`), since they have no `lens`/`escape` today.
