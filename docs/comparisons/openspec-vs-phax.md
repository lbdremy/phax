# OpenSpec vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against OpenSpec v2.2.0
> (2026-11-24) — its website ([openspec.dev](https://openspec.dev)) and the
> [README](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/README.md),
> [CHANGELOG](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/CHANGELOG.md)
> and [docs](https://github.com/Fission-AI/OpenSpec/tree/v2.2.0/docs-lab) of
> `Fission-AI/OpenSpec` at that tag, which was also the head of its default
> branch — and phax 0.43.0.

## The one-line difference

**OpenSpec is a spec layer that stops where phax starts.** It structures the
upstream conversation — explore → propose → apply → archive, with an optional
verify step — as skills your agent runs inside its own tool; phax is
verified delegation: it runs your AI agent _as a subprocess_ through isolated,
mechanically gated phases and hands back facts, not claims. Same spec-driven
philosophy; very different altitude and enforcement.

## What OpenSpec is, concretely

You install the CLI (a standalone binary through
`curl -fsSL https://openspec.dev/cli/install.sh | sh` or a PowerShell installer
on Windows, npm, or Homebrew) and run `openspec init`, which scaffolds an
`openspec/` directory and installs **skills** for the agent tools you pick.
Since 2.0.0 (2026-11-11) OpenSpec _"installs skills only"_: the `/opsx:*`
command files of 1.x are no longer written. Since 2.1.0 a new project gets its
skills machine-wide by default (`--scope project` keeps them in the
repository, under `.agents/skills/`). The
[support matrix](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/docs-lab/reference/supported-tools.md)
lists 46 tools (Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Mistral
Vibe, …) and a universal `.agents/skills/` target; the README says _"30+ tools
and growing"_. Then, inside your agent, you drive the default `core` profile:

```text
/openspec-explore → /openspec-propose <idea> → human review → /openspec-apply-change → /openspec-archive-change
```

plus `/openspec-update-change` and `/openspec-sync-specs`; six optional
workflows (`openspec config profile`, then `openspec update`) add
`openspec-new-change`, `openspec-continue-change`, `openspec-ff-change`,
`openspec-verify-change`, `openspec-bulk-archive-change` and
`openspec-onboard` ([skills](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/docs-lab/reference/skills.md)).
v2.2.0 adds a router skill, `/openspec`, installed with every profile: it
_"answers, or routes the request to the skill that does the work"_. Codex
spells each invocation `$openspec-…`.

Each **change** gets a self-contained folder — `proposal.md`, `specs/`,
`design.md`, `tasks.md` — and archiving a completed change folds its deltas
(`ADDED`, `MODIFIED`, `REMOVED` and `RENAMED` requirements) back into the
shared `openspec/specs/`, which the
[glossary](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/docs-lab/reference/glossary.md)
defines as _"the current, agreed behavior of your system"_. Everything is plain
Markdown: requirements written with SHALL, each with at least one scenario in
WHEN/THEN form. Schemas (`openspec schema fork`, `openspec schema init`, marked
experimental) can reshape which artifacts a change carries.

Its README still says _"fluid not rigid"_ and _"update any artifact anytime, no
rigid phase gates"_, and the website pitches **validation and verification**:
_"The spec framework for building the right thing and building it right"_. The
structural edges are in the [CLI](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/docs-lab/reference/cli.md):

- `openspec validate` _"Checks changes and specs for structural issues."_ It
  exits 0 when every item passed and 1 when one failed, `--strict` treats
  warnings as failures, and `--json` prints one report. For a change it also
  dry-runs the archive merge and reports a conflict as `INFO`, which never
  changes the exit code. `--archived` checks that archived changes have no
  unchecked task (the CHANGELOG: _"meant for a pre-commit or CI hook"_).
- `openspec instructions apply` reports `blocked` while an artifact the schema
  requires is missing (`tasks` in the default schema), and `validate` rejects a
  change with no delta spec unless its metadata sets `skip_specs: true`.
  `archive` _"validates the change first and refuses one that fails"_, unless
  you pass `--no-validate`; _"Incomplete tasks warn but don't block."_
- `/openspec-verify-change` has the agent check the implementation against the
  change's artifacts and report a scorecard with CRITICAL, WARNING and
  SUGGESTION issues. The skills reference calls it _"report-only"_: _"It
  changes nothing and does not archive."_ It is one of the optional workflows.

The _runtime is still your agent_, working in your normal tree with its native
permissions: the CLI reference says _"Your agent runs most of these during the
workflow"_, and none of its commands implements a task or runs your tests. The
quickstart puts it this way: _"Git is a separate concern. Commit the change
folder with the code, and nothing else about your workflow changes."_ OpenSpec
touches Git and your editor at the edges:
[stores](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/docs-lab/multi-repo/stores.md)
(beta) move the `openspec/` folder into _"a repository of its own"_ that
several code repositories share, and `openspec store setup` initializes that
repository with a first commit;
[worksets](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/docs-lab/multi-repo/worksets.md)
(beta) open a store and its repositories in one VS Code or Cursor window (the
Claude Code and Codex openers are _"temporarily disabled while that flow is
reworked"_).

Two products sit beside the CLI:

- **OpenSpec Cloud Agent**, hosted. Its
  [announcement](https://openspec.dev/blog/openspec-cloud-agents) (2026-08-28)
  brought it _"into early access"_, _"starting with drift detection"_: it
  _"compares pull requests with your requirements and cites the exact lines
  when they disagree"_, and _"Outside pull requests, it scans your connected
  repositories each day. When it finds drift, it can open a corrective PR for
  your team to review."_ An update dated 2026-09-11 reads _"We’ve paused new
  signups for the Cloud Agent’s early access program"_, and nothing on the page
  read today lifts it; the home page does not mention the Cloud Agent. The
  announcement shows a finding as a pull request check and does not say whether
  one blocks a merge.
- **OpenSpec Desktop**, an app in
  [early beta](https://openspec.dev/blog/openspec-desktop) since 2026-10-31,
  _"macOS only (Apple silicon), Windows soon"_. It needs the CLI installed and
  a GitHub sign-in, and _"works with Claude Code, Codex, GitHub Copilot, and
  OpenCode"_: you explore, draft and review a change in the app, _"Then choose
  your coding agent and click Build to apply it."_

It is MIT-licensed, with anonymous telemetry on by default (_"only command
names and version"_, _"Automatically disabled in CI"_) and an opt-out. The
repository has 75,689 stars and 5,178 forks, and npm counts 5,663,236 downloads
of the package for the 30 days to 2026-11-23.

## What phax is, concretely

A compiled CLI (Node launcher + Deno-compiled binary, Effect / TypeScript)
that **drives** an AI coding agent (Claude Code by default; Codex and Mistral
Vibe once enabled) through isolated, gated phases. You write a spec and a
`plan.md` — by hand with the bundled skills, or headlessly with `phax artifact
new spec|plan --headless --brief` — decide their open questions on the record
and approve them. `phax run` refuses a plan that is not Approved or has gone
Stale, then executes each phase in its **own git worktree**, runs a mechanical
**gate profile** after each phase with a same-session fix loop, reconciles the
planned files against the actual diff, and stops at `review_open` with a review
handoff, an optional compliance review, an optional read-only code review and
an optional GitHub PR. Every review [finding](../findings.md) gets an id and a
fate: fixed, dismissed or deferred. A plan can put its
[acceptance tests](../acceptance-phases.md) first, judged by a provider you
configure, and can declare stops for a person's review. With records turned on,
every phase leaves its manifest, gate results, reconciliation, diff, handoff
and transcript on a `phax/records/v1` branch; every run keeps a cost ledger,
and [`phax plans estimate`](../plan-estimate.md) prices a plan before it runs.
Every command answers [JSON with a schema](../json-output.md) under `--json`.
phax _is_ the runtime; it spawns the agent headlessly.

## Side-by-side

| Axis                               | OpenSpec                                                                                                                                                                                                                                                                             | phax                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**                     | Spec framework: a CLI plus skills your agent runs; a desktop app in early beta                                                                                                                                                                                                       | A compiled CLI that drives the agent through an approved plan                                                                                                                                                                    |
| **Unit of work**                   | One change: a folder with a proposal, delta specs, a design and a task checklist                                                                                                                                                                                                     | One approved plan, run phase by phase, each phase with the files it declares                                                                                                                                                     |
| **Runtime**                        | Your AI agent is the runtime; the CLI hands it instructions and checks the documents                                                                                                                                                                                                 | phax is the runtime; it spawns the agent headlessly                                                                                                                                                                              |
| **Rigor**                          | Structural: `validate` (exit 0 or 1, `--strict`), apply blocked while `tasks.md` is missing, `archive` refuses a change that fails validation. The implementation check is the optional, report-only `/openspec-verify-change`                                                       | **Mechanical** gate profile (your real `pnpm test`/lint/build) after every phase + same-session fix loop; a phase commits only on green; explicit state machine                                                                  |
| **Git**                            | "Git is a separate concern": the agent edits your working tree and you commit the change folder with the code                                                                                                                                                                        | Worktree per phase, chained phase branches, planned commit messages with trailers, built-in `publish-pr`                                                                                                                         |
| **Verification**                   | `validate` checks the documents; `/openspec-verify-change` and the Cloud Agent compare code with spec by model judgment; no CLI command runs your tests                                                                                                                              | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, compliance review against the plan, acceptance tests judged by a program, protected paths                                                           |
| **Review and findings**            | The verify report: a scorecard and CRITICAL, WARNING and SUGGESTION issues, given in the conversation (the skill writes no file); Cloud Agent findings shown as a pull request check                                                                                                 | Compliance review and read-only code review; every finding gets an id (`C1`, `F2`) and a recorded fate: fixed, dismissed or deferred                                                                                             |
| **Isolation/Safety**               | Not described in the pages read: the agent works in your tree with its own permissions                                                                                                                                                                                               | Worktree always; secure by default: provider-native filesystem jail, command allowlist, no MCP, routing that skips providers unable to enforce the mode. No container or VM mode                                                 |
| **Model choice**                   | A recommendation in the README ("Codex 5.5 and Opus 4.7")                                                                                                                                                                                                                            | Model + effort per phase in the plan, versioned model catalog, provider priority and fallback, owner bounds per file                                                                                                             |
| **Parallelism**                    | Not managed: several changes can be active at once, and what runs in parallel is the agent tool's business                                                                                                                                                                           | Sequential phases; separate runs side by side once `plans overlap` says they are disjoint                                                                                                                                        |
| **A person in the work**           | "you review the plan before any code is written"; skills pause and ask; a change's metadata has no approval or status field                                                                                                                                                          | Approvals by a named approver before a run; interactive phases declared by the plan, or `run --hold` (exit 13, then resume); review at the end                                                                                   |
| **Spec model**                     | Living specs: `openspec/specs/` holds each capability's current behavior; a change carries deltas, merged on archive or by `/openspec-sync-specs`                                                                                                                                    | A spec describes one piece of work and is archived once Completed. No living spec, no delta merge                                                                                                                                |
| **Multi-plan and multi-repo work** | `status --all` over active changes; stores (beta): one planning repository shared by several code repositories, `--store <id>` on commands; worksets (beta)                                                                                                                          | `plans overlap` / `plans status` / `plans lint` / `adjust-plan`: parallel-safety, staleness, drift after a landed run. One process repository can hold the specs and plans of one code repository; a run lives in one repository |
| **Artifact lifecycle**             | Active `changes/` → `changes/archive/YYYY-MM-DD-<name>/`, main specs updated on archive; any artifact editable at any time                                                                                                                                                           | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), auto-committed, approvals recorded against a baseline; an unapproved or stale plan is refused                                                                  |
| **Authoring**                      | Inside your agent (`/openspec-explore`, `/openspec-propose`, or the `/openspec` router); schemas change the artifacts (experimental)                                                                                                                                                 | Inside your agent with the `phax-spec`/`phax-planning` skills, or headlessly (`artifact new --headless`, experimental); open questions decided on the record                                                                     |
| **Records**                        | Archived change folders in your repository: proposal, design, tasks and deltas                                                                                                                                                                                                       | One commit per phase on `phax/records/v1` in your Git: gates, reconciliation, diff, handoff, optional transcript; `records explain <commit>`                                                                                     |
| **Cost**                           | Not described in the pages read; your agent tool bills as usual                                                                                                                                                                                                                      | Your provider's subscription or API bill; cost ledger per run in API-list dollars (Claude Code invocations); `plans estimate` before the run; no ceiling                                                                         |
| **Interface for an agent caller**  | Skills first; `--json` on the workflow commands, "exactly one JSON document" per call, exit 0 or 1; "Only `validate` output carries a `version` field" ([agent contract](https://github.com/Fission-AI/OpenSpec/blob/v2.2.0/docs/agent-contract.md), audited 2026-06-11); `llms.txt` | `--json` on every command with a published schema, `--json-schema` contracts, an exit code per outcome, `phax --usage`, installable skills, `llms.txt` ([Delegating from an agent](../delegating.md))                            |
| **Agents**                         | Broad: 46 tools in the support matrix, plus a universal `.agents/skills/` target                                                                                                                                                                                                     | Claude Code (default), Codex, Mistral Vibe                                                                                                                                                                                       |
| **Hosted and UI**                  | OpenSpec Cloud Agent: drift checks on pull requests and daily scans (early access, new signups paused); OpenSpec Desktop (early beta, macOS)                                                                                                                                         | None — local only, no UI; state under `~/.phax/`                                                                                                                                                                                 |
| **Footprint**                      | MIT; standalone binary for macOS, Linux and Windows, or npm/Homebrew; anonymous telemetry on by default (opt-out); 75,689 stars                                                                                                                                                      | Apache-2.0; npm launcher that downloads a binary; macOS and Linux; GitHub for pull requests; published `@lbdremy/phax-schemas` for reading its files; single-maintainer, pre-1.0 project (0.43.0)                                |

## The key distinction

The workflows _rhyme_ — both are "agree on what to build before code is
written," with Markdown artifacts in the repo and a human review point. And
OpenSpec has moved toward phax's ground: its website now says it helps you
_"verify that the implementation matches"_ as well as specify. The difference
is **what a verification is made of**:

- **OpenSpec** checks the _documents_ mechanically (`validate` is a real exit
  code, and `archive` refuses a change that fails it) and checks the _code_ by
  judgment: `/openspec-verify-change` and the Cloud Agent ask a model whether
  the implementation matches the spec, and report. The verify skill is optional
  and report-only; the Cloud Agent's announcement does not say that a finding
  blocks a merge. Predictability comes from a precise, validated spec layer and
  people reading the findings.
- **phax** checks the _code_ mechanically: phases only advance when your real
  checks exit green, work happens in isolated worktrees, and the plan is
  reconciled file-by-file against the actual diff, with every deviation
  surfaced and recorded. Model judgment (the compliance review, the code
  review) sits on top of that evidence rather than in place of it, and each of
  its findings gets a recorded fate.

So OpenSpec is closer to a **spec discipline with V&V tooling** you layer onto
any agent; phax is **verified delegation**, closer to a build system with
CI-style gates for agent work.

## Where OpenSpec is ahead today

- **Tool targets.** 46 tools in the support matrix and a universal
  `.agents/skills/` target. phax drives three: Claude Code, Codex and Mistral
  Vibe.
- **Living specs.** `openspec/specs/` states what each capability does today,
  and archiving a change merges its requirement deltas into it. A phax spec
  describes one piece of work; no phax document states the system's current
  behavior, and nothing folds a completed spec into one.
- **Requirement-level structure.** The CLI parses requirements and scenarios
  (`openspec show --json`), and a delta names the requirement it adds, changes,
  removes or renames. phax reconciles a plan with its diff file by file.
- **An explore step.** `/openspec-explore`, in the default profile, thinks an
  idea through against the code before any artifact is written. phax's bundled
  skills start at the spec.
- **Revising a plan while it is being built.** `/openspec-update-change`
  revises a change's artifacts at any time. `phax run` refuses a plan whose
  text changed after its approval, until the plan is approved again.
- **Custom artifact schemas.** `openspec schema fork` and `openspec schema
  init` (experimental) change which documents a change carries, their order
  and their templates. phax has one spec format and one plan format.
- **Stores across repositories.** One planning repository shared by several
  code repositories (beta), with worksets to open them together. phax links
  one process repository to one code repository, and a run lives in one
  repository.
- **A hosted drift checker.** The OpenSpec Cloud Agent compares pull requests
  with the requirements, scans connected repositories daily and can open a
  corrective pull request (early access, new signups paused). phax has no
  hosted service, and nothing in it compares the code with a spec after the
  run's pull request is merged.
- **A desktop app.** OpenSpec Desktop, in early beta on macOS. phax has no UI.
- **Windows.** A standalone binary and a PowerShell installer. phax runs on
  macOS and Linux.
- **Adoption.** 75,689 stars and 5,178 forks; 5,663,236 npm downloads in the
  30 days to 2026-11-23; the
  [Thoughtworks Technology Radar](https://www.thoughtworks.com/radar/tools/openspec)
  moved it from Assess (April 2026) to Trial (November 2026). phax has a single
  maintainer.

## When each fits

- **OpenSpec** if you want a lightweight, configurable, agent-agnostic spec
  convention that meets you where you already work, across many assistants,
  with living specs, spec validation in CI and people reading the verify
  findings — and, for teams, shared stores and a hosted drift checker (in
  early access, with new signups paused).
- **phax** if you want mechanical gates, worktree isolation, a restricted agent
  session, provider routing, and a deterministic, auditable trajectory
  (reconciliation + records + compliance report + findings with a fate + PR) —
  i.e., you trade agent-breadth, living specs and lightness for enforcement and
  evidence.

## Two things worth noting

1. **They are composable, and phax already mirrors OpenSpec's front half.**
   phax's `phax-spec` and `phax-planning` skills (or `artifact new
   --headless`) play the role of `/openspec-propose`'s spec and task outputs —
   EARS requirements in `docs/specs/`, a phased `plan.md` in `docs/plans/`,
   with an explicit approval/staleness lifecycle on top. You could converge on
   intent OpenSpec-style and execute through phax's gated phases — spec
   discipline on the front, mechanical execution on the back. Nothing ships
   for that today: phax does not read an `openspec/changes/` folder, so the
   phax spec and plan would be written from the OpenSpec change by you or your
   agent.
2. **Relative to Spec Kit** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md)): both started at the same
   altitude — prompt/artifact conventions run inside your agent — and both have
   since grown toward execution in different directions. OpenSpec added
   validation, an advisory verify step, a hosted drift checker and a desktop
   app; Spec Kit added a workflow runner that can run the agent headlessly
   with human gates and shell steps. Neither isolates the work or gates each
   step on your test suite by default; that layer is what phax adds.

## Next steps

Ideas phax could borrow from OpenSpec — living specs with requirement-level
delta folding, requirement-level traceability for `plans overlap` and the
compliance review, and an explicit explore step — are captured for later
brainstorming in
[`../ideas/openspec-inspired-ideas.md`](../ideas/openspec-inspired-ideas.md).
