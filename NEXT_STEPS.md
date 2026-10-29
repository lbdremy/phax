# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-10-25. Since the previous prune (2026-10-19, v0.25.0), 0.26.0 shipped, and
these specs landed and were completed: `planning-skill-defaults` (two plans), `assignment-bounds`
(three plans), `oracle-phases` (three plans) and `interactive-phases` (three plans), all in
0.26.0; then `surface-summary` (#162) and the specless `small-fixes-0-27` plan (#163), both for
0.27.0. `phase-model-assignment`, `upgrade-hints`, `auto-migrate` and the first drafts of
`oracle-phases` and `interactive-phases` were abandoned.

## The queue, as of 2026-10-29

### Approved, not yet planned

- [ ] **`structured-output`** — `docs/specs/2610271515-structured-output.md`, approved 2026-10-27
      (brief `docs/briefs/structured-output.md`). Plan it next: it builds on `provider-failures`'
      session-outcome reader (#172, merged 2026-10-29). Its spec still says 0.29.0; bump its version
      references to the opened version when planning. Two validations: one
      simplified provider schema, derived from the full one, shared by Claude Code (`--json-schema`)
      and Codex (`--output-schema`, strict); phax's full decoder stays the judge, with one
      corrective resume. Six calls move to native output, plus the headless code review; the
      compliance review becomes a read-only structured answer whose Markdown phax renders from the
      fields. Vibe 3.0.3 has no schema option and stays on the prompt schema. A Claude combination
      that fails falls back to the prompt schema for that call.

- [ ] **`acceptance-tests`** — `docs/specs/2610271119-acceptance-tests.md`, approved 2026-10-27
      (brief `docs/briefs/acceptance-tests.md`). "Oracle phases" become acceptance phases:
      "acceptance" everywhere, "pass" replaces "discharge", the test line's loop becomes
      `acceptance | in-phase`; "oracle" keeps only its literature meaning (the test line's fourth
      field, the `wrong-oracle` escape; Barr et al. 2015). Adds the `boundary` technique. Old names
      in person-written files are refused, naming the new ones; the run needs `--allow-skill-edits`.

### Briefs written, spec not yet authored

- [ ] **`review-map`** — `docs/briefs/review-map.md` (2026-10-23). phax computes, without a model,
      where review attention belongs (criteria no test proves, skipped oracles, phases that needed
      fixes, the run's review notes) and gives it to the review session. Its dependency is met:
      test lines and criterion coverage are in `phax-plan.json` and `phax plans overview`.

### Drafts

- [ ] **`headless-review`** — `docs/specs/2609250823-headless-review.md`. Set aside 2026-10-27:
      review plans, `phax run --append`, a review loop, finding outcomes and history, passes in the
      PR body. The operator split the headless review off as `headless-code-review` and wants more
      use of it before deciding the rest. The 2026-10-27 revision (lens/escape/criterion, Q14–Q17)
      and an unresolved review (an appended oracle pair breaks on the run footprint, a missing test
      whose code is right cannot be an oracle pair, stale project skill copies) are in its history
      (f2854cbd and this session's review). Revisit, or abandon, once `headless-code-review` (#169,
      merged 2026-10-28) has been used.

## Model policy tracking

Since `planning-skill-defaults`, phases default to `claude-sonnet-5-5` at `medium`, where they used
to default to `claude-opus-5-5`. One row per run, to judge whether the policy holds. Classify each
review defect by origin:
- **plan** — the plan prescribed it, or a planning arbitration accepted it;
- **execution** — the phase agent got it wrong against a correct plan.

A rise in execution defects on default phases is the signal to tighten the policy.

| Date | Run (PR) | Phases (model / effort) | Phase cost | Review defects (plan / execution) | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | `architecture-provider` (#148) | 2 × sonnet-5-5 / medium | $2.66 | 2 / 3 | The plan accepted an unsandboxed grant to a session that could edit `phax.local.json`, and it dictated two wrong lines of the docs page. Execution missed three tests and a/an, and wrote a test that held only until the release cut. For scale, recent all-Opus runs of 2–3 phases cost $11–13. |
| 2026-10-20 | `architecture-report-parts` (#150) | 1 × sonnet-5-5 / medium | $0.96 | 1 / 2 | The plan's glob rules missed backticks and control characters, which break the rendered code span. Execution wrote a duplicate-id test that could not fail and left one stale docs line. |
| 2026-10-21 | `phase-shape` (#151) | 3 × sonnet-5-5 / medium, 1 × opus-5-5 / medium (with a reason) | $16.95 ($4.35 of it lost to a rate-limit pause) | 2 / 3 | The plan promised a refused resume leaves the run unchanged, which it does not, and its header grammar let `*Mode:*`, `__Mode:__` and blockquoted lines read as headless. Execution previewed a resume it would refuse, ignored a `**Model reason:**` line set off by a blank line, and split oracle files on commas inside code spans. |
| 2026-10-21 | `assignment-bounds` (#152) | 1 × opus-5-5 / high (with a reason), 1 × sonnet-5-5 / medium | $11.27 | 1 / 3 | The plan had `phax validate` print its success line before checking the bounds. Execution on the Opus phase left `phax plans lint` exiting 1 on an invalid config and wrote a glob matcher that backtracks exponentially; on the Sonnet phase it left the headless skill tying a null reason to the default. |
| 2026-10-21 | `oracle-phases` plan 1 (#154) | 3 × sonnet-5-5 / medium, 1 × opus-5-5 / medium (with a reason) | $14.85 | 2 / 5 | The plan promised a reset-the-pair recovery that `reset-phase` cannot do (now `phax resume --skip-oracle`, its own plan), and missed an oracle phase skipped for no changes. Execution told the agent to run the ungranted oracles provider, gave two frozen modules a wrong release range, documented lint as exiting 11, left phax-decide-plan's P3 unconditioned on a provider, and missed four §8 tests. |
| 2026-10-21 | `oracle-phases` plan 2, skip-oracle (#155) | 2 × sonnet-5-5 / medium | $2.88 ($0.97 of it before a usage-limit pause) | 0 / 1 | Execution named the `--skip-oracle` recovery in the reset refusal even when the discharge was already past its gate, where a resume would skip another phase's oracle step. |
| 2026-10-22 | `oracle-phases` plan 3, Vitest oracles example (#156) | 1 × sonnet-5-5 / high | $1.69 ($1.43 for the phase) | 2 / 3 | The plan let a marked test that never runs (`test.fails.skip`, `describe.skip`, no test function) pass both verdicts, against the spec's "no skip or todo takes a marker's place", and dropped a tagged template's raw text. Execution read `1e999` as `null`, gave a file named twice duplicate finding ids, and left the README's request stamp stale. |
| 2026-10-22 | `interactive-phases` plan 1, declared stop (#157) | 2 × sonnet-5-5 / medium, 2 × sonnet-5-5 / high, 4 × opus-5-5 / high (with a reason) | $58.92 ($12.38 of it before the first of two usage-limit pauses) | 9 / 6 | The plan kept a refused closing turn's edits in the worktree, so the next close committed them as the person's; let a resume failure after the stop was parked fail the run with the stop stranded; took HEAD at the first close as the base, so a person's commit passed as unchanged; dropped edits made after a half-finished close; gave the turn prompts no `$schema` URL (a real first turn invented one and needed a corrective resume); left `reset-phase` without the run lock and its preview blind to the person's handoff file; tracked a closing turn with an unversioned marker file; and asked for no effect telemetry. Execution let a test read the real `~/.phax`, copied a refused turn's binary files through text, saved an interrupted close as `awaiting_review` with no stop, defaulted a missing `stop` to `declared`, numbered a fallback closing session apart from its record, and documented `enter-phase` as printing the fresh-start command it runs. |
| 2026-10-23 | `interactive-phases` plan 2, the hold (#158) | 3 × sonnet-5-5 / medium, 2 × sonnet-5-5 / high, 3 × opus-5-5 / high (with a reason) | $43.89 ($26.91 of it before a usage-limit pause) | 3 / 8 | The plan left a held phase interrupted in its handoff turn re-running the phase in a loop, said nothing of a record write refused at closing, and gave `--skip-oracle` at a stop outside any pair the wrong refusal. Execution let a failed read on re-entry fail the run, let `holdCli.test.ts` read the real `~/.phax`, skipped two planned tests, left pulled briefs open at the hold point, published the `stop` schema without `additionalProperties: false`, named no recovery in the `reset-phase` refusal on the oracle commit, read the hold with `readFileSync` around the port, and told the person to commit held corrections. The review also found that the Claude Code, Codex and Vibe adapters resolved a turn before its stream was flushed, so the cost ledger could miss a turn's usage under load; fixed on #158. |
| 2026-10-24 | `interactive-phases` plan 3, stop records, transcripts and the run list (#161) | 4 × sonnet-5-5 / medium, 3 × sonnet-5-5 / high, 2 × opus-5-5 / high (with a reason) | $34.35 ($23.41 of it before a usage-limit pause) | 2 / 4 | The plan contradicted itself twice: on a shared test setup file for the provider store variables, and on whether the Vibe finder falls back to every `session_*` folder (the code followed the phase, the docs the arbitration). Execution built a transcript path from a session id it had not checked, left a held stop whose session recorded no builder usage stuck on resume even with records off, let most close suites read the machine's git config, and read the closer from `user.*` ahead of git's `author.*`. The usage limit hit inside phase-04's handoff generation, and resume went on without it (now in Small follow-ups); the operator rebuilt that handoff before the review handoff would run. |
| 2026-10-24 | `surface-summary` (#162) | 3 × sonnet-5-5 / medium | $6.24 ($1.15 of it before a usage-limit pause) | 1 / 2 | The plan dictated a one-line pattern that refused only `\n` and `\r`, so U+0085, U+2028 and U+2029 passed and would break a release-notes bullet. Execution's README left `decide` out of the commands refused before migration, limited the lift to 0.25.0 and 0.17.0 sidecars and said nothing of run completion refusing a placeholder; two code comments went stale. All three phases passed their gate first try. |
| 2026-10-25 | `small-fixes-0-27` (#163) | 1 × sonnet-5-5 / high, 1 × sonnet-5-5 / medium, 2 × opus-5-5 / medium (with a reason) | $14.62 | 3 / 5 | The plan dictated a worktree remedy (`git worktree add`) that fails on a deleted but still registered worktree, let a hand-written handoff leave its phase `committed` with no record and no cleanup, and owed a handoff to a phase an older phax had resumed past, which would have re-run finished phases. Execution described a skipped previous phase as committed with its handoff missing, left the test guard blind in `afterAll` and to a symlinked `~/.phax`, let the final count fail a finished run, linked permalinks for an unpushed branch, and called `existsSync` in `app/`. The plan review caught a guard that would have failed every test inside a phax worktree before approval. |
| 2026-10-25 | `test-strategy` (#164) | 2 × opus-5-5 / medium (with a reason), 3 × sonnet-5-5 / medium, 1 × sonnet-5-5 / high, with one oracle pair | $35.30 ($29.25 of it the two Opus phases) | 3 / 5 | The plan gave headless plan authoring the spec's Markdown only, so no headless plan could name a criterion id; joined `source-spec` onto the repository with no guard, so lint and the overview could read files outside it; and claimed a lossless round trip that an oracle starting with `— ` broke. Execution read undecodable frontmatter as none, repeated a phase per line in the coverage block, left the overview's invalid-artifact line without the path, kept the bullet in a U+2028 departure message, and left four overview outputs undocumented. The plan review caught nine defects before approval, among them a missing `plans status` refusal and source item numbering. The oracle pair (phase-03 to phase-04) discharged cleanly: eleven `it.fails` markers removed, no assertion edited. |
| 2026-10-26 | `artifact-decide-verdicts` (#165) | 4 × sonnet-5-5 / medium, 2 × sonnet-5-5 / high, with one oracle pair | $15.82 ($14.72 for the phases) | 3 / 5 | The plan bound a verdict that returns to the recommendation after a departure to `revised: []` and an unchanged body, so a correct revert was refused and a lazy one committed a verdict contradicting the body (now: the restoring verdict owes what the departure did); let routing send the writer to Mistral Vibe, whose adapter ignores `readOnly` (now refused); and copied the spec's approve hint without `--by operator`. Execution let an empty hand rationale become an empty `why` refused only after two sessions, named a side effect instead of the added option, gave a bad `--by` the approve parser's remedy, left `--verdicts -` blocking on a terminal, and drifted the documented commit subject. The oracle pair (phase-02 to phase-03) discharged cleanly with 45 oracles. CI then timed out a cold `tsx` spawn at 5s; raised to 30s. |
| 2026-10-26 | `release-notes` (#166, no spec) | 3 × sonnet-5-5 / medium, 1 × sonnet-5-5 / high, with one oracle pair | $6.08 | 3 / 5 | The plan resolved an archived plan's relative links from `docs/plans/archive/`, where they were written at `docs/plans/` (the oracle had it right: the run stopped at phase-02's gate and the operator fixed the implementation, no assertion edited), had the placeholder refusal name the spec's `.md` instead of its sidecar, and left a spec's lede, guiding rule and summaries with raw relative links. Execution let the notes script ignore unknown arguments, read `--github-body` from the repository root, wrote a site test that could not fail, let two tests read the global git config, and documented two placements loosely. The plan review caught a link rule that would have broken the site build after the tag push, and the GitHub body cap (now a short body linking to the site). The compliance review's "main's lint was red" was Deno relinking oxlint (follow-up below). |
| 2026-10-27 | `release-notes-layout` (#167, no spec) | 2 × sonnet-5-5 / medium | $2.51 | 1 / 2 | The plan let a surface summary that opens with a Markdown block marker (`1. `, `- `, `> `, a fence) split its bullet; the builder now escapes it. Execution let the GitHub short body silently drop a What's new item that does not open with a paragraph (now refused, naming the line) and pinned the site's `Before` fold only at one nesting level. In review the operator moved Highlights to lead with the guiding rule, then the lede. The examples read poorly because the specs' surface `before`/`after` were written for implementers: the 0.28.0 spec sidecars were rewritten for readers on main (58384a91) and the `phax-spec` skill now says so (7626d179). phase-02's `releaseCut.test.ts` failure was a background suite racing the agent's own write of `docs/releases/0.28.0.md`. |
| 2026-10-27 | `headless-code-review` plan 1, review records (#168) | 2 × sonnet-5-5 / medium | $4.20 (one $0.20 fix attempt) | 2 / 5 | The plan read the review's records target from the project the command runs in, so `phax review-compliance <ns>.<run>` from another project committed that run's review to the wrong records branch and could push it to the wrong remote (now: the run's own project, read from its main checkout); and it left the help saying "non-mutating". Execution let a by-hand rerun commit the previous invocation's `compliance-review.json`, gave a missing dedicated clone `spawn git ENOENT` instead of `deferred-destination`, hard-coded `<run>` in the retry command, embedded git's raw multi-line stderr, and printed nothing on success. The plan review caught a test judging "beside the phase records" on one tree (each records commit holds only its own files) and seven exhaustive format registries left optional. |
| 2026-10-28 | `headless-code-review` plan 2, the headless code review (#169) | 5 × sonnet-5-5 / medium, with one oracle pair | $7.24 ($6.57 for the phases, one $0.07 fix attempt) | 2 / 5 | The plan ran the headless review under the compliance review's posture, answering through a `.phax-context/code-review.json` file: it could edit tracked files and could not run the git its prompt promised (now read-only like headless authoring, answering in its final message, with a worktree snapshot that puts back any change and refuses the answer); and it left `review.code.enabled` out of the config merge, so an overlay dropped it and the review silently never ran. Execution committed a stray `codeReviewSkillIds.test.ts-E` (macOS `sed -i -E`), could leave `code-review.json` and its session file out of step, told every provider to resume through `phax review-code` with a `<session-id>` placeholder, let `@scope` tokens in model text mention GitHub users on the PR, and named only the first allowed id in a refusal. phase-05's second gate attempt was the `releaseCut.test.ts` `afterAll` timeout. |
| 2026-10-28 | `mistral-vibe-3` (#170) | 2 × sonnet-5-5 / high (with a reason), 1 × opus-5-5 / medium (with a reason), 2 × sonnet-5-5 / medium; first run with the headless code review on | $16.37 ($12.26 for the phases, $0.79 in fix attempts, $2.59 for the code review) | 5 / 3 | The plan passed every writable root as `--add-dir`, which Vibe trusts as a project and whose `.vibe/` hooks and agents it loads, so a phase agent could plant config a later session would run (now: no `--add-dir` in read-only sessions, writes to `.vibe/` and `.agents/` denied, a root holding one refused). It relied on `VIBE_*` variables that a person's `accept-edits` profile outranks (now refused before spawning, and every confined turn's effective config is checked from its export). It recorded a Vibe phase's usage from its first turn only, gave read-only sessions without commands no `VIBE_TOOLS`, and left MCP and connectors on. Execution wrote a real e2e whose assertions the prompt in the stream satisfied, read a stale `export.json`, and pointed three refusals at a missing `agent-error.log`. The real e2e then found the Mistral API serves only `none`/`high` reasoning, so the catalog keeps two levels. The headless code review: 7 findings, 6 confirmed and 1 partly; it missed both security bugs and MCP, which the PR review found by reading Vibe's source. phase-05 burned two gate attempts on load timeouts (`releaseCut`, `plansEstimateCommand`) and one on `knip`. |
| 2026-10-28 | `provider-failures` (#172) | 2 × opus-5-5 / medium (with a reason), 2 × sonnet-5-5 / high (with a reason), 4 × sonnet-5-5 / medium, with one oracle pair; the headless code review on | $24.48 ($19.14 for the phases, $6.51 of it phase-03 alone; $1.05 in fix attempts, $3.29 for the code review) | 5 / 4 | The plan's oracle used an invented Claude limit wording (`Claude AI usage limit reached\|<epoch>`), so the real one ("You've hit your session limit · resets …") read as `provider-error`: exit 5 and a failed, unresumable run, where main paused it (exit 8). It named only part of Claude Code's connection wordings, read `api_retry.error` as a message when it is a category, and let an early retry the session recovered from outrank stderr. The spec's retry hint, `phax resume <run>`, only previews without `--yes`. Nothing archived `agent-error.log` and its transcript when the next session in the same folder overwrote the transcript. Execution left a closing turn's network failure without its failure block, stop-turn telemetry on the old error type, a blank Codex answer accepted, and docs that claimed a host in the message. The headless code review: 6 findings, 4 confirmed and 2 partly; it missed the three Claude format defects, which the PR review found in the `claude` binary's strings and the real-provider e2e confirmed. The e2e also found that Codex 0.165 never ends a session on network loss. phase-03 burned its gate on lint and two load timeouts (`completions`, `releaseCut`) and paused once on a usage limit. |

## Road to 1.0.0 — assessed 2026-09-15 at v0.14.0, rechecked 2026-10-05 at v0.18.0

Everything the 1.0 announcement (`docs/blog/announcing-phax-1.0.md`) describes is shipped,
except `isolated` mode, which the post itself disclaims. The feature surface is not what holds
1.0 back; the things below are. Ordered by what 1.0 would be lying about if skipped.

- [ ] **A persisted-format stability promise.** `phax.json` (`version: 1`), the run status
      files, the approval record formats, `phax/records/v1`. The no-shims rule is right for 0.x,
      but 1.0 means a config written under 1.0 still loads under 1.x. Decide the contract (frozen
      `version: 1` + a migration, or a documented "re-run `phax init`" policy) and write it down
      in the README; `auto-migrate` is where such a migration would live.
      **Provider answers, decided 2026-10-08 by the author:** before 1.0, an answer in an older
      shape of a format that changed is refused by name. From 1.0 it is read through its frozen
      shape and lifted, as phax reads its own older files. At 1.0 the guard tests that hold each
      answer reader to one shape must fail and name this rule, not be deleted.
- [ ] **CLI contract freeze.** Land the last renames from `docs/vocabulary-review.md` §"Top
      fixes" (at least 1, 2 and 4 — they change output and flag values) *before* 1.0, then hold
      the contract for one or two 0.x releases.
- [ ] **Migrate to Effect 4, before the freeze.** Effect 4.0 shipped 2026-10-06 (`effect@4.0.1`):
      a rewrite, one lockstep `effect` package, `@effect/platform` merged into it. Effect 3.x gets
      fixes until at least September 2029, but `@lbdremy/phax-schemas` exports Effect 3 `Schema`
      values and depends on `effect ^3.14`, so moving after 1.0 would be a breaking major of the
      package and of the cockpit. Its own spec (decided 2026-10-06).
      **Sized 2026-10-07** by a spike (nothing committed): 1,502 type errors in 224 `src` files
      and 2,910 in 443 test files, mostly from about ten mechanical root causes — `Either` gone
      (`Effect.either`, `decodeUnknownEither` → `decodeUnknownExit`), `Context.Tag` →
      `Context.Service` on the ports, the Schema filters → `.check(…)`, `Schema.optionalWith`,
      `Effect.catchAll`/`orElse` → `Effect.catch`, `ParseResult` → `SchemaIssue`. The two
      platform packages are unused in `src` and can go. Not mechanical: the JSON Schema
      generator changes every snapshot's text (every format gets a `next` snapshot), the
      parse-error wording behind refusals (`formatFirstViolation`) changes, and the frozen
      decoders under `src/schemas/history/` must keep their exact behaviour. Guide:
      `https://github.com/Effect-TS/effect/blob/main/MIGRATION.md`.
- [ ] **Check whether user-installed Claude Code mods run in phase sessions.** Raised
      2026-10-08. Mods are plugin code running inside Claude Code, unsandboxed, and plugins load
      in `claude -p` too; a mod that approves tool calls can step around secure mode's command
      allowlist. Find out what a phase session loads, then decide how secure mode keeps the
      operator's mods out (e.g. `--safe-mode` or `--bare`, checked against what those also turn
      off). Docs: `https://code.claude.com/docs/en/plugins/mods/overview`. A secure-mode
      boundary, so before the freeze.
- [ ] **Distribution polish.** macOS binaries are neither signed nor notarized
      (`docs/release.md`); npm install works, the raw binary is Gatekeeper-blocked. Either
      sign, or make npm the only documented install path for 1.0.
- [ ] **Provider coverage on record.** Claude is the tested path;
      `tests/e2e/semanticTrace.providers.test.ts` is the only real exercise of Codex and Vibe
      (and the real e2e does not reach them, see *Small follow-ups*). One full `phax run` per
      provider on a real plan, with the result noted here, is the minimum to keep the
      provider-independence claim.
- [ ] **A second user.** The registry shows one operator across three repos (phax, steme-lab,
      louloupapers). One outside `phax init` → `run` → `publish-pr` on a repo not authored here,
      before the number changes.

Not blockers, on purpose: specs 23/24, records consumers, the durable context layer, the
desktop — none is promised by the announcement.

## Small follow-ups

- [ ] **Codex never ends a session on network loss.** Codex 0.165, its API unreachable, emits
      `Reconnecting... N/5`, then `Reconnecting... waiting for network` every ~50 s without end and no
      `turn.failed` (2026-10-28, real e2e of `provider-failures`). A Codex phase hangs with nothing on
      the terminal. A watchdog in the Codex adapter: after N consecutive network `error` events, end
      the process and report `network` (exit 14). Its cost: a session Codex would have recovered after
      a short outage.
- [ ] **Nothing shows while a provider retries.** Claude Code retries a lost API for ~3 min, Vibe
      ~4.5 min, before failing; phax prints nothing meanwhile. A line such as `provider unreachable,
      retrying (3/10)` from Claude's `api_retry` events.
- [ ] **A resume after a network pause starts a new provider session.** It keeps the worktree but
      not the session's context; resuming the paused session would save the tokens spent before the
      outage.
- [ ] **A run does not keep its `--provider-priority`.** A resume without it routes by
      `providers.json`: on 2026-10-28 a Claude run resumed on Vibe. The hints now repeat the flag;
      persisting it with the run would make the plain resume right.
- [ ] **Most `phax resume` hints outside network and handoff still lack `--yes`.** The
      awaiting-review, hold-point and stop-record sections of `resume-instructions.md` and the reducer
      trace details print `phax resume <run>`, which only previews.

- [ ] **The Vibe "loose config" e2e case has never run.** `tests/e2e/vibeSecure.test.ts` checks
      that a hostile `VIBE_HOME` config cannot widen a secure session. A temporary `VIBE_HOME` has no
      sign-in (Vibe keeps it in the macOS Keychain under the real home), so the case needs
      `MISTRAL_API_KEY` and is skipped without it. The other five cases passed against Vibe 3.0.3
      on 2026-10-28. Run it once with a key.
- [ ] **`phax agent setup providers --write` re-enables every installed provider.** On 2026-10-28
      it turned Codex on for an operator who wanted only Claude Code and Vibe, and it had written
      every catalog model into `providers.json`, so the three retired Mistral ids later had to be
      removed by hand. Let it enable only the providers named, or keep a provider the person
      disabled disabled.
- [ ] **A Vibe `accept-edits` profile reached through `agent_paths` is caught only after the
      turn.** #170 refuses `$VIBE_HOME/agents/accept-edits.toml` before spawning, but a profile in a
      directory named by Vibe's `agent_paths` setting is caught only by the post-turn config check,
      once the turn has run. Read `agent_paths` from the config phax already decodes and refuse
      the same way.
- [ ] **Phase agents on macOS leave `-E` backups from `sed -i -E`.** BSD `sed` reads `-E` as the
      backup suffix, so `sed -i -E …` writes `<file>-E` beside each edited file. One was committed
      in `headless-code-review` phase-01. Tell phase agents to edit with their file tools, or refuse
      `*-E` files at reconciliation.
- [ ] **A worktree left dirty after the phase commit blocks cleanup.** In the same run phase-01's
      agent deleted the committed `-E` file after its commit, without committing the deletion, and
      the cleanup refused the dirty worktree, failing the phase. Say which paths are dirty and how to
      recover (`git checkout` then `phax resume`), or commit-or-restore after the handoff turn.
- [ ] **Deno relinks `node_modules` in phase worktrees past the lockfile.** Found 2026-10-26
      reviewing #166: with `nodeModulesDir: "auto"` (`deno.json`), a `pnpm deno:smoke` in a phase
      worktree relinked `node_modules/oxlint` to 1.69.0 while `pnpm-lock.yaml` pins 1.64.0, so the
      phase's lint reported errors main does not have, and the agent "fixed" unrelated tests. The
      same agent ran `pnpm test`, the site build and `deno:smoke` at once, and a file failed to load.
      Keep Deno from touching `node_modules` (`nodeModulesDir: "none"` or a separate dir), and tell
      phase agents not to run the gate's commands concurrently.
- [ ] **`phax artifact approve` approves a plan whose slug differs from its spec's.** Found
      2026-10-25 while verifying #163: `artifact new plan tally --spec …-tally-counter.md` makes a
      plan that `phax plans lint` refuses (`slug "tally" differs from source spec slug
      "tally-counter"`), and `approve` still approves it. Approve should refuse what lint
      reports as an error, or at least this one. Since #164 the same holds for a plan with a
      test line that departs from the format: `approve` accepts it, and `phax run` and
      `phax plans status` then refuse it.
- [ ] **The npm `phax` shim does not forward SIGINT to its binary.** Found 2026-10-25 while
      verifying #164 with the released 0.27.0: a SIGINT to the node shim left
      `~/.phax/bin/0.27.0/phax-darwin-arm64` running, and it went on with the phase (a session,
      the gate, a fix attempt) until the binary itself was signalled. Forward SIGINT and SIGTERM
      to the child and exit with its status.
- [ ] **The cost ledger drops interrupted provider calls.** Found 2026-10-25 while verifying #163:
      a run SIGINT-ed twice (once in each of two handoff turns) has 4 ledger entries for 6
      provider invocations. Check whether an interrupted turn's usage is ever written, and write
      it as `partial` where it is known.
- [ ] **A phase agent commits phax's own `.gitignore` line.** In a fresh repository phax appends
      `.phax-context/` to the worktree's `.gitignore`, and the phase-01 agent committed that edit,
      so the PR body counts an unplanned deviation. Write the ignore rule where it is not part of
      the phase's diff (`.git/info/exclude` of the worktree), or exclude it from reconciliation.
- [ ] **A person's handoff written after a crashed turn is set aside.** When a closing or first
      turn is left in progress by a crash and the person then writes
      `.phax-context/correction-handoff.md` before resuming, the settle step reads the changed file
      as the turn's and moves it to `refused-turn-NN/`. Nothing is lost, but the person must copy
      it back. Compare against the fingerprint only for a turn that could write, or name the file
      in the resume output.
- [ ] **A refused `phax resume` should leave the run as it was.** Today `RunResumeRequested` moves the
      run to `running` before the start preflight re-checks it. A refusal (exit 11) then reaches the
      `RunFailed` guard in `executePlan`, and the run becomes `failed`, which `resume` refuses for
      good until `phax reset-phase`. This holds for every re-check: MCP file, records clone,
      provider, plan sections, and since PR #151 the interactive, oracle and Model-reason
      refusals. Run the preflight before the transition, or treat its refusals as a pause, and
      assert the state and last error are unchanged.
- [ ] **The real e2e's Codex and Vibe flows run on Claude.** Found 2026-10-06:
      `tests/e2e/realFlow.test.ts` fails "each phase recorded the expected security posture and
      provider" for `[codex-cli] (secure)` and `[mistral-vibe] (unsafe)`: both phases ran on
      `claude-code`. The fixture plan (`tests/e2e/fixtures/minimal-repo/plan.md`) asks for
      `claude-haiku-4-5-20251001` at `none`, which has no Codex anchor; Vibe's `off` alias does
      anchor to it, but Vibe was not chosen either, and why is not checked yet. Routing falls
      back to the terminal Claude Code (not a regression). Fix the fixture: give its phases a
      model and effort both providers anchor, or assert the routing reason instead. Until then
      the real e2e exercises neither Codex nor Vibe. Left out of 0.25.0 on 2026-10-19.

## steme coordination — still open

From the phax–steme coordination note
(`/Volumes/Work/steme/steme-corpus/docs/corpus/02-product/phax-steme-coordination.md`); the gate
chain it asked for (drop orient and scopes, the gate request, the brief, `gate-report` and
`brief-report`) has landed.

- [ ] **The plan auditor's answer carries `$schema`.** Decided 2026-10-06 by the author: every
      JSON document crossing a provider boundary is versioned, requests and answers alike. The
      plan auditor (`planAuditor`, `phax plans lint`'s advisory check) still receives `{phases}`
      and answers without one. Version its request and its answer the same way, with an answer
      that has no `$schema` refused and no fallback. A small spec of its own, before the 1.0
      freeze.
- [ ] **The brief at plan authoring** — still unspecced: the same verb as the phase brief, at an
      earlier moment.

Deferred from `schemas-package` with the author (2026-09-29): **a Standard Schema export** per
format (only if a consumer needs to hand the schemas to a non-Effect validator; the cockpit
parses with Effect, losslessly); **deterministic JSON Schema annotations** for hand-written
filters — one source per rule, and cross-field checks registered by id so the build writes the
same list into the schema (`x-phax-checks`) — for non-TypeScript readers only.

## Records consumers (the substrate shipped in 0.9)

- [ ] First consumer: **compliance review as diff-vs-intent evidence.** Today it compares the
      diff against the extracted plan; the transcript adds *how* the phase got there — files read
      versus files claimed, approaches abandoned, the point of drift. Needs no distribution
      answer (the review runs on the machine that ran the phases), so it is the cheapest thing to
      build on top. The per-phase `verifiedSurfaces` manifest field (since 0.10) is queryable
      across runs, but nothing queries it yet; `records activity` / `recap` / `dispatch`
      cross-run summaries stay deferred (see *Longer horizon*).

## Spec candidates, deliberately not written yet

- [ ] **A structured phase handoff** (raised 2026-10-27, out of `structured-output`'s scope). The
      handoff turn returns a structured answer instead of `phase-handoff.md`'s Markdown; every later
      phase reads it, so it gets its own spec after `structured-output` lands. No brief yet.
- [ ] **Oracles provider: the oracle's own quality** (raised 2026-10-23, out of `test-strategy`'s
      scope). The provider checks that an oracle phase's tests fail on their assertion, not on a
      crash or an import error; that table and generator files are oracle files, frozen like the
      tests; and that property tests run on a fixed seed. No brief yet.
- [ ] **OpenSpec-inspired ideas — brainstorm before speccing.** Captured 2026-09-01 in
      `docs/ideas/openspec-inspired-ideas.md` from the OpenSpec comparison
      (`docs/comparisons/openspec-vs-phax.md`). Three pistes: living specs describing current
      system behavior with requirement deltas folded back at `phax artifact complete`;
      requirement-level traceability on top of the file-level reconciliation; an explicit
      explore step before `phax-spec`. Brainstorm the first piste before writing anything, and
      build on the spec approval record rather than beside it.
- [ ] **Prune follow-ups, from the first real `--all --dry-run` (2026-10-04).** The author keeps
      every archived run until phax-cockpit is up. Of `~/.phax/archive` (phax namespace), ~70 GB are
      archived worktrees and 0.3 GB the run folders the cockpit reads; `phax/records/v1` holds
      per-phase files only, not the run-level ones. Ideas: a lighter step that frees an archived
      run's worktrees but keeps its run folder and entry; the run-level files in the records;
      prune recognising a commit already on main under another hash (`git cherry`); a compact
      branch list and a dry-run total line. One kept commit never landed: `48df09a8` (the
      diagnostics step must print `{ "diagnostics": [] }` on success) — restore that README
      sentence before any `--force`.
- [ ] **`phax autopilot` — the lifecycle driven in a loop from a corpus.** Raised 2026-09-15,
      captured in `docs/ideas/autopilot.md`. Explicitly after 1.0: a deterministic supervisor
      (not a master agent) over roadmap → spec → decide → plan → lint → approve → run → land →
      loop, framed by a frozen `autopilot.md`. Needs a roadmap artifact, a decision policy,
      budget/stop conditions and a machine-distinguishable approval. First target: the steme CLI
      from its corpus.
- [ ] **Library readiness, then local and cloud modes** — `docs/ideas/local-and-cloud-modes.md`
      (2026-09-22/23). After 1.0, beside autopilot. The consumption form is decided: a
      **library** (`app` + `ports` exported, adapter sets shipped by phax, the CLI one entry
      adapter among others), never a daemon, never the binary. Readiness checklist surveyed
      2026-09-23: `exports` and one barrel per layer with `knip` enforcing privacy; a single
      `LocalLive` composition root; **two missing ports — `Clock` and `Ids`, reusing Effect's
      `Clock`/`Random`**; **`app` modules importing `node:fs` directly, bypassing `FileSystem`**
      (fix first, then let the architectural guard forbid it); environment reads behind a host
      port; the file lock under a long-lived host; no exit-code mapping in `app`. Then the cloud
      adapter set.
- [ ] **Two gates on the change** — `docs/ideas/change-gates-from-the-harness.md` (2026-09-22): a
      per-phase reviewable-unit diff budget, and a `plans lint` rule refusing a phase that plans
      both a file and its oracle (with oracle files read-only to the phase session unless
      declared oracle-authoring). The second is what makes `review-as-plan` safe against an agent
      editing the test that judges it.
- [ ] Preview manifest — `phax.json` declares how to preview a finished run (per-project-type
      discriminated union: web / cli / lib). Write it when desktop work starts; nothing consumes
      it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md` until
      specs 21–24 land: by its own rule the desktop only wraps existing CLI surface. With 23 and
      24 parked, this is parked for as long as they are.

## Approved specs — parked

Specs 23 and 24 have been parked since 2026-08-14. Either can be planned at any time: start one
with `phax artifact new plan <slug> --spec <path>`, write it with the `phax-planning` skill and
run `phax plans lint` on it. Plan staleness is a property of the **plan**, so a spec parked here
does not rot; the plans written against it do.

- [ ] `docs/specs/2608091526-phase-decision-requests.md` — blocking agent-raised decision
      requests; answer-and-resume; decisions in the review handoff. Superseded in practice by
      the 2026-10-10 decision that a run stays autonomous (no phase stops to wait for a person;
      review notes are how a provider reaches one), so it stays parked rather than planned.
- [ ] `docs/specs/2608091526-batch-execution-disjoint-plans.md` — parallel disjoint plans,
      incremental ordered merge, terminal gate on the integration result, published as GitHub
      stacked PRs (`gh stack`) with a single-integration-PR fallback. The largest piece of work
      left; consumes 21 + 22.

### Approved plan with no active spec

- [ ] The smolvm isolation spike (`docs/plans/2606291247-smolvm-isolation-spike-plan.md`) was
      re-approved 2026-09-08, and its PR #60 is still open at phase 05. Resume it or abandon it.

### Housekeeping

- [ ] The louloupapers `phax.json` is pre-spec-15 and the CLI refuses to load there (registry
      sweep, 2026-09-04). Migrate it before running phax in louloupapers again (its two runs were
      archived from the phax repo by qualified name, followed by a manual `git worktree prune` in
      that repo — cross-project archive only prunes the current repo).

## Longer horizon (unspecced, revisit deliberately)

- [ ] **A Claude Code plugin for phax, after the 1.0 freeze.** Raised 2026-10-08. Ship phax's
      skills (`phax-planning`, `phax-spec`, the `phax-decide-*` skills) as one plugin instead of
      copies under `~/.claude/skills/`, with a small mod for the operator's interactive session:
      a pane with the live run (phases, gate attempts, a pause, the PR link, read from
      `~/.phax/runs`) and `/phax` commands that run without a model turn. Mods draw nothing in
      `claude -p`, so this is for the operator's session, not the phases. Distribution, in order:
      a `.claude-plugin/marketplace.json` in this repository (`claude plugin marketplace add
      lbdremy/phax`); then Anthropic's directory through the developer portal
      (`claude.ai/directory/manage`, paid plan, reviewed); and a hint from `phax init` to install
      it. Docs: `https://code.claude.com/docs/en/plugins/publish`.

Reading of the data-engineering article, second pass (2026-08-10): phax already sits on the
right side of lesson 1 (deterministic orchestration, probabilistic nodes) and lesson 2
(extract/transform/load separated; the handoff "loaded" by one phase is the context "extracted"
by the next); spec 22 *is* lesson 3 applied. The gaps it named, updated 2026-08-21: the durable
context layer's substrate exists (run records travel on `phax/records/v1`), so the remaining gap
is the *consumer*, not the storage; the plan DAG is analyzed but not executed (spec 24); and
staleness propagation stops at one hop.

- [ ] Cross-run durable context layer — feed phax's registered providers from phax's own run
      history (handoffs, deviations, final reports) instead of leaving the archive a filing
      cabinet. The record travels, so the layer can be **shared, not local**. The raw material
      that already exists and is still unread is the per-phase `verifiedSurfaces` manifest field.
      The plan auditor could read the same history.
- [ ] Staleness propagation depth — spec 22 stops deliberately at one hop (spec → plan). The
      same record/fingerprint/footprint mechanism could later cover any derived artifact
      (reviews, reports, generated docs).
- [ ] Desktop as role-shaped interfaces, not an augmented chat — one interface per participant
      over the intention↔evidence graph: approval screen showing what the approval commits to
      (ground, footprint, dependents), staleness dashboard (spec 22), run inspection (run records
      as raw material).
- [ ] Derived spec views — regenerate a readable spec from the E2E tests on demand (a computed
      report, never a maintained file).
- [ ] Raise-and-continue "assumption" variant for decision requests — excluded from spec 23 v1 on
      purpose; revisit only if real runs show over-blocking.
