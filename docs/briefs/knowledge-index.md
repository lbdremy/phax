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

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Name `$schema` URLs at the release this ships in. Fixtures and names in examples are made up.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
