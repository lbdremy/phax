Write the phax plan for the Approved spec `guarantee-reports` (`docs/specs/2610091304-guarantee-reports.md`, with its sidecar `.json`). The spec is the source of truth. It has no open §9 question. The author confirmed on 2026-10-09 that `brief.push` is required with no default. Do not reopen it, or anything §10 lists as settled.

**One plan carries the whole spec, so it completes the spec.** The plan carries `completes-spec: true` (it is created with `--last`).

Order: `open-next-release` has landed. The repository is opened at 0.21.0 and the ledger ends at 0.20.0. So the two new formats are born at 0.21.0 through `next` snapshots and the generated stamp table, and so is gate-attribution's new shape. This plan is step 2 of NEXT_STEPS' steme item. The `decision` class (step 3) is not part of it.

Settled here, from what §10 leaves open (record each in `## Technical arbitrations`):
- **brief-record gets a `next` snapshot.** Its `answer` description names `brief-answer` and `parseBriefAnswer`, and the spec leaves no leftover name. The description changes wording only; the keys stay. Loss accepted: brief-record's stamp moves for a description-only change, which is what the NEXT_STEPS entry on served descriptions warns about. A leftover name of a removed format is worse.
- **The vocabulary criterion and README prose.** §5.45's acceptance criterion searches the README's Gate report steps, Gate request and Brief provider sections for whole words, including ordinary English ones: place, instance, leg, debt, baseline. Write those sections without them (no "in place of", no "for instance"). If the criterion is held by a test, the test searches exactly the surfaces §5.45 names, so the rest of the README is free.

Left to the planner, to decide with the dominant loss of each in the arbitrations:
- From §10:
  - the saved report's file name;
  - the wording of the fix prompt, the pushed brief, `phax brief`, the Review notes intro, the run output and the resume instructions;
  - whether the schemas package exports location, guide and finding as named types;
  - whether hello-world's `audit.mjs` and `brief.mjs` share one module.
- The module layout of the shared definitions and the two formats.
- What the gate-failed event carries in place of `diagnostics`.
- How the fix loop knows the previous attempt's report for `still failing`: from the saved report file, or from memory within one gate run. Keep resume in mind, since a resumed gate's previous attempt ran in another process.
- Whether `docs/blog/announcing-phax-1.0.md` is touched. It mentions the brief config, so read it and decide; do not edit any other blog post.

Phase shape: inside-out, each phase green on its own, tests in the same phase (no oracle phases). A format is removed in the phase that stops reading it, so no phase leaves a dead format behind or removes one still in use. Each phase moves the hello-world script it touches, together with its test. The suggested phases are below; adjust any boundary that is wrong, and split the gate phase if it is too big for one agent session:
1. **The shared definitions and the two formats.**
   - Schemas and decoders: strict keys at every level (§5.9), unique finding ids (§5.7), ordered lines (§5.8), the gate report's two outcomes (§5.11) and the brief report's single shape (§5.12).
   - Registration as persisted formats with `next` snapshots.
   - The schemas package's `gate-report` and `brief-report` formats, with identical location, guide and finding definitions (§5.43).

   The old formats stay in this phase.
2. **The gate.**
   - The step `output` value `gate-report`, with `diagnostics` refused at exit 2 (§5.3).
   - The verdict rules and the broken step (§5.13–§5.18).
   - The refusal through the reused gate-failure pause (§5.19–§5.23), and gate-attribution's `refused` with its `next` snapshot.
   - Each readable report saved as printed (§5.40), and `records explain --gates` (§5.42).
   - The fix prompt: findings, guides, `still failing`, nothing else, nothing granted (§5.24–§5.28).
   - The hello-world `audit.mjs`, the gate step in its `phax.json`, and `guides/no-node-import.md`.
   - Then `gate-diagnostics` goes entirely:
     - its schema, reader and LAST_* constant;
     - the expected-shape hint;
     - the `.diagnostics.json` write and its path helper;
     - the event's diagnostics;
     - the package format, its frozen history modules and lock entries;
     - its snapshots, which become frozen copies under `site/retired-schemas/gate-diagnostics/`.
3. **The brief.**
   - `brief.push`, required (§5.29).
   - The brief provider reads the brief report.
   - The pushed brief in both modes, with the cap and the nothing-to-push line (§5.30–§5.33).
   - `phax brief` prints the whole report (§5.34), and a declining or unreadable brief is a failed brief (§5.35).
   - Records as printed (§5.41), and the brief-record snapshot.
   - The hello-world `brief.mjs` and the `brief` block in its `phax.json`.
   - Then `brief-answer` goes entirely, the same way as `gate-diagnostics`.
4. **Review notes.** The `## Review notes` section in the review handoff and the PR body, from each phase's last gate attempt's saved reports (§5.36–§5.39).
5. **The docs.**
   - The README sections and the Persisted formats rows (§5.45, §5.47).
   - The `phax --usage` contract text and the phax.json config descriptions, regenerated through their scripts.
   - The `phax-cli` and `phax-planning` skills where they mention diagnostics, the gate's output or the brief: `.claude/skills/phax-cli/SKILL.md` and `.claude/skills/phax-planning/SKILL.md`. The run is started with `--allow-skill-edits`, so declare both files in the phase.
   - NEXT_STEPS ticks step 2 of the steme item.

Constraints:
- **The gate and brief requests keep their shapes and stamps.** No change to `gate-request` or `brief-request`.
- **phax judges nothing in a report.** Decode checks are structural only. phax reads no guide file, checks no file's existence and computes no due.
- **phax loads nothing and grants nothing.** No skill-loading flag to any provider, no file added to the worktree, and no command granted because a report or guide names it.
- **No shim and no leftover name** for `gate-diagnostics`, `brief-answer` or `"output": "diagnostics"`. The only exceptions are the frozen copies under `site/retired-schemas/` and archived docs.
- **Explicit per-variant enums:**
  - the gate report's outcome;
  - `due`;
  - `brief.push`;
  - gate-attribution's result.
- **Never run the release tooling for real in a phase.** No phase runs `scripts/release.sh`, cuts, tags, pushes or publishes.
- **Run the generators, never hand-edit generated files.** Use `pnpm exec tsx scripts/schemas-check.ts --write`, `pnpm gen:usage-spec` and `pnpm docs:cli` as needed. Snapshots are never edited by hand, and each frozen copy is byte-identical to what the site serves today.
- **Tests hold across a cut.** They name literal releases or the formats' current stamps, never `PACKAGE_VERSION` or `PHAX_RELEASE` standing for an older release. CI's rehearsal enforces it.
- **Fixtures are made up.** Test documents, guides and fixtures are invented, and nothing from `~/.phax`, steme or another repository enters this public repository.
- **Respect the layers.** No new `node:fs` in `app/`, `domain/` or `cli/`; phax never imports `packages/`.
- **Lint and gate.** The plan must pass `phax plans lint`, and every phase is verified by the `standard` gate profile.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
