# Idea: the harness, read from the records

> Status: **brainstorm**. Captured 2026-11-04 in an interactive session — not a spec,
> not a plan. Nothing below is committed. Numbers and the script that produces them:
> [`spikes/harness-data/`](../../spikes/harness-data/README.md); literature review:
> [`spikes/harness-data/literature.md`](../../spikes/harness-data/literature.md).
> Related: [`change-gates-from-the-harness.md`](./change-gates-from-the-harness.md),
> steme (its standards will reach phax as dynamic briefs).

## What a harness is, for phax

The harness is the working environment phax gives the agent, everything around the model:

- **feed-forward** — what the session is handed before it acts. Static: the phase
  prompt, `CLAUDE.md`, rules, skills. Dynamic: briefs chosen for the task (with steme,
  chosen by the files the phase touches).
- **feedback** — the commands that tell the agent whether it is right (tests, typecheck,
  lint, format, the gate), and how fast they answer.
- **routing** — which model and effort run which task.

A better harness gives the agent an efficient working environment **at low cost**: the
same or better result, in less time, for fewer tokens. It is optimised per task class
(authoring, phase, fix, review), not per task. A bigger model or higher effort is not a
better harness by default — sometimes it does worse (HAL, ICLR 2026), and the records
point the same way (Sonnet 5.5 high: twice the tool calls and more retries than medium,
confounded by the planner giving harder phases more effort).

**Not a problem:** a gate that fails and a fix loop that repairs it. That is feedback
working. What matters is what the loop costs and how long it takes.

## Feed-forward: too wide, and partly someone else's

Measured on phax's own records (2026-11-04):

- ~50k tokens are in context at a phase's first turn (30k–87k), before the agent reads
  anything; every session pays it, then re-reads it from cache each turn.
- Phase sessions load a median 64 skills (max 77, up from 32 over three months). The
  repository supplies 16; the rest are user-level and plugin skills (video, Cloudflare,
  office documents…) no phase of phax needs.
- Every session loaded the maintainer's auto-memory index.

Two losses: tokens on every turn, and **portability**. A harness meant to be reused across
people cannot depend on what one person installed globally. The user-level layer is also
the part `sourceSha` cannot recover, so it is the part no record can attribute.

The literature agrees on direction, not on magnitude: context files generally do not raise
success and cost ~20% more (Gloaguen et al., "Evaluating AGENTS.md", ICLR 2026); another
2026 study found them cutting runtime. Treat every piece of static feed-forward as a knob
that costs, to be measured, and prefer scoped (dynamic) over global (static).

**Isolating the session, measured** (Claude Code 2.1.318, Haiku, one turn, phax repo,
OAuth/Max auth — read from each session's `init` event):

| Launch                                                              | Skills | Plugins (non-builtin) | MCP | Auto-memory | User rules | First-turn context |
| ------------------------------------------------------------------- | -----: | --------------------- | --: | ----------- | ---------- | -----------------: |
| today's default                                                     |     75 | cloudflare            |   7 | loaded      | loaded     |             35.5k |
| `--setting-sources project,local`                                   |     35 | none                  |   2 | loaded      | dropped    |             25.1k |
| same + `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`                          |     35 | none                  |   2 | dropped     | dropped    |             21.4k |

- The two together drop everything user-level: skills, plugins, user hooks, user rules,
  auto-memory: −40% of the first-turn context, and OAuth keeps working. phax passes
  neither today.
- What stays: the 16 repository skills, 19 skills bundled with Claude Code (`debug`,
  `simplify`, `loop`, `claude-api`…), the built-in `cc-plugin-*` plugins, and the two
  claude.ai account connectors (MCP) — `--strict-mcp-config` with no `--mcp-config`
  drops those, and phase sessions already show none.
- `--bare` would go further but requires `ANTHROPIC_API_KEY` (no OAuth), so not on Max.
- Dropping user settings also drops user permissions, env and model defaults; phax
  passes its own, so that is wanted — but it is a behaviour change to check per mode.
- Not yet known: the bundled skills (no flag found short of `--disable-slash-commands`,
  which drops the repository's too), and the Codex and Vibe equivalents.

## Feedback: fast, and scoped like the feed-forward

- Phases spend **27% of their wall time** waiting on feedback commands.
- The biggest share is the agent running the **whole test suite**: 6.7 h over 403 calls,
  against 1.3 h over 1,193 targeted calls. Its median went 20 s (Aug) → 34 s (Oct) →
  151 s (Nov).
- Smaller commands drift too: `typecheck` 1.3 s → 2.3 s, `format` 1.0 s → 3.2 s.

**Where the test time is, measured 2026-11-04** (`vitest --reporter=json`, main):

- Whole suite: 613 files, 12,073 tests, **270 s** wall. `test:unit` alone: 402 files,
  **33 s**. Integration is 92% of the summed file time (2,011 s of 2,185 s).
- Concentrated: the top 20 files are half the time, the top 50 three quarters — whole
  runs per test (real git, worktrees), ~3–6 s per test.
- **71% of today's test time was added in October**: integration files written by phase
  agents for the stop / held / decide features (`heldStopRun` 104 s, `stopRecords` 97 s,
  `heldStopClose` 72 s…). The November jump is the agents' own tests, not only
  concurrency. The harness's feedback speed is an *output* of the agent's work, and
  nothing in the loop sees it.
- Graph targeting does not save us here: `vitest related src/app/gates.ts` selects 99
  files and takes 203 s; `executePlan.ts` 63 files, 119 s. Core modules are imported by
  most integration tests.
- The agent already targets by file (`pnpm test <file>`, `vitest run <file>`: ~700 calls);
  its ~460 whole-suite runs are mostly an end-of-phase check that the gate repeats anyway
  (the `standard` profile runs `pnpm test` every phase).
- One test failed on the first whole run and passed on the next: a flake, unidentified.

So, by expected return:

1. **Feed-forward, one line:** in-loop, run `test:unit` and the test files you touched;
   the gate runs the whole suite. Cuts most of the 6.7 h. Cost: a phase that breaks a
   distant integration test learns it from the gate (fix loop, ~$0.20 + a gate rerun).
2. **A feedback-speed sensor:** gate steps already have attribution; give them a
   duration, and let a phase see its delta (the suite got N s slower). Same family as the
   reviewable-unit budget in [`change-gates-from-the-harness.md`](./change-gates-from-the-harness.md).
3. **Faster integration tests:** the slow files share world fixtures (`createHeldWorld`,
   real git per test); sharing a world per file, or moving assertions down to unit level,
   is ordinary test work — but only a sensor keeps it from coming back.

The symmetry still holds — **the files a phase touches can select both its feed-forward
(which briefs) and its feedback (which tests, which lint scope)** — but for phax the
cheap scope is the test *tier*, not the import graph.

## Versioning the harness: a manifest per record

To attribute a change in cost or time to a change in the harness, each record has to say
which harness ran. The line that matters is what `sourceSha` already recovers:

- **In the repository** (`CLAUDE.md`, `.claude/skills`, `.claude/rules`, the gate profile
  in `phax.json`): already versioned. Stay static and committed — reviewed in diffs, with
  history. The record references them (path + hash), no copy.
- **Dynamic** (briefs generated for this task): snapshotted into the record, since they
  cannot be regenerated later.
- **Outside the repository** (user `CLAUDE.md` and rules, user and plugin skills,
  auto-memory, provider and phax versions, provider config): listed in the record — and
  the goal is to shrink this list to versions only.

## Evaluating a harness change (later)

When two harnesses need comparing, the records allow a replay suite: each phase has a
`sourceSha`, a prompt and a gate, so it can be re-run under harness B in a fresh worktree.
From the literature (Anthropic "Demystifying evals", Jan 2026; noise studies; AutoSaddler):
three sets (passing phases for regression, past failures, never-tuned holdouts), ≥3 trials
per task, paired comparison, outcome graded rather than path, test edits as a guardrail
that must not rise, transcripts read for every task that flips. Learned improvements stay
small, itemised and reviewed (ACE), not silent memory — most automatic memory systems do
not beat memory-off (VibeMemBench, 2026).

## Open questions

1. **Isolation per mode.** Adopt `--setting-sources project,local` +
   `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` for every phax-launched Claude session (phase,
   fix, authoring, decide, review)? Check what each mode loses with user settings. Codex
   (`CODEX_HOME`, profiles?) and Vibe equivalents to find.
2. **Who scopes the feedback.** The agent (told, item 1 above), phax (a scoped check
   derived from the diff), or the toolchain? Tiers look enough for phax; steme may differ.
3. **Latency monitoring.** Is a per-command latency series from the records enough, or
   should phax time gate steps itself (they already have attribution)? A per-phase
   duration delta is what would have caught October.
4. **Feed-forward for authoring.** Authoring sessions spend 99% of their calls exploring,
   always the same few files. Would a scoped brief help, or cost more than it saves (the
   AGENTS.md result)? Measurable once the manifest exists.
5. **Manifest shape.** A new record file, or fields on the existing manifests? Hashes of
   repository files, or only `sourceSha` plus the out-of-repo list?
