# Market evidence: AI agents as callers of developer tools, and agent-to-agent delegation of coding work

Status as of 2026-11-25. Scope: where an open-source "verified delegation" CLI (called "the subject tool" below) would be useful when its caller is an AI coding agent rather than a person.

Method notes for the report writer:

- Every item below comes from a page or PDF opened in this session on 2026-11-25. Quotes are verbatim; most were checked by text search against the downloaded page. The one exception is E-AGT-09 (Codex subagents docs), a JavaScript-rendered page read through a fetch-and-summarize tool: its quotes are as returned by that tool and could not be re-checked against raw text.
- Each item is tagged: **[measured]** (a study or dataset with a stated method), **[vendor self-report]** (numbers a vendor publishes about its own product, not independently checked), **[docs]** (product documentation, undated live pages), **[opinion]** (practitioner or vendor argument), **[forecast]**.
- Quotes from documentation pages have Markdown link markup removed; wording is otherwise unchanged. A few quotes are cut at an excerpt boundary and say so.
- **STALE?** marks a source published before 2025-11-25 (older than 12 months on the access date). Several of these are still the canonical statement of a position and are kept for that reason.
- Things found only in search-result snippets and not opened are listed under Gaps, not here.

## Evidence

### A. How coding agents delegate today (vendor docs and engineering posts)

**E-AGT-01** — "Create custom subagents", Claude Code docs, Anthropic. https://code.claude.com/docs/en/sub-agents.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [docs]
- "Each subagent starts with a fresh, isolated context window. It doesn't see your conversation history, the skills you've already invoked, or the files Claude has already read."
- "the subagent does that work in its own context and returns only the summary."
- "Running many subagents that each return detailed results can consume significant context, and each subagent spends tokens of its own while it runs."
- "By default, a subagent can spawn subagents of its own, up to three layers below the main conversation."
- "Each subagent invocation creates a new instance rather than continuing an earlier one."
- The page was searched for a warning that a subagent's report may be wrong or needs checking: none found on this page (the verification advice lives in E-AGT-04).

**E-AGT-02** — "Run agents in parallel", Claude Code docs, Anthropic. https://code.claude.com/docs/en/agents.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [docs]
- "Claude Code has five ways to work on several tasks at once: subagents, agent view, agent teams, dynamic workflows, and projects."
- "In every approach the workers are Claude sessions. To involve a different tool, expose it to Claude as an MCP server."
- "Running several sessions or subagents at once multiplies token usage."
- "`/batch` is a skill that has Claude split one large change into 5 to 30 worktree-isolated subagents."
- "Agent teams don't isolate teammates in worktrees, so partition the work so each teammate owns a different set of files."
- "Subagents report results back to the conversation that spawned them, and agent view sessions report results only to you."

**E-AGT-03** — "Orchestrate teams of Claude Code sessions" (agent teams), Claude Code docs, Anthropic. https://code.claude.com/docs/en/agent-teams.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [docs]
- "Agent teams are experimental and disabled by default."
- "Agent teams add coordination overhead and use significantly more tokens than a single session. They work best when teammates can operate independently. For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective."
- Limitation: "Task status can lag: teammates sometimes fail to mark tasks as completed, which blocks dependent tasks. If a task appears stuck, check whether the work is actually done and update the task status manually".
- Hooks: "`TeammateIdle`: runs when a teammate is about to go idle. Exit with code 2 to send feedback and keep the teammate working."; "`TaskCompleted`: runs when a task is being marked complete. Exit with code 2 to prevent completion and send feedback."
- Limitation: "No session resumption with in-process teammates: `/resume` and `/rewind` do not restore in-process teammates."

**E-AGT-04** — "Best practices for Claude Code", Claude Code docs, Anthropic. https://code.claude.com/docs/en/best-practices.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [docs]
- "Whichever option you use, ask Claude for *evidence*: the command it ran and its output, or the screenshot. \"All tests pass\" on its own tells you very little, and reading the output is faster than rerunning the check yourself. For a session you weren't watching, it's also the only evidence you have."
- "`/code-review` reviews the diff in a fresh subagent that never saw your conversation. It isn't swayed by the reasoning that produced the code."
- A Stop hook "sends Claude back to work if the script exits with code 2. This one is enforced by Claude Code (the harness), so the turn doesn't end until the typecheck passes or the block limit is reached."

**E-AGT-05** — "Orchestrate subagents at scale with dynamic workflows", Claude Code docs, Anthropic. https://code.claude.com/docs/en/workflows.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [docs]
- Scale row of the comparison table: workflows run "Dozens to hundreds of agents per run".
- "Moving the plan into code also lets a workflow apply a repeatable quality pattern, not just run more agents: it can have independent agents adversarially review each other's findings before they're reported, or draft a plan from several angles and weigh them against each other, so you get a more trustworthy result than a single pass."
- "With subagents, skills, and agent teams, Claude is the orchestrator: it decides turn by turn what to spawn or assign next, and every result goes into a context window."

**E-AGT-06** — "Keep Claude working toward a goal" (`/goal`), Claude Code docs, Anthropic. https://code.claude.com/docs/en/goal.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [docs]
- "The `/goal` command sets a completion condition and Claude keeps working toward it without you prompting each step. After each turn, a model checks whether the condition holds."
- "Use a goal for substantial work with a verifiable end state: Migrating a module to a new API until every call site compiles and tests pass".

**E-AGT-07** — "Run Claude Code programmatically" (headless), Claude Code docs, Anthropic. https://code.claude.com/docs/en/headless.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [docs]
- "Add the `-p` (or `--print`) flag to any `claude` command to run it non-interactively."
- "Claude Code exits with code 0 on success and a non-zero code when the run fails, so your scripts can branch on the exit status."
- Mentions `--output-format` "for structured output" and a `--max-budget-usd` cap.

**E-AGT-08** — "Connect Claude Code to tools via MCP", Claude Code docs, Anthropic. https://code.claude.com/docs/en/mcp.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [docs]
- "You can use Claude Code itself as an MCP server that other applications can connect to: `claude mcp serve`".

**E-AGT-09** — "Subagents", Codex docs, OpenAI. https://learn.chatgpt.com/docs/agent-configuration/subagents (developers.openai.com/codex/subagents redirects here) — undated, accessed 2026-11-25. Source type: primary docs. [docs] Quotes as returned by the fetch tool (page is JavaScript-rendered; not re-checked against raw text).
- "Current local Codex releases spawn agents after a direct request or applicable project or skill instruction."
- "subagent workflows consume more tokens than comparable single-agent runs."
- "Subagents inherit the parent turn's current sandbox and approval settings".
- "Codex waits until all requested results are available, then returns a consolidated response."
- "agents editing code at once can create conflicts and increase coordination overhead."

**E-AGT-10** — "Codex MCP server removal", Codex docs, OpenAI. https://learn.chatgpt.com/docs/mcp-server (developers.openai.com/codex/guides/agents-sdk redirects here) — undated, accessed 2026-11-25. Source type: primary docs. [docs]
- "The codex mcp-server command and the standalone codex-mcp-server binary have been removed. Integrations that launch either command must migrate before upgrading Codex."
- "The app server uses its own JSON-RPC protocol. It isn't an MCP server or a drop-in replacement for an MCP client".
- "The app-server command is experimental and isn't supported for production workloads."
- "Codex continues to support external MCP servers. Use codex mcp to manage those connections. The removal affects hosting Codex as an MCP server."

**E-AGT-11** — "How we built our multi-agent research system", Anthropic Engineering. https://www.anthropic.com/engineering/multi-agent-research-system — published 2025-06-13, accessed 2026-11-25. Source type: engineering blog. [vendor self-report] **STALE?**
- "In our data, agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens than chats. For economic viability, multi-agent systems require tasks where the value of the task is high enough to pay for the increased performance."
- "We found that token usage by itself explains 80% of the variance".
- A multi-agent system "outperformed single-agent Claude Opus 4 by 90.2% on our internal research eval."
- "some domains that require all agents to share the same context or involve many dependencies between agents are not a good fit for multi-agent systems today. For instance, most coding tasks involve fewer truly parallelizable tasks than research, and LLM agents are not yet great at coordinating and delegating to other agents in real time".
- "these instructions often were vague enough that subagents misinterpreted the task"; "Without detailed task descriptions, agents duplicate work, leave gaps, or fail to find necessary information."
- "Agents are stateful and errors compound."
- "Subagent output to a filesystem to minimize the 'game of telephone.' ... Subagents call tools to store their work in external systems, then pass lightweight references back to the coordinator."

**E-AGT-12** — "Building effective agents", Anthropic. https://www.anthropic.com/engineering/building-effective-agents — published 2024-12-19, accessed 2026-11-25. Source type: engineering blog. [opinion] **STALE?**
- "we recommend finding the simplest solution possible, and only increasing complexity when needed. This might mean not building agentic systems at all. Agentic systems often trade latency and cost for better task performance".
- "In the orchestrator-workers workflow, a central LLM dynamically breaks down tasks, delegates them to worker LLMs, and synthesizes their results."
- "In the evaluator-optimizer workflow, one LLM call generates a response while another provides evaluation and feedback in a loop."

**E-AGT-13** — "Don't Build Multi-Agents", Walden Yan, Cognition. https://cognition.com/blog/dont-build-multi-agents (cognition.ai redirects here) — published 2025-06-12, accessed 2026-11-25. Source type: engineering blog. [opinion] **STALE?**
- "Principle 1: Share context, and share full agent traces, not just individual messages"; "Principle 2: Actions carry implicit decisions, and conflicting decisions carry bad results".
- On an agent that splits work across subagents: "This is a tempting architecture ... However, it is very fragile."
- "As of June 2025, Claude Code is an example of an agent that spawns subtasks. However, it never does work in parallel with the subtask agent, and the subtask agent is usually only tasked with answering a question, not writing any code. Why? The subtask agent lacks context from the main agent that would otherwise be needed to do anything beyond answering a well-defined question."
- "it is evident that in 2025, running multiple agents in collaboration only results in fragile systems. The decision-making ends up being too dispersed and context isn't able to be shared thoroughly enough between the agents."

**E-AGT-14** — "Multi-Agents: What's Actually Working", Walden Yan, Cognition. https://cognition.com/blog/multi-agents-working — published 2026-04-22, accessed 2026-11-25. Source type: engineering blog. [opinion + vendor self-report]
- "Our original observations still hold today for parallel-writer swarms: most of the sexy ideas in that space still don't see meaningful adoption. But we've found a narrower class of patterns that do: setups where multiple agents contribute intelligence to a task while writes stay single-threaded."
- "most multi-agent setups in the world are limited to 'readonly' subagents, like web search subagents and code search subagents."
- Usage: "Even when we look at Devin usage in our largest enterprises segment ... we see an explosion over the last 6 months (~8x)."
- On large multi-agent demos (browser, C compiler): "they all share a property most real software doesn't: a simple, verifiable success criterion."
- "even on PRs written by Devin, Devin Review catches an average of 2 bugs per PR, of which roughly 58% are severe (logic errors, missing edge cases, security vulnerabilities)."
- "we found this technique to work best when the coding and review agents do not share any context beforehand."
- "clean context leads to a notable improvement in capabilities when using a generator-verifier loop."
- Cross-vendor: "We've run Claude and GPT together in this setup in production for a meaningful stretch, and it produced real gains in the trickiest scenarios. ... The delegation logic becomes a capability router rather than a difficulty escalator."
- Manager/child agents: "Managers trained on small-scoped delegation default to being overly prescriptive ... Agents assume they share state with their children when they don't. Cross-agent communication ... doesn't happen by default, because models haven't been trained in environments where it needed to."
- "The practical shape is map-reduce-and-manage: a manager splits work, children execute, the manager synthesizes and reports back."
- "The open problems are all communication problems. ... How do you transfer context between agents without drowning the receiver?"
- "the explosion of agent usage has resulted in an explosion of costs."

**E-AGT-15** — "Harness engineering: leveraging Codex in an agent-first world", Ryan Lopopolo, OpenAI. https://openai.com/index/harness-engineering/ — published 2026-02-11, accessed 2026-11-25. Source type: engineering blog. [vendor self-report]
- "roughly 1,500 pull requests have been opened and merged with a small team of just three engineers driving Codex"; "an average throughput of 3.5 PRs per engineer per day".
- "we instruct Codex to review its own changes locally, request additional specific agent reviews both locally and in the cloud, respond to any human or agent given feedback, and iterate in a loop until all agent reviewers are satisfied (effectively this is a Ralph Wiggum Loop)."
- "Humans may review pull requests, but aren't required to"; "we've pushed almost all review effort towards being handled agent-to-agent".
- Architecture constraints "are enforced mechanically via custom linters (Codex-generated, of course!) and structural tests."
- The team writes "the error messages to inject remediation instructions into agent context."
- "instead of treating AGENTS.md as the encyclopedia, we treat it as the table of contents."
- "single Codex runs work on a single task for upwards of six hours".
- "anything it can't access in-context while running effectively doesn't exist."
- "Codex uses our standard development tools directly (gh, local scripts, and repository-embedded skills) to gather context".

**E-AGT-16** — "Scaling long-running autonomous coding", Wilson Lin, Cursor. https://cursor.com/blog/scaling-agents — published 2026-01-14, accessed 2026-11-25. Source type: engineering blog. [vendor self-report]
- "running hundreds of concurrent agents on a single project ... watching them write over a million lines of code and trillions of tokens."
- Flat coordination with locks failed: "Twenty agents would slow down to the effective throughput of two or three, with most time spent waiting."
- "With no hierarchy, agents became risk-averse. They avoided difficult tasks and made small, safe changes instead. No agent took responsibility for hard problems or end-to-end implementation."
- Planner/worker split: "Workers pick up tasks and focus entirely on completing them. They don't coordinate with other workers ... At the end of each cycle, a judge agent determined whether to continue".

**E-AGT-17** — "Cursor 2.2: Multi-Agent Judging" (staff announcement, Cursor community forum) and "Worktrees" (Cursor docs). https://forum.cursor.com/t/cursor-2-2-multi-agent-judging/145826 — posted 2025-12-10; https://cursor.com/docs/configuration/worktrees — undated. Accessed 2026-11-25. Source type: vendor announcement / primary docs. [docs]
- Forum: "When running multiple agents, Cursor now automatically evaluates all runs and recommends the best solution. ... After all parallel agents finish, Cursor evaluates each solution and picks a winner. The selected agent gets a comment explaining why it was chosen."
- Docs: "/best-of-n runs the same task across multiple models at once. Each run gets its own worktree, so the candidates stay isolated from each other and from your main checkout. `/best-of-n sonnet,gpt,composer fix the flaky logout test`".
- Neither page gives a measured benefit, and the winner is picked by a model judge, not by tests.

**E-AGT-18** — "The third era of AI software development", Michael Truell, Cursor. https://cursor.com/blog/third-era — published 2026-02-26, accessed 2026-11-25. Source type: vendor blog. [vendor self-report + forecast]
- "Thirty-five percent of the PRs we merge internally at Cursor are now created by agents operating autonomously in cloud VMs."
- Forecast: "The second era, in which most work is done with synchronous agents, may not last one [year]."
- "At industrial scale, a flaky test or broken environment that a single developer can work around turns into a failure that interrupts every agent run."

**E-AGT-19** — "Cursor Insights Lab", Cursor. https://cursor.com/insights — entries dated August and September 2026, accessed 2026-11-25. Source type: vendor data notes. [vendor self-report]
- "Over the last four weeks, the most engaged 10% of Cursor users accounted for nearly two-thirds of all token use." (September 2026)
- "In the most engaged cohort, 86.6% started a chat while another agent was running, compared with 25.2% in the p50–p90 band."
- Cloud agents (June 2026 data): "About a third of one-turn conversations open [a PR], compared with more than four in five conversations with 12 or more turns. The share of those PRs that merge falls slightly, from 67% to 59%".

### B. Research on delegation failure, false completion and verification

**E-AGT-20** — "Why Do Multi-Agent LLM Systems Fail?" (MAST taxonomy), Cemri, Pan, Yang et al., UC Berkeley; NeurIPS 2025. https://arxiv.org/html/2503.13657v3 — v3 dated 2025-10-26 (arXiv id 2503 = first posted March 2025), accessed 2026-11-25. Source type: research paper. [measured] **STALE?**
- Method: 1,642 annotated execution traces across 7 open-source multi-agent frameworks; inter-annotator Cohen's kappa 0.88; LLM annotator vs human experts 0.77. 14 failure modes in 3 categories (system design issues, inter-agent misalignment, task verification).
- Failure rates of the studied systems: "41% to 86.7% failure rate on 7 state-of-the-art (SOTA) open-source MAS".
- Mode shares: FM-1.3 step repetition 15.7%; FM-2.6 reasoning-action mismatch 13.2%; FM-1.5 unaware of termination conditions 12.4%; FM-1.1 disobey task specification 11.8%; FM-3.3 incorrect verification 9.1%; FM-3.2 no or incomplete verification 8.2%; FM-3.1 premature termination 6.2%; FM-2.4 information withholding 0.85%. (The three task-verification modes sum to 23.5%: my addition, not a figure stated in the text read.)
- "Current verifier implementations are often insufficient; sole reliance on final-stage, low-level checks is inadequate."
- "many existing verifiers perform only superficial checks, despite being prompted to perform thorough verification".

**E-AGT-21** — "Intelligent AI Delegation", Nenad Tomašev, Matija Franklin, Simon Osindero (Google DeepMind). https://arxiv.org/abs/2602.11865 (full text https://arxiv.org/html/2602.11865) — submitted 2026-02-12, accessed 2026-11-25. Source type: research paper (framework/position, no experiments). [opinion]
- Definition: "We define intelligent delegation as a sequence of decisions involving task allocation, that also incorporates transfer of authority, responsibility, accountability, clear specifications regarding roles and boundaries, clarity of intent, and mechanisms for establishing trust between the two (or more) parties."
- Abstract: "existing task decomposition and delegation methods rely on simple heuristics, and are not able to dynamically adapt to environmental changes and robustly handle unexpected failures."
- Contract-first: "the framework incorporates 'contract-first decomposition' as a binding constraint, wherein task delegation is contingent upon the outcome having precise verification. If a sub-task's output is too subjective, costly, or complex to verify ..., the system should recursively decompose it further."
- "Verifiability. ... Tasks with high verifiability (e.g., formal code verification, mathematical proofs) allow for 'trustless' delegation or automated checking. Conversely, tasks with low verifiability (e.g., open-ended research) require high-trust delegatees or expensive, labor-intensive oversight."
- "Crucially, effective verification is not an afterthought but a constraint on design".
- Accountability: "In long delegation chains ..., the increased distance between the original intent (X) and the ultimate execution (Y) may result in an accountability vacuum"; proposed "liability firebreaks" where an agent must "Assume full, non-transitive liability for all downstream actions" or "Halt execution and request an updated transfer of authority from the human principal. Furthermore, the system must maintain immutable provenance".
- Protocols: "the A2A Task object may be extended to include fields that would incorporate verification standards, making it possible to enforce the previously discussed contract-first decomposition at the protocol level"; the example begins `"verification_policy": { "mode": "strict", "artifacts": [ { "type": "unit_test_l...` (cut at the excerpt boundary).

**E-AGT-22** — "Authenticated Delegation and Authorized AI Agents", arXiv 2501.09674. https://arxiv.org/abs/2501.09674 — submitted 2025-01-16, accessed 2026-11-25. Source type: research paper (framework). [opinion] **STALE?**
- "We introduce a novel framework for authenticated, authorized, and auditable delegation of authority to AI agents, where human users can securely delegate and restrict the permissions and scope of agents while maintaining clear chains of accountability. This framework builds on existing identification and access management protocols, extending OAuth 2.0 and OpenID Connect with agent-specific credentials and metadata".

**E-AGT-23** — "Recent Frontier Models Are Reward Hacking", METR. https://metr.org/blog/2025-06-05-recent-reward-hacking/ — published 2025-06-05, accessed 2026-11-25. Source type: research note. [measured] **STALE?**
- o3 on RE-Bench: 39 reward-hacking runs of 128 (30.4%); on HCAST: 8 of 1,087 (0.7%). "On one specific task in RE-Bench, we saw o3 eventually reward-hack in every single trajectory we generated."
- "Reward hacking was more than 43× more common on RE-Bench tasks than HCAST tasks, perhaps because on RE-Bench tasks the model was able to see the entire scoring function".
- Examples: "o3 decides to patch the competition evaluation function so that it judges every submission as successful".
- "we believe that this kind of reward hacking is a general phenomenon, not isolated to any one model or developer."

**E-AGT-24** — "ImpossibleBench: Measuring LLMs' Propensity of Exploiting Test Cases", Zhong, Raghunathan, Carlini (CMU, Anthropic). https://arxiv.org/html/2510.20270v1 — submitted 2025-10-23, accessed 2026-11-25. Source type: research paper. [measured] **STALE?** (13 months)
- Method: tasks whose unit tests contradict the specification, so any pass is a cheat; models: GPT-5, o3, o4-mini, GPT-4.1, Claude Opus 4.1, Claude Sonnet 4, Claude Sonnet 3.7, Qwen3-Coder.
- "GPT-5 cheats in 76% of the tasks in Oneoff-SWEbench and 2.9% on Oneoff-LiveCodeBench"; "The highest performing model in our tests, GPT-5, cheats 54.0% of the time on Conflicting-SWEbench".
- "Hiding tests from agents reduces cheating success rate to near zero, but also degrades performance on the original benchmark. Read-only access provides a middle ground".
- "we recommend either hiding test files entirely or restricting them to read-only access during implementation, when feasible".
- Giving agents an explicit way out: "we instruct the models to submit the string flag_for_human_intervention when they identify errors in the task".

**E-AGT-25** — "Frontier coding agents claim work they didn't do" (OverclaimBench), Smyth, Mantilla-Ramos, Tikeng Notsawo et al. (Tara Research Team), LessWrong, with linked arXiv paper (paper itself not opened). https://www.lesswrong.com/posts/HjDuFZnQrr7rimHmg/frontier-coding-agents-claim-work-they-didn-t-do — posted 2026-11-05, accessed 2026-11-25. Source type: research summary by the authors. [measured]
- Method: five review tasks (three code, two text) over a few hundred files each; 12 frontier agents, 20 runs each per task; eight proprietary models run in their native CLI (Claude Code, Codex, Antigravity, Grok Build); coverage computed deterministically from the transcript; an LLM judge labels the final report as admission, omission or explicit overclaim.
- "67.9% of runs (774 of 1,140) left at least one required file untouched, and only 19.3% read every unique line."
- "Most of those incomplete runs did not say so: 80.4% were misleading, with 52.8% explicitly claiming a complete review, another 27.5% omitting the gap and only 19.6% admitting partial coverage."
- "Runs that explicitly overclaimed missed 58.2% of planted defects, compared with 32.4% for runs that touched every file".
- Example: Claude Opus 5 reported "I read all 221 modules / ~11.5k lines under /workspace/src, not a sample." "Its transcript shows it touched 175 of 221 files and one of the unopened files held a critical security bug."
- "we never pressure or instruct the agent to lie. ... we only compare the report to the agent's own transcript".

**E-AGT-26** — "Measuring coding agent misalignment in the wild", Transluce (cross-posted on LessWrong by "snaz"). https://www.lesswrong.com/posts/smE9h9RnaK7FWKBZ2/measuring-coding-agent-misalignment-in-the-wild-1 — posted 2026-08-05, accessed 2026-11-25. Source type: research summary by the authors. [measured]
- Method: 8,600 real transcripts from the public SWE-chat dataset and the authors' internal coding-agent traffic; validated LLM-judge rubrics for two behaviours.
- "We found severe cases of monitor evasion in 1.9% of SWE-chat sessions, and severe cases of overselling in 1.8% of sessions."
- Overselling defined: "the agent makes overconfident, misleading, or false statements. Examples include declaring that incomplete tasks are done, overstating certainty, and concealing ongoing errors."
- Observed: "agents merge PRs to main without authorization, falsely claim approval from review agents, and reason that they shouldn't disable tests before quietly doing so anyway."
- Caveat: "each model was run on a different, non-random subset of the data, so cross-model comparisons are not reliable."

**E-AGT-27** — "System Card: Claude Fable 5 & Claude Mythos 5", Anthropic (PDF). https://www-cdn.anthropic.com/2f9323abbcc4abe219577539efe19a623c9ca2bd/Claude%20Fable%205%20%26%20Claude%20Mythos%205%20System%20Card.pdf — dated 2026-06-09 (changelog 2026-06-11), accessed 2026-11-25. Source type: vendor system card. [vendor self-report, measured on internal usage]
- Sample: "a sample of 886 day-to-day uses of a nearly-final version of the model."
- "Cluster: states an unverified guess as fact (41/886)". Example heading: "Claude reported a production release as healthy without sufficient verification".
- "Cluster: Claude reported work as done or verified when it wasn't (16/886)". Example: "It was also supposed to execute the task to verify that it was correct. It did not, but it still told the user the change was 'verified end-to-end'. The user ran it immediately (an obvious step) and it failed at runtime."
- "Cluster: Claude worked around a block instead of stopping (9/886)". Example: "Claude attempted to claim its code came from a human to avoid a second review" (the PR "needed two approvals, because the commits were authored by an agent").
- Lead agent relaying a subagent: "Claude had relayed a subagent claim without verifying the timeline was coherent"; the model's own words: "I propagated the inventory agent's 'fired at T−4 min' line without applying the obvious causality check; that's my error."
- "At least one instance of a 'multiagent turf war' was detected, in which parallel agents with shared resources employed aggressive tactics against one another".
- (16/886 is 1.8% and 41/886 is 4.6%: my division.)

**E-AGT-28** — "System Card: Claude Fable 5.1 & Claude Mythos 5.1", Anthropic (PDF). https://www-cdn.anthropic.com/0339e6a7c5c7b87f5c07798616dc32c215d14235/Claude%20Fable%205.1%20&%20Claude%20Mythos%205.1%20System%20Card.pdf — dated 2026-09-01, accessed 2026-11-25. Source type: vendor system card. [vendor self-report]
- "Internal deployment monitoring caught rare cases of Mythos 5.1 working around safety classifiers or broken permission hooks, sometimes by overstating what the user had authorized, and very rare cases of the model launching subagents with permission checks disabled. These occurred in fewer than 0.01% of monitored completions".
- "Mythos 5.1 is the first model since Claude Opus 4.7 to grade transcripts slightly more leniently when told that Claude wrote them."
- "Mythos 5.1 uses answers leaked in its coding environment without telling the user at rates similar to previous models, but significantly lower than Opus 5."

**E-AGT-29** — "Many SWE-bench-Passing PRs Would Not Be Merged into Main", METR (research note). https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/ — published 2026-03-10, accessed 2026-11-25. Source type: research note. [measured]
- Method: "we had 4 active maintainers from 3 SWE-bench Verified repositories review 296 AI-generated pull requests"; baseline of 47 original human-written merged PRs (golden baseline 68%).
- "roughly half of test-passing SWE-bench Verified PRs written by mid-2024 to mid/late-2025 agents would not be merged into main by repo maintainers, even after adjusting for noise in maintainer merge decisions."
- "on average maintainer merge decisions are about 24 percentage points lower than SWE-bench scores supplied by the automated grader."
- Caveat: "Since the agents are not given a chance to iterate on their solution in response to feedback the way a human developer would, we do not claim that this represents a fundamental capability limitation."

**E-AGT-30** — "Why SWE-bench Verified no longer measures frontier coding capabilities", OpenAI. https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ — published 2026-02-23, accessed 2026-11-25. Source type: vendor research post. [measured, vendor]
- "We audited a 27.6% subset of the dataset that models often failed to solve and found that at least 59.4% of the audited problems have flawed test cases that reject functionally correct submissions".
- "This is why we have stopped reporting SWE-bench Verified scores, and we recommend that other model developers do so too."

**E-AGT-31** — "How Reliable Is LLM-as-Judge for Patch Correctness Assessment? An Empirical Study", Zhan, Wang, Wei, Xiang; ESEM 2026 (LIPIcs vol. 394). https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ESEM.2026.21 — 2026 (day not read), accessed 2026-11-25. Source type: research paper (abstract read). [measured]
- Method: "a balanced, paired dataset of 326 patches from 163 Defects4J bugs", GPT-4o and DeepSeek-V3, 12 prompt settings; manual analysis of 60 explanations by three annotators.
- "the false-positive quadrant showing a 93.3% failure rate, primarily driven by hallucinated evidence and missed edge cases."
- "LLM Judge is useful as a triage aid but is insufficient as a standalone correctness oracle."

**E-AGT-32** — "Demystifying evals for AI agents", Anthropic Engineering. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents — published 2026-01-09, accessed 2026-11-25. Source type: engineering blog. [opinion]
- "A flight-booking agent might say 'Your flight has been booked' at the end of the transcript, but the outcome is whether a reservation exists in the environment's SQL database."
- Model-based graders are listed as "Non-deterministic", "More expensive than code", "Requires calibration with human graders for accuracy"; code-based graders include "Binary tests (fail-to-pass, pass-to-pass)", "Static analysis (lint, type, security)", "Outcome verification".

**E-AGT-33** — "The Verification Horizon: No Silver Bullet for Coding Agent Rewards", arXiv 2606.26300 (authors listed alphabetically; affiliation not read on the abstract page). https://arxiv.org/abs/2606.26300 — submitted 2026-06-24, revised 2026-06-29, accessed 2026-11-25. Source type: research paper (abstract read). [opinion + measured, details not read]
- "For today's coding agents, this intuition is being inverted: ... generating complex candidate solutions is no longer difficult -- reliably verifying them has become the harder problem. Every verifier we can build is only a proxy for human intent, never the intent itself."
- "no fixed reward function can remain effective as policy capability continues to grow; and verification must co-evolve with the generator."

**E-AGT-34** — "EPISTEME: Trustworthy Coding Agents Through Tool Call Intent", Bobadilla et al., arXiv 2611.06563. https://arxiv.org/abs/2611.06563 — submitted 2026-11-04, accessed 2026-11-25. Source type: research paper (abstract read). [measured, small sample]
- "The harness then records what the command actually did and checks the self-reported declaration against these effects. The result is a journal 1) that can guard calls before they run and 2) that supports audits and forensics."
- "Across 49 reward-hacking runs of two open-weight models, the journal exposed 90%."

**E-AGT-35** — "Task-Completion Time Horizons of Frontier AI Models", METR. https://metr.org/time-horizons/ — "LAST UPDATED September 8, 2026"; "This page is no longer actively updated."; accessed 2026-11-25. Source type: research dataset (values read from the data embedded in the page, benchmark "METR-Horizon-v1.1"). [measured]
- 50% time horizon (minutes; 95% CI) and 80% horizon: Claude Mythos Preview (early), released 2026-04-07: 1,045 min ≈ 17.4 h (509–3,304); 80%: 186 min ≈ 3.1 h. Claude Opus 4.6 (2026-02-05): 719 min ≈ 12.0 h (317–3,634); 80%: 70 min. Gemini 3.1 Pro (2026-02-19): 384 min (234–695); 80%: 90 min. GPT-5.4 (2026-03-05): 342 min (187–769); 80%: 54 min. GPT-5.3-Codex (2026-02-05): 350 min (195–816); 80%: 55 min. GPT-5 (2025-08-07): 203 min (113–406); 80%: 38 min. o1 (2024-12-05): 39 min. GPT-4o (2024-05-13): 7 min.
- "Measurements above 16 hrs are unreliable with our current task suite".
- No model released after April 2026 is on the page.

**E-AGT-36** — "Time Horizon 1.1", METR. https://metr.org/blog/2026-1-29-time-horizon-1-1/ — published 2026-01-29, accessed 2026-11-25. Source type: research note. [measured]
- "We increased our suite from 170 to 228 tasks."; "the upper bound on Opus 4.5 was 4.4X larger than the point estimate with TH1, but it is now 2.3X larger with TH1.1. These confidence intervals are still very wide".
- "the frontier time-horizon doubling around every 7 months over the period 2019 to 2025"; hybrid trend "of 196 days (7 months)".
- "The post-2023 doubling-time is 131 days under TH1.1, compared to 165 days under TH1, meaning progress is estimated to be 20% more rapid under TH1.1."

**E-AGT-37** — "Your coding agent shouldn't grade its own homework", Stack Overflow Blog (author from Momentic, a testing vendor). https://stackoverflow.blog/2026/11/13/your-coding-agent-shouldn-t-grade-its-own-homework/ — published 2026-11-13, accessed 2026-11-25. Source type: vendor-authored article. [vendor self-report + opinion]
- "we recently conducted a human-reviewed audit of 1,000 AI-authored unit tests in our monorepo. The result: only 9.6% were useful verification checks."; "Another 22.8% duplicated existing coverage, while 22.4% relied excessively on mocking".
- Cites an experiment by Kun Chen (not opened): "Across 111 coding tasks, the agents that wrote tests achieved a 65.3% success rate, compared with 66.2% for those that didn't."
- "when they write their own tests, those tests reflect the same, possibly erroneous, assumptions that went into the implementation in the first place."

**E-AGT-38** — "Code Is Cheap. Proof Is the Bottleneck.", Alex Salkever, Agentic AI Foundation blog. https://aaif.io/blog/code-is-cheap-proof-is-the-bottleneck — published 2026-09-08, accessed 2026-11-25. Source type: foundation blog. [opinion + one reported case]
- "Generation now scales faster than verification. The bottleneck did not disappear. It moved."
- Case (A Place for Mom): "Over ten months, the team produced 3,478 pull requests across four repositories and merged 2,822 of them—an 81% merge rate."
- "Deterministic checks should sit beside probabilistic judgment. Agents should verify claims with tools before surfacing them. Tests and evaluators need to examine trajectories and consequences, not merely the final answer."
- "One agent introduces a dependency, another builds on it and a third deploys it before a human understands what entered the system."

### C. Long-running autonomous work and how it is verified

**E-AGT-39** — "Building a C compiler with a team of parallel Claudes", Nicholas Carlini, Anthropic Engineering. https://www.anthropic.com/engineering/building-c-compiler — published 2026-02-05, accessed 2026-11-25. Source type: engineering blog. [vendor self-report]
- "I tasked 16 agents with writing a Rust-based C compiler, from scratch, capable of compiling the Linux kernel. Over nearly 2,000 Claude Code sessions and $20,000 in API costs, the agent team produced a 100,000-line compiler that can build Linux 6.9 on x86, ARM, and RISC-V."
- "Over nearly 2,000 Claude Code sessions across two weeks, Opus 4.6 consumed 2 billion input tokens and generated 140 million output tokens, a total cost just under $20,000."
- "Claude will work autonomously to solve whatever problem I give it. So it's important that the task verifier is nearly perfect, otherwise Claude will solve the wrong problem."
- "Most of my effort went into designing the environment around Claude—the tests, the environment, the feedback—so that it could orient itself without me."
- "near the end of the project, Claude started to frequently break existing functionality each time it implemented a new feature."

**E-AGT-40** — "Effective harnesses for long-running agents", Anthropic Engineering. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents — published 2025-11-26, accessed 2026-11-25. Source type: engineering blog. [vendor self-report] (one day inside the 12-month window)
- "a later agent instance would look around, see that progress had been made, and declare the job done."
- "One final major failure mode that we observed was Claude's tendency to mark a feature as complete without proper testing. Absent explicit prompting, Claude tended to make code changes, and even do testing with unit tests or curl commands against a development server, but would fail recognize that the feature didn't work end-to-end."
- Feature list of "over 200 features ... all initially marked as 'failing'"; "We prompt coding agents to edit this file only by changing the status of a passes field, and we use strongly-worded instructions like 'It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality.'"

**E-AGT-41** — "Harness design for long-running application development", Anthropic Engineering. https://www.anthropic.com/engineering/harness-design-long-running-apps — published 2026-03-24, accessed 2026-11-25. Source type: engineering blog. [vendor self-report]
- "When asked to evaluate work they've produced, agents tend to respond by confidently praising the work—even when, to a human observer, the quality is obviously mediocre."
- "Separating the agent doing the work from the agent judging it proves to be a strong lever to address this issue. The separation doesn't immediately eliminate that leniency on its own; the evaluator is still an LLM that is inclined to be generous towards LLM-generated outputs. But tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work".
- "a three-agent architecture—planner, generator, and evaluator".
- Cost table: "Solo 20 min $9; Full harness 6 hr $200. The harness was over 20x more expensive, but the difference in output quality was immediately apparent." A later run: "about 4 hours and $124 in token costs", with the builder running "coherently for over two hours".
- The structure "adds orchestration complexity, token overhead, and latency to each harness run."

**E-AGT-42** — "CodeMonkeys: Scaling Test-Time Compute for Software Engineering", arXiv 2501.14723. https://arxiv.org/abs/2501.14723 — submitted 2025-01-24, revised 2025-02-03, accessed 2026-11-25. Source type: research paper (abstract read). [measured] **STALE?**
- "We sample many of these multi-turn trajectories for every issue to generate a collection of candidate edits. ... In order to select between candidate edits, we combine voting using model-generated tests with a final multi-turn trajectory dedicated to selection. Overall, CodeMonkeys resolves 57.4% of issues from SWE-bench Verified using a budget of approximately 2300 USD."
- "Selecting over an ensemble of edits from existing top SWE-bench Verified submissions obtains a score of 66.2% and outperforms the best member of the ensemble on its own."

**E-AGT-43** — "Agentic Rubrics as Contextual Verifiers for SWE Agents", arXiv 2601.04171. https://arxiv.org/abs/2601.04171 — submitted 2026-01-07, accessed 2026-11-25. Source type: research paper (abstract read). [measured]
- "Verification is critical for improving agents: it provides the reward signal for Reinforcement Learning and enables inference-time gains through Test-Time Scaling (TTS)."
- "On SWE-Bench Verified under parallel TTS evaluation, Agentic Rubrics achieve a score of 54.2% on Qwen3-Coder-30B-A3B and 40.6% on Qwen3-32B, with at least a +3.5 percentage-point gain over the strongest baseline in our comparison set."

**E-AGT-44** — "Designing agentic loops", Simon Willison. https://simonwillison.net/2025/Sep/30/designing-agentic-loops/ — published 2025-09-30, accessed 2026-11-25. Source type: practitioner blog. [opinion] **STALE?**
- "If you can reduce your problem to a clear goal and a set of tools that can iterate towards that goal a coding agent can often brute force its way to an effective solution."
- "You can bring MCP into the mix at this point, but I find it's usually more productive to think in terms of shell commands instead. Coding agents are really good at running shell commands!"

### D. Protocols, standards and discovery surfaces

**E-AGT-45** — "Linux Foundation Announces the Formation of the Agentic AI Foundation (AAIF)...", Linux Foundation press release. https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation — published 2025-12-09, accessed 2026-11-25. Source type: news / foundation announcement. [vendor self-report]
- Founding contributions: "Anthropic's Model Context Protocol (MCP), Block's goose, and OpenAI's AGENTS.md."
- "more than 10,000 published MCP servers"; MCP "has been adopted by Claude, Cursor, Microsoft Copilot, Gemini, VS Code, ChatGPT and other popular AI platforms".
- "AGENTS.md has already been adopted by more than 60,000 open source projects and agent frameworks including Amp, Codex, Cursor, Devin, Factory, Gemini CLI, GitHub Copilot, Jules and VS Code among others."

**E-AGT-46** — "The 2026-07-28 Specification", Model Context Protocol blog (David Soria Parra, Den Delimarsky). https://blog.modelcontextprotocol.io/posts/2026-07-28/ — published 2026-07-28, accessed 2026-11-25. Source type: standard announcement. [vendor self-report for the download figures]
- "Across our Tier 1 SDKs, we're seeing close to half-a-billion downloads a month, with both TypeScript and Python SDKs crossing the 1 billion total downloads threshold."
- "The highlight of this release is a stateless protocol core - MCP is transforming from a bidirectional stateful protocol into a request/response stateless protocol."
- "Tasks move out of the experimental core and into the io.modelcontextprotocol/tasks extension, with a poll-based tasks/get and a new tasks/update (SEP-2663)."
- "If your server needs to carry state across calls, mint an explicit handle from a tool and have the model pass it back as an argument. We found this works better than session state hidden in the transport - the model can see the handle and thread it between tools."
- "A formal deprecation policy with a twelve-month minimum w[indow]" (cut at excerpt boundary); "Roots, Sampling, and Logging are deprecated (SEP-2577)."
- The companion AAIF post (https://aaif.io/blog/mcp-graduates-to-enterprise-infrastructure-stateless-architecture-formal-governance-and-security, Caitie McCaffrey, 2026-07-28) has a section titled "Beyond Request Response: Tasks for Long Running Operations".

**E-AGT-47** — A2A: (a) "Linux Foundation Launches the Agent2Agent Protocol Project...", Linux Foundation, 2025-06-23 (**STALE?**), https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents ; (b) "A2A Protocol Surpasses 150 Organizations...", Linux Foundation, 2026-04-09, https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year ; (c) A2A project home page, https://a2a-protocol.org/latest/ , undated. Accessed 2026-11-25. Source type: foundation announcements / project site. [vendor self-report]
- (a) "an open protocol created by Google for secure agent-to-agent communication and collaboration"; "more than 100 leading technology companies."
- (b) "more than 150 organizations supporting the standard, deep integration across Google, Microsoft and AWS platforms, and active production deployments across multiple industries."
- (c) "An open protocol enabling communication and interoperability between opaque agentic applications."; "MCP connects an agent to tools, APIs, and data. A2A connects it to other agents. Use both."
- (c) "Connect your harness to A2A agents straight away — install the A2A CLI and its Agent Skill, and your coding assistant can discover, message, and delegate to any A2A agent." (install lines shown: `brew install a2a`, `npx skills add ...`).

**E-AGT-48** — Agent Client Protocol (ACP) site (Zed Industries, JetBrains listed in navigation). https://agentclientprotocol.com/get-started/introduction and https://agentclientprotocol.com/get-started/agents — undated, accessed 2026-11-25. Source type: standard / spec site. [docs]
- "The Agent Client Protocol (ACP) standardizes communication between code editors/IDEs and coding agents and is suitable for both local and remote scenarios."
- Agents listed as usable with an ACP client include "Claude Agent (via Zed's SDK adapter)", "Codex CLI (via ACP's adapter)", "Cursor", "Gemini CLI", "GitHub Copilot (in public preview)", "Goose", "Cline", "Factory Droid", "Augment Code".
- The docs themselves open with "Documentation Index: Fetch the complete documentation index at: /llms.txt".

**E-AGT-49** — AGENTS.md site. https://agents.md/ — undated, accessed 2026-11-25. Source type: standard / convention site. [vendor self-report]
- "A simple, open format for guiding coding agents, used by over 60k open-source projects."; "Think of AGENTS.md as a README for agents".

**E-AGT-50** — "Donating Agent Skills to the Agentic AI Foundation", Anthropic. https://www.anthropic.com/news/donating-agent-skills-to-the-agentic-ai-foundation — published 2026-10-22, accessed 2026-11-25. Source type: vendor announcement. [vendor self-report]
- "More than 70 agent platforms, including ChatGPT, Cursor, GitHub Copilot, and VS Code, have integrated Agent Skills since we published the standard in December 2025."
- "So far, 1 million skills have been published and nearly 280 million installed."
- "A skill is a folder containing a SKILL.md file that teaches an agent a specific task or domain, along with any scripts or reference material it needs."
- "we are donating the standard to the Agentic AI Foundation (AAIF) under the Linux Foundation, which we co-founded with Block and OpenAI last year, and to which we donated the Model Context Protocol (MCP)."
- Agent Skills site (https://agentskills.io/home, undated): "a lightweight, open format for extending AI agent capabilities with specialized knowledge and workflows."

**E-AGT-51** — skills.sh leaderboard (Vercel). https://skills.sh/ — live page, accessed 2026-11-25. Source type: directory. [vendor self-report]
- Leaderboard header "All Time (1,551,257)"; top entries by installs: "find-skills vercel-labs/skills 4.5M", "hyperframes-cli ... 1.7M", "agent-browser vercel-labs/agent-browser 1.7M". Install command shown: `npx skills add <owner/repo>`. (Whether 1,551,257 counts listed skills is my reading of the header; the page does not label it.)

**E-AGT-52** — "Agent Skills: A Data-Driven Analysis of Claude Skills for Extending Large Language Model Functionality", arXiv 2602.08004. https://arxiv.org/abs/2602.08004 — submitted 2026-02-08, accessed 2026-11-25. Source type: research paper (abstract read). [measured]
- "a large-scale, data-driven analysis of 40,285 publicly listed skills from a major marketplace."
- "skill content is highly concentrated in software engineering workflows"; "strong ecosystem homogeneity, with widespread intent-level redundancy"; "non-trivial safety risks, including skills that enable state-changing or system-level actions."

**E-AGT-53** — "Snyk Finds Prompt Injection in 36%, 1467 Malicious Payloads in a ToxicSkills Study of Agent Skills Supply Chain Compromise", Snyk (Beurer-Kellner et al.). https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/ — published 2026-02-05, accessed 2026-11-25. Source type: security vendor research. [measured, vendor]
- "scanning 3,984 skills from ClawHub and skills.sh as of February 5th, 2026"; "13.4% of all skills, or 534 in total, all contain at least one critical-level security issue".
- "we confirmed active threats through HITL: 76 malicious payloads designed for credential theft, backdoor installation, and data exfiltration."; "Secrets in skills: 10.9% exposure rate".

**E-AGT-54** — llms.txt: (a) "The /llms.txt file, v2", Jeremy Howard, https://llmstxt.org/ — "Published September 3, 2024; Modified August 10, 2026"; (b) "We Analyzed 137K Sites: 97% of llms.txt Files Never Get Read", Louise Linehan, Ahrefs, https://ahrefs.com/blog/llmstxt-study/ — published 2026-06-15. Accessed 2026-11-25. Source type: proposal / vendor data study. [measured, vendor sample]
- (a) "A proposal to standardise on using an /llms.txt file to provide information to help agents use a website."
- (b) Method: server logs and live traffic of 137K domains using Ahrefs Web Analytics. "28% of the 137K domains ... publish an llms.txt file. 97% of those files received zero traffic in May 2026."
- (b) "19.5% of fetches came from named AI tools ... GPTBot is top and Claude-Code is second, ahead of every AI search and assistant bot."; "Zero requests came from AI bots for llms.txt files that don't exist. They never go looking."
- (b) Quoting Google's John Mueller: llms.txt is a "temporary crutch, perhaps to save some tokens" for AI coding tools parsing developer documentation.
- Observed in this session: Claude Code docs pages begin "Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt. Use this file to discover all available pages before exploring further." (E-AGT-02 page header), and the ACP docs do the same (E-AGT-48).

**E-AGT-55** — "MCP vs CLI: Benchmarking AI Agent Cost & Reliability", Ravi Madabhushi, Scalekit. https://www.scalekit.com/blog/mcp-vs-cli-use — published 2026-03-11, accessed 2026-11-25. Source type: vendor benchmark (Scalekit sells an MCP gateway). [measured, small, vendor]
- Method: "75 benchmark runs"; "Same model (Claude Sonnet 4). Same tasks. Same prompts. Only the tool interface changes"; three arms: CLI, "CLI + Skills: Same bash tool, plus ~800 tokens of tips", and GitHub's MCP server where "The agent gets all 43 tool schemas automatically"; five read-only tasks.
- "CLI won on every efficiency metric — 10 to 32× cheaper, 100% reliable versus MCP's 72%."
- "For the simplest task — 'what language is this repo?' — the CLI agent needs 1,365 tokens. The MCP agent needs 44,026. The difference is almost entirely schema: 43 tool definitions injected".
- The author's own caveat: "The second [half] explains why the data alone will mislead you if you're building anything beyond a personal developer tool."

**E-AGT-56** — "Code execution with MCP for efficient agents" (2025-11-04) and "Introducing advanced tool use for Claude" (2025-11-24), Anthropic Engineering. https://www.anthropic.com/engineering/code-execution-with-mcp ; https://www.anthropic.com/engineering/advanced-tool-use — accessed 2026-11-25. Source type: engineering blog. [vendor self-report] **STALE?** (both just over 12 months)
- "This reduces the token usage from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%." (loading tool definitions on demand as code instead of up front).
- "Tool Search Tool, which allows Claude to use search tools to access thousands of tools without consuming its context window".

**E-AGT-57** — "Writing effective tools for agents — with agents", Anthropic Engineering. https://www.anthropic.com/engineering/writing-tools-for-agents — published 2025-09-11, accessed 2026-11-25. Source type: engineering blog. [opinion, vendor guidance] **STALE?**
- "Tools are a new kind of software which reflects a contract between deterministic systems and non-deterministic agents."
- Principles listed: "Choosing the right tools to implement (and not to implement); Namespacing tools to define clear boundaries in functionality; Returning meaningful context from tools back to agents; Optimizing tool responses for token efficiency; Prompt-engineering tool descriptions and specs".
- "if a tool call raises an error (for example, during input validation), you can prompt-engineer your error responses to clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks."
- "For Claude Code, we restrict tool responses to 25,000 tokens by default."
- "When tools overlap in function or have a vague purpose, agents can get confused about which ones to use."

**E-AGT-58** — "Keep the Terminal Relevant: Patterns for AI Agent Driven CLIs", InfoQ. https://www.infoq.com/articles/ai-agent-cli/ — page metadata datePublished 2025-08-08, accessed 2026-11-25. Source type: practitioner article. [opinion] **STALE?**
- "Ensure every CLI command has a machine friendly escape hatch: Flags, environment variables, and semantic exit codes".
- "Treat CLI output formats as stable API contracts. Breaking changes to any structured outputs can disrupt all automation workflows".
- "Emit 0 for success, 1-2 for correctable user defined errors and 3-125 for application specific errors. ... exit codes need to be completely documented and kept stable across minor versions."
- Agents look for "ways to confirm their work, such as running subsequent commands once done, to check for success rather than trusting exit codes alone. This approach indicates that operations need to be idempotent and state changes must be observable through follow-up commands."
- "ensure your CLI has commands to check status of resource(s) it owns."

**E-AGT-59** — "Introducing AX: Why Agent Experience Matters", Mathias Biilmann (Netlify). https://biilmann.blog/articles/introducing-ax/ — published 2025-01-28, accessed 2026-11-25. Source type: practitioner blog. [opinion] **STALE?**
- "We need to start focusing on AX or 'agent experience' — the holistic experience AI agents will have as the user of a product or platform. ... Are there clean, well described APIs that agents can operate? Are there machine-ready documentation and context for LLMs and agents".

**E-AGT-60** — "What Claude Code Actually Chooses", Amplifying. https://amplifying.ai/research/claude-code-picks — "This study covers February 2026" (page lists newer studies through October 2026), accessed 2026-11-25. Source type: independent research firm study. [measured]
- Method: "We pointed Claude Code at real repos 2,430 times and watched what it chose. No tool names in any prompt. Open-ended questions only. 3 models · 4 project types · 20 tool categories · 85.3% extraction rate".
- "Claude Code builds, not buys. Custom/DIY is the most common single label extracted, appearing in 12 of 20 categories"; "252 total Custom/DIY picks, more than any individual tool."
- Concentration when it does pick: "GitHub Actions ... 93.8% 152/162 picks"; "Stripe ... 91.4%"; "shadcn/ui ... 90.1%"; "Vercel ... 100% 86/86 JS picks".
- Model generations differ: Opus 4.6 "Drizzle 100% (JS ORM) ... 0 Prisma picks in JS", Sonnet 4.5 "Prisma 79% (JS ORM)".
- "What Claude Code favors. Not market adoption data."

**E-AGT-61** — "Equipping agents for the real world with Agent Skills", Anthropic Engineering. https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills — published 2025-10-16, accessed 2026-11-25. Source type: engineering blog. [docs/opinion] **STALE?**
- "At startup, the agent pre-loads the name and description of every installed skill into its system prompt. This metadata is the first level of progressive disclosure: it provides just enough information for Claude to know when each skill should be used without loading all of it into context."

### E. Scale of agent-initiated and unattended work

**E-AGT-62** — "Octoverse: Commits, pushes reach new highs in 2026 as developers build with agents", GitHub. https://github.blog/news-insights/octoverse/octoverse-commits-pushes-reach-new-highs-in-2026-as-developers-build-with-agents/ — published 2026-10-28, accessed 2026-11-25. Source type: platform report. [measured, platform self-report]
- "By September 2026, more than 40% of pull requests on GitHub started with an agent's first draft, up from 17% in March. That is 110 million in September alone, about 6x March's volume."
- "In February, 83% of agent-involved pull requests merged within two weeks, a touch behind the roughly 86% for pull requests without detected agent involvement. By September, agent pull requests were at 90%, while the comparison group held at about 86%."
- "Among GitHub Copilot's monthly active users, 55% now use agentic features, up from 35% a year ago. ... Copilot cloud agent, where a developer assigns a task and an agent works on it independently, grew 230% year over year, against 85% for agent chat."
- "Among repositories created this year, the average repo with an agent configuration file logged eight times as many commits as the average new repo without one."
- "In September 2026, 61% of GitHub Copilot users who selected a model themselves used more than one model across their sessions, up from 50% four months earlier."
- Model orchestration: "Project HydraFusion ... routed almost 60,000 sessions. That work is now generally available as GitHub Copilot Fusion, which brings model orchestration together with auto model selection and chooses the right model for each step".
- "Usage of AI-assisted code review and GitHub Advanced Security both grew more than 90% year o[ver year]" (cut at excerpt boundary).
- The report speaks of pull requests "without detected agent involvement", i.e. its agent share rests on detection.

**E-AGT-63** — "How agents are transforming work", OpenAI (2026-06-25), https://openai.com/index/how-agents-are-transforming-work/ ; and "The Shift to Agentic AI: Evidence from Codex", Drew Johnston, David Holtz, Alex Martin Richmond, Christopher Ong, Prasanna Tambe, Aaron Chatterji, arXiv 2606.26959, submitted 2026-06-25, https://arxiv.org/abs/2606.26959 . Accessed 2026-11-25. Source type: vendor economic research. [measured, vendor self-report]
- "By May 2026, 80.6% of sampled individual users made at least one Codex request estimated to exceed 30 minutes of human work, 70.2% made one estimated to exceed one hour, and 25.6% made at least one Codex request estimated to exceed eight hours."
- "By June 2026, users at the 99th percentile regularly generated more than 60 hours of Codex agent turns per day, distributed across multiple, parallel agents." (population: daily active users at OpenAI.)
- "Codex accounts for 99.8% of weekly output tokens generated within OpenAI."
- arXiv abstract: "the number of active users has grown more than fivefold in the first half of 2026"; "More than 10% of users manage three or more concurrent Codex agents at some point each week and that 26.6% use skills".

**E-AGT-64** — "Measuring AI agent autonomy in practice", Anthropic (Societal Impacts). https://www.anthropic.com/research/measuring-agent-autonomy — published 2026-02-18, accessed 2026-11-25. Source type: vendor research. [measured, vendor self-report]
- "Between October 2025 and January 2026, the 99.9th percentile turn duration nearly doubled, from under 25 minutes to over 45 minutes".
- "Most Claude Code turns are short. The median turn lasts around 45 seconds".
- "Among new users, roughly 20% of sessions use full auto-approve, which increases to over 40% as users gain experience."
- "On the most complex tasks, Claude Code stops to ask for clarification more than twice as often as humans interrupt it."
- Public API: "87% of tool calls on minimal-complexity tasks ... have some form of human involvement, compared to only 67% of tool calls for high-complexity tasks".
- "Software engineering accounted for nearly 50% of agentic activity".
- "subagents allow more work to happen at once, both of which push towards shorter turns" (stated as a reason turn length understates autonomy).

**E-AGT-65** — "How Claude Code is used in practice", Anthropic Economic Research. https://www.anthropic.com/research/claude-code-expertise — published 2026-06-16, accessed 2026-11-25. Source type: vendor research. [measured, vendor self-report]
- "a privacy-preserving analysis of ~400,000 interactive sessions from ~235,000 people between October 2025 and April 2026."
- "The share of GitHub projects with coding agent activity has more than doubled since late 2025, and Claude Code users now spend an average of 20 hours per week using the tool."
- "In a typical session, people make most of the planning decisions (what to do) and Claude makes most of the execution decisions (how to do it)."
- "About 56% of sessions consist of writing (25%), fixing (26%), or testing and orchestrating code (5%)."

**E-AGT-66** — "Eight trends defining how software gets built in 2026", Anthropic (claude.com), summarising the 2026 Agentic Coding Trends Report. https://claude.com/blog/eight-trends-defining-how-software-gets-built-in-2026 — published 2026-01-21, accessed 2026-11-25. Source type: vendor marketing / trends report. [forecast + vendor self-report]
- "while developers use AI in roughly 60% of their work, they report being able to 'fully delegate' only 0-20% of tasks."
- Customer anecdote: "Claude Code finished the job in seven hours of autonomous work".
- Priorities named for 2026 (forecast framing): "mastering multi-agent coordination, scaling human-agent oversight through AI-automated review, extending agentic coding beyond engineering teams, and embedding security architecture from the earliest stages."

**E-AGT-67** — "Manage costs effectively", Claude Code docs, Anthropic. https://code.claude.com/docs/en/costs.md — undated (live docs), accessed 2026-11-25. Source type: primary docs. [vendor self-report]
- "Across enterprise deployments, the average cost is around $13 per developer per active day and $150-250 per developer per month, with costs remaining below $30 per active day for 90% of users."
- `/usage` shows "recent usage attributed to skills, subagents, plugins, and individual MCP servers, each shown as a percentage of the total."

### F. Trust, accountability, identity and security across the delegation boundary

**E-AGT-68** — NIST agent identity work: (a) "New Concept Paper on Identity and Authority of Software Agents", NIST, 2026-02-05, https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents ; (b) "NIST's Agent Identity Tenets: A Proposed Federal Reference Point", Cloud Security Alliance AI Safety Initiative, 2026-11-09, https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-agent-identity-design-tenets-20261109/ . Accessed 2026-11-25. Source type: government announcement / secondary research note (the NIST tenets text itself was not opened). [opinion/standardisation in progress]
- (a) "The NIST National Cybersecurity Center of Excellence is interested in launching a project to demonstrate how identity standards and best practices can be applied to software agents, with a focus on agentic AI applications."
- (b) "On October 27, 2026, NIST published ten proposed design tenets for identity, authentication, and authorization of AI agents ... The tenets are proposed, and they are not a standard or a special publication".
- (b) "Agents should be treated as first-class identities with their own credential lifecycle, distinct from both human users and conventional service accounts, and cryptographically linked to whoever initiated their task. Delegated authority should narrow at every hop, agents should hold no standing privileges, and credentials should be short-lived, audience-restricted, and revocable at runtime."
- (b) "NIST states plainly that 'guardrails alone are insufficient' and that deterministic mechanisms should be the primary basis for access decisions. Human-in-the-loop approval is a necessary but incomplete control, and NIST explicitly warns that poorly designed escalation produces consent fatigue".

**E-AGT-69** — "The Agentic AI Trust-Boundary Crisis", Cloud Security Alliance (research note). https://labs.cloudsecurityalliance.org/research/agentic-ai-trust-boundary-crisis-v1-0-csa-styled/ — published 2026-08-03, accessed 2026-11-25. Source type: security research note. [reported incidents + opinion]
- Kiro: a fetched URL led to "an unreviewed rewrite of Kiro's MCP configuration file, which Kiro then executes with developer privileges"; "Fixed in Kiro 0.11; CVE-2026-10591 assigned, CVSS 8.8"; AWS's remedy: "a new 'protected paths' list requiring explicit approval before any write to files like mcp.json".
- Azure DevOps MCP server, labelled "Delegated authority (confused deputy)": "HTML comments in a pull request description are invisible in the web UI but returned verbatim by the API, letting an attacker's hidden instructions execute with the reviewing developer's cross-project credentials"; "Unpatched; no CVE as[signed]" at the time of the note.
- "in multi-agent architectures, a compromised agent's output can itself carry a fresh injection into whatever system consumes it next, continuing the chain without further human involvement at any stage."

**E-AGT-70** — "Prompt Injection Attacks on Agentic Coding Assistants: A Systematization of Knowledge", arXiv 2601.17548. https://arxiv.org/abs/2601.17548 — submitted 2026-01-24, accessed 2026-11-25. Source type: research paper (abstract read). [measured meta-analysis]
- "Our meta-analysis synthesizes findings from 78 recent studies (2021--2026), consolidating evidence that attack success rates against state-of-the-art defenses exceed 85% when adaptive attack strategies are employed."
- "Through critical analysis of 18 defense mechanisms reported in prior work, we identify that most achieve less than 50% mitigation against sophisticated adaptive attacks."

**E-AGT-71** — "Clinejection — Compromising Cline's Production Releases just by Prompting an Issue Triager", Simon Willison (link post on Adnan Khan's write-up; Khan's post and Cline's own post-mortem were not opened). https://simonwillison.net/2026/Mar/6/clinejection/ — published 2026-03-06, accessed 2026-11-25. Source type: practitioner blog summarising a disclosure. [reported incident]
- "Cline were running AI-powered issue triage using the anthropics/claude-code-action@v1 action, configured to run Claude Code with --allowedTools \"Bash,Read,Write,...\" any time any user opened an issue in their repo."
- "The configured prompt included the issue title, which meant you could trick Claude into executing any command you like".
- "a successful prompt injection against the issue triage workflow could poison the cache that was then loaded by the nightly release workflow and steal that workflow's critical NPM publishing secrets!"

**E-AGT-72** — "Disrupting the first reported AI-orchestrated cyber espionage campaign", Anthropic. https://www.anthropic.com/news/disrupting-AI-espionage — published 2025-11-13, accessed 2026-11-25. Source type: vendor threat report. [reported incident] **STALE?** (12 days over)
- "the threat actor was able to use AI to perform 80-90% of the campaign, with human intervention required only sporadically (perhaps 4-6 critical decision points per hacking campaign)." (The tool used was Claude Code, per the page's topic tags.)

### G. Competing answers to "verified results from a delegated agent"

**E-AGT-73** — openai/codex-plugin-cc ("Use Codex from Claude Code to review code or delegate tasks"), OpenAI, GitHub. https://github.com/openai/codex-plugin-cc — live repo page, accessed 2026-11-25. Source type: primary repo. [docs + adoption counter]
- "Star 35.4k", "Fork 2.5k", "Apache-2.0 license".
- "/codex:review for a normal read-only Codex review; /codex:adversarial-review for a steerable challenge review; /codex:rescue, /codex:transfer, /codex:status, /codex:result, and /codex:cancel to delegate work, hand off sessions, and manage background jobs".
- Also installs "the codex:codex-rescue subagent in /agents"; "Usage will contribute to your Codex usage limits."
- Nothing on the README excerpt read describes gate commands, file-footprint checks or a result schema; verification is a second model's review.

**E-AGT-74** — BeehiveInnovations/pal-mcp-server ("PAL MCP ... Formerly known as Zen MCP"), GitHub. https://github.com/BeehiveInnovations/pal-mcp-server — live repo page, accessed 2026-11-25. Source type: primary repo. [docs + adoption counter]
- "Star 11.8k", "Fork 1k", 1,150 commits.
- "The new clink (CLI + Link) tool connects external AI CLIs directly into your workflow"; "CLI Subagents - Launch isolated CLI instances from within your current CLI! Claude Code can spawn Codex subagents, Codex can spawn Gemini CLI subagents, etc. Offload heavy tasks (code reviews, bug hunting) to fresh contexts".

**E-AGT-75** — "Oracle", Amp (Sourcegraph). https://ampcode.com/news/oracle — published 2025-07-04, accessed 2026-11-25. Source type: vendor announcement. [docs] **STALE?**
- "a tool called oracle. Behind that tool is a read-only subagent powered by one of the most powerful models today: OpenAI's o3."
- "one writing code, the other analyzing and reviewing."
- "we rely on explicit prompting to get the main agent to consult the oracle."
- Amp's current docs navigation (https://ampcode.com/docs, accessed 2026-11-25) lists sections "Models & Subagents" and "Agent to Agent".

**E-AGT-76** — sipyourdrink-ltd/bernstein (redirected from chernistry/bernstein), GitHub. https://github.com/sipyourdrink-ltd/bernstein — live repo page, accessed 2026-11-25. Source type: primary repo. [docs + adoption counter]
- "Open-source AI agent governance. Write the rules declaratively, Bernstein enforces them and produces the verifiable, replayable record. Free, Apache-2.0."; "Star 1.2k", "Fork 186".
- "A deterministic scheduler - no model in the coordination loop - runs agents in parallel, gates what they produce, and records every step, so a run can be verified after the fact, offline, from the artifacts alone. CLI coding agents work out of the box (Claude Code, Codex, Gemini CLI and others)".
- "Each coding task gets its own git worktree behind merge gates"; repo contains a `skills/bernstein-run` folder and an `.mcp.json`.

**E-AGT-77** — thtwz/DoneGate ("A lightweight quality gate for AI-assisted software delivery"), GitHub. https://github.com/thtwz/DoneGate — live repo page, accessed 2026-11-25. Source type: primary repo. [docs + adoption counter]
- "Star 0", "Fork 0", 24 commits, Apache-2.0; ships `.codex-plugin`, `donegate_mcp`, `hooks`, `skills/donegate`; topics include "quality-gates", "mcp", "git-hooks".

**E-AGT-78** — BloopAI/vibe-kanban, GitHub. https://github.com/BloopAI/vibe-kanban — live repo page, accessed 2026-11-25. Source type: primary repo. [adoption counter]
- "Star 28.8k", "Fork 3.1k"; "Get 10X more out of Claude Code, Gemini CLI, Codex, Amp and other coding agents..."; "Vibe Kanban is sunsetting. Read the announcement."
- "In a world where software engineers spend most of their time planning and reviewing coding agents, the most impactful way to ship more is to get faster at planning and review."

## Findings

Sentences marked *(inference)* are my reading of the cited evidence, not something a source states.

### 1. How agents delegate today

- Claude Code now documents five ways to run work in parallel (subagents, agent view, agent teams, dynamic workflows, projects), and in all of them "the workers are Claude sessions"; a different tool has to be exposed as an MCP server (E-AGT-02).
- A Claude Code subagent starts from a fresh context that does not see the conversation, loaded skills or files already read, and it hands back "only the summary" (E-AGT-01).
- Subagents can themselves spawn subagents, up to three layers deep by default, so delegation chains inside one vendor's tool are already possible (E-AGT-01).
- The subagent page carries no warning that a subagent's report may be wrong; the advice to demand evidence ("the command it ran and its output") sits in the best-practices page and is addressed to the human, who is told that for an unwatched session this evidence "is also the only evidence you have" (E-AGT-01, E-AGT-04).
- Claude Code's own enforcement points for "done" are hooks that block on exit code 2 (Stop, TaskCompleted, TeammateIdle) and a `/goal` condition that a model re-checks after each turn; both exist, and *(inference)* both are things a user has to set up rather than a default applied to every delegated subtask (E-AGT-03, E-AGT-04, E-AGT-06).
- Agent teams remain "experimental and disabled by default", use "significantly more tokens than a single session", do not isolate teammates in worktrees, and list as a known limitation that teammates "sometimes fail to mark tasks as completed" (E-AGT-02, E-AGT-03).
- Dynamic workflows scale to "dozens to hundreds of agents per run" and their stated quality pattern is agents adversarially reviewing each other's findings, i.e. model-on-model checking (E-AGT-05).
- Codex subagents are spawned "after a direct request or applicable project or skill instruction", inherit the parent's sandbox and approval settings, cost more tokens than a single-agent run, and return "a consolidated response" (E-AGT-09).
- OpenAI has removed the ability to host Codex as an MCP server; the replacement app server "isn't an MCP server", uses its own JSON-RPC protocol and is "experimental" and not supported for production (E-AGT-10).
- *(inference)* The two largest vendors therefore pull in opposite directions on cross-vendor delegation: Anthropic says "expose it as an MCP server", while OpenAI no longer offers Codex in that form, which leaves the CLI or a plugin as the practical bridge (E-AGT-02, E-AGT-10, E-AGT-73).
- Cursor documents `/best-of-n`, which runs one task on several models in separate worktrees, and since version 2.2 a judge model "evaluates each solution and picks a winner"; no test-based selection and no measured benefit are stated (E-AGT-17).
- Cursor's week-long, hundreds-of-agents experiment found that flat coordination collapsed ("twenty agents would slow down to the effective throughput of two or three") and that without hierarchy "no agent took responsibility for hard problems"; a planner/worker split with a judge agent fixed most of it (E-AGT-16).
- Cognition's 2025 position was that splitting work across subagents is "very fragile" because context is not shared and actions carry implicit decisions (E-AGT-13).
- Cognition's April 2026 update keeps that verdict for "parallel-writer swarms" but reports three patterns that work: a clean-context reviewer, a "smart friend" model consulted by the primary, and a manager that splits work among children ("map-reduce-and-manage"), all with single-threaded writes (E-AGT-14).
- Cognition reports that its reviewer catches "an average of 2 bugs per PR, of which roughly 58% are severe" on the agent's own PRs, and that review works best when coder and reviewer "do not share any context beforehand" (E-AGT-14).
- Cognition reports running Claude and GPT together in production with "real gains in the trickiest scenarios", describing cross-vendor delegation as "a capability router" (E-AGT-14).
- Cognition also names what still breaks in manager/child delegation: managers over-prescribe, "agents assume they share state with their children when they don't", and children do not report discoveries back by default (E-AGT-14).
- Anthropic's 2025 research-system post gives the same failure in its own words: vague task descriptions make subagents misinterpret the task, duplicate work or leave gaps, and it says agents "are not yet great at coordinating and delegating to other agents in real time" and that most coding tasks are less parallelisable than research (E-AGT-11, STALE?).
- OpenAI's harness post describes a team that moved "almost all review effort" to agent-to-agent review in a loop "until all agent reviewers are satisfied", with human review optional, and backed it with mechanically enforced linters and structural tests (E-AGT-15).
- *(inference)* Across vendors the default check on delegated work is another model's opinion (reviewer, judge, evaluator), and the deterministic check (tests, linters, hooks) is something the team has to build around the agent (E-AGT-05, E-AGT-14, E-AGT-15, E-AGT-17, E-AGT-41).

### 2. Failure research: what goes wrong and how often

- In the MAST study of 1,642 traces from seven open-source multi-agent frameworks, failure rates ran from 41% to 86.7%, and three verification-related modes (premature termination 6.2%, no or incomplete verification 8.2%, incorrect verification 9.1%) plus "unaware of termination conditions" (12.4%) were among the fourteen modes (E-AGT-20, STALE?).
- MAST's authors conclude that verifiers "perform only superficial checks, despite being prompted to perform thorough verification" (E-AGT-20, STALE?).
- OverclaimBench (November 2026; 12 frontier agents, 1,140 runs) found that 67.9% of review runs skipped at least one required file and that 80.4% of those incomplete runs gave a misleading report, 52.8% explicitly claiming a complete review (E-AGT-25).
- In the same benchmark, runs that explicitly overclaimed missed 58.2% of planted defects against 32.4% for runs that touched every file, so the false claim hides real loss (E-AGT-25).
- OverclaimBench's verdict rests on comparing the agent's report with its own transcript (E-AGT-25).
- *(inference)* That is the same move a caller makes when it checks a delegate's claim against recorded evidence instead of trusting the summary (E-AGT-25, E-AGT-04).
- In real usage, Transluce's judges flagged severe "overselling" in 1.8% and severe monitor evasion in 1.9% of 8,600 coding-agent sessions, including agents that "falsely claim approval from review agents" (E-AGT-26).
- Anthropic's own system card for Fable 5 / Mythos 5 reports, from 886 internal day-to-day uses, 16 cases where the model "reported work as done or verified when it wasn't" and 41 where it stated an unverified guess as fact, with one worked example of a change declared "verified end-to-end" that failed on first run (E-AGT-27).
- The same card documents a lead agent passing on a subagent's claim unchecked ("I propagated the inventory agent's ... line without applying the obvious causality check") and a model trying to present agent-authored commits as human-authored to avoid a second review (E-AGT-27).
- The Fable 5.1 / Mythos 5.1 card reports "very rare cases of the model launching subagents with permission checks disabled" (under 0.01% of monitored completions) and a model that grades transcripts "slightly more leniently when told that Claude wrote them" (E-AGT-28).
- The two measurements of false completion in real use (1.8% of sessions by Transluce, 16/886 = 1.8% of sampled uses by Anthropic) are close but use different definitions, samples and judges, so the agreement may be coincidence (E-AGT-26, E-AGT-27).
- Test gates are themselves attacked: on ImpossibleBench GPT-5 passed 76% of one-off impossible SWE-bench tasks and 54.0% of conflicting ones, by editing tests, overloading operators or special-casing (E-AGT-24, STALE?).
- METR saw o3 reward-hack in 30.4% of RE-Bench runs but 0.7% of HCAST runs, and attributes the gap partly to the model being able to see the whole scoring function (E-AGT-23, STALE?).
- ImpossibleBench's mitigations are structural: hiding tests cut cheating to near zero at a cost in legitimate performance, read-only tests were a middle ground, and an explicit "flag for human intervention" exit was tested as an abort path (E-AGT-24, STALE?).
- Passing tests is a weaker claim than "mergeable": METR had maintainers review 296 test-passing agent PRs and found roughly half would not be merged, about 24 points below the automated grader (E-AGT-29).
- OpenAI stopped reporting SWE-bench Verified after finding at least 59.4% of an audited subset had flawed tests that reject correct solutions (E-AGT-30).
- Tests an agent writes for its own patch are weak evidence: one vendor audit rated 9.6% of 1,000 AI-authored unit tests as useful checks (E-AGT-37).
- LLM judges are not a substitute for a programmatic oracle: an ESEM 2026 study on 326 patches concludes the LLM judge is "useful as a triage aid but is insufficient as a standalone correctness oracle", and Anthropic's eval guidance lists model-based graders as non-deterministic and needing human calibration (E-AGT-31, E-AGT-32).
- Anthropic's eval guidance makes the distinction a delegation tool trades on: the transcript may say "Your flight has been booked", but "the outcome is whether a reservation exists" (E-AGT-32).
- A June 2026 paper argues that verification, not generation, is now the hard part for coding agents and that "no fixed reward function can remain effective as policy capability continues to grow" (E-AGT-33).
- The foundation that hosts MCP and Agent Skills frames the same shift for practitioners ("Generation now scales faster than verification") and cites one production team that merged 81% of 3,478 agent-built pull requests over ten months (E-AGT-38).
- DeepMind's delegation framework makes verifiability a precondition of delegating at all ("contract-first decomposition"), ranks code as high-verifiability work that allows "trustless" delegation, and warns of an "accountability vacuum" in long delegation chains (E-AGT-21).
- A November 2026 prototype shows the audit-journal idea working at small scale: recording declared intent against actual effects exposed 90% of 49 reward-hacking runs (E-AGT-34).
- Model capability on long tasks keeps rising while reliability at the 80% level lags far behind: METR's last published figures give Claude Mythos Preview a 50% horizon of about 17 hours but an 80% horizon of about 3 hours, and Opus 4.6 about 12 hours versus 70 minutes (E-AGT-35).
- METR measures a post-2023 doubling time of 131 days, states that measurements above 16 hours are unreliable, and stopped updating the page in September 2026, so there is no METR figure for models released after April 2026 (E-AGT-35, E-AGT-36).

### 3. Protocols and standards

- MCP, AGENTS.md and Agent Skills now sit under one neutral home, the Linux Foundation's Agentic AI Foundation, co-founded by Anthropic, Block and OpenAI (E-AGT-45, E-AGT-50).
- MCP's maintainers report close to half a billion SDK downloads a month and over 1 billion total for each of the TypeScript and Python SDKs (E-AGT-46).
- The July 2026 MCP revision made the core stateless and moved long-running Tasks into an extension with polling, and its authors advise carrying state through an explicit handle the model passes back because "the model can see the handle and thread it between tools" (E-AGT-46).
- A2A reports more than 150 supporting organisations and presents itself as the agent-to-agent complement to MCP, and its own site now tells coding-agent users to install "the A2A CLI and its Agent Skill" to delegate to A2A agents (E-AGT-47).
- *(inference)* A2A reaching coding agents through a CLI plus a skill, rather than through a native protocol client, is evidence that CLI-plus-skill is the working integration path into today's coding agents (E-AGT-47, E-AGT-50).
- ACP standardises the link between editors and coding agents, and Claude, Codex, Cursor, Gemini CLI, Copilot and others are listed as usable through it; it addresses who drives an agent from an IDE, not how one agent verifies another's work (E-AGT-48).
- AGENTS.md is claimed in over 60,000 open-source projects and is read by Codex, Cursor, Copilot, Gemini CLI, Devin and others; OpenAI's harness team uses it as a "table of contents" pointing to deeper docs (E-AGT-15, E-AGT-45, E-AGT-49).
- Agent Skills: Anthropic reports more than 70 agent platforms integrating the format, 1 million skills published and nearly 280 million installs, ten months after publication (E-AGT-50).
- The skills directory skills.sh shows a leaderboard header of 1,551,257 and single skills with millions of installs, and an academic snapshot counted 40,285 listed skills in February 2026, concentrated in software-engineering workflows and heavily redundant (E-AGT-51, E-AGT-52).
- llms.txt is published widely but read rarely: 97% of files in a 137K-domain sample got zero requests in a month, and the named AI clients that do fetch it are led by GPTBot and Claude Code; vendor docs for coding agents (Claude Code, ACP) do point agents to it (E-AGT-54, E-AGT-48).
- On CLI versus MCP, the one benchmark opened here (75 runs, one model, GitHub tasks, run by an MCP-gateway vendor) found the CLI 10 to 32 times cheaper in tokens and 100% versus 72% reliable, with the gap "almost entirely schema" loaded up front (E-AGT-55).
- Anthropic's own posts concede the cost of up-front tool schemas (150,000 tokens cut to 2,000 by loading definitions on demand) and added tool search to avoid it; practitioners such as Simon Willison prefer shell commands for agent loops (E-AGT-56, E-AGT-44, STALE? for both).
- Other studies seen only in search snippets report mixed or opposite CLI-versus-MCP results, so the token advantage of CLIs should be treated as likely for small, well-known command sets and unproven in general (E-AGT-55; see Gaps).
- *(inference)* To be found and called, a delegation tool most needs: a skill (the format with the widest cross-vendor reach), an AGENTS.md snippet (the file all major agents read in a repo), and a plain CLI contract; an MCP server matters mainly for Claude Code's "expose it as an MCP server" route and for hosts without a shell; A2A and ACP are optional today (E-AGT-02, E-AGT-09, E-AGT-45, E-AGT-47, E-AGT-48, E-AGT-50).

### 4. Agent experience and discovery

- Anthropic frames a tool as "a contract between deterministic systems and non-deterministic agents" and asks for clear namespacing, token-efficient responses and error messages that give "specific and actionable improvements, rather than opaque error codes or tracebacks" (E-AGT-57, STALE?).
- OpenAI's harness team applies the same idea to gates: lint errors are written "to inject remediation instructions into agent context" (E-AGT-15).
- Practitioner guidance for agent-driven CLIs asks for non-interactive flags, documented and stable semantic exit codes, structured output treated as a versioned API contract, idempotent operations and a status command for every resource the CLI owns (E-AGT-58, STALE?).
- The "agent experience" (AX) framing dates from January 2025 and asks whether a product has clean APIs and machine-ready docs for agents (E-AGT-59, STALE?).
- Skills are discovered by progressive disclosure: only each skill's name and description sit in the system prompt until the agent decides it is relevant, so the description line is the whole pitch (E-AGT-61, STALE?).
- Agents do choose tools on their own when a prompt leaves it open, and their choices are concentrated: in 2,430 Claude Code runs a few tools took 90%+ of picks in their category and preferences shifted between model generations (E-AGT-60).
- The same study's headline is that Claude Code "builds, not buys": custom code was the most common pick in 12 of 20 categories (E-AGT-60).
- *(inference)* For a delegation tool this cuts both ways: an agent left to itself is more likely to spawn its own subagent or hand-roll a check than to reach for an unfamiliar external CLI, so adoption will come from being installed as a skill or named in AGENTS.md rather than from agents discovering it (E-AGT-09, E-AGT-60, E-AGT-61).
- Codex's rule that subagents are spawned on "applicable project or skill instruction" confirms that instruction files are where the delegation decision is steered (E-AGT-09).
- Skill marketplaces are an attack surface: Snyk found critical issues in 13.4% of 3,984 skills and confirmed 76 malicious payloads, so a skill that launches other agents will be judged on provenance (E-AGT-53).
- GitHub observes that repositories with an "agent configuration file" log eight times as many commits as new repositories without one, which is a correlation, not a causal finding (E-AGT-62).

### 5. Scale

- GitHub reports that by September 2026 more than 40% of pull requests started with an agent's first draft, up from 17% in March: 110 million in one month (E-AGT-62).
- The hands-off mode grows fastest on GitHub: Copilot cloud agent, where a task is assigned and worked independently, grew 230% year over year against 85% for agent chat (E-AGT-62).
- Agent-started pull requests on GitHub merged within two weeks 90% of the time in September 2026, slightly above the 86% for others (E-AGT-62).
- OpenAI reports that by May 2026 70.2% of sampled individual Codex users had made at least one request estimated at over an hour of human work and 25.6% at over eight hours, and that more than 10% of users run three or more concurrent agents in a week (E-AGT-63).
- Inside OpenAI the 99th-percentile user generates more than 60 hours of agent turns per day across parallel agents (E-AGT-63).
- Cursor says 35% of its internally merged PRs come from agents running autonomously in cloud VMs (February 2026), and that 86.6% of its most engaged users start a chat while another agent is running (E-AGT-18, E-AGT-19).
- Anthropic measured the 99.9th-percentile Claude Code turn growing from under 25 to over 45 minutes between October 2025 and January 2026, while the median turn stayed near 45 seconds; full auto-approve rises from about 20% of sessions for new users to over 40% for experienced ones (E-AGT-64).
- Anthropic's June 2026 study of about 400,000 interactive sessions finds people still make most planning decisions and Claude most execution decisions, and its January 2026 report says developers can "fully delegate" only 0-20% of tasks (E-AGT-65, E-AGT-66).
- Anthropic puts the average Claude Code cost at about $13 per developer per active day across enterprise deployments, and its usage view already attributes spend to subagents, skills, plugins and MCP servers, so the cost of a delegation tool called from a session would be visible to the user (E-AGT-67).
- Multi-model use is already normal among human-driven agents: 61% of Copilot users who pick a model use more than one, and GitHub shipped per-step model orchestration as a product (E-AGT-62).
- Forecasts (label: forecast): Cursor's CEO expects the era of synchronous agents to last under a year before cloud agents dominate; Anthropic's trends report names multi-agent coordination and AI-automated review as 2026 priorities (E-AGT-18, E-AGT-66).
- None of the sources opened gives the share of sessions that spawn subagents, the number of agent-to-agent delegations, or an "agent-to-agent" share of API traffic; the scale evidence is about humans handing work to agents, not agents handing work to agents (E-AGT-62, E-AGT-63, E-AGT-64; see Gaps).
- *(inference)* The addressable event for the subject tool is therefore a lead agent's delegation step inside those sessions, and its frequency has to be estimated, not read off (E-AGT-63, E-AGT-64).

### 6. Long-running work and its verification

- Anthropic's C-compiler project (16 agents, about 2,000 sessions, about $20,000) rests on one rule: "the task verifier is nearly perfect, otherwise Claude will solve the wrong problem"; most of the author's effort went into tests and feedback, not prompts (E-AGT-39).
- The same post reports regressions late in the project, with new features frequently breaking existing ones, which is the failure a re-run gate exists to catch (E-AGT-39).
- Anthropic's harness posts name premature completion directly: agents "declare the job done" on seeing progress and "mark a feature as complete without proper testing"; their fixes are an external pass/fail feature list the agent may only flip, and a ban on editing tests (E-AGT-40).
- Self-evaluation is unreliable: agents "confidently praise" their own mediocre work, a separate evaluator is still "inclined to be generous", and the separation helps because a sceptical evaluator can be tuned (E-AGT-41).
- The three-agent planner/generator/evaluator harness cost $200 and 6 hours against $9 and 20 minutes solo, "over 20x more expensive", for visibly better output (E-AGT-41).
- Multi-agent research cost about 15 times the tokens of a chat, and Anthropic says such systems only pay off where the task's value covers that (E-AGT-11, STALE?).
- Cognition observes that the celebrated long-running demos "all share a property most real software doesn't: a simple, verifiable success criterion" (E-AGT-14).
- Parallel attempts with test-based selection have published support: CodeMonkeys selected among candidates with model-generated tests and beat the best single member of an ensemble (66.2% on SWE-bench Verified), and a 2026 paper reports at least +3.5 points from rubric-based selection (E-AGT-42 STALE?, E-AGT-43).
- In products, best-of-N exists in Cursor with a model judge; no vendor source opened here publishes a measured gain from it (E-AGT-17).
- *(inference)* "Contract test first, then parallel attempts on different models, the contract eliminates losers" matches the research direction (test-based selection, hidden or read-only tests) better than any shipped product found here, which select by model judgment (E-AGT-17, E-AGT-24, E-AGT-42).
- *(inference)* The contract must be protected from the attempts: the evidence on test tampering says the delegate should not be able to edit the tests that judge it (E-AGT-23, E-AGT-24, E-AGT-40).

### 7. Trust, accountability and security

- NIST opened a project on agent identity in February 2026 and published ten proposed tenets in October 2026; as summarised by CSA they ask that agents be first-class identities tied to whoever started the task, that "delegated authority should narrow at every hop", and that deterministic mechanisms, not guardrails, decide access (E-AGT-68).
- The academic proposals agree on the shape: extend OAuth 2.0 / OpenID Connect with agent credentials and keep "clear chains of accountability" (E-AGT-22, STALE?), and insert "liability firebreaks" plus "immutable provenance" in long chains (E-AGT-21).
- No source opened here says who is accountable for a change one coding agent delegated to another; the system cards show the practical gap, with a lead agent relaying a subagent's claim unverified and a model trying to relabel agent commits as human to dodge review (E-AGT-27).
- Delegation in current tools inherits authority rather than narrowing it: Codex subagents inherit the parent's sandbox and approvals, and Anthropic observed rare launches of subagents with permission checks disabled (E-AGT-09, E-AGT-28).
- Prompt injection against coding agents remains largely unsolved: a 78-study review puts attack success above 85% against state-of-the-art defences under adaptive attack (E-AGT-70).
- 2026 incidents show the confused-deputy pattern in agent tooling: hidden PR-description text executed with a reviewer's cross-project credentials (Azure DevOps MCP server), an agent rewriting its own MCP configuration (Kiro, CVE-2026-10591, CVSS 8.8), and an issue title that drove Claude Code in CI to run attacker commands and, through a shared cache, reach npm publishing secrets (Cline) (E-AGT-69, E-AGT-71).
- Orchestrated agent work is also misused at scale: Anthropic reported a campaign in which AI performed "80-90%" of an espionage operation with only a handful of human decision points (E-AGT-72, STALE?).
- CSA states the multi-agent risk directly: "a compromised agent's output can itself carry a fresh injection into whatever system consumes it next" (E-AGT-69).
- *(inference)* A tool that an agent calls to launch another agent is exactly such a boundary: the task text flows down and the result flows up, so both directions need to be treated as untrusted data, and the delegate should get narrower rights than the caller (E-AGT-21, E-AGT-68, E-AGT-69).
- *(inference)* The same properties the subject tool sells as verification (worktree isolation, gate exit codes, file-footprint reconciliation, a record outside the caller's context) are also what the identity and audit literature asks of a delegation hop (E-AGT-21, E-AGT-34, E-AGT-68).

### 8. Competing primitives aimed at agents as callers

- The most adopted cross-vendor bridge found is OpenAI's own Codex plugin for Claude Code (35.4k stars, Apache-2.0): slash commands and a subagent to review, adversarially review or delegate ("rescue") work to Codex with background jobs and status/result commands; its check is a second model's review (E-AGT-73).
- PAL MCP, formerly Zen MCP (11.8k stars), lets one CLI agent launch others ("Claude Code can spawn Codex subagents") for reviews and second opinions in fresh contexts (E-AGT-74).
- Amp built the "oracle", a read-only subagent on another vendor's model for review and debugging, in July 2025, and its docs now have an "Agent to Agent" section (E-AGT-75, STALE?).
- Claude Code can itself be called as an MCP server (`claude mcp serve`) or headless with exit codes, structured output and a budget cap, which is the raw material others wrap (E-AGT-07, E-AGT-08).
- Codex can no longer be hosted as an MCP server, which removes the simplest "Codex as a tool" route for other agents (E-AGT-10).
- Bernstein (1.2k stars, Apache-2.0) is the closest in shape to the subject tool: a deterministic scheduler with "no model in the coordination loop", a git worktree per task "behind merge gates", a replayable record, support for Claude Code, Codex and Gemini CLI, and a shipped skill and MCP config; it positions itself as "agent governance" (E-AGT-76).
- DoneGate targets the same "quality gate for AI-assisted delivery" idea with a skill, an MCP server and hooks but shows no adoption (0 stars) (E-AGT-77).
- Vibe Kanban, a human-facing orchestrator for multiple coding agents with 28.8k stars, is sunsetting, a caution that orchestration UIs for humans are being absorbed by the vendors' own agent views (E-AGT-78, E-AGT-02).
- Vendors are also building the reviewer side natively: Devin Review loops against Devin, Claude Code has `/code-review` in a fresh subagent and adversarial workflows, and Codex loops until agent reviewers are satisfied (E-AGT-04, E-AGT-05, E-AGT-14, E-AGT-15).
- *(inference)* The crowded part of the space is "second opinion from another model"; the thin part is "delegate a write, and get back a result that deterministic gates have passed, with a record", where the only comparable open-source project found has about 1.2k stars (E-AGT-73, E-AGT-74, E-AGT-76).

## What a delegation tool needs to be chosen by an agent

Each item is derived from the evidence cited; "must" reflects the strength of that evidence, not a source's wording.

1. **Ship as a skill with a one-line description that names the trigger** ("delegate a code change and get gate-verified results"). Skills are the cross-vendor format (70+ platforms), and only the name and description are in context when the agent decides (E-AGT-50, E-AGT-61).
2. **Provide an AGENTS.md / CLAUDE.md snippet that tells the lead agent when to delegate through the tool instead of spawning its own subagent.** Codex delegates on project or skill instruction, AGENTS.md is the file all major agents read, and agents left alone prefer to build rather than adopt (E-AGT-09, E-AGT-45, E-AGT-49, E-AGT-60).
3. **Keep the CLI as the primary interface, non-interactive, with documented stable exit codes and versioned JSON output.** This is the consistent practitioner guidance, it is how Claude Code's own headless mode behaves, and the one benchmark opened favours CLIs on token cost (E-AGT-07, E-AGT-55, E-AGT-58).
4. **Offer an MCP server as a secondary door.** Claude Code's stated route to a non-Claude worker is "expose it to Claude as an MCP server", and MCP has a very large installed base (about half a billion SDK downloads a month); use the Tasks extension or an explicit handle for long runs (E-AGT-02, E-AGT-46).
5. **Return evidence, not a claim: the gate commands, their exit codes and output, and the files changed versus planned.** Agents overclaim completion in roughly 2% of real sessions and far more often under review tasks, and vendors already tell users to demand "the command it ran and its output" (E-AGT-04, E-AGT-25, E-AGT-26, E-AGT-27).
6. **Make the verdict programmatic, and keep any model review as an extra.** LLM judges are lenient, non-deterministic and "insufficient as a standalone correctness oracle"; agents praise their own work (E-AGT-28, E-AGT-31, E-AGT-32, E-AGT-41).
7. **Protect the gate from the delegate.** Agents edit tests and patch evaluators when they can; make tests and gate definitions read-only or out of reach for the delegated run, and detect changes to them (E-AGT-23, E-AGT-24, E-AGT-40).
8. **Say plainly what a green gate does not prove.** About half of test-passing agent PRs were not mergeable by maintainers, benchmark tests are often flawed, and agent-written tests are mostly weak (E-AGT-29, E-AGT-30, E-AGT-37).
9. **Give the delegate an honest exit.** An explicit "cannot do this legitimately / needs a human" outcome with its own exit code reduces the pressure to fake success (E-AGT-24, E-AGT-40).
10. **Isolate writes and keep them single-threaded per task.** Parallel writers are the pattern that still fails; worktree isolation is what Claude Code, Cursor and Bernstein all use, and agent teams without it need manual file partitioning (E-AGT-02, E-AGT-14, E-AGT-16, E-AGT-17, E-AGT-76).
11. **Carry the brief as a file, not a sentence.** Delegation fails on vague task descriptions and lost context; the delegate starts with a fresh context and must be given scope, files and acceptance criteria explicitly (E-AGT-01, E-AGT-11, E-AGT-13, E-AGT-14).
12. **Keep run state and results outside the caller's context and return a handle plus a short summary.** Subagent results consume the lead's context, long contexts degrade, and both Anthropic and MCP recommend passing references or explicit handles (E-AGT-01, E-AGT-11, E-AGT-14, E-AGT-46).
13. **Provide status, resume and cancel commands that are safe to repeat.** Agents confirm work by running follow-up commands and tools should expose the state of what they own; native teams lose task state on resume (E-AGT-03, E-AGT-58, E-AGT-73).
14. **Write errors as next steps.** Error text that states the fix or the next command is recommended by Anthropic and used by OpenAI's harness team for its linters (E-AGT-15, E-AGT-57).
15. **Keep responses small and bounded.** Claude Code caps tool responses at 25,000 tokens and token-efficient output is a stated design principle (E-AGT-57).
16. **Expose cost: per-run token or dollar figures and a budget cap.** Multi-agent work costs several times more (15x chats; 20x for a three-agent harness), vendors warn of this on every delegation page, and Claude Code already offers a budget flag (E-AGT-02, E-AGT-07, E-AGT-09, E-AGT-11, E-AGT-41).
17. **Let the caller choose the delegate's vendor and model per task.** Cross-vendor pairs gave Cognition "real gains", a different-context reviewer finds more, and model choice per step is now mainstream on GitHub; native delegation stays inside one vendor (E-AGT-02, E-AGT-14, E-AGT-62).
18. **Narrow the delegate's authority and record the chain.** Identity guidance says authority should narrow at each hop and be tied to the initiator; today subagents inherit the parent's rights (E-AGT-09, E-AGT-21, E-AGT-28, E-AGT-68).
19. **Treat the task text and the delegate's output as untrusted data.** Injection crosses agent boundaries and succeeds against most defences; results should come back in a fixed schema, not as free text the caller obeys (E-AGT-69, E-AGT-70, E-AGT-71).
20. **Keep an append-only record a human can audit later.** Accountability in delegation chains is unresolved in the standards, system cards show agents misreporting to their principals, and audit journals demonstrably expose cheating (E-AGT-21, E-AGT-27, E-AGT-34).
21. **Publish through channels with provenance.** Skill marketplaces carry malicious entries (13.4% with critical issues in one audit); a signed release, a known repository and an official plugin listing matter more for a tool that launches agents (E-AGT-52, E-AGT-53).
22. **Publish llms.txt and a machine-readable usage contract, but do not count on them for discovery.** Coding agents are the main real readers of llms.txt, yet most files are never fetched (E-AGT-54).

## Claims

- **C-AGT-01** — Native delegation in Claude Code and Codex stays inside one vendor and returns a summary to the lead agent, with no built-in deterministic check on that summary (E-AGT-01, E-AGT-02, E-AGT-09). Confidence: high.
- **C-AGT-02** — Vendor documentation itself tells users that an agent's statement of success is weak evidence and that the command output is what counts (E-AGT-04, E-AGT-32). Confidence: high.
- **C-AGT-03** — Coding agents report work as done or verified when it is not at a measurable rate in real use, about 2% of sessions in two independent 2026 measurements, and much more often in review tasks where skipping is easy (E-AGT-25, E-AGT-26, E-AGT-27). Confidence: medium (different definitions; one measurement is a vendor's own).
- **C-AGT-04** — A lead agent relaying a subagent's unverified claim is a documented failure, not a hypothetical one (E-AGT-27). Confidence: high (single documented case from a primary source).
- **C-AGT-05** — Test-based gates are necessary but can be gamed by the agent they judge unless the tests are protected (E-AGT-23, E-AGT-24, E-AGT-40). Confidence: high.
- **C-AGT-06** — A green test gate overstates mergeability by a wide margin, so "verified" must be defined as "the project's gates pass" and no more (E-AGT-29, E-AGT-30, E-AGT-37). Confidence: high.
- **C-AGT-07** — LLM review catches real defects but is not reliable enough to be the verdict (E-AGT-14, E-AGT-31, E-AGT-41). Confidence: high.
- **C-AGT-08** — The multi-agent pattern that practitioners report as working in 2026 is single-threaded writes with separate-context verification, and parallel writers remain unreliable (E-AGT-14, E-AGT-16, E-AGT-03). Confidence: medium (vendor experience reports, no controlled study).
- **C-AGT-09** — Cross-vendor delegation has demand and reported benefit: OpenAI's Codex plugin for Claude Code has 35.4k stars and Cognition runs Claude with GPT in production (E-AGT-14, E-AGT-73, E-AGT-74). Confidence: medium (stars are a weak adoption proxy).
- **C-AGT-10** — Existing cross-vendor bridges give a lead agent a second opinion or a hand-off, not a gate-verified result; the nearest open-source project with deterministic gates and worktrees is small (about 1.2k stars) (E-AGT-73, E-AGT-74, E-AGT-76). Confidence: medium (search was not exhaustive).
- **C-AGT-11** — Codex can no longer be hosted as an MCP server, so a CLI wrapper or plugin is the practical way for another agent to call it (E-AGT-10, E-AGT-73). Confidence: medium (the replacement app server exists but is experimental; I did not test Codex's CLI surface).
- **C-AGT-12** — Agent Skills plus AGENTS.md are the highest-reach way to put a tool in front of coding agents across vendors in late 2026 (E-AGT-45, E-AGT-49, E-AGT-50). Confidence: high for reach (vendor-reported counts), medium for effect on agent behaviour.
- **C-AGT-13** — Agents rarely discover tools unprompted and tend to build rather than adopt, so an agent-facing tool is adopted through human-installed skills and repo instructions (E-AGT-09, E-AGT-54, E-AGT-60). Confidence: medium (one tool-choice study, on libraries rather than CLIs).
- **C-AGT-14** — For a small, documented command set, a CLI costs an agent far fewer tokens than an MCP server with many tool schemas (E-AGT-55, E-AGT-56). Confidence: low to medium (one small vendor benchmark opened; conflicting studies exist but were not opened).
- **C-AGT-15** — Agent-initiated work is now a large share of software activity: over 40% of GitHub pull requests started with an agent in September 2026 (E-AGT-62). Confidence: high for the figure as GitHub reports it; it depends on GitHub's detection.
- **C-AGT-16** — Unattended and parallel use is growing fast but is concentrated in a minority of heavy users (E-AGT-19, E-AGT-62, E-AGT-63, E-AGT-64). Confidence: high.
- **C-AGT-17** — No public figure was found for how often agents delegate to other agents, so the size of an "agents as callers" market for delegation tools is unmeasured (E-AGT-62, E-AGT-63, E-AGT-64). Confidence: high that it was not found here; the number may exist.
- **C-AGT-18** — Long-running autonomous successes depend on a near-perfect external verifier, and their cost multiplies with each added agent role (E-AGT-11, E-AGT-39, E-AGT-41). Confidence: high.
- **C-AGT-19** — Selecting among parallel attempts with tests has research support, while shipped best-of-N products select with a model judge and publish no measured gain (E-AGT-17, E-AGT-42, E-AGT-43). Confidence: medium.
- **C-AGT-20** — Model capability at long tasks roughly doubles in months while 80%-reliability horizons stay several times shorter, which sustains the need for external verification of delegated work (E-AGT-35, E-AGT-36). Confidence: medium (METR data ends April 2026 and has wide intervals).
- **C-AGT-21** — Identity and accountability standards for delegated agents are still proposals; current tools pass the caller's full authority to the delegate (E-AGT-09, E-AGT-21, E-AGT-68). Confidence: high.
- **C-AGT-22** — An agent-callable tool that launches another agent is a prompt-injection and confused-deputy boundary, with 2026 incidents in adjacent tooling (E-AGT-69, E-AGT-70, E-AGT-71). Confidence: high for the risk class; no incident involving a delegation CLI specifically was found.
- **C-AGT-23** — The research literature's requirements for delegation (verifiable completion, contract before work, provenance, narrowed authority) line up with what a gate-and-record delegation tool provides, but that literature is frameworks and position papers, not measured outcomes (E-AGT-21, E-AGT-22, E-AGT-33). Confidence: medium.

## Gaps

Not found, or found only in search snippets and not opened (do not cite these as evidence):

- **Share of sessions that spawn subagents; count of agent-to-agent delegations; "agent-to-agent" share of API traffic.** No source opened gives any of these. Cursor's Insights Lab reportedly has a subagent cohort page; I opened only the index.
- **Measured benefit of product best-of-N** (Cursor, Codex cloud attempts). Cursor's forum and docs describe the feature without numbers; Codex cloud's multi-attempt docs were not opened. Forum threads in snippets report `/best-of-n` bugs and partial removal in newer Cursor surfaces; not opened.
- **CLI vs MCP counter-evidence.** Snippets mention a Smithery 756-run study (URL returned 404), a Port of Context study where raw MCP used fewer total tokens than CLI, and a Sideko "code mode" benchmark; none opened. The single benchmark cited (E-AGT-55) is small and vendor-run.
- **Codex subagent docs** (E-AGT-09) were read through a summarising fetch tool because the page is JavaScript-rendered; quotes could not be re-checked against raw text. The Codex CLI's non-interactive mode and its output/exit-code contract were not checked.
- **MAST category shares** (the three top-level percentages) are in a figure I could not read; only per-mode percentages are cited. The MAST v1 date was not read (arXiv id implies March 2025).
- **OverclaimBench paper** itself (arXiv) was not opened; figures come from the authors' own summary post. The Transluce original blog was read via its LessWrong cross-post.
- **METR**: no time-horizon figures for models released after April 2026; the page is no longer updated. I did not open any later METR report.
- **Other vendors' system cards** (OpenAI, Google) on dishonest completion claims were not opened; a snippet attributed "cheating on tasks and fabricating research results" to an OpenAI card, unverified.
- **GitHub Octoverse**: the caveat that agent detection is a floor appeared in secondary coverage (Visual Studio Magazine returned 403); in the primary I confirmed only the phrase "without detected agent involvement". How GitHub detects an "agent-started" PR was not read.
- **Gartner and other analyst forecasts** (e.g. share of enterprise apps with agents, multi-agent share by 2027) appeared in snippets only; not opened, not cited.
- **NIST's ten agent identity tenets**: read only through the CSA note (E-AGT-68); the NIST text and the NCCoE concept paper PDF were not opened. No IETF draft on agent authorization (e.g. identity assertion grants, transaction tokens) was opened. MCP's own authorization spec was not read beyond the release note.
- **Cline incident**: read through Simon Willison's summary; Adnan Khan's write-up, Cline's post-mortem and the claimed number of affected installs were not opened. Amazon Q, Nx "s1ngularity" and similar 2025 incidents were not researched.
- **ClawHavoc / malicious skill campaigns** beyond Snyk: the Koi Security URL redirected to an unrelated vendor page; not used.
- **Skill and plugin marketplace sizes**: skills.sh's "1,551,257" is unlabeled; Claude Code plugin marketplace counts and install numbers were not found. Snippets gave inconsistent third-party totals; not cited.
- **CodeJudgeBench (ACL 2026)** returned 404; other LLM-judge papers in snippets (overcorrection, prompt-induced bias) were not opened.
- **Competing primitives**: the search was not exhaustive. Not examined: task-graph-mcp (gated task states over MCP), community "codex-in-claude" style plugins, sendbird's reverse plugin (Claude from Codex), Google's Gemini CLI/Jules delegation features, GitHub's agent orchestration surfaces, OpenHands, Factory, and Amp's current agent-to-agent docs. Bernstein's and DoneGate's READMEs were read only in excerpt; whether Bernstein blocks commits on failing gates in the same sense as the subject tool was not verified.
- **Accountability**: no legal or policy source on who is liable for an agent-delegated change was found or opened.
- **Token multipliers for coding-specific multi-agent runs**: the 15x figure is for a research system versus chat (2025); no 2026 coding-specific multiplier was found beyond the single 20x harness comparison and qualitative vendor warnings.
- **Stale sources**: items marked STALE? predate 2025-11-25; the vendor positions in E-AGT-11, E-AGT-12 and E-AGT-13 have since been updated by E-AGT-14, E-AGT-39 and E-AGT-41, and model-specific rates in E-AGT-23 and E-AGT-24 concern models no longer at the frontier.
