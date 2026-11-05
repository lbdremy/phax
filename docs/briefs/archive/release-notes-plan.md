Write the phax plan "Release notes from specs". It has no source spec: pass no `--spec`, and the frontmatter carries `source-spec: null`. The plan is repository tooling, not a phax product feature: nothing under `src/` changes, and no phax command, format or schema is added.

**Goal.** At the release cut, write the release notes from what the release's runs delivered, and stop asking GitHub to generate them from pull request titles. Readers care about the surface that changed, not about PR titles.

**Settled on 2026-10-21; do not reopen:**
- **Where it lives.** A repository script under `scripts/`, run by the release cut (`scripts/release-cut.ts`, which `scripts/release.sh` calls). The cut writes `docs/releases/<X.Y.Z>.md`, and that file goes into the release commit. The same file is:
  - the GitHub release body: `.github/workflows/release.yml` stops setting `generate_release_notes` and reads the file;
  - a page on the docs site.
- **Preview.** A package script previews the notes at any time without writing anything.
- **Source chain:**
  - a commit's `Run-Id` and `Short-Name` trailers lead to the run's plan;
  - the plan's `source-spec` and `completes-spec` lead to the spec;
  - from the spec sidecar JSON, the notes use:
    - the `title` text after ` — `;
    - `productGoal.guidingRule`;
    - `surface[]`: `surface`, `summary`, `before` and `after`.
- **Specs.** A spec is announced in full only through the plan that carries `completes-spec: true`. An intermediate plan gets one line, "Part of <spec>: <plan title>".
- **Surfaces.** Keep the `cli`, `config` and published-format surfaces. Each shows its one-line `summary`, with `after` folded into `<details>`.
- **Plans with no spec.** Show the plan title and its first paragraph.
- **Commits with no run.** Keep them as they are, split into Fixes (`fix:`) and Other. Skip `test:` and `chore:`.
- **Upgrading.** The upgrading section comes from `docs/upgrading.md`, the release's `### X.Y.Z` entry, which stays the single source.

**What already exists (read it before planning):**
- **The release scripts.** `scripts/release-cut.ts` prints every repo-relative path it writes, so that `release.sh` stages exactly those; it can be dry-run on a copy with `--root`. Also read `scripts/release-open.ts`, `scripts/releaseVersion.ts`, `scripts/release.sh`, `docs/release.md` and the ledger `packages/schemas/releases.json`.
- **The workflows.** `.github/workflows/release.yml` (the `softprops/action-gh-release` step) and `.github/release.yml` (the PR categories, which become dead once the notes come from the file).
- **The docs site.** `site/pages.ts` maps repository docs to routes, for example `docs/upgrading.md` to `/guide/upgrading`.
- **Run commits.** They carry the trailers `Run-Id`, `Short-Name`, `Phase-Id`, `Model` and `Effort`. A run also adds `chore(plans): complete <slug>` and `chore(specs): complete <slug>` commits, which move the plan and spec into `docs/plans/archive/` and `docs/specs/archive/`. PRs are rebase-merged, so the trailers survive on main.
- **The spec sidecar.** Its surface entries carry a required one-line `summary` since #162. The live and archived specs have summaries; see a18346be.
- **The plan document.** `docs/plans/archive/*-plan.json` sidecars, and the `phax-plan.json` shape.

**Settle in Technical arbitrations, with the dominant loss of each:**
- **Finding a release's runs.** The `Run-Id`/`Short-Name` trailers in `<previous tag>..HEAD`, or the plans and specs archived in that range. Also how a run's plan is found from its short name, and what happens when a trailer names no plan.
- **The previous release.** The ledger's last release or the last tag, and the very first release.
- **Which commit types count as "Other".** In particular `docs:`, `feat:` with no run, and `refactor:`.
- **The site.** How the notes reach the site: one page per release, or an index.
- **What the script does when the inputs are wrong:**
  - a sidecar that does not decode;
  - a `### X.Y.Z` missing from `docs/upgrading.md`;
  - a spec announced in full twice.
- **The Markdown layout of the notes.** Give a complete example of the 0.28.0 notes in the plan. 0.28.0 is the first release cut with this script; it includes `test-strategy` (#164) and `artifact-decide-verdicts` (#165).

**Constraints:**
- **Never run `scripts/release.sh`, and never cut a real release.** The maintainer cuts releases. Tests exercise the cut and the notes on temporary copies or fixture repositories (`--root`). Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, or the global git config: use `tests/helpers/isolateGit.ts` for any git repository a test creates.
- **Fixtures are made up.** Name current-shape `$schema` URLs through the release table, never a hard-coded release.
- **Decode the sidecars through the repository's schemas** (`src/schemas/`), not ad-hoc JSON reads. Older sidecar shapes are lifted the way phax lifts them.
- **Respect the layer audit and knip:** check where scripts may import from and how existing script tests are placed.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Models:** follow the phax-planning skill's model policy, with an `assignmentReason` for any phase that departs from the default.
- **Lint:** the plan must pass `phax plans lint`. Write every `### Test strategy` in the line format; there are no criterion ids, since there is no spec.
- **Oracle pair:** use one only if a phase's guarantees are a stable contract the oracles can call before the code exists. The note builder from fixture inputs is a candidate. If you don't use one, say why.
- **Skill edits:** if no skill changes, say so; the run then needs no `--allow-skill-edits`.

**Docs:**
- `docs/release.md`: the notes step of the cut, and the preview command;
- the README only if it describes release notes;
- `NEXT_STEPS.md`: remove the release-notes item in the closing phase.

**Phase shape:** as few phases as the gates allow, with every commit green. A likely order:
1. the note builder, a pure function from the inputs to Markdown, with its fixtures;
2. reading the git range and the documents, the preview script, and the cut writing `docs/releases/<X.Y.Z>.md`;
3. the workflow, the site page and the docs.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
