Write the phax plan "Decide and the approval lock". It is the third and last of three plans for the approved spec `docs/specs/2610140742-artifact-decide.md`, so it carries `completes-spec: true`. Read the spec in full. Decided with the author on 2026-10-14: the spec is split into three plans, run in order, each authored after the previous one merges:
- A: approver attribution and reopen (shipped).
- B: the question model, the renderer and `migrate-documents` (shipped).
- C: the `decide` command, the doctrine skills and the approval lock (this plan).

In scope: everything plans A and B left.
- **Requirements:** §5.1–§5.26, §5.28, §5.30 and §5.33–§5.34 (decide), and the decide halves of §5.27 (`--question` and refusals name ids), §5.29 and §5.31–§5.32 (decide re-renders a plan). Also §5.38–§5.39 (the approval lock), §5.58 (doctrine skills in the catalog), and the decide half of §5.54 (decide waits for migration, as approve and reopen already do).
- **Surfaces in §6:**
  - `phax artifact decide`, the revised document, and the decision record.
  - `phax skills install` listing the three doctrine skills.
  - The decide pointer under the status `Questions:` line, and `Approved (once no question is open)` among the legal transitions.
  - Approve's refusal naming the open questions and `phax artifact decide <path>`.
  - The `decision-record-manifest` row of the persisted-formats table.
- **§8 criteria:** every one, in full. A and B delivered some of them minus their decide steps; this plan adds those steps:
  - "Artifact reopen returns an Approved artifact to Draft" and "Reopening a spec names its plans and leaves them": their decide steps.
  - "Spec documents in flight are lifted by the rationale marker": the second approve and the decide step.
  - "Approve, reopen and decide wait for migration": decide.
  - "Status counts questions by state and arbiter" and "Questions are named by their ids": through decide rather than a fixture written directly.
  - "Commit failure leaves the files": decide's half.

What plans A and B shipped, which this plan builds on rather than redoes:
- `approvedBy` and `--by`, the `Terminal` port, and the committing-identity read: `Git.committerName`, which reads `GIT_COMMITTER_NAME` and then `user.name`, and is what `resolveArbiter` uses.
- Reopen from Approved.
- `src/schemas/questions.ts`, with the verdict union, `firstQuestionViolation` and the lift.
- The renderers (`renderQuestions.ts`, `renderSpec.ts` and `renderPlan.ts`) and `scripts/rerender-spec.ts`.
- `parseHandAuthoredQuestions` (`src/domain/artifact/questions.ts`): none / parsed / departs.
- `scanLiveSidecars` and `refuseUnmigratedDocuments` (`src/app/unmigratedDocuments.ts`), and `seedPlanCache`.
- The status `Questions:` line, `migrate-documents`, and the phase guard's `migrate-documents` entry.

Decided with the author on 2026-10-16. Record each in `## Technical arbitrations` with the loss accepted:
- **The interactive session hands its document back through a headless resume.**
  - phax starts the interactive session with a known session id: it resumes the authoring session when its id is kept and was a Claude session, and otherwise starts one with `--session-id <uuid>`.
  - When the operator exits, phax resumes that session headless through `Backend.resumeAgentSession`, asking for the revised document as its final JSON message.
  - That step reuses authoring's final-message parse, its single corrective resume, and the rate-limit and usage-limit classification (exit 8).
  - Loss: one extra model turn per decide, and the operator does not watch the document being composed.
  - The spec's "the session's final message" is read as the final message of that resumed session.
- **decide runs on Claude Code only.** `src/domain/session/codex.ts` and `mistral.ts` keep returning unsupported, and decide adds no interactive launch for them. It resolves a Claude model and runs the `claude` executable whatever the project's provider priority. A `--model` outside the Claude families is refused with exit 12 before any session, naming Claude Code as the one provider decide supports. The project override of a doctrine skill (§5.13) is read from `.claude/skills/<name>/SKILL.md`. Loss: projects on Codex or Vibe cannot decide until a later plan adds their interactive launch.
- **The `docs/ideas/skills/` drafts are gone** (deleted on main on 2026-10-16). The doctrine skills' only copies are `.claude/skills/phax-decide-{spec,plan,review}/SKILL.md`.

Settled by the spec, stated here so the plan does not reopen them:
- **A hand-authored question is decided when it sits under the arbitrated section with a `Decision:` block** (§9 Q10, with Q11's two sections). A `Decision:` block under the open section departs from the format, and is never read as decided. That is how plan B's parser reads it, and the approval lock and decide's in-place write follow it.
- **The interactive session never writes to the repository.** decide launches it with the same read-only tool policy headless authoring uses, carried to the interactive invocation. The operator's verdicts land only through the revised document. §5.24's changed-during-session refusal still guards the artifact and its sidecar.

Ground to read (the spec's §1 is current as of 2026-10-14, plus what A and B shipped):
- **Sessions:**
  - `src/ports/session.ts` and `src/infra/session.ts`: the interactive launch, `stdio: inherit`, exit code only.
  - `src/domain/session/claude.ts` `buildPrePromptedInvocation`: `--session-id <uuid> [--model] [--effort] <prompt>`, or `--resume`.
  - `src/app/adjustPlan.ts` is the precedent for an interactive session started with a pre-assigned id and a prompt passed by file path. Resume the authoring session from the cwd it ran in.
  - `src/ports/backend.ts` `resumeAgentSession` and `src/app/authorArtifact.ts` give the headless resume, the final-message parse and the single corrective resume. Compose them; do not fork them.
- **The authoring session id (§5.2)** is already kept locally: `persistSessionId` writes `claude-session-id.txt` into `<stateRoot>/authoring/<stamp>-<slug>/` for every provider, and it never reaches the records branch. Find it from the artifact, and confirm that a retried session's id is the one kept. Write only what §5.2 still lacks.
- **Doctrine:**
  - Authoring inlines a skill's SKILL.md text into its prompt (`SKILL_SOURCE_DIR_FOR_KIND` in `src/cli/commands/artifact.ts`). decide loads its doctrine the same way: the bundled skill, or the project's `.claude/skills/<name>/SKILL.md` when present, then the `--doctrine` file.
  - Principle ids are the backticked ids that open list items (§5.15). In the shipped skills these are `C1`–`C5` and `S1`…, and a parenthesised `(`C1`)` after an id does not open the item.
  - The framing questions F1–F5 live in decide's prompt, not in the skills (§10).
- **Skills catalog:** add `phax-decide-spec`, `phax-decide-plan` and `phax-decide-review` to `src/domain/skills/catalog.ts`. They already ship in the npm package `files`. Update the three SKILL.md texts where they still describe the older §9 shape (`options[]`, a free-text recommendation) to the question model with ids, the two sections and the verdict fields. Their headless sections stay as they are, unused (§10).
- **Validation of the revised document (§5.17–§5.21, §5.33):** a pure domain check comparing the document before and after the session, with each violation named by path, exit 5.
  - What may move: only the presented questions, and the answer must be stamped with the current shape.
  - What must not change: open questions not decided, and arbitrated questions other than the one re-arbitrated.
  - The verdict: `chosen` and `abandoned` (`firstQuestionViolation` already checks these), cited principles defined by a loaded doctrine, and traceability. A plan verdict's `phase` must name a phase of the plan.
  - **Attribution:** phax sets `by` (the committing identity, via `Git.committerName`, refusing with exit 12 as approve does when there is none) and `at` (the clock) on each verdict decided in this session. Whatever the session returned there is overwritten.
- **Hand-authored in place (§5.6):** a pure domain writer that moves each decided question's block from the open section to the arbitrated one with its Decision block, applies the accepted body edits, appends to the decision log, and changes no other line. It parses through `parseHandAuthoredQuestions` and refuses a departing §9 before any session (§5.5).
- **Body diff (§5.22):** there is no text-diff code or dependency today. Show the diff of the two rendered bodies through a port and accept it with `Prompt.confirm` (`initialValue: false`, cancel = decline; precedent `src/app/prune.ts`). Choosing the diff mechanism is the plan's call; Git's `diff --no-index` through the Git port adds no dependency. A declined diff writes nothing and exits 0.
- **Decision record (§5.30):**
  - A new `decision-record-manifest` format, born with `$schema`, written through the authoring record plumbing: `src/app/writeAuthoringRecord.ts`, `recordPlumbing.ts`, the transcript setting, and the `RecordManifestFileSchema` union in `src/schemas/authoringRecord.ts`.
  - It gets a `next` snapshot via `pnpm exec tsx scripts/schemas-check.ts --write`. Never hand-edit `src/schemas/release.ts`, `packages/schemas/src/generated/index.ts` or `packages/schemas/history.lock.json`.
  - Its layout is indicative in §6. Name the outcome of a declined diff explicitly.
- **The approval lock (§5.38–§5.39):**
  - `transitionArtifactBy` in `src/app/artifactStatus.ts` refuses with exit 12, before any write, when the sidecar's `openQuestions` is not empty or a hand-authored §9 has open questions. It names them and `phax artifact decide <path>`.
  - A hand-authored §9 that does not parse is refused, naming the departing line.
  - An artifact with neither section is approved with no question check.
  - Plans follow the same rules through their preamble arrays.
- **Wording that now names decide:**
  - The status decide pointer under `Questions:`, and the legal transition `Approved (once no question is open)`.
  - `migrate-documents`' report for an Approved artifact left with open questions: "reopen it and decide <ids> before re-approving".
  - Plan B deliberately named only `phax artifact reopen` there.
- **Plan authoring invites open questions (§5.59):** the plan-authoring prompt in `src/domain/authoring/prompt.ts` stops asking for empty `preamble.openQuestions` and invites the planner to leave unsettled technical arbitrations as open questions, in the same shape as a spec's. `arbitratedQuestions` must still be empty (§5.60). Update the phax-planning skill's question section to match.
- **Phase guard:** classify `artifact decide` as `refused` in `src/domain/security/phaseGuard.ts`.
- **Model and effort (§5.3):** `--model` and `--effort`, then a built-in catalog default chosen on cost among the Claude entries, recorded in the plan's arbitrations.
- **CLI:** add `decide` to `src/cli/cliDocs.ts`, then run `pnpm gen:usage-spec` and `pnpm docs:cli`. Never edit `phax.usage.kdl` by hand.
- **Docs and skills:**
  - **`docs/arbitration.md`:** new, per §11.
  - **README:** decide, the approval lock and the doctrine skills.
  - **Skills:**
    - `.claude/skills/phax-cli/SKILL.md`: decide and the lock.
    - `.claude/skills/phax-spec/SKILL.md`: approval needs an empty open section; decide answers it.
    - `.claude/skills/phax-planning/SKILL.md`: plan open questions are invited, and decide answers them.
    - The three `phax-decide-*` skills.
    - The run needs `--allow-skill-edits`, so name exactly these files. The phax-planning generated catalog table is untouched.
  - **NEXT_STEPS.md:** the `artifact-decide` entry is done. headless-review is next, and it adopts the machine/operator approval form.
- **This repository's own artifacts:** no phase rewrites a file under `docs/specs/` or `docs/plans/` except the plan's own archival and the spec's completion at run end. Two hand-authored specs here, `batch-execution-disjoint-plans` and `phase-decision-requests`, have a §9 that does not parse. They are parked and already Approved, so the lock does not touch them; leave them alone.

Phase shape: as few phases as the gates allow, ordered from the core outwards. Every commit leaves the build green. A likely split:
1. Doctrine resolution, principle ids, the `--doctrine` refusals and the skills catalog, with the three doctrine skills updated.
2. The pure decide domain: revised-document validation, attribution, the hand-authored in-place writer, and the re-render with the decision log.
3. The decide use case:
   - preconditions, `--question`, nothing to decide, the migration wait and the Claude-only refusal;
   - the interactive launch and the headless resume;
   - the diff, accept, write, plan cache re-seed with lineage kept, the changed-during-session refusal, and the commit.
4. The decision record format and writer.
5. The approval lock, the status and migrate wording that now names decide, the plan-authoring invitation, the phase guard and the CLI usage and docs.
6. `docs/arbitration.md`, README, skills and NEXT_STEPS.

Merge or split phases as the gates require. The phase that adds the decide command also adds its phase-guard entry.

Constraints:
- The plan's own phases name only models in the installed phax's catalog (`phax agent models`): `claude-opus-5-5` (the default) or `claude-sonnet-5-5` for mechanical work.
- Every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- Tests never spawn a real provider. They use the fake backend and a fake session port, and a fake terminal and prompt.
- Fixtures and examples are made up. None is copied from this repository's own specs or from another repository.
- It must pass `phax plans lint`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
