Write the phax spec `preflight-before-naming`: a run that phax refuses at preflight never exists — no run folder, no registry entry, no branch, no name held — so the retry gets the plain slug instead of `-2`.

The defect, as recorded in NEXT_STEPS.md (§"Small follow-ups", "`phax run` allocates the run before its preflight", found 2026-09-08; listed under §"Road to 1.0.0" as one of the two known happy-path defects that block 1.0):
- `src/cli/commands/run.ts` picks the name (`ensureUniqueShortName`), then `createRunFolder` writes the run folder and the registry entry, then `executePlan` (`src/app/executePlan.ts`) runs the preflights: required commands (`SecurityPreflightError`), skill-edit consent, `mcp.allow`, the records destination (`checkRecordsRunPreflight`), phase models and efforts (`preflightPhaseModels`), and the clean tree (`prepareRunBranch(…, allowDirty)`). A refusal leaves a `created` run holding the slug, and the retry is renamed `-2` with a warning. In the local registry, 22 of 123 runs carry a numeric suffix, most from exactly this.
- Partly fixed 2026-09-24: the skill-edit consent check runs in `run.ts` before the run is named (`src/app/skillEditConsent.ts`), and `executePlan` keeps its copy to guard `resume`. That is the pattern to generalise.

What the spec must cover:
- Every preflight that needs only the plan, the config, the routing/provider config and the repository (not the run's own state) runs before the name is picked and before anything is written. List each preflight above and say where it runs; say which (if any) genuinely needs the run to exist, and why.
- The clean-tree check: the run branch is created in `executePlan`; say whether the dirty-tree refusal moves before naming (as a read-only check) while branch creation stays where it is.
- `resume` keeps re-checking what can have changed since the run started (the copies stay in `executePlan`); say which.
- The observable contract: on a preflight refusal, the exit code and message are unchanged; no `~/.phax/runs/<ns>.<name>/` folder, no registry entry, no branch, no worktree, no records commit, no telemetry file; `phax runs list` shows nothing new; the next `phax run` of the same plan uses the bare slug. Acceptance criteria per preflight (one per refusal family is enough when they share a path).
- A guard so a future preflight cannot quietly land after naming again (for instance an architectural or unit test pinning the order in `run.ts`).
- Out of scope: freeing names already held by refused runs (that is `phax prune`, a separate spec), the approval-commit staleness defect, and any change to the preflights' own rules or messages.

Ground to read first: NEXT_STEPS.md (the entries above), `src/cli/commands/run.ts`, `src/app/executePlan.ts` (its preflight block before any branch or worktree work), `src/app/runFolder.ts`, `src/app/skillEditConsent.ts`, `src/app/recordsSync.ts` (`checkRecordsRunPreflight`), `src/domain/routing/preflight.ts`, and `phax --usage` (cmd run, cmd resume) for the exit-code contract.

Constraints: no CLI or config change (the CLI contract is about to freeze for 1.0); no persisted-format change. Keep §9 to genuine choices, each with options, what each abandons, and a recommended default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
