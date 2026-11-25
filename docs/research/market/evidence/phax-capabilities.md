# phax: capabilities, positioning, constraints and own-usage evidence

Internal baseline for the competitor and market study. Read from the repository at
`/Volumes/Work/github/phax` on 2026-11-25 (branch `main`, head `b0296fa0`, `package.json` version
0.43.0, latest tag `v0.42.0`). Repository research only: no web search. Paths are relative to the
repository root unless they start with `/`. Line numbers are those of the head named above.

Status vocabulary used below:

- **shipped**: documented as present in `README.md` or `docs/*.md`, and its command is in the generated
  CLI reference (`README.md` §"CLI command reference").
- **approved**: an Approved spec or plan under `docs/specs/` or `docs/plans/` whose run has not merged.
- **draft spec**: a Draft spec under `docs/specs/`.
- **brief**: a file under `docs/briefs/` with no spec yet.
- **idea**: `docs/ideas/*.md` or an unbriefed item of `NEXT_STEPS.md`.

Two sources sit outside the repository and are marked where used: the operator's local phax state
(`/Volumes/Work/.phax`, read-only, phax namespace only) and read-only `gh` calls on the project's own
GitHub repository.

## Evidence

### What phax says it is

- **E-PHAX-01** One-line description. `package.json` `description` and `README.md:7`: "phax is verified
  delegation for AI coding agents: hand work to Claude Code, OpenAI Codex or Mistral Vibe and get back
  facts, not claims. Every phase passed your checks, every file is accounted for, every finding has a
  fate, and the history stays in Git." Version `0.43.0`, license `Apache-2.0` (`package.json`).
- **E-PHAX-02** Determinism claim. `README.md:11`: "phax drives the agent you pick through the plan and
  gives you back a change whose every step a program checked, not one a model vouches for. Sequencing,
  gates, retries and state are plain code; the agent is the only non-deterministic part."
- **E-PHAX-03** The four moments. `README.md:13-16`:
  - "**Author.** Specs and plans carry a status and an approval. Your agent writes them with phax's
    skills, or phax drafts them headless from a short brief. Their open questions are decided on the
    record, and a plan is linted, estimated and checked for overlap with the others before it runs."
  - "**Run.** Each phase runs in its own Git worktree and commits only when your project's gates
    (typecheck, tests, lint…) pass; a red gate goes back to the same agent session. Every phase declares
    the files it means to create and edit, and phax reconciles them with the diff: planned but not done,
    done but not planned. The agent justifies each deviation in its handoff."
  - "**Review.** The run stops at review with its last phase open. A compliance review reads the change
    against the plan, a code review raises findings, and every finding gets a fate: fixed by a commit,
    dismissed with a reason, or deferred to a file. The pull request explains itself."
  - "**Keep.** Every phase leaves a record on the `phax/records/v1` branch (its gates, its
    reconciliation, its handoff), and every run a cost ledger. `phax records explain <commit>` gives a
    phase's commit back its prompt, gates and handoff."
- **E-PHAX-04** Two kinds of caller. `README.md:18`: "The one delegating can be a person or another
  agent. Every command answers JSON with a schema under `--json`, so an agent that hands a change to
  phax reads the outcome, the compliance verdict and each finding's fate instead of trusting another
  agent's \"done\"".
- **E-PHAX-05** Self-stated trade-off. `README.md:24`: "Spec-driven tools such as GitHub Spec Kit and
  OpenSpec share the spec → plan → implement idea and work with dozens of agents, but by default what
  checks the code there is a person's review or a model's judgment. phax is verified delegation
  instead […] It trades breadth of agents for that enforcement."
- **E-PHAX-06** Positioning decision and rejected names. `docs/briefs/archive/positioning.md:23-27`
  (shipped in 0.42.0, `docs/releases/0.42.0.md:9`): "**The name is verified delegation.** A person
  delegates to coding agents; an agent delegates to other coding agents. […] Rejected, with what each
  abandons: \"harness\" (to a developer the harness is Claude Code itself, and phax would read as its
  rival), \"orchestrator\" or \"control plane\" (a crowded category about fleets of agents in parallel,
  where verification disappears), \"software factory\" (it reads as a factory with nobody in the loop
  […]). Accepted loss: nobody searches \"verified delegation\" yet". Rule `:35`: "**Only what ships.**
  The agent pitch claims nothing a brief still holds".
- **E-PHAX-07** The run was "a third of phax". `docs/briefs/archive/positioning.md:9`: "Both describe
  the run, a third of phax today. phax also authors […], reviews […] and keeps […]". `:17`: "an agent is
  already phax's most frequent caller. It never sees the home page."

### Author

- **E-PHAX-08** Artifact lifecycle. `README.md:134`: "An artifact moves through statuses: `Draft` →
  `Approved` → `Completed`, or `Abandoned` if the work is dropped. A plan can also be marked `Stale`
  when the ground it was approved on has changed […]. `phax artifact` makes every transition and commits
  it; an approval records what the artifact was approved against". Transition table `README.md:311-320`;
  `README.md:321`: "Each transition rewrites the status in the file's frontmatter and commits it on its
  own, and refuses when the files it writes have uncommitted changes."
- **E-PHAX-09** Headless authoring. `README.md:229-256`: "With `--headless`, phax runs the authoring
  session itself from a brief: it gives the agent the skill and the document's JSON Schema, accepts a
  valid document as the session's only output, renders it to Markdown, keeps the document as a `.json`
  sidecar beside it, and commits both." One corrective retry, then exit 5 with nothing written
  (`README.md:249-254`). `README.md:256`: "Headless authoring is experimental: the two document formats
  may still change."
- **E-PHAX-10** Deciding open questions. `README.md:283-303`: `phax artifact decide <path>` in an
  interactive session, or `--verdicts <file> --by operator` headless. `README.md:294`: "Interactive
  decide needs a terminal and a Draft artifact, runs on Claude Code only". `README.md:305`: "**The
  approval lock.** `phax artifact approve` refuses, with exit 12, while a spec or plan has an open
  question".
- **E-PHAX-11** Revising a draft. `README.md:307-309`: "`phax artifact revise <path> --amendment
  amendment.md` changes a Draft that phax wrote headless, from a change request in prose".
- **E-PHAX-12** Plan checks with no model. `README.md:260-272`: `phax plans lint`, `overview`,
  `estimate`. `README.md:268`: "A read-only check, with no model: the plan's structure, its planned
  files against the working tree and against earlier phases, the commands it needs against `phax.json`,
  each phase's model and effort against the catalog […]. It exits 1 on any error".
- **E-PHAX-13** Cost estimate before a run. `docs/plan-estimate.md:3`: "Before you start a run on a
  Claude Max subscription, two questions matter: what will it cost, and will it stop halfway because a
  window ran out? `phax plans estimate` answers both from what this machine already knows. No model
  reads the plan." `:39`: "The estimate is a regression fitted on this repository's own kept runs".
  `:43`: "An estimate needs at least 60 sized phases from this repository." `:47`: figures are "in
  **API-list dollars** […] That is not what your subscription bills".
- **E-PHAX-14** Several plans in step. `README.md:326-336`: `phax plans status [--apply]`, `phax plans
  overlap <plan> <plan>…`, `phax plans overlap --landed <run> <plan>`, `phax adjust-plan <plan> --landed
  <run>`. `README.md:336`: staleness causes `spec-changed`, `self-changed`, `ground-changed`,
  `missing-record`; overlap is "file by file, not line by line".
- **E-PHAX-15** One spec, several plans. `README.md:211-227`: `--last` / `--not-last` write
  `completes-spec: true|false`.
- **E-PHAX-16** Named approver. `README.md:321` and `docs/delegating.md:34`: "An agent has no terminal,
  so every approval names its approver: `--by machine:<grant>` names the loop or script by a kebab-case
  grant, and `--by operator` names the person, as git does. […] A verdict on an open question always
  comes from the operator: `phax artifact decide` takes their verdicts file with `--by operator` and
  refuses a machine".
- **E-PHAX-17** Process and code in two repositories. `README.md:94` and `docs/code-repository.md:3`:
  "Keep a project's specs, plans, briefs and their approvals in a private **process repository**, and
  its code in a public **code repository**, and phax still judges every plan against the code."
  Shipped in 0.40.0 (`docs/releases/0.40.0.md:7`).

### Run

- **E-PHAX-18** Phase mechanics. `README.md:356-363`: per phase, (1) a worktree under
  `~/.phax/worktrees/` on branch `phax/<name>--phase-NN` branched from the previous phase, (2)
  `commands.setup`, (3) the agent gets the instructions, the previous handoff and its deviations, (4)
  "The gate runs; on failure, the same agent session gets the failure and tries again, up to
  `agent.maxFixAttempts`", (5) the handoff, (6) "phax commits with the planned message, then compares
  the files changed with the files planned (`file-reconciliation.json` in the phase's folder)".
- **E-PHAX-19** Run refused unless the plan is Approved and fresh. `README.md:354`: "A plan under
  `docs/plans/` must be Approved and fresh: a Draft, Stale, Completed or Abandoned plan, or one whose
  spec, own text or planned files changed since its approval, is refused with exit 12 before anything
  runs. […] A refused run leaves nothing behind, and trying again gets the same name."
- **E-PHAX-20** Gate definition. `README.md:138`: "**Gate.** Your project's checks, declared once in
  `phax.json` as a gate profile. A step runs at every phase (`every-phase`) or only at the last one
  (`terminal`), and records what it verifies (`local`, `structural` or `product`)."
  `docs/comparisons/agentic-practices.md:39`: "A gate is a command phax runs, never an instruction the
  agent may skip: a red gate keeps the phase from committing."
- **E-PHAX-21** No-change phase stops the run. `README.md:365`: "A phase that changes nothing stops the
  run (exit 9)."
- **E-PHAX-22** Commit trailers. `README.md:367-378`: each phase commit carries `Run-Id`, `Short-Name`,
  `Phase-Id`, `Phase-Title`, `Model`, `Effort`, `Gate-Log`; "No trailer names a path outside the run's
  folder, and none carries a provider session."
- **E-PHAX-23** Resume. `README.md:382-393`: `phax resume`, `reset-phase`, `enter-phase`,
  `session-info`, `unlock`. `README.md:393`: "`resume` never re-runs a committed phase's work […] A run
  stopped by a provider rate or usage limit (exit 8), by a phase with no changes (exit 9) or at an
  interactive phase (exit 13) is meant to be resumed."
- **E-PHAX-24** Interactive phases (declared stop). `README.md:399-413`: a plan line `**Mode:**
  interactive`; "Then the run stops with the state `awaiting_review`, writes `review-stop.json` in the
  run folder and exits 13. It does not wait for input, so the person can leave and come back."
  Closing: `README.md:433-435` "runs the phase's gate first. A red gate returns the phase to you (exit
  4)"; "A closing turn that edits the worktree is refused (exit 5)"; "commits exactly the gated tree".
- **E-PHAX-25** Hold (stop chosen at run time). `README.md:444-455`: `phax run --plan plan.md --hold`,
  `--hold phase-02,phase-04`, `--hold acceptance`; the run "stops in `awaiting_review (held)`, writes
  `review-stop.json` and exits 13."
- **E-PHAX-26** Files for a review UI. `README.md:442`: "A user interface reads `review-stop.json` for
  the stopped phase, its worktree, the current session, the last refused close and the commands above,
  each as `{ cwd, argv, env }`". `README.md:504-527`: `phax ls --json` prints a versioned `run-list`
  document embedding each run's `stop` and `pullRequest`.
- **E-PHAX-27** Acceptance phases. `docs/acceptance-phases.md:3`: "An acceptance phase writes the tests
  that a later phase has to pass. phax judges the two apart: when the acceptance phase finishes, a
  provider you configure checks that the tests are marked as expected failures; when its passing phase
  finishes, the provider checks that the only thing that changed in them is the removal of those marks."
  `:5`: "phax itself knows no test framework, no marker and no test-file convention. The provider
  does." `:19`: "The agent is never granted the provider."
- **E-PHAX-28** Protected paths. `README.md:188`: "**`protectedPaths`** lists the files whose change is
  the operator's decision: no phase may create, change, delete or rename them. The `phax.json` phax
  loads is protected too." Rationale `docs/security.md:221`: "An agent that cannot fix a lint error can
  lower the rule in that file, and the gate then passes."
- **E-PHAX-29** Assignment bounds. `README.md:992-1015`: the owner bounds which model and efforts a
  phase takes where it touches certain files; "A phase that departs from its governing bound needs an
  `**Assignment reason:**` line: without one, `phax plans lint` reports an error and `phax run` /
  `phax resume` refuse with exit 11".
- **E-PHAX-30** Providers and routing. `README.md:692`: "phax can run a phase with Claude Code, OpenAI
  Codex or Mistral Vibe. […] Vibe and Codex are disabled until you enable them, so a fresh install runs
  everything with Claude Code." `README.md:98`: "Keep `claude` installed even if you prefer another
  provider: phax falls back to it when the preferred one is missing or cannot meet the run's security
  mode." `docs/model-routing.md:3`: "a **versioned model catalog** and a **Claude-hub equivalence
  table**".
- **E-PHAX-31** Extension hooks. `README.md:719`: "Five hooks let your own tools inform a run: a gate
  step that prints a gate report, a brief provider that answers with a brief report, an architecture
  provider […], an acceptance provider that judges an acceptance pair, and a plan auditor. A provider
  is a command in `phax.json`, split on spaces and run without a shell, that reads a JSON request on
  stdin and answers JSON on stdout." Partial gate commands `README.md:833-863`.
- **E-PHAX-32** Plan extraction is the one place a model reads the plan, as a fallback.
  `docs/plan-extraction-model.md:5-6`: "Plan extraction runs inside `phax run` […] as the fallback used
  when the deterministic parser cannot extract a plan on its own." Default `claude-haiku-5-5` at `low`.
- **E-PHAX-33** Observability. `README.md:545-553`: `--verbose`, `--trace` (`semantic.jsonl`), `phax
  report <run>` "open a GitHub issue from the run's telemetry"; events recorded for every run, off with
  `"enabled": false` in `~/.phax/telemetry.json`.

### Review

- **E-PHAX-34** Review commands. `README.md:557-572`: `phax review-code <run>` (interactive),
  `review-code --headless`, `finding list|fix|dismiss|defer|post`, `enter`, `shell`, `open`, `path`,
  `review-handoff`. `README.md:574`: `review-code` "follows the `phax-review` skill: it uses the change
  before reading its code, works from the user inward, and looks for what the run's tests cannot catch,
  each finding naming why they missed it."
- **E-PHAX-35** Headless code review is read-only and checked. `README.md:576`: "It follows the same
  skill in a read-only session […] and phax writes the findings to `code-review.json`: each with a
  severity, a file and line, a lens, an escape, a criterion and a suggestion. […] A refused answer, a
  failed session or a session that changed the worktree (its changes are put back) leaves
  `code-review.json` and the recorded session as they were, and exits 1".
- **E-PHAX-36** Reviews never fail a run. `README.md:578`: "Three steps run on their own when a run
  reaches review, if `phax.json` turns them on, and can be run by hand. None can fail the run."
  (`review-compliance`, `review-code --headless`, `publish-pr`.)
- **E-PHAX-37** Finding ids and fates. `docs/findings.md:9-12`: "`F<n>` for a code-review finding […]
  `C<n>` for a compliance finding […] The review session never writes an id." Fates `:24-32`: `open`,
  `fixed`, `dismissed`, `deferred`, `unrecorded`. Shipped in 0.40.0: `docs/releases/0.40.0.md:8` "No
  finding is dropped: phax names it, the operator or a machine settles it through a phax command, and
  Git remembers how."
- **E-PHAX-38** Pull request. `README.md:586`: `phax publish-pr <run>` "writes a short description: a
  run summary with the compliance verdict, one line per phase, what needs your review (unexplained
  deviations, compliance attention points), a Review findings section […]. `publish-pr` needs a GitHub
  remote and an authenticated `gh`". Footer names plan, spec, agents and run (`README.md:588-597`).

### Keep

- **E-PHAX-39** Records. `README.md:619`: "A record is what a phase leaves behind for later: on a
  `phax/records/v1` branch, one commit per phase, holding its manifest, its gate results and the
  surfaces they verified, its file reconciliation, its diff, its handoff and logs, and the agent's
  transcript if you keep it. A headless authoring session leaves one too, and so do every `phax
  artifact decide` session, every `phax artifact revise` session and every finding's fate."
  Commands `README.md:621-627`. `README.md:629`: "The branch can live in the same repository or in a
  separate one. Transcripts can hold anything the agent read, so phax refuses to keep them on a public
  repository's own records branch". `README.md:669`: "phax never forces the records branch".
- **E-PHAX-40** Cost ledger. `README.md:611`: "Every run keeps `cost-ledger.json`: each Claude
  invocation's own API-list cost, tokens, duration and subscription-window samples." `README.md:533`:
  "The cost ledger covers Claude Code invocations".
- **E-PHAX-41** Persisted formats. `README.md:1029`: "Every file phax writes starts with `$schema`,
  naming its format and that format's shape […]. Each URL serves that format's JSON Schema, and stays up
  for good." The table `README.md:1031-1079` lists 47 formats (count of table rows).
- **E-PHAX-42** Reading without phax. `README.md:1087`: "`@lbdremy/phax-schemas` reads all of them,
  with phax's own types and verdicts, without phax installed." `README.md:1127`: "A failed parse is a
  value, never an exception […]. A file stays readable as phax evolves: an older shape still parses".
- **E-PHAX-43** State location. `README.md:146`: "phax keeps its own state outside your repository,
  under `~/.phax/`: the registry of runs, each run's folder, the worktrees, the locks. Your repository
  only holds the artifacts, and the records branch if you use one."

### Agent-facing surface

- **E-PHAX-44** Delegating guide. `docs/delegating.md:5-9`: "Each phase runs in an isolated Git
  worktree. / Its gate commands must exit 0 before the next phase starts. / The files it touched are
  reconciled with the plan. / Run state outlives your context: phax resume picks up where the run
  stopped. / Every command answers JSON with a schema." The nine-command sequence `:15-32`
  (`artifact new spec --headless --brief - --json` … `finding list <run> --json`).
- **E-PHAX-45** `--json`. `docs/json-output.md:3`: "Every phax command takes `--json`. With it, stdout
  carries the command's answer as one JSON value and stderr carries only message lines, one JSON object
  each." Five message kinds `:24-30`: `note`, `written`, `error`, `refused`, `defect`. `:15-16`: a
  published document answer has `$schema` as first key; "Any other answer is an object described by the
  command's contract […]. It has no `$schema`".
- **E-PHAX-46** `--json-schema`. `docs/json-output.md:59`: "`phax --json-schema` prints the contracts
  catalogue, and `phax <command> --json-schema` prints one command's entry. Nothing runs. Both are JSON
  Schema 2020-12."
- **E-PHAX-47** Exit codes. `README.md:1136-1157`: 0, 1, 2 (validation), 3 (unsafe git), 4 (gate
  failure), 5 (agent invocation), 6, 7 (lock), 8 (rate or usage limit, resumable), 9 (no changes,
  resumable), 10, 11 (security or preflight refusal), 12 (artifact lifecycle refusal), 13 (awaiting
  review, resumable), 14 (provider unreachable, resumable), 64 (refused call), 70 (defect), 130
  (interrupted). `docs/json-output.md:51`: "read stdout to tell a pause from a failure".
- **E-PHAX-48** `--usage` and completions. `docs/delegating.md:43`: "`phax --usage` prints the full
  command tree, every command with its flags and arguments." `phax.usage.kdl` ships in the npm package
  (`package.json` `files`). Completions for bash, zsh, fish, nushell, powershell (`README.md:108-116`).
- **E-PHAX-49** Skills. `package.json` `files` ships seven: `phax-planning`, `phax-cli`, `phax-spec`,
  `phax-review`, `phax-decide-spec`, `phax-decide-plan`, `phax-decide-review`. `README.md:100-105`:
  `phax skills install --target claude` "or codex, or agent".
- **E-PHAX-50** `llms.txt`. `site/rspress.config.ts:42-43`: "llms.txt, llms-full.txt and a .md twin of
  every page, for coding agents; llms.txt opens with the agent pitch." Built file
  `site/doc_build/llms.txt:3`: "phax is verified delegation for AI coding agents: delegate a change to
  another coding agent and get results you can verify."
- **E-PHAX-51** CLI size. `grep -c '^- \`phax ' README.md` → 72 entries in the generated reference
  (command families: `agent`, `artifact`, `plans`, `records`, `finding`, `cost`, `schema`, `security`,
  `skills`, plus run, review and session commands).
- **E-PHAX-52** Environment. `README.md:1163`: "phax reads no environment variable for its
  configuration: everything is in `phax.json`, its layers and `~/.phax/`."

### Security

- **E-PHAX-53** Modes. `README.md:707-711` and `docs/security.md:9-13`: `secure` ("**Default.** The
  provider's own sandbox: files limited to the worktree, network as `network.profile` allows where the
  provider can enforce it, no MCP."), `unsafe` ("Anything on your machine. phax warns you."),
  `isolated` ("An external sandbox. Planned, refused today.").
- **E-PHAX-54** Provider capability table. `docs/security.md:87-91`: `claude-code` "Strong,
  file-editing tools only (no OS sandbox) | None enforced (profile recorded) | Supported"; `codex-cli`
  "Strong, OS sandbox | On/off (sandbox egress toggle) | Supported"; `mistral-vibe` "Strong,
  file-editing tools only (no OS sandbox) | None | Unsupported (MCP off)".
- **E-PHAX-55** Stated limits. `docs/security.md:93-97`: "**On Claude Code and Vibe the filesystem jail
  is not an OS sandbox.** […] A shell command phax allows runs as an ordinary process with your user's
  rights: it reads and writes wherever you can. Only Codex runs the agent's commands in an OS sandbox."
  `docs/security.md:99`: "**No provider enforces a domain allowlist.**" `README.md:713`: "No provider
  filters network by domain, and only Codex can cut a phase's network off. The mode a phase actually
  ran with is in its `security.json`."
- **E-PHAX-56** Command allowlist and argv. `README.md:715`: "The agent can run your gate commands and
  the commands in `security.agentCommands`, and nothing else where the provider supports an allowlist.
  The phax binary has no network permission of its own: what reaches the network (an agent, `git push`,
  `gh`) is a program it starts. And phax never builds a shell command from your data: every command it
  runs gets its arguments one by one."
- **E-PHAX-57** Routing honours the mode. `docs/security.md:449-457`: "When `secure` mode is active,
  providers that cannot satisfy strict security requirements are skipped during routing"; "Claude Code
  is the guaranteed strong baseline (never filtered)".
- **E-PHAX-58** User guardrails do not apply in a headless Claude session. `docs/security.md:172`:
  "**Your own guardrails stop applying.** The `permissions.deny` rules and the hooks […] in your
  `~/.claude/settings.json` or `.claude/settings.local.json` do not run in a headless session. phax's
  own deny rules and grants still apply".
- **E-PHAX-59** Distribution. `docs/security.md:464-484`: verified binary installs (SHA-256 sidecar
  checked before first run), `npm publish --provenance`, no install-time scripts, argv-only subprocess
  calls. `README.md:89`: `gh attestation verify phax-darwin-arm64 --repo lbdremy/phax`. CI:
  `docs/security.md:522-540` (daily `pnpm audit:security`, Semgrep). README badges: CI, Security,
  OpenSSF Scorecard (`README.md:3-5`).
- **E-PHAX-60** Own security audit, public roadmap. `NEXT_STEPS.md:254-262`: "Two full audits of main
  at `e5c39afa` landed their reports on 2026-11-23 […] Headline theme: single-turn confinement is well
  built; the weak points are agent-written files that phax or a provider later trusts". Six phases of
  fixes are listed (`NEXT_STEPS.md:268-298`); the first slice is an Approved spec and plan
  (`docs/specs/2611231049-security-high-fixes.md`, `docs/plans/2611241432-security-high-fixes-plan.md`).
- **E-PHAX-61** OS sandbox is future work. `NEXT_STEPS.md:71-83`: "**An OS sandbox for gate steps and
  allowed commands** — to brief, a spike first. […] Gate steps run agent-written code (the tests) with
  the user's rights […]. Only an OS sandbox (seatbelt on macOS, bubblewrap or landlock on Linux) makes
  the repository's `.git` and the rest of the disk read-only to them."

### Constraints, stated by the repository

- **E-PHAX-62** Local CLI. `docs/blog/announcing-phax-1.0.md:521`: "It's a local CLI. It works with the
  agent CLI you already have installed. It doesn't touch your working tree."
- **E-PHAX-63** Sequential phases, one repository, no scheduler.
  `docs/comparisons/agentic-practices.md:99-101`: "Phases of a run run one after another, each on the
  previous one's branch. `phax plans overlap` reports which plans can run side by side without a merge
  conflict, as separate runs." (partial); "A run lives in one repository." (not yet); "phax records its
  own runs. A session you run outside a run leaves no record." (not covered, by choice). `:41`:
  "Nothing starts a run on a schedule or an event without a person."
- **E-PHAX-64** Not measured. `docs/comparisons/agentic-practices.md:51`: "A phase runs once. Nothing
  reruns the same phase k times to measure how reliably a plan and a model deliver it." `:93`: "Nothing
  compares two runs of the same work under two configurations."
- **E-PHAX-65** Platforms and install. `README.md:75`: "a small launcher (Node 22 or later) that
  downloads the binary for your platform". `README.md:83`: "Targets: `phax-darwin-arm64`,
  `phax-darwin-x64`, `phax-linux-x64`, `phax-linux-arm64`." No Windows target is listed.
  `README.md:91`: "macOS: the binary is not notarized yet". `docs/release.md:204`: "macOS binaries are
  not yet code-signed or notarized."
- **E-PHAX-66** GitHub only for publishing. `README.md:586`: "`publish-pr` needs a GitHub remote and an
  authenticated `gh`".
- **E-PHAX-67** Machine load of parallel runs. `NEXT_STEPS.md:21-23`: "**At most two code runs at
  once.** Two `pnpm test` gates together (about 700 s of CPU each on 14 cores) are the load that timed
  gates out before; parallel runs also drain the Max window twice as fast".
- **E-PHAX-68** Road to 1.0. `NEXT_STEPS.md:353-400`: open items are the persisted-format stability
  promise, "**CLI contract freeze.**" (`:383`), "**Distribution polish.** macOS binaries are neither
  signed nor notarized" (`:388`), "**Provider coverage on record.** Claude is the tested path;
  `tests/e2e/semanticTrace.providers.test.ts` is the only real exercise of Codex and Vibe" (`:391`),
  and "**A second user.**" (`:396`, quoted in E-PHAX-92).
- **E-PHAX-69** Runs stay autonomous. `NEXT_STEPS.md:686`: "(`phase-decision-requests` was abandoned
  2026-11-05: runs stay autonomous.)" `docs/briefs/archive/interactive-phases-hold.md:18`: "A run never
  stops on its own initiative: the operator asks for the hold, and the planner declares an interactive
  phase."

### Live briefs, draft specs and approved work (not shipped)

- **E-PHAX-70** `phax-do` (brief). `docs/briefs/phax-do.md:1-3`: "one task, run with phax's guarantees
  and without a plan. `phax do \"<intent>\" --files <planned files>` runs a single phase in its own
  worktree with the project's gate, reconciles the files it touched against the files given, records
  the run, and keeps it open for review like any run." Queue: `NEXT_STEPS.md:193`.
- **E-PHAX-71** `do-attempts` (brief). `docs/briefs/do-attempts.md:1-5`: "proved delegation. A task is
  given a contract first: an acceptance test written from the intent alone, before any code, and
  agreed. Then several attempts at it run in parallel, possibly on different models, none of which may
  touch the contract. The contract and the project's gates eliminate attempts; declared measures rank
  the attempts that survive". `:24`: "Other tools can run attempts in parallel; what makes it worth it
  here is a judge that is not a model." Queue: `NEXT_STEPS.md:195`.
- **E-PHAX-72** `run-detach` (brief). `docs/briefs/run-detach.md:1-3`: "a caller starts a run, gets its
  id back at once, follows it as a stream of versioned events, and reads its outcome as one versioned
  document when it ends." Queue: `NEXT_STEPS.md:187`.
- **E-PHAX-73** `phase-graph` (brief). `docs/briefs/phase-graph.md:1-4`: "a plan's phases form a graph
  of dependencies instead of a sequence. […] Phases with no dependency between them, whose planned
  files do not overlap, run at the same time, each in its own worktree with its own gate." Queue:
  `NEXT_STEPS.md:190`.
- **E-PHAX-74** `inbox` (brief). `docs/briefs/inbox.md:1-3`: "one command answers, for the current
  project, everything that waits and on whom, each item with its next command." Queue:
  `NEXT_STEPS.md:151`.
- **E-PHAX-75** `agent-cli-ergonomics` and `next-steps-as-data` (briefs).
  `docs/briefs/agent-cli-ergonomics.md:1-3`: "A preview never exits 0 as if the work were done;
  `--help` is short by default, with the long text by topic; `phax ls` lists the current project's runs
  unless asked for all." `docs/briefs/next-steps-as-data.md:1-3`: "wherever phax tells its caller what
  to do next […], it says it as data as well as text: the commands to run, each as an argument vector,
  with why." Queue: `NEXT_STEPS.md:144`, `:148`.
- **E-PHAX-76** `claude-code-mod` (brief). `docs/briefs/claude-code-mod.md:1`: "A Claude Code mod,
  shipped from this repository, shows the current repository's phax state beside the conversation — an
  inbox of what waits for the operator, the specs with their plans and each plan's runs — without the
  operator running a command. It reads only what phax prints as JSON, and writes nothing." Queue:
  `NEXT_STEPS.md:153` ("refresh the brief first (written against 0.31.0)").
- **E-PHAX-77** `knowledge-index` (brief). `docs/briefs/knowledge-index.md:1`: "a local database an
  agent or the operator queries — the briefs, specs and plans with their questions and arbitrations,
  the runs with their phases, gates, costs and reviews, and the records — instead of searching files
  with grep." Settled: SQLite with FTS5, no embeddings, "no server, no MCP" (`:6-9`). Second milestone,
  out of scope (`:12`): "a shared service, a separate product phax does not depend on. It keeps a
  read-only mirror of a team's repositories and their `phax/records/v1` branches, rebuilds the same
  index, and exposes it as a remote MCP server with authentication". Queue: `NEXT_STEPS.md:183`.
- **E-PHAX-78** `machine-slots` (brief). `docs/briefs/machine-slots.md:1-4`: "the runs of one machine
  take turns for the steps that load it." Queue: `NEXT_STEPS.md:134`.
- **E-PHAX-79** `single-provider` (brief) and `mistral-large-4` (Approved spec).
  `docs/briefs/single-provider.md:1-3`: "an operator can run all of phax's work on one provider
  (Mistral Vibe is the case in hand) by configuration alone, and every job phax runs either honours
  that choice or refuses, saying why." `:7-9`: "The operator asked on 2026-11-24 whether moving
  everything to Mistral is only a matter of provider settings and routing. It is not. […] Several jobs
  cannot reach it at all." `docs/specs/2611241412-mistral-large-4.md` is `status: Approved`
  ("Mistral Large 4 in the catalog, and a disabled provider never runs").
- **E-PHAX-80** `project-doctrine` (Draft spec). `docs/specs/2611051057-project-doctrine.md`, `status:
  Draft`; `NEXT_STEPS.md:178-182`: "Draft (2026-11-05), 10 open questions kept for the operator to
  think over […]: phax's bundled base of engineering practice and the project's own doctrine of taste,
  a versioned document loaded by headless authoring and every decide mode."
- **E-PHAX-81** `review-map` (brief). `docs/briefs/review-map.md:1`: "When a run reaches review, phax
  computes, without a model, where the review's attention belongs: the complement of what the run
  proved." `NEXT_STEPS.md:241-243`: "Deprioritised 2026-11-10 (operator)".
- **E-PHAX-82** `roadmap-items` (brief). `docs/briefs/roadmap-items.md:1-3`: "a brief becomes an
  artifact with a status and a rank, and the ordered briefs are the project's roadmap. phax lists it, a
  person or an agent votes on an item with the evidence of what it cost them, and the operator ranks."
  `NEXT_STEPS.md:246-248`: "Not a priority (operator, 2026-11-22)."
- **E-PHAX-83** `finding-fix-identity` (Approved spec, plan to author).
  `docs/specs/2611220956-finding-fix-identity.md`, `status: Approved`;
  `docs/briefs/finding-fix-identity.md:1-3`: "a fixed finding stays bound to the commit that fixed it
  after that commit's history is rewritten (a rebase of the run's branch, an amend, GitHub's Rebase and
  merge, a squash)". Queue: `NEXT_STEPS.md:84`.
- **E-PHAX-84** `format-stability-promise` (Draft spec, parked).
  `docs/specs/2611231918-format-stability-promise.md`, `status: Draft`;
  `docs/briefs/format-stability-promise.md:1-3`: "what phax promises, from 1.0, about the files and
  records it writes. Not that their shapes stop changing, but the rules by which they change".
  `NEXT_STEPS.md:369-378`: "Spec decided 2026-11-24, parked until 1.0 is scheduled".
- **E-PHAX-85** Other live briefs, one line each from line 1 of the brief:
  `phase-handoff-answered` ("A phase's handoff becomes a structured document, with a published schema,
  that phax decodes and checks. It must justify every file-plan deviation the reconciliation found");
  `gate-tolerances` ("a project can declare a command phax runs between a phase's commit and its gate,
  the one thing in a run allowed to write the protected files that record what the gate tolerates");
  `protected-path-exceptions` ("the operator can let one phase of a run change a protected path, by
  name"); `deferred-finding-files` ("`phax finding defer` writes the deferred finding as a file of its
  own […] and commits it"); `approval-baseline-identity` ("an approved plan's staleness stays computable
  after the commit its approval recorded as baseline is rewritten"); `run-start-and-base` ("`phax run`
  takes, as options, the commit a run starts from and the branch its pull request targets");
  `e2e-phax-home` ("one place where phax resolves its own home (`~/.phax`), which an environment
  variable can point elsewhere"); `fewer-git-processes`; `node-runtime` ("On hold, 2026-11-12: the
  binary stays on Deno."); `knip-production` and `lint-baseline` ("phax gains no feature").
- **E-PHAX-86** Approved and in flight. `docs/specs/2611231919-launcher-release-fixes.md` and
  `docs/plans/2611241412-launcher-release-fixes-plan.md`, both `status: Approved`; `git branch -a`
  shows `phax/launcher-release-fixes--phase-01` … `--phase-04` and
  `remotes/origin/phax/launcher-release-fixes--phase-04`; the local registry lists the run
  `review_open`. `docs/specs/2611231049-security-high-fixes.md` and its plan are Approved, "to run"
  (`NEXT_STEPS.md:40-42`).
- **E-PHAX-87** Approved and parked. `docs/specs/2608091526-batch-execution-disjoint-plans.md`
  (`status: Approved`); `NEXT_STEPS.md:682-685`: "parallel disjoint plans, incremental ordered merge,
  terminal gate on the integration result, published as GitHub stacked PRs (`gh stack`) with a
  single-integration-PR fallback. The largest piece of work left". `NEXT_STEPS.md:200-202`: "Not needed
  to speed the queue now: the waves above, checked by `phax plans overlap`, are its manual form."
  `docs/plans/2606291247-smolvm-isolation-spike-plan.md` (`status: Approved`); `NEXT_STEPS.md:690-691`:
  "its PR #60 is still open at phase 05. Resume it or abandon it."

### Ideas (not briefed)

- **E-PHAX-88** Local and cloud modes. `docs/ideas/local-and-cloud-modes.md:3`: "Status:
  **brainstorm**. […] Explicitly **after 1.0**". `:31`: "One domain, two adapter sets, selected by
  configuration." Consumption form `:39-46`: "a library (`app` + `ports` exported, adapter sets shipped
  by phax, the CLI one entry adapter among others)", against "A phax daemon with its own RPC […] A
  third contract to freeze and secure". Costs `:128-131`: "**It bills on the API, not on a
  subscription.** A cloud run through the Agent SDK is metered; local mode stays the cheap path for
  individuals." / "**A sandbox per run is new infrastructure**". `:124`: "**Multi-human is possible.**
  The decision queue needs a server; cloud mode is that server."
- **E-PHAX-89** Desktop app. `docs/ideas/desktop-app.md:3`: "Status: **brainstorm**". `:9`: "When code
  production is sufficiently *framed*, the code becomes a by-product. The thing a human actually
  reviews is no longer the diff — it's the **trajectory**". `:25`: "Not an IDE, not a terminal, not a
  generic Kanban. The hero object is the **run**". `:40`: "review becomes **\"approve the
  trajectory\"** rather than \"approve the code\"". `NEXT_STEPS.md:676-678`: "stays in
  `docs/ideas/desktop-app.md` until specs 21–24 land […] this is parked".
- **E-PHAX-90** Decision queue and team use. `docs/ideas/decision-queue-and-proof-chain.md:10`: "from
  one person's exception inbox to a **multi-human decision queue**". `:18-23`: "**phax is the control
  plane of agentic software production.** […] **phax lets a team pilot the trajectory of a software
  change, from intent to production — directing human attention to the decisions that matter and
  retaining a complete chain of evidence.**" `:30`: "**reduce the human attention required without
  reducing confidence in what was produced.**" Note: the later positioning brief rejects "control
  plane" as the name (E-PHAX-06).
- **E-PHAX-91** Other ideas. `docs/ideas/autopilot.md:37`: "**Autopilot is a deterministic supervisor
  over probabilistic steps — not a master agent.**" (`NEXT_STEPS.md:652-657`: "Explicitly after 1.0").
  `docs/ideas/harness-from-records.md:21`: "A better harness gives the agent an efficient working
  environment **at low cost**". `NEXT_STEPS.md:702-715`: "**`isolated` mode on smolvm: the provider
  CLIs in a microVM.**" `NEXT_STEPS.md:716-726`: "**A Claude Code plugin for phax, after the 1.0
  freeze.**" `NEXT_STEPS.md:735-739`: "Cross-run durable context layer". `NEXT_STEPS.md:198-199`:
  "Later, not briefed: letting a run amend its own plan". `NEXT_STEPS.md:636-642`: living specs,
  requirement-level traceability, an explore step (from OpenSpec). `NEXT_STEPS.md:668-672`: a per-phase
  diff budget and a lint rule refusing a phase that plans both a file and its oracle.
  `docs/ideas/coverage-provider.md`, `docs/ideas/change-gates-from-the-harness.md`: brainstorm.
  `docs/ideas/laya-decision-model.md:3`: "Status: **declined**."

### Users and pains

- **E-PHAX-92** One operator. `NEXT_STEPS.md:396-398`: "**A second user.** The registry shows one
  operator across three repos (phax, steme-lab, louloupapers). One outside `phax init` → `run` →
  `publish-pr` on a repo not authored here, before the number changes."
  `docs/comparisons/spec-kit-vs-phax.md:87`: phax is a "Single-maintainer, pre-1.0 project (0.17.0),
  deep safety engineering".
- **E-PHAX-93** A fork with daily use. `docs/briefs/archive/interactive-phases-hold.md:5`: "A friend
  runs a fork of phax with a \"hold mode\", which he built with phax and uses daily through his own
  review UI. He reviewed our three specs, and two of his points change this one". `:15`: "He wants to
  fold hold into our `awaiting_review` once this ships, so that his fork carries only a flag."
- **E-PHAX-94** The original pain. `docs/blog/announcing-phax-1.0.md:12-19`: "It does the whole thing
  in one breathless run. You get a 40-file diff and a pat on the back, and now it's *your* job to
  figure out whether any of it is right. […] You end up babysitting it — watching the terminal, ready
  to Ctrl-C — which defeats the point of handing off the work in the first place." `:21-24`: "I wanted
  the agent to do a large piece of work *while I wasn't watching*, and then hand me something I could
  actually review — in pieces". `:28`: "Plenty of tools now run agents in isolated worktrees and route
  across providers — that part isn't new."
- **E-PHAX-95** An agent's "done" is a claim. `docs/briefs/phax-do.md:7-11`: "For any task under an
  hour, an agent today picks a subagent: it starts at once, with no spec, no plan, no lint and no
  approval. A subagent's \"done\" is a claim, though: nothing checked the gate, nothing compared what
  it touched with what it meant to touch, nothing is kept."
- **E-PHAX-96** What an agent cannot do alone. `docs/briefs/do-attempts.md:12-22`: "**Judge its own
  work.** An agent that writes the code and then the test encodes the same misreading in both, and
  everything passes. […] **Resist bending the test.** When a test resists, the easy slope is to weaken
  it. […] **Relay facts instead of claims.** \"The subagent says the tests pass\" becomes \"this test,
  written before the code and unchanged, exits 0 on this diff\"."
- **E-PHAX-97** Where phax loses to subagents today. `docs/briefs/run-detach.md:8-11`: "An agent
  delegating work wants three things from the tool it delegates to: it starts at once, it gives the
  hand back, and it says what happened as data. phax gives the third only partly and the first two not
  at all: `phax run` holds the caller's shell for the whole run (an hour is common)."
  `docs/briefs/phase-graph.md:10-12`: "a plan of five phases where three are independent takes the time
  of five. The fan-out is what subagents give and phax does not; the gate on every branch is what phax
  gives and subagents do not."
- **E-PHAX-98** Handoffs that claim. `NEXT_STEPS.md:160-161`: "(operator, 2026-11-19: the reviews keep
  tripping on handoffs that claim what is not so)".
- **E-PHAX-99** Subscription window and cost. `docs/plan-estimate.md:3` (E-PHAX-13);
  `NEXT_STEPS.md:21-23` (E-PHAX-67); `NEXT_STEPS.md:312`: "For scale, recent all-Opus runs of 2–3
  phases cost $11–13." The model policy table records pauses on the usage limit, for example
  `NEXT_STEPS.md` row 2026-10-22 `interactive-phases` plan 1: "$58.92 ($12.38 of it before the first of
  two usage-limit pauses)".
- **E-PHAX-100** Portability of the harness. `docs/ideas/harness-from-records.md:35-44`: "~50k tokens
  are in context at a phase's first turn (30k–87k), before the agent reads anything […]. Phase sessions
  load a median 64 skills (max 77, up from 32 over three months). The repository supplies 16 […]. Two
  losses: tokens on every turn, and **portability**. A harness meant to be reused across people cannot
  depend on what one person installed globally."
- **E-PHAX-101** State at a glance. `docs/briefs/claude-code-mod.md:3`: "Today the operator drives phax
  by talking to Claude Code, which calls the CLI. That stays. What is missing is the state at a glance
  […]. The web cockpit keeps what one terminal cannot give — a team, history, several repositories,
  several engines, phax's cloud mode." `docs/briefs/inbox.md:7-9`: "To know where a project stands, an
  agent today calls `phax artifact status` file by file, `phax ls`, `phax finding list`, `phax records
  status`, `phax plans status`, and joins the answers itself. Every session that picks up the work pays
  that again".
- **E-PHAX-102** Knowledge kept by hand. `docs/briefs/knowledge-index.md:3`: "Today it is reachable by
  grep and by reading files one by one. The table \"Model policy tracking\" in `NEXT_STEPS.md` is such
  a query, kept by hand." `docs/briefs/roadmap-items.md:7-9`: "phax tracks every step of a change but
  the first: […] the idea they came from is a section of `NEXT_STEPS.md`, 759 lines of free text ranked
  and ticked by hand."
- **E-PHAX-103** Machine contention. `docs/briefs/machine-slots.md:8-13`: "Measured by the operator on
  one project over two weeks of runs (14 runs, 129 phases): […] a gate that passed in 4.4 min alone
  took 6.5 to 9.4 min on the days another run was working nearly all the time". `:15`: "The operator
  runs several runs at once, across projects that share one machine."
- **E-PHAX-104** Doctrine and taste. `docs/briefs/project-doctrine.md:8`: "The taste ships to every
  phax user as if it were practice, and no project can say \"this is ours, and it changes\". Meanwhile
  the operator's actual rules live where no phax session reads them".

### Tools the repository compares itself to

- **E-PHAX-105** GitHub Spec Kit. `docs/comparisons/spec-kit-vs-phax.md:3-5`: "last checked on
  2026-10-04 against Spec Kit v1.1.0 […] and phax 0.17.0." `:10-14`: "**Spec Kit is a methodology +
  prompt/template layer, with a workflow engine on top, that runs your AI agent _as the worker for each
  step_. phax is verified delegation: it runs your AI agent _inside isolated, mechanically gated
  phases_ and hands back facts, not claims.**" Table `:79`: gate is "**Human** approve/reject steps in
  workflows; `clarify`/`checklist`/`analyze`/`converge` are AI prompts" against "**Mechanical** gate
  profiles". `:84`: "Broad: 41 named integrations + generic" against "Claude Code (default), Codex,
  Mistral Vibe". `:87`: "GitHub-official, 1.x since 2026-08, ~140k stars, large contributor and
  extension community". `:106`: "Spec Kit standardizes the _conversation, artifacts and process_; phax
  standardizes the _execution and verification_." `:117`: "you trade agent-breadth and ecosystem for
  enforcement and safety." `:122`: "**They are composable**".
- **E-PHAX-106** OpenSpec. `docs/comparisons/openspec-vs-phax.md:3-5`: "last checked on 2026-10-04
  against OpenSpec v1.14.0 […] and phax 0.17.0." `:9`: "**OpenSpec is a spec layer that stops where
  phax starts.**" `:17-18`: "50 tool targets in v1.14.0". `:100-103`: "**OpenSpec** checks the _specs_
  mechanically (`validate` is a real exit code) and checks the _code_ by judgment — `/opsx:verify` and
  the Cloud Agent ask a model whether the implementation matches the spec, and report; neither blocks."
  `:120`: "for teams, a hosted drift checker". `:140-142`: "Neither isolates the work or gates each
  step on your test suite by default; that layer is what phax adds." `:146`: ideas to borrow.
- **E-PHAX-107** Agentic practice literature. `docs/comparisons/agentic-practices.md:3`: "last checked
  on 2026-10-29 against phax 0.30.0". `:10`: "**phax structures the work before the agent writes, and
  checks it with programs after.**" `:15-20`: names Google DeepMind's "Intelligent AI Delegation" and
  "Authenticated Delegation and Authorized AI Agents"; "In phax, what is verified is the result, not
  the mandate." `:22-33`: Böckeler's guides and sensors, computational or inferential, with phax's
  parts placed in the four cells. Rows marked "not yet" or "partial": reliability over trials (`:51`),
  finding lifecycle (`:60`, since shipped in 0.40.0, see E-PHAX-37), loop until the review passes
  (`:61`), parallel agents (`:99`), several repositories (`:100`), comparing configurations (`:93`).
- **E-PHAX-108** entire.io. `docs/spikes/entire-checkpoint-findings.md:7`: "the decision is build, not
  adopt". `:175-177`: "entire never supplied capture. It supplied three things: condensing a session
  into a git object, binding it to the commit by trailer, and a query surface." `:222-224`: "**Build,
  not adopt.** Decided 2026-08-17 by the developer […]. phax builds `phax/records/v1` itself; entire is
  not adopted." Reasons `:237-251`: "phax is better placed to do it", "The record is strictly richer",
  "Format ownership, now evidenced rather than feared". `:253-258`: "**Knowingly accepted loss:** phax
  records only phax runs. entire captures every session in the repo […]. If blame-to-prompt on an
  arbitrary line ever becomes wanted, entire is a complement to add then".
- **E-PHAX-109** smolvm. `NEXT_STEPS.md:702-715`: "https://github.com/smol-machines/smolvm (Apache-2.0)
  boots OCI images as microVMs […]. It fills the `isolated` mode `docs/security.md` lists as planned.
  Do it as a spike". Status: an Approved spike plan with an open PR (E-PHAX-87).
- **E-PHAX-110** Claude Code's own features. `docs/briefs/run-detach.md:14-15`: "A subagent or a
  `Workflow` script returns the hand to its caller; a cloud agent runs elsewhere and reports a pull
  request." `:20-21`: "Be honest about what already works: Claude Code can run `phax run` as a
  background command and is woken when it exits". Mods and plugins as a delivery surface:
  `docs/briefs/claude-code-mod.md`, `NEXT_STEPS.md:716-726`.
- **E-PHAX-111** steme. Named as the operator's other project and first consumer of the UI ideas:
  `docs/ideas/local-and-cloud-modes.md:13`: "The steme cockpit (the first real consumer of the phax UI
  ideas) is a web app"; `docs/ideas/autopilot.md:30`: "First real target: the steme project";
  `docs/ideas/harness-from-records.md:8`: "steme (its standards will reach phax as dynamic briefs)";
  `NEXT_STEPS.md:598-603` §"steme coordination — still open". The repository does not treat steme as a
  competitor.
- **E-PHAX-112** Laya. `docs/ideas/laya-decision-model.md:1-4`: "Laya as a fast decision model inside
  phax — **not pursued** […] no use case was found where Laya improves phax."
- **E-PHAX-113** Tools not named. `grep -rIl` over `README.md`, `NEXT_STEPS.md` and `docs/**/*.md`
  finds 0 files for: Kiro, Devin, Aider, Jules, Amp, BMAD, Tessl, OpenCode, Goose, Graphite. "Cursor"
  and "Copilot" appear only as names in integration lists of the Spec Kit and OpenSpec pages and in
  `docs/ideas/openspec-inspired-ideas.md:51`.

### Evidence of real use

- **E-PHAX-114** Git history. `git log --reverse --format='%cs' | head -1` → `2026-05-11`;
  `git rev-list --count HEAD` → `2931`; `git tag | wc -l` → `58`; first tag `v0.1.0` on 2026-06-16,
  latest `v0.42.0` on 2026-11-22 (`git for-each-ref --sort=creatordate refs/tags`). Seventeen tags fall
  between 2026-10-24 (`v0.26.0`) and 2026-11-22 (`v0.42.0`).
- **E-PHAX-115** GitHub. `gh api repos/lbdremy/phax` → `{"created_at":"2026-05-11T09:19:07Z",
  "forks":2,"open_issues":2,"stars":2,"visibility":"public","watchers":0}`. `gh release list --limit 8`
  → v0.42.0 (2026-11-22, Latest), v0.41.0 (11-20), v0.40.0 (11-19), v0.39.0 (11-17), v0.38.0 (11-14),
  v0.37.0 (11-13), v0.36.0 (11-10), v0.35.0 (11-07). `gh api search/issues` → 261 pull requests, 241
  merged, 1 issue. `gh api repos/lbdremy/phax/contributors` → one human account with 2,925
  contributions, and `claude` with 3.
- **E-PHAX-116** Artifacts written. `ls | wc -l` and frontmatter `status:` counts: `docs/specs/archive`
  107 specs (83 Completed, 24 Abandoned); `docs/plans/archive` 183 plans (165 Completed, 18 Abandoned);
  `docs/specs` 7 live (5 Approved, 2 Draft); `docs/plans` 3 live (all Approved); `docs/briefs` 32 live
  files (two of them plan briefs), `docs/briefs/archive` 137 files; `docs/releases` 15 release notes
  (0.28.0 to 0.42.0).
- **E-PHAX-117** Records branch. `phax.json` `records.destination`: a dedicated records repository
  (`kind: "repo"`), `transcript: true`, `autoPush: true`. The branch is therefore not in this
  repository: `git log phax/records/v1` and `origin/phax/records/v1` both fail here, and `gh api
  repos/lbdremy/phax/branches/phax%2Frecords%2Fv1` answers "Branch not found". Outside the repository,
  the local records clone `/Volumes/Work/.phax/records/phax`: `git rev-list --count phax/records/v1` →
  `888` commits, from 2026-08-21 to 2026-11-24. By commit subject: 503 phase records, 189 authoring,
  80 review, 54 finding, 52 decision, 10 revision. Distinct `Run-Id` trailers: 103.
- **E-PHAX-118** Records on 2026-11-04. `spikes/harness-data/README.md:23`: "on 2026-11-04 it held 485
  commits, 77 runs, 526 transcripts."
- **E-PHAX-119** Model policy tracking table. `NEXT_STEPS.md:300-351`: "Since `planning-skill-defaults`,
  phases default to `claude-sonnet-5-5` at `medium`, where they used to default to `claude-opus-5-5`.
  One row per run, to judge whether the policy holds." 40 rows, 2026-10-20 to 2026-11-10. Computed from
  the first dollar figure of each row's "Phase cost" column: sum $792.44, median $13.79, mean $19.81,
  minimum $0.96 (`architecture-report-parts`, 1 × sonnet-5-5 / medium), maximum $98.04
  (`effect-4-migration` plan 3). Review defects summed over the 40 rows: 106 attributed to the plan,
  160 to execution. Models in the rows: `claude-sonnet-5-5` at medium or high, `claude-opus-5-5` at
  medium or high "with a reason", one `claude-haiku-5-5` phase. Sample rows: `architecture-provider`
  (#148) "2 × sonnet-5-5 / medium | $2.66 | 2 / 3"; `command-contracts` plan 4 (#188) "$56.28";
  `structured-output` plan 2 (#176) "$10.72 ($8.05 for the phases, paused once on the usage limit […];
  $2.12 for the code review)".
- **E-PHAX-120** Cost ledgers, outside the repository. `/Volumes/Work/.phax/cost-ledgers/phax.*.json`:
  182 ledgers (one per pruned or backfilled run of the phax namespace). Summed with a script over
  `entries[].costUsd`: $2,514.17 API-list in total, median $9.98 per ledger, mean $13.81, maximum
  $98.04; 1,910 entries, all `provider: "claude-code"`, ended between 2026-05-28 and 2026-11-23.
  Entries by role: 803 phase, 783 handoff, 141 compliance, 140 fix, 38 code-review, 5 first-turn. Cost
  by model: `claude-opus-5-5` $1,089.64, `claude-sonnet-4-6` $476.79, `claude-sonnet-5-5` $433.81,
  `claude-sonnet-5` $262.19, `claude-opus-4-8` $124.93, `claude-opus-4-7` $83.33, `claude-fable-5`
  $18.47, `claude-opus-5` $15.12, `claude-haiku-4-5-20251001` $9.44, `claude-haiku-5-5` $0.44. The
  ledger covers Claude Code only (E-PHAX-40), and the dollars are API-list, not the subscription bill
  (E-PHAX-13).
- **E-PHAX-121** phax runs on itself. `phax.json`: `"name": "phax"`, a `standard` gate profile of 13
  steps (format, typecheck, type tests, lint, tests, knip, architecture audit, catalog check; terminal
  build, site build and two Deno smoke steps), `review.compliance.enabled` and `review.code.enabled`
  true, `publish.auto` true, 13 `protectedPaths` entries, an `acceptance` provider. Local worktrees of
  a run in progress: `git worktree list` shows four phase worktrees of `phax.launcher-release-fixes`.
- **E-PHAX-122** Code size. `find src -name '*.ts' | wc -l` → 603; `find tests -name '*.test.ts' | wc
  -l` → 774.
- **E-PHAX-123** Archive size on disk. `NEXT_STEPS.md:643-645`: "Of `~/.phax/archive` (phax namespace),
  ~70 GB are archived worktrees and 0.3 GB the run folders the cockpit reads" (2026-10-04).

## Capability inventory

Everything shipped, approved, briefed or merely noted as an idea, with its real status. "Person" and
"agent" in the last column of the brief rows say whom the brief names as the beneficiary.

### Shipped

| Capability | Moment | Status | Evidence |
| --- | --- | --- | --- |
| Specs and plans as Markdown artifacts with a status (`Draft`, `Approved`, `Stale`, `Completed`, `Abandoned`), each transition its own commit | author | shipped | E-PHAX-08 |
| Approval records made against a baseline commit; staleness detection (`plans status`) | author | shipped | E-PHAX-08, E-PHAX-14 |
| Named approver (`--by operator`, `--by machine:<grant>`) | author, agent surface | shipped | E-PHAX-16 |
| Headless authoring of a spec or plan from a brief, with a JSON sidecar (experimental) | author | shipped | E-PHAX-09 |
| Open questions decided on the record (`artifact decide`, interactive or from a verdicts file); approval locked while a question is open | author | shipped | E-PHAX-10 |
| Revise a headless Draft from an amendment in prose (`artifact revise`) | author | shipped | E-PHAX-11 |
| Plan lint, plan overview, both with no model | author | shipped | E-PHAX-12 |
| Plan cost estimate (P10/P50/P90, API-list dollars) and fit in the Claude subscription windows | author | shipped | E-PHAX-13 |
| Overlap check between plans, and adjusting a plan to what a run landed | author | shipped | E-PHAX-14 |
| One spec split over several plans (`completes-spec`) | author | shipped | E-PHAX-15 |
| Process and code in two repositories | author | shipped (0.40.0) | E-PHAX-17 |
| Assignment bounds: the owner holds files to a model and an effort range | author, run | shipped | E-PHAX-29 |
| Architecture provider and plan auditor hooks for planners | author | shipped | E-PHAX-31 |
| Bundled doctrine skills for decisions (`phax-decide-spec`, `-plan`, `-review`) | author | shipped | E-PHAX-49 |
| Each phase in its own Git worktree on a chained branch | run | shipped | E-PHAX-18 |
| Gate profile of the project's commands, every-phase or terminal steps, with a same-session fix loop | run | shipped | E-PHAX-18, E-PHAX-20 |
| Planned-versus-changed file reconciliation per phase and per run | run | shipped | E-PHAX-03, E-PHAX-18 |
| Handoff from each phase to the next | run | shipped | E-PHAX-18 |
| Run refused unless its plan is Approved and fresh; preflight before the run is named | run | shipped | E-PHAX-19 |
| Phase commit trailers (run, phase, model, effort, gate log) | run, keep | shipped | E-PHAX-22 |
| Resume, reset a phase, enter a phase's session, unlock | run | shipped | E-PHAX-23 |
| Interactive phases declared by the plan (`awaiting_review`, exit 13) | run, review | shipped | E-PHAX-24 |
| Hold chosen at run time (`run --hold`) | run, review | shipped | E-PHAX-25 |
| Acceptance phases: tests written first, judged twice by a provider the project configures | run | shipped | E-PHAX-27 |
| Protected paths no phase may change | run, security | shipped (0.31.0) | E-PHAX-28 |
| Three providers (Claude Code, OpenAI Codex, Mistral Vibe) behind a versioned model catalog and routing with fallback | run | shipped | E-PHAX-30 |
| Gate report steps, gate request, partial commands, brief provider, acceptance provider | run | shipped | E-PHAX-31 |
| Telemetry events, `--verbose`, `--trace`, `phax report` | run | shipped | E-PHAX-33 |
| Compliance review of the work against the plan | review | shipped | E-PHAX-03, E-PHAX-36 |
| Code review, interactive or headless and read-only, following the `phax-review` skill | review | shipped | E-PHAX-34, E-PHAX-35 |
| Finding ids given by phax and fates (`fix`, `dismiss`, `defer`, `post`) | review | shipped (0.40.0) | E-PHAX-37 |
| Pull request with a generated description and footer (`publish-pr`, GitHub) | review | shipped | E-PHAX-38 |
| Review handoff, `enter`, `shell`, `open`, `path` on the final worktree | review | shipped | E-PHAX-34 |
| `review-stop.json` and `phax ls --json` for a review UI | review, agent surface | shipped | E-PHAX-26 |
| Records on `phax/records/v1`: phase, authoring, decision, revision, review and finding-fate records; `records explain <commit>` | keep | shipped | E-PHAX-39 |
| Records branch in the same or a separate repository; transcripts refused on a public repository; never force-pushed; `records sync --replay` | keep | shipped | E-PHAX-39 |
| Cost ledger per run (Claude Code invocations); `cost backfill` | keep | shipped | E-PHAX-40 |
| Archive and prune of finished runs | keep | shipped | README.md:601-617 |
| Every persisted file stamped with `$schema`; 47 formats; older shapes still read | keep, agent surface | shipped | E-PHAX-41, E-PHAX-42 |
| `@lbdremy/phax-schemas`: read every format without phax installed | keep, agent surface | shipped | E-PHAX-42 |
| `--json` on every command, JSON message lines on stderr | agent surface | shipped | E-PHAX-45 |
| `--json-schema` contracts catalogue | agent surface | shipped | E-PHAX-46 |
| Documented exit codes, resumable ones named | agent surface | shipped | E-PHAX-47 |
| `phax --usage` command tree; shell completions | agent surface | shipped | E-PHAX-48 |
| Seven installable skills (`skills install --target claude|codex|agent`) | agent surface | shipped | E-PHAX-49 |
| `llms.txt`, `llms-full.txt` and a Markdown twin of every docs page | agent surface | shipped | E-PHAX-50 |
| "Delegating from an agent" guide | agent surface | shipped | E-PHAX-44 |
| Security modes `secure` (default) and `unsafe`; per-phase `security.json`; routing that skips providers unable to meet the mode | security | shipped | E-PHAX-53, E-PHAX-55, E-PHAX-57 |
| Command allowlist (`security.agentCommands` plus gate commands); argv-only subprocess calls; no MCP by default | security | shipped | E-PHAX-53, E-PHAX-56 |
| Config layers where a personal layer may add to an allowlist but never remove | security | shipped | README.md:190 |
| Verified binary download, npm provenance, build attestation, daily security CI | security | shipped | E-PHAX-59 |

### Approved, not yet merged or not yet run

| Capability | Moment | Status | Evidence |
| --- | --- | --- | --- |
| `launcher-release-fixes`: verified first run of the npm launcher, forwarded signals, tag-only docs redeploy, locked Deno build | security | approved; run at `review_open` locally, not merged | E-PHAX-86 |
| `security-high-fixes`: four High findings of the 2026-11-23 audits | security | approved spec and plan, to run | E-PHAX-60, E-PHAX-86 |
| `finding-fix-identity`: a fixed finding finds its commit again after a rebase, amend or squash | review, keep | approved spec, plan to author | E-PHAX-83 |
| `mistral-large-4`: catalog entry, and a disabled provider never runs | run | approved spec | E-PHAX-79 |
| `batch-execution-disjoint-plans`: disjoint plans run in parallel, ordered merge, stacked pull requests | run | approved spec, parked | E-PHAX-87 |
| smolvm isolation spike (feasibility of `isolated` mode) | security | approved plan, PR open at phase 05 | E-PHAX-87, E-PHAX-109 |

### Draft specs

| Capability | Moment | Status | Evidence |
| --- | --- | --- | --- |
| `project-doctrine`: phax's base practice apart from a project's own versioned doctrine of taste (person) | author | draft spec, 10 open questions | E-PHAX-80, E-PHAX-104 |
| `format-stability-promise`: the rules by which persisted shapes change from 1.0 (person and agent readers of the formats) | keep | draft spec, decided, parked until 1.0 is scheduled | E-PHAX-84 |

### Briefs only

| Capability | Moment | Status | For whom | Evidence |
| --- | --- | --- | --- | --- |
| `phax-do`: one task with the gate, the reconciliation and the records, no spec or plan | run | brief | agent first | E-PHAX-70, E-PHAX-95 |
| `do-attempts`: a locked acceptance contract, several parallel attempts, a mechanical choice | run | brief | agent | E-PHAX-71, E-PHAX-96 |
| `run-detach`: start a run, get its id at once, follow versioned events, read one outcome document | run, agent surface | brief | agent first, also person and script | E-PHAX-72, E-PHAX-97 |
| `phase-graph`: phases as a dependency graph, independent ones in parallel | run | brief | agent and person | E-PHAX-73, E-PHAX-97 |
| `inbox`: one versioned document of everything that waits, on whom, with next steps | agent surface | brief | agent and person | E-PHAX-74, E-PHAX-101 |
| `agent-cli-ergonomics`: a preview never exits 0, short `--help`, `ls` scoped to the project | agent surface | brief | agent | E-PHAX-75 |
| `next-steps-as-data`: every suggested command as `{ argv, why }` | agent surface | brief | agent | E-PHAX-75 |
| `claude-code-mod`: a read-only pane and band in Claude Code showing inbox, specs, plans and runs | review, agent surface | brief | person | E-PHAX-76, E-PHAX-101 |
| `knowledge-index`: a local, rebuildable SQLite index of artifacts, runs and records | keep | brief | agent and person | E-PHAX-77, E-PHAX-102 |
| `machine-slots`: bounded slots for setup and gate steps across the runs of a machine | run | brief | person running several runs | E-PHAX-78, E-PHAX-103 |
| `single-provider`: all of phax's jobs on one provider by configuration, or a named refusal | run | brief | person | E-PHAX-79 |
| `review-map`: where review attention belongs, computed with no model | review | brief, deprioritised | person and review agent | E-PHAX-81 |
| `roadmap-items`: a brief becomes an artifact with a status and a rank; votes carry evidence | author | brief, not a priority | person and agent | E-PHAX-82, E-PHAX-102 |
| `phase-handoff-answered`: the handoff as a structured answer that must justify every deviation | run | brief | person reviewing | E-PHAX-85, E-PHAX-98 |
| `gate-tolerances`: a project command that tightens protected tolerance files inside a run | run | brief | person | E-PHAX-85 |
| `protected-path-exceptions`: the operator lets one phase change a protected path, on the record | run | brief | person | E-PHAX-85 |
| `deferred-finding-files`: a deferral written and committed as its own file | review | brief | person and agent | E-PHAX-85 |
| `approval-baseline-identity`: staleness survives a rewritten baseline commit | author | brief | person | E-PHAX-85 |
| `run-start-and-base`: choose the start commit and the pull request's target branch | run | brief | person | E-PHAX-85 |
| `e2e-phax-home`, `fewer-git-processes`, `knip-production`, `lint-baseline`, `node-runtime` (on hold) | internal | brief | maintainer; "phax gains no feature" for two of them | E-PHAX-85 |

### Ideas

| Capability | Moment | Status | Evidence |
| --- | --- | --- | --- |
| OS sandbox for gate steps and allowed commands | security | idea, "to brief, a spike first" | E-PHAX-61 |
| `isolated` mode: provider CLIs in a microVM | security | idea with an approved spike plan | E-PHAX-53, E-PHAX-87, E-PHAX-109 |
| Library form, then a cloud adapter set (local and cloud modes) | run | idea, after 1.0 | E-PHAX-88 |
| Desktop or web cockpit, review by trajectory | review | idea, parked | E-PHAX-89 |
| Multi-human decision queue and proof chain | review | idea | E-PHAX-90 |
| Shared knowledge service: a team's records behind a remote MCP server | keep | idea (second milestone of a brief) | E-PHAX-77 |
| `phax autopilot`: the lifecycle in a loop from a corpus | author, run | idea, after 1.0 | E-PHAX-91 |
| Claude Code plugin shipping the skills and a live-run pane | agent surface | idea, after the 1.0 freeze | E-PHAX-91 |
| Cross-run durable context layer fed from records | keep | idea | E-PHAX-91 |
| A run amending its own plan | run | idea, not briefed | E-PHAX-91 |
| Living specs, requirement-level traceability, an explore step | author | idea | E-PHAX-91 |
| Diff budget per phase; lint refusing a phase that plans a file and its oracle | run | idea | E-PHAX-91 |
| Coverage provider | review | idea | E-PHAX-91 |
| `review-plan`: findings turned into a plan | review | idea; the doctrine skill ships, the command does not | docs/comparisons/agentic-practices.md:61 |
| Reliability over k trials; comparing two configurations on the same work | run | not built (the comparison page says "not yet") | E-PHAX-64 |

## Claims

- **C-PHAX-01** phax's shipped product is a local CLI that covers four moments (author, run, review,
  keep) around agent CLIs it starts itself, and names its category "verified delegation". Evidence:
  E-PHAX-01, E-PHAX-03, E-PHAX-06, E-PHAX-62. Confidence: high.
- **C-PHAX-02** What phax guarantees by program rather than by model judgment is a list of refusals and
  checks, each with a named mechanism (table below). Evidence: E-PHAX-02, E-PHAX-08, E-PHAX-10,
  E-PHAX-12, E-PHAX-18 to E-PHAX-22, E-PHAX-24, E-PHAX-27 to E-PHAX-29, E-PHAX-35, E-PHAX-37,
  E-PHAX-39, E-PHAX-41, E-PHAX-56. Confidence: high for what the docs state; this study did not run
  phax to test any of it.
- **C-PHAX-03** Model judgment remains in authoring, in the compliance and code reviews, in the decide
  writer and in the plan-extraction fallback, and the two reviews cannot fail a run. Evidence:
  E-PHAX-09, E-PHAX-10, E-PHAX-32, E-PHAX-36. Confidence: high.
- **C-PHAX-04** The agent-facing surface is already shipped as a contract: `--json` on every command,
  `--json-schema`, documented exit codes, `--usage`, installable skills, `llms.txt`, a delegating guide
  and a schemas package. Evidence: E-PHAX-44 to E-PHAX-50, E-PHAX-42. Confidence: high.
- **C-PHAX-05** The repository says an agent is already phax's most frequent caller, and the seven
  briefs dated 2026-11-19 are written from what an agent wants. Evidence: E-PHAX-07, E-PHAX-70 to
  E-PHAX-75. Confidence: high that the repository says so; no usage count by caller type was found.
- **C-PHAX-06** Treated as done, the live briefs would add the four things the briefs say phax lacks
  against subagents: a task with no plan (`phax-do`), a detached run with events (`run-detach`),
  parallel phases (`phase-graph`) and parallel attempts judged by a locked test (`do-attempts`).
  Evidence: E-PHAX-70 to E-PHAX-73, E-PHAX-95 to E-PHAX-97. Confidence: high on what the briefs
  describe; none has a spec, so their shape may change.
- **C-PHAX-07** Today phases run one after another, a run lives in one repository, nothing starts a run
  without a person, and `phax run` holds the caller's shell. Evidence: E-PHAX-63, E-PHAX-97.
  Confidence: high.
- **C-PHAX-08** phax supports three provider CLIs, with Claude Code as default, fallback and the only
  path the repository calls tested; Codex and Vibe are disabled until enabled. Evidence: E-PHAX-30,
  E-PHAX-68. Confidence: high.
- **C-PHAX-09** `secure` mode relies on each provider's own controls: only Codex runs commands in an OS
  sandbox, no provider filters network by domain, and `isolated` mode is refused today. Evidence:
  E-PHAX-53 to E-PHAX-55, E-PHAX-61. Confidence: high.
- **C-PHAX-10** phax is local only: no network service, no daemon, state under `~/.phax`, and the
  binary has no network permission of its own; cloud mode, a team decision queue and a cockpit are
  ideas placed after 1.0. Evidence: E-PHAX-43, E-PHAX-56, E-PHAX-62, E-PHAX-88 to E-PHAX-90.
  Confidence: high.
- **C-PHAX-11** The repository records one operator and no outside user; the only other user it
  mentions is a friend's fork used daily. Evidence: E-PHAX-92, E-PHAX-93, E-PHAX-115. Confidence: high
  for the repository's own statement, medium for the fork (one sentence, dated 2026-10-21, not
  verifiable here).
- **C-PHAX-12** phax is built with itself at volume: 2,931 commits and 58 tagged releases since
  2026-05-11, 165 completed plans and 83 completed specs, 241 merged pull requests, and 888 records
  (503 phase records over 103 runs) since 2026-08-21. Evidence: E-PHAX-114 to E-PHAX-117, E-PHAX-121.
  Confidence: high for the repository counts; the record counts come from a local clone outside the
  repository.
- **C-PHAX-13** A run on phax's own code cost a median of about $14 at API-list prices over the 40
  runs tracked from 2026-10-20 to 2026-11-10 (range $0.96 to $98.04), on Sonnet 5.5 by default with
  Opus 5.5 for phases that give a reason. Evidence: E-PHAX-119. Confidence: high (computed from the
  table); these are list prices, the operator pays a subscription.
- **C-PHAX-14** Over the 182 cost ledgers kept for phax's own runs, the total is about $2,514 at
  API-list prices, all on Claude Code. Evidence: E-PHAX-120. Confidence: medium (local files outside
  the repository; a ledger covers Claude Code only and some runs may have none).
- **C-PHAX-15** Review still finds defects after green gates: the 40 tracked runs record 266 review
  defects, 106 attributed to the plan and 160 to execution. Evidence: E-PHAX-119. Confidence: high for
  the count; the attribution is the operator's.
- **C-PHAX-16** The repository compares itself in writing to GitHub Spec Kit, OpenSpec and entire.io,
  concludes "mechanical gate against human or model gate" for the first two and "build, not adopt" for
  the third, and names no agent orchestrator, IDE agent or cloud agent product as a competitor.
  Evidence: E-PHAX-105 to E-PHAX-113. Confidence: high.
- **C-PHAX-17** The two comparison pages are dated: both were checked on 2026-10-04 against phax
  0.17.0, 25 releases before 0.42.0. Evidence: E-PHAX-105, E-PHAX-106, E-PHAX-114. Confidence: high.
- **C-PHAX-18** Release cadence is high and breaking: 17 releases in the 30 days to 2026-11-22, and
  recent release notes carry "Upgrading" sections; before 1.0 the project states it may break at every
  minor. Evidence: E-PHAX-114, E-PHAX-84 ("before 1.0 every minor may break", `NEXT_STEPS.md:375-376`),
  `docs/releases/0.41.0.md:9-14`. Confidence: high.

### Guarantees by program, and their mechanism

| Guarantee | Mechanism | Evidence |
| --- | --- | --- |
| A phase commits only when the project's gate exits green | phax runs the gate commands itself after the agent's turn; a failure goes back to the same session up to `agent.maxFixAttempts`, then the phase pauses (exit 4) | E-PHAX-18, E-PHAX-20 |
| The work never touches the user's working tree | one Git worktree and branch per phase under `~/.phax/worktrees/` | E-PHAX-18, E-PHAX-62 |
| Every file is accounted for | phax compares the files changed with the files planned and writes `file-reconciliation.json`; gaps go to the next prompt and the review | E-PHAX-03, E-PHAX-18 |
| Only an approved, unchanged plan runs | approval record against a baseline commit; a Draft or stale plan is refused with exit 12 before the run is named | E-PHAX-08, E-PHAX-19 |
| No approval while a question is open | approval lock, exit 12 | E-PHAX-10 |
| A phase cannot loosen the checks that judge it | `protectedPaths`: a change to a listed file fails the gate; `phax.json` is protected too | E-PHAX-28 |
| A phase that does nothing does not pass silently | exit 9, run stopped | E-PHAX-21 |
| Acceptance tests are not rewritten to fit the code | the project's provider judges `authored` then `passed`; only the expected-failure marks may be removed; the agent cannot run the provider | E-PHAX-27 |
| A reviewer does not change what it reviews | read-only session; a session that changed the worktree has its changes put back and its answer refused | E-PHAX-35 |
| Every finding has an id and a fate | phax, not the model, numbers findings; `finding fix|dismiss|defer` write fate records | E-PHAX-37 |
| A person's correction at a stop is gated like a phase | the close runs the gate first and commits exactly the gated tree; a closing turn that edits is refused | E-PHAX-24 |
| Model and effort follow the owner's bounds | `assignments` in `phax.json`; a departing phase without a reason is refused (exit 11) | E-PHAX-29 |
| A model's structured answer is valid or nothing is written | answer decoded against the format's schema; one corrective retry; then exit 5 | E-PHAX-09 |
| A commit can be traced to its run, phase, model and gate log | commit trailers; `records explain <commit>` | E-PHAX-22, E-PHAX-39 |
| History is kept and not rewritten | one record commit per phase on `phax/records/v1`; no force push; transcripts refused on a public repository | E-PHAX-39 |
| Every file can be read later | `$schema` stamp on every persisted file; older shapes lifted in memory | E-PHAX-41, E-PHAX-42 |
| A caller can tell what happened without reading prose | exit codes, `--json` answers, typed message lines | E-PHAX-45, E-PHAX-47 |
| No shell injection from data | every subprocess is started with an argument array | E-PHAX-56 |
| The security mode a phase ran with is recorded, and a provider that cannot meet it is skipped | `security.json` per phase; routing filter | E-PHAX-55, E-PHAX-57 |

## Constraints and non-goals

- **Local only.** A local CLI; state under `~/.phax/`; "no server, no MCP" for the planned index; the
  binary has no network permission of its own. A daemon with its own RPC was rejected in favour of a
  library form. (E-PHAX-43, E-PHAX-56, E-PHAX-62, E-PHAX-77, E-PHAX-88)
- **No IDE, no UI today.** The CLI writes files a UI can read (`review-stop.json`, `phax ls --json`).
  The cockpit is an idea, "Not an IDE, not a terminal, not a generic Kanban"; its first step is a
  read-only Claude Code mod, still a brief. (E-PHAX-26, E-PHAX-76, E-PHAX-89)
- **Three providers.** Claude Code, OpenAI Codex, Mistral Vibe; Codex and Vibe disabled by default;
  Claude Code must stay installed as the fallback; interactive decide runs on Claude Code only; the
  cost ledger covers Claude Code only; several jobs cannot reach Vibe today. (E-PHAX-10, E-PHAX-30,
  E-PHAX-40, E-PHAX-79)
- **One repository per run**, with one documented exception for artifacts: process and code may sit in
  two repositories. (E-PHAX-17, E-PHAX-63)
- **Sequential phases.** Parallelism exists only as separate runs checked with `plans overlap`, and
  the operator caps it at two code runs for machine load and subscription burn. (E-PHAX-63, E-PHAX-67)
- **No scheduler, no trigger.** A person starts every run. (E-PHAX-63)
- **Runs stay autonomous.** No agent stops a run to ask; a stop is declared by the plan or asked for by
  the operator. (E-PHAX-69)
- **Records cover phax runs only.** A session outside a run leaves no record, "by choice".
  (E-PHAX-63, E-PHAX-108)
- **Statuses.** Artifacts: `Draft`, `Approved`, `Stale` (plans), `Completed`, `Abandoned`. Runs
  (`docs/state-machine.md:59-80`): `created`, `running`, `rate_limited`, `interrupted`, `failed`,
  `review_open`, `completed`, `stopped`, `archived`, plus `awaiting_review` (E-PHAX-24). (E-PHAX-08)
- **Security modes and their limits.** `secure` is the default and is provider-native; no OS sandbox
  on Claude Code and Vibe; no domain filtering anywhere; `isolated` refused; gate steps run with the
  user's rights; the user's own Claude deny rules and hooks do not apply in headless sessions; an
  audit roadmap of six phases is open. (E-PHAX-53 to E-PHAX-55, E-PHAX-58, E-PHAX-60, E-PHAX-61)
- **Platforms.** macOS and Linux, arm64 and x64; no Windows target listed; macOS binary neither signed
  nor notarized; npm launcher needs Node 22 or later. (E-PHAX-65)
- **GitHub only** for pull requests, and `gh` must be authenticated. (E-PHAX-66)
- **Pre-1.0.** No stability contract yet: the CLI contract freeze and the format stability promise are
  the stated 1.0 work; headless authoring is marked experimental. (E-PHAX-09, E-PHAX-68, E-PHAX-84)
- **Estimate needs history.** `plans estimate` needs 60 sized phases from the repository and reasons in
  Claude subscription windows. (E-PHAX-13)
- **Ideas for cloud, desktop and team use**, none specced: a library form then a cloud adapter set
  ("It bills on the API, not on a subscription"); a review-by-trajectory cockpit; a multi-human
  decision queue; a shared read-only mirror of a team's records behind a remote MCP server; autopilot.
  (E-PHAX-77, E-PHAX-88 to E-PHAX-91)

## Users and pains in the operator's words

Who the user is, per the repository:

- A solo operator today. "The registry shows one operator across three repos" (`NEXT_STEPS.md:396`);
  "Single-maintainer, pre-1.0 project" (`docs/comparisons/spec-kit-vs-phax.md:87`). (E-PHAX-92)
- A developer who delegates and reviews. "If you've ever handed a coding agent a real task and then
  sat there watching the terminal because you didn't quite trust it to run loose — phax is for you."
  (`docs/blog/announcing-phax-1.0.md:520-521`)
- An agent as caller. "an agent is already phax's most frequent caller. It never sees the home page."
  (`docs/briefs/archive/positioning.md:17`); "Today the operator drives phax by talking to Claude Code,
  which calls the CLI." (`docs/briefs/claude-code-mod.md:3`) (E-PHAX-07, E-PHAX-101)
- Teams only in ideas. "phax lets a team pilot the trajectory of a software change"
  (`docs/ideas/decision-queue-and-proof-chain.md:22`); "The web cockpit keeps what one terminal cannot
  give — a team, history, several repositories, several engines, phax's cloud mode."
  (`docs/briefs/claude-code-mod.md:3`) (E-PHAX-90, E-PHAX-101)
- One fork user. "A friend runs a fork of phax with a \"hold mode\", which he built with phax and uses
  daily through his own review UI." (`docs/briefs/archive/interactive-phases-hold.md:5`) (E-PHAX-93)

Pains and motivations, quoted:

- **Review of one large diff.** "You get a 40-file diff and a pat on the back, and now it's *your* job
  to figure out whether any of it is right." (`docs/blog/announcing-phax-1.0.md:12-13`)
- **Babysitting.** "You end up babysitting it — watching the terminal, ready to Ctrl-C — which defeats
  the point of handing off the work in the first place." (`docs/blog/announcing-phax-1.0.md:18-19`)
- **An agent's "done" is a claim.** "A subagent's \"done\" is a claim, though: nothing checked the
  gate, nothing compared what it touched with what it meant to touch, nothing is kept."
  (`docs/briefs/phax-do.md:9-10`)
- **An agent judging its own work.** "An agent that writes the code and then the test encodes the same
  misreading in both, and everything passes." (`docs/briefs/do-attempts.md:12-13`)
- **Handoffs that overstate.** "the reviews keep tripping on handoffs that claim what is not so"
  (`NEXT_STEPS.md:161`)
- **Human attention.** "reduce the human attention required without reducing confidence in what was
  produced." (`docs/ideas/decision-queue-and-proof-chain.md:30`)
- **Cost on a subscription window.** "Before you start a run on a Claude Max subscription, two
  questions matter: what will it cost, and will it stop halfway because a window ran out?"
  (`docs/plan-estimate.md:3`); "parallel runs also drain the Max window twice as fast"
  (`NEXT_STEPS.md:22-23`); "For scale, recent all-Opus runs of 2–3 phases cost $11–13."
  (`NEXT_STEPS.md:312`)
- **Cloud would move the bill.** "It bills on the API, not on a subscription. […] local mode stays the
  cheap path for individuals." (`docs/ideas/local-and-cloud-modes.md:128-129`)
- **Ceremony for small tasks.** "For any task under an hour, an agent today picks a subagent: it starts
  at once, with no spec, no plan, no lint and no approval." (`docs/briefs/phax-do.md:7-8`)
- **A blocked caller.** "`phax run` holds the caller's shell for the whole run (an hour is common)."
  (`docs/briefs/run-detach.md:10-11`)
- **No parallelism inside a run.** "a plan of five phases where three are independent takes the time of
  five." (`docs/briefs/phase-graph.md:10-11`)
- **State spread over many commands.** "Every session that picks up the work pays that again, and a
  missed call is a missed item." (`docs/briefs/inbox.md:9-10`)
- **Remedies as sentences.** "An agent has to parse a sentence to find a command, and a sentence that
  changes breaks it silently." (`docs/briefs/next-steps-as-data.md:12`)
- **Knowledge reachable only by grep.** "Today it is reachable by grep and by reading files one by
  one." (`docs/briefs/knowledge-index.md:3`)
- **Portability of the harness.** "A harness meant to be reused across people cannot depend on what one
  person installed globally." (`docs/ideas/harness-from-records.md:42-43`)
- **Machine contention.** "a gate that passed in 4.4 min alone took 6.5 to 9.4 min on the days another
  run was working nearly all the time" (`docs/briefs/machine-slots.md:11-12`)
- **Provider choice.** "The operator asked on 2026-11-24 whether moving everything to Mistral is only a
  matter of provider settings and routing. It is not." (`docs/briefs/single-provider.md:7-8`)
- **Format ownership.** "Betting phax desktop's read path on that is the dominant loss of adopting, and
  it is no longer hypothetical." (`docs/spikes/entire-checkpoint-findings.md:250-251`)
- **Merge strategy freedom.** "so a project may merge its pull requests the way it chooses and phax's
  fates still hold." (`docs/briefs/finding-fix-identity.md:2-3`)

## Tools the repo already compares itself to

| Tool | Where | What the repository concluded | Evidence |
| --- | --- | --- | --- |
| GitHub Spec Kit (v1.1.0, checked 2026-10-04) | `docs/comparisons/spec-kit-vs-phax.md`, `README.md:24` | Same spec → plan → implement idea; its gates are human approvals and AI prompts, phax's are process exit codes in an isolated worktree. Spec Kit wins on breadth (41 integrations, about 140k stars, extension ecosystem); phax trades that for enforcement. "They are composable". | E-PHAX-05, E-PHAX-105 |
| OpenSpec (v1.14.0, checked 2026-10-04) | `docs/comparisons/openspec-vs-phax.md` | "a spec layer that stops where phax starts": specs checked mechanically, code checked by model judgment that does not block; 50 tool targets; a hosted drift checker for teams. Three ideas to borrow. | E-PHAX-106 |
| entire.io (0.10.0, spike of 2026-08) | `docs/spikes/entire-checkpoint-findings.md` | "Build, not adopt": phax already holds the transcript and makes the commit, so it writes its own records branch. Accepted loss: phax records only its own runs; entire is "a complement to add then". | E-PHAX-108 |
| smolvm | `NEXT_STEPS.md:702-715`, `docs/plans/2606291247-smolvm-isolation-spike-plan.md` | A candidate base for `isolated` mode; a spike, not adopted, PR open. | E-PHAX-87, E-PHAX-109 |
| Claude Code subagents, `Workflow` scripts, cloud agents, background commands | `docs/briefs/run-detach.md`, `phax-do.md`, `phase-graph.md` | They start at once, give the hand back and fan out; their "done" is a claim. phax gives the gate and lacks the other three today. | E-PHAX-95, E-PHAX-97, E-PHAX-110 |
| Claude Code mods and plugins | `docs/briefs/claude-code-mod.md`, `NEXT_STEPS.md:716` | A delivery surface for phax's state and skills, not a rival. | E-PHAX-76, E-PHAX-91 |
| Agentic-practice literature (Anthropic engineering posts, Böckeler, DeepMind) | `docs/comparisons/agentic-practices.md` | A practice-by-practice table with covered, partial and not yet; phax keeps the computational sensors as models improve. | E-PHAX-107 |
| Laya | `docs/ideas/laya-decision-model.md` | Declined: "no use case was found where Laya improves phax." | E-PHAX-112 |
| steme | `docs/ideas/*.md`, `NEXT_STEPS.md:598` | The operator's other project and first consumer of phax's UI ideas and gate chain; not treated as a competitor. | E-PHAX-111 |

Not named anywhere in the docs: Kiro, Devin, Aider, Jules, Amp, BMAD, Tessl, OpenCode, Goose, Graphite
(E-PHAX-113). The blog draft concedes the general field in one sentence: "Plenty of tools now run
agents in isolated worktrees and route across providers — that part isn't new."
(`docs/blog/announcing-phax-1.0.md:28`)

## Gaps

- **The records branch is not in this repository.** `phax.json` sends records to a dedicated records
  repository, so `git log phax/records/v1` fails here and the GitHub API answers "Branch not found" on
  the project's repository. The counts in E-PHAX-117 come from the operator's local clone under
  `/Volumes/Work/.phax/records/phax`. The records repository itself was not queried on GitHub.
- **Cost ledger totals are local and partial.** E-PHAX-120 reads files under
  `/Volumes/Work/.phax/cost-ledgers/`, outside the repository and not public. They cover Claude Code
  only, in API-list dollars. What the operator actually pays (subscription tier) is not stated in the
  repository.
- **No adoption data beyond GitHub counters.** Stars 2, forks 2, watchers 0. No npm download figure
  was fetched (it would be a call outside the allowed set), and no file in the repository states one.
- **The fork is one sentence.** No file names the fork, its size or its users; whether either GitHub
  fork is that fork was not checked.
- **No full run on Codex or Vibe was found on record.** The repository lists "Provider coverage on
  record" as open (`NEXT_STEPS.md:391-395`), and the 40 rows of the model policy table name Claude
  models only. The cost ledgers cannot settle it, since a ledger covers Claude Code only.
- **The comparison pages are old.** Spec Kit and OpenSpec were last checked on 2026-10-04 at phax
  0.17.0; `agentic-practices.md` was checked at 0.30.0 and still marks the finding lifecycle "not yet"
  although finding fates shipped in 0.40.0. The competitor study should not take their feature claims
  about the other tools as current.
- **`NEXT_STEPS.md` lags the artifacts in two places.** It says `launcher-release-fixes` and
  `mistral-large-4` have a "spec to author" (`NEXT_STEPS.md:62-63`, `:218`), while
  `docs/specs/2611231919-launcher-release-fixes.md` and `docs/specs/2611241412-mistral-large-4.md` are
  Approved and the first has a run at review.
- **Nothing was executed.** Every "shipped" row rests on the README, the docs and the generated CLI
  reference, not on running phax. The mechanisms in the guarantees table are the documented ones.
- **Briefs are not specs.** Each live brief opens questions for its spec (for example `run-detach`
  leaves open whether detaching is in the first slice, `docs/briefs/run-detach.md:20-23`), so "briefs
  as done" describes direction, not a fixed design. Two are explicitly deprioritised (`review-map`,
  `roadmap-items`) and one is on hold (`node-runtime`).
- **No time-to-review or review-effort measure.** The repository records review defects per run but
  not how long a person spends reviewing a run, so the "review bottleneck" pain is stated, not measured.
- **Security detail left out on purpose.** The public audit roadmap is cited at headline level only;
  the reports under `docs/security/reports/` were not read for this note, and nothing about
  third-party tools beyond `docs/security.md`'s capability table is included.
- **The 1.0 announcement is a draft.** `docs/blog/announcing-phax-1.0.md` is written for a release that
  has not happened (latest tag 0.42.0); its quotes show intent and motivation, not a shipped 1.0.
