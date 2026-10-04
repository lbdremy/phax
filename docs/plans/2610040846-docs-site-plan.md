---
status: Draft
source-spec: docs/specs/2610040828-docs-site.md
---
# docs-site — docs.phax.run rendered from the repository, deployed by the release

This plan implements the Approved spec `docs-site` (`docs/specs/2610040828-docs-site.md`). Every §9 question was decided by the author on 2026-10-04, each on its recommended option. The plan implements those decisions and does not reopen them: latest release only, a committed release ledger, deploy before the first npm stage publish, the README as the single source split by a page map, the §6 tokens with a contrast test, a phase-drawn logo, mechanical visual checks, the 1.0 post held until 1.0.0, and `check:full` running the site build.

What this plan produces: docs.phax.run is built with Rspress v2 from `site/`. `site/` holds no `package.json` and is not a workspace package. A pre-build step in `site/build/` reads the committed sources at the commit, applies the page map `site/pages.ts`, rewrites and checks links, copies every released schema to its `$schema` URL, and writes everything it generates under the ignored `site/.generated/`. Rspress compiles that into the ignored `site/doc_build/`. The release workflow deploys that output to Cloudflare Workers Static Assets, in this order: guard, then upload under a preview alias, then check, then promote. A manual workflow does the same for a tag the author names.

Phases, ordered so each phase stays green on its own:

- phase-01: the Rspress skeleton, the page map and GitHub-faithful Markdown (§5.1–§5.4, §5.8 rendering, §5.9–§5.11, §5.18, §5.19). It adds `@rspress/core` and runs the install.
- phase-02: link rewriting and the broken-link check (§5.5–§5.7, §5.8 links).
- phase-03: schema routes, the release ledger and the release cut appending to it (§5.12–§5.16).
- phase-04: the identity: tokens with the contrast test, fonts, dark-first, and the logo and favicon (§5.28–§5.32). It adds the font packages.
- phase-05: CI and the project gate build the site (§5.23, §5.26). From this phase on, the `standard` gate builds the site.
- phase-06: the deploy guard, the preview check and the Worker config (§5.14 config, §5.17, §5.20 tooling, §5.24). It adds `wrangler`.
- phase-07: the release-workflow deploy, the manual deploy and `docs/release.md` (§5.20–§5.22, §5.24, §5.25, §5.27).

**Execution caveat.** Phase sessions have no network. Only `pnpm add`, in phases 01, 04 and 06, reaches the npm registry, and the lockfile it writes is committed. No build, test or gate needs the network. No phase deploys, calls Cloudflare, runs `wrangler` or reads a credential: the deploy steps exist only in the workflows. So a phase cannot prove the deploy works. It proves the workflow structure (parsed YAML), and proves the guard and the preview check against made-up fixtures. The real proof is the first release tag cut after this work lands, once the author has done the one-time Cloudflare setup that phase-07 documents. Every test fixture (README text, sources, snapshots, ledgers, wrangler output) is made up. Nothing from `~/.phax`, phax-cockpit or any other repository enters this repository. No source (README, docs/*) is edited for the site's sake; only `docs/release.md` gains the deploy documentation, in phase-07.

**Verify Rspress against the installed package, not memory.** Before writing any config, phase-01 reads `node_modules/@rspress/core`: its manifest, CLI, type declarations and default theme CSS. Things to confirm include whether `.md` compiles as MDX, the custom heading-id syntax, the output and public directories, and the theme's CSS variables. Later phases build on the facts phase-01 records in its handoff.

## Required commands

- `pnpm add`
- `pnpm exec tsx`
- `pnpm site:build`

`pnpm add` and `pnpm exec tsx` are already in `security.agentCommands`.

- `pnpm add` adds `@rspress/core` in phase-01, the self-hosted font packages in phase-04 and `wrangler` in phase-06, all as root devDependencies. It is the only command that reaches the npm registry, and the lockfile it writes is committed.
- `pnpm exec tsx` runs `scripts/release-cut.ts --root <copy>` dry-runs, and the site and deploy scripts by hand.
- `pnpm site:build` is new. Every phase runs it to check the real repository's site. From phase-05 on, it is also a step of the `standard` gate profile.

Required PHAX security configuration changes: before running this plan, add `pnpm site:build` to `security.agentCommands` in `phax.json`. The run freezes its command set at start, so the gate profile entry that phase-05 adds does not let phases 01–04 run it. Without this entry, the preflight check fails before any agent spawns.

## Technical arbitrations

- The site build is repository tooling in `site/build/`, plain Node like `scripts/`, outside the four phax layers, and run by `tsx`. Rspress only compiles the pages it writes. Link rewriting and link checks are ours, not Rspress's dead-link option. Loss accepted: we maintain a Markdown transform and a link resolver that Rspress partly provides. In return, errors name the source file and line, and links to unrendered files go to GitHub at the tag, which Rspress cannot do.
- Markdown is made safe for either compiler, MDX or plain. HTML comments are dropped. Every other raw HTML node, and every `{` or `}` outside code, is emitted as a character reference. Everything else is preserved byte for byte, by editing at mdast offsets. Loss accepted: raw HTML in a source never renders as HTML. No rendered source contains any today; a future one needs an explicit allowlist entry.
- Heading ids are GitHub's slugs, computed over the whole source document (README duplicates included) and emitted explicitly on every heading. They are checked against the built HTML after Rspress runs. Loss accepted: the site's anchors follow GitHub's slug rules, not Rspress's own. In exchange, every repository anchor link keeps working unchanged.
- In a build for an earlier release, a link from a rendered page to a held source fails the build. It does not fall back to GitHub, because §5.8 says nothing links to a held source. Loss accepted: no source can mention a held post before its release. No source links to the 1.0 post today.
- The release ledger is `packages/schemas/releases.json`, `{ "releases": [...] }`. Its helpers live in `packages/schemas/build/releaseLedger.ts`, shared by the release cut and the site build. The schema index is `/schemas/index.json`, `{ releases, paths }`, sorted. Loss accepted: a second list of releases beside the tags, as Q2 already accepted. Its drift is caught offline by the ledger-versus-package.json check.
- The deploy guard passes as a first deploy only on an HTTP 404 for the live schema index. A network error, a DNS failure or any other status refuses the deploy. Loss accepted: a Cloudflare outage or DNS failure fails the release, which is fixed by re-pushing the tag. The alternative would treat an unreachable host as an empty site and could drop served URLs.
- The docs.phax.run custom domain is attached once by hand, after creating the `phax-docs` Worker by hand, and is not declared in `site/wrangler.jsonc`. `wrangler versions deploy` does not apply routes, and the first release's guard then sees a 404 rather than an unresolvable host. Loss accepted: `wrangler.jsonc` does not describe the domain, and the one-time setup gains the Worker-creation step.
- The preview URL and the version id are parsed from `wrangler versions upload` output by a tested helper. They do not come from a hand-set GitHub variable holding the account subdomain. Loss accepted: a dependency on wrangler's output wording, pinned by the lockfile and a fixture test. The rejected alternative abandons a one-time setup that matches §5.27's list.
- The manual deploy is a separate workflow, `.github/workflows/docs-deploy.yml`. Its four deploy steps are textually identical to release.yml's: both read the tag from a job-level `DOCS_TAG`, and a test asserts the two step lists are equal. Loss accepted: the steps are duplicated. A composite action or reusable workflow would hide the secrets' scope and split the release job.
- `pnpm site:build` joins both `check:full` and the `standard` gate profile in `phax.json` (every-phase). The second makes Q9's intent (a heading rename fails inside the phase's fix loop) hold for phax runs, which gate on `phax.json`, not on `check:full`. Loss accepted: every phase pays the build time, as Q9 already accepted.
- Identity tokens live in `site/theme/tokens.ts` as typed roles per theme. The build renders them into the generated stylesheet, after the committed rules in `site/theme/styles.css`. Loss accepted: the hex values sit in a TypeScript module rather than the CSS the author would edit. In return, the contrast and hue tests read the same values the site ships.
- Fonts are IBM Plex Sans 400/600 and IBM Plex Mono 400, from the `@fontsource` npm packages, latin subset, bundled by Rspress. Loss accepted: two more devDependencies. No PNG favicon fallback is added: browsers without SVG favicon support show none.
- Integration tests build made-up fixture trees with the real Rspress build, writing under the ignored `site/.generated/`, because Rspress resolves its runtime from the pages' location. The real repository is built by `pnpm site:build`. Loss accepted: a slower `pnpm test`, kept to a minimum of full Rspress builds by asserting generator-level facts on the generator's output.

---

## phase-01 — Rspress skeleton, page map and GitHub-faithful Markdown {#phase-01-site-skeleton}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

`pnpm site:build` renders the repository's own sources into a navigable Rspress site under `site/doc_build`. Pages come from one committed page map that assigns every README section and every other source to a route, `omit` or a hold. Any unmapped or vanished section or file fails the build by name. Placeholders and braces render as written, and HTML comments disappear. The top navigation shows the release the site was built from.

### Detailed instructions

- Install: run `pnpm add -D @rspress/core@^2`. Add, in the same command, only the peer dependencies that the installed `@rspress/core` manifest declares as required (for example `react` and `react-dom`, if it declares them). `pnpm add` is allowed by `phax.json` and is the only step that reaches the registry. Commit `package.json` and `pnpm-lock.yaml`.
- Verify Rspress v2 from `node_modules/@rspress/core` before writing config, since there is no network for docs. Confirm each of the following and record every finding in the handoff:
  - the `defineConfig` import path;
  - the config keys `root`, `outDir`, `title`, `icon`, `logo`, `logoText`, `globalStyles`, `head`, `themeConfig.nav`, `themeConfig.sidebar` and `search`;
  - whether `.md` files go through MDX;
  - whether `## Heading {#custom-id}` sets a heading id;
  - where `public/` is copied, and that a `404.html` is emitted;
  - the CLI entry and its `build`/`dev`/`preview` arguments;
  - any build-time network access (telemetry, remote fonts) and how to disable it;
  - the default theme's `--rp-c-*` colour variables, including which variable colours links and callouts.
  phase-02 and phase-04 build on these facts.
- Create `site/build/pageMap.ts`. It holds the page-map types:
  - README entries: `{ route, title, sections: string[] }`, or `{ omit: string[], why }`;
  - file entries: `{ route, title?, source, holdUntil? }`, or `{ omit, why }`.
  It also holds `checkPageMap(map, readmeSections, sourceFiles)`, which returns `✗` findings, one per defect and all of them:
  - `✗ README.md: section "## X" is not in the page map`;
  - `✗ page map: names README section "## X", which README.md no longer has`;
  - `✗ <path>: not in the page map`;
  - `✗ page map: names <path>, which does not exist`;
  - a section or file mapped twice;
  - a duplicate route;
  - a `holdUntil` that is not X.Y.Z.
  Sections are named by their heading's plain text (mdast-util-to-string), and the text before the first `##` is `(intro)`. The source-file set is `docs/cli/reference.md`, `docs/security.md`, `docs/release.md`, `docs/model-catalog.md`, plus every `docs/blog/*.md` and `docs/comparisons/*.md`.
- Create `site/pages.ts`, the one place the site's structure lives, typed by `pageMap.ts`. Map all 31 README sections exactly once, following the spec §6 tree:
  - `/` gets (intro) and Quickstart.
  - The Guide pages are /guide/install, /guide/configure, /guide/write-a-plan, /guide/run, /guide/review-and-publish, /guide/multiple-plans, /guide/manage-runs, /guide/model-routing, /guide/security-modes and /guide/troubleshooting.
  - The Reference pages are /reference/formats and /reference/exit-codes.
  - /contributing/testing gets Testing, State Machine, and the CLI specification section.
  - `CLI command reference` is omitted, with its reason.
  Map the files: /reference/cli, /reference/model-catalog, /security, /contributing/release, /compare/openspec-vs-phax and /compare/spec-kit-vs-phax. Map docs/blog/announcing-phax-1.0.md to /blog/announcing-phax-1-0 with `holdUntil: "1.0.0"`.
- Create `site/build/sources.ts`. It reads a source from a root directory and splits README.md at depth-2 headings (mdast-util-from-markdown, so `##` inside code fences never splits). Each section keeps its exact original text slice, from offsets, and its start line.
- Create `site/build/markdown.ts`. `toPageMarkdown(text, slugs)` edits the source by mdast offsets and keeps every other byte:
  - It drops `html` nodes that are comments.
  - It emits every other `html` node and every `{`/`}` in text outside `code`/`inlineCode` as character references (`&lt;`, `&#123;`, `&#125;`).
  - It appends to every heading the explicit id for its GitHub slug.
  Compute the slugs with a GitHub-compatible slugger implemented here, with no new dependency:
  - lowercase;
  - drop characters other than letters, digits, spaces, `-` and `_`;
  - spaces become `-`;
  - repeated slugs get `-1`, `-2`, and so on.
  Slugs are computed over the whole source document. If the installed Rspress does not support the `{#id}` syntax, use the mechanism it does support and record it.
- Create `site/build/prepare.ts`. `prepareSite({ root, pageMap, outDir })` reads the version from `<root>/package.json` and validates the page map, returning findings without writing anything when there are some. Otherwise it writes:
  - one page per route under the generated docs root (`index.md` for `/`, otherwise `<route>.md`). Each page has a `# <title>` (the intro's own `# phax` for `/`), followed by the mapped sections or the file, in page-map order.
  - the site data (version, nav, sidebar) as JSON.
  - a copy of `site/public/` into the generated root's public directory.
  It skips any source held until a release newer than the version (`compareReleases` from `src/schemas/schemaUrl.ts`). The nav is: Guide · Reference · Security · Compare · Blog (only when an unheld blog page exists) · `v<version>`, linking to `https://github.com/lbdremy/phax/releases/tag/v<version>` · GitHub. There is no version switcher and no route with a version prefix. Output must be deterministic: sorted traversal, LF line endings, no timestamps.
- Create `site/rspress.config.ts`. It reads the generated root and site data from the one location `main.ts` controls (for example an env var defaulting to `site/.generated`), so a test can build a fixture tree. Settings:
  - `root`: the generated docs;
  - `outDir`: `site/doc_build` by default, overridable for tests;
  - `title`: `phax`;
  - the built-in local search;
  - nav and sidebar from the site data;
  - telemetry or remote assets disabled, if the verification found any.
- Create `site/build/main.ts`, the single entry, with `build`, `dev` and `preview` subcommands. Options: `--root <dir>` (default: the repository) and `--out <dir>`.
  - `build` runs `prepareSite`. If there are findings, it prints each one and exits 1. Otherwise it spawns the installed Rspress CLI through `process.execPath` (never npx or the network) and prints the §6 summary lines: `site: v<version> — N pages from M sources (README: S sections, O omitted, H held)` and `site: built site/doc_build`.
  - `dev` and `preview` run Rspress's dev and preview on localhost.
- Add scripts to `package.json`: `site:build` (`tsx site/build/main.ts build`), `site:dev` and `site:preview`. Do not add `site:build` to `check:full` yet; phase-05 does that.
- Ignore the generated directories everywhere:
  - `.gitignore`: add `site/.generated/` and `site/doc_build/`.
  - `.oxlintrc.json` and `.oxfmtrc.json`: add both to their ignore patterns.
  - `knip.json`: add `site/rspress.config.ts`, `site/pages.ts` and `site/build/main.ts` as entries, `site/**/*.ts` to `project`, and ignore both generated directories.
  - `tsconfig.test.json`: add `site/**/*.ts` to `include`, and exclude both generated directories.
  Confirm that `pnpm knip`, `pnpm lint`, `pnpm format:check` and `pnpm test:type` stay clean.
- Run `pnpm site:build` on the real repository, offline, and confirm it exits 0 with 20 pages. Then confirm `git status --porcelain` is empty.

### Planned files to create

- `site/pages.ts`
- `site/rspress.config.ts`
- `site/build/pageMap.ts`
- `site/build/sources.ts`
- `site/build/markdown.ts`
- `site/build/prepare.ts`
- `site/build/main.ts`
- `tests/unit/site/pageMap.test.ts`
- `tests/unit/site/markdown.test.ts`
- `tests/unit/site/committedSources.test.ts`
- `tests/integration/site/fixtureTree.ts`
- `tests/integration/site/siteBuild.test.ts`

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`
- `.gitignore`
- `knip.json`
- `.oxlintrc.json`
- `.oxfmtrc.json`
- `tsconfig.test.json`

### Optional files that may be edited

- `vitest.config.ts`
- `site/public/.gitkeep`

### Boundary contracts

Page map → site build: `site/pages.ts` default-exports a `PageMap` (types in `site/build/pageMap.ts`). The build needs every README section and source assigned exactly once. The map provides routes, titles, ordered section names, omissions with a reason, and `holdUntil` releases. Site build → Rspress: `prepareSite` provides a generated docs root (Markdown pages plus a public directory) and a site-data JSON (version, nav, sidebar). `site/rspress.config.ts` consumes them from the one location `site/build/main.ts` sets. phase-02 (links) and phase-03 (schemas, the formats-page list) plug into `prepareSite`. phase-04 plugs the theme into the config.

### Test strategy

Write these tests before the implementation. In `tests/unit/site/pageMap.test.ts`, `checkPageMap` on in-memory inputs:
- a README with an added `## Contributing` absent from the map gives a finding naming Contributing;
- a map still naming `## Locks` after that heading was renamed gives a finding naming Locks;
- an added `docs/blog/second-post.md` absent from the map gives a finding naming it;
- double mapping and duplicate routes are findings.
Also test the real `site/pages.ts` against the real README and docs: no findings. That test fails in any phase that renames a README heading. In `tests/unit/site/markdown.test.ts`:
- `<short-name>` and `{#phase-01-setup}` outside code come out as character references;
- code spans and fences are untouched;
- an HTML comment is dropped;
- GitHub slugs are right for `Compliance review & publishing`, for a heading with inline code, and for duplicates.
`tests/unit/site/committedSources.test.ts`: no committed file under `site/` (the generated directories excluded) contains any source paragraph of 60 or more characters. Integration (`tests/integration/site/siteBuild.test.ts` with `fixtureTree.ts`) builds a made-up fixture tree. The tree has a README with an intro, three sections, a placeholder, braces and a comment, plus a reference file and a held blog post. The build goes through `site/build/main.ts`, writes under `site/.generated/test-*`, and the test asserts:
- one built HTML page per mapped route, holding its sections' text;
- the placeholder and braces appear as text, and the comment's text appears nowhere;
- every page's nav shows `v0.17.0`, linking to the GitHub release;
- the held post is absent and no Blog nav entry exists at 0.17.0, while the generator's output at a fixture version of 1.0.0 serves it and adds Blog (generator-level, with no second Rspress build);
- two generator runs give byte-identical generated sources;
- a fixture with an unmapped section exits 1, naming it.
Set generous per-test timeouts for the Rspress build.

### Implementation order

1. Install `@rspress/core`, then read the installed package and note the facts.
2. `pageMap.ts` and its unit tests.
3. `sources.ts` and `markdown.ts`, and their unit tests.
4. `site/pages.ts`, plus the real-repository page-map test.
5. `prepare.ts`, `rspress.config.ts` and `main.ts`.
6. Ignore lists, knip, tsconfig and the package scripts.
7. The integration test and the committed-sources test; then `pnpm site:build` on the real repository.

### Excluded scope

- Link rewriting and the broken-link check (phase-02).
- Schema routes, the release ledger and `_headers` (phase-03).
- Theme tokens, fonts, dark-first, the logo and favicon (phase-04).
- Adding `site:build` to `check:full`, CI or the gate profile (phase-05).
- Any edit to README.md or any other source for the site's sake.

### Verification

The `standard` gate profile in `phax.json`. In addition, `pnpm site:build` must exit 0 on the real repository (allowed through `security.agentCommands`).

### Expected handoff content

The Rspress v2 facts verified from the installed package:
- MDX or plain handling of `.md`;
- the heading-id syntax;
- outDir and public-dir behaviour;
- the 404 page;
- the CLI invocation;
- build-time network behaviour;
- the colour variables that links and callouts use.
Also record:
- the exported signatures of `checkPageMap`, `prepareSite` and `toPageMarkdown`;
- the location `main.ts` uses to hand the generated root to the config;
- how tests build a fixture tree;
- the real build's summary line;
- any peer dependency added beside `@rspress/core`;
- any deviation from the planned file lists, with its reason.

### Commit subject

`feat(site): render the docs site from the README and a page map`

### Commit body

Add site/: the page map site/pages.ts assigns every README section and every other source to a route, omit or a hold. The build in site/build/ splits the README by its ## headings, makes the Markdown render as GitHub renders it (comments dropped, placeholders and braces as text, GitHub heading ids), and runs Rspress v2 into the ignored site/doc_build. An unmapped or vanished section or file fails the build by name, and the nav shows the release the site was built from. Adds @rspress/core and the site:build, site:dev and site:preview scripts.

---

## phase-02 — Link rewriting and the broken-link check {#phase-02-links}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every link between rendered sources becomes a site route with its anchor. Every link to an unrendered repository file goes to GitHub at the release tag. A link to a missing file, to a missing anchor, or to a held source fails the build, naming the source file, the line and the link. Anchors are confirmed against the rendered pages.

### Detailed instructions

- Create `site/build/links.ts`. It collects every `link` and `definition` node of each rendered page's source text, with source file and line, and resolves each one:
  - Absolute URLs (`http:`, `https:`, `mailto:`) are unchanged.
  - A pure `#anchor` resolves within the same source document.
  - A relative path resolves against the source file's directory (POSIX; query stripped) to a repository path.
- When the target is a rendered source, rewrite the link to its route, plus `#anchor` when present.
  - For README targets, the anchor picks the route of the section holding it. README with no anchor maps to `/`.
  - A link to the same page becomes `#anchor`.
  - A file with no anchor maps to its route.
- When the target exists in the repository but is not rendered, rewrite the link to `https://github.com/lbdremy/phax/blob/v<version>/<path>`, keeping any anchor. That covers non-user docs, `.claude/…`, `examples/…`, and anchors inside an omitted README section. Use `tree/` instead of `blob/` for a directory. Unrendered targets get no anchor check.
- Report findings, all of them, in this format:
  - missing file: `✗ <source>:<line>: <link> — no such file`;
  - an anchor the target's GitHub slugs lack: `✗ <source>:<line>: <link> — no such anchor on <route>`;
  - in a build for an earlier release, a link to a held source: `✗ <source>:<line>: <link> — <path> is held until X.Y.Z`.
- Rewrite the URL part in place, by offset, so the rest of the text is unchanged. Wire this into `prepareSite` after `toPageMarkdown`'s slug computation.
- Create `site/build/verify.ts`, which runs after the Rspress build. For every rewritten in-site link with an anchor, and for every heading id the generator emitted, it confirms that the built HTML of the target route has an element with that `id`. Any miss is reported against the original source, line and link, and fails the build. Map routes to built HTML files according to the Rspress output layout phase-01 recorded.
- Extend `site/build/main.ts`: findings from links or verify exit 1. Print the summary line `site: links — rewritten to routes and to github.com/lbdremy/phax/blob/v<version>, N broken`.
- Do not edit any source to make links pass. If a real source has a broken link today, stop and report it in the handoff rather than editing it.

### Planned files to create

- `site/build/links.ts`
- `site/build/verify.ts`
- `tests/unit/site/links.test.ts`

### Planned files to edit

- `site/build/prepare.ts`
- `site/build/main.ts`
- `tests/integration/site/siteBuild.test.ts`

### Optional files that may be edited

- `site/build/markdown.ts`
- `site/build/sources.ts`
- `site/build/pageMap.ts`
- `tests/integration/site/fixtureTree.ts`

### Boundary contracts

Link pass → prepare: `rewriteLinks(page, context)` needs each page's source path, its text, its rendered slugs, the route table (source path and README slug → route), the set of existing repository paths, the version and the holds. It provides the rewritten text plus findings that carry `{ source, line, link, reason }`. Prepare → verify: the build hands `verify.ts` the list of expected `{ route, id, origin }` pairs, which the post-build check confirms in the HTML.

### Test strategy

Write `tests/unit/site/links.test.ts` before the implementation, on in-memory fixtures that mirror the spec's criteria at version 0.17.0:
- `docs/cli/reference.md#phax-orient` → `/reference/cli#phax-orient`;
- `docs/security.md#shell-command-execution` → `/security#shell-command-execution`;
- README `#security-modes`, from a section on another route → `/guide/security-modes#security-modes`, and the same anchor on its own page → `#security-modes`;
- `./spec-kit-vs-phax.md` from the OpenSpec comparison → `/compare/spec-kit-vs-phax`;
- `docs/model-routing.md` → `https://github.com/lbdremy/phax/blob/v0.17.0/docs/model-routing.md`;
- `../ideas/desktop-app.md` from a comparison → `https://github.com/lbdremy/phax/blob/v0.17.0/docs/ideas/desktop-app.md`;
- `docs/missing.md` and `docs/cli/reference.md#phax-no-such-command` each give a finding naming the source, line and link;
- a link to a held source at 0.17.0 is a finding.
A real-repository test runs the link pass on the real sources at the current version: zero findings, and the spec's named links rewrite as above. Integration: extend the fixture build with links across pages and one broken anchor. The broken variant exits 1, naming file:line:link. The good variant's built HTML holds the rewritten hrefs, and the post-build verify finds every anchor id.

### Implementation order

1. Unit tests for the link cases.
2. `links.ts` resolution and rewriting.
3. Wiring into `prepareSite` and the summary line.
4. `verify.ts`, the post-build anchor check.
5. The integration test, then `pnpm site:build` on the real repository.

### Excluded scope

- Schema files and the formats-page schema list (phase-03).
- Rspress's own dead-link option (not used; see Technical arbitrations).
- Editing any source to fix a link.

### Verification

The `standard` gate profile in `phax.json`, plus `pnpm site:build` on the real repository.

### Expected handoff content

Record:
- the `rewriteLinks` and verify signatures;
- the route-table shape;
- how the README's anchors map to routes;
- the real build's links summary line;
- any real source link that could not resolve, reported and not edited;
- any deviation from the planned file lists, with its reason.

### Commit subject

`feat(site): rewrite links to site routes and fail on broken ones`

### Commit body

Links between rendered sources now point to their site route and anchor. Links to repository files the site does not render point to GitHub at the release tag. A missing file, a missing anchor or a link to a held source fails the build, naming the source file, line and link. After Rspress runs, every rewritten anchor and emitted heading id is checked against the built HTML.

---

## phase-03 — Schema routes, the release ledger and the release cut {#phase-03-schema-routes}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every release in a committed release ledger serves every format's JSON Schema at the exact `$schema` URL phax writes. Each one is byte-identical to the latest release-named snapshot at or before that release. There is a schema index, and headers that make schemas JSON and cross-origin. The release cut appends each release to the ledger, and the build fails when the ledger and the tree disagree.

### Detailed instructions

- Create `packages/schemas/releases.json` as `{ "releases": ["0.17.0"] }`, 2-space JSON with a trailing newline.
- Create `packages/schemas/build/releaseLedger.ts`. It exports:
  - `LEDGER_PATH`;
  - `parseLedger(content)`: a non-empty array of X.Y.Z, strictly increasing; otherwise throw, naming the defect;
  - `appendRelease(ledger, version)`: throws unless the version is newer than the last entry;
  - `formatLedger(ledger)`;
  - `checkLedger({ ledger, packageVersion, releaseNamedSnapshots })`, which returns `✗` findings, all of them: the last entry differs from the package.json version; a release-named snapshot names a release absent from the ledger; the first entry differs from the lowest release-named snapshot (the first supported release).
  Reuse `isRelease` and `compareReleases` from `src/schemas/schemaUrl.ts`.
- Extend `scripts/release-cut.ts` and its doc comment. Read and parse the ledger before writing anything, so a bad ledger throws before the cut touches anything. Write the appended ledger with the manifests, and add `packages/schemas/releases.json` to `changed`. `scripts/release.sh` then stages it through `CUT_PATHS`. In `scripts/release.sh`, add `echo "appending ${VERSION} to the release ledger"` right after the snapshot-renaming echo. Leave its last three lines unchanged.
- Create `site/build/schemas.ts`. `servedSchemas(ledger, snapshots)` is pure. Its input is format id → snapshot name → bytes, as a Buffer. It returns served path → bytes:
  - For each release R in the ledger and each format id F (`FORMAT_IDS`), serve `/schemas/F/R.json` with the bytes of F's highest release-named snapshot that is at or before R.
  - When F has no such snapshot, serve nothing for it.
  - Never serve `pre-schema` or `next`.
  - Never parse or re-serialise: the bytes are the snapshot file's bytes.
  `schemaIndex(served, ledger)` returns `{ releases, paths }`, with paths sorted, as 2-space JSON plus a newline.
- Wire the schemas into `prepareSite`:
  - Read the ledger, the root package.json version and the snapshot files under `<root>/packages/schemas/snapshots/`.
  - Run `checkLedger`. Any findings fail the build.
  - Write every served file and `schemas/index.json` under the generated public directory.
  - Append a generated `## Served JSON Schemas` list to the `/reference/formats` page: one absolute URL per served path, built with `SCHEMA_URL_BASE` from `src/schemas/schemaUrl.ts`.
  Print `site: schemas — N served (ledger: <releases> × 15 formats), ledger agrees with package.json`.
- Create `site/public/_headers` with a `/schemas/*` block: `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=3600`. Confirm it lands at `site/doc_build/_headers`.
- Make sure the ledger is not packed into `@lbdremy/phax-schemas` (check the package's `files`), and that `pnpm format:check` accepts the ledger as written. If oxfmt would reformat it, add it to `.oxfmtrc.json`'s ignore patterns, as `history.lock.json` is.

### Planned files to create

- `packages/schemas/releases.json`
- `packages/schemas/build/releaseLedger.ts`
- `site/build/schemas.ts`
- `site/public/_headers`
- `tests/unit/schemasPackage/releaseLedger.test.ts`
- `tests/unit/site/schemas.test.ts`

### Planned files to edit

- `scripts/release-cut.ts`
- `scripts/release.sh`
- `tests/unit/releaseCut.test.ts`
- `site/build/prepare.ts`
- `site/build/main.ts`
- `tests/integration/site/siteBuild.test.ts`

### Optional files that may be edited

- `.oxfmtrc.json`
- `packages/schemas/package.json`
- `tests/unit/releaseWorkflow.test.ts`
- `tests/integration/site/fixtureTree.ts`
- `site/public/.gitkeep`

### Boundary contracts

Release ledger, producer and consumer: `scripts/release-cut.ts` (producer) appends through `appendRelease`. The site build (consumer) reads it through `parseLedger` and `checkLedger`. Both import `packages/schemas/build/releaseLedger.ts`. The stable shape is `{ releases: string[] }`, append-only. Schema index, producer and consumer: the site build writes `/schemas/index.json` as `{ releases: string[], paths: string[] }`. phase-06's deploy guard reads the live copy of that shape.

### Test strategy

Write the unit tests before the implementation. `tests/unit/site/schemas.test.ts`:
- On the real tree with ledger `["0.17.0"]`: exactly 15 served paths, one `/schemas/<id>/0.17.0.json` per format id, each byte-identical to `packages/schemas/snapshots/<id>/0.17.0.schema.json`. No path names `pre-schema` or `next`.
- On an in-memory fixture with ledger `["0.17.0","0.18.0"]`, where only registry has a 0.18.0 snapshot and run-status has a `next`: 30 paths. registry/0.18.0 equals the registry 0.18.0 bytes, run-status/0.18.0 equals the run-status 0.17.0 bytes, and nothing from `next` is served.
- The index lists every path, sorted.
- `site/public/_headers` sets the JSON content type and `*` CORS for `/schemas/*`.
`tests/unit/schemasPackage/releaseLedger.test.ts`:
- parse rejects non-releases and non-increasing ledgers;
- `appendRelease` refuses a non-newer version;
- `checkLedger` names the mismatch for a last entry of 0.17.0 under a package.json at 0.18.0, and for a `registry/0.18.0.schema.json` whose release is absent from the ledger;
- the real ledger agrees with the real tree.
Extend `tests/unit/releaseCut.test.ts` (copy the ledger into the temporary tree): after cutting X, the ledger ends with X and its path is among the changed paths, and the real tree stays untouched. Integration: the fixture build ships `schemas/<id>/<release>.json` and `_headers` at the output root, and two generator runs give byte-identical schema files.

### Implementation order

1. Ledger module and its unit tests.
2. The committed ledger, then the release-cut extension and its test, then the release.sh echo.
3. `schemas.ts` and its unit tests.
4. Wiring into `prepareSite`, the formats-page list, `_headers` and the summary line.
5. Integration assertions, then `pnpm site:build` on the real repository and a dry-run `pnpm exec tsx scripts/release-cut.ts 0.18.0 --root <copy>`.

### Excluded scope

- The deploy guard that reads the live index (phase-06).
- Any change to snapshots, to `$schema` URLs or to a persisted format; adding `$id` to served schemas.
- Editing docs/release.md for the ledger (phase-07).

### Verification

The `standard` gate profile in `phax.json`, plus `pnpm site:build` on the real repository.

### Expected handoff content

Record:
- the ledger path and the `releaseLedger.ts` exports;
- the schema index's exact shape and path;
- the real build's schemas summary line;
- confirmation that release-cut lists the ledger among the changed paths;
- whether `.oxfmtrc.json` or `packages/schemas/package.json` needed an edit;
- any deviation from the planned file lists, with its reason.

### Commit subject

`feat(site): serve every release's JSON Schemas from a release ledger`

### Commit body

Add packages/schemas/releases.json, the append-only list of releases since 0.17.0. The release cut appends to it in the release commit. The site serves /schemas/<format id>/<release>.json for every ledger release and format, byte-identical to the latest release-named snapshot at or before that release, plus /schemas/index.json and _headers that make schemas JSON and cross-origin. A ledger out of step with package.json or the snapshots fails the build.

---

## phase-04 — Identity: tokens, fonts, dark-first, logo and favicon {#phase-04-identity}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The site carries the phax identity:
- a dark-first warm palette whose tokens meet tested contrast thresholds in both themes;
- bronze links and gold kept to accents in the light theme;
- warnings that are never gold;
- self-hosted IBM Plex fonts;
- a single-weight geometric P/F logo beside the lowercase `phax` wordmark, also used as the favicon.

### Detailed instructions

- Install: run `pnpm add -D @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono`. This is the only registry access in the phase.
- Create `site/theme/tokens.ts` with `THEMES.dark` and `THEMES.light`, typed by role: `bg`, `bgSoft`, `text1`, `text2`, `link`, `brand` (gold accent), `warning`, plus `danger` if styled separately. Use the §6 values (dark is the default). Also map each role to the CSS variables it sets: the `--rp-c-*` names phase-01 found in the installed theme (including the brand variants Rspress derives), plus `--phax-c-link` and `--phax-c-warning`. Export `GOLD_ROLES`. If a §6 value misses a threshold against `bgSoft`, retune the hex value within the brand rule (old gold, deep, unsaturated, never yellow) and record it.
- Create `site/theme/styles.css`, the committed non-token rules:
  - `@import` the fontsource latin subsets (sans 400 and 600, mono 400), and set the text and code font families;
  - links use the link token;
  - in the light theme, every rule where the default theme colours running text or links with the brand variable is overridden to the link token;
  - rules, focus rings and highlights use the brand token;
  - warning, caution and danger callouts use `--phax-c-warning`/danger and never a brand variable.
- Create `site/build/theme.ts`:
  - `renderThemeCss(THEMES, stylesCss)` writes the dark and light variable blocks, then `styles.css`, into one generated stylesheet under `site/.generated/`.
  - `contrastRatio(a, b)` computes the WCAG 2 contrast ratio.
  - `hue(hex)`.
  - `DARK_FIRST_SCRIPT`, an inline head script. When the storage key Rspress uses for the appearance holds no value, it stores and applies dark before Rspress's own appearance logic runs. If the installed Rspress offers a default-appearance option, use that option instead, and keep the script out.
- Create `site/public/logo.svg` following §6: a 32×32 viewBox, `fill="none"`, one stroke colour (the dark gold token's value), one `stroke-width` for every stroke, butt caps, and no gradient. The stem, top arm and upper bowl form one path; the lower bowl and middle arm form a second. The gap between the upper bowl's end and the lower bowl's start is at least 1/8 of the glyph height. Use only absolute `M`/`V`/`H` commands and arcs with absolute endpoints, so the test can compute endpoints.
- Wire the theme into `site/rspress.config.ts`:
  - `logo: '/logo.svg'`, `logoText: 'phax'` (lowercase), `icon: '/logo.svg'`;
  - `globalStyles` points at the generated stylesheet;
  - the head carries the dark-first script;
  - the theme toggle stays.
  `prepareSite` (or `main.ts`) writes the generated stylesheet.
- Confirm, on the real build, that no built HTML, CSS or JS loads a font, script, style or image from an absolute http(s) URL, and that the woff2 files are in `site/doc_build`.

### Planned files to create

- `site/theme/tokens.ts`
- `site/theme/styles.css`
- `site/build/theme.ts`
- `site/public/logo.svg`
- `tests/unit/site/theme.test.ts`
- `tests/unit/site/logo.test.ts`

### Planned files to edit

- `site/rspress.config.ts`
- `site/build/prepare.ts`
- `package.json`
- `pnpm-lock.yaml`
- `tests/integration/site/siteBuild.test.ts`

### Optional files that may be edited

- `knip.json`
- `site/build/main.ts`
- `site/public/.gitkeep`
- `tests/integration/site/fixtureTree.ts`

### Boundary contracts

Tokens → stylesheet and tests: `site/theme/tokens.ts` is the single source of the colour values. `site/build/theme.ts` renders them into the generated stylesheet that the Rspress config loads through `globalStyles`. The contrast and hue tests read the same module. The logo file is consumed by both the nav logo and the favicon, by path `/logo.svg`.

### Test strategy

Write the unit tests before the implementation. `tests/unit/site/theme.test.ts` checks:
- In both themes, `text1` and `link` reach at least 7:1 and `text2` at least 4.5:1 against `bg` and `bgSoft`, and `brand` at least 3:1 against both.
- The light theme's link is the bronze token. No text or link role equals any gold token.
- The warning, caution and danger colours each differ in hue by at least 20° (circular) from every gold token, and the `styles.css` rules for those callouts reference no brand variable.
- `DARK_FIRST_SCRIPT`, run against a fake empty storage and a `matchMedia` that prefers light, selects dark. Against a stored `light`, it leaves light.
`tests/unit/site/logo.test.ts` parses the SVG and checks:
- one stroke colour, equal to the dark gold token;
- no gradient and no fill colour;
- every stroke has the same width;
- the bowl gap is at least one eighth of the glyph height, computed from path endpoints.
Integration (fixture build) checks:
- each page has a `rel="icon"` link to `logo.svg`;
- the nav shows the logo and the lowercase `phax` wordmark;
- the head carries the dark-first script;
- no built HTML `<link>`/`<script>`/`<img>` and no CSS `url()`/`@import` uses an absolute http(s) URL;
- woff2 font files are present in the output.

### Implementation order

1. Install the font packages.
2. Tokens and theme helpers, with their tests, retuning any value that misses a threshold.
3. `styles.css` and the generated stylesheet.
4. The logo SVG and its test.
5. Config wiring and the dark-first script.
6. Integration assertions, then `pnpm site:build` on the real repository.

### Excluded scope

- Screenshot or visual-regression tests.
- A PNG favicon fallback.
- A shared design system or theme package.
- Analytics, cookies or any remote asset.

### Verification

The `standard` gate profile in `phax.json`, plus `pnpm site:build` on the real repository.

### Expected handoff content

Record:
- the final hex values and their computed ratios per theme;
- the Rspress variables overridden, and why;
- whether the dark-first default uses an Rspress option or the inline script, and the storage key;
- the logo's gap and glyph height in units;
- whether knip needed the font packages ignored;
- any deviation from the planned file lists, with its reason.

### Commit subject

`feat(site): add the dark-first phax identity, logo and favicon`

### Commit body

Theme tokens for a dark-first warm palette and an opt-in light theme, with tested WCAG contrast. Running text and links reach 7:1, secondary text 4.5:1 and gold accents 3:1. Links are bronze in the light theme, and warnings use a terracotta that is never gold. Fonts are self-hosted IBM Plex. A first geometric P/F logo, in one stroke weight and the gold accent, sits beside the lowercase phax wordmark and is also the favicon.

---

## phase-05 — CI and the project gate build the site {#phase-05-ci-gate}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

CI builds the site on every push to main and every pull request, and deploys nothing. `pnpm check:full` and the `standard` gate profile build the site too, so a README heading rename or a broken link fails inside the phase that caused it.

### Detailed instructions

- In `package.json`, append `&& npm run site:build` to `check:full`, following the script's existing `npm run` style.
- In `phax.json`, add `{ "command": "pnpm site:build", "surface": "structural", "firing": "every-phase" }` to `gateProfiles.standard`, after the model-catalog check. Change nothing else in `phax.json`.
- In `.github/workflows/ci.yml`, add a step named `Docs site` running `pnpm site:build`, right after `Build` and before `Architecture audit`. Add no wrangler step, no Cloudflare secret and no upload of any kind.
- Extend `tests/unit/releaseWorkflow.test.ts` with a CI block:
  - `pnpm site:build` runs after `pnpm build`;
  - no ci.yml step runs `wrangler`;
  - ci.yml's text never contains `CLOUDFLARE`.
- Create `tests/unit/site/gate.test.ts`. It asserts that `check:full` contains `site:build`, and that the `standard` profile in `phax.json` holds a `pnpm site:build` step.
- Run `pnpm check:full` and confirm it builds the site and passes.

### Planned files to create

- `tests/unit/site/gate.test.ts`

### Planned files to edit

- `package.json`
- `.github/workflows/ci.yml`
- `phax.json`
- `tests/unit/releaseWorkflow.test.ts`

### Optional files that may be edited

- `knip.json`

### Test strategy

Write the new assertions before editing the workflow and scripts, then watch them fail. Both are unit tests that read `ci.yml` (parsed YAML), `package.json` and `phax.json` as files: the CI block in `releaseWorkflow.test.ts`, and `gate.test.ts`. The existing CI assertions (the schemas smoke after the build, under Node 20, and setup-node pins) must keep passing unchanged.

### Implementation order

1. Tests.
2. package.json `check:full`.
3. ci.yml step.
4. phax.json gate entry.
5. `pnpm check:full`.

### Excluded scope

- The release workflow, the deploy and the manual deploy (phase-07).
- Any Cloudflare reference anywhere in CI.

### Verification

The `standard` gate profile in `phax.json`, which from this phase on includes `pnpm site:build`, plus `pnpm check:full`.

### Expected handoff content

Record:
- the CI step's name and position;
- the exact gate-profile entry added;
- the wall-clock time `pnpm site:build` adds to the gate;
- any deviation from the planned file lists, with its reason.

### Commit subject

`ci: build the docs site in CI and in the project gate`

### Commit body

CI runs pnpm site:build after the build on every push to main and pull request, and deploys nothing. check:full and the standard gate profile run it too, so a README heading rename or a broken link fails inside the phase that made it.

---

## phase-06 — Deploy guard, preview check and Worker config {#phase-06-deploy-tooling}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The deploy has its offline-tested building blocks:
- a guard that refuses a build missing any path the live schema index lists, and passes only on a first deploy's 404;
- helpers that derive the preview alias and read the preview URL and version id from wrangler's upload output;
- a preview check that passes only on a 200 JSON schema and a page showing the release;
- the static-assets-only Worker config.
None of them reads a credential or runs wrangler.

### Detailed instructions

- Install: run `pnpm add -D wrangler`. Never run wrangler in this phase. Read its installed source and `config-schema.json` to confirm three things: the `versions upload` flag for a preview alias, the wording of the lines that print the version id and the preview URL, and the `versions deploy` arguments (version@percentage, non-interactive flag). Record them.
- Create `site/wrangler.jsonc` per §6, without comments, so tests can `JSON.parse` it:
  - `$schema` pointing at `../node_modules/wrangler/config-schema.json`;
  - `name: phax-docs`, `compatibility_date: 2026-09-25`;
  - no `main`;
  - `assets.directory: ./doc_build`, with `not_found_handling: 404-page`;
  - `workers_dev: true` and `preview_urls: true`;
  - no `routes`: the custom domain is attached by hand (see Technical arbitrations).
- Create `site/deploy/guard.ts`. `guardSchemas({ live, builtPaths })` takes `live` as either `{ kind: 'absent' }` or `{ kind: 'index', index }`. It returns `ok`, or a refusal naming the first missing path, taken in the live index's sorted order. `readLiveIndex(url, fetch)` maps the response as follows:
  - an HTTP 404 → absent;
  - a 200 with a valid `{ releases, paths }` body → index;
  - any other status, an invalid body, or a thrown network error → a refusal naming the cause.
- Create `site/deploy/preview.ts`:
  - `previewAlias('v0.18.0')` returns `v0-18-0`, and throws on a non-`vX.Y.Z` tag (reuse `versionFromTag` from `scripts/releaseVersion.ts`).
  - `parseUpload(output, alias)` returns `{ versionId, previewUrl }`. The preview URL must start with `https://<alias>-phax-docs.` and end in `.workers.dev`. It throws, naming what is missing.
  - `checkPreview({ url, release, fetch, sleep, attempts })` passes only when two conditions hold: GET `<url>/schemas/registry/<release>.json` answers 200, with a content type starting `application/json` and `access-control-allow-origin: *`; and GET `<url>/` answers 200 with a body containing `v<release>`. It retries a bounded number of times through the injected `sleep`, then fails, naming the last failure.
- Create `site/deploy/main.ts`, the CLI used only by the workflows:
  - `guard --live-url <url> --build <dir>` lists every file under `<dir>/schemas/`, runs the guard and exits 1 with `✗ deploy guard: <dir> does not serve <path>, which docs.phax.run serves`;
  - `alias --tag <tag>`;
  - `upload-outputs --log <file> --tag <tag>` prints `version_id=…` and `preview_url=…` lines for `$GITHUB_OUTPUT`;
  - `check --url <url> --tag <tag>`.
  It uses the global `fetch` and real timers only in the CLI path, never reads an environment credential, and never spawns wrangler.
- Add `site/deploy/main.ts` to knip's entries. If knip reports `wrangler` as unused (it is only used from the workflows phase-07 writes), add it to `ignoreDependencies`.

### Planned files to create

- `site/wrangler.jsonc`
- `site/deploy/guard.ts`
- `site/deploy/preview.ts`
- `site/deploy/main.ts`
- `tests/unit/site/deployGuard.test.ts`
- `tests/unit/site/deployPreview.test.ts`
- `tests/unit/site/workerConfig.test.ts`

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`
- `knip.json`

### Optional files that may be edited

- `.oxfmtrc.json`
- `tsconfig.test.json`

### Boundary contracts

Deploy CLI → workflows (phase-07): the workflows call `pnpm exec tsx site/deploy/main.ts <guard|alias|upload-outputs|check>` with the flags above, and read `version_id` and `preview_url` from the upload step's outputs. Live index → guard: the guard consumes phase-03's `{ releases, paths }` shape from `https://docs.phax.run/schemas/index.json`. Credentials stay outside this boundary: only the wrangler commands in the workflow steps receive them through env.

### Test strategy

Write the tests before the implementation, all offline with injected fetch and sleep. `deployGuard.test.ts`:
- A fixture live index listing `/schemas/registry/0.18.0.json`, checked against a 0.17.0 build that lacks it, refuses and names that path.
- A live 404 passes, as a first deploy.
- A 500, an invalid body and a thrown network error each refuse.
- The CLI `guard` subcommand exits 1 on refusal and runs no upload.
`deployPreview.test.ts`:
- `previewAlias('v0.18.0')` is `v0-18-0`, and a malformed tag throws.
- `parseUpload` reads a made-up output written in wrangler's verified wording, and throws when the URL or id is missing.
- `checkPreview` passes on 200 plus `application/json` plus `*` CORS plus a home page containing `v0.18.0`. It fails on a 404, on `text/html`, and on a home page showing another version. It retries up to the bound.
`workerConfig.test.ts`:
- `site/wrangler.jsonc` validates against the installed `wrangler/config-schema.json` with ajv;
- it has no `main`;
- `assets.directory` is `./doc_build`;
- `preview_urls` is true.
The same file checks that no file under `site/` or `scripts/` contains `CLOUDFLARE_`.

### Implementation order

1. Install wrangler and read its installed source and schema.
2. Tests.
3. `guard.ts`.
4. `preview.ts`.
5. `main.ts`.
6. `wrangler.jsonc`.
7. knip.

### Excluded scope

- Workflow steps and the manual-deploy workflow (phase-07).
- Running wrangler, calling Cloudflare, or reading any credential.
- A Worker script: static assets only.

### Verification

The `standard` gate profile in `phax.json`, which includes `pnpm site:build`.

### Expected handoff content

Record:
- the verified wrangler flags and the output wording `parseUpload` relies on;
- the exact `site/deploy/main.ts` subcommands, flags and exit codes;
- the retry bound and delay of `checkPreview`;
- whether knip needed `wrangler` ignored;
- any deviation from the planned file lists, with its reason.

### Commit subject

`feat(site): add the deploy guard, preview check and Worker config`

### Commit body

site/wrangler.jsonc declares a static-assets-only Worker serving site/doc_build, with per-version preview URLs. site/deploy/ adds:
- the guard, which refuses a build missing any path the live schema index lists and treats only a 404 as a first deploy;
- the preview alias and the upload-output parser;
- the preview check, which passes only on a 200 JSON schema and a page showing the release.
None of them reads a credential or runs wrangler. Adds wrangler as a devDependency.

---

## phase-07 — Release-workflow deploy, manual deploy and release docs {#phase-07-release-deploy}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A pushed release tag deploys docs.phax.run after every gate, build, smoke and version check, and before the first npm stage publish, in this order: guard, upload under the release's preview alias, check, promote. A failure stages nothing and leaves the promoted site serving. The author can redeploy a tag by hand through the same steps. `docs/release.md` documents the one-time Cloudflare setup, the new release step, the site checks and the manual redeploy.

### Detailed instructions

- In `.github/workflows/release.yml`:
  - Add `pnpm site:build` to the `Gate` step.
  - Add job-level `env: DOCS_TAG: ${{ github.ref_name }}`.
  - Insert four steps after `Verify package versions match tag` and before the first `npm stage publish`, all with `shell: bash` and none with `continue-on-error`:
    1. `Docs deploy: guard` runs `pnpm exec tsx site/deploy/main.ts guard --live-url https://docs.phax.run/schemas/index.json --build site/doc_build`.
    2. `Docs deploy: upload`, with id `docs_upload` and env `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` and `CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`. It computes `ALIAS` with the `alias` subcommand, runs `pnpm exec wrangler versions upload --config site/wrangler.jsonc` with the verified preview-alias flag, tees the output to `$RUNNER_TEMP/docs-upload.log`, then appends `upload-outputs` to `$GITHUB_OUTPUT`.
    3. `Docs deploy: check` runs `check --url ${{ steps.docs_upload.outputs.preview_url }} --tag "$DOCS_TAG"`.
    4. `Docs deploy: promote`, with the same two secret env entries, runs `pnpm exec wrangler versions deploy` with the uploaded version id at 100%, non-interactive, with `--config site/wrangler.jsonc`.
  Keep every existing step and invariant unchanged.
- Create `.github/workflows/docs-deploy.yml`:
  - trigger: `workflow_dispatch`, with a required string input `tag`;
  - `permissions: contents: read`;
  - one job with `env: DOCS_TAG: ${{ inputs.tag }}`;
  - checkout with `ref: ${{ inputs.tag }}`;
  - the same pnpm, setup-node (Node 24, same pinned SHAs as release.yml) and `pnpm install` steps;
  - a step verifying that `DOCS_TAG` is `vX.Y.Z` and equals the checked-out `package.json` version;
  - `pnpm site:build`;
  - then the four `Docs deploy:` steps, textually identical to release.yml's.
  No npm publish, no GitHub Release.
- Extend `tests/unit/releaseWorkflow.test.ts`. Keep the existing assertions, extending them and never loosening them:
  - The `Gate` runs `pnpm site:build`.
  - The four deploy steps appear in the order guard, upload, check, promote, all after Gate, binaries, schemas smoke, prepare-npm and the version check, and all before the first publish. They join the `beforePublish` list of the fallible-steps test.
  - Only the second publish and the GitHub Release follow the first publish (unchanged).
  - No step sets `continue-on-error`.
  - Across release.yml and docs-deploy.yml, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` appear only in the `env` of the upload and promote steps (serialise every other step, plus the workflow-level and job-level env, and assert they are absent there).
  - The upload passes the preview alias, and check precedes promote.
  - docs-deploy.yml is `workflow_dispatch` with a `tag` input, checks out `inputs.tag`, and runs `pnpm site:build` before the guard. Its deploy steps deep-equal release.yml's, and it has no `npm stage publish` and no `softprops/action-gh-release` step.
  - The GITHUB_TOKEN-only rule (no NPM_TOKEN) still holds.
- Edit `docs/release.md`:
  - Under `## Prerequisites`, add `### The docs site (one-time, by hand — never automated)`, stating that none of these steps is automated:
    1. a Cloudflare account holding the phax.run zone;
    2. an API token from the Edit Cloudflare Workers template, limited to that account and zone, stored as GitHub secret `CLOUDFLARE_API_TOKEN`, and the account id as `CLOUDFLARE_ACCOUNT_ID`;
    3. the `phax-docs` Worker created, and the custom domain docs.phax.run attached to it, which creates its DNS record and certificate;
    4. the workers.dev subdomain and preview URLs enabled on the Worker.
  - In the release process: release-cut also appends the release to `packages/schemas/releases.json`. The workflow list gains the step 'deploys docs.phax.run (guard against the live schema index, upload with alias vX-Y-Z, check, promote) before the npm stage publishes'. The failure paragraph adds that a failed guard, upload or check stages nothing, creates no release and leaves the promoted site unchanged; at most an unpromoted version keeps its preview URL.
  - Add to Verify: docs.phax.run shows vX.Y.Z; `https://docs.phax.run/schemas/registry/X.Y.Z.json` answers 200; the previous release's preview URL still shows its own version. Also add a look at the release's preview URL (and `pnpm site:preview` beforehand) before approving the npm packages.
  - Add a new section `## Redeploying the docs site by hand`: `gh workflow run docs-deploy.yml -f tag=vX.Y.Z`, which runs the same guard, upload, check and promotion, stages nothing on npm, and is refused by the guard if it would drop a served schema URL.
  Keep every link valid: the site build checks them.
- Add a test, in `releaseWorkflow.test.ts` or beside it, that `docs/release.md`'s one-time docs-site section names `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, the phax.run zone, the docs.phax.run custom domain and preview URLs, and says the steps are not automated.

### Planned files to create

- `.github/workflows/docs-deploy.yml`

### Planned files to edit

- `.github/workflows/release.yml`
- `tests/unit/releaseWorkflow.test.ts`
- `docs/release.md`

### Optional files that may be edited

- `knip.json`
- `site/deploy/main.ts`

### Boundary contracts

Workflows → deploy CLI: both workflows call the phase-06 subcommands and pass the tag through the job-level `DOCS_TAG`. The upload step exposes `version_id` and `preview_url` as step outputs for the check and promote steps. Workflows → Cloudflare: only the `wrangler versions upload` and `wrangler versions deploy` steps receive `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, through their own `env`.

### Test strategy

Write the workflow assertions in `tests/unit/releaseWorkflow.test.ts` first and watch them fail, then edit the workflows. These are unit tests on parsed YAML; nothing runs a workflow, and no test touches the network. The docs assertion reads `docs/release.md` as text. `pnpm site:build` in the gate re-renders `docs/release.md` and checks its links.

### Implementation order

1. Workflow tests.
2. release.yml: Gate `site:build`, `DOCS_TAG`, and the four deploy steps.
3. docs-deploy.yml.
4. docs/release.md and its test.
5. The full gate.

### Excluded scope

- Running any workflow, deploying, or touching Cloudflare.
- Changes to the binaries, the npm packages or the GitHub Release beyond the deploy's position.
- Deploying from CI, from pull requests or from a local script; pull-request preview sites.

### Verification

The `standard` gate profile in `phax.json`, which includes `pnpm site:build`, plus `pnpm check:full`.

### Expected handoff content

Record:
- the final release.yml step order, from the version check to the GitHub Release;
- the exact wrangler commands the upload and promote steps run;
- how docs-deploy.yml verifies the tag;
- the sections added to docs/release.md;
- the first-release checklist the author must do by hand before tagging: the one-time Cloudflare setup, then watching the first deploy's guard pass on the 404;
- any deviation from the planned file lists, with its reason.

### Commit subject

`ci(release): deploy docs.phax.run before the npm stage publishes`

### Commit body

The release workflow builds the site in its Gate. After every fallible check and before the first npm stage publish, it deploys docs.phax.run: guard against the live schema index, upload under the release's preview alias, check the preview, then promote. A failure stages nothing and leaves the promoted site serving. docs-deploy.yml lets the author redeploy a tag by hand through the same steps, without touching npm. The Cloudflare secrets reach only the upload and promote steps. docs/release.md documents the one-time Cloudflare setup, the new step, the site checks and the manual redeploy.
