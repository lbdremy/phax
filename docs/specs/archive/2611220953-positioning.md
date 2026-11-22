---
status: Completed
date: 2026-11-22
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-22
  baseline: 795bffb
---
# Positioning: verified delegation, one name and two pitches

## 1. Context

phax states what it is in about a dozen places, and each place speaks to one of two readers.

A person reads the docs home page, the README and the npm page. The home page shows "The golden path, just facts." with the sentence "phax runs your plan through AI coding agents one gated phase at a time, and hands you a change already checked against the plan." under it, then nine feature cards: gates, worktrees, planned vs. done, your agent, compliance, the pull request, records, determinism, and specs and plans with a status. The README's opening paragraph, and both package.json descriptions, read: "phax runs a plan through AI coding agents — Claude Code, OpenAI Codex or Mistral Vibe — as a sequence of gated phases, and hands you a change you can review." The docs build uses that paragraph as the site's description.

An agent reads `phax --help`, whose first line is "Drive AI coding agents through isolated, gated phases" (the same line is the usage spec's `about` and the CLI reference's first line). It also reads the descriptions of the skills phax installs, `phax-cli` first, and `llms.txt`. Rspress generates `llms.txt` from the site's title and description, so today its introduction is the README's opening paragraph. Two of the comparison pages call phax an "orchestration engine", and the Spec Kit page's description calls it "a harness".

phax already does more than run a plan. It authors specs and plans that have a status and an approval: headless drafts from a brief, `phax artifact decide` on open questions, and plan lint, estimate and overlap. It reviews: compliance, headless code review, findings with fates, and a pull request that explains itself. It keeps: records on `phax/records/v1` and cost ledgers. Every command answers `--json` and prints its contract with `--json-schema`.

Ground read:

- `docs/briefs/positioning.md` — The operator's direction of 2026-11-22: the name, the two draft pitches, only what ships, the tagline stays.
- `site/pages.ts` — Home page: text "The golden path, just facts.", a tagline about running a plan, nine features all about the run; every page's description, which feeds llms.txt; the Spec Kit page's description calls phax "a harness of gated, reviewable phases".
- `site/build/generate.ts` — The site's description is README.md's first non-badge paragraph (readmeDescription), used for the home page and the site-wide description.
- `site/rspress.config.ts` — llms: true; description: site.description. Rspress writes llms.txt as "# phax" then "> <site description>", then one line per page with its description.
- `site/build/og.ts` — OG_IMAGE_ALT = "phax — the golden path, just facts"; kept.
- `README.md` — Opening paragraph: "phax runs a plan through AI coding agents … as a sequence of gated phases, and hands you a change you can review." Then "How phax compares".
- `package.json` — description repeats the README's opening sentence; npm/package.json carries the same.
- `src/cli/definitions/program.ts` — Program summary "Drive AI coding agents through isolated, gated phases", shown by phax --help and written to the usage spec's about line and docs/cli/reference.md.
- `tests/fixtures/help/phax-root-help.txt` — Root help as it prints today; the summary is line 3.
- `.claude/skills/phax-cli/SKILL.md` — Installed skill; description "Operate the phax CLI — its concepts, run lifecycle …"; body section "What phax is": "A deterministic, local CLI that drives an AI coding agent …".
- `src/domain/skills/catalog.ts` — The seven skills phax installs: phax-planning, phax-cli, phax-spec, phax-review and the three decide skills.
- `docs/comparisons/spec-kit-vs-phax.md` — "The one-line difference" calls phax "an orchestration engine".
- `docs/comparisons/openspec-vs-phax.md` — "The one-line difference" calls phax "a standalone orchestration engine".
- `docs/json-output.md` — Every command takes --json; --json-schema prints each command's contract; refused and defect exit codes. Shipped facts the agent pitch can stand on.

## 2. Problem

Every place that says what phax is describes the run, which is a third of what phax does today. None of them gives the reason the parts belong together: phax turns an agent's "done" into facts. A gate exited green, the files were reconciled with the plan, each finding has a fate, and the history stays in Git. The tagline says this ("just facts"), but the sentence under it does not.

The agent reader gets no pitch at all. An agent is already phax's most frequent caller and never sees the home page. The question it has to answer is why it should delegate through phax instead of to its own subagents, whose "done" is only a claim. `phax --help` and `llms.txt` don't answer it. `llms.txt` opens with the person's paragraph.

The words also drift. The comparison pages call phax an orchestration engine and a harness. To a developer, "harness" means Claude Code itself, and "orchestrator" names a crowded category about running agents in parallel, where verification disappears. Nothing keeps a pitch from claiming a feature that hasn't shipped, or from drifting between the places that repeat it.

## 3. Product goal

phax names what it is, verified delegation, and says it to each reader where that reader looks. A person gets a pitch about handing work to coding agents and getting facts back. An agent gets a pitch about delegating a change to another agent and getting results it can verify. Both pitches use the one name and claim only what ships. The home page shows the whole product as four moments (author, run, review, keep) instead of nine facets of the run. A check keeps every claim tied to the page or command that shows it.

> Every sentence that says what phax is names verified delegation and claims only what a shipped page or command shows.

## 4. Terminology

- **verified delegation** — phax's name for what it is. A person or an agent hands a change to a coding agent and gets back facts that can be checked, not the agent's claim that it is done. The name describes the promise, not the mechanism.
- **pitch** — The sentence or two that says what phax is to one reader. There are exactly two pitches: the person pitch and the agent pitch. Each has one wording, repeated word for word wherever it appears.
- **person pitch** — The pitch for someone who delegates to coding agents: hand work to Claude Code, OpenAI Codex or Mistral Vibe and get back facts, not claims.
- **agent pitch** — The pitch for a coding agent that delegates to other coding agents. It is one sentence, short enough to be the first line of phax --help, and reads exactly: "phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify."
- **agent detail** — The claims that back the agent pitch's "results you can verify": an isolated Git worktree per phase, gate commands that must exit 0, touched files reconciled with the plan, run state that outlives the agent's context, and every command answering JSON with a schema. It sits right under the pitch on the agent page and in the body of the phax-cli skill's "What phax is" section, never in phax --help or llms.txt.
- **place** — A spot where phax states what it is, assigned to one reader. Person places: the home page's tagline, the README's opening paragraph, the description in package.json and in npm/package.json, and the site's description. Agent places: the first line of phax --help and the usage spec's about line, the opening of the phax-cli skill's "What phax is" section, the llms.txt introduction, and the opening of the agent page. The comparison pages' "The one-line difference" paragraphs and their page descriptions are places too, but they carry the name, not a pitch.
- **claim** — One fact a pitch, the agent detail or a home feature asserts, such as "every finding has a fate".
- **proof** — What a claim names to show it ships: a docs route (for example /guide/findings) or a phax command (for example phax finding list).
- **moment** — One of the four parts of working with phax: author (specs and plans), run (gated phases), review (compliance, code review, findings, the pull request) and keep (records and cost ledgers).
- **rejected name** — A word that must not name phax in a place: harness, orchestrator, orchestration engine, control plane, software factory.

## 5. Functional requirements

### 5.1 One name in every place

The system shall state the name "verified delegation" in every place.

### 5.2 The person pitch in the person places

The system shall carry the person pitch, word for word, as the home page's tagline, the README's opening paragraph, the description in package.json and npm/package.json, and the site's description.

### 5.3 The agent pitch in the agent places

The system shall carry the one-sentence agent pitch, word for word, as the first line of `phax --help` and the usage spec's about line, as the opening of the phax-cli skill's "What phax is" section, as the introduction of llms.txt, and as the opening of the "Delegating from an agent" page.

### 5.4 The agent detail under the pitch

The system shall show the agent detail right under the agent pitch on the "Delegating from an agent" page and in the body of the phax-cli skill's "What phax is" section.

### 5.5 The phax-cli skill's description

The phax-cli skill's description shall name verified delegation and keep its "Use when" sentence, which tells an agent when to load the skill.

### 5.6 The tagline stays

The system shall keep the home page's text "The golden path, just facts." and the open-graph image's alt text "phax — the golden path, just facts" unchanged.

### 5.7 Four moments on the home page

The home page shall show exactly four features, one per moment, in the order author, run, review, keep, linking to /guide/specs-and-plans, /guide/run, /guide/review-and-land and /guide/records respectively.

### 5.8 A page for agents

The docs site shall have a "Delegating from an agent" page, listed in llms.txt. The page opens with the agent pitch and shows the commands an agent calls to delegate, `--json`, `--json-schema`, the exit codes and `phax --usage`.

### 5.9 Every claim names its proof

Every claim in a pitch, in the agent detail and in a home feature shall name its proof: a docs route or a phax command.

### 5.10 A claim without a shipped proof fails the check

IF a claim's proof names a docs route that the site does not build, or a phax command that the command tree does not have, THEN `pnpm check:full` SHALL fail and name the claim and its proof.

### 5.11 A place that drifts fails the check

IF a person place or an agent place does not carry its reader's pitch word for word THEN `pnpm check:full` SHALL fail and name the place.

### 5.12 No rejected name for phax

IF a place names phax with a rejected name THEN `pnpm check:full` SHALL fail and name the place and the word.

## 6. Surface

### cli: phax --help — indicative

Summary: Running `phax --help` now opens with one line telling an agent that phax is verified delegation and that it gets back results it can verify.

before:

    Usage: phax [options] [command]

    Drive AI coding agents through isolated, gated phases

    Options:
      -V, --version   output the version number

after:

    Usage: phax [options] [command]

    phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify.

    Options:
      -V, --version   output the version number

### file: README.md — indicative

Summary: The README now opens by saying phax is verified delegation and what facts you get back.

before:

    phax runs a plan through AI coding agents — Claude Code, OpenAI Codex or Mistral Vibe — as a sequence of **gated phases**, and hands you a change you can review.

after:

    phax is verified delegation for AI coding agents: hand work to Claude Code, OpenAI Codex or Mistral Vibe and get back facts, not claims. Every phase passed your checks, every file is accounted for, every finding has a fate, and the history stays in Git.

### file: package.json — indicative

Summary: The npm page for @lbdremy/phax describes phax with the same pitch as the README.

before:

    "description": "phax runs a plan through AI coding agents — Claude Code, OpenAI Codex or Mistral Vibe — as a sequence of gated phases, and hands you a change you can review."

after:

    "description": "phax is verified delegation for AI coding agents: hand work to Claude Code, OpenAI Codex or Mistral Vibe and get back facts, not claims. Every phase passed your checks, every file is accounted for, every finding has a fate, and the history stays in Git."

### file: docs.phax.run home page — indicative

Summary: The home page keeps its tagline, adds the verified-delegation pitch under it, and shows four cards for author, run, review and keep.

before:

    The golden path, just facts.
    phax runs your plan through AI coding agents one gated phase at a time, and hands you a change already checked against the plan.

    Nothing moves on red · One worktree per phase · Planned vs. done · Your agent
    Checked against the plan · A PR that explains itself · History that outlives the worktrees
    Only the agent guesses · Specs and plans with a status

after:

    The golden path, just facts.
    phax is verified delegation for AI coding agents: hand work to Claude Code, OpenAI Codex or Mistral Vibe and get back facts, not claims. Every phase passed your checks, every file is accounted for, every finding has a fate, and the history stays in Git.

    Author  — Specs and plans with a status and an approval, drafted headless from a brief, open questions decided with phax artifact decide, plans linted, estimated and checked for overlap.  → /guide/specs-and-plans
    Run     — Each phase in its own worktree with the agent you pick; nothing moves until your gates pass; every file planned vs. done.  → /guide/run
    Review  — A compliance verdict against the plan, a headless code review whose findings each get a fate, and a pull request that explains itself.  → /guide/review-and-land
    Keep    — Each phase's record on phax/records/v1 and a cost ledger per run.  → /guide/records

### file: docs.phax.run/llms.txt — indicative

Summary: An agent that reads llms.txt first now gets the one-sentence agent pitch and a link to the page about delegating from an agent.

before:

    # phax

    > phax runs a plan through AI coding agents — Claude Code, OpenAI Codex or Mistral Vibe — as a sequence of gated phases, and hands you a change you can review.

    - [Installation](/guide/install.md): Install the phax CLI with npm …

after:

    # phax

    > phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify.

    - [Delegating from an agent](/guide/delegating.md): Delegate a change through phax from a coding agent: the commands to call, --json answers, --json-schema contracts, exit codes and phax --usage.
    - [Installation](/guide/install.md): Install the phax CLI with npm …

### file: docs.phax.run/guide/delegating — indicative

Summary: An agent, or the person who builds one, can read on one page what results it can verify, how to delegate a change through phax and how to check what comes back.

    # Delegating from an agent

    phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify.

    - Each phase runs in an isolated Git worktree.
    - Its gate commands must exit 0 before the next phase starts.
    - The files it touched are reconciled with the plan.
    - Run state outlives your context: phax resume picks up where the run stopped.
    - Every command answers JSON with a schema.

    ## Delegate a change
    phax artifact new spec <slug> --headless --brief - --json
    phax artifact new plan <slug> --headless --brief - --spec <spec> --last --json
    phax plans lint <plan> --json
    phax run --plan <plan> --json
    phax review-compliance <short-name> --json
    phax finding list <short-name> --json

    ## Read the answers
    --json on every command · --json-schema for each command's contract · exit codes · phax --usage for the full command tree

### file: .claude/skills/phax-cli/SKILL.md — indicative

Summary: An agent choosing skills sees that phax-cli is how it delegates a change with verifiable results, when to load it, and what it can verify.

before:

    description: Operate the phax CLI — its concepts, run lifecycle, and the canonical init → plan → run → review → publish flow. Use when driving phax, explaining it to a developer, or scripting against it. Defers to `phax --usage` for the exact command/flag contract.

    ## What phax is

    A deterministic, local CLI that drives an AI coding agent (Claude Code by
    default; also Mistral Vibe and OpenAI Codex) through isolated, **gated phases**.

after:

    description: Verified delegation through the phax CLI — delegate a change to another coding agent and get results you can verify; its concepts, run lifecycle and the init → plan → run → review → publish flow. Use when driving phax, explaining it to a developer, or scripting against it. Defers to `phax --usage` for the exact command/flag contract.

    ## What phax is

    phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify.

    Each phase runs in an isolated Git worktree, its gate commands must exit 0 before
    the next phase starts, the files it touched are reconciled with the plan, run
    state outlives your context, and every command answers JSON with a schema.

### file: docs/comparisons/spec-kit-vs-phax.md — indicative

Summary: The comparison pages now describe phax as verified delegation and keep their titles and side-by-side axes.

before:

    **Spec Kit is a methodology + prompt/template layer, with a workflow engine on
    top, that runs your AI agent _as the worker for each step_. phax is an
    orchestration engine that runs your AI agent _inside isolated, mechanically
    gated phases_.**

after:

    **Spec Kit is a methodology + prompt/template layer, with a workflow engine on
    top, that runs your AI agent _as the worker for each step_. phax is verified
    delegation: it runs your AI agent _inside isolated, mechanically gated phases_
    and hands back facts, not claims.**

### internal: the pitch claims — indicative

Summary: Each claim phax makes about itself names the page or command that shows it, so a claim about an unshipped feature fails the check.

    person pitch
      hand work to Claude Code, OpenAI Codex or Mistral Vibe  → /guide/providers-and-security
      every phase passed your checks                         → /guide/run
      every file is accounted for                            → /guide/concepts
      every finding has a fate                               → /guide/findings
      the history stays in Git                               → /guide/records
    agent pitch
      results you can verify                                 → /guide/delegating
    agent detail (agent page, phax-cli skill)
      an isolated Git worktree per phase                     → phax run
      gate commands must exit 0                              → /guide/set-up
      touched files reconciled with the plan                 → phax review-handoff
      run state outlives your context                        → phax resume
      every command answers JSON with a schema               → /reference/json-output

    ✗ claim "inbox of finished delegations" names phax inbox, which the command tree does not have

## 7. Non-goals

- The roadmap and its votes (docs/briefs/roadmap-items.md).
- The logo, the colours, the tour video, the open-graph image and its alt text.
- Renaming any command or concept.
- Claims for features a brief still holds (phax do, the inbox, next steps as data, run detach). Each one adds its claim in its own pull request when it lands.
- The descriptions of the other six installed skills. A skill's description tells an agent when to load the skill, and only phax-cli is about what phax is.
- The comparison pages' titles, axes and "last checked" notes. Only their one-line difference and their page description change.
- Rewriting guide pages other than the new agent page, and the 1.0 announcement post.
- Measuring whether the new pitch converts better than the old one.

## 8. Acceptance criteria

### Every place names verified delegation

Given the repository and the built docs site, when each place is read, then each contains "verified delegation", including the two comparison pages' "The one-line difference" paragraphs and their page descriptions. (refs §5.1)

### The person pitch is the same everywhere

Given the repository and the built docs site, when the README's first non-badge paragraph, the home page's tagline, the description in package.json and in npm/package.json, and the site's description are read, then all five are the same person pitch, word for word. (refs §5.2)

### The agent pitch is the same everywhere

Given phax built from the change and the built docs site, when `phax --help` runs and `phax --usage`, llms.txt, the phax-cli skill and the "Delegating from an agent" page are read, then the line under `Usage:`, the usage spec's about line, the blockquote under llms.txt's title, the first paragraph of the phax-cli skill's "What phax is" section and the first paragraph of the agent page are each exactly "phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify.". (refs §5.3)

### The detail sits under the pitch, not in the help

Given phax built from the change and the built docs site, when the agent page, the phax-cli skill's "What phax is" section and `phax --help` are read, then the agent page and the skill's section show, right after the pitch, the isolated Git worktree per phase, the gate commands that must exit 0, the touched files reconciled with the plan, run state that outlives the context and JSON answers with a schema; and the first line of `phax --help` is the one-sentence pitch with none of that detail. (refs §5.4)

### phax-cli still says when to load it

Given the phax-cli skill installed by `phax skills install`, when its description is read, then it contains "verified delegation" and a sentence beginning "Use when". (refs §5.5)

### The tagline and the card stay

Given the built docs site, when the home page and its link-preview tags are read, then the home page's text is "The golden path, just facts." and og:image:alt is "phax — the golden path, just facts". (refs §5.6)

### Four moments, four links

Given the built docs site, when the home page's features are read, then there are exactly four, in the order author, run, review, keep, and they link to /guide/specs-and-plans, /guide/run, /guide/review-and-land and /guide/records respectively. (refs §5.7)

### An agent finds the delegation page

Given the built docs site, when llms.txt and the "Delegating from an agent" page are read, then llms.txt lists the page with a link, and the page opens with the agent pitch and shows `--json`, `--json-schema`, the exit codes and `phax --usage`. (refs §5.8)

### Every shipped claim has a proof

Given the repository as the change leaves it, when `pnpm check:full` runs, then it passes, and every claim of both pitches, of the agent detail and of the four home features names a docs route the site builds or a command the phax command tree has. (refs §5.9, §5.10)

### A claim about an unshipped feature fails

Given a claim added to the agent detail whose proof is the command `phax inbox`, or a claim whose proof is the route /guide/inbox, when `pnpm check:full` runs, then it fails and names the claim and the missing command or route. (refs §5.10)

### A place that drifts fails

Given the README's opening paragraph edited so it differs from the person pitch, when `pnpm check:full` runs, then it fails and names README.md as the place that drifted. (refs §5.11)

### A rejected name fails

Given a place edited to call phax "an orchestration engine" or "a harness", when `pnpm check:full` runs, then it fails and names the place and the rejected word. (refs §5.12)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-agent-page — Does the docs site get a "Delegating from an agent" page, or does the agent pitch live only in llms.txt, phax --help and the phax-cli skill?

- page — Add the page and list it in llms.txt — abandons: A smaller site. The page partly repeats /reference/json-output and the exit-codes page, and it has to be kept up to date as delegation commands land.
- no-page — No page; the pitch stays in llms.txt, phax --help and the phax-cli skill — abandons: A URL for the agent's question. An agent that fetches docs.phax.run finds reference pages but nothing that explains why and how to delegate, and the agent pitch's claims can only point at scattered reference pages.

Recommendation: page — The agent is phax's most frequent caller and has no page written for it. The overlap is acceptable because the page links to the reference pages and doesn't restate them. If no-page is chosen, r-agent-page and ac-agent-page are dropped.

Decision: page — by operator (Rémy Loubradou), 2026-11-22
Why: The agent is phax's most frequent caller and has no page written for it. The overlap is acceptable because the page links to the reference pages and doesn't restate them. If no-page is chosen, r-agent-page and ac-agent-page are dropped. Advocate: A smaller site is cheaper to keep true: the page repeats the JSON-output and exit-code pages and must be updated as each delegation command lands, while the pitch in phax --help, llms.txt and the skill already reaches an agent where it looks. Principles: S1, C5. Reversibility: cheap. Revised: none.

### q-llms-intro — Rspress uses one site description for both the meta description (a person's search result) and the llms.txt introduction (an agent's first read). Which pitch goes where?

- split — The meta description keeps the person pitch, and the llms.txt introduction is replaced with the agent pitch — abandons: Using Rspress's llms.txt as it comes. The build has to rewrite the introduction of a file Rspress generates, and that step can break when Rspress changes its llms.txt layout.
- shared — One description for both: the person pitch — abandons: The agent pitch in the file an agent reads first. llms.txt would open with "hand work to Claude Code…", a person's reason to use phax, not an agent's.

Recommendation: split — The brief lists llms.txt as an agent place, and it is where an agent forms its first view of phax. The drift check, which compares each place with its pitch word for word, would catch a broken rewrite on the next build. If shared is chosen, llms.txt moves from the agent places to the person places in r-agent-pitch and r-person-pitch.

Decision: split — by operator (Rémy Loubradou), 2026-11-22
Why: The brief lists llms.txt as an agent place, and it is where an agent forms its first view of phax. The drift check, which compares each place with its pitch word for word, would catch a broken rewrite on the next build. If shared is chosen, llms.txt moves from the agent places to the person places in r-agent-pitch and r-person-pitch. Advocate: One shared description keeps Rspress's llms.txt generation untouched: no build step rewrites a generated file, so nothing breaks when Rspress changes its layout, and the single source stays simple. Principles: S1, C4. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- The name is verified delegation. Harness, orchestrator, orchestration engine, control plane and software factory are rejected as names for phax in any place.
- There are two pitches under the one name. The person pitch starts from the operator's draft in the brief. The agent pitch is exactly one sentence, fixed by the operator on 2026-11-22: "phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify."
- The agent detail (worktree, gates, reconciliation, state that outlives the context, JSON with a schema) sits under the pitch on the agent page and in the phax-cli skill's "What phax is" section, not in phax --help or llms.txt, so the help stays short as docs/briefs/agent-cli-ergonomics.md asks.
- The tagline "The golden path, just facts.", the logo, the open-graph image and its alt text are kept.
- The places and their readers are those listed in the terminology.
- The home page has four features, author, run, review and keep, linking to /guide/specs-and-plans, /guide/run, /guide/review-and-land and /guide/records.
- Of the installed skills, only phax-cli changes.

Left open:

- The final wording of the person pitch and of the agent detail. §6 shows the drafts. The operator may polish them, and the drift check keeps every place in step with whatever wording is chosen.
- Where the two pitches, the agent detail and their claims are stored once, and whether each place reads from that store or is compared with it.
- The route and the source file of the agent page, if q-agent-page chooses page.
- How the llms.txt introduction is replaced, if q-llms-intro chooses split.

Constraints:

- Claim only what ships. A pitch or the agent detail names nothing a brief still holds, and each feature that lands extends the agent detail in its own pull request.
- Use words a person and an agent read the same way, with no metaphor an agent has to decode. The tagline is the one exception, kept by the operator's decision.
- The checks run inside `pnpm check:full`.
- Changing the program's summary also changes the usage spec (`pnpm gen:usage-spec`), docs/cli/reference.md, the root-help fixture and the test that pins the summary. Regenerate them; don't hand-edit them.
- The site's page map assigns every page exactly once, so a new page goes into site/pages.ts with its description.

## 11. Docs page

Page: Delegating from an agent (/guide/delegating)

Reader: A coding agent that delegates a change to another coding agent, or the person who builds such an agent

Example: An agent drafts a spec and a plan headless from a brief, lints the plan, runs it with --json, reads the outcome's kind and exit code, then reads the compliance verdict and each finding's fate with phax finding list --json instead of trusting another agent's "done".

## 12. Decision log

- 2026-11-22 q-agent-page decided page — operator (Rémy Loubradou)
- 2026-11-22 q-llms-intro decided split — operator (Rémy Loubradou)
