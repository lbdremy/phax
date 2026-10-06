Write the phax plan for the Approved spec `drop-gate-scopes` (`docs/specs/2610061345-drop-gate-scopes.md`, with its sidecar `.json`). The spec is the source of truth. All ten §9 questions were decided by the author (2026-10-05 and 2026-10-06), and they include:
- the hard drop;
- no dependency on `gate-request`;
- the already-served `gate-pending` URLs kept from a frozen copy, with the docs-site guard unchanged;
- a required `$schema` on the diagnostics document a step prints.

Implement those decisions and do not reopen them. One plan carries the whole spec, so it completes the spec.

Order: `drop-orient` has landed (PR #122). This is the second of the chain, before `gate-request` and then `brief-provider`. Implement only this one: no gate request, no `input` key, no brief.

The hard-drop rules (spec §9):
- No phase adds a shim, migration, dedicated refusal or message, deprecation, upgrade note or "removed" section.
- No test names a leftover `scopes` key or a finding that carries one.
- Nothing reads earlier-release gate files.
- Kept history is as `drop-orient` defined it (`docs/specs`, `docs/plans`, `docs/briefs`, `docs/spikes`, `NEXT_STEPS.md`), and the spec's sweep criterion must be mechanically checkable with `git grep`, which agent commands now allow.

Phase shape: inside-out, each phase green on its own, with tests in the same phase (no oracle phases). Suggested, adjust if a boundary is wrong:
1. **The verdict.** Completion fails like invariant: closure, pending and `missing-provider` are removed from `src/app/gates.ts` and `src/domain/gate/`, and the fix prompt has no pending section.
2. **The diagnostics document's required `$schema`.** Decode supported versions and refuse a newer one by name; a document without one fails the step. Also the saved file, as the spec defines it.
3. **Formats.** The next shapes of `gate-diagnostics` and `gate-attribution` (`result: pass|fail`). `gate-pending` leaves `@lbdremy/phax-schemas`, with the history lock changing exactly as the spec says. The served `gate-pending` URLs are kept from the frozen copy, so the docs-site guard still passes. Snapshots go through `scripts/schemas-check.ts --write`, never by hand.
4. **Config.** `scopes` leaves the config contract and `src/schemas/scopes.ts` goes. Regenerate `phax.schema.json` and `phax.user.schema.json` with `pnpm dev schema upgrade`, and the usage spec and reference with `pnpm gen:usage-spec` and `pnpm docs:cli`.
5. **Docs and the sweep.** The README sections and hook count, the hello-world example (`scopes.mjs` deleted, and `audit.mjs` printing `$schema`), the 1.0 announcement draft, `docs/ideas`, and the `git grep` sweep.

   In `NEXT_STEPS.md`:
   - tick `drop-gate-scopes`;
   - fix the stale spec paths in §"Before steme's audit": `drop-gate-scopes` is now `docs/specs/2610061345-drop-gate-scopes.md`, and `brief-provider` is `docs/specs/2610061346-brief-provider.md` (both re-authored 2026-10-06 for versioned answers);
   - leave the `oracle-phases` wording item open, unless the spec asks this plan to do that sweep.

Constraints:
- Test documents are made up; nothing from `~/.phax` or another repository enters this public repository.
- Respect the layers.
- Keep everything else of the gate as it is: steps, profile order, `surface`, `firing`, `output`, the fix loop, attribution.
- No `.claude/skills/` file mentions gate scopes, so the run needs no `--allow-skill-edits`; a phase that finds one reports it instead of editing it.
- Gate: the plan must pass `phax plans lint`; every phase is verified by the `standard` gate profile.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
