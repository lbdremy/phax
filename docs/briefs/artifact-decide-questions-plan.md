Write the phax plan "Question model and document migration". It is the second of three plans for the approved spec `docs/specs/2610140742-artifact-decide.md`, so it carries `completes-spec: false`. Read the spec in full; this plan implements only the part listed below. Decided with the author on 2026-10-14: the spec is split into three plans, run in order, each authored after the previous one merges:
- A: approver attribution and reopen (shipped).
- B: the question model, the renderer and `migrate-documents` (this plan).
- C: the `decide` command, the doctrine skills and the approval lock.

In scope:
- **Requirements:** §5.27 for rendering and status (headings, option bullets and `Recommendation:` lines name ids; status names question ids), §5.29 and §5.31–§5.32 for `migrate-documents`, §5.46–§5.56 (the document lifts, `migrate-documents`, approve and reopen waiting for it, the status lines), §5.59 (plan questions in the preamble, same shapes as a spec's) and §5.60 (authoring emits open questions only).
- **Surfaces in §6:** `phax artifact migrate-documents`; the spec and plan sidecar question arrays; the rendered spec (§9, §9b, the Decision block, the decision log); the hand-authored §9 format, read side only; the `Questions:` line and the unmigrated-sidecar line of `phax artifact status`, for specs and plans, headless and hand-authored; approve's and reopen's refusal while a live sidecar is unmigrated; the `spec-document` and `plan-document` rows of the persisted-formats table.
- **§8 criteria:**
  - In full: "Plan documents in flight are lifted and restamped, older ones still refused", "Migration refuses rather than overwrite a hand edit", "Migration names the approvals and plans it unsettles" and "Authoring emits open questions only".
  - "Status counts questions by state and arbiter": its fixture writes the decided verdict directly; it does not print the decide command.
  - "Spec documents in flight are lifted by the rationale marker", minus the second approve and the decide step.
  - "Approve, reopen and decide wait for migration", minus decide.
  - "Questions are named by their ids", for rendering and status, with a fixture written directly instead of through decide.
  - The `migrate-documents` half of "Commit failure leaves the files".

Out of scope, named in the plan's excluded scope (plan C):
- `decide` and its session, prompt, doctrine loading, principle-id checks, decision record and decision attribution (§5.25); `--question`.
- The approval lock: approve refusing open questions or an unparseable hand-authored §9 (§5.38–§5.39), and status's `Approved (once no question is open)` wording.
- Writing a hand-authored §9 in place.
- `skills install` of the doctrine skills, and `docs/arbitration.md`.
- **Inviting headless plan sessions to leave open questions.** Decided with the author on 2026-10-14: that prompt change ships in C, beside decide and the lock.

Decided with the author on 2026-10-14. Record each in `## Technical arbitrations` with the loss accepted:
- **This plan ships the hand-authored §9 parser (read side) and status uses it.** Plan C reuses it for the approval lock and for decide's in-place write. Loss: B grows by a parser, and the hand-authored §9 format becomes normative one plan before anything enforces it.
- **The plan-authoring prompt does not yet invite open questions.** The plan authoring answer gains `preamble.openQuestions` and `preamble.arbitratedQuestions`, and the prompt asks for both as empty arrays. The decoder enforces only §5.60 (arbitrated questions must be empty). Loss: until C, a headless plan session cannot return an unsettled choice as a structured question; it settles it in prose, as today.
- **Nothing in this plan names `phax artifact decide`, which does not exist until C.**
  - The status `Questions:` line prints the counts and open ids without the decide pointer.
  - migrate-documents names an Approved artifact left with open questions by its ids and `phax artifact reopen`.
  - Loss: until C, nothing tells the operator which command answers an open question.

Ground to read (the spec's §1 is current as of 2026-10-14, plus plan A, which shipped `approvedBy` and reopen from Approved):
- **The precedent for a persisted shape change is `e2b55922`**, the authoring-record-manifest `retry`; plan A followed it for both approval record formats. Follow it for `spec-document` and `plan-document`:
  - Freeze the current shapes as `src/schemas/history/spec-document/0.17.0.ts` and `src/schemas/history/plan-document/0.20.0.ts`, each rendering to its released snapshot.
  - List them among the format's releases in `packages/schemas/src/formats/repository.ts`, with their upgrades.
  - Lift in `src/schemas/persisted.ts`: a spec document stamped 0.17.0, or pre-schema (`version: 1`), by the rationale-marker rule (§5.46–§5.47); a plan document stamped 0.20.0, or pre-schema with `sourceSpec: null`, with both question arrays empty. A plan document stamped 0.17.0–0.19.x, or pre-schema with a spec, stays refused as today.
  - Run `pnpm exec tsx scripts/schemas-check.ts --write`. Never hand-edit `src/schemas/release.ts`, `packages/schemas/src/generated/index.ts` or `packages/schemas/history.lock.json`.
- **The spec's "0.24.0" stands for the release that ships it.** The new shapes are recorded as `next` snapshots. Never write a release number by hand.
- **Shapes** (§6 and the §10 constraints):
  - **Both arrays are required.** `arbitratedQuestions` is required on spec documents; plan documents need `preamble.openQuestions` and `preamble.arbitratedQuestions`.
  - **A question is in exactly one array**, and ids are unique across both. An arbitrated question keeps every open-question field, plus `verdict` and `history`.
  - **`verdict` is an explicit per-variant union.**
    - `decided`: `chosen`, `abandoned`, `why`, `advocate`, `principles`, `reversibility` (`cheap | costly | irreversible`), `by` (the operator), `at` and `revised`. A plan's decided verdict also carries `phase`.
    - `lifted`: exactly `chosen`, `abandoned`, `why`, `at` (the marker's date) and `by: { kind: "unattributed" }`.
  - **The decoder's document checks:** `chosen` is a listed option id, and `abandoned` is exactly the unchosen options.
  - **No field becomes optional.**
  - **The authoring answer (`version: 1`) gains the same arrays.** A non-empty `arbitratedQuestions` is an invalid document, exit 5 (§5.60).
- **Files:** `src/schemas/specDocument.ts`, `src/schemas/planDocument.ts` and `src/schemas/persisted.ts`. The spec's lift marker is an exact prefix match on `rationale`: `Decided by the author on <YYYY-MM-DD>`. The `question` suffix is never read.
- **Rendering:** `src/domain/authoring/renderSpec.ts` and `src/domain/authoring/renderPlan.ts`, in §6's after layouts. Wording is indicative.
  - A spec renders `## 9. Open questions`, then `## 9b. Arbitrated questions` with each question's Decision block (lifted verdicts read "lifted, unattributed"), then a decision log when any question is arbitrated.
  - A plan renders `## Open questions`, `## Arbitrated questions` and `## Decision log` in its preamble, each only when non-empty. A 0.20.0 plan therefore keeps its body byte for byte.
  - `src/domain/plan/parsePlanMarkdown.ts` and plan lint must accept these preamble sections and project a rendered plan to the same extracted plan.
  - `scripts/rerender-spec.ts` follows the renderer.
- **Agreement** (`src/domain/artifact/sidecar.ts`) compares a body with its sidecar's rendering at the current shape only.
  - **The single use of today's layout:** today's §9 rendering is kept, frozen and used only by `migrate-documents`, as the 0.17.0 own-shape rendering it checks a body against.
  - **Where that frozen rendering lives is the plan's call**, within the architecture rules.
  - **Status for an unmigrated sidecar:** it prints the stamped shape and the migrate command in place of an agreement value (§5.55), and reports its questions as lifted.
- **Hand-authored §9 parser:** a pure domain parser of §6's "hand-authored §9 in the §9 format".
  - It reads `## 9. Open questions` and `## 9b. Arbitrated questions` for a spec, and the two plan preamble sections for a plan.
  - A question is decided when its last block is a `Decision:` block (§9 Q8).
  - It returns the open and arbitrated questions, or the first line that departs from the format.
  - An artifact with neither section has no questions.
  - The criterion "Hand-authored artifact decided in place" expects bold question headings under `## 9. Open questions for implementation planning` to be reported as departing. That heading must therefore count as a question section that fails to parse, not as no section.
  - Status prints the `Questions:` line when the sections parse. When they don't, it names the departing line and does not fail.
- **Status:** `src/app/artifactStatus.ts` and the CLI status render. §6 sets the layout: `Questions: <n> — open <k> (<ids>) · arbitrated <m> (<l> lifted)`.
- **`phax artifact migrate-documents`:** new, beside `migrate-approvals`. Follow `src/app/migrateApprovals.ts`:
  - **Decide before writing.** Decide everything before writing anything, and refuse with exit 12 and no write on an invalid sidecar, a body that is not its sidecar's own-shape rendering, or uncommitted changes on a path it would write (§5.50, naming each artifact and both remedies as §6 shows).
  - **What it touches.** Live spec and plan sidecars stamped below their current shape only, never archived ones or approval records. It keeps frontmatter, `approved` stamps and approval record files as they are.
  - **Plans.** It re-seeds a rewritten plan's extraction cache with its projection (§5.31), as `src/app/authorArtifact.ts` does, and keeps the plan's lineage (§5.32).
  - **Report** (§5.51): each migrated artifact with its status and question counts; each Approved artifact now edited since approval, with its open ids; each live plan left stale with `spec-changed`.
  - **Commit.** It commits exactly the rewritten paths in one commit. A failed commit exits 12 with the files written (§5.29). With nothing to migrate, it says so and exits 0 with no commit (§5.53).
- **The approve and reopen refusal (§5.54):** while any live spec or plan sidecar is stamped below its current shape, approve and reopen refuse with exit 12 before writing, naming the sidecar and `phax artifact migrate-documents`. They already refuse in the same way while an old approvals ledger exists. Complete and abandon carry an older sidecar as they do today.
- **Phase guard:** `artifact migrate-documents` is classified `refused` in `src/domain/security/phaseGuard.ts`.
- **CLI:** add `migrate-documents` to `phax.usage.kdl` through its source, `src/cli/cliDocs.ts`. Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- **Docs and skills:**
  - **README:** an upgrade note (run `phax artifact migrate-documents` once; what it names), the persisted-formats rows, and the `migrate-documents` command.
  - **Skills:** `.claude/skills/phax-cli/SKILL.md` (migrate-documents, the Questions line, the refusal), `.claude/skills/phax-spec/SKILL.md` (the §9 format with ids and §9b, for hand-authored specs) and `.claude/skills/phax-planning/SKILL.md` (the plan preamble's question sections). The run needs `--allow-skill-edits`, so name exactly these files. The phax-planning generated catalog table is untouched.
  - **NEXT_STEPS.md:** the `artifact-decide` entry notes that plan B shipped the question model and `migrate-documents`.
- **This repository's own live sidecars are not migrated by the run** (the phase guard refuses the command inside it). The operator runs `migrate-documents` after the merge. No phase rewrites a file under `docs/specs/` or `docs/plans/` except its own plan's archival.

Phase shape: as few phases as the gates allow, ordered from the core outwards. A likely split:
1. The two formats, their frozen shapes, lifts, document checks, `next` snapshots and the authoring answer.
2. The renderers, the hand-authored §9 parser, agreement and the status lines.
3. `migrate-documents`, the approve and reopen refusal, the phase guard, usage and CLI docs.
4. README, skills and NEXT_STEPS.

Merge or split phases as the gates require. Every commit must leave the build green. The phase that changes a document shape also changes every writer of that document (the authoring writer, `scripts/rerender-spec.ts`), so each one writes at the new shape.

Constraints:
- The plan's own phases name only models in the installed phax's catalog (`phax agent`): `claude-opus-5-5` (the default) or `claude-sonnet-5-5` for mechanical work.
- Every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- Fixtures and examples are made up. None is copied from this repository's own specs or from another repository.
- It must pass `phax plans lint`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
