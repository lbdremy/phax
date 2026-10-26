---
status: Approved
source-spec: null
approved:
  date: 2026-10-26
  baseline: 50446ba
---
# Release notes from specs

At the release cut, phax's release notes are written from what the release's runs delivered: each completed spec with its guiding rule and the surfaces it changed, each plan without a spec, the commits made outside any run, and the release's upgrade steps. The cut writes them to `docs/releases/<X.Y.Z>.md` in the release commit, the same file becomes a page of the docs site, its short form (the file without its folded before/after blocks, plus a link to that page) becomes the GitHub release body, and `pnpm release:notes` previews them at any time without writing anything.

This is repository tooling only: nothing under `src/` changes, and no phax command, format or schema is added. There is no source spec. No phase edits a skill, so the run needs no `--allow-skill-edits`.

Four phases, every commit green:

- phase-01 (oracle phase): the note builder's input types, stubs, and the oracles that freeze the Markdown layout and the GitHub body's short form from made-up inputs.
- phase-02 (its discharge): `renderReleaseNotes` and `githubReleaseBody`, the pure builders in `scripts/releaseNotes.ts`.
- phase-03: `scripts/release-notes.ts` reads the git range, the plans, the specs and `docs/upgrading.md`. `pnpm release:notes` previews the notes, the cut writes `docs/releases/<X.Y.Z>.md`, and CI's checkout fetches the history and tags that its release rehearsal now reads.
- phase-04: the release workflow publishes the file's short form as the GitHub release body, the docs site renders one page per release, `docs/release.md` documents it, and `NEXT_STEPS.md` drops the item.

Operator notes:

- Never run `scripts/release.sh`, and cut no release from a phase. The phases exercise the cut and the notes on temporary copies and fixture repositories only.
- Land this run before cutting 0.28.0, so that 0.28.0 is the first release cut with the script. After the merge, run `pnpm release:notes` on main and read the notes before cutting.
- 0.28.0's notes, built on main once this plan's run has landed, should read as below. The `before` and `after` blocks hold the sidecar's text verbatim; here they are shortened to `…`, as is the Upgrading section after its first bullet. Fixes lists the three review fixes pushed onto the #164 and #165 branches before review fixes carried a `Short-Name` trailer; any later commit in the range is listed by the same rules, and a review fix of this run that carries `Short-Name: release-notes-from-specs` joins it and is not listed. No warning is expected. The GitHub release body is the same document without its `<details>` blocks, with the paragraph `Read the full notes, with each surface's before and after, on [docs.phax.run/releases/0-28-0](https://docs.phax.run/releases/0-28-0).` after the Changes line.

````markdown
# phax 0.28.0

Changes since 0.27.0: [v0.27.0...v0.28.0](https://github.com/lbdremy/phax/compare/v0.27.0...v0.28.0).

## Upgrading

- **A spec or plan option named `other`.** `other` is now a reserved id, implicit on every question. … (the rest of the `### 0.28.0` entry of `docs/upgrading.md`, verbatim)

## Specs

### Test strategy as data, and the plan overview

> The overview shows what the plan says, read without a model, and it never writes or starts anything.

Plans: Test strategy as data.

`` file: plan sidecar `docs/plans/<stamp>-<slug>-plan.json`, phase `testStrategy` `` — A plan's test strategy is a list of test lines a tool can read, each with its size, technique, oracle, loop and the criterion it proves.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

`` file: `phax-plan.json`, phase test lines `` — The extracted plan carries each phase's test lines, so scripts and later commands can see what each phase tests.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

`` file: plan.md `### Test strategy` section `` — You write each test of a phase as one line (the guarantee, then size, technique, oracle, loop and an optional criterion), and phax reads it.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

`cli: phax plans lint <plan> — new test line findings` — plans lint names the test lines that break the format, misuse the oracle loop or cite a criterion the spec lacks, and the spec criteria no test proves.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

`cli: phax plans overview <plan> [--json]` — You can see a whole plan at a glance before running it: each phase's model, oracle role, files and tests.

<details>
<summary>After</summary>

```text
…
```

</details>

`cli: phax plans overview — rendered layout` — The overview lists each phase in turn with its model, its oracle role, its files grouped by architecture part and its test lines.

<details>
<summary>After</summary>

```text
…
```

</details>

`cli: phax plans overview --json` — A script or review tool can read the plan overview as JSON.

<details>
<summary>After</summary>

```text
…
```

</details>

`cli: phax artifact migrate-documents — refusing a prose test strategy` — migrate-documents names each plan whose test strategy is still prose, and says how to rewrite it in the line format.

<details>
<summary>After</summary>

```text
…
```

</details>

`file: .claude/skills/phax-planning/SKILL.md` — Agents writing plans with the phax-planning skill write test strategies in the line format that lint checks and the overview shows.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

### Artifact decide from verdicts

Transcribing decisions already made.

> The person decides and phax checks the transcription: what the file says is applied as given, nothing it does not name moves, and nothing is approved.

Plans: Decide from verdicts.

`cli: phax artifact decide --verdicts` — You can record decisions you have already made on a spec's or plan's questions from a file, without an interactive session.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

`file: verdicts file (given as --verdicts <file|->)` — You write your decisions in one small file that names, for each question, the option you chose and an optional note.

<details>
<summary>After</summary>

```text
…
```

</details>

`` file: docs/specs/<stamp>-<slug>.json a verdict choosing `other`, and the rendered §9 `` — You can choose none of a question's options and say what you want instead, and the spec shows that choice and why.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

`cli: phax artifact schema verdicts` — You can print the verdicts file's JSON Schema to check or generate a verdicts file.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

`cli: phax artifact decide --verdicts --json` — A script can read what decide recorded: each verdict, whether it departs from the recommendation, and which sections changed.

<details>
<summary>After</summary>

```text
…
```

</details>

`cli: the decide commit (git log)` — The decide commit says the decisions came from a verdicts file, and who made them.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

`file: decision record on phax/records/v1` — The records say a decision was transcribed from a verdicts file, which questions it settled and how many departed from the recommendation.

<details>
<summary>Before and after</summary>

Before:

```text
…
```

After:

```text
…
```

</details>

## Plans

### Release notes from specs

At the release cut, phax's release notes are written from what the release's runs delivered: each completed spec with its guiding rule and the surfaces it changed, each plan without a spec, the commits made outside any run, and the release's upgrade steps. The cut writes them to `docs/releases/<X.Y.Z>.md` in the release commit, the same file becomes a page of the docs site, its short form (the file without its folded before/after blocks, plus a link to that page) becomes the GitHub release body, and `pnpm release:notes` previews them at any time without writing anything.

## Fixes

- fix(plans): give headless planning the spec's criterion ids; guard source-spec paths; review fixes for #164 ([507fc53](https://github.com/lbdremy/phax/commit/507fc536099ae0d010104398ec67d92406efe533))
- fix(decide): restore a recommendation after a departure in verdicts mode ([508dd1c](https://github.com/lbdremy/phax/commit/508dd1c316ab73c88a4cf1880367093eab9f26f5))
- fix(decide): refuse a Vibe writer, any non-operator --by and a terminal stdin ([0fc83a2](https://github.com/lbdremy/phax/commit/0fc83a2666c19b0e0e39e7c22a5e17abbf14caf8))
````

## Required commands

- (none)

No new command is needed. The phases run the `standard` gate profile's commands and commands `phax.json` already allows: `git log` to read history, and `pnpm exec tsx scripts/release-notes.ts` to preview the notes. Agents are granted `pnpm exec tsx`, not the new `pnpm release:notes` script, so they use the `pnpm exec tsx` form. `phax.json` needs no change. No phase edits a skill, so the run needs no `--allow-skill-edits`.

## Technical arbitrations

- Finding a release's runs: the run trailers, matched to the plans archived in the same range. The runs are the distinct `Short-Name` values of the non-merge commits in `v<previous>..HEAD` that carry both `Run-Id` and `Short-Name`, in order of their first commit. A run's plan is a plan that meets three conditions:
  - it was added under `docs/plans/archive/` between `v<previous>` and HEAD (`git diff --name-only --no-renames --diff-filter=A`);
  - its frontmatter status is `Completed`;
  - its run short name equals the trailer. This is the name phax gives the run. With a sidecar, it is `slugifyShortName(run.shortName)`, or else `slugifyShortName(run.title)` (`src/domain/branded.ts`, as `src/domain/plan/finalize.ts` does). Without a sidecar, it is the plan's `# ` title, slugified the same way.

  A run whose short name matches no such plan gives one warning, and its commits are listed with the commits without a run. A completed plan archived in the range that no run names gives one warning and is not announced. Two such plans with the same short name are refused.

  A commit that carries `Short-Name` but no `Run-Id` is a review fix pushed onto that run's pull request branch (operator decision, 2026-10-26). When its short name is a run of the range, it joins that run and is listed nowhere. Otherwise it gives the warning `<short hash>: Short-Name <name> names no run since v<previous>: it is listed as a commit without a run`, and it is sorted by its type like any commit without a run. `docs/release.md` states the convention: a review fix pushed onto a run's pull request branch carries `Short-Name: <run short name>` and no `Run-Id`. Loss accepted: a review fix whose trailer was forgotten is listed in Fixes, and a real fix of older code made in the same commit as a review fix is not announced; the three review fixes of 0.28.0 predate the convention and are listed in Fixes.

  Loss: a plan completed by hand, with no run commit in the range, is never announced. Reading the archive alone would have lost which commits belong to a run, so run commits could not be kept out of Fixes and Other.
- The previous release is the ledger's greatest release below the version being noted (`packages/schemas/releases.json`, read with `readLedger`), and the range starts at its tag `v<previous>`. A missing tag is refused, and the refusal names `git fetch --tags`. A version with no ledger release below it is refused too. The ledger has held every release since 0.17.0, so no first-release mode is built. Loss (against taking the last tag): the notes need the previous release's tag in the clone, so a shallow clone cannot build them. In exchange, a stray or out-of-order tag can never move the range.
- The cut builds the notes before its first write. `cutRelease(repoRoot, version, notes)` takes a function and calls it after its existing refusals and its new refusal of an existing `docs/releases/<version>.md`. It writes the returned Markdown after the ledger and lists the path among the changed ones, so `release.sh` stages it with the rest. The cut's own entry builds the notes from git: it loads `scripts/release-notes.ts` with a dynamic import, so the two scripts form no static import cycle. Tests pass a function instead. CI rehearses the cut on every push and pull request, so `ci.yml`'s checkout sets `fetch-depth: 0`, and every pull request then proves that the opened version's notes build. Loss: `release-cut.ts --root` no longer dry-runs on a plain copy of the files, only on a clone with the tags, and CI checks out the whole history on every run.
- Commits without a run are sorted by the subject's type, its leading word read case-insensitively before an optional `(scope)`, an optional `!` and `: `:
  - `fix` goes to Fixes;
  - `test`, `chore`, `docs`, `refactor`, `style`, `build` and `ci` are left out;
  - `feat`, `perf`, `revert`, any other type, and a subject with no conventional prefix go to Other.

  Loss: a user-facing docs change made outside a run, such as a new guide page, is not announced. In 0.28.0's range every `docs:` commit is a brief, a plan draft or a NEXT_STEPS update, and the docs site shows the guide itself.
- The published-format surfaces are the `file:` elements, since the phax-spec skill gives `file:` to whatever a reading tool or person consumes. The notes keep the `cli:`, `config:` and `file:` elements, and leave out `api:`, `package:` and `internal:`. Loss: a `file:` element that names an internal file, such as a skill, is shown too, and a `package:` element of the schemas package is not.
- Reading the documents:
  - A plan's status, `source-spec` and `completes-spec` come from its frontmatter, through `readPlanFrontmatter` (`src/domain/artifact/lineage.ts`).
  - Its title and first paragraph come from its plan.md body: the text of the first level-1 heading, and the source of the first paragraph after it.
  - Its sidecar, when it has one, is decoded through `readDocumentSidecar`, and only to get the run short name.
  - A spec is looked up at its `source-spec` path, then at `archivePathFor` of that path. Its sidecar is decoded through `readDocumentSidecar`, which lifts older shapes as phax does.
  - A spec without a sidecar is announced by its `# ` title alone, with one warning.

  Loss: a hand-written spec gets no guiding rule and no surfaces in the notes. A plan without a sidecar gets `slugifyShortName` of its `# ` title as its run short name. That is a guess, since a hand-written plan's run takes its short name from model extraction (`src/domain/plan/finalize.ts`); its run then shows as unmatched, with both warnings. The impact is low: every plan archived since 0.24.0 has a sidecar.
- These inputs are refused with exit 1, and the cut writes nothing:
  - a plan or spec sidecar that is not JSON or does not decode;
  - a plan with no frontmatter, or one that does not decode;
  - a plan with no `# ` title;
  - a source spec found at neither of its paths;
  - two completed plans with the same run short name;
  - a spec announced in full twice (two plans in the release that both say `completes-spec: true`);
  - a kept surface element that still holds the placeholder summary;
  - a previous release with no tag;
  - a missing `docs/upgrading.md`;
  - at the cut, an existing `docs/releases/<version>.md`;
  - a GitHub release body longer than 125,000 characters (see the GitHub body arbitration).

  These only print a warning on stderr, and the notes are still written:
  - no `### X.Y.Z` entry in `docs/upgrading.md`, which gives no Upgrading section, since that file lists only the releases that ask for something;
  - a spec without a sidecar;
  - a run that names no completed plan;
  - a completed plan that no run names;
  - a `Short-Name`-only commit that names no run of the range;
  - a link in the Upgrading entry or in a plan's first paragraph that leaves the repository, which is kept as written.

  The refusals hold everywhere, the CI rehearsal on every push and pull request included (operator decision, 2026-10-26). Loss: one broken document blocks the cut until it is fixed, and turns every pull request red until then, unrelated ones included. The CI rehearsal surfaces the problem on the pull request that causes it, not at release time.
- The Markdown layout, which phase-01's oracles freeze; the example in the overview is 0.28.0's. Blocks are joined by one blank line, and the file ends with one newline (`finishDocument` in `src/domain/authoring/markdown.ts`). The sections come in this order, each only when it lists something:
  - `# phax <version>`, then `Changes since <previous>: [v<previous>...v<version>](<repository>/compare/v<previous>...v<version>).`
  - `## Upgrading`: the lines under the level-3 heading whose text is `<version>` in `docs/upgrading.md`, up to the next heading of level 1 to 3 or the end of the file. Leading and trailing blank lines are dropped. Every other byte is kept, except link destinations, inline or in definitions:
    they are made absolute at the tag, by the link rule below, with `docs/upgrading.md` as their source.

    Without the entry, the section is left out, with the warning `docs/upgrading.md has no "### <version>" entry: the notes have no Upgrading section`.
  - `## Specs`: one block per plan with `completes-spec: true`, in plan order:
    - `### <name>`, where the name is the spec title up to its first ` — `, or the whole title when it has none;
    - the rest of the title, with its first character upper-cased and ended as a sentence (`sentence`), as a paragraph;
    - the guiding rule as a quote, each line prefixed `> `, when the spec has one;
    - `Plans: <title>, <title>.`, listing every plan of the release with that spec in plan order, ended as a sentence;
    - then each `cli:`, `config:` or `file:` element, in sidecar order. First comes a paragraph `<inlineCode(surface)> — <summary>`. Then comes a block that opens with `<details>` and, on the next line, `<summary>After</summary>` followed by a fenced `after` when `before` is null; otherwise `<summary>Before and after</summary>`, followed by `Before:`, a fenced `before`, `After:` and a fenced `after`. The block ends with a blank line and `</details>`. Each fence is tagged `text` and is one backtick longer than the longest backtick run in its content, with a minimum of three.
  - `## Specs in progress`: `- Part of <name>: <plan title>` for each plan with `completes-spec: false` whose spec is not announced in full in the same release.
  - `## Plans`: for each plan without a source spec, `### <plan title>`, then its first paragraph as written, except its link destinations, inline or in definitions, made absolute at the tag by the link rule below, with the plan's path (`ReleasePlan.path`, its archived path) as their source.
  - `## Fixes`, then `## Other`: `- <escaped subject> ([<first seven characters of the hash>](<repository>/commit/<full hash>))`, oldest first. The subject is escaped by putting a backslash before each of `\`, `` ` ``, `*`, `_`, `[`, `]`, `<`, `>`, `&`, `~` and `|`, so GitHub and the site show it as written.

  The link rule, for a destination written in a source file at the tag:
  - a destination with a URL scheme (`https:`, `mailto:`, …) is kept;
  - `#x` becomes `<repository>/blob/v<version>/<source>#x`;
  - a destination with a leading `/` becomes `<repository>/blob/v<version>/` followed by the destination without its leading slashes, POSIX-normalised, its fragment kept;
  - any other becomes `<repository>/blob/v<version>/` followed by the POSIX-normalised join of the source's directory and the destination, its fragment kept;
  - a destination that normalises outside the repository (`..` or `../…`) is kept as written, with the warning `<source>: the link <destination> leaves the repository and is kept as written`.

  Refusals are checked before rendering, duplicates first:
  - `<spec path> is announced in full twice: <plan path> and <plan path> both say completes-spec: true`
  - `<spec path>: the surface element "<surface>" still has the placeholder summary — write it before the release`

  Headings go through `headingText`. GitHub renders the `<details>` blocks as they are. Loss: a surface name that holds backticks shows them literally inside its code span. Links in the Upgrading section and in a plan's first paragraph open the file on GitHub at the tag, not the docs site page. A relative link a plan wrote before it was archived resolves from `docs/plans/archive/`, as GitHub resolves it in the archived file, so a link that was already broken there stays broken.
- The site renders one page per release. Each `docs/releases/<X.Y.Z>.md` becomes `/releases/<X-Y-Z>`, with dots turned into hyphens as in the preview alias, titled `phax <X.Y.Z>`. The pages are listed newest first in a `Releases` sidebar group with its own nav entry. The site build generates them from the files present, so no release edits `site/pages.ts`. A file under `docs/releases/` that is not named `X.Y.Z.md` is a build finding. The site still refuses raw HTML, except the builder's `<details>`/`<summary>` blocks in release notes, which become Rspress `:::details <summary text>` containers. A test under `tests/unit/site/` runs the site's link check over every real `docs/releases/*.md`, so the rehearsal and the real cut, which both run that directory after the cut writes the notes, refuse a notes file whose links the site build would refuse. Loss: no single page lists every release's notes, and the fold on the site depends on Rspress's container syntax rather than the HTML GitHub shows.
- One oracle pair, phase-01 to phase-02, covers the note builder and the GitHub body's short form. Its input is decoded facts and its output is a Markdown document that the layout above states exactly. So `renderReleaseNotes` is a stable entry the oracles can call before the code exists, and the layout is frozen before the code that writes it. The reader (phase-03) is not paired: its behaviour depends on git and on the documents on disk, so it is tested in-phase on fixture repositories. Loss: one more phase and gate than a three-phase plan.
- The release workflow checks the notes before anything is built or published. A `Verify the release notes` step, placed directly after the checkout, refuses a missing or empty `docs/releases/${RELEASE_TAG#v}.md`, naming the file and `scripts/release-cut.ts`. A `Write the GitHub release body` step (id `notes`), placed directly after `Install dependencies`, runs `pnpm exec tsx scripts/release-notes.ts --github-body "docs/releases/${RELEASE_TAG#v}.md" > "$RUNNER_TEMP/release-body.md"` and outputs that path; a body over the limit fails it before the gate and the binary builds. The GitHub Release step reads that file with `body_path` and no longer sets `generate_release_notes`. `.github/release.yml`, whose categories only GitHub's generated notes read, is deleted. Loss: a release commit without its notes file now fails the workflow at its first step, where GitHub would have generated notes.
- The GitHub release body is always the notes' short form (operator decision, 2026-10-26), since GitHub caps a release body at 125,000 characters and 0.28.0's before/after blocks alone come to about 18,000. `githubReleaseBody(markdown, version)` in `scripts/releaseNotes.ts` derives it from the notes file, deterministically and with no other input:
  - it removes every folded block the builder writes: from a top-level `html` node whose value starts with `<details>` through the next top-level `html` node whose value is `</details>`, both included, found with `mdast-util-from-markdown` so that a `<details>` line inside a fence never counts, together with the blank line that precedes the block, so blocks stay joined by one blank line;
  - it inserts, as its own paragraph directly after the `Changes since` paragraph, `Read the full notes, with each surface's before and after, on [docs.phax.run/releases/<X-Y-Z>](https://docs.phax.run/releases/<X-Y-Z>).`, where `<X-Y-Z>` is the version with its dots turned into hyphens;
  - every other byte is kept, and the result ends with one newline;
  - a result longer than 125,000 characters, counted in code points, is refused with `the GitHub release body of <version> has <n> characters, over GitHub's limit of 125000 — shorten the notes`; exactly 125,000 passes.

  `scripts/release-notes.ts --github-body <notes file>` prints it on stdout; the version comes from the file's name, which must be `X.Y.Z.md`. The docs site page keeps the full notes. Loss: the release body and the site page are two renderings of one file, so a reader on GitHub follows a link to see a surface's before and after.

---

## phase-01 — Oracles for the release notes builder {#phase-01-notes-oracles}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Oracle phase:** discharged by phase-02
**Oracle files:** `tests/unit/releaseNotes.test.ts`, `tests/unit/releaseNotes/inputs.ts`

The release notes builder gets a contract before it gets code. `scripts/releaseNotes.ts` declares the input types and a stub of `renderReleaseNotes`. Oracle tests, marked as expected failures, state the exact Markdown, warnings and refusals the builder must produce from made-up inputs.

### Detailed instructions

- Read the layout arbitration, the GitHub body arbitration and the 0.28.0 example in the plan preamble first: the oracles encode them byte for byte.
- Create `scripts/releaseNotes.ts`, a pure module (no `node:fs`, no `node:child_process`, no `process`), in the style of `scripts/releaseVersion.ts`. Its header comment says it is pure and that `scripts/release-notes.ts` gathers its input. It exports exactly these types and the two functions:

  ```ts
  export interface ReleaseNotesInput {
    readonly version: string; // the release, X.Y.Z
    readonly previous: string; // the previous release, X.Y.Z
    readonly repository: string; // e.g. https://github.com/lbdremy/phax, no trailing slash
    readonly upgrading: string; // the whole text of docs/upgrading.md
    readonly plans: ReadonlyArray<ReleasePlan>; // the plans the release's runs delivered, in run order
    readonly commits: ReadonlyArray<ReleaseCommit>; // the commits outside any announced run, oldest first
  }
  export interface ReleasePlan {
    readonly path: string; // repo-relative plan.md path, for messages
    readonly title: string; // the plan's # heading, plain text
    readonly firstParagraph: string; // the first paragraph under the title, raw Markdown
    readonly spec: ReleaseSpec | null; // null: the plan has no source spec
    readonly completesSpec: boolean; // the plan's completes-spec; false when spec is null
  }
  export interface ReleaseSpec {
    readonly path: string; // repo-relative spec .md path where it was found; identifies the spec
    readonly title: string;
    readonly guidingRule: string | null; // null when the spec has no sidecar
    readonly surface: ReadonlyArray<ReleaseSurface>; // empty when the spec has no sidecar
  }
  export interface ReleaseSurface {
    readonly surface: string;
    readonly summary: string;
    readonly before: string | null;
    readonly after: string;
  }
  export interface ReleaseCommit {
    readonly hash: string; // full 40-hex hash
    readonly subject: string;
  }
  export interface ReleaseNotes {
    readonly markdown: string;
    readonly warnings: ReadonlyArray<string>;
  }
  export function renderReleaseNotes(_input: ReleaseNotesInput): ReleaseNotes;
  export function githubReleaseBody(_markdown: string, _version: string): string;
  ```
- Each stub's body throws `new Error("<function name> is not implemented")`. Keep the parameters prefixed with `_`: `pnpm test:type` typechecks the scripts that tests import, under `noUnusedParameters`.
- Create `tests/unit/releaseNotes/inputs.ts` with the made-up inputs and their expected outputs, exported for the test file. Use made-up versions (`4.2.0`, previous `4.1.0`), the repository `https://github.com/acme/tool`, made-up paths under `docs/plans/archive/` and `docs/specs/archive/`, and 40-character hex hashes. Write every expected document as a literal array of lines joined with a newline and ending with an empty line. Never compute one by calling a helper.
- `fullInput` holds:
  - an upgrading text whose `### 4.2.0` entry contains a bullet list, a relative link (`bounds.md#limits`), a parent-relative link (`../README.md#install`), an anchor-only link (`#after-every-upgrade`), a leading-`/` link (`/docs/security.md`) and an absolute `https:` link, followed by a blank line and `### 4.1.0`;
  - plans in this order:
    - an intermediate plan (`completesSpec: false`) of spec A, which no plan in the input completes;
    - the completing plan of spec B. B's title holds two ` — `, its guiding rule is one line, and its surface lists one element for each of the six prefixes (`cli`, `config`, `file`, `api`, `package`, `internal`). Among them: one has `before: null`, one has a surface name that holds backticks and ends with one, and one has an `after` that holds a run of three backticks;
    - an intermediate plan of spec B, which joins B's Plans line;
    - a plan without a spec, whose first paragraph is wrapped over two lines and holds a code span, a relative link (`../specs/2601010000-made-up.md`), an anchor-only link (`#context`), a leading-`/` link (`/README.md#install`) and an `https:` link;
    - the completing plan of spec C, whose title has no ` — ` and which has no sidecar (`guidingRule: null`, `surface: []`);
  - commits with the subjects `fix: …`, `fix(scope): …`, `fix: keep <tag> and a_b [x] intact`, `Fix: …`, `feat(scope)!: …`, `perf: …`, `revert: …`, `docs: …`, `test: …`, `chore(plans): …`, `refactor: …`, `style: …`, `build: …`, `ci: …`, `wip: …`, and one with no conventional prefix.

  Next to `fullInput`, export its expected document, an empty list as its expected warnings, and the expected short form of that document (`githubReleaseBody(expected, "4.2.0")`), written out by hand like the document.
- Create `tests/unit/releaseNotes.test.ts`. Mark every test `it.fails`, the Vitest expected-failure marker that `examples/vitest-oracles/` requires. Never use `skip`, `todo`, `only`, `skipIf` or `runIf`. A table may be one `it.fails` that loops over its rows, or `it.fails.each`, which the oracles provider accepts (`examples/vitest-oracles/README.md`). The oracles:
  - (a) `fullInput` renders exactly its expected document, with no warning.
  - (b) The surface table: for each of the six prefixes, a spec with one element of that prefix shows the summary paragraph and the details block for `cli`, `config` and `file`, and nothing for the other three. An element with `before: null` gets the After-only block.
  - (c) The title table: titles with no ` — `, with one, with two, and with a lede that already ends in `.`, `?` or `!`.
  - (d) The commit table: each subject from `fullInput` lands in Fixes, in Other or in neither, as the layout says, in input order, as `- <escaped subject> ([<short hash>](<repository>/commit/<full hash>))`; the subject with `<tag>`, `a_b` and `[x]` shows each escaped.
  - (e) Upgrading: an input without the `### 4.2.0` entry renders no Upgrading section and returns exactly the warning `docs/upgrading.md has no "### 4.2.0" entry: the notes have no Upgrading section`. An entry that is the last in the file runs to the end of the file. A link that leaves the repository (`../../x.md` in the entry) is kept as written, with exactly the warning `docs/upgrading.md: the link ../../x.md leaves the repository and is kept as written`.
  - (f) An intermediate plan whose spec's completing plan is in the same input joins the Plans line, whether it comes before or after that plan, and yields no Part of line.
  - (g) Refusals. Two plans with `completesSpec: true` and the same `spec.path` throw exactly `<spec path> is announced in full twice: <first plan path> and <second plan path> both say completes-spec: true`. A kept element whose summary is `SURFACE_SUMMARY_PLACEHOLDER` (imported from `src/schemas/specDocument.ts`) throws exactly `<spec path>: the surface element "<surface>" still has the placeholder summary — write it before the release`. The same placeholder on an `internal:` element throws nothing.
  - (i) The plan-paragraph links: the no-spec plan's relative, anchor-only and leading-`/` links are made absolute at the tag from the plan's path, and its `https:` link is kept.
  - (j) The GitHub body: `githubReleaseBody` of `fullInput`'s expected document equals its expected short form; a document with no details block only gains the link paragraph after the Changes line; a details block whose fenced `after` holds a line `</details>` is removed whole.
  - (k) The GitHub body limit: a made-up document whose short form is exactly 125,000 code points is returned, and one a code point longer throws exactly `the GitHub release body of 4.2.0 has 125001 characters, over GitHub's limit of 125000 — shorten the notes`.
  - (h) Minimal documents: an input with no plans, no commits and no upgrading entry renders only the title and the Changes line, plus the warning. An input with only a `fix:` commit renders only Fixes after those two lines.
- Each oracle must fail against the stubs because they throw, never because an import, export or type is missing. The test file imports only `scripts/releaseNotes.ts`, `tests/unit/releaseNotes/inputs.ts`, `src/schemas/specDocument.ts` and `vitest`. A refusal oracle asserts the whole message with `toThrow(new Error(<exact message>))`, never a substring, so the stub's not-implemented error fails it.
- Before committing, run the standard gate. Every oracle must show as an expected failure, and the suite must stay green. `pnpm test:type`, `pnpm lint` and `pnpm knip` must pass with the stub.

### Planned files to create

- `scripts/releaseNotes.ts`
- `tests/unit/releaseNotes/inputs.ts`
- `tests/unit/releaseNotes.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumers: the oracle tests now, and `scripts/release-notes.ts` from phase-03. Producer: `scripts/releaseNotes.ts`. Shape: `renderReleaseNotes(ReleaseNotesInput)` returns `{ markdown, warnings }`, and `githubReleaseBody(markdown, version)` returns the short form; both are pure. A refusal is a thrown `Error` carrying one of the messages in the layout arbitration. The input carries decoded facts only: the builder reads no path and runs no git.

### Test strategy

- the notes of a release with two specs announced in full, intermediate plans, a plan without a spec, an upgrading entry and loose commits equal the expected document byte for byte — small · example · expected Markdown document · oracle
- only cli, config and file surface elements are shown, each as a summary paragraph and a folded block that holds before only when present — small · table · expected blocks per surface prefix · oracle
- a spec title splits at its first spaced em dash into the heading and a sentence-cased lede — small · table · expected heading and lede per title · oracle
- each commit subject lands in Fixes, in Other or nowhere as the classification says, oldest first, escaped and linked to its commit — small · table · classification table · oracle
- the upgrading entry is copied up to the next heading with its relative and leading-slash links made absolute at the tag, and a missing entry drops the section with one warning — small · example · expected section and warning text · oracle
- the links of a plan's first paragraph are made absolute at the tag from the plan's path, and a link leaving the repository is kept with one warning — small · example · expected paragraph and warning text · oracle
- the GitHub body is the notes without their folded blocks plus the site link paragraph — small · example · expected short document · oracle
- a GitHub body over 125000 code points is refused with its exact message, and one at the limit passes — small · example · exact refusal message · oracle
- an intermediate plan joins its spec's Plans line when the spec is announced in the same release, and is a Part of line otherwise — small · example · expected sections · oracle
- a spec announced in full twice and a kept element still holding the placeholder summary are refused with messages naming the files — small · example · exact refusal messages · oracle
- a section with nothing to list is left out, and the smallest notes are the title and the Changes line — small · example · expected Markdown document · oracle

### Implementation order

1. scripts/releaseNotes.ts: the exported types and the throwing stubs.
2. tests/unit/releaseNotes/inputs.ts: the made-up inputs and the expected documents, written out by hand from the layout arbitration.
3. tests/unit/releaseNotes.test.ts: the oracles, each marked it.fails.
4. Run the standard gate.

### Excluded scope

- The builder's implementation (phase-02).
- Reading git, plans, specs or docs/upgrading.md (phase-03).
- Any change under src/.

### Verification

The `standard` gate profile in `phax.json`, then the configured oracles provider's `authored` verdict on the oracle files.

### Expected handoff content

The exact exported types and functions, and the path of the stubs. Each oracle, with the guarantee it freezes. Every point where the plan's layout left a choice open, and how the expected documents settled it: phase-02 cannot change them. Any deviation from the planned files, with the reason.

### Commit subject

`test(scripts): oracles for the release notes builder`

### Commit body

Freeze the release notes layout before its code: scripts/releaseNotes.ts declares the builder's input types and stubs of renderReleaseNotes and githubReleaseBody, and the oracles in tests/unit/releaseNotes.test.ts, each marked it.fails, state the exact Markdown, warnings and refusals for made-up inputs: specs announced in full with their kept surfaces, intermediate plans, a plan without a spec, the upgrading entry with its links, commits sorted into Fixes and Other, and the GitHub body's short form and its limit.

---

## phase-02 — The release notes builder {#phase-02-notes-builder}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`renderReleaseNotes` turns the facts of a release into its notes: the Markdown the layout states, the warnings and the refusals; `githubReleaseBody` turns those notes into the GitHub release body. phase-03 then only has to gather the facts.

### Detailed instructions

- Implement `renderReleaseNotes` and `githubReleaseBody` in `scripts/releaseNotes.ts` as the plan's layout and GitHub body arbitrations state. Keep the exported types exactly as phase-01 wrote them, and keep the module pure: no file access, no git, no `process`.
- Reuse `finishDocument`, `inlineCode`, `sentence` and `headingText` from `src/domain/authoring/markdown.ts`, and `SURFACE_SUMMARY_PLACEHOLDER` from `src/schemas/specDocument.ts`. Find the `### <version>` heading, the link destinations (in the Upgrading entry and in a plan's first paragraph) and the top-level details blocks with `mdast-util-from-markdown` (already a dependency), using node offsets into the source text, so that every other byte is copied unchanged. Apply one link rule to both sources, with `posix.normalize` and `posix.join` from `node:path`.
- Read a subject's type as its leading run of letters, lower-cased, when that run is followed by an optional parenthesised scope, an optional `!`, and `: `. Any other subject is unconventional and goes to Other.
- Check the refusals before rendering anything. First, duplicate full announcements, by `spec.path`, naming the first two plans in input order. Then placeholder summaries on kept elements, in input order.
- Remove the `.fails` markers from `tests/unit/releaseNotes.test.ts`, and change nothing else in it or in `tests/unit/releaseNotes/inputs.ts`: the oracles provider compares their syntax trees with phase-01's commit. If an oracle cannot pass unchanged, do not adapt it. Stop, and say in the handoff which oracle fails and why.
- Add `tests/unit/releaseNotesBlocks.test.ts` for what the oracles do not pin:
  - subject parsing: a scope, `!`, letter case, a colon with no space after it, an empty type;
  - link destinations, from `docs/upgrading.md` and from a plan under `docs/plans/archive/`: `mailto:`, `https:`, a leading `/` and `//`, `#x`, `../README.md#x`, `./bounds.md`, a reference definition, and one that leaves the repository;
  - subject escaping: each escaped character, and a subject with none;
  - fence length against backtick runs of 0, 2, 3 and 5.

  Export from `scripts/releaseNotes.ts` the helpers these tests call.

### Planned files to create

- `tests/unit/releaseNotesBlocks.test.ts`

### Planned files to edit

- `scripts/releaseNotes.ts`
- `tests/unit/releaseNotes.test.ts`

### Optional files that may be edited

- (none)

### Test strategy

- a subject's type is read with or without a scope, a breaking mark and any letter case, and anything else counts as unconventional — small · table · type per subject · in-phase
- link destinations keep a scheme, become absolute at the tag from their source file otherwise, and stay as written when they leave the repository — small · table · expected destination per link · in-phase
- a commit subject gets a backslash before each Markdown-active character and nothing else — small · table · escaped subject per subject · in-phase
- a fence is one backtick longer than the longest backtick run of its content and never shorter than three — small · table · fence per content · in-phase

### Implementation order

1. The pure helpers: subject type, fence, upgrading entry, the link rule, subject escaping, title split.
2. The refusals.
3. The section renderers and their assembly with finishDocument, then githubReleaseBody.
4. Remove the it.fails markers, then add tests/unit/releaseNotesBlocks.test.ts.

### Excluded scope

- Reading git, plans, specs or docs/upgrading.md (phase-03).
- Any change to the oracle assertions, the fixture inputs or the exported types.
- Any change under src/.

### Verification

The `standard` gate profile in `phax.json`, then the configured oracles provider's `discharged` verdict on the oracle files.

### Expected handoff content

The helpers `scripts/releaseNotes.ts` now exports, with their signatures. Confirmation that the only change to the oracle files is the removal of the markers. Any oracle that could not pass unchanged, and why. Any deviation from the planned files, with the reason.

### Commit subject

`feat(scripts): render release notes and their GitHub release body`

### Commit body

Implement renderReleaseNotes: the Upgrading section copied from docs/upgrading.md with its links made absolute at the tag, each completed spec with its lede, guiding rule, plans and cli, config and file surfaces folded in details blocks, the intermediate plans, the plans without a spec with their links made absolute, and the commits outside any run sorted into Fixes and Other, escaped and linked. githubReleaseBody drops the folded blocks, links the docs site page, and refuses a body over GitHub's 125,000 characters. A spec announced in full twice or a placeholder summary is refused. The oracles pass with only their markers removed.

---

## phase-03 — Read a release's runs, preview its notes and write them at the cut {#phase-03-notes-at-the-cut}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** It joins git history, artifact frontmatter, the persisted sidecar reader and the release cut in one reader. A dozen refusals must fire before the cut writes anything, and no script in the repository reads git history and documents together yet.

The notes of any version can be previewed from the repository with `pnpm release:notes`. The release cut writes them to `docs/releases/<X.Y.Z>.md` in the release commit, and refuses before any write when an input is wrong.

### Detailed instructions

- Create `scripts/release-notes.ts` in the style of `scripts/release-cut.ts`: exported functions, an `isMain` entry, and progress and warnings on stderr. It imports:
  - `renderReleaseNotes` and the types from `./releaseNotes.js`;
  - `readLedger` and `readVersion` from `./release-cut.js`;
  - `readDocumentSidecar` from `src/schemas/persisted.ts`;
  - `readPlanFrontmatter` from `src/domain/artifact/lineage.ts`;
  - `sidecarPathFor` from `src/domain/artifact/sidecar.ts`;
  - `archivePathFor` from `src/domain/artifact/document.ts`;
  - `slugifyShortName` from `src/domain/branded.ts`;
  - `compareReleases` from `src/schemas/schemaUrl.ts`.

  It runs git with `spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" })`, throws with git's stderr when git fails, reads files under `repoRoot` only, and writes nothing.
- Export `parseLog(text)`. It reads the output of `git log --reverse --no-merges --format=%H%x1f%s%x1f%(trailers:key=Run-Id,valueonly,separator=%x1d)%x1f%(trailers:key=Short-Name,valueonly,separator=%x1d)%x1e <range>` into `{ hash, subject, runId, shortName }` records, oldest first, with `runId` and `shortName` as `string | null`. git parses the trailers, so the script never reads a body. Records are split on `\x1e`, and every record after the first starts with the newline git writes after the format, which is dropped. When a key appears twice, git joins its values with `\x1d` and the first wins. A run commit carries both `Run-Id` and `Short-Name`; a review fix carries `Short-Name` only.
- Export `collectReleaseNotes(repoRoot, version)`, which returns `{ input, warnings }` as the plan's arbitrations on runs, the previous release, documents and wrong inputs state:
  1. `previous` is the greatest release below `version` in `readLedger(repoRoot, "no release notes")`. With none, refuse with `no release below <version> in packages/schemas/releases.json — no release notes`.
  2. Check the tag with `git rev-parse --verify --quiet refs/tags/v<previous>`. When it is missing, refuse with `v<previous> is not a tag in <repoRoot> — fetch the tags (git fetch --tags), or clone with the full history`.
  3. Read the commits with `parseLog`, over `v<previous>..HEAD`.
  4. Find the candidate plans: the `*-plan.md` paths listed by `git diff --name-only --no-renames --diff-filter=A v<previous> HEAD -- docs/plans/archive`.
  5. Read each candidate from the working tree:
     - its frontmatter through `readPlanFrontmatter`. `none` refuses with `<path>: no frontmatter`, and `undecodable` refuses with `<path>: <problem>`. A status other than `Completed` skips the plan without a word;
     - its title and first paragraph from the body: the first depth-1 heading's text through `mdast-util-to-string`, and the source slice of the first paragraph after that heading. With no title, refuse with `<path>: no "# " title`;
     - its run short name from its sidecar when one exists: `JSON.parse`, then `readDocumentSidecar("plan", …)`, taking `run` from the current document or from the older shape the read carries. A parse failure refuses with `<sidecar>: not JSON`, and a read error refuses with its message. Without a sidecar, the short name is `slugifyShortName(title)`.
  6. Two candidates with the same short name refuse with `<plan path> and <plan path> both have the run short name <name>`.
  7. Group run commits by `Short-Name`, in order of each run's first commit. A commit with `Short-Name` and no `Run-Id` joins the run of that name when there is one, matched or not, and is otherwise a commit without a run, with the warning `<short hash>: Short-Name <name> names no run since v<previous>: it is listed as a commit without a run`. A matched run adds its plan to `input.plans`. An unmatched run warns `run <short-name> names no plan completed since v<previous>: its commits are listed as commits without a run`. `input.commits` lists, in log order, the commits with no run trailers, the `Short-Name`-only commits that name no run, and the commits of unmatched runs, review fixes included.
  8. A candidate that no run names warns `<plan path> was completed since v<previous>, but no run commit names <short-name>: it is not announced`.
  9. For a plan whose frontmatter names a spec, look the spec up at that path, then at `archivePathFor(path)`. When `archivePathFor` throws, refuse with `<plan path>: source-spec <path> is not a spec path`. When neither path exists, refuse with `<plan path>: its source spec <path> is in neither docs/specs/ nor docs/specs/archive/`. A sidecar is read with `JSON.parse` and `readDocumentSidecar("spec", …)`, which refuse as in step 5, and gives `title`, `productGoal.guidingRule` and the `surface` fields. Without a sidecar, the spec is its `# ` title, with `guidingRule: null` and `surface: []`, and the warning `<spec path> has no sidecar: it is announced by its title alone`.
  10. `upgrading` is the text of `docs/upgrading.md`. When the file is missing, refuse with `docs/upgrading.md is missing`.
  11. `repository` is the constant `https://github.com/lbdremy/phax`.
- Export `releaseNotes(repoRoot, version)`: `renderReleaseNotes` applied to the collected input, with the collector's warnings first and the renderer's after them.
- The entry `pnpm release:notes [--root <dir>]` previews the notes of the version that `package.json` names under the root, which is the opened version. Add `"release:notes": "tsx scripts/release-notes.ts"` to `package.json`. The entry prints the Markdown on stdout and each warning on stderr as `! <warning>`. A refusal prints `✗ <message>` and exits 1. It writes nothing. Parse `--root` the way `scripts/release-cut.ts` does. The entry also takes `--github-body <notes file>`, read relative to the root: it prints `githubReleaseBody` of the file on stdout, with the version taken from the file name. A name other than `X.Y.Z.md` refuses with `<path>: a release notes file is named X.Y.Z.md`, a missing file with `<path> is missing`, and the body limit with its message; each prints `✗ <message>` and exits 1.
- In `scripts/release-cut.ts`, change `cutRelease(repoRoot, version)` to `cutRelease(repoRoot, version, notes: () => string)`:
  - after the existing refusals, refuse an existing `docs/releases/<version>.md` with `docs/releases/<version>.md already exists — nothing cut`;
  - then call `notes()`. When it throws, the error propagates and nothing has been written;
  - write the returned Markdown to `docs/releases/<version>.md` (creating the directory) after the ledger, and add the path to `changed`.

  In the `isMain` entry, load `./release-notes.js` with a dynamic `await import`, so the two modules form no static import cycle. Pass a function that calls `releaseNotes(repoRoot, version)`, prints each warning on stderr as `! <warning>`, and returns the Markdown. Update the header comment: the cut writes the notes, and a dry run needs a clone with the tags.
- In `scripts/release.sh`, echo `writing the release notes: docs/releases/${VERSION}.md` next to the existing cut echo lines. Change the undo line to `git reset --hard HEAD && git clean -fd -- packages/schemas/snapshots docs/releases`. Everything else stays as it is: the cut's changed paths already reach `git add -A`.
- In `.github/workflows/ci.yml`, give the `ci` job's `actions/checkout` step `with: fetch-depth: 0`, with a comment saying that the release rehearsal's notes read `v<previous>..HEAD`. Leave the `security-audit` job alone.
- Create `tests/unit/releaseNotes/repo.ts`, a helper that builds a fixture repository in a temporary directory:
  - wrap everything in `isolateGit()` from `tests/helpers/isolateGit.ts`;
  - run `git init` and `disableGitAutoMaintenance` (from `tests/helpers/tempGit.ts`), and set a local identity in the repository config;
  - write files and commit them with a given subject and body; run commits carry phax's layout: the body, a blank line, `---`, a blank line, then the trailer lines; review fixes carry a `Short-Name` trailer alone;
  - create tags;
  - remove the directory with `removeTempDir` (from `tests/helpers/tempGit.ts`) at teardown.

  Build sidecars from `validDocuments["spec-document"]` and `validDocuments["plan-document"]` of `tests/unit/schemasPackage/documents.ts`, edited with `withKey`, so that their `$schema` is the current stamp from the release table and never a hard-coded release. Use made-up versions, such as a ledger `["4.0.0", "4.1.0"]`, the tag `v4.1.0` and the version `4.2.0`.
- Create `tests/unit/releaseNotesCollect.test.ts`, covering:
  - `parseLog` on git's output for commits with no trailer, with both, with `Short-Name` only, with a prose last paragraph that only looks like trailers, and with a repeated key, over a range of more than one commit;
  - a review fix with `Short-Name` only that joins its run, and one that names no run, with its exact warning;
  - a run whose plan and spec are both archived in the range;
  - a spec found at its live path;
  - an intermediate plan;
  - a plan without a spec;
  - an unmatched run and an unnamed plan, each with its exact warning;
  - an abandoned plan, a plan archived before the tag, and a merge commit, none of which reach the input;
  - each refusal of step 5 to step 10, with its exact message, asserted whole (`toThrow(new Error(…))`);
  - the preview entry: spawn the repository's `node_modules/.bin/tsx` with `scripts/release-notes.ts --root <fixture>` and a 30-second timeout. It must exit 0, its stdout must equal `releaseNotes(…).markdown`, the warnings must be on stderr, and `git status --porcelain` must be unchanged. A fixture with no tag exits 1 with a `✗` line. `--github-body` on a notes file in the fixture prints `githubReleaseBody` of it, and refuses a misnamed or missing file with exit 1.
- In `tests/unit/releaseCut.test.ts`:
  - every `cutRelease` call passes a function that returns a fixed made-up Markdown;
  - add `docs/releases` to `CUT_SCOPE`, so the real tree is still checked untouched;
  - add these cases: the notes file holds exactly the function's text and is listed in `changed`; an existing notes file is refused and the tree is unchanged; a throwing notes function leaves the tree unchanged.
- In `tests/unit/releaseWorkflow.test.ts`, assert that the `ci` job's checkout sets `fetch-depth: 0`, that `release.sh`'s undo line cleans `docs/releases`, and that the existing release-script invariants still hold.
- Never run `scripts/release.sh`, and never run the cut on the real tree. To look at real notes, run `pnpm exec tsx scripts/release-notes.ts`: agents are granted `pnpm exec tsx`, not `pnpm release:notes`. Inside the phase worktree this run's plan is not archived yet, so expect the warning about a run that names no plan. No test reads `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, or the global git config.

### Planned files to create

- `scripts/release-notes.ts`
- `tests/unit/releaseNotes/repo.ts`
- `tests/unit/releaseNotesCollect.test.ts`

### Planned files to edit

- `scripts/release-cut.ts`
- `scripts/release.sh`
- `package.json`
- `.github/workflows/ci.yml`
- `tests/unit/releaseCut.test.ts`
- `tests/unit/releaseWorkflow.test.ts`

### Optional files that may be edited

- `scripts/releaseNotes.ts`
- `knip.json`

### Boundary contracts

Consumers: the cut's entry in `scripts/release-cut.ts`, the preview, and the release workflow's `--github-body` step (phase-04). Producer: `releaseNotes(repoRoot, version)` in `scripts/release-notes.ts`, which returns `{ markdown, warnings }` or throws an `Error` naming the file or the remedy. It reads git and the files under `repoRoot` and writes nothing. Consumer: `scripts/release.sh`. Producer: `cutRelease(repoRoot, version, notes)`, whose `changed` list now includes `docs/releases/<version>.md`, so the script stages the notes with the rest of the cut.

### Test strategy

- run trailers in the range lead to the plan completed in the same range and to its spec at its path or in the archive — medium · example · fixture repository and expected input · in-phase
- a run naming no completed plan and a completed plan named by no run each give one warning, and the run's commits join the commits without a run — medium · example · expected warnings and commits · in-phase
- a sidecar or frontmatter that does not decode, a missing spec, a shared run short name and a missing previous tag are refused with a message naming the file or the remedy — medium · example · exact refusal messages · in-phase
- merge commits, abandoned plans and plans archived before the previous release never reach the notes — medium · example · expected input · in-phase
- trailers are read through git, and a record after the first loses its leading newline — small · table · parsed records per log · in-phase
- a review fix with only a Short-Name trailer joins its run, and one naming no run is listed with one warning — medium · example · expected input and warning · in-phase
- the cut writes the notes after its other writes, lists them among the changed paths, and leaves the tree untouched when the notes file exists or the notes fail — medium · example · tree hashes before and after · in-phase
- the preview prints the notes on stdout and the warnings on stderr, and changes nothing in the repository — medium · smoke · stdout, stderr and git status · in-phase
- the GitHub body entry prints the short form of a notes file and refuses a misnamed or missing one — medium · smoke · stdout and exit code · in-phase
- CI checks out the full history for the rehearsal, and the cut's undo line cleans the notes — small · example · parsed workflow and script text · in-phase

### Implementation order

1. parseLog and its tests.
2. collectReleaseNotes with the fixture repository helper, refusal by refusal.
3. releaseNotes and the preview entry, plus the package script.
4. cutRelease's notes parameter, the cut's entry and releaseCut.test.ts.
5. release.sh, ci.yml and releaseWorkflow.test.ts.

### Excluded scope

- The release workflow, the GitHub Release body and .github/release.yml (phase-04).
- The docs site and docs/release.md (phase-04).
- Any change to renderReleaseNotes's layout or to the oracle files.
- Any change under src/.
- Running scripts/release.sh, or cutting a release on the real tree.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The exported functions of `scripts/release-notes.ts` and their signatures. `cutRelease`'s new signature and where it calls `notes()`. The exact warning and refusal messages, as implemented. What `pnpm exec tsx scripts/release-notes.ts` printed in the worktree, warnings included. Any deviation from the planned files, with the reason.

### Commit subject

`feat(scripts): read a release's runs and write its notes at the cut`

### Commit body

scripts/release-notes.ts reads the release's runs from the Run-Id and Short-Name trailers since the previous release's tag, joins review fixes that carry Short-Name alone to their run, matches each to the plan completed in the same range, follows source-spec to the spec and decodes the sidecars through the persisted reader, then renders the notes. pnpm release:notes previews them without writing anything, and --github-body prints a notes file's GitHub release body. The cut takes the notes as a function called before its first write, writes docs/releases/<X.Y.Z>.md and stages it, and CI's checkout fetches the history its rehearsal now reads.

---

## phase-04 — The notes as the GitHub release body and a docs site page {#phase-04-notes-published}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A release's notes reach their readers: the GitHub Release takes the short form of `docs/releases/<X.Y.Z>.md` as its body, checked before anything is built or published; the docs site shows one page per release; and `docs/release.md` explains the notes and their preview.

### Detailed instructions

- In `.github/workflows/release.yml`:
  - add a step named `Verify the release notes` directly after the `actions/checkout` step. It sets `NOTES="docs/releases/${RELEASE_TAG#v}.md"` and exits 1 with a line naming the file and `scripts/release-cut.ts` when the file is missing or empty;
  - add a step named `Write the GitHub release body`, with `id: notes`, directly after `Install dependencies`. It runs `pnpm exec tsx scripts/release-notes.ts --github-body "docs/releases/${RELEASE_TAG#v}.md" > "$RUNNER_TEMP/release-body.md"` and appends `path=$RUNNER_TEMP/release-body.md` to `$GITHUB_OUTPUT`;
  - `Verify package versions match tag` must stay directly before `Deploy docs: guard`;
  - in the `softprops/action-gh-release` step, remove `generate_release_notes`, add `body_path: ${{ steps.notes.outputs.path }}`, and rewrite the comment above it: the body is the notes' short form, and the site page has the full notes.
- Delete `.github/release.yml`: only GitHub's generated notes read its categories.
- In `tests/unit/releaseWorkflow.test.ts`:
  - replace the `generate_release_notes` test with these checks: the release step reads `body_path: ${{ steps.notes.outputs.path }}` and sets no `generate_release_notes`; `.github/release.yml` does not exist; the verify step comes directly after the checkout and the body step directly after `Install dependencies`; and the verify step's `run` works under `bash`. For that last check, run it in a temporary directory with `RELEASE_TAG=v0.18.0`: it exits 0 when `docs/releases/0.18.0.md` exists there and is not empty, and exits 1 when it is missing or empty;
  - add both steps to the steps that must come before the first publish.
- In `site/build/sources.ts`, add `docs/releases` to `SOURCE_DIRECTORIES`.
- In `site/build/pageMap.ts`:
  - export `RELEASE_NOTES_DIRECTORY = "docs/releases"`;
  - export `releaseNotePages(paths)`, which returns `{ pages, findings }`. Each `docs/releases/<X.Y.Z>.md`, checked with `isRelease`, becomes a `FilePage` with route `/releases/<X-Y-Z>`, title `phax <X.Y.Z>`, and the description `What phax <X.Y.Z> changes: the specs and plans it delivers, its fixes and its upgrade steps.` The pages are sorted newest first with `compareReleases`. Any other file in that directory gives the finding `✗ <path>: a release notes file is named X.Y.Z.md`;
  - add `{ segment: "releases", text: "Releases", nav: true }` to `GROUPS`, after `blog`.
- In `site/build/generate.ts`, extend the map's `files` with `releaseNotePages` of the source paths before `checkPageMap`, and add that function's findings to the map findings. Use the extended map everywhere after that: navigation, link targets and the summary. In `site/build/site.ts`, make `lastModified` cover the release note sources too.
- In `site/build/markdown.ts`, release-note sources get one exception. For a path under `docs/releases/`, an HTML block that is exactly `<details>`, a newline, and `<summary>TEXT</summary>` becomes `:::details TEXT`, with TEXT escaped like other text. An HTML block that is exactly `</details>` becomes `:::`. Any other raw HTML element stays a finding, in every source, `<details>` outside `docs/releases/` included.
- Tests:
  - `tests/unit/site/pageMap.test.ts`: `releaseNotePages` gives the routes, titles and descriptions above, sorts `1.10.0` before `1.2.0`, gives the finding for a misnamed file, and the Releases sidebar group and nav entry exist only when there is a page;
  - `tests/unit/site/generate.test.ts`: a fixture with two notes files renders two pages, and the page map still checks clean;
  - `tests/unit/site/markdown.test.ts`: the details conversion; a `<div>` in a release note is still refused; `<details>` in another source is still refused.
- Create `tests/unit/site/releaseNotesLinks.test.ts`. For every real `docs/releases/*.md` of the repository, it builds the link targets the way `site/build/generate.ts` does for the real repository and page map (release pages included), and asserts that `rewriteLinks` (`site/build/links.ts`) returns no finding. With no notes file yet, it checks that the directory may be absent and passes. The release rehearsal and the real cut both run `tests/unit/site` after the cut writes the notes, so a notes file whose links the site build would refuse is refused before the tag. Read the real files from the repository root the test resolves from its own path; read nothing outside it.
- Check the site build once by hand. Run `pnpm exec tsx scripts/release-notes.ts > docs/releases/<opened version>.md` in the worktree, then `pnpm exec tsx site/build/site.ts build` (agents are granted `pnpm exec tsx`, not `pnpm site:build`), and confirm that the page builds with its folded blocks and no link finding. Also run `pnpm exec tsx scripts/release-notes.ts --github-body docs/releases/<opened version>.md` and check the short form. Delete the file before committing, and report both results in the handoff.
- Update `docs/release.md`:
  - in step 1 of the cut, the cut refuses an existing notes file and any notes refusal, and writes `docs/releases/<version>.md`;
  - the undo line now also cleans `docs/releases`;
  - the dry-run paragraph: the dry run needs a clone with the tags (`git clone . <copy>`);
  - in the workflow list, add the notes check as the first step and the body step after the install, and rewrite step 8: the GitHub Release body is the notes file's short form (without the folded before/after blocks, with a link to the site page);
  - in `### 5. Verify`, check the release body and `docs.phax.run/releases/X-Y-Z`;
  - add a `## Release notes` section after `## Release process`. It covers what the notes contain, the source chain (the `Run-Id` and `Short-Name` trailers, the plan archived in the range, `source-spec` and `completes-spec`, the spec sidecar), the convention that a review fix pushed onto a run's pull request branch carries `Short-Name: <run short name>` and no `Run-Id`, so it joins the run and is not listed, what refuses (everywhere, the CI rehearsal included) and what only warns, the GitHub body's short form and its 125,000-character limit, writing the `### X.Y.Z` entry of `docs/upgrading.md` before the cut, the preview `pnpm release:notes`, and where the notes are published.

  Then add a test to `tests/unit/site/releaseDocs.test.ts` asserting that this section names `pnpm release:notes`, `docs/releases/`, `docs/upgrading.md`, `Run-Id`, `Short-Name`, `completes-spec` and `--github-body`.
- In `NEXT_STEPS.md`, remove the release-notes item, and the `### Next, after the surface summaries` heading it leaves empty. The README does not describe release notes, so it stays as it is.

### Planned files to create

- `tests/unit/site/releaseNotesLinks.test.ts`

### Planned files to edit

- `.github/workflows/release.yml`
- `.github/release.yml`
- `tests/unit/releaseWorkflow.test.ts`
- `site/build/sources.ts`
- `site/build/pageMap.ts`
- `site/build/generate.ts`
- `site/build/markdown.ts`
- `site/build/site.ts`
- `tests/unit/site/pageMap.test.ts`
- `tests/unit/site/generate.test.ts`
- `tests/unit/site/markdown.test.ts`
- `tests/unit/site/releaseDocs.test.ts`
- `docs/release.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `site/pages.ts`
- `site/build/discovery.ts`
- `tests/unit/site/discovery.test.ts`
- `CONTRIBUTING.md`

### Boundary contracts

Consumers: the release workflow's GitHub Release step and the docs site build. Producer: the `docs/releases/<X.Y.Z>.md` that the cut writes into the release commit. Shape: one GitHub-flavoured Markdown file per release, whose only raw HTML is the `<details>`/`<summary>` blocks the builder writes. The workflow needs the file to exist before it publishes, and the site derives one route per file from its name.

### Test strategy

- the GitHub Release body is the short form of the notes file, which a first step checks before anything is built, and GitHub generates no notes — small · example · parsed workflow and the step run under bash · in-phase
- every real release notes file passes the site's link check — small · example · no link finding · in-phase
- each release notes file becomes one page at its release route, newest first in a Releases group with a nav entry, and a misnamed file is a finding — small · example · generated site files and findings · in-phase
- the details blocks of a release page become details containers, and raw HTML stays refused everywhere else — small · example · generated page text and findings · in-phase
- docs/release.md documents the notes step of the cut, the review-fix trailer, the preview command and the release body's short form — small · example · section text · in-phase

### Implementation order

1. release.yml's verify and body steps and body_path, the deletion of .github/release.yml, and releaseWorkflow.test.ts.
2. The site: the source directory, releaseNotePages and GROUPS, the expanded map in generate.ts and site.ts, the details containers in markdown.ts, and their tests, then releaseNotesLinks.test.ts.
3. The one-time site build with a generated notes file, deleted again before the commit.
4. docs/release.md and releaseDocs.test.ts, then NEXT_STEPS.md.

### Excluded scope

- Any change to the note builder, the reader or the cut (phases 02 and 03).
- A hand-written index of all releases, or one page-map entry per release.
- Committing any docs/releases file: the first one is written by the 0.28.0 cut.
- Any change under src/, and any change to docs-deploy.yml.

### Verification

The `standard` gate profile in `phax.json`; its terminal `pnpm site:build` step builds the site with the new release pages code.

### Expected handoff content

The verify, body and release steps as written. The site functions added and how a release page's route is derived. The result of the one-time site build with a generated notes file: whether the folded blocks rendered, and any finding; and the short form `--github-body` printed. A note that `.github/release.yml` was deleted (reconciliation lists it as planned to edit). Any deviation from the planned files, with the reason.

### Commit subject

`ci(release): publish the release notes as the GitHub release body and on the docs site`

### Commit body

The release workflow checks docs/releases/<X.Y.Z>.md first and gives its short form, without the folded before/after blocks and with a link to the site page, to the GitHub Release as its body; GitHub no longer generates notes, and .github/release.yml goes. The docs site renders one page per release at /releases/<X-Y-Z>, newest first under Releases, with the notes' details blocks as Rspress containers. docs/release.md documents the notes, the review-fix Short-Name trailer and pnpm release:notes, and NEXT_STEPS.md drops the item.
