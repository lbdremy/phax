# Acceptance criteria coverage

Maps each item from spec §25 to the phase(s) that deliver it.
Items marked with ✓ are exercised end-to-end by `phax run` integration tests
(`tests/integration/executePlan.test.ts`, `setupFailure.test.ts`, `resume.test.ts`).

| #   | Spec §25 criterion                                         | Phase(s)   | Integration test |
| --- | ---------------------------------------------------------- | ---------- | ---------------- |
| 1   | Accept `plan.md` + `plan.json` + config + short name       | 01         |                  |
| 2   | Extract plan via structured Claude output                  | 06         |                  |
| 3   | Validate config and plan before starting any run           | 01, 03     |                  |
| 4   | Create run folder with status files                        | 03         | ✓                |
| 5   | Isolated Git worktree per phase                            | 04         | ✓                |
| 6   | Resolve workspace-aware setup / cleanup / gate commands    | 01, 08     |                  |
| 7   | Run setup commands before the Claude invocation            | 08         | ✓                |
| 8   | Execute phases in order, one at a time                     | 05, 07     | ✓                |
| 9   | Capture artifacts per phase (JSONL, prompt, handoff, diff) | 05, 07, 09 | ✓                |
| 10  | Run gate profile from `phax.json` inside each worktree     | 08         | ✓                |
| 11  | Same-session fix loop on gate failure                      | 08         | ✓                |
| 12  | Stop run if gates still fail after fix loop                | 08         | ✓                |
| 13  | Commit each phase with the planned message                 | 09         | ✓                |
| 14  | Remove non-final worktrees after commit                    | 09         | ✓                |
| 15  | Keep final phase worktree open by default                  | 10         | ✓                |
| 16  | `phax enter` / `enter-last` — resume final Claude session  | 10         |                  |
| 17  | `phax ls` with status filters and JSON output              | 11         |                  |
| 18  | `phax archive` / `archive-last` — safe finalization        | 11         |                  |
| 19  | Final report + `review-handoff.md`                         | 10, 12     | ✓                |
| 20  | No silent failure — all errors surface with diagnostics    | 08, 12     | ✓                |
| 21  | No dirty-worktree overwrite without explicit flag          | 04         |                  |
| 22  | Final worktree never deleted without explicit archive      | 10, 11     |                  |
| 23  | Archive moves artifacts, does not delete them              | 11         |                  |
| 24  | `pnpm audit:architecture` enforces layer doctrine          | 14         |                  |
| 25  | Actionable diagnostics linked to skill correction guides   | 14, 15     |                  |
