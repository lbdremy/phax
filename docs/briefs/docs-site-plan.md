Write the phax plan for the Approved spec `docs-site` (`docs/specs/2610040828-docs-site.md`, with its sidecar). Its §9 questions were all decided by the author on 2026-10-04, each on its recommended option — implement those decisions, do not reopen them.

Order the phases so each stays green on its own and the gate (`pnpm check:full`) only starts building the site once the build exists: for instance the Rspress skeleton and the page map, then link rewriting and the broken-link check, then the schema routes and the release ledger (with the release cut appending to it), then the identity (tokens with the contrast test, the first geometric logo SVG and favicon), then CI and the gate, then the release-workflow deploy (guard, preview, promotion, manual deploy) and `docs/release.md`'s one-time setup. Tests come with the code in the same phase.

Constraints:
- Phase sessions have no network: every build and test is offline; dependencies a phase adds must be installable from the lockfile the phase writes (say which phase adds `@rspress/core` and runs the install, and that the install command is allowed by `phax.json`).
- No phase deploys, calls Cloudflare, or reads a credential; the deploy steps exist only in the workflows.
- Test documents and fixtures are made up; nothing from `~/.phax` or another repository enters this public repository.
- Gate: the plan must pass `phax plans lint`; every phase's commands must be allowed by `phax.json`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
