Write the phax spec `open-next-release`: the release script opens the next version as soon as it tags a release, so a `$schema` stamp names exactly one shape at every commit, and the tests and readers stop depending on whether a cut has happened yet.

Why (raised 2026-10-08, after the 0.20.0 release gate failed, as 0.19.0's had): during a development cycle the root `package.json` still names the last release, say 0.19.0, so a document stamped 0.19.0 means two shapes. The released 0.19.0 wrote one, and a development build writes the shape in progress (`next`). Everything below exists to cope with that, and all of it changes meaning at the cut:
- The schemas package (`packages/schemas/src/shapes.ts`, `defineFormat`) reads a document stamped at its own version with `next` first, then falls back to the latest released shape. The fallback only exists before a cut.
- phax's answer readers (`readGateDiagnosticsAnswer`, `readBriefAnswer` in `src/schemas/persisted.ts`) accept an answer stamped at the running release "as the next shape" beside the ones newer than `LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE` / `LAST_RELEASE_WITHOUT_BRIEF_ANSWER`.
- Tests written mid-cycle relied on the fallback (stamped at `PACKAGE_VERSION`, read as shape 0.17.0) and broke at the 0.20.0 cut (fixed in `e79dcdd7`). PR #127 now rehearses a cut in CI, which catches such tests; this spec removes the ambiguity they rely on.
- External providers are hit too: steme answering in the cycle's new answer shape would have to stamp 0.19.0. The installed 0.19.0 would then read it with the old shape, silently, instead of refusing it as newer.

The idea, to specify: right after `scripts/release.sh` tags and pushes X, it commits "open X+1": the root, `npm/` and `packages/schemas/` manifests name an unreleased version, which development builds stamp. No released document ever carries that stamp, so `next` is unambiguous, the fallback and the answer readers' running-release exception go away, and a stamp from a provider written against the cycle's shapes is refused by the installed release as newer.

What the spec must cover:
- **The opened version.** Next patch, next minor, or chosen when opening. And what happens when the release that ships is not the opened one (0.20.1 opened, 0.21.0 cut): refuse and re-open first, or re-stamp at the cut, and what becomes of documents development builds wrote under the opened version.
- **The cut** (`scripts/release-cut.ts`). Today it requires a version newer than `package.json`'s and a ledger whose last entry is `package.json`'s version. Say what both become when `package.json` already names the version being cut, and when the release ledger gains it.
- **What the opened version changes for each reader.**
  - The package's `defineFormat`: drop the fallback.
  - The bridge in `src/schemas/persisted.ts`.
  - The two answer readers: drop the running-release exception, keeping the "newer than the last release without it" rule.
  - The newer-release refusal: a development build reading the installed release's files must still work.
  - `FIRST_SUPPORTED_RELEASE` and the development-build message.
- **What `phax --version`, `phax.usage.kdl` and the docs report** in a development build, and whether anything marks it as unreleased.
- **The docs site and the release workflow.** The site serves schemas from the release ledger, and its test expects the ledger to end at `package.json`'s version. `release.yml` checks that both manifests match the tag. Neither may start serving or publishing the opened version.
- **The hello-world example stamps** (`audit.mjs`, `brief.mjs`), which the cut rewrites today.
- **The rehearsal** (PR #127): whether it still rehearses "the next patch", or the opened version.
- **Migration:** how the first opened cycle starts from 0.20.0, and which tests and docs change (`docs/release.md`, the `schemas-package` decision q-release-name, which this amends).
- **Out of scope:** pre-release suffixes (`-dev`; the release workflow refuses them and `$schema` URLs name `X.Y.Z`), automated version choice from commit messages, and any change to how released phax reads older releases.

Ground to read first:
- NEXT_STEPS.md;
- `docs/release.md`, `scripts/release.sh`, `scripts/release-cut.ts` and `tests/unit/releaseCut.test.ts`;
- `.github/workflows/release.yml` and `ci.yml`, and `tests/unit/releaseWorkflow.test.ts`;
- `packages/schemas/src/shapes.ts` (`defineFormat`), `packages/schemas/src/generated/index.ts` and `packages/schemas/releases.json`;
- `src/schemas/persisted.ts` and `src/schemas/release.ts`;
- `tests/unit/schemasPackage/` and `tests/unit/site/schemas.test.ts`;
- the archived `schemas-package` spec (`docs/specs/archive/2609241238-schemas-package.md`: q-release-name and q-support-start);
- commit `e79dcdd7`.

Constraints:
- No back-compat shims in persisted schemas.
- No change to any published format's shape.
- Every `$schema` stays `X.Y.Z`.
- Files the installed release wrote stay readable by a development build.
- §9: genuine choices only. Each comes with its options, what each abandons, and a recommended default. At least: which version to open, a release that is not the opened one, and when the ledger gains a release.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
