# phax fits a proven problem, unproven users

> Checked on 2026-11-25 against phax 0.43.0 (`package.json`; latest tag `v0.42.0`). Ids in square brackets
> resolve to the files under [`evidence/`](evidence/): `E-…` is an evidence item in the notes, `C-nn` is a claim in
> [`claims.md`](claims.md). Nothing here comes from outside those notes. A sentence that starts with **Deduction**
> is a reading of the evidence, and names the claims it rests on; every other sentence states what an evidence item
> holds. Quotes marked *(extracted)* were read through a fetch tool's extraction. Capabilities are marked
> **shipped**, **approved**, **brief** or **idea**, as in `evidence/phax-capabilities.md`.

**Deduction** (from [C-74], [C-75], [C-76], [C-77] and [C-72]): phax has a strong fit with the problem and no
evidence yet of a fit with a market. The problem is as well shown as anything in this study: review became the
measured bottleneck after agents arrived [C-38], agents report work they did not do [C-40], and they satisfy the
checks they can see [C-41]. phax's answer (a gate a program runs, a scope check, a judge kept apart from the maker,
a record in the user's Git) is rare among the tools opened and matches what the best-documented in-house systems
built for themselves [C-09] [C-33]. The fit is strongest today for one kind of user: a developer or small team that
already has automated checks worth trusting, works on Claude Code under a subscription, and hands agents changes
large enough to deserve a plan [C-75]. That is a description of the operator, who is the only user on record
[C-72]. For agents as callers the fit today is partial: phax returns checked facts and makes the caller wait an hour
for them [C-68]. It becomes a real answer to "a subagent's done is a claim" only once two briefs are done, the
one-task mode and the detached run [C-69] [C-76]. The largest threat is not a rival tool. It is that the vendor phax
depends on most turns its opt-in hooks into a default, or re-prices headless use, before phax has a second user
[C-79].

## The problem is shown by independent measurement

phax describes its problem in two sentences. To a person: "You get a 40-file diff and a pat on the back, and now
it's *your* job to figure out whether any of it is right" [E-PHAX-94]. To an agent: "A subagent's \"done\" is a
claim, though: nothing checked the gate, nothing compared what it touched with what it meant to touch, nothing is
kept" [E-PHAX-95]. The market notes test each part.

| Part of the problem | Best evidence | Kind | Strength |
| --- | --- | --- | --- |
| Review, not writing, limits delivery | Review-to-merge time up 56.1% after agents, 655 firms [E-MKT-29]; vendor telemetry agrees on direction [E-MKT-30] [E-MKT-32] | Independent working paper, not peer reviewed; vendor-run telemetry | High [C-38] |
| "Done" is a claim | Severe overselling in 1.8% of 8,600 real sessions [E-MKT-41]; 16 of 886 internal uses "reported work as done or verified when it wasn't" [E-AGT-27]; 80.4% of incomplete benchmark runs misreport [E-MKT-40] | Two independent studies judged by a model; one vendor system card | Medium [C-40] |
| An agent judging its own work passes it | "agents reliably skew positive when grading their own work" *(extracted)* [E-ORCH-77]; visible tests satisfied without the requested behaviour in 7 of 12 runs [E-MKT-42] | Vendor engineering post; vendor-affiliated study | High [C-41] |
| Nothing compared what it touched with what it meant to touch | Out-of-scope actions in 5.4% to 27.7% of benign scenarios [E-MKT-47]; Spotify's judge vetoes about a quarter of sessions for exceeding the prompt *(extracted)* [E-ORCH-75] | One preprint read in abstract; one company's self-report | Low [C-44] |
| Nothing is kept | 43% cannot tell AI code from human code; 34% of those with an incident could not tell whether AI code contributed [E-MKT-27] | Vendor-commissioned poll of enterprises | Medium, and only for enterprises [C-52] |
| Babysitting defeats delegation | 63% rarely or never let agents run on autopilot [E-MKT-16] | Vendor-run pulse survey, 1,100 respondents | Medium [C-37] |

**Deduction** (from [C-38], [C-40], [C-41] and [C-09]): the problem exists, and the remedy phax chose has outside
support. Thoughtworks placed unattended overnight builds in Trial in November 2026 on three prerequisites, "sandboxed
execution, work specified up front as in spec-driven development and feedback sensors", and wrote that teams "need a
harness they've tested to validate the changes instead of relying on human code review" [E-SDD-67]. Stripe and
Spotify built the same shape in-house [E-ORCH-73] [E-ORCH-75]. Anthropic's own posts say that separating the
generator from the evaluator "proves to be a strong lever" *(extracted)* [E-ORCH-77].

The evidence also bounds the remedy. A green gate does not mean a mergeable change: maintainers would not merge
about half of 296 test-passing agent pull requests [E-PLAT-101]. phax's own runs show it: 266 review defects after
green gates over 40 tracked runs, about 6.7 a run (my division), 106 attributed to the plan and 160 to execution
[E-PHAX-119]. And a gate's value depends on the model: in one experiment deterministic tests lifted a cheaper model
from 3 of 10 to 10 of 10 accepted runs and added only overhead for the frontier model (one task, ten runs per
condition) [E-SDD-71]. No study was found that compares defect rates after a gated workflow with an ungated one
(Gaps, `competitors-verification-provenance.md`). The problem is proven; that phax's remedy reduces a person's
review time is not, and phax does not measure it (Gaps, `phax-capabilities.md`).

## Where the fit is strongest today

The two rankings in this section are deductions, resting on [C-75] and [C-76]. Each entry gives its evidence first,
then the deduction it supports.

### People, ranked

**1. A developer or small team with real gates, on Claude Code under a subscription, delegating plan-sized
changes.** Everything phax requires is already true of this user. phax is a local CLI that starts the agent CLI
already installed [E-PHAX-62]. Claude Code is its default, its fallback and its only tested path [E-PHAX-30]
[E-PHAX-68]. Its estimate answers "will it stop halfway because a window ran out?" in Claude subscription windows
[E-PHAX-13]. The market side supports the description: the smallest companies are the heaviest Claude Code users
(75% in one readership survey) and face the least procurement friction [E-MKT-23]; about 30% of engineers in the
same readership have hit usage limits [E-MKT-24]; Claude Code rose from 18% to 39% of professional developers in
half a year (vendor-run survey) [E-MKT-13]. **Deduction** (from [C-53], [C-46] and [C-70]): this is the segment
where phax's constraints cost nothing and its one subscription-specific feature has a reader. The evidence that
this user wants a spec and a plan is weak [C-54].

**2. The same user on a team that shares a repository.** A records branch pushed to the shared repository gives the
team a history of each phase without any server [E-PHAX-39]. Process and code can sit in two repositories
[E-PHAX-17]. phax has no other team feature; teams appear only in ideas [E-PHAX-90]. **Deduction** (from [C-53] and
[C-71]): the fit is on form only; nothing in the notes shows a team using phax.

**3. A shop that owes a client or an auditor an account of each change.** A pull request that names its plan, its
spec, its compliance verdict and its findings suits a deliverable [E-PHAX-38]. A named approver and decisions on the
record suit an audit [E-PHAX-16] [E-PHAX-10]. DORA asks that changes be "recorded, tested, assessed, approved,
implemented and verified in a controlled manner" [E-VER-87]. **Deduction** (from [C-50] and [C-49]): the match is an
inference; the evidence for agencies is one article [E-MKT-70] and no regulator text on coding agents was found.

### Agents, ranked

**1. A lead agent in that user's session, handing over a change that deserves a plan (shipped today).** The
repository says "an agent is already phax's most frequent caller" and that "the operator drives phax by talking to
Claude Code, which calls the CLI" [E-PHAX-07] [E-PHAX-101]. No count by caller type was found (Gaps,
`phax-capabilities.md`). The surface for this caller ships: `--json` on every command, documented exit codes, a
contracts catalogue, seven skills, a delegating guide [E-PHAX-45] [E-PHAX-47] [E-PHAX-46] [E-PHAX-49] [E-PHAX-44].
What the caller gets back is what vendor docs tell people to demand, "the command it ran and its output"
[E-AGT-04], plus the files changed against planned [E-PHAX-18]. What it pays is its own time: "`phax run` holds the
caller's shell for the whole run (an hour is common)" [E-PHAX-97].

**2. A script or loop acting under a machine grant (shipped today, no use on record).** An approval can name
`--by machine:<grant>`; a verdict on an open question always comes from the operator [E-PHAX-16]. No evidence of
such use was found in the notes.

**3. A lead agent handing over a task under an hour (only once `phax-do` and `run-detach` are done).** Today "an
agent today picks a subagent: it starts at once, with no spec, no plan, no lint and no approval" [E-PHAX-95].
Native delegation returns a summary with no deterministic check on it [C-58]. **Deduction** (from [C-58], [C-61]
and [C-69]): this is the case the market evidence describes most directly, and phax does not serve it yet.

**4. A lead agent that wants a choice proved by a test (only once `do-attempts` is done).** Selecting among parallel
attempts with tests has research support, one item of which is older than twelve months; shipped best-of-N products
select with a model judge and publish no measured gain [E-AGT-42] [E-AGT-43] [E-AGT-17] [C-63].

**Deduction** (from [C-59] and [C-62]): in all four cases the buyer is still a person. Agents left alone build
rather than adopt [E-AGT-60], so an agent reaches phax only where someone installed its skill or named it in the
repository's instructions. How often agents delegate writes to other agents is unmeasured, so the size of this use
cannot be read from the notes.

## Where the fit is weak, and why

The middle column is a deduction, resting on [C-77]; the last column gives the evidence for each row.

| User | Why the fit is weak | Evidence |
| --- | --- | --- |
| Enterprises | They have the measured pain and the budget, and they buy through procurement, with seats, administration and audit logs. phax has no hosted layer and no team features; cloud mode and a decision queue are ideas placed after 1.0 | [E-MKT-27] [E-MKT-23] [E-PHAX-43] [E-PHAX-88] [E-PHAX-90] [C-52] |
| Projects without a test suite worth trusting | A gate is the project's own commands; phax certifies that they passed and nothing more. A vendor-run survey puts automated testing at 41% on average (low confidence) | [E-PHAX-20] [E-MKT-68] [C-55] |
| Open-source maintainers | Their pain is inbound contributions; they answer with limits and policies on the receiving side | [E-MKT-36] [E-MKT-39] [C-56] |
| Users of other agents | phax drives Claude Code, Codex and Mistral Vibe only. Copilot dominates at companies over 10,000 employees; Kiro's terms forbid third-party automation; BMad Loop mixes six CLIs | [E-PHAX-30] [E-MKT-23] [E-SDD-16] [E-SDD-28] |
| Anyone who wants "all on Mistral" today | Vibe is off until enabled, Claude Code must stay installed, and several jobs cannot reach Vibe; `single-provider` is a brief | [E-PHAX-30] [E-PHAX-79] |
| Windows users; GitLab or Bitbucket users | Targets are macOS and Linux; `publish-pr` needs GitHub | [E-PHAX-65] [E-PHAX-66] |
| Users who need a stable contract now | Pre-1.0; 17 releases in the 30 days to 2026-11-22; every minor may break | [E-PHAX-114] [E-PHAX-84] [C-71] |
| Teams that have dropped human review | phax ends every run open for a person's review. OpenAI's harness team and StrongDM moved review to agents or forbade it | [E-PHAX-03] [E-ORCH-78] [E-ORCH-80] |
| Small tasks, for people as for agents | A run needs an approved, fresh plan. Practitioners report shrinking specs; Thoughtworks put documentation sprawl in Caution | [E-PHAX-19] [E-SDD-77] [E-SDD-66] [C-54] |

## Which differentiators are rare and wanted

What phax ships is summarised in [C-67]. "Rare" rests on the competitor notes and is always an absence in the
sources opened. "Wanted" rests on the market
notes. The third column says how firm the second is.

**Rare, with evidence that it is wanted**

| Differentiator (status) | Rare because | Wanted because | Firmness of "wanted" |
| --- | --- | --- | --- |
| A gate the tool runs before every commit, on by default (shipped) [E-PHAX-20] | Elsewhere a gate is a hook the user writes or a step the author declares [C-04] [C-05] | Thoughtworks' Trial blip; Stripe and Spotify; a practitioner who found deterministic checks beat prompt-level self-checks; regressions down from 18.8% to 4.8% when tests are run [E-SDD-67] [E-ORCH-73] [E-MKT-49] [E-MKT-43] | High for the mechanism; none for phax's packaging of it |
| The judge kept out of the maker's reach: protected paths, acceptance tests judged by a program (shipped) [E-PHAX-28] [E-PHAX-27] | Elsewhere the separate judge is a second model [C-24] | Agents edit tests and special-case evaluators when they can; Anthropic's harness bans editing tests; at Spotify "The agent doesn't know what the verification does and how" *(extracted)* [E-AGT-24] [E-AGT-40] [E-ORCH-75] | High, with one stale source |
| Evidence returned to the caller in place of a summary (shipped) [E-PHAX-04] | Native delegation returns a summary; bridges return a second opinion [C-58] [C-61] | Vendor docs tell people to demand the command and its output; a lead agent relaying a false claim is documented [E-AGT-04] [E-AGT-27] | Medium: the need is shown, an agent's choice of it is not |

**Rare, with indirect or no evidence that anyone wants it**

| Differentiator (status) | Rare because | What the notes hold on demand |
| --- | --- | --- |
| Planned-versus-touched reconciliation (shipped) [E-PHAX-18] | Not found in any tool opened [C-22] | Indirect: Spotify's scope judge; one preprint on out-of-scope actions; a prototype in which recording intent against effects exposed 90% of 49 reward-hacking runs [E-ORCH-75] [E-MKT-47] [E-AGT-34]. No user was found asking for it |
| Plan lifecycle with staleness and recorded approval (shipped) [E-PHAX-08] | Not found [C-23] | Stale specs are a recognised weakness of spec-driven work [E-SDD-65] [E-SDD-59]; but the ceremony it adds is the cluster's main criticism [C-54] |
| Finding ids and fates in Git (shipped, 0.40.0) [E-PHAX-37] | Rare [C-25] | GitHub added resolution reasons to Copilot review in August 2026, with product feedback as the stated purpose [E-VER-16]. No demand evidence found |
| Per-phase records in the user's Git (shipped) [E-PHAX-39] | Gate results in Git not found; sessions in Git exist (Entire), and Fabro commits each stage's file changes [C-26] | Investors funded the record ($60 million for Entire) [E-VER-30]; enterprises say they lack origin tracking and buy hosted [E-MKT-27]. No regulation requires it [C-49] |
| Cost estimate before a run, in subscription windows (shipped) [E-PHAX-13] | Not found for a plan [C-27] | Limits are a real friction [C-46]; cost ranks below quality and few switch tools on price [C-48]. The estimate also needs 60 sized phases of history, so a new user has none [E-PHAX-13] |
| Versioned schemas on every persisted file (shipped) [E-PHAX-41] | Not found as a promise on every answer [C-29] | Practitioner guidance asks for it, in a source older than twelve months [E-AGT-58]. No demand evidence found |
| Mistral Vibe as a provider (shipped, off by default) [E-PHAX-30] | Not found in other cross-vendor layers (low confidence) [C-28] | No public-sector adoption of a European coding agent was found [C-57] |

**Already commodity**

| Capability | Why it no longer sets phax apart |
| --- | --- |
| A Git worktree per unit of work | The default isolation unit across local tools; every major vendor also ships isolated cloud execution [E-ORCH-53] [E-PLAT-04] |
| Several providers and a model per step | BMad Loop, zeroshot, Archon, Fabro and the host layers do it; phax's own draft says "that part isn't new" [C-28] [E-PHAX-94] |
| A plan approved by a person before code | Native plan modes in Claude Code, Codex and Cursor [E-SDD-44] [E-SDD-50] [E-SDD-48] |
| A model code review | A crowded, funded cluster; nothing shows phax's review finds more [C-06] |
| A headless JSON interface | `claude -p`, `codex exec --json`, Cursor's Agent SDK; what they return is the agent's output, not a checked verdict [E-ORCH-33] [E-ORCH-37] [E-PLAT-49] |
| Skills, `llms.txt`, a pull request at the end | Standard practice [E-AGT-50] [E-AGT-54] [E-ORCH-32] |

**Deduction** (from [C-78]): the differentiators the evidence backs are three, and all three are about who decides
that work is done. The ones phax alone ships and nobody was found asking for are about bookkeeping (lifecycle, fates,
records, schemas). They may be what makes the first three trustworthy over time; the notes do not show that anyone
would choose phax for them.

## The honest state of traction

The public repository shows a tool built with itself at volume and used by one person. It holds 2,931 commits and
58 tagged releases since 2026-05-11 [E-PHAX-114], 261 pull requests of which 241 merged, one issue, and one human
contributor [E-PHAX-115]. Its archives hold 165 completed plans and 83 completed specs [E-PHAX-116]. It has 2 stars,
2 forks and no watchers [E-PHAX-115]. Its roadmap states the gap itself: "The registry shows one operator across
three repos", and lists "A second user" as open work before 1.0 [E-PHAX-92]. The only other user mentioned is a friend who
"runs a fork of phax with a \"hold mode\", which he built with phax and uses daily through his own review UI"; that
is one sentence dated 2026-10-21, not verifiable from the notes [E-PHAX-93]. No npm download figure was fetched (Gaps,
`phax-capabilities.md`). No full run on Codex or Vibe was found on record [E-PHAX-68].

The repository also publishes what a run costs. Over the 40 runs tracked from 2026-10-20 to 2026-11-10 the median
was $13.79 and the range $0.96 to $98.04, at API-list prices, on Sonnet 5.5 by default with Opus 5.5 where a phase
gives a reason [E-PHAX-119]. The operator pays a subscription, not list [E-PHAX-13]. A file in the repository says
the records held 485 commits, 77 runs and 526 transcripts on 2026-11-04 [E-PHAX-118].

> **From the operator's local state, not in the public repository.** The local records clone holds 888 commits from
> 2026-08-21 to 2026-11-24: 503 phase records, 189 authoring, 80 review, 54 finding, 52 decision and 10 revision
> records, over 103 distinct runs [E-PHAX-117]. The 182 local cost ledgers sum to $2,514.17 at API-list prices,
> median $9.98 a ledger, all on Claude Code; their entries count 803 phase invocations, 783 handoffs, 141 compliance
> reviews, 140 fix attempts and 38 code reviews [E-PHAX-120].

Against that, the neighbours' adoption, read on 2026-11-25:

| Tool | Adoption | Evidence |
| --- | --- | --- |
| phax | 2 stars; one operator; a friend's fork | [E-PHAX-115] [E-PHAX-92] [E-PHAX-93] |
| BMad Loop | 193 stars; a module of BMAD-METHOD (55,713 stars) | [E-SDD-28] [E-SDD-26] |
| Bernstein | About 1,200 stars | [E-AGT-76] |
| Fabro | 1,891 stars | [E-ORCH-01] |
| zeroshot | 2,227 stars | [E-ORCH-01] |
| Entire | About 5,400 stars; $60 million seed | [E-VER-31] [E-VER-30] |
| Archon | 23,995 stars | [E-ORCH-01] |
| Spec Kit | 151,322 stars; 165,212 PyPI downloads in a month | [E-SDD-01] [E-SDD-07] |
| Superpowers | 326,110 stars | [E-SDD-39] |

Stars are a weak proxy for use. **Deduction** (from [C-72] and [C-10]): phax's depth of use by one person is
unusual, and its breadth is nil. The closest precedent in the notes is unfavourable: Gas Town's author wrote that
it "was intended to be reusable, but I only ever wound up using it to build itself" *(extracted)* [E-ORCH-19].
What separates phax from that case, on the evidence, is one unverified fork.

## The threats, ranked

**Deduction** throughout (from [C-79]); each line names its evidence.

1. **Anthropic makes the gate native.** A Stop hook "can run a script for deterministic checks", `/goal` already uses a fresh
   model as judge, and Claude Ship already chains review, fixes and an approval policy in the repository
   [E-PLAT-07] [E-ORCH-30] [E-PLAT-10]. phax's tested path is Claude Code alone [E-PHAX-68]. If the opt-in pieces
   become a default per-phase gate, phax keeps cross-vendor use, reconciliation and records, and loses its headline
   for most of its likely users [C-18] [C-31]. Nothing in the pages opened shows this happening; the changelog after
   mid-September 2026 was not read.
2. **Pricing or policy on headless subscription use.** A plan to meter `claude -p` and the Agent SDK apart from the
   subscription was announced and paused in June 2026 [E-MKT-55]. Weekly limits were cut 17% from their promotional
   level [E-MKT-57]. phax's best-fitting user runs on a subscription [C-75]. Whether phax's invocation would fall
   under such a change is not established in the notes.
3. **No second user before the window closes.** One operator, a pre-1.0 contract that breaks at minors, 17 releases
   in 30 days [E-PHAX-92] [E-PHAX-114]. The tools that could make a gate the default have 23,995 and 151,322 stars
   [E-ORCH-01] [E-SDD-01].
4. **A better-distributed open neighbour closes the gap.** Spec Kit's engine already halts on a non-zero exit
   [E-SDD-04]. BMad Loop already runs verify commands before a commit, offers detached runs from its terminal UI, and sits inside a
   55,713-star project [E-SDD-28] [E-SDD-26]. Archon already has a skill by which agents delegate to it
   [E-ORCH-63].
5. **Better models shrink the gate's value.** Deterministic tests added only overhead for the frontier model in one
   experiment [E-SDD-71]. Thoughtworks wrote in a source now older than twelve months that "handcrafting detailed
   rules for AI ultimately doesn't scale" [E-SDD-63]. The counter-evidence is that long-task reliability at the 80%
   level lags capability several-fold, on data that ends in April 2026 [E-AGT-35].
6. **Ceremony.** The independent criticism of spec-driven tools is review burden from generated Markdown [C-54].
   phax's `phax-do` brief exists because of it [E-PHAX-95].
7. **The record becomes a commodity.** Entire stores sessions in the user's Git for eight or more agents with
   $60 million behind it [E-VER-31] [E-VER-30]. Its hosted layer also gates merges (corrected 2026-11-25, see the
   [comparison page](../../comparisons/entire-vs-phax.md)). phax's own spike chose "build, not adopt" and accepted that phax
   records only its own runs [E-PHAX-108].
8. **A security incident at the delegation boundary.** A tool that launches agents on another agent's request is an
   injection boundary [E-AGT-69] [E-AGT-70]. phax's own public roadmap lists an open audit programme [E-PHAX-60].
   No incident involving a delegation CLI was found [C-65].

## Which briefs change the fit most, and for whom

None of these has a spec; "briefs are not specs", and each opens questions for its spec (Gaps,
`phax-capabilities.md`). The column "today" is what ships.

| Brief or approved work | Today (shipped) | Once done | Whose fit changes | Market evidence for it |
| --- | --- | --- | --- | --- |
| `phax-do` (brief) [E-PHAX-70] | A run needs an approved, fresh plan [E-PHAX-19] | One task with the gate, the reconciliation and the records, no spec or plan | Agents with task-sized work; people put off by ceremony. **The largest change** | Native delegation returns an unchecked summary [C-58]; ceremony is the main barrier [C-54] |
| `run-detach` (brief) [E-PHAX-72] | `phax run` holds the caller's shell [E-PHAX-97] | A run id at once, versioned events, one outcome document | Agents and scripts; any future UI. **Second largest** | The checklist's handle-and-summary item [E-AGT-46]; BMad Loop and zeroshot already detach or stream [E-SDD-28] [E-ORCH-66] |
| `phase-graph` (brief) [E-PHAX-73] | Phases run one after another [E-PHAX-63] | Independent phases in parallel, each with its own gate | People and agents waiting on long plans | Parallelism is native elsewhere [C-31]; parallel writers fail without isolation [C-64]. Parallel runs also "drain the Max window twice as fast" [E-PHAX-67] |
| `do-attempts` (brief) [E-PHAX-71] | A phase runs once [E-PHAX-64] | A locked contract test, several attempts, a mechanical choice | Agents; a claim no product was found making | Research support, products use a model judge [C-63]; cost multiplies with each attempt [C-47] |
| `inbox`, `next-steps-as-data`, `agent-cli-ergonomics` (briefs) [E-PHAX-74] [E-PHAX-75] | State spread over several commands; remedies as sentences [E-PHAX-101] | One document of what waits; commands as data; short help | Agents, at low cost to build | Checklist items 13 to 15 [E-AGT-57] [E-AGT-58] |
| `knowledge-index` (brief) [E-PHAX-77] | Records reachable "by grep" [E-PHAX-102] | A local index of artifacts, runs and records | The operator and agents at depth of use | None found. Its second milestone, a shared service, would be phax's first team layer and is out of scope [E-PHAX-77] |
| `single-provider` (brief) and `mistral-large-4` (approved) [E-PHAX-79] | Several jobs cannot reach Vibe | All of phax's jobs on one provider, or a named refusal | European users wanting no US vendor | No public-sector demand found [C-57] |
| `claude-code-mod` (brief) [E-PHAX-76] | No UI; the CLI writes files a UI can read [E-PHAX-26] | A read-only pane inside Claude Code | The person supervising | The friend's fork has its own review UI [E-PHAX-93] |
| `batch-execution-disjoint-plans` (approved, parked) [E-PHAX-87] | Parallel plans by hand, checked with `plans overlap` | Disjoint plans in parallel, stacked pull requests | The operator at volume | None beyond the operator's own need |
| `isolated` mode (idea, with an approved spike) [E-PHAX-53] [E-PHAX-87] | `secure` mode rests on each provider's controls [E-PHAX-55] | Provider CLIs in a microVM | Enterprises and regulated users | Sandboxes are a funded complement cluster [E-VER-54] [E-VER-55] |

**Deduction** (from [C-80]): two briefs change who can use phax (`phax-do`, `run-detach`); two change how fast it
is (`phase-graph`, `batch-execution`); one changes what it can claim (`do-attempts`); the rest lower friction for
users it already suits. With all briefs done, phax would match BMad Loop and zeroshot on detachment and zeroshot,
Archon and Kiro on parallelism, and would still lack a hosted layer, an MCP door and any agent beyond its three
providers [E-PHAX-43] [E-PHAX-77] [E-PHAX-30]. The fit with enterprises does not change with any brief.

## The choices open to the operator

Each choice is framed by the strongest thing it gives up. All of this section is **deduction**, resting on [C-81]
and the claims named in each row.

| Choice | What it is | The strongest thing it gives up | Evidence it leans on |
| --- | --- | --- | --- |
| A. Freeze and prove | Finish the road to 1.0 as written: contract freeze, format promise, a second user | Time. The vendors shipped planning, parallelism and review within one year; a frozen contract for one user's workflow may freeze the wrong thing | [E-PHAX-68] [C-31] |
| B. Serve the agent caller first | Ship `phax-do` and `run-detach` before the freeze; make the skill and an `AGENTS.md` snippet the front door | The plan as the unit of trust. A task with no approved plan weakens the "structured before, checked after" position, on a bet whose market is unmeasured | [C-58] [C-61] [C-62] [E-PHAX-70] |
| C. Go to teams | Build the hosted layer: cloud mode, a decision queue, a shared knowledge service | Local, subscription-billed simplicity. The repository's own note: "It bills on the API, not on a subscription", "A sandbox per run is new infrastructure". It also enters where Bloop found no business and funded companies sell governance | [E-PHAX-88] [E-ORCH-03] [E-VER-03] [C-52] |
| D. Become a layer in other runners | Offer the gate, the reconciliation and the record as steps inside Spec Kit workflows, Archon nodes or Claude Code hooks | Ownership of the sequence, which is what makes the gate impossible to skip. A hook can be overridden; a declared step can be left out | [E-PLAT-07] [E-SDD-04] [E-PHAX-105] [C-04] |
| E. Narrow to Claude Code | Drop the two providers that are off by default and little exercised | The one property a vendor will not absorb, and the only link to the sovereignty segment | [E-PHAX-68] [C-28] [C-31] |

**Recommendation: B, in its smallest form, with A's second user as the test.** The reasons, each tied to a claim:

- The repository's own evidence says the frequent caller is already an agent [E-PHAX-07], and the checklist shows
  phax ahead on truth and behind on the caller's time [C-68].
- The thin part of the competitive space is "delegate a write and get back a gate-verified result with a record"
  [C-61]; the crowded parts are everything else.
- Ceremony is the best-evidenced barrier for people too [C-54], so the one-task mode serves both callers.
- It is the cheapest choice to refute: a skill, a task and a count of whether a lead agent uses it.

What it gives up should be said as plainly. The agent-caller market has no measured size [C-62]. Agents do not
adopt tools on their own [C-59]. Choice B still needs a person to want phax, and the notes hold no evidence that a
second person does. For that reason choice B does not replace the second-user test in choice A; it changes what
that user is asked to try. Choice C is the one the pain evidence points to and the one phax is least equipped for;
the notes give no ground to start it before there is a second user.

## The cheapest observations that would confirm or refute the fit

| # | What to measure | Where | What it would show |
| --- | --- | --- | --- |
| 1 | One outside `phax init`, `run`, `publish-pr` on a repository the operator did not write: does it finish unaided, where does it stop | The road-to-1.0 item itself [E-PHAX-92] | Whether the fit extends past one person |
| 2 | Share of phax commands started by an agent and by a person | phax's own telemetry events, recorded for every run [E-PHAX-33] | Whether "most frequent caller is an agent" holds as a count; none exists today |
| 3 | Share of phases whose first gate run was red, and fix attempts per phase | The records' gate results [E-PHAX-39] | How often the gate changes the outcome, the direct measure of its value |
| 4 | Review defects per run after green gates, over time and by model | The model policy table already kept [E-PHAX-119] | Whether gates and acceptance phases reduce what the person must catch |
| 5 | Minutes a person spends from `review_open` to merge | Not recorded today (Gaps, `phax-capabilities.md`) | The review-bottleneck claim, which is the pain phax names first |
| 6 | With the skill installed and no instruction, how often a lead agent picks phax for a delegation-shaped task | A small trial in the manner of the tool-choice study [E-AGT-60] | Whether choice B can work without the user naming phax each time |
| 7 | One full run on Codex and one on Vibe | The open "Provider coverage on record" item [E-PHAX-68] | Whether "three providers" is a capability or a claim |
| 8 | Runs paused on a usage limit per week | Exit code 8 in the run registry [E-PHAX-47] [E-PHAX-99] | How binding the subscription window is for the best-fitting user |
| 9 | What the friend's fork changed and uses | Ask him [E-PHAX-93] | The only second opinion available on what a user needs |
| 10 | Outside mentions, npm downloads, name collisions | A web search for phax's name, never done in this study; one name-adjacent project surfaced by accident [E-SDD-79] | Whether anyone has found phax at all |
| 11 | The same plan run with a cheaper and a stronger model | Not built today [E-PHAX-64] | Whether phax's value is largest with cheaper models, as one outside experiment suggests [E-SDD-71] |

## Conclusion

**Deduction** (from [C-74] to [C-81]): phax's position is unusual in that its weakest evidence is about itself. The
notes can show that the problem is real, that the mechanism is rare, that well-run teams built the same thing, and
that the market's money went to adjacent layers. They cannot show that a second person wants phax, because none has
tried it on the record. Observations 1, 2 and 3 above cost days, not a release, and each can refute a claim this
report rests on. Until they are made, the accurate statement of fit is narrow: phax fits its operator's kind of
work very well, fits agents as callers in the half that concerns truth, and has not yet been tested against anyone
else's.

The briefs change the second half of that sentence, not the first. Treated as done, they make phax a credible
answer for an agent with a task of any size. They leave untouched the two facts that bound the market for people:
the buyers with budget want a hosted layer, and the users who want a local tool have to already own gates worth
running.
