---
status: Approved
source-spec: docs/specs/2611220953-positioning.md
completes-spec: true
approved:
  date: 2026-11-22
  baseline: a17beb5
---
# Positioning

phax names what it is, verified delegation, in every place that says so, with one pitch per reader: the person pitch in the README, both package.json descriptions, the home page's tagline and the site's description; the one-sentence agent pitch in `phax --help` and the usage spec's about line, the phax-cli skill's "What phax is" section, the llms.txt introduction and a new "Delegating from an agent" page at /guide/delegating. The home page shows four moments (author, run, review, keep) instead of nine facets of the run. Three checks run in `pnpm check:full`: every claim names a docs route the site builds or a command the phax command tree has, every place carries its reader's pitch word for word, and no place names phax with a rejected name.

The work goes core to surface. phase-01 writes the single store of the pitches, the agent detail, the home's four features and every claim with its proof, plus the three checks as pure functions, tested by feeding them a drifted place, an unshipped proof and a rejected name. phase-02 moves the person places onto the store and starts the repository test that runs the checks against the real files. phase-03 does the agent places in the CLI (program summary, usage spec, docs/cli/reference.md, root-help fixture) and the phax-cli skill. phase-04 adds the agent page, the llms.txt renderer that opens llms.txt with the agent pitch, and a post-build check of the built llms.txt. When phase-04 finishes, the repository test runs every check against every place and expects no finding.

The operator's verdicts are settled and not reopened: q-agent-page `page`, q-llms-intro `split`, the one-sentence agent pitch with its detail under it (never in `phax --help` or llms.txt), and everything §10 of the spec settles. phase-03 writes `.claude/skills/phax-cli/SKILL.md`, so this plan must be run with `phax run --allow-skill-edits` (see the open question q-skill-edits).

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm site:build`

Every command above is already an entry of `security.agentCommands` (`pnpm gen:usage-spec`, `pnpm docs:cli`, `pnpm test:unit`, `pnpm test:integration`) or a command of the `standard` gate profile (`pnpm site:build`, a terminal step). No change to `phax.json` is needed.

## Technical arbitrations

- Where the pitches live: `site/build/positioning.ts` is the one store. It holds the person pitch, the agent pitch, the agent detail, the home's four features, every claim with its proof, the rejected names, the place readers and the checks. The places the site build generates read from it: the home tagline and features in `site/pages.ts`, and the llms.txt introduction through the renderer. Every other place is compared with it word for word: README.md, package.json, npm/package.json, the summary literal in `src/cli/definitions/program.ts` with its generated usage spec and help fixture, the phax-cli skill, the two comparison pages and docs/delegating.md. Loss accepted: the agent pitch is written twice, in the store and in program.ts, and only the drift check keeps the two equal, not an import. The binary cannot import `site/`. A `src/domain` store holding text that only tests and the site read would fail `knip --production --strict` against the protected baseline.
- How llms.txt gets the agent pitch (q-llms-intro `split`): `site/build/llms.ts` implements Rspress 2.1.2's `llms.llmsTxt` renderer option (`LlmsTxtRenderer`, exported by `@rspress/core`). It reproduces Rspress's default llms.txt layout with the agent pitch as the blockquote. The config's `description` stays the person pitch, so the meta description and the link previews are unchanged. Loss accepted: the build depends on an option Rspress marks experimental and copies Rspress's default layout, so a Rspress upgrade can break either one. A post-build check of the built `site/doc_build/llms.txt` fails `pnpm site:build` when that happens. Rejected: a step after the build that rewrites `doc_build/llms.txt`, which would have the same fragility plus an edit of a generated file.
- Where each check runs: the claims check, the drift check and the rejected-names check are pure functions in `site/build/positioning.ts`. They run in `pnpm test:unit`, which is inside `check:full`, against the sources the build reads: README.md, both package.json files, `site/pages.ts`, the program's summary, phax.usage.kdl, the skill, the docs pages and the llms renderer's output. A proof's routes are the page map's routes that every build renders (no `holdUntil`). Its commands are the command and group paths of the program's tree. The built llms.txt is also checked in `pnpm site:build`. Loss accepted: `check:full` checks the renderer, not the built file, so a Rspress change shows up only at the terminal site:build gate and in CI.
- The agent detail has one shape in both places: the same five-item bullet list, item for item, directly after the pitch paragraph, on the agent page and in the phax-cli skill's "What phax is" section. One check then covers both. Loss accepted: the skill's §6 draft, which was a single paragraph, becomes a list.
- A rejected name counts wherever it appears in a place's text: whole words, case-insensitive. Places are short sentences about phax, so any occurrence names phax. Loss accepted: a place cannot use one of those words in another sense ("test harness").

## Arbitrated questions

### q-skill-edits — phase-03 must rewrite `.claude/skills/phax-cli/SKILL.md` (spec §5.3–§5.5), and a phase may write a `.claude/skills` file only when the run is started with `phax run --allow-skill-edits`. Does the phase agent write the skill file, or does the operator edit it by hand?

- agent-writes — Declare the skill file in phase-03 and run the plan with `phax run --allow-skill-edits` — abandons: The skill file stays out of the agent's reach. The phase-03 session could rewrite any instruction in the phax-cli skill, which every agent that installs phax loads as guidance, for example telling those agents to run a command or skip a check. Only that one declared file opens: sibling skill files and the rest of `.claude/` stay denied, and the final review shows the diff.
- operator-edits — Leave the skill file out of every phase; the operator edits it by hand and the skill's part of the repository test lands with that edit — abandons: A plan that delivers the spec on its own. The skill's places (agent pitch, agent detail, description) are edited and checked outside the run, so ac-agent, ac-agent-detail and ac-skill-trigger are proven only once the operator makes the edit, and the plan has to be revised to move those checks.

Recommendation: agent-writes — The spec requires the edit, the grant covers one declared file, and the final phase stays open so the operator reviews the skill diff before anything is published. Leaving the edit to the operator moves three acceptance criteria outside the run.

Decision: agent-writes — by operator (Rémy Loubradou), 2026-11-22
Why: The spec requires the edit, the grant covers one declared file, and the final phase stays open so the operator reviews the skill diff before anything is published. Leaving the edit to the operator moves three acceptance criteria outside the run. Advocate: Editing the skill by hand keeps the one file every installing agent loads as guidance out of a headless session's reach: no phase can rewrite an instruction in it, and the operator's own edit is the only change that ever lands there. Principles: E0, C2. Reversibility: cheap. Revised: none. Phase: phase-03.

## Decision log

- 2026-11-22 q-skill-edits decided agent-writes — operator (Rémy Loubradou)

---

## phase-01 — Positioning store and its three checks {#phase-01-positioning-store}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** This phase designs the store and the three checks, which no code in the repository shows yet; their shape is reused by the three phases that follow. The operator's brief assigns claude-opus-5-5 at medium to it.

Add the single store of what phax says about itself (both pitches, the agent detail, the home's four features, every claim with its proof, the rejected names) and the three pure checks over it: claims whose proof is not shipped, places that drift from their pitch, and places that name phax with a rejected word. Each check reports `✗ …` findings that name the place, the claim, the proof or the word.

### Detailed instructions

- Create `site/build/positioning.ts`, a pure module: no `node:fs`, no `process`, no import of `site/pages.ts` or of anything under `src/cli/`. It may import from `./markdown.js` (parseMarkdown, plainText), `./generate.js` (readmeDescription) and types from `./pageMap.js` (HomeFeature, PageMap). Write a header comment saying it is the one store of phax's positioning and that `site/pages.ts` and `site/build/llms.ts` read from it while every other place is compared with it.
- Export `PERSON_PITCH` exactly: "phax is verified delegation for AI coding agents: hand work to Claude Code, OpenAI Codex or Mistral Vibe and get back facts, not claims. Every phase passed your checks, every file is accounted for, every finding has a fate, and the history stays in Git."
- Export `AGENT_PITCH` exactly: "phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify."
- Export `AGENT_DETAIL`, the five items in this order, exactly: "Each phase runs in an isolated Git worktree." / "Its gate commands must exit 0 before the next phase starts." / "The files it touched are reconciled with the plan." / "Run state outlives your context: phax resume picks up where the run stopped." / "Every command answers JSON with a schema."
- Export `HOME_FEATURES: ReadonlyArray<HomeFeature>`, four entries in the order author, run, review, keep. key "author", title "Author", details "Specs and plans with a status and an approval, drafted headless from a brief, open questions decided with <code>phax artifact decide</code>, plans linted, estimated and checked for overlap.", link "/guide/specs-and-plans". key "run", title "Run", details "Each phase in its own worktree with the agent you pick; nothing moves until your gates pass; every file planned vs. done.", link "/guide/run". key "review", title "Review", details "A compliance verdict against the plan, a headless code review whose findings each get a fate, and a pull request that explains itself.", link "/guide/review-and-land". key "keep", title "Keep", details "Each phase's record on <code>phax/records/v1</code> and a cost ledger per run.", link "/guide/records".
- Export a `Claim` type `{ of, text, proof }`. `of` names what the claim backs: "person pitch", "agent pitch", "agent detail" or "home feature <key>". `proof` is `{ kind: "route", route }` or `{ kind: "command", command }`, where `command` is a string starting with `phax ` (e.g. "phax finding list"). Export `CLAIMS`. Person pitch: "hand work to Claude Code, OpenAI Codex or Mistral Vibe" → /guide/providers-and-security; "every phase passed your checks" → /guide/run; "every file is accounted for" → /guide/concepts; "every finding has a fate" → /guide/findings; "the history stays in Git" → /guide/records. Agent pitch: "results you can verify" → /guide/delegating. Agent detail: item 1 → phax run, item 2 → /guide/set-up, item 3 → phax review-handoff, item 4 → phax resume, item 5 → /reference/json-output (the claim text is the item text). Home features: author "Specs and plans with a status and an approval" → /guide/specs-and-plans, "open questions decided with phax artifact decide" → phax artifact decide, "plans linted" → phax plans lint, "estimated" → phax plans estimate, "checked for overlap" → phax plans overlap; run "Each phase in its own worktree" → phax run, "nothing moves until your gates pass" → /guide/run, "every file planned vs. done" → /guide/concepts; review "A compliance verdict against the plan" → phax review-compliance, "a headless code review whose findings each get a fate" → /guide/findings, "a pull request that explains itself" → phax publish-pr; keep "Each phase's record on phax/records/v1" → /guide/records, "a cost ledger per run" → phax cost.
- Export `REJECTED_NAMES`: "harness", "orchestrator", "orchestration engine", "control plane", "software factory". Match whole words, case-insensitively; "orchestrator" also matches "orchestrators".
- Export a `Place` type `{ label, reader, text }`. `label` is what a finding names, a file path or a surface such as "README.md", "package.json", "npm/package.json", "site/pages.ts home tagline", "site description", "phax --help", "phax.usage.kdl about", ".claude/skills/phax-cli/SKILL.md", "llms.txt", "docs/delegating.md", "docs/comparisons/spec-kit-vs-phax.md", "/compare/spec-kit-vs-phax description". `reader` is "person", "agent" or "name" (a place that carries the name but no pitch).
- Export pure readers that turn a source text into what a place says. `readmeOpening(readme)` is `readmeDescription`, the same function the site uses for its description. `packageDescription(jsonText)` is the `description` field. `usageAbout(kdlText)` is the string of the top-level `about "…"` line, unescaped. `sectionOpening(markdown, heading)` returns `{ paragraph, list }`: the plain text of the first paragraph under the named heading (or under the `#` title when heading is the title) and the plain-text items of the list node directly after that paragraph, or an empty list when the next node is not a list. Use it for the phax-cli skill's "What phax is", the agent page and the comparison pages' "The one-line difference" (their paragraph only). `skillDescription(skillText)` is the frontmatter `description`. `llmsIntroduction(llmsText)` is the text of the first `> ` line after the `# ` title. Normalise whitespace the way readmeDescription does (runs of whitespace become one space, trimmed), so a wrapped Markdown paragraph reads as one line.
- Export the checks. Each returns `ReadonlyArray<string>` of `✗ …` findings, empty when sound. `checkPitches(places)`: a person place whose text is not exactly PERSON_PITCH gives `✗ <label>: does not carry the person pitch word for word`, and an agent place likewise with the agent pitch. `checkName(places)`: a place whose text lacks "verified delegation" gives `✗ <label>: does not name verified delegation`. `checkRejectedNames(places)`: each rejected name found gives `✗ <label>: names phax "<word as written in the text>"`. `checkAgentDetail(label, items)`: items not equal to AGENT_DETAIL, item for item and in order, give `✗ <label>: the agent detail under the pitch differs from the store`. `checkClaims(claims, { routes, commands }, texts)`: a route proof not in `routes` gives `✗ claim "<text>" (<of>): proof <route> is not a route the site builds`; a command proof not in `commands` gives `✗ claim "<text>" (<of>): proof <command> is not a command phax has`; a claim whose text is not found case-insensitively in the text it backs (`texts` maps each `of` to its text: the pitch, the joined detail items, or the feature's title plus details with tags stripped) gives `✗ claim "<text>" (<of>): not said by its <of>`.
- Export `builtRoutes(pageMap)`: the routes of every README page and file page in the map without `holdUntil`, the same set `checkPageMap` treats as rendered by every build. Export `commandPaths(tree)`: given a structural `{ name: string, commands: ReadonlyArray<node> }` program, where a node is a command `{ name }` or a group `{ name, commands }`, return the set of `phax <word> …` paths of every command and every group. Type it structurally so the module never imports `src/cli`.
- Create `tests/unit/site/positioning.test.ts` holding only fixture-fed tests (no real repository file is read in this phase): the failure criteria, a table over the rejected names, the readers on small Markdown/JSON/KDL fixtures, and the store's own consistency (every person-pitch claim and every home-feature claim text is said by what it backs, every home feature and every agent-detail item has at least one claim, the four features are in order with the four links).
- Do not change any place yet (README, package.json, site/pages.ts, the CLI, the skill). Those are phase-02 to phase-04.

### Planned files to create

- `site/build/positioning.ts`
- `tests/unit/site/positioning.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `site/build/markdown.ts`

### Boundary contracts

Producer: `site/build/positioning.ts`. Consumers: `site/pages.ts` (PERSON_PITCH, HOME_FEATURES, from phase-02), `site/build/llms.ts` (AGENT_PITCH, from phase-04), and the repository test `tests/unit/site/positioningRepository.test.ts` (readers and checks, from phase-02). The stable shape: string constants for the pitches, a list of detail items, `HomeFeature` entries, `Claim { of, text, proof }`, `Place { label, reader, text }`, and checks that return `✗ …` finding lines naming what failed. The module stays pure, and consumers do the reading of files.

### Test strategy

- a person place edited away from the person pitch is reported, naming README.md as the place that drifted — small · example · the finding line naming README.md · in-phase · ac-drift
- a claim added to the agent detail with proof phax inbox, or a claim with proof /guide/inbox, is reported naming the claim and the missing command or route — small · example · the finding lines naming the claim text and phax inbox or /guide/inbox · in-phase · ac-unshipped-claim
- a place calling phax an orchestration engine or a harness is reported naming the place and the word, for every rejected name in any letter case — small · table · one finding per rejected name naming the place label and the word · in-phase · ac-rejected
- a place without the words verified delegation is reported, and a place with them is not — small · boundary · finding present or absent · in-phase · ac-name
- claims whose proofs are in the given routes and commands give no finding; a group path such as phax cost counts as a command — small · example · empty findings for a fixture tree and page map · in-phase · ac-proofs-resolve
- the readers return the opening paragraph and the list after it from a wrapped Markdown section, the about line from KDL, the description from JSON and the blockquote from an llms.txt — small · example · expected strings on hand-written fixtures · in-phase
- the store is consistent: every claim is said by what it backs, every feature and detail item has a claim, and the four features are author, run, review, keep with their four links — small · example · the store's own constants · in-phase · ac-features

### Implementation order

1. The constants (pitches, detail, features, claims, rejected names)
2. The readers
3. The checks and builtRoutes/commandPaths
4. The fixture-fed tests

### Excluded scope

- Editing any place (README, package.json files, site/pages.ts, the CLI summary, the skill, the comparison pages)
- The repository test that runs the checks against the real files (phase-02 onward)
- The llms.txt renderer and the agent page (phase-04)

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact export names and signatures of `site/build/positioning.ts` (constants, `Claim`, `Place`, every reader, every check, `builtRoutes`, `commandPaths`) and the exact finding formats, because phase-02 to phase-04 call them. Any claim you added or changed from the list in the instructions, and why. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(site): add the positioning store and its claim, drift and name checks`

### Commit body

Add site/build/positioning.ts, the one store of what phax says about itself: the person pitch, the one-sentence agent pitch, the agent detail, the home page's four moments, every claim with the docs route or phax command that proves it, and the rejected names.

Three pure checks run over it: a claim whose proof the site does not build or the command tree does not have, a place that does not carry its reader's pitch word for word, and a place that names phax with a rejected word. Fixture-fed tests cover the failure criteria; the places move onto the store in the next phases.

---

## phase-02 — Person places and the home page's four moments {#phase-02-person-places}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The operator's brief assigns claude-opus-5-5 at medium to every phase of this plan except the mechanical one. This phase sets the repository test that phase-03 and phase-04 extend and must keep six files word for word with the store.

The README's opening paragraph, both package.json descriptions, the home page's tagline and the site's description carry the person pitch word for word. The home page shows four features (author, run, review, keep) and keeps its "The golden path, just facts." text. The two comparison pages name phax as verified delegation. A repository test runs the checks against these real files inside `check:full`.

### Detailed instructions

- README.md: replace the opening paragraph (line 7, the first paragraph after the badges) with PERSON_PITCH as plain text, with no bold or links, so that `readmeDescription` returns exactly the pitch. Leave the rest of the README unchanged.
- package.json and npm/package.json: set `description` to PERSON_PITCH exactly. Change no other field.
- site/pages.ts: import `PERSON_PITCH` and `HOME_FEATURES` from `./build/positioning.js`. Set the home's `tagline` to PERSON_PITCH and `features` to HOME_FEATURES. Keep `text: "The golden path, just facts."`, the actions, install and video unchanged.
- docs/comparisons/spec-kit-vs-phax.md, the paragraph under "## The one-line difference": replace "phax is an orchestration engine that runs your AI agent _inside isolated, mechanically gated phases_." so it reads "phax is verified delegation: it runs your AI agent _inside isolated, mechanically gated phases_ and hands back facts, not claims." (still inside the bold). Leave the title, axes and last-checked note untouched.
- docs/comparisons/openspec-vs-phax.md, the same paragraph: replace "phax is a standalone orchestration engine that runs your AI agent _as a subprocess_ through isolated, mechanically gated phases" with wording that names phax "verified delegation" and keeps the subprocess and gated-phases contrast, e.g. "phax is verified delegation: it runs your AI agent _as a subprocess_ through isolated, mechanically gated phases and hands back facts, not claims". No rejected name may remain anywhere in that paragraph.
- site/pages.ts comparison descriptions: rewrite the `/compare/spec-kit-vs-phax` description without "harness" and the `/compare/openspec-vs-phax` description, each naming "verified delegation" and keeping its side-by-side framing, each 50 to 160 characters (`checkPageMap` enforces this). For example: "Spec Kit vs. phax, side by side: a methodology and prompt layer that runs your agent step by step, against verified delegation in gated, reviewable phases."
- Create `tests/unit/site/positioningRepository.test.ts`. It reads the repository's real files with `node:fs` from the repository root, resolved from `import.meta.url` (never `~/.phax`, a provider home or the git config), and runs the phase-01 checks. This phase's places are: README.md (readmeOpening), package.json, npm/package.json, the home tagline (from `site/pages.ts`' default export), the site description (`readmeDescription` of README.md, labelled "site description"), the two comparison pages' one-line-difference paragraphs and their two page descriptions (reader "name"). Expect `checkPitches`, `checkName` and `checkRejectedNames` to report no finding over them.
- In the same test, assert the home: `text` is "The golden path, just facts.", the features' keys are [author, run, review, keep] with links [/guide/specs-and-plans, /guide/run, /guide/review-and-land, /guide/records], and `OG_IMAGE_ALT` from `site/build/og.ts` is "phax — the golden path, just facts". Run `checkClaims` on the person-pitch and home-feature claims against `builtRoutes(pageMap)` and `commandPaths(phaxProgram)` (import `phaxProgram` from `src/cli/definitions/program.js`) and expect no finding.
- Structure the repository test so phase-03 and phase-04 add their places to it: for example one `describe` per reader, or a list of places the next phases extend.
- If a home feature's details render badly with `<code>`, adjust the wording in `site/build/positioning.ts` (and its claims) and say so in the handoff. Never change the text on the page without changing the store.

### Planned files to create

- `tests/unit/site/positioningRepository.test.ts`

### Planned files to edit

- `README.md`
- `package.json`
- `npm/package.json`
- `site/pages.ts`
- `docs/comparisons/spec-kit-vs-phax.md`
- `docs/comparisons/openspec-vs-phax.md`

### Optional files that may be edited

- `site/build/positioning.ts`
- `tests/unit/site/positioning.test.ts`

### Boundary contracts

Consumer `site/pages.ts` reads PERSON_PITCH and HOME_FEATURES from producer `site/build/positioning.ts`; the site build (`generateSite`) still reads the home from the page map and the site description from README.md through `readmeDescription`, unchanged. The repository test consumes the phase-01 readers and checks, and the program's command tree through `phaxProgram`, read only for its command and group names.

### Test strategy

- README.md's first non-badge paragraph, the home tagline, both package.json descriptions and the site description are the person pitch word for word — small · example · PERSON_PITCH from the store, checkPitches returns no finding · in-phase · ac-person
- every person place and both comparison pages' one-line differences and descriptions name verified delegation and no rejected name — small · example · checkName and checkRejectedNames return no finding · in-phase · ac-name
- the home keeps its text and the open-graph alt text — small · example · the two literal strings of spec §5.6 · in-phase · ac-tagline
- the home shows exactly four features, author, run, review, keep, linking to their four guide routes — small · example · the expected keys and links of spec §5.7 · in-phase · ac-features
- every person-pitch and home-feature claim names a route every build renders or a command the program has — small · example · checkClaims over the real page map and command tree returns no finding · in-phase · ac-proofs-resolve

### Implementation order

1. README.md and both package.json descriptions
2. site/pages.ts tagline and features from the store, comparison descriptions
3. The two comparison pages' one-line differences
4. The repository test

### Excluded scope

- The program summary, the usage spec, the help fixture and the phax-cli skill (phase-03)
- The agent page, the llms.txt renderer and the post-build check (phase-04)
- The comparison pages' titles, axes and last-checked notes, and any other README section
- The open-graph image, logo and tagline text

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The path `tests/unit/site/positioningRepository.test.ts` and how a later phase adds a place to it. The final wording of the two comparison one-line differences and descriptions. Any change made to the store's wording or claims and why. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs: carry the person pitch and the four moments in every person place`

### Commit body

The README's opening paragraph, both package.json descriptions, the home page's tagline and the site's description now say, word for word, that phax is verified delegation for AI coding agents and that you get back facts, not claims. The home page keeps "The golden path, just facts." and shows four features, author, run, review and keep, read from the positioning store. The Spec Kit and OpenSpec comparisons name phax as verified delegation instead of an orchestration engine or a harness.

A repository test runs the pitch, name and claim checks against these files in check:full.

---

## phase-03 — Agent pitch in phax --help and the phax-cli skill {#phase-03-agent-cli-skill}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium
**Assignment reason:** The operator's brief sets the mechanical phase (regenerated usage spec, CLI reference and help fixture, with text taken word for word from the store) on claude-sonnet-5.

`phax --help` opens with the one-sentence agent pitch, and so does the usage spec's about line. The phax-cli skill's "What phax is" section opens with the pitch followed by the agent detail, and its description names verified delegation and still says when to load it. The repository test checks these places.

### Detailed instructions

- src/cli/definitions/program.ts: set `summary` to the agent pitch literal, exactly "phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify." Keep it a literal in this file: the binary must never import `site/`. The repository test compares it with the store. Add no agent detail to the summary.
- tests/unit/cli/phaxProgram.test.ts: the summary assertion expects `AGENT_PITCH`, imported from `../../../site/build/positioning.js`.
- Run `pnpm gen:usage-spec` to regenerate `phax.usage.kdl` and `pnpm docs:cli` to regenerate `docs/cli/reference.md`. Never hand-edit either file.
- tests/fixtures/help/phax-root-help.txt is the stdout of `phax --help` and has no generator script. Replace its line 3 (the summary) with the agent pitch and change nothing else, then run `pnpm test:integration` so `tests/integration/rootHelp.test.ts` confirms the fixture equals the real help byte for byte. The existing fixture already has option lines longer than 80 columns, so the help does not wrap. If the summary does wrap, stop and report it in the handoff rather than changing the command library.
- .claude/skills/phax-cli/SKILL.md frontmatter `description`: "Verified delegation through the phax CLI — delegate a change to another coding agent and get results you can verify; its concepts, run lifecycle and the init → plan → run → review → publish flow. Use when driving phax, explaining it to a developer, or scripting against it. Defers to `phax --usage` for the exact command/flag contract."
- .claude/skills/phax-cli/SKILL.md "## What phax is" section: the first paragraph is the agent pitch alone. Directly after it comes a five-item bullet list whose items are the AGENT_DETAIL items word for word, in order. Then keep, as a following paragraph, the operational facts the old paragraph gave that the detail does not: the same-session fix loop on a gate failure, the final phase worktree staying open for review, and the branch pushed and PR opened only with `publish.auto` or `phax publish-pr`. Remove "A deterministic, local CLI that drives…". Use no rejected name. Change nothing else in the skill.
- Extend `tests/unit/site/positioningRepository.test.ts` with the agent places of this phase. `phaxProgram.summary`, labelled "phax --help", must be exactly AGENT_PITCH. Line 3 of `tests/fixtures/help/phax-root-help.txt`, labelled "phax --help", must be exactly AGENT_PITCH, the line under `Usage:` and its blank line, which the integration test pins to the real help. `usageAbout` of phax.usage.kdl must be exactly AGENT_PITCH. The skill's `sectionOpening(…, "What phax is")` paragraph must be exactly AGENT_PITCH, and `checkAgentDetail` on its list must report nothing. The skill description must contain "verified delegation" and a sentence starting "Use when", and `checkRejectedNames` on it must report nothing. Also run `checkClaims` on the agent-detail claims (phax run, /guide/set-up, phax review-handoff, phax resume, /reference/json-output) and expect no finding.
- Assert that the help carries none of the detail: the summary contains none of the AGENT_DETAIL items, and the fixture's paragraph under `Usage:` is the single pitch line followed by a blank line.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/definitions/program.ts`
- `tests/unit/cli/phaxProgram.test.ts`
- `tests/fixtures/help/phax-root-help.txt`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `.claude/skills/phax-cli/SKILL.md`
- `tests/unit/site/positioningRepository.test.ts`

### Optional files that may be edited

- `site/build/positioning.ts`

### Boundary contracts

The program summary (cli layer) feeds the runner's root help and the usage spec's `about`, both unchanged in mechanism. The skill file is installed verbatim by `phax skills install` from `.claude/skills/phax-cli/`, so the source file is what an installed skill reads. The repository test compares both with `site/build/positioning.ts` and never makes `src/` import `site/`.

### Test strategy

- the line under Usage: in phax --help, the usage spec's about line and the skill's What phax is opening are exactly the agent pitch — small · example · AGENT_PITCH from the store · in-phase · ac-agent
- phax --help prints the regenerated root help byte for byte — medium · smoke · tests/fixtures/help/phax-root-help.txt · in-phase · ac-agent
- the skill shows the five detail items right after the pitch, and the help's summary carries none of them — small · example · AGENT_DETAIL item for item, checkAgentDetail returns no finding · in-phase · ac-agent-detail
- the phax-cli skill's description names verified delegation and keeps its Use when sentence — small · example · substring presence in the frontmatter description · in-phase · ac-skill-trigger
- the help, the usage about line and the skill name verified delegation and no rejected name — small · example · checkName and checkRejectedNames return no finding · in-phase · ac-name
- every agent-detail claim names a route every build renders or a command the program has — small · example · checkClaims returns no finding · in-phase · ac-proofs-resolve

### Implementation order

1. The program summary and its unit test
2. Regenerate phax.usage.kdl and docs/cli/reference.md, update the help fixture's line 3
3. The phax-cli skill
4. Extend the repository test

### Excluded scope

- The descriptions of the other six installed skills
- Any change to the command library's help rendering or wrapping
- llms.txt, the agent page and the site (phase-04)
- Renaming any command

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Confirmation that the root help shows the pitch on one line, and the exact new skill section text. That phax.usage.kdl and docs/cli/reference.md were regenerated with `pnpm gen:usage-spec` and `pnpm docs:cli`, not edited by hand. The places added to the repository test. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(cli): open phax --help and the phax-cli skill with the agent pitch`

### Commit body

phax --help and the usage spec's about line now say, in one sentence, that phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify.

The phax-cli skill opens its "What phax is" section with the same sentence and lists right under it what an agent can verify: an isolated worktree per phase, gates that must exit 0, touched files reconciled with the plan, run state that outlives its context and JSON answers with a schema. Its description names verified delegation and keeps its "Use when" sentence. The usage spec and the CLI reference are regenerated, and the repository test checks every one of these places against the positioning store.

---

## phase-04 — The Delegating from an agent page and the agent pitch in llms.txt {#phase-04-agent-page-llms}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** This phase reaches a system the code does not use yet, Rspress's experimental llmsTxt renderer, and adds a post-build check that guards it. The operator's brief assigns claude-opus-5-5 at medium to it.

The docs site gains a "Delegating from an agent" page at /guide/delegating that opens with the agent pitch and the agent detail and shows the commands an agent calls, `--json`, `--json-schema`, the exit codes and `phax --usage`. llms.txt opens with the agent pitch and lists the page, while the meta description keeps the person pitch. The repository test then runs every check on every place, and `pnpm site:build` checks the built llms.txt.

### Detailed instructions

- Create `docs/delegating.md`. Title `# Delegating from an agent`. First paragraph: AGENT_PITCH alone, word for word. Directly after it: the five AGENT_DETAIL items as a bullet list, word for word. Then `## Delegate a change`, a fenced block with the commands an agent calls in order: draft a spec headless from a brief, draft its plan headless, lint the plan, run it, read the compliance verdict, list the findings, each with `--json`. Take each command's exact words and flags from `phax.usage.kdl`, correcting the indicative §6 lines (e.g. `phax run --plan <plan>`, `phax artifact new plan <slug> --headless --brief - --spec <spec> --last`) wherever the usage spec differs. Then `## Read the answers`: `--json` on every command, `--json-schema` for each command's contract (link `json-output.md`), the exit codes (link `../README.md#exit-codes`), and `phax --usage` for the full command tree. Include the §11 example as one short paragraph: an agent drafts, lints, runs, reads the outcome's kind and exit code, then the compliance verdict and each finding's fate with `phax finding list --json`, instead of trusting another agent's "done". Link to the reference pages; do not restate them. Use no rejected name, and claim nothing a brief still holds (no `phax do`, no inbox, no detach).
- site/pages.ts: add a file page `{ route: "/guide/delegating", title: "Delegating from an agent", source: "docs/delegating.md", description: "Delegate a change through phax from a coding agent: the commands to call, --json answers, --json-schema contracts, exit codes and phax --usage." }`, first among the guide file pages. The description must be 50–160 characters.
- Create `site/build/llms.ts` exporting `renderLlmsTxt: LlmsTxtRenderer` (type from `@rspress/core`). It reproduces Rspress 2.1.2's default llms.txt layout (read `generateLlmsTxt` in the installed `@rspress/core/dist/node/ssg-md/llms/llmsTxt.js`): `# <title>`, a blank line, `> <description>`, then for each section `\n## <section title>\n` followed by `- [<page title>](<link>)` with `: <description>` when the page has one. Use AGENT_PITCH from `./positioning.js` in place of the context's description. Keep it pure.
- site/rspress.config.ts: replace `llms: true` with `llms: { llmsTxt: renderLlmsTxt }`. Keep `description: site.description` (the person pitch, via README.md) for the meta description. Update the header comment to say llms.txt opens with the agent pitch.
- site/build/postbuild.ts: add a pure `checkLlmsTxt(text)` that returns `✗ site/doc_build/llms.txt: …` findings when the first `> ` line after the title is not exactly `> ` + AGENT_PITCH, or when no line links to a URL ending `/guide/delegating.md`. site/build/site.ts: in `build` mode, read `site/doc_build/llms.txt` (a missing file is a finding) and add `checkLlmsTxt` findings to the post-build findings.
- Create `tests/unit/site/llms.test.ts`: the renderer's output on a hand-built `LlmsTxtContext` (two sections, pages with and without descriptions) equals the expected string, which is Rspress's default layout with the agent pitch in the blockquote.
- tests/unit/site/postbuild.test.ts: add cases for `checkLlmsTxt`: a sound llms.txt, one opening with the person pitch, and one that does not list /guide/delegating.
- Extend `tests/unit/site/positioningRepository.test.ts` with the last places. `llmsIntroduction(renderLlmsTxt(context))` for a minimal context, labelled "llms.txt", is exactly AGENT_PITCH. docs/delegating.md's opening, labelled "docs/delegating.md", is exactly AGENT_PITCH, and `checkAgentDetail` on its list reports nothing. The page map has /guide/delegating with source docs/delegating.md. The page's text contains `--json`, `--json-schema`, `phax --usage` and a link to the exit codes. Rendering the page map's routes through the renderer lists /guide/delegating.
- Finish the repository test: build the complete list of places (person, agent and name places from phase-02, phase-03 and this phase) and run `checkPitches`, `checkName` and `checkRejectedNames` over all of them, plus `checkClaims` over every claim in `CLAIMS` against `builtRoutes(pageMap)` and `commandPaths(phaxProgram)`. Expect no finding at all.
- Run `pnpm site:build` to see the built llms.txt open with the agent pitch and list the page, and the home's meta description keep the person pitch. It is a terminal gate step, so the run judges it at the end too.

### Planned files to create

- `docs/delegating.md`
- `site/build/llms.ts`
- `tests/unit/site/llms.test.ts`

### Planned files to edit

- `site/pages.ts`
- `site/rspress.config.ts`
- `site/build/postbuild.ts`
- `site/build/site.ts`
- `tests/unit/site/postbuild.test.ts`
- `tests/unit/site/positioningRepository.test.ts`

### Optional files that may be edited

- `site/build/positioning.ts`
- `tests/unit/site/positioning.test.ts`

### Boundary contracts

Producer `site/build/llms.ts` meets Rspress's `llms.llmsTxt` option: Rspress passes an `LlmsTxtContext` (title, description, sections of pages with title, link and description) and the renderer returns the file's text. The contract is Rspress 2.1.2's experimental API, and `checkLlmsTxt` in the post-build guards it. The page map entry gives the generator the new route; the link rewriter turns `json-output.md` and `../README.md#exit-codes` into site routes and checks the anchors.

### Test strategy

- llms.txt's blockquote and the agent page's first paragraph are exactly the agent pitch, while the site's meta description stays the person pitch — small · example · AGENT_PITCH and PERSON_PITCH from the store · in-phase · ac-agent
- the renderer reproduces Rspress's default llms.txt layout with only the introduction replaced — small · example · expected text derived from Rspress 2.1.2's generateLlmsTxt · in-phase
- the agent page shows the five detail items right after the pitch — small · example · AGENT_DETAIL item for item, checkAgentDetail returns no finding · in-phase · ac-agent-detail
- llms.txt lists the agent page with a link, and the page shows --json, --json-schema, the exit codes and phax --usage — small · example · the renderer's output and the page's text · in-phase · ac-agent-page
- a built llms.txt that opens with another sentence or omits the agent page fails the site build, naming llms.txt — small · example · checkLlmsTxt finding lines · in-phase · ac-agent-page
- every place names verified delegation, carries its reader's pitch and no rejected name, and every claim of the store names a route every build renders or a command phax has — small · example · all checks over every place and claim return no finding · in-phase · ac-proofs-resolve
- the whole site builds with the new page, and its built llms.txt opens with the agent pitch — medium · smoke · pnpm site:build exits 0 with its post-build checks · in-phase · ac-name

### Implementation order

1. docs/delegating.md and its page map entry
2. site/build/llms.ts and its test
3. site/rspress.config.ts
4. checkLlmsTxt in postbuild.ts, wired in site.ts, with its tests
5. Complete the repository test over every place and claim

### Excluded scope

- Rewriting any other guide page, or the 1.0 announcement post
- Claims for features a brief still holds (phax do, the inbox, next steps as data, run detach)
- Changing the site description's source (README.md) or the open-graph card
- Any post-build rewrite of a file Rspress generates

### Verification

The `standard` gate profile in phax.json, including its terminal `pnpm site:build` step.

### Expected handoff content

The route, source and description of the agent page and the exact commands it shows, each checked against phax.usage.kdl. The renderer's path and how it is wired into the Rspress config. The post-build check's finding lines. Confirmation that the repository test now runs every check on every place and every claim with no finding. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(site): add the Delegating from an agent page and the agent pitch in llms.txt`

### Commit body

The docs site gains /guide/delegating, a page for a coding agent that delegates a change: it opens with the agent pitch and what the agent can verify, then shows the commands to call, --json, --json-schema, the exit codes and phax --usage.

llms.txt now opens with the agent pitch through Rspress's llmsTxt renderer, while the meta description keeps the person pitch. site:build checks the built llms.txt, and the repository test runs the claim, pitch and name checks over every place and every claim.
