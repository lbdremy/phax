Write the phax plan "Readable release notes". It has no source spec: pass no `--spec`, and the frontmatter carries `source-spec: null`. Like `release-notes` (#166, archived plan `docs/plans/archive/2610261154-release-notes-plan.md`), it is repository tooling only. Nothing under `src/` changes.

**Goal.** The notes that `scripts/releaseNotes.ts` writes are hard to read. In 0.28.0:
- a technical code span opens every surface;
- 15 before/after folds are stacked one after another;
- a "Plans:" line says nothing to a reader;
- a "Specs in progress" section talks about work that has not shipped.

The operator decided a new layout on 2026-10-26. Apply it to the builder, the GitHub short body and the site rendering, and keep the reader and the cut as they are.

**The new layout (settled; do not reopen):**
1. **Highlights.** `## Highlights` comes first. It has one bullet per spec announced in full, in the same order as below:
   - `- **<spec name>** — <lede>`, when the spec title has a lede;
   - otherwise `- **<spec name>** — <guiding rule>`;
   - just the bold name when the spec has neither.
2. **Upgrading.** `## Upgrading` comes next and is unchanged.
3. **What's new.** `## What's new` replaces `## Specs`. Each spec keeps its `### <name>` heading, its lede and its guiding rule quote. The `Plans: …` line is removed, always.
4. **Each surface is a bullet, its sentence first.** The bullet reads `- <summary>`. The surface name follows as a short code span, on the bullet's next line or at its end; choose which in Technical arbitrations. The `cli:`, `config:` or `file:` kind prefix is dropped from the displayed name.
   - Settle how a name that holds backticks displays: today it renders as `` `` file: plan sidecar `docs/…` `` ``. Pick a readable rendering.
5. **Examples.**
   - **Now.** The surface's `after` is shown under the bullet, labelled `Now:`, never "After". It is the current state.
   - **Before.** When the surface has a `before`, it is folded under a `<details>` whose summary is `Before`.
   - **New surface.** A surface whose `before` is null has no fold.
6. **Also in this release.** `## Also in this release` replaces `## Plans`: plans without a spec, with the same content as today.
7. **Only what shipped.** Remove everything about artifacts still in progress: the `## Specs in progress` section, and the warnings or refusals that exist only to feed it. A plan with `completes-spec: false` whose spec does not complete in the release is not announced. Say what happens to its run's commits: they still count as run commits and stay out of Fixes and Other.
8. **Fixes and Other.** `## Fixes` and `## Other` stay as they are.

**The GitHub short body.** It keeps the same section structure and the bullets' sentences. It drops every example, the `Now:` blocks and the `Before` folds alike, and keeps the paragraph that links to the site page for the examples. Keep the 125,000-character refusal.

**The site.** `site/build/markdown.ts` turns the builder's `<details>`/`<summary>` blocks into Rspress `:::details` containers, and only the builder's exact form is exempt from the raw-HTML refusal. The `Before` folds and the `Now:` fences may now sit inside list items. Make the site rendering handle the exact shapes the builder writes, keep every other raw HTML refused, and keep the links test (`tests/unit/site/releaseNotesLinks.test.ts`) green.

**What exists (read it first):**
- `scripts/releaseNotes.ts`: `renderReleaseNotes`, `githubReleaseBody`, `fenced`, `specName`, `specLede` and `absolutizeLinks`.
- `scripts/release-notes.ts`, which reads git and the documents and must not need to change beyond what dropping work in progress requires.
- The tests:
  - `tests/unit/releaseNotes.test.ts`, the frozen layout oracles from #166, with fixtures in `tests/unit/releaseNotes/inputs.ts`;
  - `tests/unit/releaseNotesBlocks.test.ts`;
  - `tests/unit/releaseNotesCollect.test.ts`;
  - `tests/unit/site/releaseDocs.test.ts`;
  - `tests/unit/site/releaseNotesLinks.test.ts`.
- `docs/release.md`, which describes the layout and the sections.
- The real 0.28.0 notes: `pnpm release:notes` prints them.

**Constraints:**
- **Expected layout.** Give the full expected 0.28.0 notes in the plan's overview: the Highlights section, the 0.28.0 Upgrading entry as `pnpm release:notes` prints it, and the What's new blocks with the fences elided.
- **Final check.** The closing phase checks that `pnpm release:notes` on its tree matches that expected output.
- **Oracle pair.** Not required. If the layout tests are rewritten in the same phase as the code, say why that is acceptable here. Either way, every layout rule above has its own test.
- **Never run `scripts/release.sh` or a real cut.** Tests use fixtures and temporary copies. Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, or the global git config: use `tests/helpers/isolateGit.ts`.
- **Gates.** The `standard` gate profile verifies every phase, and `phax.json` must allow every command a phase runs. Use `pnpm exec tsx …`, not package scripts the agents are not granted.
- **Models.** Follow the phax-planning skill's model policy.
- **Lint.** The plan must pass `phax plans lint`. Every `### Test strategy` follows the line format, without criterion ids.
- **Skills.** No skill changes, so the run needs no `--allow-skill-edits`.

**Docs:**
- `docs/release.md`: the layout, the sections, and that work in progress is not announced.

**Phase shape:** as few phases as the gates allow, with every commit green. One or two phases are likely enough.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
