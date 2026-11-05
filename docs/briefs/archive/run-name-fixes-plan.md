Write the phax plan for the Approved spec named on the command line (`preflight-before-naming` or `run-prune`). The spec is the source of truth; its §9 questions were all decided by the author on 2026-10-03, each on its recommended option — implement those decisions, do not reopen them.

The two specs are independent and land one after the other (preflight-before-naming first). Neither changes a persisted format or an existing command's contract. Keep the plan small: a few phases, each green on its own, each with a clear commit. Tests come with the code in the same phase (no oracle phases).

Constraints:
- Test documents and fixtures are made up; nothing from `~/.phax` or another repository enters this public repository.
- New CLI surface (run-prune only) goes through `phax.usage.kdl`, `pnpm gen:usage-spec` and `pnpm docs:cli`, as every command does.
- Gate: the plan must pass `phax plans lint`; every phase's commands must be allowed by `phax.json`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
