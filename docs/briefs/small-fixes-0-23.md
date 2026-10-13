Write the phax spec `small-fixes-0-23`: three small, independent fixes taken from NEXT_STEPS "Small follow-ups" and carried by one spec and one short plan.

Why one spec: each fix is too small to justify its own spec and plan, none depends on another, and each is checked by the `standard` gate. Decided by the author on 2026-10-13: bundle these three. Do not add others.

The three fixes:

1. **The phase commit's `Gate-Log` trailer names the attempt that passed.**
   - `src/app/executePlan.ts` passes `join(phaseFolderPath, "checks-attempt-01.log")` to `commitPhase` (`src/app/commit.ts`, which writes `Gate-Log: <path>`), whichever attempt passed.
   - Since gate-attempt-records, a phase's attempts are numbered once across every entry into its gate (`src/domain/gate/attemptFiles.ts`). The passing attempt can be 03, or 07 after a resume.
   - The trailer must name the log of the attempt whose gate passed. Settle what it names for a phase whose gate never ran an attempt in this entry, if such a commit path exists.
   - Nothing in phax reads the trailer today; it is for a person reading `git log`.

2. **Headless authoring retries once on an unusable document.**
   - `src/app/authorArtifact.ts` `parseAuthoredDocument` refuses a session's final message that is not JSON, or that the spec- or plan-document schema refuses. phax then writes nothing, and the whole session (several minutes) is lost.
   - This happened twice: 2026-10-06 (a stray code expression inside an otherwise good 22.9 KB document) and 2026-10-08 (valid JSON missing `acceptanceCriteria[0].refs`). Both reruns succeeded.
   - Fix: on such a refusal, resume the same session once with a prompt that names the refusal (the parse error, or the first schema violation) and asks for the whole document again. If the second answer is refused too, fail as today, naming both refusals.
   - Settle: what the retry prompt carries; that a retry is at most one; what the authoring record and the session folder keep of the first answer; and that a provider error, a rate limit or a usage limit is never retried this way, only a refused document.

3. **The served schemas stop saying a stamp names the release that wrote the file.**
   - `schemaUrlField`'s description in `src/schemas/schemaUrl.ts` reads "the phax release that wrote this file". It is copied into every format's snapshot and served on docs.phax.run. It contradicts the README and `docs/release.md`: a stamp names the release that last changed the format's shape (the open-next-release spec, `docs/specs/archive/`).
   - Rewording it changes every format's snapshot, so every `$schema` stamp would move at once for a description-only change. That forced upgrade is what open-next-release removed.
   - This is the spec's one real choice (§9): whether a description-only change is a new shape. Options include: the snapshot comparison leaves annotations (`description`, `title`, `examples`) out, so the reworded text ships under the existing stamps; or the rewording moves every stamp once; or it waits for a release that changes most formats anyway. Frame each by what it abandons. Note that frozen snapshots under `site/retired-schemas/` and `src/schemas/history/` keep their old wording whatever is chosen, and that a served schema whose text changes under an existing URL is a change to a published URL ("each URL ... stays up for good", README).

Ground to read first:
- `src/app/executePlan.ts` (the `commitPhase` call), `src/app/commit.ts`, `src/app/fixLoop.ts` (what it returns on a pass) and `src/domain/gate/attemptFiles.ts`.
- `src/app/authorArtifact.ts`, `src/domain/authoring/prompt.ts`, `src/domain/authoring/jsonText.ts`, and how the backend resumes a session (`resumeAgentSession`).
- `src/schemas/schemaUrl.ts`, `scripts/release-cut.ts`, `tests/unit/schemasPackage/snapshots.test.ts` and the snapshot check it runs, `packages/schemas/snapshots/`, and `docs/release.md`.
- `NEXT_STEPS.md`, "Small follow-ups": the three entries this spec replaces.

Constraints:
- No back-compat shims in persisted schemas; new fields are required.
- Explicit per-variant enums.
- Respect the layers.
- phax stays autonomous: nothing waits on a person.
- Fixtures and examples are made up.
- Tests hold across a release cut.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
