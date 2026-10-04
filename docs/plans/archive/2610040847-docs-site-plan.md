---
status: Completed
source-spec: docs/specs/2610040828-docs-site.md
approved:
  date: 2026-10-04
  baseline: 55cdf26
---
# Docs site

This plan implements the spec `docs-site` (`docs/specs/2610040828-docs-site.md`). The result is docs.phax.run as a deterministic, offline rendering of the documentation the repository holds at the release tag. The site serves every released format's JSON Schema at the exact `$schema` URL phax writes. CI and the run's completion gate build it. Only the release workflow or the author's manual dispatch deploys it. The author decided every §9 question on 2026-10-04, each on its recommended option. This plan implements those decisions and reopens none of them.

Phases, core to surface:

- phase-01: the Rspress v2 skeleton under `site/` and the page map `site/pages.ts`. It covers the README split by its `##` headings, every source mapped exactly once, holds, GitHub-faithful Markdown, the release label in the navigation, the offline/no-remote-asset check and `pnpm site:build|site:dev|site:preview`. Covers §5.1–§5.4, the rendering half of §5.8, §5.9–§5.11, §5.18 and §5.19.
- phase-02: links are rewritten to site routes and to GitHub at the release tag, and a missing file or anchor fails the build, naming the source file, line and link. Covers §5.5–§5.7 and the link half of §5.8.
- phase-03: the release ledger `packages/schemas/releases.json`, which the release cut appends to. Every ledger release's schema of every format is served at `/schemas/<format id>/<release>.json`, with the schema index and `_headers`. Covers §5.12–§5.16.
- phase-04: the identity. Dark and light tokens with a contrast test, dark first, self-hosted fonts, the geometric logo, the favicon and the lowercase wordmark. Covers §5.28–§5.32.
- phase-05: CI builds the site, and phax.json's gate profile gains `pnpm site:build` as a `terminal` step. Covers §5.23 and §5.26.
- phase-06: the release-workflow deploy runs guard → preview upload → check → promote, between the version check and the first npm stage publish. It also adds the manual `docs-deploy.yml`. Covers §5.17, §5.20–§5.22, §5.24 and §5.25.
- phase-07: `docs/release.md` gains the one-time setup, the deploy step, the Verify checks and redeploying by hand. Covers §5.27 and §11.

Execution caveats:

- Phase sessions have no network. The one exception is `pnpm add`, which needs the npm registry. It runs once at the start of each phase that first imports a dependency: phase-01 (`@rspress/core` and the Markdown helpers), phase-04 (fonts) and phase-06 (`wrangler`). Every later install comes from the committed lockfile, through `pnpm install`, the setup command. If the registry is unreachable, the phase stops and reports. It never vendors a package.
- No phase deploys, runs wrangler, fetches docs.phax.run or reads a Cloudflare credential. The deploy exists only in the two workflows. The only code that touches the network, the guard's fetch and the preview check, is tested against injected fakes.
- Tests never run Rspress and never check the real README against the page map. The real-tree build is `pnpm site:build`, run only by CI and by the run's completion gate (q-gate). Before committing, phases run the full build themselves with `pnpm exec tsx site/build/site.ts build`.
- Test fixtures are made up inline in the tests. Nothing from `~/.phax` or another repository enters this public repository.
- Regenerated file: `pnpm-lock.yaml`, rewritten by `pnpm add` in phase-01, phase-04 and phase-06 and listed in those phases' edits.
- This run's own final gate uses the gate profile frozen at run start, so it does not run `pnpm site:build` yet. phase-07 runs the build by hand.
- No release is cut here. The first deploy is the first release tag cut after this work lands, and the 15 `0.17.0` schema URLs resolve from that deploy.

## Required commands

- `pnpm add`
- `pnpm exec tsx`

`security.agentCommands` in `phax.json` already allows both commands, so no configuration change is needed.

- `pnpm add -D` adds devDependencies in phase-01 (`@rspress/core@^2`, `micromark-extension-gfm`, `mdast-util-gfm`, `github-slugger`), phase-04 (`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`) and phase-06 (`wrangler`). It is the only command in this plan that reaches the npm registry.
- `pnpm exec tsx` runs the full site build (`pnpm exec tsx site/build/site.ts build`) and the release cut on a copy of the tree. `pnpm site:build` joins phax.json only as phase-05's terminal gate step, so the agent never needs it in its own allowed set.

## Technical arbitrations

- GitHub-faithful rendering comes from a pre-build transform. The generator parses each source with `mdast-util-from-markdown` and the GFM extensions, then edits the source text at node offsets. It drops HTML comments and backslash-escapes `<`, `>`, `{` and `}` in text. Angle-bracket placeholders that parse as HTML are emitted as literal text, and `<url>` autolinks become `[url](url)`. The output is valid whether Rspress compiles `.md` as MDX or as plain Markdown. Loss accepted: a source that uses a real HTML element (`<details>`, `<br>`) fails the build, naming the file and line, instead of rendering it as GitHub would. The sources hold none today, so rendering raw HTML stays a deliberate future change.
- Anchors are GitHub's. Every heading gets an explicit id equal to its GitHub slug, from `github-slugger` with one slugger per source in document order. A link written for GitHub therefore resolves on the site unchanged, and the post-build check proves the ids reached the HTML. Loss accepted: Rspress's own heading slugs are overridden, at the cost of one more devDependency.
- Link rewriting and the dead-link check are our own pre-build step, with anchors re-checked against the built HTML, rather than Rspress's link features. Only the pre-build step knows the source file and line that §5.7's error must name, and holds and GitHub-at-the-tag rewriting are ours anyway. Loss accepted: a second link mechanism beside Rspress's. Rspress's own dead-link check is turned off wherever it would duplicate or contradict ours.
- Site tooling lives in `site/build/`: one tsx entry, `site/build/site.ts`, with pure modules beside it. It is tested from `tests/unit/site/` and kept out of `scripts/`. Loss accepted: build scripts now live in two places. In exchange, the whole pipeline is the `site/` folder plus a few workflow steps, which is what steme copies.
- One tsx entry drives the whole build: `site/build/site.ts build` runs generate → Rspress → post-build checks. It calls Rspress's Node API when the installed package exports one, and otherwise spawns the installed CLI. `pnpm site:build` is that entry, and phases run it as `pnpm exec tsx site/build/site.ts build`, which `phax.json` already allows. Loss accepted: Rspress is driven from a script rather than named directly in package.json.
- Tests use made-up fixtures only and never check the real README against the page map. A heading rename therefore fails only `pnpm site:build`, at the run's final phase gate and in CI, as q-gate decided. Loss accepted: `pnpm test` stays green on a README whose headings no longer match the map. Tests that read the real tree read only what the release cut changes (the ledger and snapshots), `.gitignore`, `phax.json`, the workflows and `docs/release.md`.
- The release ledger is `packages/schemas/releases.json`, holding `{ "releases": [...] }`. The release cut writes it as 2-space JSON plus a newline, and it is excluded from oxfmt so that the cut's output is the committed form. Besides §5.16, the site build also refuses a ledger that is not strictly increasing or whose first entry is not the first supported release. Loss accepted: one more oxfmt exclusion.
- Schema files, `schemas/index.json` and `_headers` are written by the generator into Rspress's public folder, which Rspress copies verbatim. The post-build check proves that the bytes in `site/doc_build` equal the snapshots. The schema index has the shape `{ releases, paths }`, both sorted. Loss accepted: the build relies on Rspress's public-folder copy, and the byte check guards it.
- The logo comes in two files with identical geometry: `site/public/logo.svg` in the dark accent `#B39257`, which is the favicon and the dark-theme logo, and `site/public/logo-light.svg` in the light accent `#9A7A3E`. The dark accent on the light background is about 2.6:1, under §5.29's 3:1. Loss accepted: two files to keep in step, which the logo test pins. The favicon is the dark-accent file on every browser tab.
- The favicon is SVG only, with no PNG fallback (the spec left this open). Loss accepted: browsers without SVG favicon support show their default icon.
- Fonts are IBM Plex Sans 400/600 and IBM Plex Mono 400 from `@fontsource/*` (OFL), latin subset, imported by the generated theme CSS so that Rspress bundles them. Loss accepted: non-latin glyphs fall back to system fonts.
- The identity tokens live in `site/theme/tokens.ts`. The generator renders the theme CSS from that module, and the contrast test reads the same module. Loss accepted: the palette is edited in TypeScript, not in CSS.
- Dark first uses the installed Rspress's own option for a dark default if it has one. Otherwise an inline head script, running before Rspress's appearance logic, applies dark when no preference is stored. Loss accepted: the script couples to Rspress's storage key and dark class. It is tested with fakes, and a Rspress upgrade could break it.
- The manual deploy is a separate `.github/workflows/docs-deploy.yml` (workflow_dispatch, input `tag`). Its four deploy steps are identical to release.yml's: both jobs set `RELEASE_TAG`, and a test pins the steps as equal. Loss accepted: the deploy steps are written twice. The alternative, a dispatch trigger on release.yml, would give up a release workflow with a single path: the npm publishes and the GitHub Release would need conditions, which loosens the rule that every fallible step precedes the first publish.
- The custom domain docs.phax.run is attached once by hand in the Cloudflare dashboard and is not declared in `site/wrangler.jsonc`. `wrangler versions upload` and `versions deploy` deploy versions, not routes (phase-06 confirms this in the installed wrangler), and §5.27 already lists the domain as a hand step. Loss accepted: the domain binding is not visible in the repository's config.
- `site/build/preview-check.ts` reads the uploaded version's id and preview alias URL from wrangler's machine-readable output file (`WRANGLER_OUTPUT_FILE_PATH`, ND-JSON), rather than from a repository variable holding the workers.dev subdomain. It falls back to parsing wrangler's printed output only if the installed version writes no such entry. Loss accepted: the check depends on wrangler's output-file contract. If that contract changes, the check fails before promotion and nothing is harmed.
- Deploy guard: a 404 means a first deploy and passes. Any other non-200 status, a network error, or a body that is not a schema index refuses (strict over loose). Loss accepted: an outage of docs.phax.run blocks a release until the site answers again; the remedy is to re-push the tag.
- Links into unrendered content: in a build before its release, a link to a held source becomes its plain link text. A link to an omitted README section goes to README.md on GitHub at the tag. A relative image fails the build, because §5.9 forbids loading it from GitHub. Loss accepted: a reader of an early build loses the pointer to a held post, which is exactly what §5.8 asks.
- Each dependency is added by the phase that first imports it, so knip stays green in every phase. Loss accepted: three phases need registry access instead of one.
- P3 (oracle first) is not applied: no oracle phase kind ships yet, so each phase writes its own tests first. Loss accepted: the implementing agent can edit its own tests.

---

## phase-01 — Rspress skeleton and the page map {#phase-01-skeleton-page-map}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

`pnpm site:build` turns the committed sources into an offline Rspress site in `site/doc_build`. The README is split into guide pages by one committed page map, and every source is assigned exactly once. Nothing generated is committed, and the navigation shows the release the site was built from.

### Detailed instructions

- Install first: `pnpm add -D @rspress/core@^2 micromark-extension-gfm mdast-util-gfm github-slugger`. This is the only registry access in this phase. Add a peer dependency that pnpm reports missing (e.g. react, react-dom) in the same command, and only then. If the installed packages need build scripts, use pnpm 10's `onlyBuiltDependencies` in `pnpm-workspace.yaml`, and only if the build fails without them.
- Before writing the config, establish the facts from the installed `node_modules/@rspress/core` (package.json exports, type declarations, CLI source), not from memory: the config fields for root/docs directory, outDir, title, logo, logoText, icon, globalStyles, head, themeConfig nav/sidebar/socialLinks/darkMode, search and lastUpdated; the markdown dead-link option; whether `.md` compiles as MDX or plain Markdown; the custom heading-id syntax (`## Heading {#id}`); where the public folder lives; whether build/dev/preview are exported as Node functions; and the dark-mode storage key and CSS class, plus the callout class or variable names (phase-04 needs these). Record all of them in the handoff.
- Write `site/build/pageMap.ts`. It holds the page-map types and an identity `definePageMap`. README entries are `{ route, title, sections, holdUntil? }` or `{ omit: [...sections], why }`. File entries are `{ route, title?, source, holdUntil? }` or `{ omit: source, why }`. The map also carries `repository: 'https://github.com/lbdremy/phax'`, the only phax-specific value besides the domain and the Worker name. `checkPageMap(map, sources)` returns every finding, not only the first, in this wording: `✗ README.md: section "## <name>" is not in the page map`; `✗ page map: names README section "## <name>", which README.md no longer has`; `✗ <path>: source file is not in the page map`; `✗ page map: names <path>, which does not exist`. It also refuses a section or file assigned twice, a duplicate route, a route whose first segment is a version (`/v1…`, `/0.17…`) and a `holdUntil` that is not X.Y.Z. A section is named by its heading's plain text (mdast-util-to-string), e.g. `CLI specification (phax.usage.kdl)`. The text before the first `##` is named `(intro)`.
- Also in `pageMap.ts`, `siteNavigation(map, version)` returns the nav and sidebar. The top nav holds Guide, Reference, Security and Compare; Blog only when a `/blog/` route is rendered; `v<version>` linking to `https://github.com/lbdremy/phax/releases/tag/v<version>`; and a GitHub social link. Held entries appear nowhere. A version switcher never appears.
- Write `site/pages.ts`, the default export through `definePageMap`. README routes, with titles left to you: `/` ← (intro), Quickstart. `/guide/install` ← Install, Runtime permission posture, Shell completions. `/guide/configure` ← Configure, Configuration layers, Schema upgrade. `/guide/write-a-plan` ← Write a plan, Lint the plan. `/guide/run` ← Run, Resume, Locks. `/guide/review-and-publish` ← Review loop, Compliance review & publishing. `/guide/multiple-plans` ← Coordinating multiple plans. `/guide/manage-runs` ← List runs, Archive and prune. `/guide/model-routing` ← Multi-provider model routing. `/guide/security-modes` ← Security modes, Security notes. `/guide/troubleshooting` ← Debugging, Observability, Troubleshooting. `/reference/formats` ← Persisted formats, Read phax files from code. `/reference/exit-codes` ← Exit codes, Environment variables. `/contributing/testing` ← Testing, State Machine, CLI specification (phax.usage.kdl). Omit `CLI command reference` with why `generated summary; /reference/cli is the full reference`. Files: `/reference/cli` ← docs/cli/reference.md, `/reference/model-catalog` ← docs/model-catalog.md, `/security` ← docs/security.md, `/contributing/release` ← docs/release.md, `/compare/openspec-vs-phax` and `/compare/spec-kit-vs-phax` ← docs/comparisons/*.md, `/blog/announcing-phax-1-0` ← docs/blog/announcing-phax-1.0.md with `holdUntil: '1.0.0'`.
- Write `site/build/sources.ts`. The source set is README.md, docs/cli/reference.md, docs/security.md, docs/release.md, docs/model-catalog.md, docs/blog/*.md and docs/comparisons/*.md, sorted. `splitReadme(text)` returns the intro and each `##` section with its heading plain text and its start offset and line in README.md, so that error lines refer to the real file. A `##` inside a fenced code block is not a heading. Parse with mdast, never with a regex.
- Write `site/build/markdown.ts`, the GitHub-faithful transform. Parse with mdast-util-from-markdown plus the GFM micromark/mdast extensions, then edit the source text at node offsets; never re-serialise the tree. It drops HTML comments (flow and inline). It backslash-escapes `<`, `>`, `{` and `}` in text nodes, skipping characters the source already escapes. A non-comment HTML node whose tag name is a standard HTML element fails, naming the file and line, because raw HTML is not supported; every other HTML node (placeholders such as `<short-name>`, `<branch>`) is emitted as escaped literal text. Angle autolinks `<https://…>` become `[https://…](https://…)`. Code, inline code and fenced code are untouched. Every heading gets an explicit id equal to its GitHub slug, using one `github-slugger` per source in document order and Rspress's custom-id syntax. The function returns the edited text plus each source's heading-id list, for the post-build check and for phase-02.
- Write `site/build/generate.ts`. Its pure core, `generateSite({ files, pageMap, version })`, maps page paths to content and returns findings and summary counts. Its I/O wrapper removes and rewrites `site/generated/`: `docs/index.md` for `/`, `docs/<route>.md` for every other route, and `site.json` holding version, release URL, nav, sidebar, routes and heading ids per route. A README page is its sections in map order, under frontmatter with the map title; any page heading you add must not collide with a section id. A file page is the transformed file. Held entries are skipped when `compareReleases(version, holdUntil) < 0` (from `src/schemas/schemaUrl.ts`). The version is the root package.json version. Output is deterministic: sorted, `\n` line endings, no timestamps.
- Write `site/rspress.config.ts`. Root is `site/generated/docs` and outDir is `site/doc_build`, both resolved from `import.meta.dirname`. Set title `phax` and logoText `phax`. Nav and sidebar come from `site/generated/site.json`; when it is missing, throw `run pnpm site:build`. Use Rspress's built-in local search, with no lastUpdated, no edit links, no analytics and no remote resource.
- Write `site/build/postbuild.ts`, pure checks over the built files plus `site.json`. Every rendered route has its HTML page. Every page shows `v<version>` linking to the release URL. Every heading id the generator emitted for a route appears as an `id` attribute on that page. No HTML, CSS or JS file loads anything from an absolute http(s) URL: script src, link rel=stylesheet|preload|modulepreload|icon|manifest href, img/source src and srcset, CSS url() and @import, and JS `import('http…')`. Outbound `<a href>` links are allowed. Findings are `✗ …` lines.
- Write `site/build/site.ts`, a tsx entry with modes `build|dev|preview`. `build` runs generate, then Rspress (the exported Node function if there is one, else the installed CLI spawned with `process.execPath`), then postbuild. It prints every finding and exits 1 on any. On success it prints `site: v0.17.0 — 20 pages from 7 sources (README: 31 sections, 1 omitted, 0 held)` and, last, `site: built site/doc_build`. `dev` runs generate, then Rspress dev. `preview` serves `site/doc_build`. Everything runs offline.
- package.json: add `site:build`, `site:dev` and `site:preview` scripts, each `tsx site/build/site.ts <mode>`. Do not add them to `check:full`, `test` or any other script.
- Keep generated output out of the repo and out of the tools. `.gitignore` gets `site/generated/` and `site/doc_build/`. Both go into `.oxlintrc.json` ignorePatterns and `.oxfmtrc.json` ignorePatterns. knip gets entries `site/rspress.config.ts`, `site/pages.ts` and `site/build/*.ts`, project `site/**/*.ts`, and ignores the generated directories. `tsconfig.test.json` includes `site/**/*` and excludes `site/generated` and `site/doc_build`.
- Run `pnpm exec tsx site/build/site.ts build` on the real tree. It must exit 0 with no network. Running it twice must leave `git status --porcelain` showing only this phase's intended changes.

### Planned files to create

- `site/pages.ts`
- `site/rspress.config.ts`
- `site/build/site.ts`
- `site/build/pageMap.ts`
- `site/build/sources.ts`
- `site/build/markdown.ts`
- `site/build/generate.ts`
- `site/build/postbuild.ts`
- `tests/unit/site/pageMap.test.ts`
- `tests/unit/site/markdown.test.ts`
- `tests/unit/site/generate.test.ts`
- `tests/unit/site/postbuild.test.ts`

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`
- `.gitignore`
- `knip.json`
- `.oxlintrc.json`
- `.oxfmtrc.json`
- `tsconfig.test.json`

### Optional files that may be edited

- `pnpm-workspace.yaml`

### Boundary contracts

Page map → generator: `site/pages.ts` is the only place the site's structure lives. The generator needs every README section and every source assigned exactly once, and the stable shape is the `definePageMap` types in `site/build/pageMap.ts`. Generator → Rspress config: the config needs the nav, sidebar and version without computing them, so the generator writes them to `site/generated/site.json`, which the config reads. Generator → post-build: the checks need the routes and the emitted heading ids per route, which come from `site.json`. Phase-02 extends both the transform and `site.json` with links; phase-03 adds schema files to the public folder.

### Test strategy

Write first: `pageMap.test.ts` on made-up README and file sets. It covers the three §8 'unmapped or vanished' variants: an added `## Contributing`; a map naming `## Locks` after the heading was renamed; and an added docs/blog/second-post.md. It also covers duplicates, version-prefixed routes, and the navigation with and without a rendered blog route at versions 0.17.0 and 1.0.0. Write first as well: `markdown.test.ts`. A fixture section with `<short-name>` and `{#phase-01-setup}` outside code plus an HTML comment yields escaped literals and no comment text. Code spans and fences are unchanged, autolinks are rewritten, a `<details>` fails naming its line, and GitHub slugs, including duplicate suffixes, are assigned. `generate.test.ts`: one page per mapped route holding exactly the mapped sections' text; the omitted section appears on no page; the held post is absent at 0.17.0 and present at 1.0.0; two runs give byte-identical output; `.gitignore` lists both generated directories; no committed file under `site/` (excluding the generated directories) contains a paragraph of 60+ characters from any real source. `postbuild.test.ts` runs on made-up HTML/CSS/JS strings: a missing route, a page without the release label, a missing heading id, and each remote-load form fail, while an outbound `<a href>` passes. No test runs Rspress or checks the real README against the map.

### Implementation order

1. pnpm add, then read the installed @rspress/core and note the facts
2. site/build/pageMap.ts and its tests
3. site/build/sources.ts
4. site/build/markdown.ts and its tests
5. site/pages.ts
6. site/build/generate.ts and its tests
7. site/rspress.config.ts
8. site/build/postbuild.ts and its tests
9. site/build/site.ts and the package.json scripts
10. ignore files, knip, tsconfig.test.json
11. a real build with pnpm exec tsx site/build/site.ts build

### Excluded scope

- Link rewriting and the broken-link check (phase-02); until then, links are emitted as written.
- Schema files, the ledger and `_headers` (phase-03).
- Theme tokens, fonts, logo and favicon (phase-04).
- CI and the phax.json gate step (phase-05).
- Any wrangler config or deploy (phase-06).
- Editing README.md or any other source.

### Verification

The `standard` gate profile in `phax.json`. Before committing, `pnpm exec tsx site/build/site.ts build` must exit 0 on the real tree with no network, and the tree must stay clean apart from this phase's changes.

### Expected handoff content

The installed @rspress/core version and the facts read from it: config field names, MD vs MDX compilation, the custom heading-id syntax, the public folder location, the Node API or CLI used, the dark-mode storage key and class, the callout classes and variables, and the theme variable names. The exported names and signatures in `site/build/pageMap.ts`, `markdown.ts`, `generate.ts` and `postbuild.ts`, and the layout of `site/generated/` and `site.json`. The summary lines printed for the real tree. Any dependency added besides the four named, with the reason. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(site): Rspress skeleton rendering the repository's docs through one page map`

### Commit body

Add the docs site under site/: an Rspress v2 config, the page map site/pages.ts, and a generator that splits README.md by its ## headings and renders each mapped source as GitHub-flavoured Markdown, with placeholders and braces kept literally, HTML comments dropped and GitHub heading ids. A README section or source file missing from the map, or a map entry naming something that no longer exists, fails the build by name. Holds keep a source off the site until its release. The navigation shows the release the site was built from. Post-build checks prove every route is built, every page carries the release label and nothing loads from another origin. pnpm site:build, site:dev and site:preview run it. The generated sources and the output are gitignored.

---

## phase-02 — Link rewriting and the broken-link check {#phase-02-links}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every link in a rendered source works on the site. A link to rendered content goes to its route and anchor, and a link to an unrendered file goes to GitHub at the release tag. A broken file or anchor fails `pnpm site:build`, naming the source file, the line and the link.

### Detailed instructions

- Write `site/build/links.ts`. Collect `link`, `linkReference`/`definition` and `image` nodes from each rendered source, using the original source line in messages, as phase-01's README split preserves it. Classify each target. A URL with a scheme (`https:`, `mailto:`, …) is left unchanged. A bare `#anchor` resolves against the same source. A relative path, with or without `#anchor`, resolves against the source's directory; a leading `/` means the repository root. Normalise the path, and fail if it leaves the repository.
- A relative path that names no file or directory in the repository fails: `✗ <source>:<line>: <link> — no such file`. A rendered source becomes `<route>#<anchor>`. A README anchor goes to the route of the page holding that heading's section, and a link from the README to itself becomes a route link when the section lives on another page. The anchor must be in the target source's GitHub heading-id list from phase-01, else `✗ <source>:<line>: <link> — no such anchor on <route>`. An anchor inside an omitted README section, or any link to an omitted section, goes to `https://github.com/lbdremy/phax/blob/v<version>/README.md#<anchor>`.
- A target held in this build (`compareReleases(version, holdUntil) < 0`) is replaced by the link's text, so the page does not link to it. Count it in the summary.
- Any other existing repository file goes to `https://github.com/lbdremy/phax/blob/v<version>/<path>[#anchor]`, and a directory to `…/tree/v<version>/<path>`. Anchors into unrendered files are not checked: GitHub renders those pages.
- A relative image fails with `✗ <source>:<line>: <link> — relative images are not served`, because §5.9 forbids loading it from GitHub. The real sources have none today.
- Apply the rewrites through the same offset-edit mechanism as phase-01's transform, so that unrelated bytes stay unchanged and the output stays deterministic.
- The generator writes `site/generated/links.json`: for each rewritten site link, its source, line, original link, route and anchor. `postbuild.ts` checks that every such anchor is an `id` on the target route's built HTML, else `✗ <source>:<line>: <link> — no such anchor on <route>`. Turn Rspress's own dead-link check off if it would duplicate or contradict this one.
- Print `site: links — rewritten to routes and to github.com/lbdremy/phax/blob/v<version>, <n> broken` after the pages line. Report every broken link, not only the first.
- Run `pnpm exec tsx site/build/site.ts build` on the real tree. Expected results: `docs/cli/reference.md#phax-orient` → `/reference/cli#phax-orient`; `docs/security.md#shell-command-execution` → `/security#shell-command-execution`; `#security-modes` → `/guide/security-modes#security-modes`; `./spec-kit-vs-phax.md` → `/compare/spec-kit-vs-phax`; `docs/model-routing.md` and `../ideas/desktop-app.md` → GitHub at v0.17.0. If a real source holds a link that is also broken on GitHub, fix it in the source only when the fix is unambiguous, and record it as a deviation. Never edit a source for the site's sake.

### Planned files to create

- `site/build/links.ts`
- `tests/unit/site/links.test.ts`

### Planned files to edit

- `site/build/generate.ts`
- `site/build/postbuild.ts`
- `tests/unit/site/postbuild.test.ts`

### Optional files that may be edited

- `site/build/markdown.ts`
- `site/build/site.ts`
- `README.md`

### Boundary contracts

Phase-01's transform → links: the link step needs each source's GitHub heading ids and the route holding each README section. It reads them from the transform's heading lists and the page map, not from Rspress. Generator → post-build: the anchor re-check needs the rewritten links with their origin, which come from `site/generated/links.json`.

### Test strategy

Write first: `links.test.ts` on made-up sources in an in-memory repository (path → content), with no filesystem. It covers each §8 link case: README → `/reference/cli#phax-orient`, `/security#shell-command-execution`, an in-page `#security-modes` that moves to another route, and a comparison's `./spec-kit-vs-phax.md` → `/compare/spec-kit-vs-phax`. It also covers unrendered `docs/model-routing.md` and `../ideas/desktop-app.md` → GitHub blob at v0.17.0; a directory → tree; `docs/missing.md` → no such file; `docs/cli/reference.md#phax-no-such-command` → no such anchor, each naming the file, line and link; a link to the held post as plain text at 0.17.0 and as a route at 1.0.0; an omitted-section link → GitHub README; a relative image → failure; and `https:`/`mailto:` links left unchanged. Extend `postbuild.test.ts` with an anchor present and an anchor missing in made-up HTML.

### Implementation order

1. link classification and resolution in site/build/links.ts, with its tests
2. rewrite application through the offset edits
3. links.json written by generate.ts
4. post-build anchor re-check and its tests
5. summary line, then a real build

### Excluded scope

- Schema URLs and their list on /reference/formats (phase-03).
- Checking anchors inside files the site does not render.
- Rewriting links in sources for the site's sake.

### Verification

The `standard` gate profile in `phax.json`. Before committing, `pnpm exec tsx site/build/site.ts build` must exit 0 on the real tree and print the links line with 0 broken.

### Expected handoff content

The signature of `site/build/links.ts` and how `generate.ts` composes it with the phase-01 transform. The format of `site/generated/links.json`. Whether Rspress's dead-link check is on or off, and why. The real tree's links line. Any source link fixed, with the reason it was broken on GitHub too. Any deviation from the planned file lists.

### Commit subject

`feat(site): rewrite source links to site routes and GitHub at the tag, fail on broken ones`

### Commit body

Links between rendered sources now point at the route and anchor where the content is served. Links to repository files the site does not render point at github.com/lbdremy/phax at the release tag, and links to a held source become plain text before its release. A relative link to a missing file, or an anchor its target lacks, fails the build naming the source file, line and link. A post-build check re-verifies every rewritten anchor against the built HTML.

---

## phase-03 — Served schemas and the release ledger {#phase-03-schemas-ledger}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every `$schema` URL a released phax writes resolves to its exact JSON Schema, for every release forever. The site build learns the releases from a committed ledger that the release cut appends to, so a release that changed no shape still serves every format.

### Detailed instructions

- Create `packages/schemas/releases.json` as `{ "releases": ["0.17.0"] }`, written in the form `JSON.stringify(value, null, 2) + '\n'`. Add it to `.oxfmtrc.json` ignorePatterns, so that the cut's output is the committed form.
- `scripts/release-cut.ts`: before writing anything, read and validate the ledger. It must exist and hold a non-empty, strictly increasing list of X.Y.Z releases whose last entry equals the current root version; otherwise throw `nothing cut`, like the existing checks. After the manifests and snapshot renames, append the new version, write the file in the same form, and add `packages/schemas/releases.json` to the changed paths. Update the header comment. `pnpm exec tsx scripts/release-cut.ts 0.18.0 --root <copy>` prints the ledger path among its changed paths.
- `scripts/release.sh`: after the `renaming snapshots/*/next.schema.json` echo, add `echo "appending ${VERSION} to the release ledger"`. The cut does the append, and its printed paths are already staged by `git add -A -- "${CUT_PATHS[@]}"`. Keep the script's last three lines unchanged.
- `tests/unit/releaseCut.test.ts`: copy the ledger into the temporary tree (COPIED_FILES), add it to CUT_SCOPE, and add tests. A cut appends X and reports the path. A missing ledger, an out-of-order ledger, or a ledger whose last entry differs from package.json refuses before any write.
- Write `site/build/schemas.ts`, reusing `FORMAT_IDS`, `isRelease`, `compareReleases` and `SCHEMA_URL_BASE` from `src/schemas/schemaUrl.ts`, and `SNAPSHOTS_DIR`/`parseSnapshotName` from `packages/schemas/build/snapshots.ts`. `checkLedger(ledger, packageVersion, snapshotNames)` returns findings: the last entry differs from package.json (`✗ release ledger: last entry 0.17.0, package.json version 0.18.0`); a release-named snapshot's release is absent (`✗ packages/schemas/snapshots/registry/0.18.0.schema.json: release 0.18.0 is not in the release ledger`); entries are not strictly increasing; the first entry is not the first supported release.
- Also in `schemas.ts`, `servedSchemas(ledger, snapshots)` (format id → snapshot name → bytes) returns `/schemas/<id>/<R>.json` → bytes for each ledger release R and each format with a release-named snapshot at or before R, using the latest such snapshot. pre-schema and next are never served. It also returns the index `{ releases, paths }` (sorted, 2-space JSON plus newline) and the `_headers` text: `/schemas/*` with `Content-Type: application/json`, `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=3600`.
- The generator reads the ledger, the root version and every snapshot as raw bytes, never re-serialised. It runs `checkLedger` and fails on any finding. It writes the served files, `schemas/index.json` and `_headers` into the Rspress public folder found in phase-01, so that they land at `site/doc_build/schemas/…` and `site/doc_build/_headers`. It prints `site: schemas — <n> served (ledger: <releases> × <formats> formats), ledger agrees with package.json`.
- Page map: add an optional `generated: 'served-schemas'` to the `/reference/formats` README entry. The generator appends a section `## Served JSON Schemas` there, listing every served URL as `https://docs.phax.run/schemas/<id>/<release>.json`, with a heading id that collides with no README id. Every page except that one stays unchanged.
- `postbuild.ts`: every served path exists in `site/doc_build` byte-identical to its snapshot, and `_headers` and `schemas/index.json` are at the output root. No file under `doc_build/schemas/` names pre-schema or next.
- Run `pnpm exec tsx site/build/site.ts build` on the real tree. It must serve exactly 15 files, `/schemas/<id>/0.17.0.json`.

### Planned files to create

- `packages/schemas/releases.json`
- `site/build/schemas.ts`
- `tests/unit/site/schemas.test.ts`

### Planned files to edit

- `scripts/release-cut.ts`
- `scripts/release.sh`
- `tests/unit/releaseCut.test.ts`
- `site/build/generate.ts`
- `site/build/postbuild.ts`
- `site/build/pageMap.ts`
- `site/pages.ts`
- `.oxfmtrc.json`

### Optional files that may be edited

- `tests/unit/site/postbuild.test.ts`
- `tests/unit/releaseWorkflow.test.ts`
- `site/build/site.ts`

### Boundary contracts

Release cut → ledger → site build. The site needs the full list of releases, which the cut provides by appending in the release commit. The stable shape is `{ releases: string[] }` at `packages/schemas/releases.json`, append-only, with its first entry the first supported release and its last entry the root version. Site build → deploy guard (phase-06): the guard needs every path a build serves, which the build provides as `/schemas/index.json` with the shape `{ releases: string[], paths: string[] }`, both sorted.

### Test strategy

Write first: `tests/unit/site/schemas.test.ts`. On the real ledger and snapshots: exactly 15 served files, one `/schemas/<id>/0.17.0.json` per format id, each byte-identical to `packages/schemas/snapshots/<id>/0.17.0.schema.json`, with no path naming pre-schema or next. On a made-up ledger `[0.17.0, 0.18.0]` where only registry has a 0.18.0 snapshot and run-status has a next snapshot: registry/0.18.0 equals the registry 0.18.0 snapshot, run-status/0.18.0 equals the run-status 0.17.0 snapshot, all fifteen 0.17.0 URLs are still served (30 files), and no next is served. The two §8 ledger-mismatch variants each fail, naming the mismatch. `_headers` sets the content type and the CORS header for `/schemas/*`, and the index lists exactly the served paths. Write first as well: the release-cut tests above. Running Rspress is not part of any test.

### Implementation order

1. packages/schemas/releases.json and the oxfmt exclusion
2. release-cut append with its tests, then the release.sh echo
3. site/build/schemas.ts with its tests
4. generator wiring, the formats-page list, the post-build byte check
5. a real build

### Excluded scope

- The deploy guard that reads the live index (phase-06).
- Adding `$id` or anything else to served schemas.
- Any change to snapshots, `CURRENT_SHAPES` or a persisted format.

### Verification

The `standard` gate profile in `phax.json`. Before committing, `pnpm exec tsx site/build/site.ts build` must exit 0 on the real tree and report 15 served schemas.

### Expected handoff content

The ledger path and form, and the exported functions of `site/build/schemas.ts` with their signatures, particularly the index shape and its parser if one is exported, for phase-06's guard. Where the schema files and `_headers` are written and how the post-build proves them. The real tree's schemas line. Any deviation from the planned file lists.

### Commit subject

`feat(site): serve every release's JSON Schema at its $schema URL from a release ledger`

### Commit body

Add the release ledger packages/schemas/releases.json, seeded with 0.17.0. The release cut appends each release to it in the release commit. For every ledger release and every format, the site build serves the format's latest release-named snapshot at or before that release at /schemas/<format id>/<release>.json, byte for byte. It never serves a pre-schema or next snapshot. It also writes the schema index /schemas/index.json and the _headers that answer schemas as application/json with Access-Control-Allow-Origin *. The build fails when the ledger disagrees with package.json or with the snapshots. /reference/formats lists every served URL.

---

## phase-04 — The phax identity: tokens, dark first, fonts and logo {#phase-04-identity}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The site looks like phax. It renders dark by default, uses a warm palette whose contrast ratios a test enforces, keeps gold for accents only and never for warnings, self-hosts its fonts, and shows the geometric phax logo, the lowercase wordmark and a matching favicon.

### Detailed instructions

- Install first: `pnpm add -D @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono`. This is the only registry access in this phase. If knip reports them unused, because they are referenced only from generated CSS, add them to `ignoreDependencies` in `knip.json`.
- Write `site/theme/tokens.ts` with `THEMES.dark` and `THEMES.light`, each holding bg, bgSoft, text1, text2, link, brand and warning, using the §6 values as the starting point: dark `#15130E`, `#1E1B14`, `#EDE6D6`, `#A89F8A`, `#C2A160`, `#B39257`, `#D96A4F`; light `#F7F3EA`, `#EFE9DC`, `#1E1A12`, `#5C5546`, `#5E4720` (bronze), `#9A7A3E`, `#A33B22`. Declare each token's role (background, running text, secondary, link, gold accent, warning) and export the gold accent tokens and the bronze token by name. Adjust a value only if the contrast test fails it, keeping its hue.
- Also in `tokens.ts`, `themeCss()` renders the theme CSS. It imports the fontsource latin files for Plex Sans 400 and 600 and Plex Mono 400 (check the exact file names in the installed packages). It sets the font-family variables. It maps the tokens onto Rspress v2's `--rp-c-*` variables in the light and dark selectors phase-01 recorded. It points the warning, caution and danger callout colours at the warning token, never at a gold one. Light links use the bronze token, and gold appears only on rules, focus rings, the logo and highlights.
- Write `site/theme/contrast.ts` with WCAG 2 relative luminance, contrast ratio and hue (degrees) for `#RRGGBB`.
- Write `site/theme/appearance.ts` for dark first. Use the installed Rspress's own option for a dark default if phase-01 found one. Otherwise export an inline script string, injected through the config's `head` before Rspress's appearance logic, that applies dark when no preference is stored under Rspress's storage key. A stored `light` stays light. The script is inline, so it loads nothing from another origin.
- Draw `site/public/logo.svg` and `site/public/logo-light.svg` from the §6 geometry: viewBox 0 0 32 32, `fill="none"`, a root `stroke-width="3"` and `stroke-linecap="butt"`, and two paths, stem + top arm + upper bowl, then lower bowl + middle arm, leaving a gap of at least 1/8 of the glyph height on the bowl's right side. Use stroke `#B39257` in logo.svg and `#9A7A3E` in logo-light.svg, with no gradient, no fill and no per-path stroke override. The two files are identical except for the colour.
- `site/rspress.config.ts`: logo `{ dark: '/logo.svg', light: '/logo-light.svg' }` (or the form the installed Rspress takes), logoText `phax`, icon `/logo.svg`, globalStyles pointing at the generated `site/generated/theme.css`, and the appearance script or option. The generator writes `theme.css` from `themeCss()` and copies `site/public/**` into the Rspress public folder, alongside phase-03's schema files.
- `postbuild.ts`: every page has a `<link rel="icon">` whose href is `/logo.svg`, `/logo.svg` and `/logo-light.svg` exist in the output byte-identical to `site/public`, and the nav shows the wordmark `phax` in lowercase. The no-remote-asset check from phase-01 must still pass with the fonts bundled.
- Run `pnpm exec tsx site/build/site.ts build` on the real tree. It must exit 0 offline.

### Planned files to create

- `site/theme/tokens.ts`
- `site/theme/contrast.ts`
- `site/theme/appearance.ts`
- `site/public/logo.svg`
- `site/public/logo-light.svg`
- `tests/unit/site/theme.test.ts`
- `tests/unit/site/logo.test.ts`

### Planned files to edit

- `site/rspress.config.ts`
- `site/build/generate.ts`
- `site/build/postbuild.ts`
- `tests/unit/site/postbuild.test.ts`
- `package.json`
- `pnpm-lock.yaml`

### Optional files that may be edited

- `knip.json`
- `tests/unit/site/generate.test.ts`
- `site/build/pageMap.ts`

### Boundary contracts

Tokens → CSS → Rspress. Rspress's theme consumes CSS variables. `site/theme/tokens.ts` is the single source of the values, and both the generated CSS and the contrast test read it, so a value cannot pass the test while shipping something else. The variable and selector names come from the installed Rspress, as recorded in phase-01's handoff.

### Test strategy

Write first: `theme.test.ts`. In both themes, every running-text and link token reaches at least 7:1, secondary text at least 4.5:1 and every gold accent at least 3:1 against each background token of the same theme. In the light theme, the link equals the bronze token and no running-text or link token is a gold token. The warning colour used by the warning, caution and danger callouts is no gold token, and its hue differs from every gold token's hue by at least 20°. `themeCss()` sets the link and brand variables to those tokens and loads no http(s) URL. The appearance script, run against fake storage, matchMedia and document objects, gives dark with no stored preference while the system prefers light, and light when light is stored. Write first as well: `logo.test.ts` on the committed SVGs. Every stroke has one width with no per-path override; the linecap is butt; each file uses exactly one colour, equal to its theme's brand token; there is no gradient element and no fill; both files have identical path data; the clear gap between the upper bowl's end and the lower bowl's start is at least 1/8 of the drawn glyph height. Extend `postbuild.test.ts` with the favicon link and the wordmark on made-up HTML.

### Implementation order

1. pnpm add for the fonts
2. site/theme/contrast.ts
3. site/theme/tokens.ts with theme.test.ts
4. site/theme/appearance.ts and its test
5. the two logo SVGs with logo.test.ts
6. config, generator and post-build wiring
7. a real build

### Excluded scope

- A PNG favicon (SVG only).
- Screenshot or visual-regression tests.
- A theme package shared with another app.
- Any other layout change to Rspress's default theme.

### Verification

The `standard` gate profile in `phax.json`. Before committing, `pnpm exec tsx site/build/site.ts build` must exit 0 on the real tree, with no remote asset found.

### Expected handoff content

The final token values with their computed ratios, and any value changed from §6 with the reason. The Rspress variable and selector names used. How dark first is achieved (an Rspress option or the inline script) and the storage key. The font files imported. The logo geometry and the measured gap-to-height ratio. Any knip ignore added. Any deviation from the planned file lists.

### Commit subject

`feat(site): dark-first phax identity with tested contrast, self-hosted fonts and a geometric logo`

### Commit body

Give the site its identity. The dark and light tokens live in site/theme/tokens.ts, with an old-gold accent, bronze links in light and terracotta warnings. A test computes WCAG ratios and keeps running text and links at 7:1 or more, secondary text at 4.5:1 or more and gold accents at 3:1 or more. Dark renders when no preference is stored. IBM Plex is self-hosted from @fontsource. A first geometric P/F logo is the nav mark beside the lowercase wordmark phax and serves as the favicon, and its one-weight, single-colour, split-bowl constraints are tested.

---

## phase-05 — CI builds the site; the terminal gate step {#phase-05-ci-gate}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

A change that breaks the site is caught on every push and pull request, and in a phax run at its final phase gate, inside the fix loop, without slowing the every-phase gates or `pnpm check:full`.

### Detailed instructions

- `.github/workflows/ci.yml`, job `ci`: add a step `- name: Docs site` with `run: pnpm site:build`, immediately after the `Build` step (`pnpm build`) and before `Architecture audit`. Add no wrangler step, no CLOUDFLARE secret and no upload of any kind.
- `phax.json`: in `gateProfiles.standard`, add `{ "command": "pnpm site:build", "surface": "product", "firing": "terminal" }` right after the `pnpm build` terminal step. Add no every-phase step, and do not touch `security.agentCommands`.
- Leave `package.json` unchanged: `check:full` and `test` must not run the site build.
- Extend `tests/unit/releaseWorkflow.test.ts` in the CI section. ci.yml runs `pnpm site:build` exactly once, after the `pnpm build` step. ci.yml's text contains neither `wrangler` nor `CLOUDFLARE`.
- Run `pnpm exec tsx site/build/site.ts build` once more on the real tree, to confirm that the command the gate will run passes.

### Planned files to create

- `tests/unit/site/gate.test.ts`

### Planned files to edit

- `.github/workflows/ci.yml`
- `phax.json`
- `tests/unit/releaseWorkflow.test.ts`

### Optional files that may be edited

- (none)

### Test strategy

Write first: `tests/unit/site/gate.test.ts`, which parses the real `phax.json` and `package.json`. The standard profile has exactly one step whose command is `pnpm site:build`, with firing `terminal` and surface `product`. No `every-phase` step mentions `site:`. Neither the `check:full` nor the `test` script mentions `site:build`. Together with the CI assertions in `releaseWorkflow.test.ts`, this pins the §8 criteria 'A heading rename fails the run's completion gate' and 'CI builds, never deploys' (the CI half).

### Implementation order

1. gate.test.ts and the CI assertions
2. phax.json terminal step
3. ci.yml step
4. a real build

### Excluded scope

- release.yml and any deploy (phase-06).
- Adding the site build to `check:full`, `test` or an every-phase gate step.
- Changing `security.agentCommands`.

### Verification

The `standard` gate profile in `phax.json`. Before committing, `pnpm exec tsx site/build/site.ts build` must exit 0 on the real tree.

### Expected handoff content

The exact phax.json step added and its position, the ci.yml step name, and the names of the new test cases. Any deviation from the planned file lists.

### Commit subject

`ci: build the docs site in CI and as phax's terminal gate step`

### Commit body

CI runs pnpm site:build after pnpm build on every push to main and every pull request, with no deploy step and no Cloudflare secret. phax.json's standard gate profile gains pnpm site:build as a terminal product step, so a README heading rename or a broken link fails a run's final phase gate inside its fix loop. Every-phase gates and pnpm check:full stay as fast as before.

---

## phase-06 — Release deploy: guard, preview, check, promote; manual redeploy {#phase-06-deploy}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Each release tag publishes its site to docs.phax.run and to a preview URL named for the release. The deploy runs after every fallible check and before any npm package is staged. It can never remove a served schema URL, and the author can redeploy a released tag by hand through the same guarded steps.

### Detailed instructions

- Install first: `pnpm add -D wrangler`. This is the only registry access in this phase. Read the installed wrangler, not memory, for: `versions upload` flags (`--preview-alias`, `--tag`, `--message`, `--config`); `versions deploy <id>@100%` with its non-interactive flag; whether routes and custom domains are applied by versions deploy; whether a never-deployed Worker can receive `versions upload`; and the ND-JSON entries written to `WRANGLER_OUTPUT_FILE_PATH` by an upload (the version id and preview alias URL field names). Only if pnpm 10 blocks a build script the upload needs, allow it in `pnpm-workspace.yaml`. If knip reports wrangler unused, add it to `ignoreDependencies`.
- `site/wrangler.jsonc` follows §6: `$schema` is `../node_modules/wrangler/config-schema.json`, name `phax-docs`, compatibility_date `2026-09-25`, no `main`, assets `{ directory: './doc_build', not_found_handling: '404-page' }`, `preview_urls: true`. Leave out `routes`: the custom domain is attached by hand (see the arbitrations). It is the only phax-specific deploy config besides the domain.
- `site/build/deploy-guard.ts` exports a pure `guardServedSchemas(live, builtPaths)` and an I/O `runGuard({ fetch, indexUrl, buildDir })`. The default index URL is `https://docs.phax.run/schemas/index.json`, and the default build dir is `site/doc_build`. A 404 passes as a first deploy. A 200 whose body is a valid `{ releases, paths }` passes only if every listed path exists under the build dir, else it refuses, naming the first missing path: `✗ deploy guard: this build does not serve /schemas/registry/0.18.0.json, which docs.phax.run serves`. Any other status, a network error or a malformed body refuses. The CLI exits 1 on refusal. It reads no credential and uploads nothing. Reuse phase-03's index parsing if it exists.
- `site/build/preview-check.ts` exports pure helpers: `previewAlias('v0.18.0') === 'v0-18-0'`, and `readUpload(ndjson)` returning `{ versionId, previewUrl }`, which fails if either is absent. It also exports `checkPreview({ fetch, sleep, previewUrl, release })`. That function requires `<previewUrl>/schemas/registry/<release>.json` to answer 200 with a content type starting `application/json` and `Access-Control-Allow-Origin: *`, and `<previewUrl>/` to answer 200 with a body containing `v<release>`. It retries a bounded number of times with an injected sleep, then fails naming what it saw. The CLI reads `--upload-output <file>` and `--tag <vX.Y.Z>`, runs the check, and on success appends `version-id=<id>` to `$GITHUB_OUTPUT`. It reads no credential.
- `.github/workflows/release.yml`: add `pnpm site:build` to the `Gate` run block after `pnpm build`. Set job-level env `RELEASE_TAG: ${{ github.ref_name }}` and `WRANGLER_OUTPUT_FILE_PATH: ${{ runner.temp }}/wrangler-output.ndjson`. Between `Verify package versions match tag` and the first `npm stage publish`, insert exactly four steps: `Deploy docs: guard` (`pnpm exec tsx site/build/deploy-guard.ts`); `Deploy docs: upload` (`pnpm exec wrangler versions upload --config site/wrangler.jsonc --preview-alias "${RELEASE_TAG//./-}" --tag "$RELEASE_TAG"`, with env `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` and `CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`); `Deploy docs: check preview` (id `preview`, `pnpm exec tsx site/build/preview-check.ts --upload-output "$WRANGLER_OUTPUT_FILE_PATH" --tag "$RELEASE_TAG"`); and `Deploy docs: promote` (`pnpm exec wrangler versions deploy "${{ steps.preview.outputs.version-id }}@100%" --config site/wrangler.jsonc` plus the non-interactive flag, with the same two secrets in env). No deploy step sets `continue-on-error` or `if`. Keep everything after the first publish unchanged: only the second publish and the GitHub Release follow it.
- Create `.github/workflows/docs-deploy.yml`: `on: workflow_dispatch` with a required input `tag`, and `permissions: contents: read`. One job sets env `RELEASE_TAG: ${{ inputs.tag }}` (never interpolated into `run`) and the same `WRANGLER_OUTPUT_FILE_PATH`. Its steps: checkout with `ref: ${{ inputs.tag }}`; pnpm and setup-node 24 pinned to the SHAs release.yml uses; `pnpm install`; a step refusing a tag that is not `vX.Y.Z` or does not equal `v` + package.json's version; `pnpm site:build`; then the four `Deploy docs:` steps identical to release.yml's. No `npm stage publish`, no `action-gh-release`, no NPM token.
- Extend `tests/unit/releaseWorkflow.test.ts` and keep every existing assertion: (1) the Gate runs `pnpm site:build`. (2) The four deploy steps appear in the order guard, upload, check, promote, all after the version check and before the first publish, and the existing 'runs every step that can fail before the first publish' list includes them. (3) Upload uses `--preview-alias` with the alias expression, and `bash -c` evaluating that expression for `v0.18.0` prints `v0-18-0` (local, offline). (4) Promote comes after check and uses its output. (5) No deploy step sets continue-on-error or if. (6) In release.yml only the upload and promote steps mention CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID, with no workflow- or job-level CLOUDFLARE env. (7) docs-deploy.yml checks out `inputs.tag`, runs `pnpm site:build` before its deploy steps, has deploy steps deep-equal to release.yml's, and contains no npm publish and no GitHub Release step. The GITHUB_TOKEN-only npm rule stays unchanged.
- Nothing in this phase runs wrangler against Cloudflare, fetches docs.phax.run or reads a credential. The scripts are exercised only through injected fakes.

### Planned files to create

- `site/wrangler.jsonc`
- `site/build/deploy-guard.ts`
- `site/build/preview-check.ts`
- `.github/workflows/docs-deploy.yml`
- `tests/unit/site/deployGuard.test.ts`
- `tests/unit/site/previewCheck.test.ts`

### Planned files to edit

- `.github/workflows/release.yml`
- `tests/unit/releaseWorkflow.test.ts`
- `package.json`
- `pnpm-lock.yaml`
- `knip.json`

### Optional files that may be edited

- `.oxfmtrc.json`
- `pnpm-workspace.yaml`
- `site/build/schemas.ts`

### Boundary contracts

Workflow → guard: the workflow needs a yes/no before any upload. `deploy-guard.ts` provides it as its exit status, with the live index at `https://docs.phax.run/schemas/index.json` (phase-03's `{ releases, paths }`) and `site/doc_build` as inputs. Workflow → wrangler → check: the check needs the uploaded version id and preview URL, which wrangler provides in its ND-JSON output file. `preview-check.ts` returns them to the promote step as the step output `version-id`. The secrets cross only into the wrangler upload and promote steps.

### Test strategy

Write first: `deployGuard.test.ts` with made-up live indexes and an in-memory build listing. A live index listing `/schemas/registry/0.18.0.json` against a 0.17.0 build refuses, naming that path. A 404 passes. A 500, a thrown fetch and a malformed body each refuse. A superset build passes. Write first as well: `previewCheck.test.ts`: `previewAlias`; `readUpload` on made-up ND-JSON lines shaped like the installed wrangler's entries, plus a missing-entry failure; and `checkPreview` with a fake fetch and sleep, where a 200 JSON schema with CORS and a page showing the version pass, while a 404, an HTML content type, a missing CORS header or a page with another version fail after the bounded retries. Then extend the workflow tests listed in the instructions. No test touches the network.

### Implementation order

1. pnpm add wrangler and read its upload, deploy and output-file behaviour
2. site/build/deploy-guard.ts with its tests
3. site/build/preview-check.ts with its tests
4. site/wrangler.jsonc
5. release.yml deploy steps and Gate change
6. docs-deploy.yml
7. workflow tests

### Excluded scope

- Running any deploy, upload or Cloudflare API call, from a phase or from a repository script.
- Deploying from CI or pull requests, and pull-request preview sites.
- docs/release.md (phase-07).
- Changes to the binaries, the npm packages or the GitHub Release beyond the deploy's position.

### Verification

The `standard` gate profile in `phax.json`. Before committing, `pnpm exec tsx site/build/site.ts build` must exit 0, and the guard must pass offline against a 404 fake in the tests.

### Expected handoff content

The installed wrangler version and what was confirmed from it: the upload and deploy flags, whether versions deploy applies routes, whether a never-deployed Worker accepts versions upload, and the output-file entry fields. Exactly what phase-07 must document as one-time hand steps for the first deploy to see a 404 at `/schemas/index.json`. The final deploy step names and commands, the docs-deploy.yml inputs, and any pnpm-workspace or knip change. Any deviation from the planned file lists.

### Commit subject

`feat(release): deploy docs.phax.run between the version check and the first npm stage publish`

### Commit body

The release workflow builds the site in its Gate. After every gate, build, smoke and version check, it deploys docs.phax.run in four steps: a guard that refuses any build dropping a schema URL listed in the live index, an upload to a per-release preview alias such as v0-18-0, a check of that preview URL, and promotion. Only then does it stage the npm packages. A failed deploy stages nothing, creates no release and leaves the promoted site serving. docs-deploy.yml lets the author redeploy a released tag by hand with the same four steps and no npm publish. Only the upload and promote steps see the Cloudflare credential.

---

## phase-07 — Release docs: the docs site's one-time setup and redeploy {#phase-07-release-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

A maintainer can set up docs.phax.run once by hand, follow the release as it deploys the site, verify the result, and redeploy a released tag by hand, all from `docs/release.md`.

### Detailed instructions

- Under `## Prerequisites`, after the trusted-publisher subsection, add `### The docs site (one-time, by hand — never automated)`. Say that none of these steps is automated, then list: (1) a Cloudflare account holding the phax.run zone, with its DNS on Cloudflare; (2) an API token from the 'Edit Cloudflare Workers' template, limited to that account and zone, stored as the GitHub secret `CLOUDFLARE_API_TOKEN`, and the account id as `CLOUDFLARE_ACCOUNT_ID`; (3) the `phax-docs` Worker and the custom domain docs.phax.run on it, which creates its DNS record and certificate, done in the order phase-06's handoff gives so that `https://docs.phax.run/schemas/index.json` answers 404 before the first release; (4) the workers.dev subdomain and preview URLs enabled on the Worker.
- In `## Release process`, step 2: mention that the cut appends the release to `packages/schemas/releases.json`. Step 3: the workflow builds the site in its Gate and, after the version check and before the npm stage publishes, deploys docs.phax.run. Describe the four steps: guard against the live schema index, upload with alias `vX-Y-Z`, check the preview URL, promote. State the failure semantics: a failed guard, upload or check stages nothing, creates no GitHub Release and leaves the previous site serving, at most leaving an unpromoted version with its preview URL. The remedy is unchanged: fix, then delete and re-push the tag.
- In step 5 `Verify`, add: docs.phax.run shows vX.Y.Z; `https://docs.phax.run/schemas/registry/X.Y.Z.json` answers 200; the previous release's preview URL still shows its own version. Also suggest a look at the release's preview URL before approving the npm packages (q-visual).
- Add `## Redeploying the docs site by hand`: `gh workflow run docs-deploy.yml -f tag=vX.Y.Z` checks out the tag, builds, and runs the same guard, preview upload, check and promotion. It stages nothing on npm, creates no GitHub Release, and is refused by the guard if it would drop a served schema URL. Mention `pnpm site:preview` for a local look.
- Keep every existing section and its wording, except where it now has to mention the site. `docs/release.md` is itself rendered at `/contributing/release`, so every link you add must pass the site build's link check.
- Run `pnpm exec tsx site/build/site.ts build` on the real tree. It must exit 0.

### Planned files to create

- `tests/unit/site/releaseDocs.test.ts`

### Planned files to edit

- `docs/release.md`

### Optional files that may be edited

- (none)

### Test strategy

Write first: `tests/unit/site/releaseDocs.test.ts`, which reads the real `docs/release.md`. A one-time docs-site section exists under Prerequisites, says its steps are done by hand and never automated, and names the phax.run zone, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, the docs.phax.run custom domain and preview URLs. The release process mentions the docs deploy before the npm stage publish. Verify mentions `schemas/registry/` and the previous preview URL. A `Redeploying the docs site by hand` section names `docs-deploy.yml`. Assert on headings and key tokens, not on whole sentences.

### Implementation order

1. releaseDocs.test.ts
2. the one-time section
3. release-process and Verify edits
4. the redeploy section
5. a real build

### Excluded scope

- Editing README.md or any other source.
- Any workflow, script or configuration change.
- Automating any of the one-time steps.

### Verification

The `standard` gate profile in `phax.json`. Before committing, `pnpm exec tsx site/build/site.ts build` must exit 0 on the real tree, including the link check on `docs/release.md`.

### Expected handoff content

The new and changed headings of `docs/release.md`, the one-time steps as written including the first-deploy 404 precondition, and confirmation that the real site build passes. Any deviation from the planned file lists.

### Commit subject

`docs(release): document the docs site's one-time setup, deploy step and manual redeploy`

### Commit body

docs/release.md now lists the docs site's one-time setup, done by hand and never automated: the Cloudflare account with the phax.run zone, the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID GitHub secrets, the phax-docs Worker with the docs.phax.run custom domain, and preview URLs. It adds the deploy step to the release process and the site checks to Verify, and explains how to redeploy a released tag by hand with docs-deploy.yml.
