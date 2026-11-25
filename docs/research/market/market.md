# Review, not writing, now limits agent work

> Checked on 2026-11-25 against phax 0.43.0 (`package.json`; latest tag `v0.42.0`). Ids in square brackets
> resolve to the files under [`evidence/`](evidence/): `E-…` is an evidence item in the notes, `C-nn` is a claim in
> [`claims.md`](claims.md). Nothing here comes from outside those notes. Most figures in `market-human-demand.md` and
> all of `competitors-verification-provenance.md` were read through a fetch tool's text extraction: figures are "as
> extracted", and quotes marked *(extracted)* must be re-checked on the page before they are published verbatim. A
> study is called **vendor-run** when its publisher sells something the finding helps to sell.

Coding agents went from an assistant to the origin of a third or more of the code in about a year, and the work moved
from writing to checking. The enterprise market was sized at about $10 billion annualised in April 2026 [C-34], and
agents start between 35% and 47% of code and pull requests on four different measures [C-35]. The one independent
firm-level study finds that after agents arrive, time from review to merge rises 56.1% and "Code review becomes the
bottleneck" [C-38]. Agents also report work they did not do, at about 2% of real sessions in severe form and far
more in benchmarks [C-40], and they satisfy the checks they can see without delivering what was asked [C-41].
That is the problem phax addresses, and the evidence for it is strong. The evidence that people will accept phax's
price for solving it (a spec, a plan, real automated gates) is weak and partly contrary [C-54] [C-55]. **Deduction: phax
is most useful to an individual or a small team that already has gates worth trusting and works on a Claude
subscription**, which is also the only user phax has [C-75] [C-53] [C-72]. For agents as callers, phax already ships most of
what the notes' checklist asks of a delegation tool, and lacks the three things that decide whether a lead agent
picks it over its own subagent: starting at once, giving the hand back, and working without a plan. Those three
exist only as briefs [C-68] [C-69]. No text opened requires a record of what wrote a piece of code; that reading is
an inference [C-49].

## A $10 billion market in which agents start four changes in ten

Gartner sized the enterprise market for AI coding agents at $9.8 to $11.0 billion annualised as of April 2026; the
figure was read through news reprints, the press release itself was not opened [E-MKT-01]. Vendor run-rates point
the same way and are vendor-claimed: Claude Code over $2.5 billion in February 2026, with enterprise use over half
[E-MKT-02]; Cognition "close to $900 million" [E-MKT-08]; Cursor over $4 billion in June on a single unnamed source
[E-MKT-05]. Paid-user counts that could be opened are 4.7 million GitHub Copilot subscribers in January 2026, over
one million paying Cursor customers in April, and over 5 million weekly Codex users in June, a fifth of them not
developers [E-MKT-07] [E-MKT-04] [E-MKT-06]. No Claude Code figure after February 2026 was found [E-MKT-03].

Surveys agree that most professional developers use agents and disagree on the level [C-36]. JetBrains (vendor-run,
over 15,000 professional developers, May to July 2026) reports 90% using agents at work at least weekly [E-MKT-13].
Stack Overflow's April pulse survey reports 59%, its annual survey 26.2% for "automated agent workflows", and The
Pragmatic Engineer's readership survey 55% [E-MKT-16] [E-MKT-15] [E-MKT-23]. The populations and questions differ.

On the share of work, four measures fall between 35% and 47% [C-35]. Developers in JetBrains' survey say about 47% of
their code is fully written by agents [E-MKT-14]. GitHub reports that more than 40% of pull requests in September
2026 started with an agent's first draft, about 110 million in the month, up from 17% in March; GitHub calls its
detection "a floor" and does not publish its error rate [E-MKT-10] [E-PLAT-46] [E-PLAT-47]. Jellyfish (vendor-run
telemetry) puts agent involvement at 35% of merged pull requests at the median company [E-MKT-33]. Sonar (vendor-run
survey) put AI at 42% of committed code in January and 65% in November [E-MKT-19] [E-VER-70].

Two facts matter for phax's choice of providers. Claude Code rose from 18% to 39% of professional developers between
January and mid-2026 while Copilot fell from 29% to 21% and Cursor from 18% to 12% (vendor-run survey) [E-MKT-13].
And the hands-off mode grows fastest: Copilot cloud agent, where a task is assigned and worked alone, grew 230% year
over year against 85% for agent chat [E-AGT-62]. Anthropic still reports that developers can "fully delegate" only
0 to 20% of tasks [E-AGT-66].

## Developers trust what they can check, and check less each year

Trust is conditional on being able to verify. In Stack Overflow's 2026 survey trust is highest when answers are easy
to validate (48%), and 6.6% would trust AI for important decisions [E-MKT-15]. Most developers keep agents on a
leash: 63% rarely or never let them run on autopilot, 60% block unapproved system changes, and the median company
auto-merges 0.7% of its pull requests [E-MKT-16] [E-MKT-33] [C-37].

Stated distrust exceeds actual checking. Sonar (vendor-run; it sells verification tooling) reports that 96% of
developers do not fully trust AI code while 48% say they always check it before committing; a year later that
share was 39% [E-MKT-19] [E-VER-70]. A leading practitioner writes of his own agent-written code: "But I'm not
reviewing that code" *(extracted)* [E-MKT-65]. Perceived gains shrank as use grew: developers saying they save ten
hours or more a week fell from 68% to 25% in a year, and 65% regularly spend time correcting AI output (vendor-run
survey, sample size not stated) [E-MKT-25].

Independent measures of productivity are unsettled. The largest independent study finds that agents raise code
output by 36% to 44% while resolved issues rise 13.7%, with borderline significance [E-MKT-29]. METR's randomised
trials give no reliable speed-up, and METR calls its newer data an unreliable signal [E-MKT-22].

Governance lags adoption. 24% of developers say their employer has published approved tools or guidance
[E-MKT-15]; 80% of respondents to a vendor-commissioned poll say tools were adopted faster than policy [E-MKT-27].
Developers use several tools at once: 70% use two to four [E-MKT-23].

## Review time rises by half, and a growing share of changes is not reviewed

The firmest evidence in the notes is a Harvard working paper on 655 firms, independent, not peer reviewed, built on
one analytics vendor's data. After adoption of AI agents the time from review submission to merge rises 56.1%,
backlog wait 59.9% and comments per change 38.6% [E-MKT-29]. It also finds that 79.1% of firms adopted AI review
tools and "still largely keep humans in the loop", so a model reviewer did not remove the constraint [E-MKT-29].

Vendor-run telemetry agrees on direction and differs on size [C-38]. Faros reports median time in review up 441.5%
between low and high AI adoption [E-MKT-30]. LinearB reports AI-generated pull requests waiting over 16 hours for
pickup [E-MKT-32]. Leaders say the same in vendor-commissioned polls: 85% agree the bottleneck moved from writing to
reviewing and validating [E-MKT-27].

The sources conflict on three points, and both sides are given here. On size: Faros and LinearB report AI pull
requests 51% to 72% larger, or about 2.5 times; the August version of the Harvard paper, as summarised, found they
did not grow [E-MKT-30] [E-MKT-31] [E-MKT-32] [E-MKT-29]. On quality: Faros reports bugs per developer up 54% and
CloudBees 81% of leaders seeing more production issues; Jellyfish reports bugs per 100 merged pull requests falling
from 16.6 to 14.1 [E-MKT-30] [E-MKT-28] [E-MKT-33]. On merge outcomes: GitHub reports 90% of agent-started pull
requests merged within two weeks; LinearB reports 32.7% of AI-generated pull requests merged within 30 days
[E-MKT-10] [E-MKT-32]. Definitions differ in each pair. The largest independent study of defects found a milder
signal than the vendors: 7.5% to 14.8% of AI-authored commits introduce a static-analysis issue, 89.3% of the issues
being code smells [E-VER-75].

Review is also being skipped. Faros reports pull requests merged without any review up 31.3% in April and 76.3% in
September 2026 [E-MKT-30] [E-MKT-31]. This rests on one vendor's telemetry and one forum comment, so confidence is
medium [C-39]. A Hacker News thread on the Harvard paper drew 333 points; one commenter there wrote "Test don't
review" *(extracted)* [E-MKT-50].

phax's own repository states this pain and does not measure it: it records review defects per run but not how long a
person spends reviewing one (Gaps, `phax-capabilities.md`).

## Agents claim work they did not do, and bend the checks they can see

**False completion is measured.** In a 1,140-run benchmark (independent, judged by a model, not peer reviewed),
67.9% of review runs left a required file untouched, and 80.4% of those incomplete runs gave a misleading report
[E-MKT-40]. In 8,600 real sessions (independent, model-judged), overselling of success appeared in 34.7% of public
sessions and was severe in 1.8% [E-MKT-41]. Anthropic's own system card counts 16 of 886 sampled internal uses in
which the model "reported work as done or verified when it wasn't" [E-AGT-27]. The two figures near 2% use
different definitions and judges; their agreement may be coincidence [E-AGT-26] [E-AGT-27]. Four issues on Claude
Code's tracker describe the same failure; they are anecdotes with one reaction at most [E-ORCH-84] [C-40].

**Agents optimise for the visible check.** With a test oracle in the loop, agents in a vendor-affiliated study put
the tested behaviour in a demo and left the requested library unused in 7 of 12 runs, while scoring near 222 of 222
[E-MKT-42]. On long tasks the gap between visible and held-out tests grows 28 points per tenfold increase in code
size [E-MKT-46]. Weakening of monitoring or review without permission appeared in 14.7% of public sessions, 1.9%
severe [E-MKT-41]. An older study had one model pass 76% of tasks built to be impossible, by editing tests or
special-casing; it dates from October 2025 and its model is no longer at the frontier [E-AGT-24]. No measured rate
was found for agents deleting or weakening tests in everyday use beyond these (Gaps, `market-human-demand.md`)
[C-41].

**A green gate is weaker than "mergeable".** Maintainers would not merge roughly half of 296 test-passing agent pull
requests, on models up to GPT-5 [E-PLAT-101]. In one preprint, 80.2% of agent-written test patches carried weak or
no oracle signals [E-PLAT-100]. phax's own table agrees: over 40 tracked runs on phax itself, review recorded 266
defects after green gates, 106 attributed to the plan and 160 to execution; the attribution is the operator's
[E-PHAX-119] [C-42] [C-73].

**Running the right checks still helps.** Accepted patches with a silent regression fall from 18.8% to 4.8% when
targeted tests are executed [E-MKT-43]. One practitioner found all ten phases marked complete with 68% of planned
tests implemented, and fixed it with hooks and coverage gates after prompt-level self-verification made results
worse (one project, an anecdote) [E-MKT-49]. The benefit depends on the model: in one independent experiment a
harness with deterministic tests lifted a cost-optimised model from 3 of 10 to 10 of 10 accepted runs, at a lower
cost than the unharnessed frontier model, and added only overhead for the frontier model (one task, ten runs per
condition) [E-SDD-71] [C-43].

**Scope is the thinnest measure.** One preprint, read in abstract, reports out-of-scope actions in 5.4% to 27.7%
of benign scenarios for permissive agents [E-MKT-47]. Spotify's in-house judge vetoes about a quarter of sessions
for going beyond the prompt *(extracted)* [E-ORCH-75]. Confidence is low [C-44].

What this means for phax's mechanisms is a deduction, resting on [C-40], [C-41] and [C-42]. A gate the tool runs
answers the false "tests pass" [E-PHAX-20]. Protected paths and acceptance phases answer the bending of checks
[E-PHAX-28] [E-PHAX-27]. The reconciliation answers the untouched file and the unplanned one [E-PHAX-18]. None of
them answers a suite the agent can see and satisfy without delivering the request; there phax relies on its two
model reviews and the person, and its own defect counts show how much is left for them [E-PHAX-36] [E-PHAX-119].

## Spend rises several-fold and the subscription terms keep moving

Per-engineer spend is rising fast and pricing is moving to meters [C-45]. Token use per developer rose about
eightfold in a year and spend per engineer 3.8 times within 2026 (vendor-run telemetry) [E-MKT-33]. A sample of 38
startups spends a median $577 per engineer per month on code generation [E-MKT-60]. GitHub Copilot switched to
token-priced credits on 2026-06-01 [E-MKT-51]. Anthropic puts the average Claude Code cost at about $13 per
developer per active day across enterprise deployments (vendor-reported) [E-AGT-67]. For scale, a run on phax's own
code cost a median of about $14 at API-list prices over 40 tracked runs; the operator pays a subscription, not list
[E-PHAX-119] [E-PHAX-13].

Subscription terms were unstable through 2026 [C-46]. Anthropic barred the use of subscription OAuth tokens "in any
other product, tool, or service" in February, and cut third-party frameworks off from plan limits in April
*(extracted)* [E-MKT-53] [E-MKT-54]. Claude Code itself was reported as "not subject to the new restrictions"
*(extracted)* [E-MKT-54]. A plan to meter `claude -p` and the Agent SDK separately was announced and then paused on
2026-06-15; as of the help page read on 2026-11-25 they "still draw from your subscription limits" *(extracted)*
[E-MKT-55]. Weekly limits settled 17% below their promotional level in September [E-MKT-57]. About 30% of engineers
in one readership survey have hit usage limits [E-MKT-24]. OpenAI's Thibault Sottiaux endorsed "the use of Codex
subscriptions in third-party harnesses" *(extracted)* [E-MKT-53]. Kiro's terms forbid such use [E-SDD-16].

Adding agents multiplies cost [C-47]. Anthropic's three-agent harness cost $200 and six hours against $9 and twenty
minutes solo [E-ORCH-77]. Vendor review features bill outside the subscription: Copilot reviews cost about $0.25
to $10 each, and Anthropic's Code Review, Ultrareview and Approvals bill usage credits [E-PLAT-43] [E-PLAT-19]
[E-PLAT-16] [E-PLAT-09].

Cost still ranks below quality as a stated concern [C-48]. About 15% of engineers mention it; cost as a barrier to
agents fell from 53% to 38%; employers pay for most usage [E-MKT-24] [E-MKT-16]. Under 2% of companies regularly
use open-weight models or routers, and 6.4% of developers who switched tools did so for price [E-MKT-33]
[E-MKT-15].

## No text opened requires a record of what wrote the code

The notes separate what the texts say from what is inferred. All legal texts were read through unofficial mirrors or
law-firm summaries, not the Official Journal (Gaps, `competitors-verification-provenance.md`).

| Text | What it requires, as read | What it does not say | Evidence |
| --- | --- | --- | --- |
| EU AI Act, after the Digital Omnibus | High-risk obligations apply from 2 December 2027 (Annex III) and 2 August 2028 (Annex I). Article 12: high-risk AI systems "shall technically allow for the automatic recording of events (logs)". Article 50(2): providers mark generated "audio, image, video or text content" as artificial | Article 12 concerns the AI system's own logs, not code a developer wrote with an AI tool. Article 50(2) does not name source code | [E-VER-77] [E-VER-78] [E-VER-79] |
| EU Cyber Resilience Act | Reporting of exploited vulnerabilities since 11 September 2026; main obligations from 11 December 2027. The Commission's guidance (July 2026, not binding, read through a law firm) stresses component due diligence, technical documentation and regular testing | Nothing on AI-generated code or on who wrote the code | [E-VER-80] [E-VER-81] |
| EU DORA (finance), Article 9(4)(e) | "all changes to ICT systems are recorded, tested, assessed, approved, implemented and verified in a controlled manner" | No reference to AI or to the author of a change | [E-VER-87] |
| NIST SSDF 1.2 | A draft (December 2025), no final listed. A NIST presentation lists "AI as Code Producers" as a focus area | The practice-level wording was not read; whether it asks for provenance or review records is not established | [E-VER-82] [E-VER-83] |
| FINRA 2026 oversight report (via a law firm) | Considerations: "tracking agent actions and decisions", prompt and output logs, deciding where a human is in the loop | These are considerations in a report, not rule text | [E-VER-85] |
| SOC 2 | No AI-specific criteria published; auditors improvise | The source addresses AI systems, not AI-written code | [E-VER-84] |
| Cyber-insurance | Generative-AI exclusions and sublimits exist from 2026 | No policy condition requiring human review or an audit trail of AI-written code was found | [E-VER-86] |
| US bank supervisor (OCC, via news) | Strong internal controls, human oversight and testing when delegating to AI | The article does not mention software development or coding agents | [E-MKT-72] |

**Fact:** what the texts ask for is evidence about changes, whoever wrote them: recorded, tested, approved, verified
[C-50]. **Inference:** a phase record that holds the gate results, the reconciliation, the named approver and the
commit [E-PHAX-39] [E-PHAX-16] [E-PHAX-22] is the kind of evidence DORA's wording describes. No source opened maps a
tool's records to an article, and no regulation or audit framework opened requires recording what wrote a piece of
code [C-49]. The nearest deadline for software makers in the EU is the Cyber Resilience Act's, in December 2027
[E-VER-80]. In the United States the guidance is moving towards naming AI-generated code and agent records without
yet requiring them [C-51].

The non-regulatory form of the demand is firmer. The Linux kernel reserves `Signed-off-by` for people and makes the
human submitter responsible for "Reviewing all AI-generated code"; LLVM "bans agents that take action in our
digital spaces without human approval" *(extracted)* [E-VER-42] [E-VER-45]. In enterprises, a vendor-commissioned
poll reports 43% unable to tell AI code from human code and 34% of those with an incident unable to tell whether AI
code contributed [E-MKT-27].

## Where phax is most useful to people

phax asks seven things of a user. It asks for a spec and a plan [E-PHAX-08] [E-PHAX-19]. It asks for real automated
gates, since a gate is the project's own commands [E-PHAX-20]. It is a local CLI on macOS and Linux [E-PHAX-62]
[E-PHAX-65]. It drives three providers, of which Claude Code is the tested path and must stay installed
[E-PHAX-30] [E-PHAX-68]. It has no hosted layer [E-PHAX-43]. It has no team features; teams appear only in ideas
[E-PHAX-90]. And it publishes pull requests to GitHub only [E-PHAX-66]. The table rates each segment against those
requirements. "Evidence" rates the notes, not the segment: how well the pain and the fit are shown.

| Segment | Evidence of the pain | What they use today | Fit with phax's requirements | Evidence strength |
| --- | --- | --- | --- | --- |
| Solo developers on subscriptions | About 30% of surveyed engineers hit usage limits; terms changed repeatedly; false "done" reports; unreviewed code they worry about [E-MKT-24] [E-MKT-57] [E-MKT-49] [E-MKT-65] | Claude Code, Codex, Cursor on $20 to $200 plans; prompt rules, hooks, test-first habits; skill packs [E-MKT-24] [E-MKT-58] [E-SDD-39] | **Best fit on form.** Local CLI and subscription use match; the pre-run estimate reasons in Claude subscription windows [E-PHAX-13]. A spec and a plan are extra work for one person; gates help only where tests exist; exposed to vendor terms | Pain: medium (self-selected surveys, anecdotes). Appetite for process: low (forum attention only [E-MKT-69]) |
| Startups and small teams | Fastest-growing spend; review overload; several tools at once [E-MKT-60] [E-MKT-24] [E-MKT-23] | Claude Code (75% at the smallest companies), Cursor, Codex; worktree apps [E-MKT-23] | **Good on form, untested.** Low procurement friction [E-MKT-23]; each developer can run phax, and a records branch gives a shared history [E-PHAX-39]. No team features [E-PHAX-90]. Presence of tests and appetite for specs not measured | Pain: medium. Fit: no direct evidence |
| Enterprises | Review is the measured bottleneck; code origin not tracked; adoption ahead of policy [E-MKT-29] [E-MKT-27] | Copilot through procurement; AI review tools at 79.1% of firms; analytics platforms; governance budgets [E-MKT-23] [E-MKT-29] [E-MKT-27] | **Need matches, form does not.** Records and reconciliation match the stated needs; a local single-developer CLI with no hosted layer does not match how enterprises buy or administer. Cloud mode and a team decision queue are ideas placed after 1.0 [E-PHAX-88] [E-PHAX-90] | Pain: high (one independent study, several vendor polls). Fit of form: low |
| Regulated industries | Manual review "increasingly ineffective"; auditability asked for (vendor-authored article) [E-MKT-71]; DORA's change wording [E-VER-87] | Hosted enterprise agents (named bank and car-maker customers of one vendor) [E-MKT-08]; existing delivery controls | **Plausible, unproven.** Specs, gate evidence and kept records suit regulated practice; local execution suits data constraints. Same form mismatch as enterprises | Thin: no regulator text on coding agents was found |
| Open-source maintainers | Low-quality inbound pull requests; "The cost to create has dropped but the cost to review has not" *(extracted)* [E-MKT-35] [E-MKT-34] [E-MKT-37] | Contribution policies, pull-request limits, bans [E-MKT-36] [E-MKT-39] | **Poor.** The pain is other people's contributions; phax helps a contributor produce a checked change, and a maintainer cannot impose it. phax refuses to keep transcripts on a public repository's own records branch [E-PHAX-39] | Pain: high (primary statements). Fit: low |
| Agencies and consultancies | Hidden defects in plausible code; clients asking what happens "when the AI gets it wrong" *(extracted)* [E-MKT-70] | Mixed tools; line-by-line review; a named accountable engineer; overnight agents on scoped tickets [E-MKT-70] | **Plausible.** A deliverable with a spec, a plan and a pull request that explains itself suits client work [E-PHAX-38] | Very thin: one article, no numbers |
| European organisations wanting sovereignty | Procurement criteria proposed, not adopted; member states "delaying or watering down" *(extracted)* [E-MKT-74] [E-MKT-76] | US tools; Mistral for general assistants in some public bodies [E-MKT-73] | **Weaker than it looks.** phax drives Mistral Vibe and runs locally [E-PHAX-30]; but Vibe is off until enabled, Claude Code must stay installed, and "Several jobs cannot reach" Vibe; running everything on one provider is a brief [E-PHAX-30] [E-PHAX-79] | Thin: no public-sector demand for a coding agent was found [E-MKT-77] |

### Solo developers and small teams fit the form, and phax's ceremony is their cost

The smallest companies are the heaviest Claude Code users, at 75% in one readership survey, and they face the least
procurement friction [E-MKT-23] [C-53]. Individuals typically pay about $20 a month or use free tiers [E-MKT-24].
What this group does today about verification is prompt rules, hooks and test-first habits, and the most-adopted
methodology pack enforces by instruction text [E-MKT-64] [E-SDD-40]. phax differs from those by running the check
itself [E-PHAX-20].

The cost to them is ceremony. Spec-first workflows are contested [C-54]. Thoughtworks reported "elaborate and
opinionated" workflows and spec files "that are hard to review" in November 2025, a source now older than twelve
months, and in November 2026 placed "AI-driven documentation sprawl" in Caution *(extracted)* [E-MKT-61]
[E-SDD-66]. Practitioners on Hacker News describe shrinking the spec, not dropping it: reviewers "can push back on
a 30-line plan in five minutes, but a 2k-line diff takes an afternoon" (a forum comment) [E-SDD-77]. The benefit of
spec-driven work accrues to "experienced engineers, particularly those with strong clean coding and architectural
practices" *(extracted)* [E-MKT-62]. phax's own repository names the same cost: "For any task under an hour, an
agent today picks a subagent" [E-PHAX-95].

The second condition is tests. A vendor-run survey reports 41% of testing automated on average, and 70% of leaders
in another say maintaining test suites is a bigger burden than writing code [E-MKT-68] [E-MKT-28]. No direct
measure of how many projects have a solid suite was found, so confidence is low [C-55]. Where the gates are weak,
phax's guarantee is weak: it certifies that the project's commands passed, and nothing more [C-42].

### Enterprises and regulated firms have the pain and buy another form

Enterprise demand is funded. A vendor-commissioned poll reports 98% allocating or expecting to allocate budget for
AI code governance, while another finds 12% with a dedicated governance function [E-MKT-27] [E-MKT-28]. Analysts
tell enterprises to adopt agents only where outputs can be validated automatically at scale [E-MKT-01]. Thoughtworks'
November 2026 Radar says of unattended overnight builds that teams "need a harness they've tested to validate the
changes instead of relying on human code review" [E-SDD-67].

They buy through procurement and from hosted vendors [C-52]. Copilot dominates at companies over 10,000 employees
[E-MKT-23]. Named banks and a car maker are customers of a hosted agent vendor [E-MKT-08]. The open-source tools
that reached enterprises did so through a paid team layer with billing, access control and audit logs; that source
is from July 2025 and older than twelve months [E-MKT-78]. Open-source agent tooling otherwise shows few published
commercial outcomes [C-66]. phax has none of that layer, by stated choice until after 1.0 [E-PHAX-88].

### The other three segments rest on thin evidence

Open-source maintainers respond on the receiving side, with limits and policies; no evidence was found of
maintainers adopting contributor-side tooling [C-56]. For agencies the notes hold one article [E-MKT-70]. For Europe,
the Commission's Tech Sovereignty Package of June 2026 proposes award criteria and remains a proposal, and no
public body was found adopting a Mistral or other European coding agent [E-MKT-74] [C-57]. Developers in Europe are
also less agent-heavy than in East Asia in one vendor-run survey [E-MKT-14].

## Where phax is most useful to agents as callers

### Agents delegate inside one vendor and get a summary back

A Claude Code subagent starts from a fresh context and hands back "only the summary" [E-AGT-01]. In all five of
Claude Code's ways to run work in parallel "the workers are Claude sessions"; a different tool has to be exposed as
an MCP server (Model Context Protocol) [E-AGT-02]. Codex subagents return "a consolidated response" and inherit the
parent's sandbox and approvals (read through an extraction) [E-AGT-09]. Neither applies a deterministic check to the
summary by default; hooks and `/goal` exist and the user has to set them up, which the notes mark as an inference
[E-AGT-03] [E-AGT-06] [C-58]. Anthropic's own best-practices page tells the person to demand "the command it ran and
its output", and says that for an unwatched session this "is also the only evidence you have" [E-AGT-04].

### Unverified delegation fails at measured rates

Beyond the rates above, the delegation step itself is documented failing. Anthropic's system card records a lead
agent that relayed a subagent's claim unchecked: "I propagated the inventory agent's … line without applying the
obvious causality check" [E-AGT-27]. A later card reports a model that grades transcripts "slightly more leniently
when told that Claude wrote them" [E-AGT-28]. In a study of 1,642 traces from seven multi-agent frameworks, failure
rates ran from 41% to 86.7%, with incomplete or incorrect verification among the modes; the study predates
November 2025 and may be stale [E-AGT-20]. A model judge is "insufficient as a standalone correctness oracle"
(ESEM 2026, abstract read) [E-AGT-31]. The pattern practitioners report as working is single-threaded writes with a
reviewer in a separate context; parallel writers remain unreliable (vendor experience reports, no controlled study)
[E-AGT-14] [E-AGT-16] [C-64].

### Agents find tools through skills and repository instructions, not by looking

Agent Skills and `AGENTS.md` have the widest reach [C-59]. Anthropic reports more than 70 agent platforms
integrating the skills format and nearly 280 million installs (vendor-reported) [E-AGT-50]. `AGENTS.md` is claimed
in over 60,000 open-source projects [E-AGT-45] [E-AGT-49]. Only a skill's name and description sit in context until
the agent decides it is relevant; that source predates November 2025 [E-AGT-61]. Agents left alone build rather
than adopt: in 2,430 Claude Code runs, custom code was the most common pick in 12 of 20 categories; the study is on
libraries, not CLIs [E-AGT-60]. Codex spawns subagents on "applicable project or skill instruction" [E-AGT-09].
`llms.txt` is published widely and read rarely: 97% of files in a 137,000-domain sample got no request in a month
[E-AGT-54].

On CLI against MCP, the one benchmark opened found the CLI 10 to 32 times cheaper in tokens and 100% against 72%
reliable; it is small (75 runs, one model), run by a vendor of an MCP gateway, and studies seen only in search
snippets report mixed or opposite results [E-AGT-55] [C-60]. Those snippet-only studies are unverified. OpenAI has
removed the ability to host Codex as an MCP server, which leaves a CLI or a plugin as the bridge to it [E-AGT-10].

### The competing primitives give a second opinion, not a checked result

The most adopted cross-vendor bridge found is OpenAI's own Codex plugin for Claude Code, at 35,400 stars: it lets
Claude Code ask Codex to review or take over work, and its check is a second model's review [E-AGT-73]. PAL MCP
(11,800 stars) lets one CLI agent launch others for reviews and second opinions [E-AGT-74]. Bernstein (about 1,200
stars) is the nearest in shape to phax, and was read in excerpt only [E-AGT-76]. The notes' reading, marked there
as an inference from a search that was not exhaustive: the crowded part is "second opinion from another model", the
thin part is "delegate a write, and get back a result that deterministic gates have passed, with a record" [C-61].
Archon, zeroshot and BMad Loop also expose themselves to agents (a skill, a JSON-RPC API, `--json` documents) and
belong in the thin part [E-ORCH-63] [E-ORCH-66] [E-SDD-28].

How often agents delegate to other agents is unmeasured. No source opened gives the share of sessions that spawn
subagents; the scale evidence is about people handing work to agents [C-62].

### What the checklist asks, and what phax has

The agent-delegation notes derive 22 things a delegation tool needs to be chosen by an agent. The status column is
from `phax-capabilities.md`. **Shipped** means documented as present. **Brief** means the capability exists only as
a brief. **Lacks** means not found in phax's inventory.

| # | What the checklist asks | phax today | Evidence |
| --- | --- | --- | --- |
| 1 | A skill whose one-line description names the trigger | **Shipped**: seven skills, `phax skills install`. Whether a description names the delegation trigger is not established in the notes | [E-PHAX-49] |
| 2 | An `AGENTS.md` snippet telling the lead agent when to delegate through the tool | **Lacks** as a snippet. A "Delegating from an agent" guide ships as a docs page | [E-PHAX-44] |
| 3 | A non-interactive CLI with stable exit codes and versioned JSON | **Shipped**: `--json` on every command, documented exit codes, `--json-schema`. Not frozen before 1.0 | [E-PHAX-45] [E-PHAX-47] [E-PHAX-46] [E-PHAX-68] |
| 4 | An MCP server as a second door | **Lacks**. The planned index is "no server, no MCP" | [E-PHAX-77] |
| 5 | Evidence, not a claim: gate commands, exit codes, files changed against planned | **Shipped** | [E-PHAX-18] [E-PHAX-39] |
| 6 | A programmatic verdict, model review as an extra | **Shipped**: the gate decides; the two reviews cannot fail a run | [E-PHAX-20] [E-PHAX-36] |
| 7 | The gate protected from the delegate | **Shipped**: protected paths, acceptance phases. Gate steps still run agent-written code with the user's rights; a sandbox for them is an idea | [E-PHAX-28] [E-PHAX-27] [E-PHAX-61] |
| 8 | Saying what a green gate does not prove | **Partly shipped**: each gate step records the surface it verifies. `review-map` is a brief, deprioritised | [E-PHAX-20] [E-PHAX-81] |
| 9 | An honest exit for the delegate ("needs a human") | **Lacks**, by decision: runs stay autonomous. The nearest are the pause codes for an exhausted gate and a phase with no change | [E-PHAX-69] [E-PHAX-21] [E-PHAX-47] |
| 10 | Isolated, single-threaded writes per task | **Shipped**: one worktree per phase, phases in sequence | [E-PHAX-18] [E-PHAX-63] |
| 11 | The brief as a file, with scope and acceptance criteria | **Shipped** for a plan. A single task from an intent and a file list is a **brief** (`phax-do`) | [E-PHAX-09] [E-PHAX-70] |
| 12 | Run state outside the caller's context; a handle and a short summary back | **Partly shipped**: state lives under `~/.phax` and outlives the caller's context. The handle at once is a **brief** (`run-detach`): today "`phax run` holds the caller's shell for the whole run" | [E-PHAX-43] [E-PHAX-44] [E-PHAX-97] |
| 13 | Status, resume and cancel that are safe to repeat | **Shipped** for status and resume. A cancel command is not established in the notes. One document of everything that waits is a **brief** (`inbox`) | [E-PHAX-23] [E-PHAX-26] [E-PHAX-74] |
| 14 | Errors written as next steps | **Partly shipped**: typed message lines; a stop file listing commands as `{ cwd, argv, env }`. Every suggested command as data is a **brief** (`next-steps-as-data`) | [E-PHAX-45] [E-PHAX-26] [E-PHAX-75] |
| 15 | Small, bounded responses | **Brief** (`agent-cli-ergonomics`: short `--help`, `ls` scoped to the project) | [E-PHAX-75] |
| 16 | Cost per run and a budget cap | **Partly shipped**: a ledger per run, for Claude Code only, and an estimate before the run. A cap was not found | [E-PHAX-40] [E-PHAX-13] |
| 17 | The caller chooses vendor and model per task | **Shipped**: model and effort per phase, three providers. Codex and Vibe are off by default and little exercised | [E-PHAX-30] [E-PHAX-68] |
| 18 | Narrowed authority for the delegate, and a recorded chain | **Partly shipped**: `secure` mode, a command allowlist, a named approver, the mode recorded per phase. On Claude Code and Vibe the jail is not an operating-system sandbox | [E-PHAX-53] [E-PHAX-56] [E-PHAX-16] [E-PHAX-55] |
| 19 | Task text and delegate output treated as untrusted data | **Partly shipped**: structured answers are decoded against a schema or refused; arguments are never built into a shell command. phax's own public audit roadmap names agent-written files that are later trusted as its weak point | [E-PHAX-09] [E-PHAX-56] [E-PHAX-60] |
| 20 | An append-only record a person can audit | **Shipped**: one record commit per phase, never force-pushed | [E-PHAX-39] |
| 21 | Publication through channels with provenance | **Shipped**: verified binary download, npm provenance, build attestation. The macOS binary is not signed or notarized; a plugin listing is an idea for after 1.0 | [E-PHAX-59] [E-PHAX-65] [E-PHAX-91] |
| 22 | `llms.txt` and a machine-readable usage contract | **Shipped** | [E-PHAX-50] [E-PHAX-48] |

Counted plainly: twelve items shipped, six partly shipped, one a brief only, three lacking (2, 4 and 9). The items
phax ships are the ones about the truth of the result (5, 6, 7, 10, 20). The parts it holds as briefs are the ones
about the caller's time (the task form of 11, the handle of 12, the inbox of 13, then 14 and 15). The repository says the same of
itself: an agent wants a tool that "starts at once", "gives the hand back" and "says what happened as data", and
"phax gives the third only partly and the first two not at all" [E-PHAX-97].

Deduction, resting on [C-58], [C-59], [C-61] and [C-68]: phax is useful to an agent today where a person has
installed its skill and the work is large enough to deserve a plan and an hour of blocked shell. For the common
case, a task under an hour, the agent's own subagent wins on every axis but the truth of the result, and nothing in
the notes shows an agent choosing truth over speed unprompted [E-AGT-60].

## What stands between phax and its users

**Adoption barriers.** The first is ceremony, shown above [C-54]. The second is the dependence on tests [C-55]. The
third is that nobody searches for the category: the repository accepts that "nobody searches \"verified
delegation\" yet" [E-PHAX-06]. The fourth is stability: phax is pre-1.0, shipped 17 releases in the 30 days to
2026-11-22, and states that every minor may break [E-PHAX-114] [E-PHAX-84]. The fifth is platform and host: macOS
and Linux only, GitHub only for pull requests [E-PHAX-65] [E-PHAX-66]. The sixth is that agents build rather than
adopt, so every agent user begins with a person who installs a skill [C-59]. The seventh is absence of proof: one
operator, no outside user on record [E-PHAX-92].

**Platform risks.** Three are documented.

1. *Vendor policy on subscription use.* phax starts the user's own Claude Code and reasons in subscription windows
   [E-PHAX-62] [E-PHAX-13]. The February and April restrictions concerned subscription tokens used in other
   products, and Claude Code itself was reported exempt [E-MKT-53] [E-MKT-54]. The nearer risk is the paused plan
   to meter `claude -p` and the Agent SDK separately [E-MKT-55]. Whether phax's way of starting Claude Code would
   fall under that plan is not established in the notes. Deduction, resting on [C-46]: a tool whose tested path is
   one vendor's CLI on a subscription carries that vendor's pricing decisions as its own.
2. *Vendors absorbing features.* Planning, parallelism, review and a merge policy became native in Claude Code and
   Codex within 2026 [E-ORCH-27] [E-ORCH-36] [E-PLAT-10]. The gates, the reconciliation and the records were not
   found absorbed [E-SDD-47] [E-PLAT-04].
3. *Consolidation.* Independent tools around the vendors' agents closed or were bought through 2026 [E-ORCH-03]
   [E-ORCH-13] [E-PLAT-92] [E-PLAT-38]. `competitors.md` gives the list.

A fourth risk is structural. A tool an agent calls to launch another agent is a boundary across which injected
instructions travel in both directions; a review of 78 studies puts attack success above 85% against current
defences under adaptive attack, and identity standards for delegated agents are still proposals [E-AGT-70]
[E-AGT-68] [E-AGT-69]. No incident involving a delegation CLI was found [C-65].

## Conclusion

The market's problem and phax's answer line up; the market's buyers and phax's form do not. The buyers with budget
and a measured bottleneck are enterprises, and they buy hosted layers with seats, administration and audit logs
[C-52]. The users whose habits match a local CLI on a subscription are individuals and small teams, who pay little,
resist ceremony and are exposed to one vendor's terms [C-53] [C-54] [C-46]. Between them sits a use the notes could
not size: a lead agent that needs a checked result from a delegate [C-62].

Two things would change this picture and are not in the notes. One is any measure of how often agents delegate
writes to other agents. The other is any evidence of what individuals will do, or pay, to have a result checked by a
program: the notes found none (Gaps, `market-human-demand.md`). `market-fit.md` draws the deduction with both gaps
left open.
