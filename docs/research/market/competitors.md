# Few rivals gate agent work by program

> Checked on 2026-11-25 against phax 0.43.0 (`package.json`; latest tag `v0.42.0`). Ids in square brackets
> resolve to the files under [`evidence/`](evidence/): `E-…` is an evidence item in the notes, `C-nn` is a claim in
> [`claims.md`](claims.md). Nothing here comes from outside those notes. "Not found" means not found in the sources
> opened on that day; it is never proof of absence. Quotes marked *(extracted)* were read through a fetch tool's
> extraction and must be re-checked on the page before they are published verbatim.

No tool opened does all of what phax does, and many do one part of it with far more users [C-33] [C-10]. The notes
compare over a hundred tools and platforms in four clusters. Most of them leave "done" to the agent's own statement, to a second
model's opinion or to a person reading a diff [C-01] [C-02] [C-03] [C-06]. A small group lets a program sequence the
work and run real commands as conditions: BMad Loop, zeroshot, Archon, Bernstein, Fabro, Goose recipes, GitHub Spec
Kit's workflow engine and Amazon's Kiro [C-04]. In all of them except BMad Loop the gate exists only where the
workflow's author declares one [C-04]. Anthropic and OpenAI ship the building blocks natively (hooks, a `/goal`
evaluator, scripted workflows, review agents), all opt-in or advisory, all inside one vendor [C-05] [C-18] [C-19].
Four things phax ships were **not found in any tool opened**: a program that compares the files a plan declared with
the files a phase touched, a plan status that goes stale with a recorded approval, a cost estimate of a plan before
it runs, and gate results kept per phase on a branch of the user's own Git [C-22] [C-23] [C-26] [C-27]. The
unfavourable side is as plain: the nearest neighbours have between 193 and 151,322 GitHub stars, phax has 2 and one
operator [E-SDD-28] [E-SDD-01] [E-PHAX-115] [E-PHAX-92]. The 2026 market punished independent tools whose value was
parallel sessions, and funded tools whose value is verification or records [C-30] [C-32].

Throughout, phax's capabilities carry their status from `evidence/phax-capabilities.md`: **shipped**, **approved**
(an approved spec or plan whose run has not merged), **brief** (no spec yet) or **idea**. The operator asked for
briefs to be counted as done; they are counted, and marked.

## The landscape falls into five clusters

| Cluster | Who is in it | Adoption evidence (read 2026-11-25) | What verifies the work | Relation to phax |
| --- | --- | --- | --- | --- |
| Spec-driven tools | Spec Kit, OpenSpec, Kiro, BMAD-METHOD, Superpowers, GSD Core, cc-sdd, Task Master, Agent OS, Tessl, Traycer, Zenflow, Augment Intent | Superpowers 326,110 stars; Spec Kit 151,322; OpenSpec 75,678 and 5.66 million npm downloads in 30 days; BMAD 55,713 [E-SDD-39] [E-SDD-01] [E-SDD-09] [E-SDD-10] [E-SDD-26] | A model's judgment or a person, advisory; a program only for document structure [C-01] | Substitute for the author moment; direct competitor only where a runner was added (Spec Kit workflows, BMad Loop, Kiro) |
| Local runners and loop tools | Session managers (Conductor, Vibe Kanban, Claude Squad, Emdash, Paradev…), Ralph loops, swarm frameworks (Gas Town, ruflo), workflow engines (Archon, zeroshot, Fabro, Goose recipes, Bernstein) | Vibe Kanban 28,812 stars; ruflo 82,394; Archon 23,995; zeroshot 2,227; Fabro 1,891; Bernstein about 1,200 [E-ORCH-01] [E-AGT-76] | A person reading a diff (session managers); the agent's own completion string (Ralph); a program, if declared (engines) [C-02] [C-03] [C-04] | Engines are direct competitors; session managers and loops are substitutes |
| Vendor and cloud platforms | Anthropic (Claude Code, Claude Ship, Managed Agents), OpenAI Codex, GitHub Copilot cloud agent, Cursor, Google Antigravity, Devin, Factory, Kiro, GitLab Duo, Warp Oz and others | Vendor-claimed: Codex over 5 million weekly users (June 2026); Claude Code over $2.5 billion run-rate (February 2026); Cursor over $4 billion on one unnamed source [E-PLAT-37] [E-MKT-02] [E-MKT-05] | User-written hooks, repository CI, a second model, a person at the pull request [C-05] [C-06] | Substitutes with the distribution; also the providers phax runs on |
| Review, provenance and guardrail layer | CodeRabbit, Greptile, Qodo, Copilot code review, Bugbot; Entire, git-ai, Agent Trace, SpecStory; sandbox-runtime, Semgrep Guardian, Snyk, Socket, Sonar | CodeRabbit $143 million Series C; Entire $60 million seed; Qodo $70 million; Copilot review on "more than one in five" GitHub reviews (vendor telemetry) [E-VER-02] [E-VER-30] [E-VER-13] [E-VER-15] | A model's comments (review); nothing (provenance records only); a program at the edges (sandboxes, scanners) [C-06] [C-07] [C-08] | Mostly complements; Entire competes on the record |
| In-house systems | Stripe Minions, Spotify's background agent, OpenAI's harness team, Anthropic's long-running harnesses, Ramp Inspect, StrongDM | Company self-reports: Stripe over 1,300 merged pull requests a week; Spotify over 1,500 merged by November 2025 [E-ORCH-73] [E-ORCH-74] | Stripe and Spotify: deterministic commands before the pull request, bounded retries, a person at the end [C-09] | Reference point, not a competitor |

### Spec-driven tools let the agent drive and a model judge

The most-adopted spec-driven tools are packs of prompts and skills. The coding agent runs itself through them, and the
tool's own program checks at most the structure of a document [C-01]. Spec Kit's manual flow tells the user to run its
skills "in your agent's chat, not your terminal, one at a time, reviewing each result before continuing"
[E-SDD-02]. OpenSpec's `validate` checks specs for structural issues; its implementation check is a skill run by the
model that "does not block archive" [E-SDD-12] [E-SDD-14]. Superpowers instructs the model in capitals to run the
command and check the exit code, and its own README admits sessions where "the agent ignores its plan, repeats work,
or burns more tokens than you'd expect" [E-SDD-40] [E-SDD-39].

This cluster holds the adoption. Superpowers has 326,110 stars, Spec Kit 151,322, OpenSpec 75,678 [E-SDD-39]
[E-SDD-01] [E-SDD-09]. OpenSpec's npm downloads rose from 32,892 in November 2025 to 3,925,435 in October 2026; the
figure includes automated installs and is not a user count [E-SDD-10]. Thoughtworks moved OpenSpec from Assess to
Trial in November 2026 because "several of our teams have reported success with it" [E-SDD-65]. Smaller packs
faded in the same period: Task Master fell from 179,833 to 60,210 monthly downloads with no release since March 2026,
and the original GSD repository was left for a successor [E-SDD-34] [E-SDD-36] [E-SDD-37].

During 2026 three projects in this cluster added a runner outside the model. Spec Kit's workflow engine arrived in
April 2026 [E-SDD-05]. BMad Loop was created on 2026-06-19 [E-SDD-28]. Kiro's runtime executes workflow graphs
[E-SDD-20]. Those three are in the shortlist below. The independent criticism of the cluster is review burden from
generated Markdown and agents that do not follow it [E-SDD-62] [E-SDD-69] [E-SDD-64] [E-SDD-66]; the two most-quoted
hands-on reviews date from October and November 2025 and are older than twelve months, so they describe earlier
versions of the tools.

### Local runners mostly stop at a person reading a diff

The largest group here manages parallel sessions in Git worktrees: Conductor, Vibe Kanban, Claude Squad, Nimbalyst,
Emdash Classic, Paradev, cmux, Happy, Xum, Parallel Code. None documents a command that the tool runs and that must
pass before the work is accepted; the acceptance step is a person reading a diff or a pull request [C-02]. In the
Ralph family a script loops deterministically, but "done" is what the agent says: one tool greps the output for a
completion string, another waits for the agent's own exit signal, a third reads an evidence string the agent writes
[C-03] [E-ORCH-22] [E-ORCH-23] [E-ORCH-25]. Swarm frameworks put a lead model in charge; the README of the largest,
ruflo, tells the person to ask the agent to "report the test command and result" and to review the diff
[E-ORCH-41].

A smaller group lets deterministic code sequence the work and run real commands as conditions: Archon, zeroshot, Fabro
and Goose recipes, plus Bernstein, which the agent-delegation notes found [C-04] [E-AGT-76]. These are phax's direct
competitors. They are small next to the packs: Fabro 1,891 stars, zeroshot 2,227, Bernstein about 1,200; Archon, at
23,995, is the exception [C-10]. Stars are a weak proxy for use.

### Vendor platforms offer gates as hooks the user writes

Every major vendor now ships isolated cloud execution for delegated tasks, so isolation alone no longer sets a tool
apart [E-PLAT-04] [E-PLAT-34] [E-PLAT-40] [E-PLAT-50]. In the documentation opened, no platform makes "the project's
own gate commands exit 0" a built-in condition for the agent to declare a task done [C-05]. Deterministic gates are
hooks the user writes (Claude Code, Codex) or the repository's CI and branch rules [E-PLAT-07] [E-PLAT-31]
[E-PLAT-27]. A Claude Code Stop hook is not absolute: the product overrides it "after it blocks eight times in a row
with no tool call from Claude in between" [E-PLAT-07]. This is an absence claim bounded by the pages read; the notes
ask for a second pass on Claude Code hooks, Codex cloud "checks before publishing" and Factory's validation contract
before it is treated as firm (Gaps, `competitors-vendor-platforms.md`).

The strongest platform-enforced controls found are GitHub's: the Copilot cloud agent cannot mark its pull request
ready, approve it or merge it, and the person who asked cannot approve it [E-PLAT-41]. They enforce a human review,
not a test result or conformance to a plan [E-PLAT-41]. Cursor moved one step towards enforced checks on 2026-11-05,
for app publishing only: "Nothing goes live until the checks pass and you explicitly publish" *(extracted)*
[E-PLAT-49].

### The review and provenance layer covers one part each

AI pull-request reviewers read a diff and post comments. Copilot, Claude Code Review, Codex and Bugbot each state
that a review does not block a merge unless the user opts into a further setting [C-06] [E-VER-14] [E-VER-19]
[E-VER-23] [E-VER-08]. None is documented as running the project's typecheck, tests or lint; Anthropic says its
review works "without building or running your code" [E-PLAT-02]. There is no trusted common benchmark: one tool
scored 82% recall in its own test and 45% when a competitor reran it [E-VER-04]. These tools are complements to phax
on the pull request it opens; phax's own code review is one more model reviewer, and nothing in the notes shows it is
better than theirs.

Provenance tools record the work and do not gate a commit. Entire stores "the prompts, transcript, and files touched" as Git refs on
the user's remote, linked to the commit by a trailer [E-VER-31]. Its docs, re-read on 2026-11-25 for the
[comparison page](../../comparisons/entire-vs-phax.md), show that its hosted Trails also gate merges on review findings, approvals and CI checks. git-ai stores line-level attribution in Git Notes
[E-VER-36]. Agent Trace is a specification at version 0.1.0 that leaves storage undefined and excludes any judgment
of quality [E-VER-33]. The formats do not agree with each other [C-07]. Guardrail products enforce by program at the
edges (operating-system sandboxes, microVMs, egress proxies, install-time firewalls, static-analysis gates) and could
run as a phax gate step or beneath a phax security mode; the notes mark that last reading as an inference [C-08]
[E-VER-54] [E-VER-61] [E-VER-65].

### The two most detailed in-house systems share phax's shape

Stripe and Spotify publish the most detail on verification. Both put deterministic commands between the agent and the
pull request, bound the retries and keep a person's review at the end [C-09]. Stripe's blueprints mix agent nodes with
nodes that "don't invoke an LLM at all", loop on a lint node locally, allow "at most two rounds of CI" and then send
the branch back to a person *(extracted)* [E-ORCH-72] [E-ORCH-73]. At Spotify, deterministic verifiers run before a
pull request may open, "The agent doesn't know what the verification does and how", and a model judge then vetoes
about a quarter of sessions for going beyond the prompt *(extracted)* [E-ORCH-75]. That is the shape phax ships:
program-run gates [E-PHAX-20], a bounded fix loop [E-PHAX-18], a scope check [E-PHAX-18] and a run that ends open for
review [E-PHAX-03].

Other teams go the other way on the person. OpenAI's harness team pushed review "agent-to-agent" and StrongDM forbids
human review of code [E-ORCH-78] [E-ORCH-80]. The reference point therefore supports phax's mechanics more firmly than
it supports phax's insistence on a person at the end [C-09].

## The eleven closest, ranked by overlap with phax

The rank is by how much of phax's shipped set a tool also covers: a program that sequences, a gate a program
enforces, a scope check, a judge apart from the maker, findings with fates, records, cost, several vendors, a
machine-readable answer. It is not a rank by threat; `market-fit.md` ranks threats, and there the vendors come first. The rows rest on
[C-11] (BMad Loop), [C-12] (zeroshot), [C-13] (Archon), [C-14] (Bernstein), [C-15] (Fabro), [C-16] (Spec Kit's
engine), [C-17] (Kiro), [C-18] (Anthropic), [C-19] (Codex), [C-20] (Entire) and [C-21] (Goose recipes).

| # | Tool | Relation | What it has that phax lacks | What phax has that it lacks | How well it was read |
| --- | --- | --- | --- | --- | --- |
| 1 | **BMad Loop** (beta, 193 stars, created 2026-06-19) [E-SDD-28] | Direct competitor | Detached runs when started from its terminal UI (corrected 2026-11-25, see the [comparison page](../../comparisons/bmad-loop-vs-phax.md); phax: **brief** `run-detach` [E-PHAX-72]); token budgets with `warn` and `enforce` (a cap was not found in phax's inventory); six agent CLIs mixable per stage; a terminal UI [E-SDD-28] | Planned-versus-touched reconciliation (BMad Loop checks only "that code actually changed"); a worktree per phase by default (optional there); records on a Git branch (per-machine state there); approval with staleness; acceptance phases; a pre-run estimate; use outside a BMAD project [E-SDD-28] [E-PHAX-18] [E-PHAX-39] [E-PHAX-08] [E-PHAX-27] [E-PHAX-13] | README only; no independent review found |
| 2 | **zeroshot** (2,227 stars, v17.1.1 on 2026-11-22) [E-ORCH-01] [E-ORCH-66] | Direct competitor; nearest in positioning | Parallel nodes (phax: **brief** `phase-graph`); a JSON-RPC API with an OpenRPC spec, a Python SDK and resumable event streams (phax: **brief** `run-detach`); Copilot CLI and Pi as agents; a hosted platform; a published benchmark (vendor-run) [E-ORCH-66] [E-ORCH-68] | A gate that always runs (script steps are declared there, reviewers are agents); worktree isolation, file-level reconciliation and cost tracking (not found); records in Git (one SQLite file per run there); finding fates; approval lifecycle [E-ORCH-66] [E-ORCH-67] | README and docs, raw |
| 3 | **Archon** (23,995 stars, v0.14.0 on 2026-11-07) [E-ORCH-01] [E-ORCH-63] | Direct competitor; the largest | Adoption; parallel runs; human-wait and child-workflow nodes; a merge queue gated on review verdict and CI; cost of every run in a database; a server; a skill by which an agent delegates to it [E-ORCH-63] | A gate that is not opt-in (`until_bash` is declared per loop there); reconciliation and a test-first judge (not found); records in Git; plan lifecycle; finding fates; a pre-run estimate [E-ORCH-63] | README, raw; behaviour in practice not checked |
| 4 | **Bernstein** (about 1,200 stars) [E-AGT-76] | Direct competitor, agent-facing | Parallel agents under "a deterministic scheduler - no model in the coordination loop"; a shipped MCP config; Gemini CLI [E-AGT-76] | Not established. Whether Bernstein blocks a commit on a failing gate in phax's sense was not verified | README excerpt only; thin |
| 5 | **Fabro** (1,891 stars; last release 2026-06-04, last push 2026-11-23) [E-ORCH-01] [E-ORCH-69] | Direct competitor, server-shaped | Per-stage Git checkpoints of file changes (execution state lives in its server's run store: corrected 2026-11-25, see the [comparison page](../../comparisons/fabro-vs-phax.md)); a REST API with event streaming and a web UI; parallel fan-out; cloud sandboxes; per-node model routing [E-ORCH-69] | A gate by default (command nodes are declared there); reconciliation (not found); no server to run; a cost ledger (not found); finding fates; plan lifecycle [E-ORCH-69] | README, raw |
| 6 | **Spec Kit workflow engine** (since April 2026; 151,322 stars for Spec Kit) [E-SDD-05] [E-SDD-01] | Substitute moving towards competitor | Adoption and GitHub's ownership; many agent integrations; an extension catalog; fan-out with `max_concurrency`; a 1.x line since 2026-08-21 [E-SDD-01] [E-SDD-02] [E-SDD-04] | A test gate that ships on (the bundled workflow's gates are human review gates; exit-code steps are the author's to add); isolation, reconciliation, cost and finding ids (not found) [E-SDD-03] [E-SDD-04] | Docs, direct |
| 7 | **Kiro** (Amazon; proprietary; $0 to $200 a month) [E-SDD-16] | Substitute; broadest proprietary overlap | IDE, web, mobile and CLI surfaces; cloud sandboxes, ten concurrent; generated property-based tests (IDE only); parallel task waves; hooks that deny tool calls [E-SDD-17] [E-SDD-18] [E-SDD-19] [E-SDD-22] [E-PLAT-76] | Open source; running on the agent CLI and subscription the user already has (Kiro's terms forbid "third-party automation harnesses"); project gates as a fixed condition; reconciliation, a per-phase record and a status vocabulary (not found) [E-SDD-16] [E-SDD-17] | Docs, direct; adoption figures not published |
| 8 | **Anthropic's native chain** (hooks, `/goal`, dynamic workflows, `/ship`, Code Review, PR Steward, Claude Approvals) | Substitute, and phax's main provider | Distribution; cloud sessions; five ways to parallelise; scheduled and event triggers; a per-path approval policy in the repository; a budget cap flag [E-ORCH-27] [E-PLAT-03] [E-PLAT-09] [E-ORCH-33] | Gates on by default (hooks are opt-in, the Stop hook yields after eight blocks); a program-run verdict (`/goal` and Code Review are judged by a model; Approvals "can't read CI results"); several vendors; reconciliation and per-phase records (not found); availability on any plan (Claude Ship needs Team or Enterprise) [E-PLAT-07] [E-ORCH-30] [E-PLAT-09] [E-PLAT-10] | Docs, raw; changelog after mid-September 2026 not read |
| 9 | **OpenAI Codex's equivalents** (hooks, `/goal`, `codex exec --json`, cloud tasks, GitHub review, Symphony) | Substitute, and a phax provider | Cloud tasks; subagents on by default; an operating-system sandbox; a JSONL event stream and `--output-schema`; Symphony's "proof of work" [E-ORCH-36] [E-ORCH-37] [E-PLAT-30] [E-ORCH-40] | The same list as for Anthropic: no built-in gate found; review "flags only P0 and P1 issues" and does not "replace tests, branch protections, or required approvals" [E-ORCH-38] [E-PLAT-27] | Docs; subagent page through an extraction |
| 10 | **Entire** (MIT CLI, about 5,400 stars, $60 million seed) [E-VER-31] [E-VER-30] | Competitor on the record; its hosted layer also gates merges | Capture of every session in the repository, not only runs (phax records only its own runs, by choice [E-PHAX-108]); eight or more agents; hosted views; funding [E-VER-31] | A gate before a commit, reconciliation, findings with fates, a cost ledger: its README describes none [E-VER-31]. Its hosted Trails do gate merges (corrected 2026-11-25, see the [comparison page](../../comparisons/entire-vs-phax.md)) | README, then its docs for the comparison page |
| 11 | **Goose recipes** (Goose: 56,970 stars) [E-ORCH-01] [E-ORCH-47] | Partial competitor | Shell `checks` that "must exit with code 0 for success" with bounded retries, under a widely used agent; a `json_schema` for the answer [E-ORCH-47] | Worktree isolation, a review surface, per-run records (not found); subrecipes are still experimental [E-ORCH-47] | One docs page |

**BMad Loop** is the closest documented overlap [C-11]. "Plain Python drives the loop", with "No LLM in the control
loop"; the tool runs the project's `[verify]` commands before it commits, feeds a failure to a fix session, never
accepts completion "on model prose", reviews in a separate fresh session "optionally on a different CLI or model",
keeps a ledger of deferred work with `DW-<n>` ids, and answers `--json` with exit codes [E-SDD-28]. It is an early
beta that warns of "breaking changes in any pre-1.0 release", is tied to BMAD projects, isolates in a worktree only on
request and keeps run state per machine [E-SDD-28]. BMAD-METHOD, its parent, has 55,713 stars and lists the loop as
a module, which is a distribution channel phax does not have [E-SDD-26] [E-SDD-27].

**zeroshot** makes phax's promise in almost phax's words: "A multi-agent orchestration engine that keeps coding
agents from grading their own work" [E-ORCH-66]. A JSON graph "the engine enforces" fixes who writes, who reviews
and what must pass; plans are Markdown with acceptance criteria that each name a `Check:` [E-ORCH-66] [E-ORCH-67].
Its judges are mostly reviewer agents returning an enum verdict; phax's first judge is the project's gate [C-12].
Its benchmark (a builder plus a fresh checker passing 69.5% of hidden tests against 65.6% for a larger model's single
shot, at a median 58% of the cost) is vendor-run, on 20 tasks and one model family, and not replicated [E-ORCH-68].

**Archon** shows that this design can find users [C-13]: 23,995 stars for a tool whose README says "The workflow fixes
the steps, the checks and the gates. The agent supplies the judgment inside each step" [E-ORCH-63]. Its claim that
Archon runs built 363 of the 524 pull requests merged into its repository in nineteen days is vendor-claimed
[E-ORCH-63].

**Anthropic's native chain** overlaps in pieces [C-18]. Claude Ship takes a pull request "through review, fixes,
and an approval decision" with a policy file in the repository [E-PLAT-10]. Anthropic's own docs state its limits:
a review "doesn't approve or block the pull request", the Approvals check blocks a merge "only where you make it a
required check in GitHub", and with `seats: 0` "a pull request that a bot wrote can merge when no person has looked
at it" [E-PLAT-02] [E-PLAT-09]. What was not found natively is a spec or plan with recorded approvals, per-phase
gate commands that must exit 0 before a commit, reconciliation, or a per-phase record on a Git branch [E-SDD-44]
[E-SDD-45] [E-SDD-47]. The launch dates of Claude Ship's parts are unknown here; the pages were read as live on
2026-11-25.

## One table on fixed axes

"nf" means not found in the sources opened. "(vc)" means vendor-claimed. The phax row gives each capability's status.

| Tool | Who sequences the work | Gate enforced by a program | Planned-vs-touched reconciliation | Maker and judge apart | Findings with fates | Records in the user's Git | Cost ledger or estimate | Several vendors | Agent-callable versioned JSON | Adoption |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **phax** | The CLI, phase by phase (shipped); parallel phases are a **brief** [E-PHAX-18] [E-PHAX-73] | Yes, always: project gate, bounded fix loop (shipped) [E-PHAX-20] | Yes (shipped) [E-PHAX-18] | Acceptance phases judged by a program the project configures; read-only model reviews (shipped) [E-PHAX-27] [E-PHAX-35] | Ids and `fix`, `dismiss`, `defer` (shipped, 0.40.0) [E-PHAX-37] | Per-phase record on `phax/records/v1` (shipped) [E-PHAX-39] | Ledger per run, Claude Code only; estimate before a run (shipped) [E-PHAX-40] [E-PHAX-13] | Claude Code, Codex, Mistral Vibe; Claude is the tested path [E-PHAX-30] [E-PHAX-68] | `--json` on every command, `$schema` on published documents, `--json-schema` contracts (shipped; no freeze before 1.0) [E-PHAX-45] [E-PHAX-46] [E-PHAX-68] | 2 stars, 2 forks, one operator [E-PHAX-115] [E-PHAX-92] |
| BMad Loop | Python loop [E-SDD-28] | Yes once `[verify]` is configured [E-SDD-28] | Partial: non-empty diff [E-SDD-28] | Separate review session, other CLI possible [E-SDD-28] | `DW-<n>` ledger with triage [E-SDD-28] | No: per-machine state [E-SDD-28] | Token budgets; estimate nf [E-SDD-28] | Six CLIs [E-SDD-28] | `--json`, exit codes; versioning nf [E-SDD-28] | 193 stars [E-SDD-28] |
| zeroshot | Graph engine [E-ORCH-66] | If declared: script steps, CI before merge [E-ORCH-66] | Scope judged by verifier agents; file-level nf [E-ORCH-67] | Yes: independent reviewer sessions [E-ORCH-66] | Enum verdicts; ledger nf [E-ORCH-66] | No: SQLite per run [E-ORCH-66] | nf | Claude Code, Codex, Copilot CLI, Pi [E-ORCH-66] | JSON CLI, JSON-RPC with OpenRPC [E-ORCH-66] | 2,227 stars [E-ORCH-01] |
| Archon | YAML engine [E-ORCH-63] | If declared: `until_bash`; merge gate on CI [E-ORCH-63] | nf | Review node, approval node [E-ORCH-63] | nf | No: database [E-ORCH-63] | Per run, after the fact [E-ORCH-63] | Claude Code, Codex, Pi [E-ORCH-63] | CLI and a skill; schema nf [E-ORCH-63] | 23,995 stars [E-ORCH-01] |
| Bernstein | Deterministic scheduler [E-AGT-76] | "merge gates"; blocking not verified [E-AGT-76] | nf | nf | nf | "replayable record"; location nf [E-AGT-76] | nf | Claude Code, Codex, Gemini CLI [E-AGT-76] | Skill and MCP config [E-AGT-76] | About 1,200 stars [E-AGT-76] |
| Fabro | DOT graph engine [E-ORCH-69] | If declared: command nodes [E-ORCH-69] | nf | Cross-model critique, model judge [E-ORCH-69] | nf | File changes per stage on a run branch; execution state in its server's store (corrected 2026-11-25) [E-ORCH-69] | Routing to cut cost; ledger nf [E-ORCH-69] | Per node [E-ORCH-69] | REST and SSE [E-ORCH-69] | 1,891 stars [E-ORCH-01] |
| Spec Kit workflows | `specify workflow run` [E-SDD-03] | If authored: non-zero exit halts [E-SDD-04] | nf | Human gates in the bundled workflow [E-SDD-03] | nf | `state.json` and a log per run in the working tree [E-SDD-04] | nf | Agent CLI integrations [E-SDD-03] | JSON run and status interfaces [E-SDD-04] | 151,322 stars (Spec Kit) [E-SDD-01] |
| Kiro | Kiro runtime [E-SDD-20] | Configurable: hooks, evidence loops [E-SDD-19] [E-SDD-20] | nf | Fresh-session reviewer steps [E-SDD-20] | nf | Specs in the repo; session records vendor-side [E-PLAT-76] [E-SDD-22] | Credits view; estimate nf [E-SDD-16] | Kiro only, several models [E-SDD-16] | Headless CLI; versioned contract nf [E-SDD-21] | Not published [E-SDD-23] |
| Anthropic native | Model, lead agent or script [E-ORCH-28] | Opt-in hooks; Stop hook yields after 8 blocks [E-PLAT-07] | nf | `/goal` fresh-model evaluator; review agents [E-ORCH-30] [E-PLAT-02] | Respond or dismiss on the pull request; auto-resolved counts [E-SDD-47] [E-VER-19] | Policy file only; sessions vendor-side or local for about 30 days [E-PLAT-09] [E-PLAT-13] | `total_cost_usd`, budget cap [E-ORCH-33] | Claude only [E-ORCH-27] | `-p` JSON with a schema option [E-ORCH-33] | 156,993 stars on its issue repository [E-ORCH-01] |
| Codex | Model [E-ORCH-36] | Opt-in Stop hook [E-ORCH-38] | nf | Review agent, P0 and P1 only [E-PLAT-27] | nf | No: vendor cloud, session files [E-PLAT-35] [E-ORCH-37] | Token usage in `/status` [E-SDD-50] | OpenAI models [E-ORCH-36] | `codex exec --json` JSONL [E-ORCH-37] | 136,381 stars; over 5 million weekly users (vc) [E-SDD-50] [E-PLAT-37] |
| Entire | Does not sequence [E-VER-31] | None at commit; hosted merge gates on Trails (corrected 2026-11-25) [E-VER-31] | Records files touched; no plan [E-VER-31] | Not applicable | Not applicable | Yes: `refs/entire/checkpoints/…` [E-VER-31] | nf in the README [E-VER-31] | Eight or more agents [E-VER-31] | nf | About 5,400 stars [E-VER-31] |
| Goose recipes | Recipe and model [E-ORCH-47] | If declared: shell checks, bounded retries [E-ORCH-47] | nf | nf | nf | nf | unknown | "any LLM" [E-ORCH-47] | `json_schema` answer [E-ORCH-47] | 56,970 stars (Goose) [E-ORCH-01] |

Read down the columns. Sequencing by a program is no longer rare: ten of the twelve rows have it in some form [C-04].
A gate is common as an option and rare as a default [C-04] [C-05]. Reconciliation is empty in every row but phax's
[C-22]. Judging the maker apart is spreading, as a second model reviewing the first [C-24]. Records in the user's Git
exist in Entire (sessions) and Fabro (each stage's file changes), without gate results [C-26]. Several vendors and a JSON interface are ordinary [C-28]
[C-29]. The adoption column is the one where phax is last.

## What the 2026 events mean for a tool in phax's position

**Independent tools built on parallel sessions lost their company or their independence.** Bloop, maker of Vibe
Kanban, shut down on 2026-04-10: "we couldn't find a business model that we could get excited about", with thousands
of daily users of whom "the vast majority are free users" *(extracted)* [E-ORCH-03]. Meta acquired Conductor in
November 2026 and its cloud closed on 2026-11-20 [E-ORCH-13]; Conductor had raised a $22 million Series A in March
[E-MKT-80]. Crystal was deprecated in February, Roo Code shut down on 2026-05-15, Terragon published its code as a
snapshot "at the time of shutdown" on 2026-01-16, Charlie Labs says it is shutting down, and OpenAI announced the
acquisition of Ona [E-ORCH-05] [E-ORCH-60] [E-PLAT-92] [E-PLAT-94] [E-PLAT-38]. Cursor was acquired by SpaceX on
2026-08-14; Windsurf became Devin Desktop [E-PLAT-57] [E-PLAT-70]. Gas Town, the most publicised swarm tool, was
abandoned by its author, who "only ever wound up using it to build itself" *(extracted)* [E-ORCH-19]. That last
sentence also describes phax today [E-PHAX-92] [C-72].

**The vendors absorbed what those tools sold.** Claude Code documents five ways to parallelise, a plan mode, a
`/goal` evaluator, scripted workflows and a review-to-merge chain; Codex ships subagents, worktrees, cloud tasks and
Symphony; Antigravity added swarms and dynamic workflows in November 2026 [C-31] [E-ORCH-27] [E-ORCH-36] [E-PLAT-60].
Thoughtworks advises teams to "revisit native capabilities and re-evaluate the need for SDD tooling" [E-SDD-65].

**Money went to verification and records as layers of their own.** Qodo raised $70 million in March 2026 on the
thesis that "generating systems and verifying systems require very different approaches" *(extracted)*
[E-PLAT-96]. CodeRabbit raised $143 million in August and renamed itself a "control layer" [E-VER-02] [E-VER-03].
Entire raised $60 million at seed for session records in Git [E-VER-30]. These are investor bets, not proof of user
demand [C-32].

Deduction, resting on [C-30], [C-31] and [C-32]: for a tool in phax's position the events cut three ways. First,
whatever phax shares with session managers (worktrees, several providers, a pull request at the end) will be native
and free; phax's own draft announcement already concedes that "that part isn't new" [E-PHAX-94]. Second, the parts
no vendor was found to have absorbed are the ones a vendor has least reason to build: a gate the user's own commands
decide, across vendors, with the record kept outside the vendor's cloud [C-05] [C-26] [C-28]. The notes mark this
reading as an inference from feature lists [E-ORCH-27] [E-ORCH-36]. Third, a free local tool with no company behind
it cannot fail the way Bloop did, but it shares Bloop's finding: free users of a local tool are not a business
[E-ORCH-03] [C-66].

## What phax appears to be alone in doing

Each line is an absence in the sources opened, with the nearest thing found. None is proof that no tool does it; the
notes read READMEs and docs pages, not code.

| What phax does | Status in phax | Nearest thing found elsewhere | Claim |
| --- | --- | --- | --- |
| A program compares the files each phase declared with the files it changed, and the gap goes to the next prompt and the review | shipped [E-PHAX-18] | cc-sdd's `_Boundary:_` annotations, checked by a reviewer agent; BMad Loop's non-empty-diff check; zeroshot's "Out of scope" section judged by verifiers; Spotify's in-house model judge [E-SDD-42] [E-SDD-28] [E-ORCH-67] [E-ORCH-75] | [C-22] |
| A plan runs only if Approved and fresh; approval is recorded against a baseline commit and goes `Stale` when the ground changes | shipped [E-PHAX-08] [E-PHAX-19] | spec-workflow-mcp's approval workflow; Spec Kit's gate verdict inputs; OpenSpec's propose, apply, archive [E-SDD-43] [E-SDD-03] [E-SDD-12] | [C-23] |
| Tests written first by one phase, judged twice by a program the agent is never granted | shipped [E-PHAX-27] | Anthropic's "sprint contract" (the judge is a model); StrongDM's held-out scenarios; Kiro's generated property tests; zeroshot's `Check:` per criterion [E-ORCH-77] [E-ORCH-80] [E-SDD-18] [E-ORCH-67] | [C-24] |
| Every finding has an id given by the tool and a fate, including a deferral, written to Git | shipped [E-PHAX-37] | BMad Loop's `DW-<n>` ledger (per-machine state); Copilot's three resolution reasons; Bugbot's resolved or unresolved status [E-SDD-28] [E-VER-16] [E-VER-08] | [C-25] |
| Gate results, the surfaces they verified, the reconciliation and the handoff kept per phase on a branch of the user's Git | shipped [E-PHAX-39] | Fabro's per-stage commits of file changes; Entire's checkpoints [E-ORCH-69] [E-VER-31] | [C-26] |
| A cost estimate of a plan before it runs, with its fit in subscription windows | shipped; needs 60 sized phases of history [E-PHAX-13] | Ultrareview's estimated-cost dialog and GitHub Agentic Workflows' budget forecasting, each for one feature [E-PLAT-16] [E-PLAT-45] | [C-27] |
| A `$schema` on every persisted file and a contracts catalogue for every command | shipped; frozen only at 1.0 [E-PHAX-41] [E-PHAX-46] [E-PHAX-68] | OpenSpec's agent contract, with admitted key-casing inconsistencies; zeroshot's OpenRPC spec [E-SDD-13] [E-ORCH-66] | [C-29] |
| Mistral Vibe driven beside Claude Code and Codex | shipped, disabled until enabled; several jobs cannot reach Vibe [E-PHAX-30] [E-PHAX-79] | None of the cross-vendor layers found documents Vibe (low confidence, not searched exhaustively) [E-PLAT-84] [E-PLAT-88] | [C-28] |
| All of the above in one tool | shipped | Each neighbour covers one part: Entire the record, Copilot and Bugbot a finding status, Sonar and Semgrep a gate, Claude Approvals the approval policy [E-VER-31] [E-VER-16] [E-VER-65] [E-VER-21] | [C-33] |

Two cautions belong with this table. Being alone is not the same as being wanted; `market-fit.md` sorts these lines by
the evidence that anyone asks for them. And two small tools that advertise test gating or intent-conflict detection
were seen in listings only and never opened; they may be closer than their size suggests (Gaps,
`competitors-local-orchestrators.md`).

## Conclusion

The field has converged on phax's premise faster than on phax's mechanics. "Keep the agent from grading its own work"
is now a sentence in a competitor's README [E-ORCH-66], a Thoughtworks Trial blip asks for "a harness they've tested
to validate the changes instead of relying on human code review" [E-SDD-67], and the two best-documented in-house
systems run program gates before the pull request [C-09]. What differs is where the judgment sits. Nearly every
neighbour that separates maker from judge uses a second model; phax uses the project's own commands first and a model
second [C-24]. That is a real difference only for projects whose commands are worth trusting, a condition
`market.md` examines.

Deduction, resting on [C-04], [C-10] and [C-31]: the competitive question for phax is less "who else gates" than
"who makes the gate the default before phax has users". The candidates with the reach to do it are Spec Kit, whose
engine already halts on a non-zero exit and lacks only a bundled test step [E-SDD-04], Archon [E-ORCH-63], and
Anthropic, whose hooks already run deterministic checks [E-PLAT-07]. None had done so in the sources opened on
2026-11-25.
