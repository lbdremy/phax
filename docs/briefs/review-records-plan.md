Write the first phax plan of the spec `headless-code-review` (`docs/specs/2610271007-headless-code-review.md`, approved 2026-10-27). It is not the spec's last plan (`completes-spec: false`). Title it "Review records".

**Scope.** This plan delivers the review entry and the compliance review's use of it:
- §5.24: the compliance review reaches the records;
- §5.25: one entry shape for both reviews;
- §5.26: a records failure never fails a review;
- their acceptance criteria and the records surface (§6, "the run's records on phax/records/v1").

When records are enabled, each generated `compliance-review.json` is committed to the run's records as a run-level review entry, beside the run's phase records. The entry's shape is designed once, so the next plan only plugs `code-review.json` into it.

The next plan, "Headless code review", delivers everything else in the spec, §5.23 included. Do not start any of it here: no `review.code.enabled`, no headless session, no `code-review.json`, and no PR-body heading. The operator confirmed on 2026-10-27 that the compliance review's entry ships in its own plan, before the code review's.

**What exists (read it first):**
- **Writing a phase record:** `src/app/writeRecord.ts`, `src/app/recordPlumbing.ts`, `src/schemas/runRecord.ts`, and `src/domain/records/`. A record is one phase folder, committed under `<run-id>/<phase-id>` on `phax/records/v1` without touching the working tree or the index. The authoring and decision records (`src/app/writeAuthoringRecord.ts`, `src/app/writeDecisionRecord.ts`) are non-phase entries already, so read how they are keyed and manifested.
- **Every reader of the records branch:**
  - `src/app/recordsList.ts`
  - `src/app/recordsExplain.ts`
  - `src/app/recordsStatus.ts`
  - `src/app/recordsSync.ts`
  - `phax records` in `src/cli/commands/`

  A new key under `<run-id>/` must not break any of them. Say what each one does with a review entry: list it, explain it, or ignore it, and choose the smallest change that keeps them correct.
- **The compliance review:** `src/app/reviewCompliance.ts`, `src/app/finalReview.ts` and `src/schemas/complianceReview.ts`. Find where `compliance-review.json` is written, and when that happens relative to the phase records and to the run's records push.
- **The published schemas:** `packages/schemas/` and the release table. A new manifest or entry format gets a `$schema` named at the opened release, 0.29.0.

**Settle in Technical arbitrations, each with its dominant loss:**
- **The entry's key.** The spec gives `<run-id>/compliance-review` and `<run-id>/code-review` as indicative. Make sure no key can collide with a phase id.
- **The manifest.** Whether the entry carries a manifest, and if so what it holds. Keep it the smallest one that lets `phax records` readers tell the review kind apart.
- **When the compliance entry is committed.** At the time the compliance review is generated, or with the run's other records. Also what happens when the run is resumed and the compliance review runs again: the entry's file is replaced, and the earlier one stays in the branch history.
- **How a failure surfaces.** §5.26 says the failure is reported "as `phax records status` reports a pending push". Find what that means in the code, and say which existing path it reuses.

**Constraints:**
- No back-compat shims and no optional fields in persisted shapes. No migration: runs finished before this change get no review entry.
- Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, or the global git config. Use `tests/helpers/isolateGit.ts` for every repository a test creates.
- The layer rules of `pnpm audit:architecture`: records I/O goes through the ports.
- Gates: the `standard` profile verifies every phase, and `phax.json` must allow every command a phase runs.
- Models: follow the phax-planning skill's model policy.
- `### Test strategy`: use the line format, with the spec's criterion ids (the sidecar has them).
- Oracle pair: use one only where the contract is stable before the code exists. Say why if you do not.
- The plan must pass `phax plans lint`.
- No skill changes.

**Docs:** the records documentation (find where `phax/records/v1`'s layout is described for users) gains the review entry. Add a `docs/upgrading.md` 0.29.0 entry only if a user has something to do.

**Phase shape:** as few phases as the gates allow, with every commit green.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
