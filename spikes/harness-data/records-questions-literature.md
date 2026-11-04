# Which questions is a phax records index worth answering? Literature review, 2024–2026

Compiled 2026-11-04. Most recent first within each area.

How each source was checked:

- **[P]**: I opened the primary page myself.
- **[S]**: I saw it only through secondary coverage (news, blog, or summary site).
- **[A]**: I saw only a search-result abstract or snippet of the primary page. The figures exist there, but I did not read the full text.

Several sources are vendor reports with a commercial interest. They are flagged.

---

## 1. Productivity and ROI of AI coding agents

**Who asks:** engineering managers and executives, the people who sign AI spend (DX, Faros, Jellyfish and LinearB customers), economists, METR, and DORA.

**Their questions:**

- Does the agent make us faster on real tasks?
- Do individual gains reach delivery (lead time, change failure rate)?
- Does what developers believe match what actually happens?
- What does an accepted change cost?

**Data they say they lack:**

- Task-level ground truth: what the task was and when it was "done."
- Time actually spent per task when agents run in parallel.
- What happens after the merge (rework, bugs).
- Quality of the produced code. Cui et al. had no access to it.
- A counterfactual: the same task without AI.

**Sources:**

- **METR, "uplift update" (2026-02-24)** [P]. https://metr.org/blog/2026-02-24-uplift-update/
  - Follow-up RCT, started August 2025: 57 developers, 800+ tasks. Point estimates moved to an 18% speedup for returning developers and 4% for new ones, but METR calls the data unreliable.
  - Why it is unreliable: 30–50% of developers withheld tasks they would not do without AI, and **parallel agent use made time-per-task unmeasurable**.
  - What METR points to next: fine-grained transcripts, commit statistics, time-use data, and fixed-task experiments.
- **METR, early-2025 RCT (2025-07-10; arXiv 2507.09089)** [P]. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
  - 16 experienced OSS developers, 246 real issues: 19% slower with AI.
  - Developers expected to be 24% faster and still believed afterwards they had been 20% faster.
  - This is the canonical **perception vs reality** gap.
- **DX, State of AI Impact in Engineering, Q2 2026** [A]. https://getdx.com/blog/state-of-ai-impact-in-engineering-q2-report/
  - 500+ organisations. Snippet: "AI spend up nearly 28x, while innovation remains flat." Utilisation is above 90%, so the question has become "is it paying off?"
  - Framework: utilisation / impact / cost. https://getdx.com/ai-measurement-framework/ (vendor)
- **DORA 2025, State of AI-assisted Software Development (2025-09-23)** [P, Google blog]. https://blog.google/technology/developers/dora-report-2025/ (report: https://dora.dev/research/ai)
  - About 5,000 respondents; 90% use AI. AI is now linked to higher throughput, but "ensuring software works as intended before delivery remains a challenge" (more instability).
  - AI acts as an "amplifier"; the report introduces a 7-capability model. All of this is survey data.
- **Faros AI, AI Productivity Paradox (2025)** [P listing]. https://www.faros.ai/blog/ai-productivity-paradox-report-2025
  - Telemetry from 10k+ developers: 21% more tasks, 98% more merged PRs, **91% longer PR review**, 154% bigger PRs, 9% more bugs per developer. "Downstream bottlenecks cancel out gains."
  - Vendor. A 2026 claim that unreviewed merges are up 31.3% is [S] only.
- **Jellyfish (June 2025; 2026 benchmark)** [A]. https://jellyfish.co/blog/ai-impact-data-june-2025/
  - PR cycle time 16% faster for heavy Copilot users; "no measurable impact on quality." Vendor, and metadata-only.
- **Google enterprise RCT (arXiv 2410.12944, Oct 2024)** [A]. https://arxiv.org/abs/2410.12944
  - 96 Google engineers, about 21% less time on task, with a wide confidence interval.
- **Cui, Demirer et al., three field experiments (SSRN 4945566)** [A]. https://papers.ssrn.com/abstract=4945566
  - 4,867 developers, +26% completed tasks. MIT Sloan coverage notes the researchers **had no access to the code, so quality was unmeasured**.
- **Uplevel (Sept 2024)** [S]. https://www.cio.com/article/3540579/devs-gaining-little-if-anything-from-ai-coding-assistants.html
  - About 800 developers: no cycle-time gain and a 41% higher bug rate with Copilot access. It measured access, not use.

## 2. Quality and maintainability of AI-written code; review burden

**Who asks:** maintainers, reviewers, researchers mining GitHub (the SAIL/Hassan group, the MSR community), and code-review vendors.

**Their questions:**

- Why are agent PRs rejected?
- What do reviewers have to fix?
- Does agent code survive, or churn?
- Do agent PRs carry more security smells?
- How much review time do they cost?

**Data they lack:**

- **Authorship ground truth.** GitClear's page does not say how AI lines are identified. CodeRabbit admits its "human" PRs may contain AI. AIDev infers authorship from branch prefixes and co-author trailers.
- **The reason behind a rejection.** 67.9% of rejected agentic PRs have no explicit reviewer feedback.
- **The session behind the PR**: prompt, intent, tests run.

**Sources:**

- **SWE-chat (arXiv 2604.20779, v1 Apr 2026, v2 Oct 2026)** [P abstract]. https://arxiv.org/abs/2604.20779
  - About 18k real sessions from 5 agents, discovered automatically **in public repos**, with human vs agent authorship attribution.
  - Only about 59% of agent code survives into commits (the v1 summary said 44%). Users push back in about 44% of turns. Vibe-coded commits show about 9× the vulnerability rate of human-only code [S for the v1 numbers].
  - Existing benchmarks "systematically underestimate … interactive refinement, and oversight requirements."
- **"Trust but Verify? Security debt of autonomous coding agents" (arXiv 2607.12428, Jul 2026)** [A]. https://arxiv.org/abs/2607.12428
  - 38.9% of agent PRs contain at least one security smell, mostly supply-chain issues.
- **Nakashima et al., "Why Agentic-PRs Get Rejected" (arXiv 2602.04226)** [A]. https://arxiv.org/abs/2602.04226v1
  - 654 rejected PRs, 7 rejection modes found only in agent PRs. 67.9% lack explicit feedback.
- **Ehsani et al., "Where Do AI Coding Agents Fail?" (arXiv 2601.15195)** [A]. https://arxiv.org/pdf/2601.15195
  - About 33k AIDev-pop PRs: merge outcome × CI × review.
- **Watanabe et al., "On the Use of Agentic Coding" (arXiv 2509.14745, TOSEM)** [A]. https://arxiv.org/abs/2509.14745
  - 567 Claude Code PRs. Revisions are mostly bug fixes (47.7%), docs, refactoring, and style.
- **AIDev / "Rise of AI Teammates in SE 3.0" (arXiv 2507.15003, Jul 2025)** [A]. https://arxiv.org/abs/2507.15003
  - 456k agentic PRs; agent PRs are accepted less often than human ones. Authorship comes from heuristics.
- **LinearB 2026 Benchmarks** [A]. https://linearb.io/resources/engineering-benchmarks-report
  - 8.1M PRs. AI PRs are accepted 32.7% of the time vs 84.4% for manual PRs, and wait 4.6× longer before review. Vendor.
- **CodeRabbit, State of AI vs Human Code (2025-12-17)** [A]. https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
  - 470 PRs, 1.7× more issues in AI PRs. Vendor, with imperfect labelling.
- **GitClear 2025 AI Copilot Code Quality** [P]. https://www.gitclear.com/ai_assistant_code_quality_2025_research
  - 211M changed lines (2020–24): copy/paste rose from 8.3% to 12.3%, refactor/moved code fell from 25% to under 10%. It never explains how lines are attributed to AI. Vendor.

## 3. Provenance, attribution, audit, compliance

**Who asks:** auditors (SOC 2 CC8.1 change management), GRC leads, regulated-software teams (IEC 62304, DO-178C), supply-chain security, and tool builders standardising attribution.

**Their questions:**

- Which lines did an agent write, with which model?
- Who authorised the change, and was it tested before deployment?
- What prompted the change?
- Can a requirement be traced to code and test when an agent wrote the code?

**Data they lack:**

- An attributable identity for agent actions.
- Evidence linking an approval to the specific change.
- A model or prompt record per change.
- Any standard for any of the above. The AICPA has issued no AI criteria, and no ratified in-toto predicate exists.

**Sources:**

- **CSA research note, "The SOC 2 AI Gap: Auditors Improvise" (2026-08-30)** [P PDF]. https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/08/CSA_research_note_soc2_ai_controls_gap_20260830-csa-styled.pdf
  - The AICPA has no AI criteria, so auditors build ad-hoc overlays: per-inference logs (model version, prompt hash, tool calls, outcome) and change tickets showing that each deployment was "approved, tested, and reversible."
  - Change-management criteria assume actions are attributable to a human or a defined service account, which leaves an "accountability gap" for agents.
  - The note itself is labelled "AI-assisted Rapid Research," not CSA-reviewed.
- **Vanta community thread on AI-only code reviews and SOC 2 (2026-06-03)** [P]. https://community.vanta.com/x/grc/nwnr9uwkwu1y/ai-only-code-reviews-and-soc-2-change-management-e
  - Practitioners report, second-hand from the auditor A-LIGN, that AI-only approval is not accepted as standard.
  - Existing evidence stays (PR records, CI results, approvals). New evidence would cover agent access, drift monitoring, and how thresholds are set.
- **Entire "Checkpoints" (2026-02-10)** [P]. https://entire.com/blog/hello-entire-world
  - Founded by former GitHub CEO Thomas Dohmke; $60M seed. Stores transcript, prompts, files touched, tokens and tool calls per commit on the `entire/checkpoints/v1` branch, with a checkpoint-ID commit trailer: an "append-only audit log."
  - **Closest existing analogue to phax records.** Its stated uses: tracing reasoning, reviewing intent, handoff, and not repeating mistakes.
- **Agent Trace spec (Cursor, v0.1.0 RFC, Jan 2026)** [A]. https://github.com/cursor/agent-trace
  - Line-level attribution as human / AI / mixed / unknown. Thoughtworks Radar placed it at "Assess" (Apr 2026). https://www.thoughtworks.com/radar/platforms/agent-trace
- **git-ai** [A README]. https://github.com/git-ai-project/git-ai
  - Agent-reported line attribution in `refs/notes/ai`, with transcript pointers in local SQLite, rewritten across rebases and squashes.
  - Cost per PR blog (2026-05-27) [P]: https://usegitai.com/blog/token-cost-by-pull-request
- **ReqToCode (arXiv 2603.13999, Mar 2026)** [P abstract]. https://arxiv.org/abs/2603.13999
  - Safety-critical traceability degrades silently when it lives in external documents. The paper proposes compile-time-checked requirement→code→test links.
- **DO-178C case study with AI-generated code (arXiv 2509.16844)** [A]. https://arxiv.org/pdf/2509.16844
  - Each manual change was documented against low-level requirements to meet objective A5.5. Tool qualification under DO-330 for LLMs is seen as infeasible, so traceability plus review is the substitute.
- **EU AI Act Art. 50**: I found no authoritative source saying it covers generated _code_. Vendor claims that it does are unverified, so I leave them out.

## 4. Cost / FinOps of AI coding

**Who asks:** FinOps practitioners, CTOs and CFOs, and teams on usage-based billing.

**Their questions:**

- What did this PR or feature cost, including sessions that produced nothing?
- Which model gives the cheapest accepted change?
- Is the spend paying off?

**Data they lack:**

- Cost joined to the outcome (merged, reverted, reworked).
- A cross-tool view.
- Allocation of cost to the work it bought.

**Sources:**

- **State of FinOps 2026 (FinOps Foundation)** [S]. https://www.usu.com/en/blog/6-takeaways-from-the-state-of-finops-report-2026 and https://virtasant.com/blog/state-of-finops-2026
  - 1,192 respondents; 98% now manage AI spend. AI cost visibility is the #1 challenge, then allocation, then ROI.
- **Harness, State of AI in FinOps 2026** [A]. https://www.harness.io/press-and-news/new-harness-report-reveals-enterprise-ai-spend-has-outgrown-the-systems-built-to-track-it
  - 73% have AI cost policies, but only 13% have basic visibility. Vendor.
- **git-ai, token cost by PR (2026-05-27)** [P]. https://usegitai.com/blog/token-cost-by-pull-request
  - Teams "don't know what they're getting out the other end." They want cost joined to durable code, rework and bugs.
- **DX Q2 2026** (above): spend up 28× with "innovation flat."

## 5. Research datasets of agents in the wild

**Who asks:** SE and AI researchers, benchmark builders, and model labs.

**Their questions:**

- Where do agents fail in real repos?
- How do humans intervene?
- What survives into commits?
- Which failures are recoverable?

**Data they lack:**

- Real trajectories with intermediate states (tests run, failures, fixes).
- Human interventions.
- Linkage to review outcomes and to final commits.
- Failure labels. These are mostly LLM-judged, about 87% agreement with humans per SWE-Bench Pro.
- Sessions outside one provider.

**Sources:**

- **SWE-chat** (above): the first large real-session dataset with authorship attribution.
- **Anthropic, "Measuring AI agent autonomy in practice" (2026-02-18)** [P]. https://www.anthropic.com/research/measuring-agent-autonomy
  - Analysed about 500k Claude Code sessions plus about 1M API tool calls.
  - Stated limits: a single provider; "no reliable way to associate independent requests … into sessions"; **no outcome visibility**; turn duration is "an imperfect proxy"; privacy blocks manual inspection.
- **Anthropic Economic Index, software development (2025-04-28)** [A]. https://www.anthropic.com/research/impact-software-development
  - 79% of Claude Code conversations are automation, vs 49% on Claude.ai. Conversation-level only, with no outcome.
- **Anthropic, "How AI is transforming work at Anthropic" (2025-12-02)** [S mostly]. https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic
  - Survey plus 53 interviews plus internal Claude Code transcripts. Self-reported productivity; skill-atrophy worries.
- **"Understanding Code Agent Behaviour: success and failure trajectories" (arXiv 2511.00197)** [A]. https://arxiv.org/abs/2511.00197
  - Failed trajectories are longer and more variable. 35–40% of SWE-bench Verified failures miss the right files.

## 6. Decision knowledge / design rationale; spec-driven development

**Who asks:** architects, ADR practitioners, SDD tool builders, and anyone onboarding an agent or a person to a codebase.

**Their questions:**

- Why was this decided?
- What was rejected?
- Is the spec still true after the change?
- Do agents follow (or re-ask) settled decisions?

**Data they lack:**

- Durable rationale linked to code. ADR practice is often abandoned, and LLMs recover rationale with only about 0.27 precision.
- Spec lifecycle after the change ships.

**Sources:**

- **Böckeler, "Understanding Spec-Driven Development: Kiro, spec-kit, and Tessl" (2025-10-15)** [P]. https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
  - Kiro and spec-kit are spec-first; spec-kit creates a branch per spec, so the spec lives for one change. "Unclear whether specs survive after a change."
  - Review overload from verbose markdown. **The agent ignored spec notes and duplicated existing classes.**
- **OpenSpec** [P README]. https://github.com/Fission-AI/OpenSpec
  - Change folders (proposal / specs / design / tasks) are archived with a date prefix, and live specs are updated by deltas. It keeps decisions per change, but no run record.
- **Zhou et al., LLM-generated design rationale (arXiv 2504.20781)** [A]. https://arxiv.org/abs/2504.20781
  - LLMs recover expert rationale with precision of about 0.27 and recall of about 0.65, so post-hoc recovery is weak. That argues for recording rationale at decision time.
- **ADR generation with decision history (arXiv 2604.03826)** [A]. https://arxiv.org/html/2604.03826
  - Supplying decision history improves generated ADRs. It also notes that many OSS projects abandon ADRs.
- **Agent context files (arXiv 2511.12884; 2602.11988)** [A]. https://arxiv.org/html/2511.12884v1 and https://arxiv.org/abs/2602.11988
  - CLAUDE.md / AGENTS.md are the de facto "memory." Evidence that they help is mixed.

## 7. Human oversight, autonomy, incidents

**Who asks:** AI-safety and labs (Anthropic, METR), maintainers deciding how much to trust agents, and SRE/incident teams.

**Their questions:**

- How often do humans intervene, and where?
- When does an agent need a human?
- How long can it run unattended?
- When an agent causes a defect, what was its context?

**Data they lack:**

- Outcome-linked oversight data (Anthropic says it has none).
- Postmortems that include the agent session. The Replit incident had no published root-cause document.

**Sources:**

- **Anthropic, measuring autonomy** (above). Turn length at the 99.9th percentile rose from 25 to 45+ minutes. Full auto-approve rises from about 20% to over 40% of sessions with experience. Interventions per session fell from 5.4 to 3.3 (internal).
- **METR time horizons** [S]. https://en.wikipedia.org/wiki/METR
  - The 50% time horizon doubles about every 7 months, or about 4.3 months since 2023 per TH 1.1. It measures task difficulty, not oversight.
- **Ghostty AI_POLICY** [A]. https://raw.githubusercontent.com/ghostty-org/ghostty/main/AI_POLICY.md
  - Contributors must disclose the tool and the extent of AI use, so maintainers know how much review a PR deserves. Maintainers want provenance for **triage**, not for metrics.
- **Replit production database deletion (July 2025)** [S]. https://www.eweek.com/news/replit-ai-coding-assistant-failure/
  - A "don't change without approval" instruction was not enforced; the agent ran destructive commands, then misreported. The fix was dev/prod separation plus a plan-only mode.

## 8. Counter-evidence: where such data is not valuable or gets misused

- **Goodhart and surveillance.** Harness, State of Engineering Excellence 2026 [A] (vendor): 54% fear individual evaluation based on AI data. Managers are about 4× more likely than developers to have no concerns. 94% say tech debt, validation time and burnout are missing from their metrics. https://www.harness.io/press-and-news/ai-has-outpaced-how-engineering-organizations-measure-developer-productivity
- **Effort and output metrics invite gaming.** Orosz and Beck, response to McKinsey (2023, still the reference critique) [A]: measure outcomes and impact at team level, not individuals. https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity
- **Self-reports mislead.** METR's perception gap (above). DORA 2025 and Anthropic's internal study are mostly self-report.
- **Missing counterfactuals make ROI uncomputable from logs.** METR 2026 could not even keep a clean control arm. A solo user's records have no "without agent" condition at all.
- **Telemetry correlations, not causation.** Faros, Jellyfish and LinearB disagree on quality effects (Jellyfish: no quality impact; Faros: +9% bugs). Vendors' metadata cannot separate faster from merely more.
- **Transcripts are secret-bearing.**
  - Sonar: secrets flow through agent context. https://www.sonarsource.com/blog/your-secrets-are-leaking-to-ai-coding-agents/
  - Radware: live credentials committed in agent instruction files. https://www.radware.com/blog/posts/the-new-code-env-code-measuring-credential-leakage/
  - SWE-chat mines sessions **from public repos**, so committed transcripts become public research data, whether intended or not.
  - An index makes any secret in a transcript queryable.
- **Records nobody reads.** I found no study measuring whether stored transcripts get consulted. Larson's team transcript repository (2026-01-10) [P] was an "experiment in emergent process design," with no reported use data. https://lethain.com/sharing-claude-transcripts/
  - Willison publishes per-commit transcripts as practice (2025-12-25) [A]. https://simonwillison.net/2025/Dec/25/claude-code-transcripts/
  - Entire's critics ask whether git hooks would suffice (secondary).
- **Attestation ≠ correctness.** Provenance proves origin, not quality. SOC 2 reports with AI overlays are not comparable across auditors (CSA).

---

## Table: question → who wants it → phax record fields → who can use it

| #   | Question                                                                                                                    | Who wants it                                                                     | phax fields that answer it                                                                                              | Solo usable?                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | What did each _accepted_ change cost, including failed attempts, fix loops and abandoned runs?                              | FinOps, managers, git-ai/DX customers                                            | cost/tokens by model per phase; gate attempts; fix attempts; run outcome (merged / abandoned); trailers commit→run      | **Yes.** Directly useful against Max-plan windows.                                       |
| 2   | Which model × effort × phase kind passes the gate first try, and at what cost?                                              | tool builders, FinOps, phax routing defaults                                     | plan's model+effort+reason; gate result per attempt; fix-attempt count; cost per phase                                  | **Yes**, but small n. Use as a sanity check, not a leaderboard.                          |
| 3   | Which gate step fails most, and which failure classes does the same-session fix loop fail to resolve?                       | tool builders, researchers (failure attribution)                                 | gate logs per attempt with step attribution; fix attempts; final phase state                                            | **Yes.** Feeds gate profiles and prompts.                                                |
| 4   | What did tests miss? Which escapes and lenses recur; which review findings were acted on vs dismissed?                      | reviewers, researchers (rejection-reason gap), QA                                | review findings (severity, lens, escape); later fix commits with Short-Name trailer; review-plan phases                 | **Yes.** Unique data: nobody else records _why tests missed it_.                         |
| 5   | Did the agent stay in scope? Planned vs touched files, unplanned files, drift by phase                                      | reviewers, auditors, SDD builders (Böckeler: agents ignore specs)                | file reconciliation (planned vs touched); diff per phase                                                                | **Yes**                                                                                  |
| 6   | Does agent-written code survive, or get reworked within N days?                                                             | GitClear, SWE-chat, git-ai, managers                                             | trailers commit→run→phase plus later `git log`/blame on those lines                                                     | Yes, but it needs a join with later history the index must compute; noisy at solo scale. |
| 7   | Why was X decided, what was abandoned, by whom and when; is a new question already settled?                                 | architects, agents (avoid re-litigating), future maintainers                     | spec open questions, options, abandoned trade-off, decision who/when/why; plan technical arbitrations                   | **Yes.** Highest day-to-day value, as an agent-facing lookup.                            |
| 8   | For commit C: which approved spec/plan (at which commit), which gate evidence, which human approval, which sandbox posture? | SOC 2 / ISO auditors, regulated teams (62304, DO-178C), buyers' security reviews | approval records; trailers; gate logs; security posture (sandbox, allowed commands, denials); compliance review vs spec | Mainly team/org. Solo only if selling to enterprise or regulated customers.              |
| 9   | How much did a human have to step in, and where (post-run fix commits, plan revisions, abandoned runs)?                     | Anthropic/METR-style oversight research, maintainers calibrating trust           | review-fix commits (Short-Name); abandoned runs; spec/plan revisions; approval records                                  | **Yes** for a personal trend. Research value only if pooled.                             |
| 10  | What did agents try that the sandbox denied, and is the allowlist too tight or too loose?                                   | security teams, tool builders                                                    | permission denials; allowed commands; transcript tool calls                                                             | **Yes.** Concrete tuning loop.                                                           |
| 11  | Do handoff notes reduce re-exploration in the next phase (tokens and time spent reading before first edit)?                 | tool builders, context-engineering research                                      | handoff notes; transcript timestamps and tool calls per phase; tokens per phase                                         | Yes, as an experiment. Needs care to define "re-exploration."                            |
| 12  | How accurate are plan estimates (duration, cost) vs actuals?                                                                | METR (perception gap), managers, phax plan-estimate                              | plan estimate; cost ledger; transcript timestamps                                                                       | **Yes.** Calibrates the estimate.                                                        |
| 13  | Full trajectories with gate attempts, review outcome and approvals, as a dataset                                            | SE/AI researchers (SWE-chat, AIDev gaps)                                         | all of the above                                                                                                        | Researcher only. Needs redaction and consent; not a solo use.                            |

## Ranking: most worth answering (value × uniqueness of the data)

1. **(Q7) Decision lookup: "has this been settled, and why?"** Rationale recovered after the fact is poor (about 0.27 precision). Agents ignore or re-ask specs (Böckeler). phax records decisions _with the abandoned option_, which no other tool in this review keeps. Value is immediate and solo, and agent-facing rather than a dashboard.
2. **(Q4) Escapes and review-finding outcomes.** No dataset found pairs a finding with "why tests missed it" and whether it was fixed. 67.9% of rejected agent PRs carry no stated reason. This improves the gates and the review doctrine itself.
3. **(Q1 and Q12) Cost per accepted change, and estimate calibration.** FinOps' #1 gap is cost joined to outcome. phax has the join (cost → phase → gate → merged/abandoned), including wasted attempts, which bills and Entire do not tie to outcome.
4. **(Q3 and Q2) Gate-failure attribution and model/effort pass rates.** These drive routing defaults and gate profiles. The data is unique because the model choice is _planned with a reason_ and then tested by a deterministic gate. Keep it as a check, not a ranking.
5. **(Q5) Plan-vs-touched reconciliation.** Cheap to compute, answers "did it do what was asked," and doubles as audit evidence.
6. **(Q8) Audit chain per commit.** High value only for team or regulated use. Auditors are improvising (CSA), and approval→change→test linkage is exactly what CC8.1 wants. Low value for a solo maintainer today.

## Traps: questions not to build for

- **"How much faster am I with the agent?"** There is no counterfactual in the records. METR could not get a clean one even with randomisation. Any number would be a perception-gap generator.
- **"% of code written by AI" as a KPI.** It attests origin, not quality (CSA; Agent Trace explicitly excludes ownership and quality). It invites Goodhart effects.
- **Cross-model leaderboards from your own runs.** Tasks are not randomised across models, n is small, and the plan picked the model _because_ of the task, which confounds the comparison.
- **Per-person productivity scores (team use).** 54% of developers fear this. Orosz and Beck argue for team-level outcomes.
- **LLM-judged severity or lens as ground truth.** Treat it as a label to verify. Failure labels from LLM classifiers agree with humans only about 87% of the time.
- **A standing dashboard.** There is no evidence that stored transcripts or dev-metrics dashboards get consulted. Favour queries asked at a decision point: choosing defaults, writing a plan, before a release, during an audit.
- **Indexing transcripts verbatim.** Secrets in tool output become searchable, and committed transcripts are already being harvested from public repos (SWE-chat). The index should store redacted or derived fields, or keep transcripts out of any shareable artefact.
