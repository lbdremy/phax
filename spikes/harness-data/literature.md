# Harness engineering, self-improvement and harness evaluation: literature review for phax

Compiled 2026-11-04. Each source was checked against its primary page (arXiv abstract or
official post) unless marked _secondary_. Numbers come from abstracts or official posts.
Where I could only reach secondary coverage, the entry says so.

---

## 1. Harness and context engineering: what makes a harness better

**Anthropic: "Effective harnesses for long-running agents"** (Justin Young, 2025-11-26)
https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
The harness has two roles. An initializer agent writes `init.sh`, a progress log and a JSON
feature list with every feature marked failing. A coding agent then completes one feature per
session, commits, and updates the progress log. The coding agent may only flip the `passes`
field and may never edit tests. JSON was chosen because models damage it less than Markdown.
Each session starts the same way: read the git log and progress file, run init, run a smoke
end-to-end test. The post names four failure modes, each with its fix: declaring victory too
early, leaving broken or undocumented state, marking features done without an end-to-end
check, and wasting time working out how to run the app.
_For phax:_ phax already has the shape this post recommends (phases, gates, handoff notes,
worktrees). The named failure modes can serve as transcript-labelling categories, for example
"phase claimed done but gate failed" and "next phase spent N turns re-deriving the setup".

**OpenAI: "Harness engineering: leveraging Codex in an agent-first world"** (Ryan Lopopolo, Feb 2026)
https://openai.com/index/harness-engineering/ (the primary page returned 403 to my fetch;
details come from InfoQ, https://www.infoq.com/news/2026/02/openai-harness-engineering-codex,
and other _secondary_ summaries)
OpenAI built an internal product of roughly 1M lines that the agents wrote. AGENTS.md is a short
map (about 100 lines) pointing into a structured `docs/` tree, which is the system of record.
Layer boundaries are enforced by structural tests and custom linters whose error messages carry
remediation instructions into the agent's context. The app boots per worktree so the agent can
drive and observe its own instance. Background "garbage collection" agents scan for drift and
open small cleanup PRs. When the same human feedback recurs, the rule is promoted from prose
into a lint or tool.
_For phax:_ recurring review findings and recurring gate failures should become mechanical
checks, not more prompt text. That promotion path is itself a measurable output of the harness.

**Böckeler: "Harness engineering for coding agent users"** (martinfowler.com, 2026-04-02)
https://martinfowler.com/articles/harness-engineering.html
Controls come in two kinds. Guides (feedforward: AGENTS.md, skills, codemods) act before the
agent does. Sensors (feedback: linters, structural tests, AI review) act after. Each control is
either computational (deterministic and cheap) or inferential (LLM judgment). Feedback alone
gives an agent that repeats its mistakes; feedforward alone gives rules nobody checks. The
"steering loop": whenever an issue recurs, improve a guide or a sensor so it becomes less likely
or impossible. Sensor output should be written for an LLM reader.
_For phax:_ phax gates are computational sensors and the review phase is an inferential sensor.
A harness change can be classified by which control it adds or tightens.

**Anthropic: "Effective context engineering for AI agents"** (Sep 2025)
https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
The goal is the smallest set of high-signal tokens that makes the desired outcome likely. The
post covers just-in-time retrieval instead of preloading, token-efficient tool results,
compaction, structured note-taking and sub-agent isolation. (I reached this through search
snippets plus the official URL.)
_For phax:_ handoff notes and the phase prompt are phax's context budget. Measure their size
against downstream usefulness.

**Manus: "Context Engineering for AI Agents: Lessons from Building Manus"** (Yichao Ji, 2025-07-18)
https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
The post calls KV-cache hit rate the single most important production metric, given a 100:1
input:output token ratio and cached tokens costing about 10x less. Its practices: keep the
prompt prefix stable (no timestamps), keep context append-only with deterministic
serialization, mask tools instead of removing them, use the filesystem as external memory, and
keep failed actions in context so the model learns from them.
_For phax:_ cache-read share is a cheap harness-health metric phax can compute from its
stream-json usage records. A drop after a prompt change is a cost regression even when pass
rate holds.

**LangChain: "Context engineering for agents"** (2025-07-02)
https://www.langchain.com/blog/context-engineering-for-agents
The post sorts context engineering into four strategies: write (scratchpads and memory outside
the window), select (retrieve what is relevant), compress (summarise or trim) and isolate
(sub-agents, sandboxes).
_For phax:_ these four are a useful vocabulary for labelling any harness change.

**Anthropic: "Equipping agents for the real world with Agent Skills"** (2025-10-16)
https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
A skill is a folder holding SKILL.md, scripts and resources, loaded by progressive disclosure:
only the name and description sit in context until the skill triggers.
_For phax:_ skills are the natural unit in which a learned per-project lesson ships. They can be
versioned, diffed and turned on or off for an A/B comparison.

**Anthropic: "Writing effective tools for agents — with agents"** (2025-09-11)
https://www.anthropic.com/engineering/writing-tools-for-agents
The loop: generate realistic eval tasks with verifiable outcomes, run them, track accuracy,
runtime, tool-call count, tokens and tool errors, read the transcripts, paste the transcripts
into Claude Code to refactor the tools, and confirm on a **held-out** task set.
_For phax:_ this is the closest published recipe for "agent improves the harness from its own
transcripts, guarded by a holdout".

---

## 2. Evaluating agents and harnesses

**Anthropic: "Demystifying evals for AI agents"** (2026-01-09)
https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents

- Graders come in three kinds: code (preferred), model (needs calibration against humans) and
  human (the gold standard, used for calibration).
- Grade the outcome where possible, not the path taken, so creative solutions are not penalised.
- pass@k means at least one success in k trials. pass^k means all k trials succeed, which
  measures consistency.
- Capability evals start with a low pass rate. Regression evals should sit near 100% and
  guard against backsliding. A capability eval that saturates graduates into the regression
  suite.
- Read transcripts before trusting a score. Fixing grading bugs moved Opus 4.5's CORE-Bench
  score from 42% to 95%.
- Start with 20–50 tasks drawn from real failures, and give every trial a clean environment.
- The agent being evaluated is the harness plus the model.
  _For phax:_ a phase is a natural trial. Gate pass is a deterministic outcome grade. Review
  findings are a model-graded signal that needs calibration.

**Anthropic: "Quantifying infrastructure noise in agentic coding evals"** (Gian Segato, 2026-02-05)
https://www.anthropic.com/engineering/infrastructure-noise
On Terminal-Bench 2.0, resource configuration alone moved scores by 6 points (p<0.01). Naive
binomial confidence intervals are already 1–2 points wide, and gaps under about 3 points
deserve skepticism unless configurations match. Time limits, concurrency, API latency and time
of day also confound results. Treat resources as an experimental variable, run on several
days, and report the configuration.
_For phax:_ with small task counts on one machine, most "improvements" will sit inside the
noise. Record the environment (machine, concurrency, provider version) with every run.

**Hamel Husain & Shreya Shankar: Evals FAQ, error analysis** (2025–2026)
https://hamel.dev/blog/posts/evals-faq/why-is-error-analysis-so-important-in-llm-evals-and-how-is-it-performed.html
https://hamel.dev/blog/posts/evals-faq/what-parts-of-evals-can-be-automated-with-llms.html
The method has four steps. Gather real traces. Open-code them: free-text notes, usually on the
_first_ failure in each trace. Axial-code the notes into a failure taxonomy. Count each
category. Hand-code the first 30–50 traces before letting an LLM cluster the rest, and never
delegate the initial open coding. Build evaluators only for the failure modes found this way.
_For phax:_ the open-coding unit should be the phase transcript plus its gate log. The
taxonomy that comes out of it is the list of metrics worth automating.

**Shankar et al.: "Who Validates the Validators?"** (UIST 2024)
https://arxiv.org/abs/2404.12272
Criteria drift: people only learn their grading criteria by grading outputs, and the criteria
shift when the pipeline changes. EvalGen picks LLM or code evaluators by how well they agree
with a small set of human grades.
_For phax:_ any LLM judge over phax transcripts (for example "was the handoff note useful?")
must be checked for agreement with the maintainer's own labels, and re-checked after model
swaps.

**Kapoor et al.: "AI Agents That Matter"** (2024-07-01)
https://arxiv.org/abs/2407.01502
Optimising for accuracy alone produced needlessly costly agents. Cost and accuracy should be
optimised jointly. Many benchmarks lack proper holdouts, which leads to overfitting and
shortcuts.
**Kapoor, Stroebl et al.: "Holistic Agent Leaderboard (HAL)"** (ICLR 2026)
https://arxiv.org/abs/2510.11977 · https://hal.cs.princeton.edu/
HAL ran 21,730 rollouts across 9 models and 9 benchmarks with automated log analysis. The most
expensive models rarely sit on the cost-accuracy Pareto frontier. Scaffold choice drastically
changes both accuracy and cost. Higher reasoning effort _reduced_ accuracy in most runs. Log
analysis caught agents taking shortcuts.
_For phax:_ phax records model, effort and cost per phase, so it can plot its own Pareto
frontier per phase type. Don't assume higher effort is better.

**Terminal-Bench** (arXiv 2601.11868, Jan 2026)
https://arxiv.org/abs/2601.11868
The benchmark has 89 hard command-line tasks and uses the Terminus 2 scaffold as a neutral
harness for comparing models.
**Han & Sun: "How good is your harness?"** (ICML 2026 workshop poster)
https://icml.cc/virtual/2026/68323
A statistical decomposition of Terminal-Bench 2.0 scores into LLM effect and harness effect.
Picking the best harness gains about as much as picking the best LLM, and harness effects
interact with the model: some harnesses suit some LLMs better.
_For phax:_ phax drives three providers, so a harness change can help one provider and hurt
another. Evaluate per provider (as an interaction term), not pooled.

**SWE-agent: Agent-Computer Interfaces** (Yang et al., 2024)
https://arxiv.org/abs/2405.15793
The paper is the early demonstration that the interface design (commands, feedback format,
linting on edit) changes resolve rates with the model held fixed.

**Fan et al., SWE-Effi** and related cost studies (_secondary_, via search snippets): token use
snowballs because input grows with every call, and failing runs cost up to about 4x what
successful runs cost. I could not confirm the arXiv ID from the primary page, so it is left out.

---

## 3. Self-improving harnesses from experience

| Work                                                           | What is learned                                                                                                            | How regression is (or isn't) prevented                                                                                                                                                                                                                                                                                                                     | URL                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Meta-Harness** (Lee, …, Khattab, Finn; 2026-03-30)           | Harness _code_: what to store, retrieve and show the model                                                                 | An outer loop: a coding agent reads a filesystem holding all prior candidate harnesses, their **scores and full execution traces**, then proposes a new harness, which is evaluated and logged. Beats hand-built harnesses on TerminalBench-2. Its claim: uncompressed access to traces is what makes this work.                                           | https://arxiv.org/abs/2603.28052                                                                       |
| **AutoSaddler** (Park et al., Microsoft; 2026-08-24)           | Harness patches (prompts, tool config, control logic) treated as code                                                      | Mini-batch failure diagnosis → targeted structured patches → **validation-based, generalization-aware selection** ("durable updates") instead of repairs that only fit one trajectory. +9–10 points on GAIA2, SWE-Bench Pro and Terminal-Bench 2.0. Ablations: deep debugging, constrained edits and generalization-aware selection each matter.           | https://arxiv.org/abs/2608.23041                                                                       |
| **ACE: Agentic Context Engineering** (ICLR 2026)               | An evolving "playbook" of itemised bullets (strategies, failure modes)                                                     | Generator → Reflector → Curator. **Delta updates** merged by non-LLM logic. Each bullet carries helpful/harmful counters, and embedding-based dedup prunes duplicates. Rewriting the whole context causes "context collapse": in one AppWorld case, 18,282 tokens at 66.7% accuracy shrank to 122 tokens at 57.1%, below the 63.7% no-adaptation baseline. | https://arxiv.org/abs/2510.04618                                                                       |
| **Dynamic Cheatsheet** (Suzgun et al., 2025-04)                | A test-time memory of strategies and code snippets                                                                         | No labels needed; the model curates the memory itself. Large gains on tasks with reusable solutions (Game of 24: 10%→99%).                                                                                                                                                                                                                                 | https://arxiv.org/abs/2504.07952                                                                       |
| **GEPA** (Agrawal et al., ICLR 2026 oral)                      | Prompts, by reflective natural-language mutation                                                                           | A **Pareto frontier of candidates** across task instances, so a prompt that wins on a subset is kept rather than averaged away. Beats GRPO with up to 35x fewer rollouts.                                                                                                                                                                                  | https://arxiv.org/abs/2507.19457                                                                       |
| **Agent Workflow Memory** (Wang, Mao, Fried, Neubig; 2024-09)  | Reusable workflows induced from past trajectories                                                                          | Offline and online induction. +24.6% and +51.1% relative on Mind2Web and WebArena, with fewer steps.                                                                                                                                                                                                                                                       | https://arxiv.org/abs/2409.07429                                                                       |
| **SICA: A Self-Improving Coding Agent** (Robeyns et al., 2025) | The agent's own code and tools                                                                                             | Benchmark-driven selection. 17%→53% on a SWE-bench Verified subset.                                                                                                                                                                                                                                                                                        | https://arxiv.org/abs/2504.15228                                                                       |
| **Darwin Gödel Machine** (Zhang, Hu, Lu, Lange, Clune; 2025)   | The agent's own code                                                                                                       | An **archive** (tree) of agent variants with empirical benchmark validation instead of proofs, run with sandboxing and human oversight. SWE-bench 20%→50%.                                                                                                                                                                                                 | https://arxiv.org/abs/2505.22954                                                                       |
| **SWE-Exp** (Chen et al., 2025)                                | A multi-level experience bank from successful _and failed_ repair trajectories                                             | Experience retrieved per issue. Reports 73.0% on SWE-bench Verified with Claude 4 Sonnet.                                                                                                                                                                                                                                                                  | https://arxiv.org/abs/2507.23361                                                                       |
| Foundations (pre-2024)                                         | Reflexion (verbal self-reflection memory), ExpeL (insights from success/failure pairs), Voyager (executable skill library) | Each validates learned items by later task success                                                                                                                                                                                                                                                                                                         | https://arxiv.org/abs/2303.11366 · https://arxiv.org/abs/2308.10144 · https://arxiv.org/abs/2305.16291 |

**Caution, VibeMemBench** (Fan et al., 2026-09-20)
https://arxiv.org/abs/2609.23570
The benchmark has 111 targets from 90 repositories and 3,634 history trajectories. Injecting
_verified_ useful history directly helps 4 of 5 solvers by 1.1–4.5 points and cuts steps for
all 5. But when existing memory systems build and retrieve that experience themselves, 11 of
12 solver/system pairings fail to beat memory-off.
_For phax:_ the bottleneck is curation and retrieval, not having the data. Any learned-memory
feature needs an A/B against memory-off.

Cross-cutting lessons:

1. Keep raw traces available to the improver. Meta-Harness and ACE both show that heavy
   summarisation destroys the signal.
2. Make updates small and itemised, not whole-document rewrites (ACE deltas, AutoSaddler
   targeted patches).
3. Accept an update only after validating it on tasks _other than_ the one that triggered it
   (AutoSaddler, Anthropic's tools post, Kapoor's holdouts).
4. Keep an archive or Pareto set, not a single champion (DGM, GEPA), so specialisations that
   help a subset are not lost.
5. Attach usage counters (helpful/harmful) to each learned item so dead rules can be pruned
   (ACE).

---

## 4. Trajectory and transcript analysis

**MAST: "Why Do Multi-Agent LLM Systems Fail?"** (Cemri, Pan, Yang et al.; NeurIPS 2025 D&B)
https://arxiv.org/abs/2503.13657
The taxonomy has 14 failure modes in 3 categories (system design issues, inter-agent
misalignment, task verification), built from 150+ traces. Human annotators agreed at κ=0.88,
and an LLM judge built on o1 reached 0.77 against experts. Many failures need structural
redesign, not prompt tweaks.
_For phax:_ phax's planner → phase → reviewer chain is a multi-agent system. The
task-verification and handoff (misalignment) categories map directly onto gates and handoff
notes.

**"Failure as a Process: An Anatomy of CLI Coding Agent Trajectories"** (Zhao, …, Sarro, Ye; 2026-07-10)
https://arxiv.org/abs/2607.09510
The authors collected 3,843 trajectories from 7 models and 3 scaffolds on Terminal-Bench and
manually annotated 1,794 of them (over 63k steps). Failures are mostly _epistemic_: wrong
beliefs about the environment or the task. They typically start in the first few steps and
stay hidden until recovery is impossible. The authors call for earlier validation, not only
outcome grading.
_For phax:_ locate the first divergent step in failed phases, not just the gate step that
failed. An early, cheap gate (for example "typecheck after the first edit") may beat a better
fix loop.

**"Understanding Code Agent Behaviour: success and failure trajectories"** (Majgaonkar et al., 2025-10-31)
https://arxiv.org/abs/2511.00197
The study compares OpenHands, SWE-agent and Prometheus on SWE-bench. Failed trajectories are
longer and more variable. Agents find the right files in 72–81% of trajectories, failures
included. Success depends on getting the edit approximately right more than on localisation.
_For phax:_ trajectory length and variance are cheap failure predictors. If localisation is
usually right, look at edit and verification behaviour.

**Transluce Docent**
https://transluce.org/introducing-docent · https://docs.transluce.org/
Docent runs LLM-assisted search and clustering over collections of agent transcripts and
answers natural-language questions, citing the specific runs behind each claim. In one example
it found missing packages in an environment; adding them raised GPT-4o on InterCode from 68.6%
to 78%. It also surfaces strange behaviour after repeated failures.
_For phax:_ the lesson is that many "agent failures" are environment or harness bugs, and
phax's worktree setup is part of the harness.

**Process mining of agent trajectories** (arXiv 2505.20127, May 2025)
https://arxiv.org/abs/2505.20127
The paper treats agent trajectories as event logs and applies process and causal discovery to
find variability, decision points and variation points across nondeterministic runs.
_For phax:_ phax's stream-json can become an event log (tool type, file, gate step, outcome).
Variant analysis then shows where successful and failed phases diverge.

---

## 5. Per-project personalisation: context files and repo memory

**Gloaguen, Mündler, Müller, Raychev, Vechev: "Evaluating AGENTS.md"** (arXiv 2602.11988, ICLR 2026)
https://arxiv.org/abs/2602.11988
Tested on AGENTbench with Claude Code, Codex and Qwen Code. Context files "do not generally
improve task success rates" and raise inference cost by over 20% on average. This holds for
both LLM-generated and developer-written files. Repository overviews are "not helpful". Agents
do follow the instructions, which leads to broader exploration and more testing. Context files
should state only minimal requirements.
_For phax:_ CLAUDE.md content is a harness parameter with a measurable cost. Prune it and
measure the cost per gate pass.

**Lulla, Mohsenimofidi, Galster, Zhang, Baltes, Treude: "On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents"** (arXiv 2601.20404, 2026)
https://arxiv.org/abs/2601.20404
Ran 124 PRs across 10 repositories, with and without AGENTS.md. With it, median runtime fell
28.64% and output tokens fell 16.58%, with comparable completion. These are associations,
not causal effects.
_For phax:_ the two papers point opposite ways on cost. The effect depends on file content, so
measure it on your own repository.

**Chatlatanagulchai et al.: "On the Use of Agentic Coding Manifests: An Empirical Study of Claude Code"** (arXiv 2509.14744)
https://arxiv.org/abs/2509.14744
A descriptive study of 253 CLAUDE.md files. Structure is shallow, and build/run instructions
dominate the content.

**Repo-level memory**: SWE-Exp (above). MemCoder (https://arxiv.org/abs/2603.13258) and a
commit-history memory paper (https://arxiv.org/abs/2510.01003) build memory from verified past
fixes and commits. I saw these only in search snippets, so treat them as unverified.
VibeMemBench (above) is the counterweight: most memory systems don't beat memory-off.

---

## Questions worth asking of phax's own data

Each question comes from the literature and maps to data phax already records.

**Outcome and reliability**

1. What is the per-phase pass^k? When the same plan is re-run, does the phase pass the gate on
   every attempt, or only sometimes? (Anthropic evals; pass^k.)
2. What share of phases pass the gate on attempt 0, and at each fix-loop attempt? Does the
   curve flatten after attempt N (diminishing returns), and does a late pass predict review
   findings later?
3. Did a gate-green phase still get review findings? Which kinds? That gap is what the gates
   cannot see, and it is a candidate for new computational sensors (Böckeler, OpenAI).

**Where failures start** (Failure as a Process; Husain) 4. In failed or many-attempt phases, what is the _first_ step where the trajectory went wrong:
a wrong belief about the repository or environment, a wrong reading of the spec, or a wrong
edit? How many steps before the gate failure did it begin? 5. Which gate step fails first (typecheck, test, lint, architecture audit, knip), and does that
distribution shift after a harness change? 6. Did the fix loop fix the root cause, or thrash: the same file edited back and forth, the
same failing test rerun unchanged, tests weakened or deleted? Anthropic forbids editing
tests for this reason.

**Waste and efficiency** (Manus; SWE-Effi; HAL; AGENTS.md papers) 7. Cost per _accepted_ phase, not per attempt. Do failed phases cost far more (the "expensive
failure" pattern)? 8. Redundant reads: the same file read several times in one session, or files read and never
used. Exploration turns before the first edit. 9. Cache-read share of input tokens. Did a prompt or handoff change break prefix stability? 10. Model/effort Pareto: for each phase type, which (provider, model, effort) points lie on the
cost-versus-first-attempt-gate-pass frontier? Does higher effort actually help (HAL found
it often doesn't)?

**Handoffs and context** (MAST misalignment; Anthropic long-running harness) 11. Does the next phase use the handoff note? Count references to it, and count the
exploration the note should have made unnecessary. Does a longer note correlate with
faster or slower downstream phases? 12. Which CLAUDE.md, skill or rule content is actually acted on in transcripts, and which is
never relevant? (ACE-style helpful/harmful counters.) 13. Do failures cluster by _project_ (repository conventions), by _phase shape_ (refactor,
feature, docs), or by _provider_? Harness effects interact with the model (Han & Sun).

**Validity of the measurement itself** (Docent; infrastructure noise; Shankar) 14. How many failures are harness or environment faults (worktree setup, missing deps,
timeouts, provider errors) and not agent faults? Exclude or fix those before comparing. 15. Does the LLM reviewer's severity agree with the maintainer's own labels on a sample? Does
that agreement drift when the review model changes?

---

## How to evaluate a harness change: a concrete protocol

0. **State the hypothesis and the target failure mode.** Name the failure mode from the
   taxonomy (step 1) the change aims to reduce, and the metric expected to move. A change
   without a target is not evaluable.

1. **Build a failure taxonomy first.** Open-code 30–50 phase transcripts and their gate logs by
   hand, noting the first failure in each. Axial-code the notes into categories and count them
   (Husain/Shankar). Repeat after major model changes. Only then automate labelling with an LLM
   judge, and record that judge's agreement with your labels (aim for κ above about 0.7, as
   MAST did).

2. **Fix the task suite, split by purpose.**
   - _Regression set:_ phases that historically pass (should stay near 100%).
   - _Capability set:_ 20–50 phases drawn from real past failures (Anthropic evals).
   - _Holdout:_ tasks the change was never tuned on (Kapoor; Anthropic tools post; AutoSaddler
     "generalization-aware selection").
     phax can replay a phase from its recorded inputs (plan, spec, base commit, handoff) into a
     fresh worktree. This is the replay unit.

3. **Hold everything else fixed and record it.** Provider CLI version, model and effort,
   machine, concurrency and time of day (infrastructure noise). Each trial gets a clean
   worktree. Interleave baseline and candidate runs, A/B/A/B, to cancel drift.

4. **Run k ≥ 3 trials per task per arm.** Report pass@1, pass^k and the attempts-to-green
   distribution. At these sample sizes, use paired per-task comparisons (McNemar on pass/fail,
   Wilcoxon or a bootstrap on cost and turns), not pooled means. Treat effects under about
   3 points on the pass rate as noise unless the paired test says otherwise.

5. **Score on several axes; one number hides regressions.**
   - Outcome: gate pass at attempt 0, final gate pass, review findings by severity (once the
     reviewer is calibrated), whether the change was merged without edits.
   - Efficiency: cost per accepted phase, total and input tokens, cache-read share, wall
     clock, fix-loop attempts.
   - Process: turns before first edit, redundant reads, test-thrash events, test edits or
     deletions (a guardrail metric that must never rise), first-failure step index.
   - Interaction: report results per provider and per phase type (Han & Sun).
     Decide in advance which axes are guardrails (must not regress) and which is the target.

6. **Read the diffs between arms, not just the scores.** For every task that flipped
   (pass→fail or fail→pass), read both transcripts. Is the failure fair? Is the win real or
   grader leakage, such as tests weakened or a shortcut taken? (Anthropic: "failures should
   seem fair"; HAL and Docent found shortcuts and environment bugs this way.)

7. **Accept, keep as a variant, or reject.**
   - Accept if the target metric improves on capability _and_ holdout, and no guardrail
     regresses on the regression set.
   - If it wins only on a subset (one provider, one phase type), keep it as a scoped variant,
     the Pareto or archive idea from GEPA and DGM, instead of a global default.
   - Learned items (rules, skills, memory bullets) carry helpful/harmful counters from later
     runs and get pruned when unused or harmful (ACE). Always compare against
     "memory/rules off" (VibeMemBench, AGENTS.md papers).

8. **Graduate and promote.** Capability tasks that saturate move to the regression set. Rules
   that keep recurring in review move from prose (CLAUDE.md) into a mechanical gate (OpenAI,
   Böckeler). Log every accepted change with its evidence, so a later regression can be
   bisected to a harness version. Stamp the harness version (prompts, skills, gate profile)
   on every run record.
