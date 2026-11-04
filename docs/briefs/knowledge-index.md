Write the phax spec "Knowledge index", its first milestone: a local index. phax builds, from what a repository and its runs already hold, a local database an agent or the operator queries — the briefs, specs and plans with their questions and arbitrations, the runs with their phases, gates, costs and reviews, and the records — instead of searching files with grep. The index is a projection: it is rebuilt from its sources, holds nothing they do not, and can be deleted without loss.

**Why.** The operator, 2026-11-03. Everything phax produces accumulates in Git (briefs, specs, plans and their sidecars, the records on `phax/records/v1`) and under `~/.phax` (run folders, archives, cost ledgers, telemetry). That is the knowledge of the project: which questions were already decided and what each decision abandoned, what a run cost by model and effort, which review defects came from the plan and which from the execution. Today it is reachable by grep and by reading files one by one. The table "Model policy tracking" in `NEXT_STEPS.md` is such a query, kept by hand. An agent about to open a question cannot ask which arbitrations already settled one like it.

**Settled by the operator (do not reopen):**
1. **Git stays the source of truth.** The index is derived and rebuildable: one command rebuilds it from its sources, and nothing is written to the index that is not read from them. No record, decision or run state lives only in the index.
2. **Local first, a command line.** The first milestone is a local index queried through the command line, answering versioned JSON like every phax command (spec `command-contracts`, its prerequisite). Locally, an agent calls the command; no server, no MCP.
3. **Structure before similarity.** The index is SQLite: tables from phax's published formats (`@lbdremy/phax-schemas`), queried in SQL, with full-text search (FTS5) over the Markdown bodies. No embeddings in this milestone: the corpus is small and structured, and an agent searching with structure and grep does well. Vector search may come later in the same file.
4. **phax stays without network.** Building and querying the index reads local files and Git refs only.
5. **Readers of every shape.** The index reads every release's shapes of the formats it holds, through the readers phax already has for older shapes; a format it cannot read is reported, not skipped silently.

**The second milestone, recorded here and out of this spec's scope:** a shared service, a separate product phax does not depend on. It keeps a read-only mirror of a team's repositories and their `phax/records/v1` branches, rebuilds the same index, and exposes it as a remote MCP server with authentication, so the whole team's work can be queried, including from clients with no shell (claude.ai, the desktop app, the Claude Code mod). This is where MCP makes sense: the commands' contracts (`--json-schema`, in MCP's input and output schema shape) give its tools. Its open subjects are who may read what (records hold transcripts), how fresh the mirror is (webhook or periodic fetch), and several repositories per team (keyed by `namespace`). It is the web cockpit's ground (`docs/ideas/desktop-app.md`).

**What exists (read it first):**
- `packages/schemas/` and `src/schemas/`: every published format, its current shape and its history readers;
- the spec and plan sidecars under `docs/specs/` and `docs/plans/` (and their `archive/`), the briefs under `docs/briefs/`;
- the records branch `phax/records/v1` and `phax records explain` (authoring, decision, run and gate-attempt records);
- `~/.phax/runs/`, `~/.phax/archive/`, `~/.phax/cost-ledgers/`, the telemetry files, and `phax ls --json`;
- the spec `command-contracts` (Approved): how a command declares its input, output and errors, and answers `--json`;
- `NEXT_STEPS.md`'s "Model policy tracking" table, the query the index should make trivial.

**Questions for the spec to settle or open in §9:**
- the command's name and place (a `phax` command family, or a separate binary reading phax's formats);
- where the index file lives (per repository, under `~/.phax`) and when it is rebuilt (on demand, incrementally from Git refs, after each phax transition);
- the query surface: raw read-only SQL, named queries with contracts, or both; what a named query answers;
- what is indexed from `~/.phax` (only this repository's runs? archives? telemetry?) and what is never indexed (transcripts' content);
- how an agent learns the tables (a published schema of the index, `--json-schema`).

**Out of scope:**
- the shared service and its MCP server (second milestone above);
- embeddings and vector search;
- writing anything back to Git or to `~/.phax`.

**What it is for: the questions, who asks them, and when** (operator, 2026-11-04; literature review: `spikes/harness-data/records-questions-literature.md`). The literature finds no evidence that stored transcripts or metrics dashboards get consulted; what pays is a question asked at a decision point. In solo use the main consumer is not the operator at a screen but phax and its agents: the index is dynamic feed-forward for the harness (`docs/ideas/harness-from-records.md`). Each use below is an **experiment**, expected to pay cumulatively, not on day one:
1. **Prior arbitrations, for spec and plan authoring.** Before writing its open questions, the authoring agent asks which questions like this one were already settled, what was chosen, what each option abandoned, and why (the operator's own verdicts and the decide sessions'). Nothing else found in the literature records the abandoned option; LLMs recover expert design rationale with ~0.27 precision, so it has to be written, not reconstructed.
2. **History for a phase agent when the plan lacks detail.** Read-only, cited by id, never overriding the plan; runs stay autonomous.
3. **Escapes, to learn the doctrine and stop repeating errors.** Join review findings (lens, escape — why the tests missed it), the tests that missed, and the finding's fate (fixed by which commit, or dismissed and why). The authoring and planning agents ask "last time a test like this missed, what did the better test look like?". With steme, each recurring escape is a candidate for a test pattern or a new steme guarantee; recurrence is the signal to promote it.
4. **Cost of an accepted change** across the lifecycle, failed and abandoned attempts included, and `plans estimate` calibrated against actuals. On phax's records (≈$2,345 API-list): phases 63%, plan authoring 15%, handoff generation 8%, spec authoring 5%, fix attempts 3%, compliance 3%, decide 3%.
5. **Gate failures by step, model and effort**, to tune routing defaults and gate profiles — a sanity check, not a leaderboard (the plan picks the model for the task, so comparisons are confounded).
6. **Planned vs touched files.** 44% of phases deviate from their plan's file list, mostly unplanned edits (108 of 317): the planner could ask which files similar phases actually touched.
7. **The audit chain per commit** (approved spec and plan → gate evidence → approval → security posture): the obvious query, most valuable for teams and regulated users.

**Data gap to close first.** A review finding has no stable id and no recorded fate: review fixes land as `Short-Name` commits with no link to the finding they address. Use 3 needs a finding id and a disposition (fixed by commit, dismissed with a reason).

**Measuring the experiments.** For each named query: is it called, is its answer cited in what the agent writes (a prior decision id in a §9, an escape id in a test strategy), and does the outcome move over time (fewer departed verdicts, fewer findings of an already-seen escape class, estimates closer to actuals). Record which index version and query answered, so the effect can be attributed.

**Traps (non-goals):** "how much faster am I" (no counterfactual in the records); "% of code written by AI" as a measure; cross-model leaderboards from one's own runs; per-person scores; LLM-judged severity or lens taken as ground truth; standing dashboards; indexing raw transcript content (secrets in tool output become searchable — index derived fields only).

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Name `$schema` URLs at the release this ships in. Fixtures and names in examples are made up.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
