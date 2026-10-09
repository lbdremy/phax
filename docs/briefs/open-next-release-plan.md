Write the phax plan for the Approved spec `open-next-release` (`docs/specs/2610081603-open-next-release.md`, with its sidecar `.json`). The spec is the source of truth. Its §9 Q1–Q6 were decided by the author on 2026-10-08, all as recommended: implement them and do not reopen them.

**One plan carries the whole spec, so it completes the spec.** The installed phax is 0.20.0, so the plan carries `completes-spec: true` (it is created with `--last`).

Order: this is the first step of NEXT_STEPS' steme item, before `guarantee-reports` (`docs/specs/2610090907-guarantee-reports.md`, Approved). Implement only this spec: no `gate-report`, no `brief-report`, and no change to `gate-diagnostics` or `brief-answer` beyond what the spec says about how their stamps are written and read.

Decided by §9:
- **Q1:** `release.sh` opens the next minor after tagging.
- **Q2:** the cut refuses any version other than the opened one, and names `scripts/release.sh --open <X.Y.Z>`.
- **Q3:** the ledger gains a release at its cut, in the release commit.
- **Q4:** phax's per-format stamps are a table generated into `src/schemas/release.ts` from the snapshots, with `next` resolved to the opened version, and held by the schemas check.
- **Q5:** providers learn their stamp from the docs and from refusals that name the URL phax reads.
- **Q6:** a development build reports the bare opened version.

Ground that moved since the spec was written, to follow (record each in `## Technical arbitrations`):
- **The rehearsal.** PR #127 is merged. `scripts/release.sh --rehearse <version>` cuts, typechecks, runs `tests/unit/schemasPackage` and `tests/unit/site`, and stops. CI's last step rehearses package.json's next patch. The spec's §5.22 makes it rehearse the opened version package.json names; keep the narrow test set.
- **Format-history tests are written to hold across a cut** (e79dcdd7). They name literal releases rather than `PACKAGE_VERSION`, and the parity test's `releasedShapePath` applies only while a format's current shape is `next`. Once the fallback from `next` goes (§5.5), that mechanism has nothing left to describe. Remove it, along with any test that exists only for the fallback.
- **The two answer readers** (`readGateDiagnosticsAnswer`, `readBriefAnswer`) and their constants. §10 leaves open whether `LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE` and `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` stay. `guarantee-reports` deletes both readers and constants next. Do the least that satisfies §5.6–§5.8 here, and do not refactor them for a future they do not have.

Left to the planner by §10, to decide with its dominant loss in the arbitrations:
- the spelling of `--open`, the stamp table and the messages;
- whether the opening runs tests before pushing, and whether `--open` pushes or only commits;
- whether `docs-deploy.yml` gets the ledger-equals-tag check;
- whether the README's stamped examples join the example-stamp test.

Phase shape: inside-out, each phase green on its own, tests in the same phase (no oracle phases). Suggested; adjust if a boundary is wrong:
1. **The stamp table and the writers.**
   - `scripts/schemas-check.ts` generates the per-format stamp table into `src/schemas/release.ts` and checks it against the snapshots (§5.2).
   - `withSchemaUrl` and every writer stamp the format's current stamp (§5.1). So does the missing-document hint in `src/app/gates.ts` (§5.8).
   - The newer-release refusal compares against the running version (§5.3).
   - Fixtures that stamp `PHAX_RELEASE` where they mean the format's shape are moved to the table.
2. **The readers.**
   - The package's `defineFormat` drops the fallback from `next` (§5.5), and keeps "the latest shape at or below the stamp" (§5.4).
   - phax's answer readers take the format's current stamp as their lower bound and refuse an older shape by name, naming the URL they read (§5.6–§5.8).
   - The development-build refusal stays as it is (§5.11).
3. **The release tooling.**
   - `scripts/release-cut.ts`:
     - cuts only the opened version (§5.15);
     - requires it to be newer than the ledger and appends it (§5.16);
     - renames `next` snapshots and changes no manifest, stamp or example (§5.17).
   - `scripts/release.sh`:
     - opens the next minor after the tag is pushed (§5.12), and offers `--open` (§5.13);
     - prints the remedy when the opening fails (§5.14).
   - Elsewhere:
     - the site's ledger check accepts at or below package.json's version (§5.19);
     - `release.yml` checks that the ledger's last entry equals the tag, before the deploy and the first stage publish (§5.20);
     - CI rehearses the opened version (§5.22);
     - a test holds the hello-world stamps to their formats' current stamps (§5.18).
   - `tests/unit/releaseCut.test.ts` and `tests/unit/releaseWorkflow.test.ts` follow.
4. **The first opening and the docs.**
   - The repository is opened at 0.21.0, with the ledger still ending at 0.20.0 (§5.23). This means the three manifests, the generated mirrors, `phax.usage.kdl` and `docs/cli/reference.md`.
   - `docs/release.md` describes the opening, `--open`, the cut, the rehearsal and the workflow's check. The README's Extend phax describes stamps as shapes.
   - `NEXT_STEPS.md` ticks step 1 of the steme item.

   Do it by editing the files and running the generators, never by running `scripts/release.sh`.

Constraints:
- **Never run the release tooling for real in a phase.** No phase runs `scripts/release.sh` or `--open` on the real tree, and none tags, pushes or publishes. The cut and the scripts are tested on copies of the tree, as `releaseCut.test.ts` does.
- **Run the generators, never hand-edit generated files.** Generated files are regenerated through their scripts (`pnpm exec tsx scripts/schemas-check.ts --write`, `pnpm gen:usage-spec`, `pnpm docs:cli`). Snapshots are never edited by hand.
- **Tests hold across a cut.** They name literal releases, never `PACKAGE_VERSION` or `PHAX_RELEASE` standing for an older release. CI's rehearsal enforces it.
- **Fixtures are made up.** Test documents and fixtures are invented, and nothing from `~/.phax` or another repository enters this public repository.
- **Respect the layers.** No new `node:fs` in `app/`, `domain/` or `cli/`; phax never imports `packages/`.
- **No skill edits.** No `.claude/skills/` edit is expected. If a phase finds a skill that quotes stamps, it reports it in the handoff instead of editing it, so the run needs no `--allow-skill-edits`.
- **Lint and gate.** The plan must pass `phax plans lint`, and every phase is verified by the `standard` gate profile.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
