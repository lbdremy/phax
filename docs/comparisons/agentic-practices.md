# phax and agentic engineering practice

> Where phax stands against the practices the literature on coding agents names, last checked on 2026-10-29
> against phax 0.30.0 and the sources linked below. Each row gives the practice in the words of its source, what
> phax does about it, and a status: **covered**, **partial**, or **not yet**. Only what phax ships counts as
> covered.

## The one-line position

**phax structures the work before the agent writes, and checks it with programs after.** A spec and a plan are
approved before a run starts; each phase runs in its own worktree and must pass your gates before the next one
starts; sequencing, gates, retries and state are plain code. The agent is the only non-deterministic part.

Birgitta Böckeler splits a coding agent's harness into **guides**, feedforward controls that "anticipate the
agent's behaviour and aim to steer it before it acts", and **sensors**, feedback controls that "observe after the
agent acts and help it self-correct"; each is **computational** ("deterministic and fast, run by the CPU") or
**inferential** (AI review, LLM as judge) ([Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html),
April 2026). In those terms:

| | Computational | Inferential |
|---|---|---|
| **Guides** (before) | assignment bounds, `plans lint`, the architecture and brief providers' answers | the spec and the plan, the phase prompt, the skills |
| **Sensors** (after) | the gates, the oracle step, planned-vs-done reconciliation | the compliance review, the code review |

## The loop and the harness

| Practice | What phax does | Status |
|---|---|---|
| **The agent loop**: a model using tools on the environment's feedback, in a loop ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | phax does not rebuild it. Each phase hands the loop to Claude Code, OpenAI Codex or Mistral Vibe, with the model and effort the plan gives that phase. | covered |
| **Workflows and agents**: LLMs orchestrated through predefined code paths, against agents that direct their own process (same source) | Both, at two levels: the plan is the predefined path (phases, their order, their gates); an agent works freely inside each phase. | covered |
| **Deterministic and non-deterministic instructions**: a prompt, `CLAUDE.md` or a skill is read by the model, which "decides what to do with this information"; a hook or a deny rule the harness "*has* to execute" ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)) | A gate is a command phax runs, never an instruction the agent may skip: a red gate keeps the phase from committing. A gate step can print a gate report; a finding fails the step whatever its exit code. | covered |
| Files only a person may change | An approved plan, `protected-paths`, adds a `protectedPaths` list that no phase may touch. Not shipped. | not yet |
| **Loop engineering**: "agents repeating cycles of work until a stop condition is met", turn-based, goal-based, time-based or proactive ([Getting started with loops](https://claude.com/blog/getting-started-with-loops)) | A run is a goal-based loop whose stop condition is structured: every phase through its gate, then `review_open`. Nothing starts a run on a schedule or an event without a person. | partial |

## Verification

| Practice | What phax does | Status |
|---|---|---|
| **A check that comes back pass or fail**: "Claude can close that loop itself" (best practices) | Every phase runs your gate profile's every-phase steps; the final phase also runs its terminal steps. A failure goes back to the same agent session to fix, within a fix budget; past it, the phase pauses as `gates_exhausted` for `phax resume`. | covered |
| **The task verifier, or oracle**: "it's important that the task verifier is nearly perfect, otherwise Claude will solve the wrong problem" ([Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler)) | [Oracle phases](../oracle-phases.md): one phase writes the tests a later phase must satisfy, and a provider you configure judges them twice — authored as expected failures, then discharged. | covered |
| **Saying what was not verified** | Each gate step records its surface (`local`, `structural`, `product`) and the run reports the surfaces it verified. An oracle step skipped with `--skip-oracle` is recorded as skipped, and the oracle surface leaves the verified ones. What a single check did not look at is up to that check's own report. | partial |
| **Graders by code, by model, by a person** ([Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)) | The gates grade by code; the compliance review and the code review by model; the approval of a spec or plan, and every interactive stop, by a person, named with `--by`. | covered |
| **Reliability over trials**: pass^k, the chance that all k trials succeed (same source) | A phase runs once. Nothing reruns the same phase k times to measure how reliably a plan and a model deliver it. | not yet |

## Keeping the maker apart from the judge

| Practice | What phax does | Status |
|---|---|---|
| **Agree on "done" before any code**: a planner, a generator and an evaluator agree on what done looks like for a chunk of work first ([Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)) | The spec and the plan are approved before the run, and the approval records what they were approved against; `phax plans status` marks a plan Stale when that ground changes. | covered |
| **A reviewer with fresh context**: "less biased and not influenced by the main agent's reasoning" (Getting started with loops) | The compliance review reads the work against the plan and changes nothing. `phax review-code --headless` runs in a read-only session; a session that changed the worktree has its changes put back and its answer refused. | covered |
| **The agent never edits what judges its work** | Oracle phases keep the tests apart from the phase that satisfies them. A `plans lint` rule refusing a phase that plans both a file and its own test is an idea, not shipped. | partial |
| **A finding's lifecycle**: open, resolved, dismissed, by an agent or a person | The code review writes its findings to `code-review.json`. Nothing tracks a finding from open to resolved or dismissed. | not yet |
| **Loop until the review passes**: findings turned into the next round of work | The `phax-decide-review` skill ships the doctrine for turning findings into a plan; the command that would run it, `review-plan`, is an idea. Today a person resumes the review session to fix the findings. | partial |

## Long-running work

| Practice | What phax does | Status |
|---|---|---|
| **Incremental progress, a clean state, sessions in shifts**: "work on only one feature at a time" ([Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)) | One phase, one worktree, on a branch made from the previous phase. After its gate passes, each phase writes a handoff for the next one: what it did, what it decided, what is left. `phax resume` picks a run up at its next pending phase; `phax reset-phase` runs a phase again from scratch. | covered |
| **A progress file the next session reads** (same source) | The plan is the feature list; the handoffs carry the progress. With records on, every phase leaves a commit on `phax/records/v1` — manifest, gate results, reconciliation, diff, handoff and, if you keep it, the transcript — and `phax records explain <sha>` reads it back from any commit. | covered |
| **What was planned against what was done** | phax compares the files each phase actually changed with the files it planned: planned but not done, done but not planned, deleted, renamed. The agent justifies each gap in its handoff. | covered |

## The person in the loop

| Practice | What phax does | Status |
|---|---|---|
| **Review the intent of a change, not every line**: reviewers "now examine the intent of the change" ([Redesigning source control at Anthropic](https://www.anthropic.com/research/redesigning-source-control)) | A run ends at `review_open` with a review handoff; `phax publish-pr` opens the pull request with the compliance verdict and one line per phase. | covered |
| **Stopping for a person mid-run** | A plan can declare interactive phases; `phax run --hold` stops after the headless phases you name. A stop is closed by `phax resume`, which gates the person's corrections and passes them to the next phase. | covered |
| **Decisions a person owns** | `phax artifact decide` puts a spec's or plan's open questions to the operator, or takes their verdicts from a file, and records each verdict with who gave it. | covered |

## Context and interface

| Practice | What phax does | Status |
|---|---|---|
| **Context engineering**: the smallest set of high-signal tokens ([Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) | The phase prompt carries that phase's slice of the plan. A [brief provider](../../README.md#brief-provider) answers the rules over a phase's paths (`phax brief`), and an [architecture provider](../architecture-provider.md) the repository's parts and boundaries, so the agent asks for what it needs. | covered |
| **Progressive disclosure through skills** ([Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)) | `phax skills install` puts phax's skills in your agent's own skill directory, loaded by the agent when relevant. | covered |
| **The agent-computer interface**: tools as "a contract between deterministic systems and non-deterministic agents" ([Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)) | `phax --usage` prints the whole CLI contract; `--json` outputs are versioned documents with a `$schema`; exit codes are documented. | covered |

## Models and cost

| Practice | What phax does | Status |
|---|---|---|
| **The right model for each part of the work** | The plan gives each phase its model and effort; [assignment bounds](../assignment-bounds.md) let the owner hold certain files to a model and an effort range; model routing maps a request to a provider. | covered |
| **Knowing what a run costs** | Every run keeps a cost ledger, one entry per invocation; [`phax plans estimate`](../plan-estimate.md) estimates a plan's cost before it runs. | covered |
| **Comparing configurations**: a detailed plan with a cheaper executor, against a thinner plan with a stronger one | The ledgers hold what such a comparison needs. Nothing compares two runs of the same work under two configurations. | not yet |

## Parallel and wider work

| Practice | What phax does | Status |
|---|---|---|
| **Parallel agents in their own worktrees** | Phases of a run run one after another, each on the previous one's branch. `phax plans overlap` reports which plans can run side by side without a merge conflict, as separate runs. | partial |
| **One change across several repositories** | A run lives in one repository. | not yet |
| **Every session traced, not only planned ones** | phax records its own runs. A session you run outside a run leaves no record. | not covered, by choice |

## What phax keeps as models improve

The literature asks harnesses to shed what the models no longer need: "every component in a harness encodes an
assumption about what the model can't do on its own" (Harness design for long-running application development).
The same post drops its sprints and its context resets, keeps its planner and its evaluator, and moves the
evaluator to the end of the run, where it "is worth the cost when the task sits beyond what the current model does
reliably solo". The Claude Code docs end on a table of advice to stop following; every row is a prompting habit,
and a rule that cannot bend becomes a hook or a deny rule.

phax draws the same line:

- **The computational sensors stay.** Your gates and the oracle step do not encode an assumption about the model;
  they encode what the change must pass. A better model passes them more often, so they cost fewer fix attempts.
  A model that is better at its work is also better at gaming a weak check, which is why the judge stays apart
  from the maker.
- **The inferential sensors are yours to weigh.** The compliance review and the code review are optional per
  project (`phax.json`), and each takes its own model and effort.
- **The intent stays.** The spec and the plan are the person's decision and what every check is read against.
- **The guidance is a dial.** How much the plan spells out, and which model runs each phase, is a choice of yours
  that changes with the models and their prices. A detailed plan written once by a strong model can let a cheaper
  model run the phases; a thinner plan leans more on the gates and the fix loop.
