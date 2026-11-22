Write the phax spec `positioning`: phax names what it is, verified delegation, and says it to its two readers in
the places each reads. A person reads the home page and the README; an agent reads `phax --help`, the skills'
descriptions and `llms.txt`. Each gets its own pitch, under the one name.

## Why

The operator, 2026-11-22. The home page says "phax runs your plan through AI coding agents one gated phase at a
time, and hands you a change already checked against the plan", and `phax --help` opens with "Drive AI coding agents
through isolated, gated phases". Both describe the run, a third of phax today. phax also authors (specs and plans
with a status and an approval, headless drafts from a brief, `artifact decide` on open questions, plan lint,
estimate and overlap), reviews (compliance, headless code review, findings with fates, a pull request that explains
itself) and keeps (records on `phax/records/v1`, cost ledgers). What ties it together is that phax turns an agent's
"done" into facts: a gate that exited green, files reconciled with the plan, each finding with a fate, a history in
Git. The tagline "The golden path, just facts" already says that; the sentence under it does not.

The second reader is an agent. The briefs of 2026-11-19 (`agent-cli-ergonomics`, `inbox`, `next-steps-as-data`,
`phax-do`, `run-detach`) all start from what an agent wants from phax, and an agent is already phax's most frequent
caller. It never sees the home page. Its question is the one `docs/briefs/phax-do.md` asks: why delegate through
phax rather than to its own subagents, whose "done" is a claim.

## The direction (the operator's, 2026-11-22)

1. **The name is verified delegation.** A person delegates to coding agents; an agent delegates to other coding
   agents. In both, phax is what makes the result checkable. It names the promise, not the mechanism. Rejected, with
   what each abandons: "harness" (to a developer the harness is Claude Code itself, and phax would read as its
   rival), "orchestrator" or "control plane" (a crowded category about fleets of agents in parallel, where
   verification disappears), "software factory" (it reads as a factory with nobody in the loop, the opposite of
   approved specs and plans and a reviewed change). Accepted loss: nobody searches "verified delegation" yet, so the
   pitch explains it in one sentence; the comparison pages keep the searches people already make.
2. **Two pitches, one name.** For a person, under the tagline, as a draft: "Hand work to Claude Code, Codex or Vibe
   and get back facts, not claims: every phase passed your checks, every file is accounted for, every finding has a
   fate, and the history stays in Git." For an agent, as a draft: "Delegate a change to another coding agent and get
   verifiable results: an isolated worktree, a gate that must exit green, touched files reconciled with the plan,
   state that outlives your context, every answer as JSON with a schema."
3. **Only what ships.** The agent pitch claims nothing a brief still holds: no `phax do`, no inbox, no next steps as
   data until they land. Each one that lands extends the pitch in its own pull request.
4. **The tagline stays.** "The golden path, just facts", the logo and the open-graph card are kept.

## What phax has today, to read first

- `site/pages.ts`: the home page's `text`, `tagline` and eight `features`, all about the run.
- `README.md`, its opening paragraphs and "How phax compares".
- The program's description shown by `phax --help` (the command tree's root, `src/cli/`), and the `usage` spec
  generated from it (`pnpm gen:usage-spec`).
- The skills phax installs (`phax skills install`) and their `description` lines, `phax-cli` first.
- `site/rspress.config.ts` (`llms: true`: `llms.txt`, `llms-full.txt` and a Markdown twin of every page) and the
  pages' `description` fields in `site/pages.ts`, which feed `llms.txt`.
- `site/build/og.ts` (the card's alt text), `docs/comparisons/` (the three comparison pages).

## What the spec must cover

- Every place that states what phax is, for each reader, and the sentence each gets: the home page's tagline and
  features, the README's opening, `phax --help`'s description, `package.json`'s and `npm/package.json`'s
  `description`, the skills' descriptions, the `llms.txt` introduction, the site's description.
- The home page's features regrouped by the four moments (author, run, review, keep) instead of eight facets of the
  run, and which existing guide page each links to.
- Whether the site gains a page for agents ("Delegating from an agent": the commands, `--json`, `--json-schema`,
  exit codes, `phax --usage`), or the agent pitch lives only in `llms.txt` and the skills.
- A check that keeps the pitch true: each claim names the guide page or the command that shows it, so a claim with
  no shipped feature behind it has nowhere to point.

## Out of scope

- The roadmap and its votes (`docs/briefs/roadmap-items.md`).
- The logo, the colours, the tour video and the open-graph image.
- Renaming commands or concepts.

## Constraints

- Words a person and an agent both read the same way: no metaphor an agent has to decode.
- Keep the spec short, with only genuine §9 questions, each with its options, what each abandons and a recommended
  default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
