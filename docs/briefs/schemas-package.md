Write the phax spec `schemas-package`.

Ground to read first: NEXT_STEPS.md §"Spec candidates" → "Three additive specs…" item 3; src/schemas/ (all modules — identify which describe persisted formats a third party reads: the run registry and status files, records (`phax/records/v1`), `approvals.json`, the compliance and code-review documents, `phax-plan`, the spec and plan document schemas shipped in 0.16.0 — and which are internal); docs/release.md, deno.json and package.json (how phax is built and published today: `tsc` to `dist/`, Deno only for the compiled binaries; `src/` uses `node:` built-ins and npm dependencies, no Deno API); README §"Experimental formats"; NEXT_STEPS.md §"Road to 1.0.0" (the persisted-format stability promise — this package must not freeze more than that promise, and must mark the experimental formats as such); and the consumer: /Volumes/Work/steme/steme-corpus/docs/corpus/01-vision/roadmap-1.0.toml item 0.9 and its `surface` (a read-only cockpit reads records with these types, never with a hand-written parser; the docs pipeline renders JSON schemas as reference pages).

What the spec must cover: the package name (recommend one; `@lbdremy/phax-schemas` is indicative), which schemas are exported and which are explicitly not, the build (an ordinary TypeScript package build from the same sources; state what is lost — nothing at runtime), how the package version tracks phax releases and how the release workflow changes, JSON Schema emission for the docs pipeline if cheap, and how a Node consumer imports and validates a records document end to end (show the call, not a description).

Open questions in §9 with options, losses and a recommended default. Keep to what the first consumer needs; name what is deliberately out of scope (the `app`/`ports` library API, which waits for 1.0).


Decisions taken by the author on 2026-09-28 on the previous draft's §9 — the spec must reflect them, not reopen them. Fold each into the requirements, surface and acceptance criteria. Keep each in §9 as a decided question: the chosen option is the recommendation, and the rationale opens with "Decided by the author on 2026-09-28." Where the author answered off-menu, the answer becomes an option of its own.
- q-name: a separate package, `@lbdremy/phax-schemas`.
- q-effect: a regular dependency on effect, same range as phax.
- q-api: a plain Parsed result (`{ ok, value }` / `{ ok, error: { path, message } }`), the Effect schemas also exported.
- q-excess: parity — each format keeps phax's own excess-property setting.
- q-marking: a separate experimental entry, `@lbdremy/phax-schemas/experimental`.
- q-stable-set: stable — registry, run and phase status, phax-plan, compliance review, both approvals files, the phase record manifest.
- q-version: lockstep with the phax release version.


Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
