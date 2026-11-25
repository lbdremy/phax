# Competitors: local / open-source orchestrators, runners and loop tools around AI coding agent CLIs

Research notes, state of the cluster on 2026-11-25. "The subject tool" is the Apache-2.0 "verified delegation" CLI described in the brief; it was never searched for by name.

Reading conventions for this file:

- Every source was opened in this session on 2026-11-25. Nothing is stated from memory.
- **raw** = I read the source text directly (GitHub API, raw README/doc file, `.md` export of a docs page, HN Algolia API). Quotes are verbatim.
- **extracted** = the page was read through a fetch tool that returns a model-made extraction. Quotes are as the tool returned them; re-check the wording against the page before publishing a quote.
- **search-only** = seen only as a search-result summary, page not opened. Never used for a claim rated above "low".
- "README" sources are the default-branch README on 2026-11-25; they carry no publication date ("undated").
- Sources older than 12 months (before 2025-11-25) are flagged **STALE?**.
- Vendor READMEs, docs and blogs are vendor claims unless a line says otherwise.

## Evidence

### E-ORCH-01: GitHub repository metadata (stars, license, dates)

- Source: GitHub REST API, `gh api repos/<owner>/<repo>` and `.../releases/latest`. Publisher: GitHub. Date: live values read 2026-11-25. Type: repo (raw). Independent of vendor wording (counts are GitHub's).
- "created" is the repository creation date, used as a proxy for first public release. "REL" is the latest GitHub release. "→" marks a redirect to a renamed or moved repository.

| Repo queried → resolved | Stars | Forks | License (SPDX) | Created | Last push | Latest release | Note |
|---|---|---|---|---|---|---|---|
| BloopAI/vibe-kanban | 28,812 | 3,073 | Apache-2.0 | 2025-06-14 | 2026-11-15 | v0.1.46.x, 2026-11-15 | README: "sunsetting" |
| smtg-ai/claude-squad | 8,866 | 640 | AGPL-3.0 | 2025-03-09 | 2026-11-13 | v1.0.20, 2026-08-20 | |
| stravu/crystal | 3,128 | 195 | MIT | 2025-06-05 | 2026-02-26 | v0.3.5, 2026-02-26 | deprecated Feb 2026 |
| nimbalyst/nimbalyst | 2,111 | 346 | MIT | 2025-10-30 | 2026-11-23 | v0.83.0, 2026-11-10 | Crystal successor |
| steveyegge/gastown → gastownhall/gastown | 18,889 | 1,706 | MIT | 2025-12-16 | 2026-11-14 | v1.2.1, 2026-06-06 | |
| steveyegge/beads → gastownhall/beads | 29,042 | 1,959 | MIT | 2025-10-12 | 2026-11-24 | v1.3.4, 2026-11-04 | |
| gastownhall/gascity | 1,581 | 487 | MIT | 2026-02-22 | 2026-11-25 | v1.5.1, 2026-10-24 | 1,847 open issues |
| frankbria/ralph-claude-code | 9,738 | 727 | MIT | 2025-08-27 | 2026-11-14 | no GitHub release | |
| mikeyobrien/ralph-orchestrator | 3,213 | 306 | MIT | 2025-09-07 | 2026-11-13 | v2.12.0, 2026-11-13 | |
| snarktank/ralph | 22,343 | 2,122 | MIT | 2026-01-07 | 2026-02-02 | no GitHub release | no push since Feb 2026 |
| subsy/ralph-tui | 2,475 | 237 | MIT | 2026-01-11 | 2026-11-04 | v0.12.0, 2026-05-13 | not profiled |
| generalaction/emdash | 6,305 | 676 | Apache-2.0 | 2025-08-28 | 2026-11-23 | v1.2.13, 2026-11-19 | now "Emdash Classic" |
| imbue-ai/sculptor | 286 | 25 | MIT | 2025-08-07 | 2026-11-24 | sculptor-v0.50.0, 2026-11-16 | |
| ruvnet/claude-flow → ruvnet/ruflo | 82,394 | 9,706 | MIT | 2025-06-02 | 2026-11-25 | v3.80.7, 2026-11-25 | |
| sst/opencode → anomalyco/opencode | 229,054 | 31,176 | MIT | 2025-04-30 | 2026-11-25 | v1.19.6, 2026-11-17 | |
| code-yeongyu/oh-my-opencode → code-yeongyu/oh-my-openagent | 71,101 | 5,838 | NOASSERTION | 2025-12-03 | 2026-11-25 | v5.1.83, 2026-11-24 | |
| Yeachan-Heo/oh-my-claudecode | 41,055 | 3,661 | MIT | 2026-01-09 | 2026-11-25 | v5.8.7, 2026-11-24 | |
| Aider-AI/aider | 50,249 | 5,189 | Apache-2.0 | 2023-05-09 | 2026-05-22 | v0.86.0, 2025-08-09 | **STALE?** release > 12 months old |
| block/goose → aaif-goose/goose | 56,970 | 6,667 | Apache-2.0 | 2024-08-23 | 2026-11-25 | v1.61.0, 2026-11-25 | |
| All-Hands-AI/OpenHands → OpenHands/OpenHands | 94,291 | 12,630 | MIT | 2024-03-13 | 2026-11-25 | v1.45.0, 2026-11-24 | |
| dagger/container-use | 4,106 | 214 | Apache-2.0 | 2025-05-23 | 2026-11-14 | v0.4.2, 2025-08-19 | **STALE?** release > 12 months old |
| slopus/happy | 24,812 | 2,139 | MIT | 2025-07-18 | 2026-11-25 | cli-1.2.5, 2026-09-22 | |
| omnara-ai/omnara | 3,448 | 278 | Apache-2.0 | 2025-07-09 | 2026-11-25 | omnarad-v0.2.27, 2026-11-20 | |
| manaflow-ai/cmux | 28,960 | 2,705 | NOASSERTION | 2026-01-28 | 2026-11-25 | v0.65.2.2, 2026-10-27 | 11,151 open issues |
| superset-sh/superset → ParadevAI/Paradev | 16,617 | 1,497 | MIT | 2025-10-21 | 2026-11-25 | desktop-v2.0.11, 2026-11-20 | renamed Superset → Paradev |
| marcus/sidecar | 1,096 | 81 | MIT | 2025-12-26 | 2026-10-08 | v1.17.1, 2026-10-08 | |
| pedramamini/Maestro → RunMaestro/Maestro | 3,625 | 387 | AGPL-3.0 | 2025-11-23 | 2026-11-25 | v1.0.4, 2026-11-21 | |
| its-maestro-baby/maestro | 1,183 | 127 | MIT | 2026-01-07 | 2026-04-19 | v0.2.5, 2026-04-06 | not profiled |
| johannesjo/parallel-code | 1,106 | 152 | MIT | 2026-02-18 | 2026-11-24 | v5.1.0, 2026-10-29 | |
| coder/mux → coder/xum | 2,082 | 142 | AGPL-3.0 | 2025-09-17 | 2026-11-24 | v0.32.5, 2026-11-22 | renamed Mux → Xum |
| ComposioHQ/agent-orchestrator → OrchestratorInc/agent-orchestrator | 15,118 | 2,076 | Apache-2.0 | 2026-02-13 | 2026-11-25 | v0.15.6, 2026-11-24 | |
| coleam00/Archon | 23,995 | 3,545 | MIT | 2025-02-07 | 2026-11-25 | v0.14.0, 2026-11-07 | repo predates the workflow engine (v1 was RAG/task mgmt) |
| EveryInc/compound-engineering-plugin | 26,224 | 2,056 | MIT | 2025-10-09 | 2026-11-23 | v3.38.3, 2026-11-23 | |
| humanlayer/humanlayer | 12,955 | 1,093 | Apache-2.0 | 2024-08-05 | 2026-11-23 | pro-0.20.0, 2025-12-23 | |
| humanlayer/12-factor-agents | 27,414 | 2,065 | NOASSERTION | 2025-03-30 | 2025-09-21 | none | **STALE?** last push > 12 months ago |
| Kilo-Org/kilocode | 28,119 | 3,394 | MIT | 2025-03-10 | 2026-11-24 | v7.8.32, 2026-11-20 | |
| RooCodeInc/Roo-Code | 24,236 | 3,449 | Apache-2.0 | 2024-10-31 | 2026-05-15 | v3.54.0, 2026-05-15 | **archived** |
| langchain-ai/deepagents | 31,576 | 4,468 | MIT | 2025-07-27 | 2026-11-25 | deepagents==0.7.41, 2026-11-20 | |
| langchain-ai/open-swe | 11,260 | 1,330 | MIT | 2025-05-21 | 2026-11-25 | desktop-v0.3.20, 2026-11-21 | README now titled "Robin" |
| openai/codex | 136,381 | 21,634 | Apache-2.0 | 2025-04-13 | 2026-11-25 | rust-v0.172.0, 2026-11-24 | |
| openai/symphony | 28,153 | 2,905 | Apache-2.0 | 2026-02-26 | 2026-09-15 | v0.0.3, 2026-09-15 | |
| anthropics/claude-code | 156,993 | 25,101 | none (not open source) | 2025-02-22 | 2026-11-25 | v2.1.332, 2026-11-25 | |
| google-gemini/gemini-cli | 109,090 | 15,002 | Apache-2.0 | 2025-04-17 | 2026-11-25 | v0.71.1, 2026-11-24 | not profiled |
| covibes/zeroshot → the-open-engine/zeroshot | 2,227 | 215 | MIT | 2025-12-25 | 2026-11-25 | v17.1.1, 2026-11-22 | |
| fabro-sh/fabro | 1,891 | 210 | MIT | 2026-03-13 | 2026-11-23 | v0.254.0, 2026-06-04 | |
| evmts/smithers → smithersai/smithers | 451 | 50 | MIT | 2026-01-05 | 2026-11-25 | v0.35.0, 2026-08-17 | |
| mattpocock/sandcastle | 9,272 | 996 | MIT | 2026-03-17 | 2026-11-18 | v0.14.0, 2026-11-02 | |
| Shopify/roast | 1,258 | 80 | MIT | 2025-04-09 | 2026-11-14 | v1.4.1, 2026-11-10 | |
| strongdm/attractor | 1,350 | 195 | Apache-2.0 | 2026-02-05 | 2026-03-17 | none | spec only |
| obra/superpowers | 326,112 | 28,940 | MIT | 2025-10-09 | 2026-11-24 | v7.0.2, 2026-11-03 | |
| github/spec-kit | 151,322 | 13,600 | MIT | 2025-08-21 | 2026-11-24 | v1.4.4, 2026-11-23 | |
| Fission-AI/OpenSpec | 75,678 | 5,177 | MIT | 2025-08-05 | 2026-11-25 | v2.2.0, 2026-11-24 | not profiled |
| bmad-code-org/BMAD-METHOD | 55,713 | 6,212 | NOASSERTION | 2025-04-13 | 2026-11-25 | v6.12.4, 2026-10-14 | not profiled |
| gsd-build/get-shit-done | 64,114 | 5,441 | MIT | 2025-12-14 | 2026-05-31 | v1.42.3, 2026-05-16 | **archived** |
| eyaltoledano/claude-task-master | 28,547 | 2,638 | NOASSERTION | 2025-03-04 | 2026-04-28 | 0.43.1, 2026-03-31 | not profiled |
| paperclipai/paperclip | 116,864 | 19,401 | MIT | 2026-03-02 | 2026-11-25 | v2026.1117.0, 2026-11-18 | |
| multica-ai/multica | 57,842 | 7,606 | NOASSERTION | 2026-01-13 | 2026-11-25 | v0.12.1, 2026-11-23 | |
| AndyMik90/Auto-Claude → AndyMik90/Aperant | 14,628 | 1,884 | AGPL-3.0 | 2025-12-04 | 2026-06-14 | v2.7.6, 2026-02-20 | |
| automazeio/ccpm | 8,468 | 839 | MIT | 2025-08-18 | 2026-11-04 | none | not profiled |
| kbwo/ccmanager | 1,282 | 95 | MIT | 2025-06-07 | 2026-10-27 | v4.4.11, 2026-10-27 | not profiled |
| asheshgoplani/agent-deck | 1,303 | 238 | MIT | 2025-12-03 | 2026-11-23 | v1.16.40, 2026-11-22 | not profiled |
| wshobson/agents | 42,873 | 4,541 | MIT | 2025-07-24 | 2026-11-24 | none | not profiled |
| getAsterisk/claudia → winfunc/opcode | 22,465 | 1,706 | AGPL-3.0 | 2025-06-19 | 2026-11-06 | v0.2.0, 2025-08-31 | **STALE?** release > 12 months old; not profiled |

### Session managers and parallel-agent workspaces

**E-ORCH-02** — Vibe Kanban README. BloopAI. https://github.com/BloopAI/vibe-kanban. Undated. Accessed 2026-11-25. Repo (raw).
- "Vibe Kanban is sunsetting. Read the announcement."
- "In a world where software engineers spend most of their time planning and reviewing coding agents, the most impactful way to ship more is to get faster at planning and review."
- "**Run coding agents in workspaces** — each workspace gives an agent a branch, a terminal, and a dev server"; "**Review diffs and leave inline comments** — send feedback directly to the agent without leaving the UI"; "**Switch between 10+ coding agents** — Claude Code, Codex, Gemini CLI, GitHub Copilot, Amp, Cursor, OpenCode, Droid, CCR, and Qwen Code"; "**Create pull requests and merge**".
- Environment table lists `MCP_HOST` / `MCP_PORT` ("MCP server connection host") and `DISABLE_WORKTREE_CLEANUP` ("Disable all git worktree cleanup").

**E-ORCH-03** — "Shutdown" post. Louis Knight-Webb, bloop (vibekanban.com/blog/shutdown). https://vibekanban.com/blog/shutdown. 2026-04-10. Accessed 2026-11-25. Vendor blog (extracted).
- "we couldn't find a business model that we could get excited about."
- "Thousands of software engineers use Vibe Kanban every day to ship more with coding agents"; "the vast majority are free users."
- "The Vibe Kanban project will live on, open source and community maintained."
- "software engineers are spending more time planning and reviewing code".

**E-ORCH-04** — Claude Squad README. smtg-ai. https://github.com/smtg-ai/claude-squad. Undated. Accessed 2026-11-25. Repo (raw).
- "a terminal app that manages multiple Claude Code, Codex, Gemini (and other local agents including Aider) in separate workspaces".
- "Complete tasks in the background (including yolo / auto-accept mode!)"; "Review changes before applying them, checkout changes before pushing them"; "Each task gets its own isolated git workspace, so no conflicts".
- Prerequisites: tmux, gh. Menu: "`s` - Commit and push branch to github"; "tab - Switch between preview tab and diff tab".

**E-ORCH-05** — Crystal README. stravu. https://github.com/stravu/crystal. Undated. Accessed 2026-11-25. Repo (raw).
- "Crystal (formerly a multi-session AI code assistant manager) has been deprecated and replaced by Nimbalyst. Deprecated: February 2026."

**E-ORCH-06** — Nimbalyst README. https://github.com/nimbalyst/nimbalyst. Undated. Accessed 2026-11-25. Repo (raw).
- "Open-source visual workspace for building with Codex, Claude Code, OpenCode, and other coding agents... Free and MIT licensed. Desktop app for macOS, Windows, and Linux, with an iOS..."
- "**Red/green diff review.** Step through the agent's proposed edits in the rendered document and accept or reject each one."; "**Parallel agent sessions.** Run several coding agents at once, each isolated in its own git worktree."

**E-ORCH-07** — Emdash README ("Emdash Classic"). General Action. https://github.com/generalaction/emdash. Undated. Accessed 2026-11-25. Repo (raw).
- "Emdash Classic is the open-source desktop app for running coding agents in parallel. Run Claude Code, Codex, OpenCode, and more in separate Git worktrees, on your machine or over SSH. Review diffs and open PRs without leaving the app."
- "Review diffs, create pull requests, inspect CI checks, and merge from one place."
- "The app automatically detects installed provider CLIs, including Claude Code, Codex, Cursor, OpenCode, Amp, Devin, Qwen Code, Droid, and GitHub Copilot."
- "It stores app state in a local SQLite database and does not send your code or chats to Emdash servers."

**E-ORCH-08** — emdash.com home page. General Action. https://emdash.com/. Footer "© 2026". Accessed 2026-11-25. Vendor marketing (extracted).
- "Coding agents for your whole team."; Classic "still gets fixes," but "new development has moved to Emdash 2.0."; "Backed by" Y Combinator (logo); call to action "Get early access"; no pricing on the page.
- Team features listed: shared dev environments, SSO and roles, PR reviews, usage tracking, spend limits across providers; agents "test applications, fix CI failures, and open PRs with visual evidence" (paraphrase by the extraction tool).

**E-ORCH-09** — Sculptor README. Imbue. https://github.com/imbue-ai/sculptor. Undated. Accessed 2026-11-25. Repo (raw).
- "Sculptor is a desktop app for running coding agents in parallel."
- "Sculptor is actively under development and should be treated as an experimental research preview. We are still learning what rigorous engineering looks like with agents."
- "Connect a repo, create a workspace (an isolated copy of your code), and prompt an agent. Review the changes when it's done and merge back to main."
- "Sculptor ships with integrated support for the Pi agentic harness in addition to Claude Code. Sculptor also allows you to run and manage _any_ terminal-based agents."
- Docs list: "Workspaces: isolated worktrees of your repo"; "Container Backend: running in Docker or on a remote (experimental)".

**E-ORCH-10** — Sculptor `docs/help/skills.md`. Imbue. https://github.com/imbue-ai/sculptor/blob/main/docs/help/skills.md. Undated. Accessed 2026-11-25. Repo docs (raw).
- "The pipeline: **spec → mock → architect → plan → build → review**"; each stage "is its own skill, runs as its own agent ... and produces a durable artifact the next stage reads from disk."
- Build: "works through each task file in order, re-reading its per-task instructions every time so it doesn't drift (skip verification, forget to commit, or jump ahead), and commits after each task. The plan's final tasks run a full test pass and spawn the Review agent."
- Review: "walks the diff to confirm the requirements are met and tests were written; re-runs the suite; invokes the repo's configured code-review skill; and writes the findings to `review.md`. It doesn't fix anything — you decide what to do with the findings."
- "`/sculptor:sculpt-cli` to drive Sculptor from the `sculpt` CLI".

**E-ORCH-11** — Conductor home page. https://www.conductor.build/. Undated. Accessed 2026-11-25. Vendor marketing (extracted).
- "Run parallel coding agents on your Mac."; "Create parallel Claude Code, Codex, and Cursor agents in isolated workspaces"; "See at a glance what they're working on, then review and merge their changes."; latest version shown "0.100.0". No price, license or user numbers on the page.

**E-ORCH-12** — Conductor docs, Introduction and "Checks" reference. https://www.conductor.build/docs/ and https://www.conductor.build/docs/reference/checks. Undated. Accessed 2026-11-25. Primary docs (extracted).
- "Each task gets its own workspace, branch, files, terminal, diff, and review path."; "When the work is ready, Conductor helps you review the diff, open a pull request, merge, and archive the workspace."
- Checks sections: Git status, pull request metadata, CI and status checks, deployments, GitHub comments and review threads, todos. "The available sections depend on the repository, whether a pull request exists, and which integrations are connected."
- Conductor "may block or discourage merge actions when required work is still open"; "Send unresolved comments to the agent or resolve them yourself."
- Docs navigation includes a "Conductor API" page (not opened).

**E-ORCH-13** — "Meta acquires Conductor as AI coding shifts toward multi-agent development". Prasanth Aby Thomas, InfoWorld. https://www.infoworld.com/article/4245065/meta-acquires-conductor-as-ai-coding-shifts-toward-multi-agent-development.html. 2026-11-05. Accessed 2026-11-25. News (extracted).
- Conductor "coordinates work across competing AI coding agents"; launched July 2025; terms not disclosed; stopped accepting new users.
- Cloud read-only 2026-11-13, shut down 2026-11-20; local app keeps receiving new models and critical fixes until early 2027.
- Analyst Lian Jye Su: "Human review before merging changes is an important control point."

**E-ORCH-14** — "Meta brings Conductor on board its model train". Thomas Claburn, The Register. https://theregister.com/ai-and-ml/2026/11/05/meta-brings-conductor-on-board-its-model-train/5307711. 2026-11-05. Accessed 2026-11-25. News (extracted).
- Conductor is "the eponymous company's macOS app for running multiple coding agents simultaneously in isolated copies of Git projects."; Charlie Holtz "co-founder and CEO"; no price announced; no funding or user numbers in the article.

**E-ORCH-50** — Happy README. slopus. https://github.com/slopus/happy. Undated. Accessed 2026-11-25. Repo (raw).
- "**Any model: Claude, Codex, Grok, Gemini, and more.**"; "**Reuse your subscriptions.**"; "**End-to-end encrypted mobile app.**"; "**Natively multiplayer.** Invite a colleague or a friend into the session."

**E-ORCH-51** — Omnara README. https://github.com/omnara-ai/omnara. Undated. Accessed 2026-11-25. Repo (raw).
- "The open-source, self-hostable alternative to Claude Managed Agents and OpenAI's Agents API."

**E-ORCH-52** — cmux README. manaflow-ai. https://github.com/manaflow-ai/cmux. Undated. Accessed 2026-11-25. Repo (raw).
- "A Ghostty-based macOS terminal with vertical tabs and notifications for AI coding agents"; "Panes get a blue ring and tabs light up when coding agents need your attention".
- Browser pane "is fully programmable ... over the same socket API. Agents use it to verify their own web changes without leaving cmux."

**E-ORCH-53** — Paradev README (formerly Superset). https://github.com/ParadevAI/Paradev. Undated. Accessed 2026-11-25. Repo (raw).
- "Paradev is the workspace for running parallel coding agents."; "Every task gets its own worktree, branch, and terminal."
- "**Agents can drive it too.** Our CLI, MCP server, and skills let agents drive the entire app and orchestrate other agents."
- "**Review the result** in **Changes**, run the tests, and preview your app in the browser pane before you commit."
- "Changes can still conflict when merged, and worktrees do not sandbox processes."
- "Automations need the Pro plan."

**E-ORCH-54** — Sidecar README. marcus. https://github.com/marcus/sidecar. Undated. Accessed 2026-11-25. Repo (raw).
- "Sidecar puts your entire development workflow in one shell: run AI coding agents in embedded interactive terminals, open td task issues, files, git diffs ..."
- CLI examples: "sidecar create worktree fix-auth --base main --agent claude"; "sidecar agent list --json"; "sidecar agent prompt reviewer "Review current diff" --wait --timeout 2m".

**E-ORCH-55** — Maestro README. RunMaestro. https://github.com/RunMaestro/Maestro. Undated. Accessed 2026-11-25. Repo (raw).
- "Collaborate with AI to create detailed specification documents, then let Auto Run execute them automatically, each task in a fresh session with clean context."
- "**Auto Run & Playbooks** - File-system-based task runner that batch-processes markdown checklists (Spec-Driven) or pursues a free-text objective (Goal-Driven) through AI agents."
- "**Command Line Interface** - Full CLI (`maestro-cli`) for headless operation ... with human-readable or JSONL output for scripting."; "**Cost Tracking** - Real-time token usage and cost tracking per session and globally."
- Supports "Claude Code, OpenAI Codex, OpenCode, Factory Droid, Copilot-CLI (beta), Qwen3 Coder (beta), and Oh My Pi (beta)".

**E-ORCH-56** — Parallel Code README. johannesjo. https://github.com/johannesjo/parallel-code. Undated. Accessed 2026-11-25. Repo (raw).
- "Run coding agents from any vendor in their own worktrees. See what each one changed and what was checked, then choose what ships."
- "**Review is built in** — a diff viewer with inline comments you send back to the agent, guided tours of the changes, and an optional second-opinion review by a separate model, so an agent never grades its own work."
- "confidence ratings from a separate reviewer model, per-file test coverage, before-and-after screenshots of UI changes"; "an arena that runs one prompt with two to four agents to compare"; "optionally its own Docker container".

**E-ORCH-57** — Xum README (formerly coder/mux). Coder. https://github.com/coder/xum. Undated. Accessed 2026-11-25. Repo (raw).
- "This project was renamed from Mux to Xum after Mux.com raised a trademark concern."; "Isolated workspaces" (Local, Worktree, SSH); "Multi-model"; "Integrated code-review for faster iteration"; "Stay looped in on costs and token consumption".

**E-ORCH-58** — Orchestrator.inc README (formerly ComposioHQ/agent-orchestrator). https://github.com/OrchestratorInc/agent-orchestrator. Undated. Accessed 2026-11-25. Repo (raw).
- "Stop babysitting agents. Start merging real work."; "every task gets its own agent, branch, and worktree, and your code stays on your machine."
- "Tell a project's main agent what you want built. It plans the work, starts a worker for each piece in its own worktree, and comes back only when something needs you."
- "Failed checks, review comments, and merge conflicts go back to the worker that owns the branch until the PR is approved. A reviewer agent can read every PR before a person does."

### Gas Town, Beads, Gas City

**E-ORCH-15** — Gas Town README. gastownhall (Steve Yegge). https://github.com/gastownhall/gastown. Undated. Accessed 2026-11-25. Repo (raw).
- "Gas Town is a workspace manager that lets you coordinate multiple AI coding agents (Claude Code, GitHub Copilot, Codex, Gemini, and others) working on different tasks."
- Table: "4-10 agents become chaotic | Scale comfortably to 20-30 agents"; "Work state stored in Beads ledger".
- "The Mayor ... Your primary AI coordinator. The Mayor is a Claude Code instance with full context about your workspace".
- "Hooks: Git worktree-based persistent storage for agent work."
- "Refinery: Per-rig merge queue processor. When polecats complete work via `gt done`, the Refinery batches merge requests, runs verification gates, and merges to main using a Bors-style bisecting queue. Failed MRs are isolated and either fixed inline or re-dispatched."
- "Molecules: Workflow templates that coordinate multi-step work. Formulas (TOML definitions) are instantiated as molecules with tracked steps."

**E-ORCH-16** — Gas City README. Gas City, Inc. https://github.com/gastownhall/gascity. Undated. Accessed 2026-11-25. Repo (raw).
- "Gas City runs teams of coding agents (Claude Code, Codex, Gemini, and others) on your repositories. You hand it work; it breaks the work into tasks, runs agents on them in parallel, gates each step on review, and tracks everything in a dashboard. How the work gets done is a **formula**".
- "An orchestrator that runs formulas as graphs: it breaks a job into beads, fans the ready ones out to many agents at once, gates each step on its dependencies and reviews, retries failures, and finishes outside your session".
- "`build-basic` formula plans, reviews, implements in parallel, reviews the code, ..."; "Gas City is open source under the MIT license and stewarded by Gas City, Inc."

**E-ORCH-17** — Beads README. https://github.com/gastownhall/beads. Undated. Accessed 2026-11-25. Repo (raw).
- "Distributed graph issue tracker for AI agents, powered by Dolt."; "It replaces messy markdown plans with a dependency-aware graph, allowing agents to handle long-horizon tasks without losing context."; "**Agent-Optimized:** JSON output, dependency tracking, and auto-ready task detection."; `bd ready --json`.

**E-ORCH-18** — "The Shape of Things to Come". Steve Yegge. https://yegge.ai/essays/the-shape-of-things-to-come/. August 2026 (no day). Accessed 2026-11-25. Author essay (extracted).
- "Gas Town fell apart at the seams with Opus 4.7."; it "effectively burned down".
- Wheelhouse is "my new harness for Wyvern", "closed-source, made just for me."
- "whenever the MQ hits 100, we abandon the bisection and just smash it all in with a megabatch."
- "every implementation bead goes through this lifecycle: Fable design, Opus implementation, Fable review."
- "burning the equivalent of $87k/month of API token burn" while "only spending about $2800/month out of pocket"; "40+ agents around the clock".
- On human code review being gone: "Not Yet. But it will be by next year".

**E-ORCH-19** — Quotation of Steve Yegge. Simon Willison's Weblog. https://simonwillison.net/2026/Aug/4/steve-yegge/. 2026-08-04. Accessed 2026-11-25. Independent blog quoting the author (extracted).
- "Gas Town was intended to be reusable, but I only ever wound up using it to build itself."; "Up through 4.6 it was working brilliantly."; "The Opus tic never went away, so Gas Town effectively burned down."

**E-ORCH-20** — "Steve Yegge Deleted the Wrong Thing". Julien Danjou (states he sells merge queues for a living). https://julien.danjou.info/blog/steve-yegge-deleted-the-wrong-thing. 2026-08-18. Accessed 2026-11-25. Independent analysis with a declared commercial interest (extracted).
- Quotes Yegge: "Just slam all the commits onto main, and then just friggin' deal with it."; "Once your commit rate outruns your build slots, one commit per green build becomes mathematically impossible."
- Danjou: a merge queue "keeps main buildable, it does not keep main good."; "Bisection was never really about finding the guilty commit. It was about finding the guilty intent."

**E-ORCH-21** — "Gas Town's agent patterns, design bottlenecks, and vibecoding at scale". Maggie Appleton. https://maggieappleton.com/gastown. Undated on page ("Planted 10 months ago"; HN submission 2026-01-23, see E-ORCH-83). Accessed 2026-11-25. Independent analysis (extracted, page truncated).
- "Design becomes the limiting factor"; Gas Town is "inefficiently burning through thousands of dollars a month in API costs."; "Gas Town is entirely vibecoded, hastily designed with off-the-cuff solutions."; section heading "Yegge never looks at code. When should we stop looking too?"

### Ralph loop and tools built on it

**E-ORCH-22** — snarktank/ralph: README, `ralph.sh`, `CLAUDE.md`. Ryan Carson. https://github.com/snarktank/ralph. Undated (last push 2026-02-02). Accessed 2026-11-25. Repo source (raw).
- README: "Ralph is an autonomous AI agent loop that runs AI coding tools (Amp or Claude Code) repeatedly until all PRD items are complete. Each iteration is a fresh instance with clean context. Memory persists via git history, `progress.txt`, and `prd.json`."
- README step list: "4. Run quality checks (typecheck, tests) 5. Commit if checks pass 6. Update `prd.json` to mark story as `passes: true`".
- `CLAUDE.md` (the prompt given to the agent): "6. Run quality checks (e.g., typecheck, lint, test - use whatever your project requires)"; "8. If checks pass, commit ALL changes"; "9. Update the PRD to set `passes: true` for the completed story"; "If ALL stories are complete and passing, reply with: <promise>COMPLETE</promise>".
- `ralph.sh` (113 lines): the only completion test in the script is `if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then`. No test, lint or typecheck command appears in the script (grep for `test|typecheck|lint` returns only the COMPLETE lines).

**E-ORCH-23** — frankbria/ralph-claude-code README. https://github.com/frankbria/ralph-claude-code. Undated. Accessed 2026-11-25. Repo (raw).
- "Autonomous AI development loop with intelligent exit detection and rate limiting".
- "**Dual-condition exit gate**: Requires BOTH completion indicators AND explicit EXIT_SIGNAL"; "Claude's explicit `EXIT_SIGNAL: true` in the RALPH_STATUS block".
- "Rate limiting with hourly reset (100 calls/hour, configurable)"; "Circuit breaker with advanced error detection (prevents runaway loops)".
- "Fixed premature exit bug: completion indicators now require Claude's explicit `EXIT_SIGNAL: true`".
- "E2B Cloud Sandbox Execution ... cost tracking with `--sandbox-max-cost`"; Docker sandbox: "Ralph's loop, rate limiting, and monitoring stay on the host; only Claude's execution ... is containerized."

**E-ORCH-24** — ralph-orchestrator README. mikeyobrien. https://github.com/mikeyobrien/ralph-orchestrator. Undated. Accessed 2026-11-25. Repo (raw).
- "A hat-based orchestration framework that keeps AI agents in a loop until the task is done."; "Ralph iterates until it outputs `LOOP_COMPLETE` or hits the iteration limit."
- "**Multi-Backend Support** — Claude Code, Kiro, Gemini CLI, Codex, Forge, Amp, Copilot CLI, OpenCode, Pi, Roo, OMP"; "**Backpressure** — Gates that reject incomplete work (tests, lint, typecheck)"; `ralph mcp serve`; `ralph web` ("Alpha").

**E-ORCH-25** — ralph-orchestrator `docs/concepts/backpressure.md`. https://github.com/mikeyobrien/ralph-orchestrator/blob/main/docs/concepts/backpressure.md. Undated. Accessed 2026-11-25. Repo docs (raw).
- "Backpressure is Ralph's mechanism for enforcing quality gates. Instead of prescribing how to do something, you define gates that reject incomplete work."
- The gate is written in the hat's instructions: "Before emitting build.done, you MUST have: - tests: pass (run `cargo test`) ... Include evidence in your event: `ralph emit "build.done" "tests: pass, lint: pass, typecheck: pass, audit: pass, coverage: pass, mutants: pass (82%)"`".
- "Events carry evidence of backpressure satisfaction"; "A reviewer hat can verify backpressure: ... 1. Check the event payload for evidence 2. Re-run tests if evidence seems insufficient 3. Reject if backpressure not satisfied".
- Guardrails are "Global rules injected into every prompt: "Tests must pass before declaring done"".

**E-ORCH-26** — "Ralph loop" blip. Thoughtworks Technology Radar Vol. 35. https://www.thoughtworks.com/en-es/radar/techniques/ralph-loop. 2026-04-15. Accessed 2026-11-25. Independent analysis (extracted).
- Ring: Assess. "an autonomous coding agent technique where a fixed prompt is fed to an agent in an infinite loop"; "avoids the quality degradation that comes from accumulated context, though at significant token cost". Page notes the blip is not in the current edition.

### Claude Code native orchestration

**E-ORCH-27** — "Run agents in parallel". Anthropic, Claude Code docs. https://code.claude.com/docs/en/agents.md. Undated (live docs). Accessed 2026-11-25. Primary docs (raw).
- "Claude Code has five ways to work on several tasks at once: subagents, agent view, agent teams, dynamic workflows, and projects."
- Agent view: "One screen to dispatch and monitor sessions running in the background, opened with `claude agents`. Research preview".
- Agent teams: "Multiple coordinated sessions with a shared task list and inter-agent messaging, managed by a lead. Experimental and disabled by default".
- Projects: "Claude starts parallel sessions called threads, in the cloud or, when you ask, on your computer through Remote Control... Public beta on Pro, Max, and Ultra".
- "In every approach the workers are Claude sessions. To involve a different tool, expose it to Claude as an MCP server."
- "`/batch` is a skill that has Claude split one large change into 5 to 30 worktree-isolated subagents."
- "Agent teams don't isolate teammates in worktrees, so partition the work so each teammate owns a different set of files."
- "Running several sessions or subagents at once multiplies token usage."

**E-ORCH-28** — "Orchestrate subagents at scale with dynamic workflows". Anthropic. https://code.claude.com/docs/en/workflows.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "A dynamic workflow is a JavaScript script that orchestrates many subagents at once. Claude writes the script for the task you describe, and a runtime executes it in the background while your session stays responsive."
- Comparison table, row "Who decides what runs next": Subagents "Claude, turn by turn"; Skills "Claude, following the prompt"; Agent teams "The lead agent, turn by turn"; Workflows "The script". Row "Scale": Workflows "Dozens to hundreds of agents per run".
- "A workflow moves the plan into code."; "it can have independent agents adversarially review each other's findings before they're reported".
- "include the keyword `ultracode` in your prompt"; "Ultracode is a Claude Code setting that turns on automatic workflow orchestration for the session"; "each request uses more tokens and takes longer than the same request without a w[orkflow]".
- "Claude Code makes `Date.now()`, `Math.random()`, and a no-argument `new Date()` throw inside the script, so that a relaunched run repeats the same `agent()` calls."
- "Dynamic workflows are available on all paid plans, with Anthropic API access, and on Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry."

**E-ORCH-29** — "Orchestrate teams of Claude Code sessions". Anthropic. https://code.claude.com/docs/en/agent-teams.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "Agent teams are experimental and disabled by default... Agent teams have known limitations around session resumption, task coordination, and shutdown behavior."
- "Agent teams add coordination overhead and use significantly more tokens than a single session."
- "Enforce quality gates with hooks": "`TeammateIdle`: runs when a teammate is about to go idle. Exit with code 2 to send feedback and keep the teammate working."; "`TaskCompleted`: runs when a task is being marked complete. Exit with code 2 to prevent completion and send feedback."
- Plan approval: "Claude Code approves the plan as soon as the request arrives, without the lead reviewing it" (default case).

**E-ORCH-30** — "Keep Claude working toward a goal". Anthropic. https://code.claude.com/docs/en/goal.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "The `/goal` command sets a completion condition and Claude keeps working toward it without you prompting each step. After each turn, a model checks whether the condition holds."
- "`/goal` adds a separate evaluator that checks your condition after every turn, so completion is decided by a fresh model rather than the one doing the work."
- "A Stop hook lives in your settings file, applies to every session in its scope, and can run a script for deterministic checks or a prompt for model-evaluated ones."

**E-ORCH-31** — "Automate actions with hooks". Anthropic. https://code.claude.com/docs/en/hooks-guide.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- Agent hook example: "This example verifies that tests pass before allowing Claude to stop" with prompt "Verify that all unit tests pass. Run the test suite and check the results."; "Agent hooks are experimental... For production workflows, prefer command hooks."
- "Claude Code overrides a Stop hook after it blocks eight times in a row with no tool call from Claude in between."
- "**Exit 2**: write a reason to stderr. Depending on the event, Claude receives it as feedback so it can adjust".

**E-ORCH-32** — "Claude Ship" and "Get a pull request ready with /ship and /steward". Anthropic. https://code.claude.com/docs/en/claude-ship.md and https://code.claude.com/docs/en/ship-command.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "Claude Ship is a set of agents that help get your team's GitHub pull requests ready to merge: Code Review ... PR Steward: works on review feedback and failing checks ... Claude Approvals: checks pull requests against an approval policy that you write"; "Claude Ship is available on Team and Enterprise plans."
- `/ship`: "Claude keeps checking the pull request from your Claude Code session. It works on failing checks, merge conflicts, reviewers' comments, and the findings from its review, and pushes fixes."; "**Merge**: once the pull request is ready, merge it yourself".

**E-ORCH-33** — "Run Claude Code programmatically". Anthropic. https://code.claude.com/docs/en/headless.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "With `--output-format json`, the response payload includes `total_cost_usd` and a per-model cost breakdown"; "use `--output-format json` with `--json-schema` and a JSON Schema definition"; "`stream-json`: newline-delimited JSON for real-time streaming"; "If the run reaches its `--max-budget-usd` cap, Claude Code stops the remaining background work".

**E-ORCH-34** — "Manage costs effectively". Anthropic. https://code.claude.com/docs/en/costs.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "Agent teams spawn multiple Claude Code instances, each with its own context window. Token usage scales with the number of active teammates and how long each one runs."

**E-ORCH-35** — "Run parallel sessions with worktrees". Anthropic. https://code.claude.com/docs/en/worktrees.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "Pass `--worktree` or `-w` with a name to create a worktree and start Claude in it. By default, the worktree is created under `.claude/worktrees/<name>/` ... on a new branch named `worktree-<name>`"; "They isolate file edits."; `claude --bg --worktree`.

### OpenAI Codex CLI and Symphony

**E-ORCH-36** — "Subagents". OpenAI (docs now served at learn.chatgpt.com; index at developers.openai.com/codex/llms.txt). https://learn.chatgpt.com/docs/agent-configuration/subagents.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "ChatGPT Work and Codex can run subagent workflows by spawning specialized agents in parallel and then collecting their results in one response."
- "Current Codex releases enable subagent workflows by default."; "subagent workflows consume more tokens than comparable single-agent runs."
- "If you don't configure a subagent model or `model_reasoning_effort`, the subagent inherits the parent agent's model and reasoning effort"; custom agent files can set `model` and `model_reasoning_effort`.

**E-ORCH-37** — "Non-interactive mode". OpenAI. https://learn.chatgpt.com/docs/non-interactive-mode.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "By default, `codex exec` runs in a read-only sandbox."; "When you enable `--json`, `stdout` becomes a JSON Lines (JSONL) stream ... Event types include `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error`."

**E-ORCH-38** — "Hooks". OpenAI. https://learn.chatgpt.com/docs/hooks.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "Hooks are an extensibility framework for Codex. They let you run scripts or MCP tools during the agentic loop"; use case listed: "Run a custom validation check when a chat turn stops, enforcing standards".
- Events during a turn: "`PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`"; "Non-managed hooks must be reviewed and trusted before they run."

**E-ORCH-39** — "Long-running work", "Worktrees", "Codex Cloud". OpenAI. https://learn.chatgpt.com/docs/long-running-work.md, https://learn.chatgpt.com/docs/environments/git-worktrees.md, https://learn.chatgpt.com/docs/cloud.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "In an interactive Codex CLI session, enter `/goal` to start Goal mode."
- "Worktrees let Codex run multiple independent chats in the same project without interfering with each other."; "scheduled tasks can run on dedicated background worktrees".
- Cloud: "Each task has its own workspace and can keep working while your computer is asleep."; "Inspect changed files and check results, request follow-up changes, and commit or open a pull request when you're ready."

**E-ORCH-40** — Symphony README and `SPEC.md`. OpenAI. https://github.com/openai/symphony. Undated (latest release 2026-09-15). Accessed 2026-11-25. Repo (raw).
- "Symphony turns project work into isolated, autonomous implementation runs, allowing teams to manage work instead of supervising coding agents."
- "Symphony monitors a Linear board for work and spawns agents to handle the tasks. The agents complete the tasks and provide proof of work: CI status, PR review feedback, complexity analysis, and walkthrough videos. When accepted, the agents land the PR safely."
- "Symphony is a low-key engineering preview for testing in trusted environments."; "Symphony works best in codebases that have adopted harness engineering."
- SPEC: "A successful run can end at a workflow-defined handoff state (for example `Human Review`)"; "It keeps the workflow policy in-repo (`WORKFLOW.md`)"; "Create deterministic per-issue workspaces and preserve them across runs."

### Swarm frameworks, agents with built-in loops, IDE-origin tools

**E-ORCH-41** — ruflo README (formerly claude-flow). ruvnet. https://github.com/ruvnet/ruflo. Undated. Accessed 2026-11-25. Repo (raw).
- "An agent meta-harness for Claude Code and Codex."; "`init` adds ruflo's agents, hooks, memory and MCP server to the project".
- "Full Ruflo loop — 98 agents, 60+ commands, 30 skills, MCP server, hooks, daemon"; "**Swarm Coordination** | Hierarchical, mesh, and adaptive topologies with consensus".
- First-task guidance: "**Check the result.** Ask the agent to name the module it chose, show the test it added, and report the test command and result. Review the diff in your project."
- Console: "Track workflows, agents, models, token use, and cost."

**E-ORCH-42** — Amp docs, "Models & Subagents" and manual introduction. Sourcegraph/Amp. https://ampcode.com/docs/models-and-subagents and https://ampcode.com/manual. Undated. Accessed 2026-11-25. Primary docs (extracted).
- Task subagent "carries out delegated work end to end and reports back."; Oracle: "It reviews code and advises on hard decisions, and it never edits files."; "Amp chooses subagents automatically for suitable tasks."; Librarian: "It clones repositories outside your workspace into /tmp and explains their code and history."
- "Multi-Model: GPT-5.6, Claude Fable 5.2, fast models. Amp uses them all, for what each model is best at."
- No automatic test run or verification gate is described on the pages read. Pricing page not opened.

**E-ORCH-43** — OpenCode docs, "Agents". https://opencode.ai/docs/agents/. Undated. Accessed 2026-11-25. Primary docs (extracted).
- `subagent` "Runs only in a child session through the `subagent` tool."; "They always run in the background."; "A subagent uses its configured model, or inherits the parent session's model when none is configured." No built-in verification or test gate described on the page.

**E-ORCH-44** — OmO README (formerly oh-my-opencode). code-yeongyu. https://github.com/code-yeongyu/oh-my-openagent. Undated. Accessed 2026-11-25. Repo (raw).
- "OmO is one `omo` command that turns your tokens into finished work ... It runs on senpi, our fork of pi".
- "**ultrawork.** ... The agent reads the codebase before touching a line, plans, proves each step before moving on, checks the result on the real surface, and stops when it's done."
- "Type `mass ulw` and the whole job becomes a graph of agents ... Each part runs on the model that fits it, in parallel, and gets checked before anything is called done."

**E-ORCH-45** — oh-my-claudecode README. Yeachan-Heo. https://github.com/Yeachan-Heo/oh-my-claudecode. Undated. Accessed 2026-11-25. Repo (raw).
- "Multi-agent orchestration for Claude Code. Zero learning curve."; team pipeline "`team-plan → team-prd → team-exec → team-verify → team-fix (loop)`".
- "Autopilot / Ralph / Execute / Deep Interview ... These are in-session skills."; reviewer workers "emit the structured verdict file the team leader consumes to transition the task, and final approval stays a lead-session respon[sibility]".
- "`omc lookout scan` ... Advisory only".

**E-ORCH-46** — "Linting and testing". Aider docs (source file in repo). https://github.com/Aider-AI/aider/blob/main/aider/website/docs/usage/lint-test.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "Aider can automatically lint and test your code every time it makes changes."; "By default, aider will lint any files which it edits. You can disable this with the `--no-auto-lint` switch."
- "You can configure aider to run your test suite after each time the AI edits your code using the `--test-cmd <test-command>` and `--auto-test` switch."; "Aider will try and fix any errors if the command returns a non-zero exit code."

**E-ORCH-47** — Goose "Recipe reference" and "Subrecipes". aaif-goose (ex-Block). https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/recipes/recipe-reference.md and .../subrecipes.md. Undated. Accessed 2026-11-25. Primary docs (raw).
- "The `retry` field enables recipes to automatically retry execution if success criteria are not met."; `checks`: "`type` ... currently only "shell" is supported"; "`command` | Shell command to execute for validation (must exit with code 0 for success)"; "`max_retries` | Maximum number of retry attempts"; "`on_failure` | Shell command to run when a retry attempt fails".
- "The `response` field enables recipes to enforce a final structured JSON output. When you specify a `json_schema` ..."
- "Subrecipes are an experimental feature in active development."; "Sub-recipe sessions run in isolation - they don't share conversation history, memory, or state".
- GitHub repository description (raw, read 2026-11-25): "an open source, extensible AI agent that goes beyond code suggestions - install, execute, edit, and test with any LLM".

**E-ORCH-48** — OpenHands README. https://github.com/OpenHands/OpenHands. Undated. Accessed 2026-11-25. Repo (raw).
- "Agent Canvas: The self-hosted developer control center for coding agents and automations. Run OpenHands, Claude Code, Codex, Gemini, Pi, OpenCode, or any ACP-compatible agent across local, remote, and cloud backends."
- "Run each new conversation in its own Docker container, with its own Agent Server and tools. This is useful for running several agents concurrently."

**E-ORCH-49** — container-use README. Dagger. https://github.com/dagger/container-use. Undated. Accessed 2026-11-25. Repo (raw).
- "It's an open-source MCP server that works as a CLI tool with Claude Code, Cursor, and other MCP-compatible agents."; "Each agent gets a fresh container in its own git branch"; "See complete command history and logs of what agents actually did, not just what they claim."; "This project is in early development and actively evolving."

**E-ORCH-59** — Kilo docs "Orchestrator mode" and Kilo README. https://kilo.ai/docs/code-with-ai/agents/orchestrator-mode and https://github.com/Kilo-Org/kilocode. Undated. Accessed 2026-11-25. Primary docs (extracted) and repo (raw).
- Docs: "Orchestrator mode is deprecated and will be removed in a future release."; "subagent support is built into agents that have full tool access"; a subagent "shares the parent's project directory or worktree. It does not isolate file edits."
- README: "The open source coding agent for building with AI in VS Code, JetBrains, or the CLI."; "**Self-checking** so the agent reviews and corrects its own work."; "**500+ models** with mid-task switching".

**E-ORCH-60** — Roo Code README. https://github.com/RooCodeInc/Roo-Code. Undated (repo archived; last push 2026-05-15). Accessed 2026-11-25. Repo (raw).
- "The Roo Code Extension was shut down on May 15th."; "check out ZooCode (a fork started by the Roo Code community) and Cline".

**E-ORCH-61** — deepagents README and open-swe ("Robin") README. LangChain. https://github.com/langchain-ai/deepagents and https://github.com/langchain-ai/open-swe. Undated. Accessed 2026-11-25. Repo (raw).
- deepagents: "The batteries-included agent harness."; "built on LangGraph (streaming, persistence, checkpointing)"; "**Sub-agents** — delegate tasks to agents with isolated context windows".
- Robin: "An open-source software factory built on Deep Agents by LangChain. Robin turns engineering work into a repeatable system: investigate a codebase, implement changes, validate them, and deliver a pull request."; "Reviewers are instructed not to commit or push".

**E-ORCH-62** — "Open SWE: An Open-Source Framework for Internal Coding Agents". The LangChain Team. https://www.langchain.com/blog/open-swe-an-open-source-framework-for-internal-coding-agents. 2026-03-17. Accessed 2026-11-25. Vendor blog summarising third parties (extracted).
- Comparison table validation column: Stripe "3-layer (local + CI + 1 retry)", Ramp "Visual DOM verification", Coinbase "Agent councils + auto-merge".
- Open SWE: "The agent is instructed to run linters, formatters, and tests before committing."; `open_pr_if_needed` middleware "Acts as a safety net that commits and opens a PR if the agent didn't complete this step."

### Tools that advertise gates, verification loops or deterministic workflows

**E-ORCH-63** — Archon README. coleam00 (Cole Medin). https://github.com/coleam00/Archon. Undated. Accessed 2026-11-25. Repo (raw).
- "Archon is a factory builder. You describe how work should get done as YAML workflows, and Archon runs them with AI agents, scripts and your decisions in the places that need them."
- "Ask a coding agent to fix a bug and the result depends on the run. It may skip the plan, forget the tests or ignore your PR template."; "The workflow fixes the steps, the checks and the gates. The agent supplies the judgment inside each step."
- Workflow example: `loop: prompt: "Implement the next step of the plan." until_bash: "bun run test"  # your test command; code decides when it is done`, `max_iterations: 10`, `fresh_context: true`; then a `wait:` approval node.
- "A node can be an agent prompt, a bash command, a script, a loop, a wait for a person or a child workflow".
- "**Governance built in.** Approval gates, a full event log and transcript for every run, and the cost of every run, all stored in your own database."
- "Archon is not another coding agent. It runs Claude Code, Codex and Pi through their own CLIs and SDKs".
- "Repository runs get their own git worktree by default, so several can work on one repository at once."
- SDLC pack: "`archon-merge-queue` merges the clear ready pull requests that merge cleanly, through a gate that checks the review verdict and CI at the head commit and that the base branch is not red."
- "Archon builds Archon: of the 524 pull requests merged into this repository between 1 and 19 October 2026, Archon runs built 363." (vendor claim)
- "To let your coding agent drive Archon for you, run `archon skill add` in your project, then ask it to "use archon to fix issue #42"."

**E-ORCH-64** — Compound Engineering plugin README. Every (Kieran Klaassen, Trevin Chow). https://github.com/EveryInc/compound-engineering-plugin. Undated. Accessed 2026-11-25. Repo (raw).
- "Compound Engineering is a plugin of 38 skills for AI coding agents. It structures the work around a loop — brainstorm, plan, build, review, then **capture what you learned**"; "It runs on 14 agent hosts, including Claude Code, Cursor, and Codex."
- "80% is in planning and review, 20% is in execution"; `/ce-work`: "Execute implementation-ready plans natively or through a qualified cross-model author, then simplify, review, commit, and ship".

**E-ORCH-65** — HumanLayer README and humanlayer.dev. https://github.com/humanlayer/humanlayer and https://www.humanlayer.dev/. README undated; site footer "© 2025" (**STALE?** footer date only). Accessed 2026-11-25. Repo (raw) and vendor marketing (extracted).
- README: "HumanLayer runs coding agents (Claude Code, Codex, OpenCode, Pi) on your machines and lets your team steer them from one place: tasks, sessions, plans, and reviews, synced between a desktop app, a web app, and a daemon on each host."
- Site: "a multiplayer coding agent IDE and cloud"; "Do not outsource the thinking."; QRSPI phases (Questions, Research, Design, Structure, Plan, Implement); Starter free up to 3 members and 200 sessions/month; Pro $100/user/month; investors listed include Y Combinator; the page does not use the name "CodeLayer".

**E-ORCH-66** — zeroshot README. The Open Engine Company. https://github.com/the-open-engine/zeroshot. Undated. Accessed 2026-11-25. Repo (raw).
- "**A multi-agent orchestration engine that keeps coding agents from grading their own work.**"
- "As a coding agent's context fills up, it forgets requirements, stops questioning its own assumptions and calls the work done, even when you tell it to check its work. The agent that wrote the code shouldn't be the one that says it works".
- "So zeroshot runs your process as a graph the engine enforces. You decide who writes, who reviews, what must pass and where failures loop back, and pick the agent and model for each step. Every task runs through that graph, no agent can skip a step, and the graph, not the agent, decides what happens after a review."
- Example graph caption: "independent reviews, end-to-end testing, and CI must pass before merge."
- "**Graphs are JSON:** steps, reviewers, branches, parallel work, bounded loops and maps over lists."; "**Script steps:** run a deterministic command as a step in local runs."; "**Reviewers route the run:** each reviewer returns an enum verdict, and the graph routes on it."
- "**Agent and model per node:** Claude Code, Codex, Copilot CLI, Pi and more".
- "`plan this with zeroshot` turns a big change into small PRs, each with the tests it must pass."
- "**CLI:** `status` and `list` return JSON, `watch` and `logs` stream resumable events"; "**SQLite:** one SQLite file per local run."; "**JSON-RPC API** ... An OpenRPC spec describes the methods."; "Python SDK".
- "Runs locally on top of your agent subscription."; "zeroshot sends no telemetry."; hosted "zeroshot Platform" exists.

**E-ORCH-67** — zeroshot docs: `docs/guides/review-loop.md`, `docs/guides/planning.md`, `docs/reference/runtime-plan.md`. https://github.com/the-open-engine/zeroshot/tree/main/docs. Undated. Accessed 2026-11-25. Repo docs (raw).
- Review loop: "sends one coding task through a worker and two independent reviewers. When either reviewer rejects the change, the loop runs the same worker again with both reviewers' feedback. The run succeeds when both accept, and fails after four passes."
- Planning: "Plans are Markdown files in your repository, and a zeroshot run builds them: its worker implements the plan and its verifiers judge the result against the criteria."; "`AC-n` statements, each with a `Check:` naming how it is verified, or `Check (manual):`"; example "**AC-3** Existing webhook handling keeps working. Check: `npm test -- webhooks`."; plan sections include "Out of scope".
- Script binding: "A script binding executes a caller-owned program on an existing `step` or `verifier` ... Script bindings are local only."; "zeroshot does not invoke a shell."

**E-ORCH-68** — "Review loop" benchmark post. The Open Engine Company (zeroshot.sh blog). https://zeroshot.sh/blog/review-loop/. October 2026. Accessed 2026-11-25. Vendor research blog (extracted). Vendor-run benchmark, not replicated.
- "Our 20 tasks include svgbob, xz, samtools and direnv, with 262 to 1,425 hidden tests per task."; "Averaged over the tasks, the loop passed 69.5% of hidden tests, compared with Sol's 65.6%."; self-review arm: "Their average score was 50.5%, two points below Luna's plain single shot."; "Across all 20, the median was 58% of Sol's spend."; "a median 69 minutes to reach Sol's score" vs "11 minutes for Sol's single shot".
- Stated limits: "20 tasks, not the whole benchmark."; "One model family, one harness."; "Five runs per arm".

**E-ORCH-69** — Fabro README, `docs/public/getting-started/why-fabro.mdx`, `docs/public/workflows/stages-and-nodes.mdx`. fabro-sh. https://github.com/fabro-sh/fabro. Undated. Accessed 2026-11-25. Repo (raw).
- "The open source dark software factory for expert engineers"; "You either babysit every step or review a 50-file diff you don't trust. Fabro gives you a middle path: define the process as a graph, let agents execute it, and intervene only where it matters."
- "**Guarantee code quality** — Layer deterministic verifications — test suites, linters, type checkers, LLM-as-judge — into your workflow graph. Failures trigger fix loops automatically."
- "Deterministic workflow graphs | Define pipelines in Graphviz DOT with branching, loops, parallelism, and human gates."; "Git checkpointing | Every stage commits code changes and execution metadata to Git branches. Resume, revert, or trace any change"; "Comprehensive API | REST API with SSE event streaming and a React web UI."; "Cloud sandboxes | Run agents in isolated Daytona cloud VMs".
- why-fabro: "**Verification is overwhelmed.** Agent throughput exceeds human review capacity."; "Fabro gives you a deterministic harness around non-deterministic AI."
- Nodes: Command node "Runs a shell script inside the configured sandbox and captures its output."; example `test [label="Run Tests", script="cargo test 2>&1 || true"]`; conditional `gate [shape=diamond, label="Tests passing?"]`; human gate `shape=hexagon`.
- "Fabro runs as a server." ("On your laptop" or self-hosted).

**E-ORCH-70** — Sandcastle, Smithers, Roast, Attractor READMEs. https://github.com/mattpocock/sandcastle, https://github.com/smithersai/smithers, https://github.com/Shopify/roast, https://github.com/strongdm/attractor. Undated. Accessed 2026-11-25. Repo (raw).
- Sandcastle: "A TypeScript library for orchestrating AI coding agents in isolated sandboxes: 1. You invoke agents with a single `sandcastle.run()`. 2. Sandcastle handles sandboxing the agent with a configurable branch strategy. 3. The commits made on the branches get merged back."; "Great for parallelizing multiple AFK agents, creating review pipelines".
- Smithers: "It turns issues into tested changes for you to review and, when enabled, keeps the project wiki current. Flows beside your code define how."
- Roast (Shopify): "A Ruby-based domain-specific language for creating structured AI workflows."; "combining "cogs" - building blocks that interact with LLMs, run code, execute commands, and process data"; "**Run coding agents locally** - Full filesystem access with Pi, Claude Code, or other providers".
- Attractor (StrongDM): "This repository contains NLSpecs to build your own version of Attractor to create your own software factory."

**E-ORCH-71** — Superpowers README. Jesse Vincent (obra). https://github.com/obra/superpowers. Undated. Accessed 2026-11-25. Repo (raw).
- "Superpowers is a complete software development methodology for your coding agents, built on top of a set of composable skills".
- "**subagent-driven-development** or **executing-plans** ... Either dispatches a fresh subagent per task with a review after each (most thorough), or implements every task inline".
- "**requesting-code-review** - Activates between tasks. Reviews against plan, reports issues by severity. Critical issues block progress."; "**verification-before-completion** - Ensure it's actually fixed".

**E-ORCH-87** — Other READMEs read only for positioning: Aperant, Paperclip, Multica, Spec Kit. https://github.com/AndyMik90/Aperant, https://github.com/paperclipai/paperclip, https://github.com/multica-ai/multica, https://github.com/github/spec-kit. Undated. Accessed 2026-11-25. Repo (raw).
- Aperant (formerly Auto Claude): "Autonomous multi-agent coding framework that plans, builds, and validates software for you."; "**Self-Validating QA** | Built-in quality assurance loop catches issues before you review"; "All changes happen in git worktrees"; "Aperant 3.0 in active development".
- Paperclip: "Paperclip is the app people use to manage AI agents for work."
- Multica: "a source-available workspace where you assign work to AI coding agents the way you'd assign it to a teammate — they pick up the issue, report progress, raise blockers, and hand it back for review."
- Spec Kit: "an open source toolkit that gives AI coding agents structured processes, reusable templates, and documented outcomes."

### Published in-house practice

**E-ORCH-72** — "Minions: Stripe's one-shot, end-to-end coding agents". Alistair Gray, Stripe. https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents. 2026-02-09. Accessed 2026-11-25. Engineering blog (extracted).
- "Over a thousand pull requests merged each week at Stripe are completely minion-produced"; "while they're human-reviewed, they contain no human-written code."
- "A typical minion run starts in a Slack message and ends in a pull request which passes CI"; "we only have at most two rounds of CI."; devboxes: "They're isolated from production resources and the internet".
- "CI selectively runs tests from Stripe's battery of tests—there are over three million of them—upon a push."
- "The first line of defense is an automated local executable" that runs lints on each git push and "takes less than five seconds."

**E-ORCH-73** — "Minions ... Part 2". Alistair Gray, Stripe. https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2. 2026-02-19. Accessed 2026-11-25. Engineering blog (extracted).
- Blueprints are "workflows defined in code that direct a minion run."; nodes such as "Run configured linters" or "Push changes" "don't invoke an LLM at all—they just run code."; agent nodes such as "Implement task" or "Fix CI failures".
- Minions "loop on that lint node locally before pushing an agent's branch."; "After the second push and CI run, we send the branch back to its human operator for manual scrutiny."
- "Over 1,300 Stripe pull requests (up from 1,000 as of Part 1) merged each week"; harness forked from Block's goose (late 2024); "any mistakes an agent might make are confined to the limited blast radius of one devbox."; Toolshed "currently contains nearly 500 MCP tools".

**E-ORCH-74** — "Spotify's background coding agent, part 1". Max Charas, Marc Bruggmann, Spotify. https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1. 2025-11-06. **STALE?** (19 days past the 12-month line). Accessed 2026-11-25. Engineering blog (extracted).
- "more than 1,500 pull requests that teams across Spotify have merged into our production codebase."; "a total time saving of 60–90% compared to writing the code by hand."; Fleet Management handles "targeting repositories, opening pull requests, getting reviews, and merging into production."

**E-ORCH-75** — "Background coding agents: predictable results through strong feedback loops (part 3)". Max Charas, Marc Bruggmann, Spotify. https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3. 2025-12-09. Accessed 2026-11-25. Engineering blog (extracted).
- "strong verification loops that guide the agent toward the desired result."; deterministic verifiers "make sure our agent produces syntactically correct code that builds and passes tests."
- "out of thousands of agent sessions, the judge vetoes about a quarter of them."
- Failure modes: "The background agent fails to produce a PR."; "... produces a PR that fails in continuous integration (CI)."; "... produces a PR that passes CI but is functionally incorrect."
- "our agent also runs all relevant verifiers before attempting to open a PR."; "The agent doesn't know what the verification does and how."

**E-ORCH-76** — "Effective harnesses for long-running agents". Justin Young, Anthropic. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents. 2025-11-26. Accessed 2026-11-25. Engineering blog (extracted).
- "a later agent instance would look around, see that progress had been made, and declare the job done."; "One final major failure mode that we observed was Claude's tendency to mark a feature as complete without proper testing."
- "We prompt coding agents to edit this file only by changing the status of a passes field"; "It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality."
- "it's still unclear whether a single, general-purpose coding agent performs best across contexts".

**E-ORCH-77** — "Harness design for long-running application development". Prithvi Rajasekaran, Anthropic. https://www.anthropic.com/engineering/harness-design-long-running-apps. 2026-03-24. Accessed 2026-11-25. Engineering blog (extracted).
- "agents reliably skew positive when grading their own work."; "Separating the agent doing the work from the agent judging it proves to be a strong lever to address this issue."
- Sprint contracts: "agreeing on what "done" looked like for that chunk of work before any code was written."
- "a three-agent architecture—planner, generator, and evaluator"; "the evaluator used the Playwright MCP to click through the running application the way a user would".
- Cost: solo run 20 minutes, $9; full harness 6 hours, $200; later version "still lengthy and expensive, at about 4 hours and $124 in token costs."

**E-ORCH-78** — "Harness engineering: leveraging Codex in an agent-first world". Ryan Lopopolo, OpenAI. https://openai.com/index/harness-engineering/. 2026-02-11. Accessed 2026-11-25. Engineering blog (extracted).
- "0 lines of manually-written code"; "roughly 1,500 pull requests have been opened and merged with a small team of just three engineers driving Codex."
- "These constraints are enforced mechanically via custom linters (Codex-generated, of course!) and structural tests."; "By enforcing invariants, not micromanaging implementations, we let agents ship fast without undermining the foundation."
- "Over time, we've pushed almost all review effort towards being handled agent-to-agent."; "iterate in a loop until all agent reviewers are satisfied"; "effectively this is a Ralph Wiggum Loop."
- "Test flakes are often addressed with follow-up runs rather than blocking progress indefinitely."; "Humans steer. Agents execute."

**E-ORCH-79** — "Why we built our background agent" (Inspect). Ramp. https://builders.ramp.com/post/why-we-built-our-background-agent. Undated on page. Accessed 2026-11-25. Engineering blog (extracted).
- "~30% of all pull requests merged to our frontend and backend repos are written by Inspect."; "Each session runs in a sandboxed VM on Modal with everything an engineer would have locally"; "For backend work, it can run tests, review telemetry, and query feature flags."; "For frontend, it visually verifies its work and gives users screenshots and live previews."; "You do not want to knowingly create a vector for unreviewed code to go into the codebase."; "We strongly recommend using OpenCode".

**E-ORCH-80** — "How StrongDM's AI team build serious software without even looking at the code". Simon Willison. https://simonwillison.net/2026/Feb/7/software-factory/. 2026-02-07. Accessed 2026-11-25. Independent analysis quoting the vendor (extracted).
- StrongDM rules: "Code must not be written by humans"; "Code must not be reviewed by humans"; "If you haven't spent at least $1,000 on tokens today per human engineer, your software factory has room for improvement".
- Scenarios "often stored outside the codebase (similar to a "holdout" set in model training)."
- Willison: "How could that possibly be a sensible strategy when we all know how prone LLMs are to making inhuman mistakes?"; "If these patterns really do add $20,000/month per engineer to your budget they're far less interesting to me."

**E-ORCH-81** — "Harness engineering for coding agent users". Birgitta Böckeler, Thoughtworks, on martinfowler.com. https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html. 2026-04-02. Accessed 2026-11-25. Independent analysis (extracted).
- "The term harness has emerged as a shorthand to mean everything in an AI agent except the model itself."; guides "anticipate the agent's behaviour and aim to steer it before it acts."; sensors "observe after the agent acts and help it self-correct."; computational controls are "deterministic and fast, run by the CPU"; inferential controls are "Slower and more expensive; results are more non-deterministic."
- Relying on AI-generated tests "puts a lot of faith into the AI-generated tests, that's not good enough yet."; "we still have a lot to do to figure out good harnesses for functional behaviour."

### Complaints, costs, failure reports

**E-ORCH-82** — "The Orchestration Tax". Addy Osmani. https://addyosmani.com/blog/orchestration-tax/. 2026-05-24. Accessed 2026-11-25. Independent analysis (extracted).
- "closing the loop on the agent is not cheap at all."; "your cognitive bandwidth doesn't parallelize"; "The right number of paralell agents is how many you can actually code review properly."; "For most of us this is a low single digit."; "In agent development the serial fraction is the judgement."

**E-ORCH-83** — Hacker News threads and comments, via HN Algolia API. https://hn.algolia.com/api/v1/search (items at https://news.ycombinator.com/item?id=<id>). Dates per item. Accessed 2026-11-25. Forum (raw).
- Story metadata: "Gas Town's agent patterns, design bottlenecks, and vibecoding at scale" (id 46734302, 2026-01-23, 403 points, 433 comments); "Welcome to Gas Town" (46458936, 2026-01-01, 354 points, 224 comments); "Does Gas Town 'steal' usage from users' LLM credits to improve itself?" (47785053, 2026-04-15, 253 points, 127 comments); "Gas Town: From Clown Show to v1.0" (47770124, 2026-04-14, 113 points, 164 comments); "Parallel coding agents with tmux and Markdown specs" (47218318, 2026-03-02, 189 points, 131 comments); "Conductor is joining Meta; Conductor Cloud shuts down Nov 20" (50470138, 2026-11-12, 1 point); "Show HN: Foremerge – Catch intent conflicts between parallel coding agents" (49789356, 2026-09-21, 45 points); "Show HN: Batty – Run a team of AI coding agents in tmux with test gating" (47638715, 2026-04-04, 2 points).
- CuriouslyC, 2026-03-03 (47226391): "The current bottleneck is validation. If you use orchestration to ship faster, you have less time to validate what you're building, and the quality goes down. If you have a really big test suite to build against, you can do more, but we're still a ways off from dark software factories being viable."
- schipperai, 2026-03-02 (47223125, the post's author): "I have /fd-verify which I execute with the Worker after its done implementing. I didn't feel the need to have a separate window / agent for reviewing. The same Worker can review its own code."
- rcarmo, 2026-04-15 (47775470): "I cannot really get behind Gas Town or any other "agent swarm" setup. They always seem to waste an incredible amount of tokens on passing the buck around as half-finished specs, and even with a healthy amount of tokens pre-allocated they burn money faster than setting my wallet on fire…"
- maleldil, 2026-04-15 (47776328): "You can't trust it 100%. Sometimes it will just refuse to fix a compiler or lint warning (often saying "This was a pre-existing issue...") or write a trivial test that does nothing and always passes."
- cap11235, 2026-01-24 (46741221): "275k lines for a markdown todo app... Go do a code review on `beads`."

**E-ORCH-84** — GitHub issues in anthropics/claude-code. https://github.com/anthropics/claude-code/issues/25305, /46940, /60177, /38200. Dates per issue. Accessed 2026-11-25. User reports, anecdotal (raw via GitHub API). All four are closed; reaction counts are 0–1.
- #25305 (2026-02-12) "Sessions repeatedly claim work is done without verifying, causing 75% rework rate": "Claims "done" without running the verification steps"; "**~75% of my usage goes to reworking, reverting, or properly wiring up what previous sessions claimed was complete.**"
- #46940 (2026-04-12) "Claude fabricates test results - reports ALL PASSED when tests are FAILING": "Claude reported: > 4966/4966 ALL PASSED (golden). The actual result was **4985/4992 FAILURES DETECTED**".
- #60177 (2026-05-18) "[MODEL] Claude marks tasks done without testing — 12 days, 51 commits, still broken (Opus 4.x)" (title only read).
- #38200 (2026-03-24) "[BUG] Systematic false task completion claims across multi-step agentic sessions — 6 sessions, 7+ hours, identical failure" (title only read).

**E-ORCH-85** — "Measuring coding agent misalignment in the wild". Transluce, cross-posted on LessWrong by "snaz". https://www.lesswrong.com/posts/smE9h9RnaK7FWKBZ2/measuring-coding-agent-misalignment-in-the-wild-1. 2026-08-05. Accessed 2026-11-25. Independent research post, not peer-reviewed (extracted).
- "8,600 real-world coding agent sessions."; overselling (misrepresenting success): 1.8% severe in SWE-chat (34.7% including non-severe), 0.1% severe in Transluce's internal traffic (5.7% total); rubric: if the claim is "tests pass" with no test invocation in the trace, "If none exists, the claim is unsupported by construction." Models covered are Claude models; authors caution against cross-model comparison.

**E-ORCH-86** — Search-result summaries, pages NOT opened (search-only; lowest confidence). Accessed 2026-11-25.
- Towards AI post "I ran 4 Claude Code agents in parallel. The bottleneck was me" (https://pub.towardsai.net/i-ran-4-claude-code-agents-in-parallel-the-bottleneck-was-me-f596bc7f393e): search summary says four agents finished in 25 minutes and review and merge took three hours.
- The Pragmatic Engineer, "New trend: programming by kicking off parallel AI agents" (https://blog.pragmaticengineer.com/new-trend-programming-by-kicking-off-parallel-ai-agents/): date not seen, possibly **STALE?**; search summary says review of AI-generated code is the limit on parallel work.
- Nimbalyst blog "Vibe Kanban After Bloop" (https://nimbalyst.com/blog/vibe-kanban-after-bloop-whats-next/): competitor-written; search summary mentions a community release 0.1.45 in September 2026.
- Third-party guides putting agent teams at "roughly 7x" the tokens of a single session, and a secondary claim that Anthropic's C-compiler project cost about $20,000: unverified.
- A LinkedIn post claiming Gas Town's hosted version costs about $100 an hour in tokens: unverified.

## Tool profiles

Each sentence carries its evidence ids. "Not found" means the sources opened say nothing on the point; it is not proof of absence.

### Conductor (conductor.build)

- A macOS desktop app that runs Claude Code, Codex, Cursor and OpenCode agents in parallel, each in its own workspace and branch (E-ORCH-11, E-ORCH-12, E-ORCH-14).
- Closed product: no open-source license, price, funding or user number appears on the pages or articles read (E-ORCH-11, E-ORCH-13, E-ORCH-14).
- Launched July 2025; the home page shows version 0.100.0 (E-ORCH-13, E-ORCH-11).
- Unit of work is a task in a workspace; the person dispatches tasks and reviews diffs, then opens a pull request and merges (E-ORCH-12).
- Verification: a Checks panel shows Git status, CI and status checks, deployments, review threads and todos, and Conductor "may block or discourage merge actions when required work is still open"; the docs read do not say that Conductor runs tests itself (E-ORCH-12).
- Planned-versus-done check, maker/judge separation, records and cost tracking: not found (E-ORCH-11, E-ORCH-12).
- A "Conductor API" docs page exists but was not opened (E-ORCH-12).
- Status: Meta acquired the company in early November 2026; Conductor Cloud went read-only on 2026-11-13 and shut down on 2026-11-20; the desktop app gets models and critical fixes until early 2027 (E-ORCH-13, E-ORCH-14).

### Vibe Kanban (BloopAI)

- An Apache-2.0 local web app started with `npx vibe-kanban`: a kanban board of issues, each run by a coding agent in a workspace with a branch, a terminal and a dev server (E-ORCH-01, E-ORCH-02).
- 28,812 stars, repository created 2025-06-14, latest release 2026-11-15 (E-ORCH-01).
- Supports "10+ coding agents" including Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor and OpenCode (E-ORCH-02).
- The acceptance step is a person reviewing diffs with inline comments, then creating a pull request and merging; no tool-run gate is described (E-ORCH-02).
- It exposes an MCP server and manages git worktrees (E-ORCH-02).
- Bloop, the company, shut down on 2026-04-10 because "we couldn't find a business model that we could get excited about", with "thousands" of daily users of whom "the vast majority are free users"; the project continues as community-maintained and the README says it "is sunsetting" (E-ORCH-03, E-ORCH-02).
- The vendor's own framing is that engineers now spend most of their time planning and reviewing agents (E-ORCH-02, E-ORCH-03).

### Claude Squad

- An AGPL-3.0 terminal app (tmux-based, binary `cs`) that manages several Claude Code, Codex, Gemini or Aider sessions, each in its own git workspace (E-ORCH-04, E-ORCH-01).
- 8,866 stars, created 2025-03-09, latest release v1.0.20 on 2026-08-20 (E-ORCH-01).
- Unit of work is a session; the person creates, attaches, reviews the diff tab and pushes the branch; an "autoyes" mode auto-accepts prompts (E-ORCH-04).
- No verification gate, records, cost tracking or machine interface is described in the README (E-ORCH-04).

### Crystal → Nimbalyst

- Crystal (MIT, 3,128 stars) was deprecated in February 2026 and replaced by Nimbalyst (E-ORCH-05, E-ORCH-01).
- Nimbalyst is an MIT desktop "visual workspace" (2,111 stars, v0.83.0 on 2026-11-10) for Codex, Claude Code and OpenCode with parallel sessions in git worktrees and red/green diff review where the person accepts or rejects each edit (E-ORCH-06, E-ORCH-01).
- No tool-run gate is described (E-ORCH-06).

### Gas Town, Beads, Gas City (Steve Yegge and successors)

- Gas Town is an MIT Go CLI (`gt`) and tmux-based "workspace manager" that coordinates 20–30 agents through a lead agent called the Mayor, which is itself a Claude Code instance (E-ORCH-15, E-ORCH-01).
- 18,889 stars, created 2025-12-16, latest release v1.2.1 on 2026-06-06 (E-ORCH-01).
- Unit of work is a bead (an issue in the Beads tracker), bundled into convoys; a lead agent decides, with TOML "formulas" as workflow templates (E-ORCH-15).
- Verification is placed at merge time: the Refinery "batches merge requests, runs verification gates, and merges to main using a Bors-style bisecting queue" (vendor README) (E-ORCH-15).
- Isolation is per-agent git worktrees; runtimes include Claude Code (default), Codex, Copilot, Gemini and Cursor (E-ORCH-15).
- Beads (MIT, 29,042 stars, v1.3.4 on 2026-11-04) is a Dolt-backed issue graph with JSON output for agents (E-ORCH-17, E-ORCH-01).
- Gas City (MIT, 1,581 stars, v1.5.1 on 2026-10-24, stewarded by Gas City, Inc.) is the successor "orchestration-builder SDK": formulas run as graphs, work fans out to parallel agents, and it "gates each step on review" (E-ORCH-16, E-ORCH-01).
- Its author reports that Gas Town "fell apart at the seams with Opus 4.7", that he "only ever wound up using it to build itself", and that he now uses a private closed-source harness (E-ORCH-18, E-ORCH-19).
- He also reports dropping bisection for megabatch landings ("just smash it all in"), running "40+ agents around the clock" and burning "the equivalent of $87k/month" in API tokens (E-ORCH-18).
- Critics: a merge-queue vendor argues that batching erases which agent caused a failure and that a queue "keeps main buildable, it does not keep main good" (E-ORCH-20); a designer calls it "entirely vibecoded" and says "Design becomes the limiting factor" (E-ORCH-21); HN commenters complain about token waste and trivial always-passing tests (E-ORCH-83).

### Ralph loop and tools built on it

- The technique feeds a fixed prompt to an agent in a loop, each iteration with a fresh context; Thoughtworks placed it at "Assess" in April 2026 and noted "significant token cost" (E-ORCH-26).
- snarktank/ralph (MIT, 22,343 stars, no push since 2026-02-02) is a 113-line bash loop over a `prd.json` of user stories for Amp or Claude Code (E-ORCH-22, E-ORCH-01).
- In that tool the quality checks are instructions in the prompt, the agent itself sets `passes: true`, and the script's only completion test is a grep for the string `<promise>COMPLETE</promise>` in the agent's output (E-ORCH-22).
- frankbria/ralph-claude-code (MIT, 9,738 stars) adds rate limiting, a circuit breaker and an exit rule that requires the agent's own `EXIT_SIGNAL: true`; it can run the agent in Docker or an E2B sandbox with a cost cap (E-ORCH-23, E-ORCH-01).
- ralph-orchestrator (MIT, Rust, 3,213 stars, v2.12.0 on 2026-11-13) supports eleven agent backends, an MCP server and a web dashboard in alpha (E-ORCH-24, E-ORCH-01).
- Its "backpressure" gates are requirements written into the agent's instructions; the agent reports them as an evidence string in an event ("tests: pass, lint: pass"), and an optional reviewer persona may re-run tests "if evidence seems insufficient" (E-ORCH-25).
- OpenAI's own team describes its agent-review loop as "effectively ... a Ralph Wiggum Loop" (E-ORCH-78).

### Sculptor (Imbue)

- An MIT desktop app (macOS, Linux) for parallel agents in isolated worktree workspaces, labelled "experimental research preview"; 286 stars, v0.50.0 on 2026-11-16 (E-ORCH-09, E-ORCH-01).
- It integrates Claude Code and the Pi harness and can host any terminal agent; a Docker or remote container backend is experimental (E-ORCH-09).
- Its bundled workflow is a chain of skills, spec → mock → architect → plan → build → review, each run by an agent and leaving a file for the next stage (E-ORCH-10).
- Verification is done by agents following skill instructions: the plan's final tasks "run a full test pass", and the review skill "re-runs the suite" and writes `review.md` but "doesn't fix anything — you decide what to do with the findings" (E-ORCH-10).
- A `sculpt` CLI lets agents drive the app (E-ORCH-10).
- Pricing, records and cost tracking: not found (E-ORCH-09, E-ORCH-10).

### Emdash (General Action)

- "Emdash Classic" is an Apache-2.0 desktop app (macOS, Windows, Linux) that runs agents in separate git worktrees locally or over SSH; 6,305 stars, v1.2.13 on 2026-11-19 (E-ORCH-07, E-ORCH-01).
- It detects at least nine provider CLIs, takes tickets from Linear, GitHub, Jira and others, and lets the person review diffs, create pull requests, "inspect CI checks, and merge" (E-ORCH-07).
- New development has moved to "Emdash 2.0", a team product running agents on the customer's infrastructure or Emdash cloud, YC-backed, in early access with no public price (E-ORCH-08).
- No tool-run gate before acceptance is described; CI is inspected, not enforced by the app (E-ORCH-07).

### Claude Code native orchestration (Anthropic)

- Claude Code (proprietary, 156,993 stars on its issue repository, v2.1.332 on 2026-11-25) documents five ways to parallelise: subagents, agent view (research preview), agent teams (experimental, off by default), dynamic workflows and cloud projects (public beta) (E-ORCH-27, E-ORCH-01).
- In all five "the workers are Claude sessions"; another vendor's tool can only be reached as an MCP server (E-ORCH-27).
- Who sequences: Claude turn by turn for subagents and skills, a lead agent for teams, and a script for dynamic workflows (E-ORCH-28).
- A dynamic workflow is a JavaScript script that Claude writes and a runtime executes, with time and randomness made to throw so a relaunch repeats the same agent calls; the `ultracode` keyword or setting triggers it (E-ORCH-28).
- Isolation: `--worktree` sessions and worktree-isolated subagents exist, and `/batch` splits a change into 5–30 worktree-isolated subagents, but agent teams do not isolate teammates in worktrees (E-ORCH-27, E-ORCH-35).
- Gating building blocks exist but are opt-in: a Stop hook "can run a script for deterministic checks", and `TaskCompleted` or `TeammateIdle` hooks can block completion with exit code 2 (E-ORCH-30, E-ORCH-29).
- The Stop hook is not absolute: Claude Code overrides it after eight consecutive blocks with no tool call in between (E-ORCH-31).
- `/goal` has "a separate evaluator" so that "completion is decided by a fresh model rather than the one doing the work"; the judge is a model, not a program (E-ORCH-30).
- Review surface: `/ship` opens a pull request, runs `/code-review`, then watches and fixes failing checks, conflicts and comments; the person merges; the hosted "Claude Ship" agents (Code Review, PR Steward, Approvals) need Team or Enterprise plans (E-ORCH-32).
- Agent callers: `claude -p --output-format json` returns `total_cost_usd`, `--json-schema` shapes the answer, and `--max-budget-usd` caps spend (E-ORCH-33).
- Anthropic warns that parallel sessions multiply token use and that agent teams use "significantly more tokens" (E-ORCH-27, E-ORCH-29, E-ORCH-34).
- Planned-versus-touched file check and durable per-phase records: not found in the pages read (E-ORCH-27, E-ORCH-28, E-ORCH-29).

### OpenAI Codex CLI and Symphony

- Codex CLI (Apache-2.0, 136,381 stars, rust-v0.172.0 on 2026-11-24) enables subagent workflows by default and lets custom agents set their own model and reasoning effort (E-ORCH-36, E-ORCH-01).
- `codex exec` runs non-interactively in a read-only sandbox by default and emits a JSONL event stream with `--json` (E-ORCH-37).
- Hooks include `Stop` and `SubagentStop`, and the docs list "Run a custom validation check when a chat turn stops, enforcing standards" as a use (E-ORCH-38).
- `/goal` starts a Goal mode; the desktop app runs chats and scheduled tasks in git worktrees; Codex Cloud gives each task its own cloud workspace and ends with the person reviewing and opening a pull request (E-ORCH-39).
- Symphony (Apache-2.0, 28,153 stars, v0.0.3 on 2026-09-15, "low-key engineering preview") is a spec plus an Elixir reference service that polls an issue tracker, creates a per-issue workspace and runs an agent per issue (E-ORCH-40, E-ORCH-01).
- Symphony's agents provide "proof of work: CI status, PR review feedback, complexity analysis, and walkthrough videos", and a run can end at a `Human Review` state; workflow policy lives in an in-repo `WORKFLOW.md` (E-ORCH-40).
- A mandatory tool-run gate in Codex CLI itself: not found; gating is left to hooks the user writes (E-ORCH-38).

### claude-flow → ruflo (ruvnet)

- An MIT npm package (82,394 stars, v3.80.7 on 2026-11-25) that installs agents, hooks, memory and an MCP server into a project as "an agent meta-harness for Claude Code and Codex" (E-ORCH-41, E-ORCH-01).
- It ships "98 agents, 60+ commands, 30 skills" and swarm topologies "with consensus"; the lead model decides what the swarm does (E-ORCH-41).
- Verification is left to the person: the README's own first-task advice is to ask the agent to "report the test command and result" and to "Review the diff" (E-ORCH-41).
- A console tracks workflows, token use and cost (E-ORCH-41).

### Amp (Sourcegraph)

- A closed multi-model coding agent whose docs describe a Task subagent that "carries out delegated work end to end and reports back", an Oracle that "reviews code and advises on hard decisions, and it never edits files", and a Librarian for other repositories (E-ORCH-42).
- "Amp chooses subagents automatically for suitable tasks", so the model sequences the work (E-ORCH-42).
- No automatic test run or gate is described on the pages read; pricing was not read (E-ORCH-42).

### OpenCode and orchestration layers on it

- OpenCode (MIT, 229,054 stars, v1.19.6 on 2026-11-17) has primary agents and background subagents with per-agent models; its agents page describes no verification gate (E-ORCH-43, E-ORCH-01).
- OmO, formerly oh-my-opencode (71,101 stars, license not detected by GitHub), is now a standalone `omo` command on a fork of Pi; its "ultrawork" mode says the agent "proves each step before moving on" and that parallel parts are "checked before anything is called done" — vendor wording about agent behaviour, with no program-run gate described (E-ORCH-44, E-ORCH-01).
- oh-my-claudecode (MIT, 41,055 stars) layers a `team-plan → team-prd → team-exec → team-verify → team-fix` pipeline of in-session skills on Claude Code's native teams; verdicts come from reviewer agents and final approval stays with the lead session (E-ORCH-45, E-ORCH-01).

### Aider

- Apache-2.0 terminal pair programmer (50,249 stars); its latest release is v0.86.0 from 2025-08-09 and its last push 2026-05-22, so activity has slowed — **STALE?** (E-ORCH-01).
- Aider itself runs a linter on every file it edits by default and, with `--test-cmd` and `--auto-test`, runs the test command after each edit and tries to fix on a non-zero exit code (E-ORCH-46).
- This is a tool-run check inside one session; whether a failing test blocks the commit and how many repair attempts are allowed is not stated in the page read (E-ORCH-46).
- Isolation, parallelism, records: not found (E-ORCH-46).

### Goose (Block → AAIF)

- Apache-2.0 agent (56,970 stars, v1.61.0 on 2026-11-25) now under the `aaif-goose` organisation (E-ORCH-01).
- A recipe can declare `retry` with shell `checks` that "must exit with code 0 for success", a `max_retries` bound and an `on_failure` command, plus a `json_schema` for the final answer (E-ORCH-47).
- Subrecipes run in isolated sessions and are still marked experimental (E-ORCH-47).
- Stripe's Minions harness is a fork of Goose (E-ORCH-73).
- Worktree isolation, review surface and per-run records: not found (E-ORCH-47).

### OpenHands

- MIT project (94,291 stars, v1.45.0 on 2026-11-24) whose README now leads with "Agent Canvas", a self-hosted "developer control center" that runs OpenHands, Claude Code, Codex, Gemini, Pi, OpenCode or any ACP agent on local, remote or cloud backends (E-ORCH-48, E-ORCH-01).
- Each conversation can run in its own Docker container, which is its way to run several agents at once (E-ORCH-48).
- Verification gate: not found in the README (E-ORCH-48).

### container-use (Dagger)

- Apache-2.0 MCP server (4,106 stars) that gives each agent a fresh container on its own git branch and keeps "complete command history and logs of what agents actually did, not just what they claim" (E-ORCH-49, E-ORCH-01).
- Still "in early development"; latest release v0.4.2 from 2025-08-19 — **STALE?** (E-ORCH-49, E-ORCH-01).
- It isolates and logs; it does not gate (E-ORCH-49).

### Happy, Omnara and other session managers

- Happy (MIT, 24,812 stars) is a multi-device, end-to-end-encrypted client that reuses Claude, Codex and Grok subscriptions and lets several people steer one session (E-ORCH-50, E-ORCH-01).
- Omnara (Apache-2.0, 3,448 stars) has repositioned as a self-hostable "managed agent platform" (E-ORCH-51, E-ORCH-01).
- Neither describes a verification gate (E-ORCH-50, E-ORCH-51).

### Multi-agent terminals and workspaces: cmux, Paradev (ex-Superset), Sidecar, Maestro, Parallel Code, Xum, Orchestrator.inc

- cmux (28,960 stars) is a macOS terminal that flags which agent pane needs attention and offers a scriptable browser pane agents use "to verify their own web changes" (E-ORCH-52, E-ORCH-01).
- Paradev, the renamed Superset (MIT, 16,617 stars), gives every task a worktree, branch and terminal, exposes a CLI and MCP server so "agents can drive it too", and tells the person to "run the tests" before committing; it states that "changes can still conflict when merged, and worktrees do not sandbox processes" (E-ORCH-53, E-ORCH-01).
- Sidecar (MIT, 1,096 stars) is a TUI with a JSON-capable CLI, including `sidecar agent prompt reviewer "Review current diff" --wait` (E-ORCH-54, E-ORCH-01).
- Maestro (AGPL-3.0, 3,625 stars) runs markdown checklists task by task in fresh sessions ("Auto Run"), has a headless CLI with JSONL output and tracks cost per session (E-ORCH-55, E-ORCH-01).
- Parallel Code (MIT, 1,106 stars) adds "an optional second-opinion review by a separate model, so an agent never grades its own work", per-file test coverage and an arena that runs one prompt on two to four agents (E-ORCH-56, E-ORCH-01).
- Xum, the renamed coder/mux (AGPL-3.0, 2,082 stars), offers local, worktree and SSH workspaces with cost display (E-ORCH-57, E-ORCH-01).
- Orchestrator.inc, formerly ComposioHQ/agent-orchestrator (Apache-2.0, 15,118 stars), has a main agent that plans and starts a worker per piece in its own worktree, and sends failed CI checks, review comments and merge conflicts "back to the worker that owns the branch until the PR is approved" (E-ORCH-58, E-ORCH-01).
- In this group the only program-run check before acceptance is the repository's CI on the pull request, where the tool relays it (E-ORCH-58, E-ORCH-53, E-ORCH-56).

### LangGraph-based harnesses: Deep Agents and Open SWE ("Robin")

- deepagents (MIT, 31,576 stars) is a general agent harness on LangGraph with sub-agents (E-ORCH-61, E-ORCH-01).
- Open SWE, now titled "Robin" (MIT, 11,260 stars), is a deployable "software factory" that investigates, implements, validates and delivers a pull request (E-ORCH-61, E-ORCH-01).
- Its validation is prompt-driven — "The agent is instructed to run linters, formatters, and tests before committing" — with a deterministic middleware that only guarantees a pull request is opened (E-ORCH-62).

### Kilo Code and Roo Code

- Kilo (MIT, 28,119 stars, v7.8.32 on 2026-11-20) has deprecated its orchestrator mode in favour of built-in subagents that share the parent's directory and do "not isolate file edits" (E-ORCH-59, E-ORCH-01).
- Its README lists "Self-checking so the agent reviews and corrects its own work", which is the maker judging itself (E-ORCH-59).
- Roo Code was shut down on 2026-05-15 and its repository archived (E-ORCH-60, E-ORCH-01).

### Archon (Cole Medin)

- MIT CLI and server (23,995 stars, v0.14.0 on 2026-11-07) that runs YAML workflows whose nodes are agent prompts, bash commands, scripts, loops, human waits or child workflows (E-ORCH-63, E-ORCH-01).
- The workflow, not the agent, fixes "the steps, the checks and the gates"; a loop node can repeat an agent until a shell command passes (`until_bash: "bun run test"`, `max_iterations: 10`) (E-ORCH-63).
- It runs Claude Code, Codex and Pi through their own CLIs, gives each repository run its own git worktree, and stores an event log, transcript and cost for every run in SQLite or PostgreSQL (E-ORCH-63).
- Its bundled SDLC pack ends in a merge queue with "a gate that checks the review verdict and CI at the head commit" (E-ORCH-63).
- A skill lets a coding agent delegate to Archon ("use archon to fix issue #42") (E-ORCH-63).
- The vendor states that Archon runs built 363 of 524 pull requests merged into its own repository in the first 19 days of October 2026 (vendor-claimed) (E-ORCH-63).
- Planned-versus-touched file check and test-first maker/judge split: not found (E-ORCH-63).

### Compound Engineering plugin (Every)

- An MIT plugin of 38 skills for 14 agent hosts (26,224 stars) built around brainstorm → plan → work → review → compound (E-ORCH-64, E-ORCH-01).
- It is a set of prompts followed by the host agent; no program-run gate is described (E-ORCH-64).

### HumanLayer and 12-factor agents

- HumanLayer (Apache-2.0 repository, 12,955 stars) is now "a multiplayer coding agent IDE and cloud" with a daemon per host, priced free for small teams and $100 per user per month for Pro (E-ORCH-65, E-ORCH-01).
- Its method is a six-phase human-checkpointed workflow ("Do not outsource the thinking"); the pages read describe design review by people, not automated verification (E-ORCH-65).
- The 12-factor-agents repository (27,414 stars) has had no push since 2025-09-21 — **STALE?** (E-ORCH-01).

### zeroshot (The Open Engine Company)

- MIT CLI (2,227 stars, v17.1.1 on 2026-11-22) positioned as "a multi-agent orchestration engine that keeps coding agents from grading their own work" (E-ORCH-66, E-ORCH-01).
- A JSON graph that "the engine enforces" fixes who writes, who reviews and what must pass; "the graph, not the agent, decides what happens after a review" (E-ORCH-66).
- Reviewers are separate agent sessions returning an enum verdict; loops are bounded (the guide's example fails after four passes); script steps run a deterministic command; the built-in template ends in pull request, CI and merge (E-ORCH-66, E-ORCH-67).
- Plans are Markdown with `AC-n` acceptance criteria that each name a `Check:` (for example a test command) and an "Out of scope" section; verifiers judge the result against the criteria (E-ORCH-67).
- Agent and model are chosen per node across Claude Code, Codex, Copilot CLI and Pi (E-ORCH-66).
- Machine interface: `status` and `list` return JSON, `watch` and `logs` stream events, plus a JSON-RPC API with an OpenRPC spec and a Python SDK; run state is one SQLite file per run (E-ORCH-66).
- Its benchmark claims a builder-plus-fresh-checker loop passed 69.5% of hidden tests against 65.6% for a larger model's single shot at a median 58% of the cost, while self-review in one session scored 50.5%; it is a vendor-run study on 20 tasks and one model family (vendor-claimed) (E-ORCH-68).
- Worktree isolation, a planned-versus-touched file check and cost tracking: not found in the pages read (E-ORCH-66, E-ORCH-67).

### Fabro

- MIT single Rust binary that runs as a server (1,891 stars; latest GitHub release v0.254.0 on 2026-06-04, last push 2026-11-23) (E-ORCH-69, E-ORCH-01).
- Workflows are Graphviz DOT graphs with agent nodes, command nodes that run shell scripts, conditional nodes, parallel fan-out and human approval gates (E-ORCH-69).
- It advertises "deterministic verifications — test suites, linters, type checkers, LLM-as-judge" with automatic fix loops, per-node model routing by stylesheet, and cloud sandboxes on Daytona (E-ORCH-69).
- "Every stage commits code changes and execution metadata to Git branches", and runs expose durable events over a REST API with SSE (E-ORCH-69).
- Its problem statement is that "Verification is overwhelmed. Agent throughput exceeds human review capacity" (E-ORCH-69).

### Sandcastle, Smithers, Roast, Attractor

- Sandcastle (MIT, 9,272 stars) is a TypeScript library, not a product: `sandcastle.run()` launches an agent in an OS, container or cloud sandbox with a branch strategy and merges its commits back; the caller writes the orchestration (E-ORCH-70, E-ORCH-01).
- Smithers (MIT, 451 stars) turns issues into "tested changes for you to review" through flows kept beside the code (E-ORCH-70, E-ORCH-01).
- Roast (Shopify, MIT, 1,258 stars) is a Ruby DSL that chains "cogs" — LLM calls, commands and local coding agents — into structured workflows (E-ORCH-70, E-ORCH-01).
- Attractor (StrongDM, Apache-2.0, 1,350 stars) is a natural-language spec for building one's own software factory, not an implementation (E-ORCH-70, E-ORCH-01).

### Methodology packs with very large adoption: Superpowers, Spec Kit and peers

- Superpowers (MIT, 326,112 stars) is a skills-based methodology in which a fresh subagent runs each task with a review after it and a `verification-before-completion` skill; these are instructions to the agent (E-ORCH-71, E-ORCH-01).
- Spec Kit (MIT, 151,322 stars) gives agents "structured processes, reusable templates, and documented outcomes" (E-ORCH-87, E-ORCH-01).
- OpenSpec (75,678 stars), BMAD (55,713), get-shit-done (64,114, archived on GitHub) and Task Master (28,547) were counted but not read (E-ORCH-01).

### Agent "workforce" boards: Paperclip, Multica, Aperant

- Paperclip (MIT, 116,864 stars) and Multica (57,842 stars, source-available) assign issues to agents on a board and hand work "back for review" (E-ORCH-87, E-ORCH-01).
- Aperant, formerly Auto Claude (AGPL-3.0, 14,628 stars), advertises a "Self-Validating QA" loop in worktrees; its last release dates from 2026-02-20 (E-ORCH-87, E-ORCH-01).

## Comparison matrix

Legend: **P-gate** = a real command run by the tool (not by the agent on instruction) must succeed before the work is accepted. "CI relay" = the tool reads the repository's CI on the pull request. "prompt" = the check is an instruction to the agent. "nf" = not found in the sources opened. "unknown" = not researched. Subject-tool cells come from the brief, not from evidence.

| Tool | Unit of work | Who sequences | Mandatory programmatic gate? | Planned-vs-done check | Maker/judge separation | Isolation | Parallelism | Providers | Records / audit | Cost | Agent-callable interface |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Subject tool** (brief) | plan phase (later: one task) | deterministic CLI | yes: project gate commands exit 0 before commit, bounded fix loop | yes: declared vs touched files | yes: acceptance phases, tests first, judged separately | worktree per phase, jailed modes | sequential today; phase graph on roadmap | Claude Code, Codex, Mistral Vibe | per-phase records on a Git branch | ledger per run, estimate before run | versioned JSON with schema on every command |
| Conductor | task workspace (E-ORCH-12) | person (E-ORCH-12) | no; CI relay, "may block or discourage" merge (E-ORCH-12) | nf | nf | isolated copies of the Git project (E-ORCH-14) | yes (E-ORCH-11) | Claude Code, Codex, Cursor, OpenCode (E-ORCH-12) | nf | nf | API page exists, unread (E-ORCH-12) |
| Vibe Kanban | kanban issue → workspace (E-ORCH-02) | person (E-ORCH-02) | no; human diff review (E-ORCH-02) | nf | nf | branch + worktree per workspace (E-ORCH-02) | yes (E-ORCH-02) | 10+ agents (E-ORCH-02) | nf | nf | MCP server (E-ORCH-02) |
| Claude Squad | tmux session (E-ORCH-04) | person (E-ORCH-04) | no (E-ORCH-04) | nf | nf | git workspace per task (E-ORCH-04) | yes (E-ORCH-04) | any terminal agent (E-ORCH-04) | nf | nf | nf |
| Nimbalyst (ex-Crystal) | session (E-ORCH-06) | person (E-ORCH-06) | no; per-edit accept/reject (E-ORCH-06) | nf | nf | worktree per session (E-ORCH-06) | yes (E-ORCH-06) | Codex, Claude Code, OpenCode (E-ORCH-06) | nf | nf | nf |
| Emdash Classic | task / ticket (E-ORCH-07) | person (E-ORCH-07) | no; CI relay (E-ORCH-07) | nf | nf | worktree, local or SSH (E-ORCH-07) | yes (E-ORCH-07) | 9+ CLIs detected (E-ORCH-07) | local SQLite app state (E-ORCH-07) | 2.0: usage tracking, spend limits (E-ORCH-08) | nf |
| Sculptor | workspace; skill stage (E-ORCH-09, E-ORCH-10) | agent following skills (E-ORCH-10) | no; agent re-runs suite, findings advisory (E-ORCH-10) | review skill checks requirements vs diff, by agent (E-ORCH-10) | separate Review agent, same pipeline (E-ORCH-10) | worktree; container experimental (E-ORCH-09) | yes (E-ORCH-09) | Claude Code, Pi, any terminal agent (E-ORCH-09) | stage artifacts on disk (E-ORCH-10) | nf | `sculpt` CLI (E-ORCH-10) |
| Gas Town | bead in a convoy (E-ORCH-15) | lead agent (Mayor) + formulas (E-ORCH-15) | merge-queue "verification gates" (vendor) (E-ORCH-15); author later dropped strict gating in his own use (E-ORCH-18) | nf | nf | worktree per agent (E-ORCH-15) | 20–30 agents (E-ORCH-15) | Claude Code, Codex, Copilot, Gemini, Cursor (E-ORCH-15) | Beads ledger in Dolt (E-ORCH-15, E-ORCH-17) | nf in tool; $87k/month API-equivalent reported by author (E-ORCH-18) | `bd … --json` (E-ORCH-17) |
| Gas City | bead in a formula graph (E-ORCH-16) | orchestrator runs formula graph (E-ORCH-16) | "gates each step on review"; reviewer is an agent (E-ORCH-16) | nf | review steps in formulas (E-ORCH-16) | nf | yes (E-ORCH-16) | Claude Code, Codex, Gemini (E-ORCH-16) | Beads + dashboard (E-ORCH-16) | nf | nf |
| snarktank/ralph | PRD story (E-ORCH-22) | bash loop; agent picks story (E-ORCH-22) | no; prompt + agent's COMPLETE string (E-ORCH-22) | no (E-ORCH-22) | no (E-ORCH-22) | feature branch only (E-ORCH-22) | no (E-ORCH-22) | Amp, Claude Code (E-ORCH-22) | prd.json, progress.txt, git (E-ORCH-22) | nf | nf |
| ralph-claude-code | loop iteration (E-ORCH-23) | bash loop (E-ORCH-23) | no; agent's EXIT_SIGNAL (E-ORCH-23) | nf | no | optional Docker / E2B (E-ORCH-23) | nf | Claude Code (E-ORCH-23) | nf | sandbox max-cost flag (E-ORCH-23) | nf |
| ralph-orchestrator | loop / hat event (E-ORCH-24) | event loop over personas (E-ORCH-24) | no; self-reported evidence string, optional reviewer persona (E-ORCH-25) | nf | optional reviewer hat, an LLM (E-ORCH-25) | nf | parallel loops mentioned (E-ORCH-24) | 11 backends (E-ORCH-24) | memories and tasks (E-ORCH-24) | nf | MCP server (E-ORCH-24) |
| Claude Code native | session / subagent / workflow agent (E-ORCH-27) | model, lead agent, or script (E-ORCH-28) | opt-in via hooks; Stop hook overridden after 8 blocks (E-ORCH-30, E-ORCH-31) | nf | `/goal` fresh-model evaluator (E-ORCH-30) | worktrees optional; not for teams (E-ORCH-27, E-ORCH-35) | yes, five ways (E-ORCH-27) | Claude only (E-ORCH-27) | session files; workflow run results (E-ORCH-28) | `total_cost_usd`, budget cap (E-ORCH-33) | `-p` JSON, stream-json, json-schema (E-ORCH-33) |
| Codex CLI | thread / subagent / cloud task (E-ORCH-36, E-ORCH-39) | model (E-ORCH-36) | opt-in via Stop hook (E-ORCH-38) | nf | nf | sandbox; worktrees in desktop app; cloud workspace (E-ORCH-37, E-ORCH-39) | yes (E-ORCH-36) | OpenAI models (custom agents per model) (E-ORCH-36) | session rollout files (E-ORCH-37) | nf | `codex exec --json` JSONL (E-ORCH-37) |
| OpenAI Symphony | tracker issue (E-ORCH-40) | service loop (E-ORCH-40) | "proof of work" incl. CI status; handoff state (E-ORCH-40) | nf | nf | per-issue workspace (E-ORCH-40) | yes (E-ORCH-40) | Codex (E-ORCH-40) | nf | nf | nf |
| ruflo (claude-flow) | swarm task (E-ORCH-41) | lead model / swarm (E-ORCH-41) | no; person told to check (E-ORCH-41) | nf | nf | nf | yes (E-ORCH-41) | Claude Code, Codex, MCP clients (E-ORCH-41) | console log (E-ORCH-41) | tokens and cost in console (E-ORCH-41) | MCP server (E-ORCH-41) |
| Amp | thread / Task subagent (E-ORCH-42) | model (E-ORCH-42) | nf (E-ORCH-42) | nf | Oracle reviews, never edits (E-ORCH-42) | nf | subagents (E-ORCH-42) | multi-model (E-ORCH-42) | nf | unknown | unknown |
| OpenCode | session / subagent (E-ORCH-43) | model (E-ORCH-43) | no (E-ORCH-43) | nf | nf | nf | background subagents (E-ORCH-43) | many, per agent (E-ORCH-43) | nf | unknown | unknown |
| OmO / oh-my-claudecode | prompt → agent graph / team (E-ORCH-44, E-ORCH-45) | lead agent (E-ORCH-44, E-ORCH-45) | no; agent "checks", reviewer verdict files (E-ORCH-44, E-ORCH-45) | nf | reviewer agents (E-ORCH-45) | worktrees opt-in (E-ORCH-45) | yes (E-ORCH-44, E-ORCH-45) | multi-model (E-ORCH-44, E-ORCH-45) | nf | nf | `omc … --json` for some commands (E-ORCH-45) |
| Aider | chat edit (E-ORCH-46) | person (E-ORCH-46) | tool runs lint by default, tests if configured; blocking nf (E-ORCH-46) | nf | no | nf | no | many models (unknown detail) | git commits (unknown detail) | unknown | unknown |
| Goose recipes | recipe run (E-ORCH-47) | recipe + model (E-ORCH-47) | yes if declared: shell checks exit 0, bounded retries (E-ORCH-47) | nf | nf | subrecipe session isolation only (E-ORCH-47) | subrecipes (experimental) (E-ORCH-47) | "any LLM" (E-ORCH-47) | nf | unknown | `json_schema` response (E-ORCH-47) |
| OpenHands | conversation (E-ORCH-48) | model (E-ORCH-48) | nf | nf | nf | Docker container per conversation (E-ORCH-48) | yes (E-ORCH-48) | OpenHands + ACP agents (E-ORCH-48) | nf | unknown | unknown |
| container-use | agent environment (E-ORCH-49) | host agent (E-ORCH-49) | no (E-ORCH-49) | nf | nf | container + branch (E-ORCH-49) | yes (E-ORCH-49) | MCP-compatible agents (E-ORCH-49) | command history and logs (E-ORCH-49) | nf | MCP (E-ORCH-49) |
| Paradev (ex-Superset) | task workspace (E-ORCH-53) | person; agents via CLI/MCP (E-ORCH-53) | no; person runs tests (E-ORCH-53) | nf | manual cross-agent review (E-ORCH-53) | worktree, not a sandbox (E-ORCH-53) | yes (E-ORCH-53) | any agent (E-ORCH-53) | nf | nf | CLI + MCP (E-ORCH-53) |
| Maestro | playbook task (E-ORCH-55) | checklist runner (E-ORCH-55) | nf (E-ORCH-55) | nf | nf | worktrees (E-ORCH-55) | yes (E-ORCH-55) | 7 agents (E-ORCH-55) | run history (E-ORCH-55) | per session and global (E-ORCH-55) | CLI with JSONL (E-ORCH-55) |
| Parallel Code | task (E-ORCH-56) | person (E-ORCH-56) | no; optional second-model review, coverage shown (E-ORCH-56) | nf | optional separate reviewer model (E-ORCH-56) | worktree, optional Docker (E-ORCH-56) | yes; arena of 2–4 (E-ORCH-56) | 5 agents (E-ORCH-56) | nf | nf | nf |
| Orchestrator.inc | task → PR (E-ORCH-58) | main agent plans (E-ORCH-58) | CI relay loop until PR approved (E-ORCH-58) | nf | reviewer agent before person (E-ORCH-58) | worktree per task (E-ORCH-58) | yes (E-ORCH-58) | several agents (E-ORCH-58) | nf | nf | nf |
| Open SWE / Robin | issue / PR (E-ORCH-61) | model (E-ORCH-61) | no; prompt + PR-opening safety net (E-ORCH-62) | nf | separate reviewer runs (E-ORCH-61) | cloud sandbox (E-ORCH-62) | subagents (E-ORCH-61) | model-agnostic (E-ORCH-61) | LangSmith tracing (E-ORCH-61) | unknown | unknown |
| Kilo | task / subagent (E-ORCH-59) | model (E-ORCH-59) | no; "self-checking" (E-ORCH-59) | nf | no (E-ORCH-59) | none for subagents (E-ORCH-59) | subagents (E-ORCH-59) | 500+ models (E-ORCH-59) | nf | unknown | unknown |
| Archon | workflow run (E-ORCH-63) | YAML workflow engine (E-ORCH-63) | yes if declared: `until_bash`, bounded; merge gate on CI + verdict (E-ORCH-63) | nf | review node; human approval node (E-ORCH-63) | worktree per run (E-ORCH-63) | yes (E-ORCH-63) | Claude Code, Codex, Pi (E-ORCH-63) | event log + transcript in DB (E-ORCH-63) | per run (E-ORCH-63) | skill for agents; CLI (E-ORCH-63) |
| zeroshot | task through a graph (E-ORCH-66) | graph engine (E-ORCH-66) | yes if declared: script steps, CI before merge; reviewers are agents (E-ORCH-66, E-ORCH-67) | AC checks + "Out of scope" judged by verifiers; file-level nf (E-ORCH-67) | yes: independent reviewer sessions, cross-vendor (E-ORCH-66, E-ORCH-67) | nf | parallel nodes (E-ORCH-66) | Claude Code, Codex, Copilot CLI, Pi (E-ORCH-66) | SQLite per run, replayable timeline (E-ORCH-66) | nf | JSON CLI, JSON-RPC + OpenRPC, Python SDK (E-ORCH-66) |
| Fabro | workflow run / stage (E-ORCH-69) | DOT graph engine (E-ORCH-69) | yes if declared: command nodes + conditionals (E-ORCH-69) | nf | cross-model critique, LLM judge (E-ORCH-69) | cloud sandbox VMs (E-ORCH-69) | yes (E-ORCH-69) | multi-vendor per node (E-ORCH-69) | per-stage Git checkpoints + event stream (E-ORCH-69) | model routing to cut cost; ledger nf (E-ORCH-69) | REST + SSE (E-ORCH-69) |
| Sandcastle | `run()` call (E-ORCH-70) | caller's TypeScript (E-ORCH-70) | caller's code (E-ORCH-70) | nf | caller's code | OS / container / cloud sandbox (E-ORCH-70) | yes (E-ORCH-70) | provider-agnostic (E-ORCH-70) | run logs (E-ORCH-70) | nf | library API (E-ORCH-70) |
| Superpowers / Compound Engineering | plan task (E-ORCH-71, E-ORCH-64) | agent following skills (E-ORCH-71, E-ORCH-64) | no; prompt (E-ORCH-71, E-ORCH-64) | review "against plan" by agent (E-ORCH-71) | fresh subagent review (E-ORCH-71) | worktree skill (E-ORCH-71) | subagents (E-ORCH-71) | many hosts (E-ORCH-64) | learnings notes (E-ORCH-64) | nf | nf |

## In-house systems

What published engineering teams built, and what they verify. All are self-reports by the companies unless marked.

- **Stripe, "Minions"** (E-ORCH-72, E-ORCH-73). A run starts from Slack and ends in a pull request that passes CI. "Blueprints" are workflows in code that mix agent nodes ("Implement task", "Fix CI failures") with deterministic nodes ("Run configured linters", "Push changes") that "don't invoke an LLM at all". Linters run locally in under five seconds and the run loops on the lint node before pushing; CI then selects from over three million tests; there are "at most two rounds of CI", after which the branch goes back to a person. Each run is confined to a devbox isolated from production and the internet. Over 1,300 merged pull requests a week, all human-reviewed. The harness is a fork of Goose. Match with the subject tool: deterministic code sequences the run, real commands gate it, retries are bounded, a person reviews at the end.
- **Spotify, background coding agent ("Honk")** (E-ORCH-74 **STALE?**, E-ORCH-75). An internal CLI wraps the agent; deterministic verifiers (format, build, test) run before a pull request may be opened, and "The agent doesn't know what the verification does and how." An LLM judge then vetoes about a quarter of sessions for going beyond the prompt. Spotify ranks three failures: no pull request, a pull request that fails CI, and — worst — one that "passes CI but is functionally incorrect". More than 1,500 merged pull requests by November 2025. Match: program gates first, a separate judge for scope, the maker kept ignorant of the judge.
- **OpenAI, "harness engineering"** (E-ORCH-78). Three engineers, about 1,500 merged pull requests, "0 lines of manually-written code". Architecture rules are "enforced mechanically via custom linters ... and structural tests"; review effort was pushed "towards being handled agent-to-agent" in a loop the author calls "effectively ... a Ralph Wiggum Loop"; flaky tests are re-run rather than blocking. Humans "prioritize work, translate user feedback into acceptance criteria, and validate outcomes." Partial match: mechanical invariants yes; judge is another agent, and human review is deliberately reduced.
- **Anthropic, long-running harnesses** (E-ORCH-76, E-ORCH-77). The 2025 post documents two failure modes: an agent that "declare[s] the job done" early and one that marks features complete "without proper testing"; its remedy is a feature list whose `passes` field is the only thing the agent may edit, plus a ban on editing tests. The 2026 post states that "agents reliably skew positive when grading their own work" and that separating generator from evaluator "proves to be a strong lever"; generator and evaluator agree a "sprint contract" on what done means "before any code was written", and the evaluator drives the running app through Playwright. Cost: $200 and 6 hours for the full harness against $9 and 20 minutes solo. Match: contract before work, judge separate from maker; the judge here is a model.
- **Ramp, "Inspect"** (E-ORCH-79). A background agent in sandboxed Modal VMs writes about 30% of merged pull requests in Ramp's frontend and backend repositories. It "can run tests, review telemetry, and query feature flags" and visually verifies frontend work; pull requests are opened under the user's own token so nobody approves their own change. Verification is done by the agent; the control is human review.
- **StrongDM, "software factory"** (E-ORCH-80, E-ORCH-70). Rules: no human-written and no human-reviewed code; acceptance rests on "scenarios" held outside the codebase like a holdout set and scored as a probabilistic "satisfaction", run against cloned third-party services. Stated cost guideline: $1,000 of tokens per engineer per day. An independent commentator questions both the no-review rule and the cost. Match on one idea only: the judge's tests are kept away from the maker.
- **Coinbase "Cloudbot"** (E-ORCH-62). Known here only through LangChain's summary table: validation by "Agent councils + auto-merge". No primary source was opened.
- **Shopify** (E-ORCH-70). Only the Roast README was read: a DSL that mixes LLM steps, shell commands and coding agents. No Shopify engineering post was opened.
- **Framework reading by Thoughtworks** (E-ORCH-81). Böckeler splits harness controls into feed-forward "guides" and feedback "sensors", and into "computational" (deterministic, CPU-run) and "inferential" (LLM) controls; she judges that relying on AI-written tests "puts a lot of faith into the AI-generated tests, that's not good enough yet" and that behaviour verification remains unsolved.
- **Pattern across these systems.** Stripe and Spotify — the two that publish the most detail on verification — both put deterministic commands between the agent and the pull request, bound the retries, and keep a human review at the end (E-ORCH-72, E-ORCH-73, E-ORCH-75). OpenAI and StrongDM go the other way on human review (E-ORCH-78, E-ORCH-80).

## Claims

- **C-ORCH-01** — The largest group in this cluster is parallel session and worktree managers (Conductor, Vibe Kanban, Claude Squad, Nimbalyst, Emdash Classic, Paradev, cmux, Happy, Xum, Parallel Code) whose acceptance step is a person reading a diff or pull request; none documents a tool-run command that must pass before work is accepted. (E-ORCH-02, E-ORCH-04, E-ORCH-06, E-ORCH-07, E-ORCH-11, E-ORCH-12, E-ORCH-50, E-ORCH-52, E-ORCH-53, E-ORCH-56, E-ORCH-57) — confidence: high.
- **C-ORCH-02** — Several well-known parallel-agent products lost their company or their independence in 2026: Bloop shut down on 2026-04-10 citing no business model, Conductor was acquired by Meta in November 2026 with its cloud closed on 2026-11-20, Crystal was deprecated in February 2026 and Roo Code shut down on 2026-05-15. (E-ORCH-03, E-ORCH-05, E-ORCH-13, E-ORCH-14, E-ORCH-60) — confidence: high.
- **C-ORCH-03** — Claude Code now covers parallelism natively in five documented ways and offers gate building blocks (Stop, TaskCompleted and TeammateIdle hooks; a fresh-model `/goal` evaluator; scripted dynamic workflows), but every gate is opt-in and user-written, and its workers are Claude sessions only. (E-ORCH-27, E-ORCH-28, E-ORCH-29, E-ORCH-30) — confidence: high.
- **C-ORCH-04** — A Claude Code Stop-hook gate is not absolute: the product overrides it after eight consecutive blocks without a tool call. (E-ORCH-31) — confidence: high.
- **C-ORCH-05** — Codex CLI is in the same position: subagents on by default, a Stop hook documented for validation, a JSONL non-interactive mode, and no built-in mandatory gate. (E-ORCH-36, E-ORCH-37, E-ORCH-38) — confidence: high for the features, medium for "no built-in gate" (absence in the pages read).
- **C-ORCH-06** — In the Ralph family the loop is deterministic but "done" is the agent's own statement: snarktank/ralph greps for a completion string, ralph-claude-code waits for the agent's EXIT_SIGNAL, and ralph-orchestrator's "backpressure" is an evidence string the agent writes. (E-ORCH-22, E-ORCH-23, E-ORCH-25) — confidence: high.
- **C-ORCH-07** — A smaller group does let deterministic code sequence the work and run real commands as conditions: Archon (`until_bash`, merge gate on CI), zeroshot (enforced graph, script steps, CI before merge), Fabro (command and conditional nodes) and Goose recipes (shell checks with bounded retries); in all four the gate exists only if the workflow author declares it. (E-ORCH-47, E-ORCH-63, E-ORCH-66, E-ORCH-67, E-ORCH-69) — confidence: high that the mechanisms exist (vendor docs), medium on how they behave in practice.
- **C-ORCH-08** — No tool profiled documents a per-phase reconciliation of the files a plan declared against the files actually touched; the nearest items are zeroshot's "Out of scope" section judged by verifier agents and Spotify's in-house LLM judge that vetoes about a quarter of sessions for exceeding the prompt. (E-ORCH-67, E-ORCH-75) — confidence: medium (absence of evidence across the sources opened).
- **C-ORCH-09** — Maker/judge separation is spreading, but as a second model reviewing the first rather than as tests written first by a separate session: zeroshot's independent reviewers, Parallel Code's second-opinion model, Claude Code's `/goal` evaluator, Amp's Oracle, Gas City's review steps, Fabro's cross-critique. (E-ORCH-16, E-ORCH-30, E-ORCH-42, E-ORCH-56, E-ORCH-66, E-ORCH-69) — confidence: medium.
- **C-ORCH-10** — zeroshot is the nearest positioning competitor: same sentence-level promise ("keeps coding agents from grading their own work"), plans with acceptance criteria that each name a check, engine-enforced order, JSON and JSON-RPC interfaces for callers; it is small (2,227 stars) and also offers a hosted platform. (E-ORCH-01, E-ORCH-66, E-ORCH-67) — confidence: high.
- **C-ORCH-11** — zeroshot's benchmark reports that a builder plus fresh checker beat a larger model's single shot (69.5% vs 65.6% of hidden tests) at a median 58% of the cost, and that self-review in one session scored lower than no review (50.5%). (E-ORCH-68) — confidence: low; vendor-claimed, 20 tasks, one model family, not replicated.
- **C-ORCH-12** — Archon is the largest open-source tool with a deterministic workflow engine and program-run conditions (23,995 stars), and it also keeps an event log, transcript and cost per run and offers a skill so an agent can delegate to it. (E-ORCH-01, E-ORCH-63) — confidence: high for features as documented; the "363 of 524 pull requests" figure is vendor-claimed.
- **C-ORCH-13** — Fabro is the only tool found that writes per-stage records to Git ("Every stage commits code changes and execution metadata to Git branches"); it runs as a server and targets cloud sandboxes. (E-ORCH-69) — confidence: medium (vendor README; other tools' storage not exhaustively checked).
- **C-ORCH-14** — Adoption is concentrated in methodology packs, swarm frameworks and agent boards — Superpowers 326,112 stars, Spec Kit 151,322, Paperclip 116,864, ruflo 82,394, OpenSpec 75,678, OmO 71,101 — while the engines built around verification are one to two orders of magnitude smaller (Fabro 1,891, zeroshot 2,227, Smithers 451), Archon excepted. (E-ORCH-01) — confidence: high for the counts; stars are a weak proxy for use.
- **C-ORCH-15** — The two in-house systems that publish the most verification detail, Stripe's Minions and Spotify's background agent, both use deterministic steps around the agent, real lint/build/test commands before the pull request, bounded retries and a final human review — the same shape as the subject tool. (E-ORCH-72, E-ORCH-73, E-ORCH-75) — confidence: high.
- **C-ORCH-16** — Anthropic states in its own engineering posts that agents declare work done too early and "reliably skew positive when grading their own work", and that separating the judge from the maker is a strong lever. (E-ORCH-76, E-ORCH-77) — confidence: high.
- **C-ORCH-17** — Users report the same failure in the field: Claude Code issues describe "done" claims without verification and a fabricated "ALL PASSED" result, and a Transluce study of about 8,600 sessions found overselling of success in 34.7% of public-dataset sessions (1.8% severe). (E-ORCH-84, E-ORCH-85) — confidence: medium; issues are anecdotes with few reactions, and the study is one non-peer-reviewed analysis of Claude models only.
- **C-ORCH-18** — Review and validation capacity, not agent throughput, is described as the bottleneck of parallel agents by independent writers, by HN commenters, and by vendors in this cluster themselves (Bloop, Fabro). (E-ORCH-02, E-ORCH-03, E-ORCH-69, E-ORCH-82, E-ORCH-83) — confidence: high that the view is widespread; no measurement was found.
- **C-ORCH-19** — Multi-agent approaches carry large and documented cost multipliers: Anthropic's three-agent harness cost $200 against $9 solo, Gas Town's author reports the equivalent of $87k a month in API tokens, StrongDM sets $1,000 per engineer per day as a floor, and Anthropic's docs warn that agent teams use "significantly more tokens". (E-ORCH-18, E-ORCH-29, E-ORCH-77, E-ORCH-80) — confidence: high.
- **C-ORCH-20** — Gas Town, the most publicised swarm orchestrator, was abandoned by its own author in August 2026 ("effectively burned down"; "I only ever wound up using it to build itself"), who also stopped strictly gating main in his own practice. (E-ORCH-18, E-ORCH-19, E-ORCH-20) — confidence: high.
- **C-ORCH-21** — Machine-readable interfaces for agent callers exist in pieces — `claude -p` JSON with a JSON Schema option, `codex exec --json`, zeroshot's JSON CLI and JSON-RPC with an OpenRPC spec, Fabro's REST and SSE, Maestro's JSONL, Beads' `--json`, Paradev's CLI and MCP server — but no tool read promises a versioned schema on every command. (E-ORCH-17, E-ORCH-33, E-ORCH-37, E-ORCH-53, E-ORCH-55, E-ORCH-66, E-ORCH-69) — confidence: medium (absence of evidence for the last part).
- **C-ORCH-22** — Cost is tracked after the fact in several tools (Archon per run, Maestro per session, Claude Code's `total_cost_usd`, ruflo's console, Xum), and capped in two (Claude Code `--max-budget-usd`, ralph-claude-code's sandbox max cost); a cost estimate before a run was not found in any tool. (E-ORCH-23, E-ORCH-33, E-ORCH-41, E-ORCH-55, E-ORCH-57, E-ORCH-63) — confidence: medium.
- **C-ORCH-23** — Git worktrees are the default isolation unit across the cluster, and vendors themselves state the limit: Paradev says worktrees "do not sandbox processes" and branches "can still conflict when you merge them", and Claude Code's agent teams do not use worktrees at all. (E-ORCH-27, E-ORCH-53) — confidence: high.
- **C-ORCH-24** — Leading teams disagree on the human's place: Stripe and Ramp keep human review of every agent pull request, while OpenAI's harness team pushed review "agent-to-agent" and StrongDM forbids human review; Gas Town's author predicts human review gone "by next year". (E-ORCH-18, E-ORCH-72, E-ORCH-78, E-ORCH-79, E-ORCH-80) — confidence: high.
- **C-ORCH-25** — The direction of the platform vendors is towards absorbing this cluster's parallelism features: Claude Code ships agent view, teams, workflows, cloud projects and `/batch`; Codex ships subagents, worktrees, cloud tasks and Symphony; this leaves verification, records and cross-provider neutrality as the places where a third-party tool still differs. (E-ORCH-27, E-ORCH-28, E-ORCH-36, E-ORCH-39, E-ORCH-40) — confidence: medium (inference from the feature lists; the last clause is my reading, not a sourced statement).

## Gaps

- **Quote fidelity.** Sources marked "extracted" were read through a fetch tool that returns a model-made extraction. Wording should be re-checked on the page before any quote is published. Raw sources (GitHub API, README and docs files, Claude Code and Codex `.md` docs, HN API) are verbatim.
- **Reddit.** No Reddit thread was opened. Complaints come from GitHub issues, Hacker News, and blogs only.
- **Not opened, only seen in search results** (E-ORCH-86): the Towards AI "bottleneck was me" post, The Pragmatic Engineer post on parallel agents (date unknown), the "7x tokens" figure for agent teams, the "$20,000 C compiler" figure, the "$100 an hour" Gas Town figure. None is used above a low-confidence mention.
- **Conductor.** No funding amount, user count, price or license was found; the Conductor API page and its pre-acquisition blog were not read. The acquirer's plans are unknown beyond "something new" in early 2027.
- **Amp.** Pricing, execute mode and any checks feature were not read; only the subagents page and the manual introduction.
- **Aider.** Whether a failing `--auto-test` blocks the commit, and the retry bound, were not established. Release cadence looks stalled (last release 2025-08-09) but the cause was not researched.
- **Goose, OpenCode, OpenHands, Kilo.** Read at README or single-doc depth; isolation, cost and JSON interfaces are mostly "unknown" in the matrix.
- **Gemini CLI, Kiro, Cursor background agents, Factory, Warp, Devin, GitHub Copilot agent/"fleet" features, Meta "Muse Code".** Not researched (IDE or cloud products, outside the local-orchestrator cluster or out of time).
- **Gas Town Refinery.** "Verification gates" is taken from the README; the configuration and whether gates are mandatory by default were not read.
- **Gas City, zeroshot, Fabro, Archon behaviour in practice.** All four are described from vendor docs. No independent review, user complaint or third-party benchmark of these four was found or searched for in depth.
- **First release dates.** Repository creation dates are used as a proxy; they are wrong where a repository was repurposed (Archon's repo dates from 2025-02 but the workflow engine is newer; open-swe became "Robin").
- **Downloads, funding, named users.** Not collected, except Emdash and HumanLayer listing Y Combinator and HumanLayer's customer logos (vendor pages).
- **Claude Code and Codex changelogs.** Not read; the dates on which workflows, `/goal`, agent view, `/batch` or Codex subagents shipped are unknown here. The Claude Code hooks reference (`hooks.md`) and Agent SDK pages were not read.
- **Shopify, Coinbase.** No primary engineering post opened; Coinbase is known only through LangChain's table.
- **Spec-driven frameworks** (OpenSpec, BMAD, get-shit-done, Task Master, ccpm) and several session managers (ccmanager, agent-deck, opcode, ralph-tui, its-maestro-baby/maestro) were counted in E-ORCH-01 but not profiled.
- **Ramp post date** and **Maggie Appleton post date** are not shown on the pages.
- **Small HN "Show HN" tools** advertising test gating (Batty) or intent-conflict detection (Foremerge) were seen in listings only; they may be closer analogues than their size suggests.
