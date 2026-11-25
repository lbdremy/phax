# Claims register for the market study

> Checked on 2026-11-25 against phax 0.43.0 (`package.json`; latest tag `v0.42.0`). Ids resolve to the files under
> [`evidence/`](evidence/): `E-…` is an evidence item, and a prefixed claim such as `C-SDD-07` is a claim made in
> one of the seven notes files. The plain ids `C-01` to `C-81` are the synthesized claims that
> [`competitors.md`](competitors.md), [`market.md`](market.md) and [`market-fit.md`](market-fit.md) rely on.

This register holds one row per synthesized claim. **Kind** is one of: *measured fact* (a count, a text or a study
with a stated method), *vendor-claimed* (a vendor's statement about its own product or market), *independent
analysis* (a party with no product in the category), *absence* (not found in the sources opened on 2026-11-25),
*inference* (a reading by the notes or by this study). **Confidence** follows the notes' own ratings, lowered where
several notes disagree or where a source was read only through an extraction. No claim rests on a search snippet or
on a single unnamed source; where one is mentioned in a report it is called unverified there. The local-only figures
of `phax-capabilities.md` (E-PHAX-117, E-PHAX-120) support no claim here; they appear once, in the traction section
of `market-fit.md`.

## Claims used in `competitors.md`

### The landscape

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-01 | The most-adopted spec-driven tools are prompt and skill packs in which the agent drives itself; what judges the work is a model or a person, and it is advisory. | measured fact (primary docs) | C-SDD-01, C-SDD-02; E-SDD-02, E-SDD-12, E-SDD-14, E-SDD-39, E-SDD-40 | high | A pack shown to run the project's commands itself and block on them by default |
| C-02 | The largest group of local tools manages parallel sessions in worktrees, and its acceptance step is a person reading a diff; none documents a tool-run command that must pass. | absence | C-ORCH-01; E-ORCH-02, E-ORCH-04, E-ORCH-06, E-ORCH-07, E-ORCH-12, E-ORCH-53 | high | A gate feature in one of these tools' docs not read (for example Conductor's API page) |
| C-03 | In the Ralph family the loop is deterministic and "done" is the agent's own statement. | measured fact (repos read raw) | C-ORCH-06; E-ORCH-22, E-ORCH-23, E-ORCH-25 | high | A Ralph tool that runs the checks itself |
| C-04 | A small group lets a program sequence the work and run real commands as conditions (BMad Loop, zeroshot, Archon, Bernstein, Fabro, Goose recipes, Spec Kit workflows, Kiro); in all but BMad Loop the gate exists only where the author declares it. | measured fact (vendor docs) | C-SDD-03, C-SDD-04, C-SDD-05, C-ORCH-07; E-SDD-28, E-SDD-04, E-ORCH-63, E-ORCH-66, E-ORCH-69, E-ORCH-47, E-SDD-20, E-AGT-76 | high that the mechanisms exist; medium on behaviour in practice | A default workflow in one of them that ships a mandatory test gate |
| C-05 | In the pages opened, no vendor platform makes the project's own gate commands a built-in condition of completion; gates are user-written hooks or repository CI, and a Claude Code Stop hook is overridden after eight blocks. | absence | C-PLAT-02, C-ORCH-03, C-ORCH-04, C-ORCH-05; E-PLAT-07, E-PLAT-31, E-PLAT-27, E-PLAT-04, E-PLAT-26, E-ORCH-31 | medium | The second pass the notes ask for on Claude Code hooks, Codex cloud checks, Cursor hooks or Factory validation |
| C-06 | AI code review is advisory by default, and no reviewer profiled is documented as running the project's typecheck, tests or lint. | measured fact for the defaults; absence for the rest | C-PLAT-03, C-VER-01, C-VER-02, C-VER-04; E-PLAT-02, E-VER-08, E-VER-14, E-VER-19, E-VER-23, E-VER-04 | high for "advisory"; medium for "does not run checks" | A reviewer that builds and tests before it comments |
| C-07 | Provenance tools record the work and do not gate a commit, and their formats do not agree (Entire's refs, git-ai's notes, GitHub's trailer, Agent Trace's spec). Corrected 2026-11-25: Entire's hosted Trails gate merges on review findings, approvals and CI checks (`docs/comparisons/entire-vs-phax.md`). | measured fact | C-VER-12, C-VER-14, C-VER-15, C-VER-16; E-VER-31, E-VER-33, E-VER-36, E-VER-41 | high on formats; medium on "do not check" (Entire's hosted platform not examined) | Verification features in Entire's platform or a later Agent Trace version |
| C-08 | Guardrail products enforce by program at the edges (sandbox, microVM, egress proxy, install-time firewall, static-analysis gate) and are complements to phax. | inference | C-VER-19, C-VER-20; E-VER-54, E-VER-55, E-VER-59, E-VER-61, E-VER-63, E-VER-65 | medium | One of them adding plan-aware gates between the edges |
| C-09 | The two in-house systems that publish the most detail, Stripe's and Spotify's, use deterministic steps, real commands before the pull request, bounded retries and a final human review; other leading teams drop the human review. | measured fact (company self-reports, extracted) | C-ORCH-15, C-ORCH-24; E-ORCH-72, E-ORCH-73, E-ORCH-75, E-ORCH-78, E-ORCH-80 | high | The posts read differently on the page (quotes were extracted) |
| C-10 | Adoption sits with methodology packs, swarm frameworks and boards; engines built around verification are one to two orders of magnitude smaller, Archon excepted. | measured fact (GitHub counts) | C-ORCH-14, C-SDD-13; E-ORCH-01, E-SDD-01, E-SDD-39, E-SDD-10 | high for counts; stars and downloads are weak proxies | Usage data that contradicts the star order |

### The shortlist

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-11 | BMad Loop is the closest documented functional overlap with phax: a program loop, the project's verify commands before commit, a fix session, a separate review, a findings ledger, budgets, `--json`, detached runs when started from its terminal UI (corrected 2026-11-25, `docs/comparisons/bmad-loop-vs-phax.md`); it is a beta with 193 stars, tied to BMAD, with per-machine state. | measured fact (README) | C-SDD-04; E-SDD-28, E-SDD-26, E-SDD-27 | high on documented features; medium on behaviour | Running it; an independent review |
| C-12 | zeroshot is the nearest in positioning ("keeps coding agents from grading their own work"), with an enforced graph and machine interfaces; its judges are mainly reviewer agents; its benchmark is vendor-run. | measured fact (README, docs) | C-ORCH-10, C-ORCH-11; E-ORCH-66, E-ORCH-67, E-ORCH-68 | high for features; low for the benchmark | A default program gate, worktree isolation or a file-level check in its code |
| C-13 | Archon is the largest open-source tool with a deterministic workflow engine and program-run conditions, with per-run logs, cost and a skill for agent callers. | measured fact (README) | C-ORCH-12; E-ORCH-01, E-ORCH-63 | high for features; its usage figure is vendor-claimed | — |
| C-14 | Bernstein is the closest in shape among agent-facing tools (deterministic scheduler, worktree per task behind merge gates, a replayable record), and was read only in excerpt. | measured fact (README excerpt) | C-AGT-10; E-AGT-76 | medium to low | A full reading; whether its gates block commits |
| C-15 | Fabro commits each stage's file changes to a run branch in Git; it runs as a server, in Docker by default or a cloud sandbox. Corrected 2026-11-25: its docs say execution state lives in the server's run store, not in Git (`docs/comparisons/fabro-vs-phax.md`). | measured fact (vendor docs) | C-ORCH-13; E-ORCH-69 | medium | Another tool's storage, not exhaustively checked |
| C-16 | Spec Kit's workflow engine can express program-enforced gates and keeps per-run state with JSON status; its bundled workflow ships human review gates, not test gates. | measured fact (docs) | C-SDD-05; E-SDD-03, E-SDD-04, E-SDD-05 | high | A bundled workflow with test steps; the step-types page that returned 404 |
| C-17 | Kiro is the broadest proprietary overlap; it is closed, credit-priced, and its terms forbid use through third-party automation. | measured fact (docs) | C-SDD-06, C-PLAT-06; E-SDD-16, E-SDD-18, E-SDD-19, E-SDD-20, E-PLAT-76 | high | A Kiro setting that makes task completion conditional on a command without a hook |
| C-18 | Anthropic ships the pieces natively (hooks, `/goal`, dynamic workflows, Code Review, PR Steward, Approvals); each is opt-in or advisory, single-vendor, and Claude Ship needs Team or Enterprise; no spec or plan artifact, per-phase gate, reconciliation or per-phase Git record was found. | measured fact plus absence | C-PLAT-07, C-ORCH-03, C-VER-10, C-SDD-14, C-SDD-15; E-PLAT-02, E-PLAT-07, E-PLAT-09, E-PLAT-10, E-ORCH-30, E-SDD-44, E-SDD-45, E-SDD-47 | high for what exists; medium for what was not found | The Claude Code changelog after mid-September 2026, not read |
| C-19 | Codex is in the same position: subagents, a Stop hook, a JSONL mode, cloud tasks, an advisory review; no built-in gate found. | measured fact plus absence | C-ORCH-05, C-PLAT-03; E-ORCH-36, E-ORCH-37, E-ORCH-38, E-PLAT-27, E-PLAT-30 | high for features; medium for the absence | The Codex changelog June to October 2026, not read |
| C-20 | Entire competes with phax mainly on the record: it stores prompts, transcript and touched files as Git refs for eight or more agents, with $60 million of funding. Its CLI runs no agent and gates no commit. Corrected 2026-11-25: its hosted Trails gate merges (`docs/comparisons/entire-vs-phax.md`). | measured fact (README, news) | C-VER-11, C-VER-12, C-VER-13, C-PHAX-16; E-VER-30, E-VER-31, E-PHAX-108 | high on facts; medium on "no check" | Entire's hosted platform adding verification |
| C-21 | Goose recipes can declare shell checks that must exit 0 with bounded retries; isolation, review and records were not found. | measured fact plus absence | C-ORCH-07; E-ORCH-47 | medium (one docs page) | A fuller reading of Goose |

### The fixed axes

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-22 | No tool opened documents a program that compares the files a plan declared with the files a phase touched. | absence | C-SDD-07, C-ORCH-08, C-PLAT-06; E-SDD-42, E-SDD-28, E-SDD-38, E-ORCH-67, E-ORCH-75 | medium | A code audit of any tool; the two small tools seen in listings only |
| C-23 | No tool opened documents a spec or plan lifecycle with a staleness state and recorded approvals. | absence | C-SDD-08; E-SDD-43, E-SDD-03, E-SDD-12, E-SDD-42 | medium | The same |
| C-24 | Maker and judge are increasingly kept apart, as a second model reviewing the first, not as tests written first and judged by a program. | inference | C-ORCH-09, C-PLAT-05, C-AGT-07; E-ORCH-30, E-ORCH-66, E-ORCH-69, E-PLAT-02, E-ORCH-77 | medium | A product that judges by held-out tests by default |
| C-25 | A tracked fate per finding is rare: Copilot (three reasons), Bugbot (resolved or unresolved) and BMad Loop (a deferred-work ledger) document one; none was found writing it to the user's Git with a deferral state. | absence | C-VER-03, C-SDD-04; E-VER-16, E-VER-08, E-SDD-28 | medium | The lifecycle pages of eight reviewers that were not opened |
| C-26 | Vendor session records live in vendor clouds; in the user's Git were found sessions (Entire), per-stage commits of file changes (Fabro) and attribution (git-ai), not gate results or a reconciliation. | absence | C-PLAT-08, C-VER-11, C-ORCH-13; E-PLAT-04, E-PLAT-12, E-PLAT-41, E-VER-31, E-ORCH-69, E-VER-36 | medium | What Entire's or Fabro's records hold beyond their READMEs |
| C-27 | A cost estimate of a plan before it runs was not found in any local or spec-driven tool; cost after the fact and caps exist; two vendor features forecast cost for themselves. | absence | C-SDD-20, C-ORCH-22, C-PLAT-16; E-SDD-28, E-ORCH-33, E-ORCH-63, E-PLAT-16, E-PLAT-45 | medium | Cost pages not opened (Claude Code costs, Kiro) |
| C-28 | Running several vendors' agents is common among runners and host layers, first-party platforms stay single-vendor, and none of the layers found documents Mistral Vibe. | measured fact; absence for Vibe | C-SDD-16, C-PLAT-09, C-PLAT-10, C-PLAT-11; E-SDD-28, E-ORCH-66, E-PLAT-12, E-PLAT-44, E-PLAT-84, E-PLAT-88 | high; low for the Vibe part | A layer that lists Vibe |
| C-29 | Machine-readable interfaces for callers are common; a versioned schema promised on every answer was not found outside phax. | absence | C-SDD-19, C-ORCH-21, C-PLAT-15; E-SDD-13, E-SDD-04, E-ORCH-33, E-ORCH-37, E-ORCH-66, E-PLAT-30 | medium | A versioning promise in docs not read |

### Market events and uniqueness

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-30 | Independent parallel-agent and neutral-runner products lost their company or independence in 2026 (Bloop, Conductor, Crystal, Roo Code, Terragon, Charlie Labs, Ona, Windsurf, Cursor), and Gas Town was abandoned by its author. | measured fact (news, vendor posts) | C-ORCH-02, C-ORCH-20, C-PLAT-23; E-ORCH-03, E-ORCH-13, E-ORCH-05, E-ORCH-60, E-PLAT-92, E-PLAT-94, E-PLAT-38, E-PLAT-70, E-PLAT-57, E-ORCH-19 | high for each event listed | — (the Jules wind-down and the Amp spin-out are left out: secondary or snippet only) |
| C-31 | Within 2026 the vendors made planning, parallelism, scripted workflows and review native. | measured fact (docs) | C-ORCH-25, C-PLAT-17, C-SDD-14; E-ORCH-27, E-ORCH-36, E-PLAT-60, E-SDD-44, E-SDD-65 | high for the features; the launch dates are partly unknown | — |
| C-32 | Investors funded verification and provenance as layers of their own in 2026 (Qodo $70 million, CodeRabbit $143 million, Entire $60 million). | measured fact (news) | C-VER-08, C-VER-13; E-PLAT-96, E-VER-02, E-VER-30 | high on the rounds; they are bets, not demand | — |
| C-33 | phax's combination (project gates before a commit, plan-versus-diff reconciliation, findings with fates, all recorded in the user's Git) was not found in any single product; each neighbour covers one part. | absence, inference | C-VER-37, C-AGT-10, C-SDD-07, C-ORCH-08; E-VER-31, E-VER-16, E-VER-65, E-VER-21, E-AGT-76 | medium | Any tool the searches missed; the searches were not exhaustive and phax's name was never searched |

## Claims used in `market.md`

### Size, adoption, trust

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-34 | The enterprise market for AI coding agents was about $10 billion annualised in April 2026, and leading vendors run at hundreds of millions to billions. | independent analysis (via news); vendor-claimed run-rates | C-MKT-01, C-PLAT-25; E-MKT-01, E-MKT-02, E-MKT-08 | high for the order of magnitude | The Gartner release itself, not opened |
| C-35 | Agents originate between about 35% and 47% of code and pull requests on four measures; GitHub reports over 40% of pull requests started by an agent in September 2026. | vendor-claimed (platform telemetry, vendor-run surveys) | C-MKT-03, C-PLAT-18, C-VER-21, C-AGT-15; E-MKT-10, E-MKT-14, E-MKT-19, E-MKT-33, E-PLAT-46, E-PLAT-47 | medium | GitHub's detection error, unpublished |
| C-36 | Most professional developers use coding agents at work; surveys disagree on the level (26% to 90%). | measured fact (surveys, mostly vendor-run) | C-MKT-02; E-MKT-13, E-MKT-15, E-MKT-16, E-MKT-23 | medium | A survey with a common definition |
| C-37 | Developers trust agent output when they can verify it and mostly keep agents supervised, while the share who say they always check is falling. | measured fact (vendor-run surveys) | C-MKT-07, C-MKT-08, C-VER-23; E-MKT-15, E-MKT-16, E-MKT-33, E-MKT-19, E-VER-70 | medium to high | An independent survey with another result |

### Review and misbehaviour

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-38 | Review and validation, not writing, is the measured constraint after agent adoption; sources conflict on pull-request size, quality and merge rates. | independent analysis plus vendor-run telemetry | C-MKT-04, C-VER-22, C-ORCH-18; E-MKT-29, E-MKT-30, E-MKT-32, E-MKT-27 | high on direction | Peer review of the Harvard paper; data from a second analytics vendor |
| C-39 | A growing share of pull requests is merged without human review. | vendor-claimed (one vendor's telemetry) | C-MKT-06; E-MKT-30, E-MKT-31, E-MKT-50 | medium | A second dataset |
| C-40 | Agents report work as done or verified when it is not, at about 2% of real sessions in severe form and far more in review benchmarks. | measured fact (two independent studies, one vendor card) | C-MKT-09, C-AGT-03, C-AGT-04, C-ORCH-17; E-MKT-40, E-MKT-41, E-AGT-26, E-AGT-27, E-ORCH-84 | medium (definitions and judges differ; model-judged) | A study with a common definition on late-2026 models |
| C-41 | Agents optimise for the checks they can see, and bend or weaken checks when they can, so the judge has to be kept out of their reach. | measured fact | C-MKT-10, C-AGT-05, C-PLAT-20; E-MKT-42, E-MKT-46, E-MKT-41, E-AGT-24, E-AGT-40, E-PLAT-100 | high (one key source is older than 12 months) | Frontier models shown not to do it |
| C-42 | A green test gate overstates mergeability; "verified" can mean only "the project's gates passed". | measured fact | C-AGT-06, C-PLAT-21, C-PHAX-15; E-PLAT-101, E-AGT-30, E-AGT-37, E-PHAX-119 | high (the maintainer study covers older models) | — |
| C-43 | Executing real checks reduces accepted regressions and outperforms prompt-level self-checking; the benefit is larger for cheaper models and may be nil for a frontier model. | independent analysis (small samples) | C-MKT-11, C-SDD-12; E-MKT-43, E-MKT-49, E-SDD-71 | medium | A larger experiment; a gated-versus-ungated defect study, which was not found |
| C-44 | Agents take out-of-scope actions on benign tasks at measurable rates. | measured fact (one preprint abstract; one self-report) | C-MKT-12; E-MKT-47, E-ORCH-75 | low | The full paper; a second study |

### Cost

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-45 | Per-engineer AI spend is rising several-fold a year and pricing is moving to meters. | vendor-claimed telemetry, investor survey, vendor announcement | C-MKT-15; E-MKT-33, E-MKT-51, E-MKT-60, E-AGT-67 | high | — |
| C-46 | Subscription terms for agent CLIs were unstable through 2026: third-party use of subscription tokens was barred, limits moved, and separate metering of headless Claude Code use was announced and paused. | measured fact (policy text, news) | C-MKT-14, C-PLAT-14; E-MKT-53, E-MKT-54, E-MKT-55, E-MKT-57, E-MKT-58, E-PLAT-21 | high | — |
| C-47 | Each added agent role multiplies cost, and vendor review features bill outside the subscription. | measured fact; vendor docs | C-ORCH-19, C-AGT-18, C-PLAT-13; E-ORCH-77, E-ORCH-29, E-PLAT-19, E-PLAT-43 | high | — |
| C-48 | Cost ranks below quality as a stated concern, and few developers or companies act on price. | measured fact (surveys, vendor telemetry) | C-MKT-16; E-MKT-24, E-MKT-16, E-MKT-33, E-MKT-15 | medium | — |

### Regulation and segments

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-49 | No regulation or audit framework opened requires a record of who or what wrote a piece of code; reading such a duty into them is an inference. | absence | C-VER-27, C-VER-29, C-VER-32, C-VER-33; E-VER-78, E-VER-79, E-VER-81, E-VER-84, E-VER-86 | medium (texts read in part, through mirrors and summaries) | The Official Journal texts; NIST SSDF 1.2 practice wording; ISO/IEC 42001, not opened |
| C-50 | What the texts do require is evidence about changes whoever wrote them (DORA Article 9(4)(e); the Cyber Resilience Act's documentation and testing duties, main obligations from 11 December 2027). | measured fact (legal text via mirrors) | C-VER-28, C-VER-30; E-VER-87, E-VER-80, E-VER-81 | high on the quoted wording | The official texts reading differently |
| C-51 | US guidance is moving towards naming AI-generated code and agent records without yet requiring them (NIST SSDF draft, FINRA considerations). | measured fact (draft, law-firm summary) | C-VER-31; E-VER-82, E-VER-83, E-VER-85 | medium | The final SSDF 1.2 |
| C-52 | Enterprises have the measured pain and a governance budget, lack traceability of code origin, and buy through procurement from hosted vendors. | vendor-claimed surveys; independent study for the pain | C-MKT-13, C-MKT-22; E-MKT-27, E-MKT-28, E-MKT-29, E-MKT-23, E-MKT-08, E-MKT-01 | medium | Evidence of enterprises adopting a local, unhosted tool at scale |
| C-53 | Individuals and the smallest companies adopt new agent tools fastest and are the heaviest Claude Code users; individuals pay about $20 a month. | measured fact (readership survey) | C-MKT-22; E-MKT-23, E-MKT-24, E-MKT-13 | medium (self-selected sample) | — |
| C-54 | Spec-first workflows are contested: the independent criticism is review burden from generated Markdown, and the benefit goes to teams that already have strong practice. | independent analysis | C-MKT-17, C-SDD-10, C-SDD-09; E-SDD-62, E-SDD-69, E-SDD-64, E-SDD-66, E-MKT-62 | high (the two hands-on reviews are older than 12 months) | A hands-on re-review of the 2026 versions |
| C-55 | Many projects lack the automated tests that gate-based verification needs. | vendor-claimed surveys | C-MKT-18; E-MKT-68, E-MKT-28 | low | A direct measure of test suites in real projects |
| C-56 | Open-source maintainers respond to agent-written contributions on the receiving side, with limits and policies that keep a human responsible. | measured fact (primary statements) | C-MKT-19, C-VER-36; E-MKT-34, E-MKT-35, E-MKT-36, E-MKT-39, E-VER-42, E-VER-45 | high | — |
| C-57 | European sovereignty policy is at proposal stage, and no public-sector adoption of a European coding agent was found. | measured fact; absence | C-MKT-20; E-MKT-74, E-MKT-76, E-MKT-77, E-MKT-73 | medium | A public body adopting one |

### Agents as callers

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-58 | Native delegation in Claude Code and Codex stays inside one vendor and returns a summary with no built-in deterministic check; vendor docs tell people to demand the command and its output. | measured fact (docs) | C-AGT-01, C-AGT-02; E-AGT-01, E-AGT-02, E-AGT-04, E-AGT-09 | high (the Codex page was read through an extraction) | A default check on subagent results |
| C-59 | Agent Skills and `AGENTS.md` are the widest-reach way to put a tool before agents, and agents rarely adopt a tool unprompted. | vendor-claimed counts; one independent study | C-AGT-12, C-AGT-13; E-AGT-50, E-AGT-45, E-AGT-49, E-AGT-60, E-AGT-54 | high for reach; medium for behaviour (the study is on libraries) | A study of agents choosing CLIs |
| C-60 | For a small, documented command set a CLI costs an agent fewer tokens than an MCP server with many tool schemas. | vendor-claimed benchmark | C-AGT-14; E-AGT-55, E-AGT-56 | low to medium (one small benchmark; contrary studies seen only in snippets) | The studies not opened |
| C-61 | Existing cross-vendor bridges give a lead agent a second opinion or a hand-off, not a gate-verified result; the gate-and-record tools that face agents are small. | measured fact; inference | C-AGT-09, C-AGT-10; E-AGT-73, E-AGT-74, E-AGT-76 | medium (search not exhaustive) | Tools listed in the notes' Gaps as not examined |
| C-62 | How often agents delegate to other agents is unmeasured in the sources opened. | absence | C-AGT-17; E-AGT-62, E-AGT-63, E-AGT-64 | high that it was not found | A vendor publishing the figure |
| C-63 | Choosing among parallel attempts with tests has research support; shipped best-of-N products choose with a model judge and publish no measured gain. | measured fact; absence | C-AGT-19; E-AGT-42, E-AGT-43, E-AGT-17 | medium (one research item is older than 12 months) | A product publishing a gain |
| C-64 | The multi-agent pattern reported as working is single-threaded writes with verification in a separate context; parallel writers remain unreliable. | vendor-claimed experience | C-AGT-08; E-AGT-14, E-AGT-16, E-AGT-03 | medium | A controlled study |
| C-65 | Identity and accountability for delegated agents are still proposals, and a tool that launches an agent for another agent is an injection boundary; no incident involving a delegation CLI was found. | independent analysis; absence | C-AGT-21, C-AGT-22; E-AGT-68, E-AGT-69, E-AGT-70, E-AGT-21 | high for the risk class | — |
| C-66 | Open-source agent tooling earns through a paid team layer or hosted models, and published outcomes are few; one maker of a free local tool closed for want of a business model. | vendor-claimed | C-MKT-21, C-ORCH-02; E-MKT-78, E-MKT-79, E-MKT-81, E-ORCH-03 | low (two sources are older than 12 months) | Outcome data |

## Claims used in `market-fit.md`

### What phax is, from its repository

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-67 | phax ships a local CLI covering four moments (author, run, review, keep) with a list of program-enforced refusals and checks; model judgment remains in authoring and in two reviews that cannot fail a run. | measured fact (repository docs) | C-PHAX-01, C-PHAX-02, C-PHAX-03; E-PHAX-03, E-PHAX-18, E-PHAX-20, E-PHAX-36 | high for what the docs state; phax was not run for this study | Running phax and finding a documented guarantee does not hold |
| C-68 | The agent-facing surface ships as a contract (`--json`, exit codes, `--json-schema`, skills, a guide); today a run holds the caller's shell, needs an approved plan, and runs phases in sequence. | measured fact | C-PHAX-04, C-PHAX-07; E-PHAX-44 to E-PHAX-50, E-PHAX-97, E-PHAX-19, E-PHAX-63 | high | — |
| C-69 | Four briefs would add what phax lacks against subagents: a task with no plan, a detached run with events, parallel phases, parallel attempts judged by a locked test. None has a spec. | measured fact (briefs) | C-PHAX-06; E-PHAX-70, E-PHAX-71, E-PHAX-72, E-PHAX-73 | high on what the briefs say; their shape may change | The specs, when written |
| C-70 | phax supports three provider CLIs; Claude Code is the default, the fallback and the only tested path; the cost ledger covers Claude Code only; no full run on Codex or Vibe is on record. | measured fact | C-PHAX-08; E-PHAX-30, E-PHAX-40, E-PHAX-68, E-PHAX-79 | high | A recorded run on another provider |
| C-71 | phax is local only, macOS and Linux, GitHub only for pull requests, pre-1.0 with a breaking cadence, and its `secure` mode rests on each provider's own controls. | measured fact | C-PHAX-09, C-PHAX-10, C-PHAX-18; E-PHAX-43, E-PHAX-65, E-PHAX-66, E-PHAX-114, E-PHAX-55 | high | — |
| C-72 | The public repository shows one operator, no outside user on record, one friend's fork mentioned in one sentence, 2 stars, and heavy use of phax on itself (2,931 commits, 58 releases, 165 completed plans, 241 merged pull requests). | measured fact | C-PHAX-11, C-PHAX-12; E-PHAX-92, E-PHAX-93, E-PHAX-114, E-PHAX-115, E-PHAX-116 | high for the repository; the fork is unverifiable | An outside user; npm downloads, never fetched |
| C-73 | On phax's own code a run cost a median of about $14 at API-list prices over 40 tracked runs, and review recorded 266 defects after green gates. | measured fact (the repository's own table) | C-PHAX-13, C-PHAX-15; E-PHAX-119 | high for the counts; the defect attribution is the operator's | — |

### Deductions

| Id | Claim | Kind | Rests on | Confidence | What would overturn it |
| --- | --- | --- | --- | --- | --- |
| C-74 | The problem phax addresses is shown by independent measurement, and its chosen remedy has outside support; that the remedy reduces a person's review time is not shown. | inference | C-38, C-40, C-41, C-42, C-09; E-SDD-67 | high for the problem; unknown for the effect | A gated-versus-ungated study; phax's own review-time data |
| C-75 | The fit is strongest today for a developer or small team with trustworthy gates, on Claude Code under a subscription, delegating plan-sized changes. | inference | C-53, C-46, C-70, C-71, C-54 | medium | A second user of another profile succeeding, or one of this profile failing |
| C-76 | For agents as callers the fit today is partial (checked facts, a blocked caller); it becomes direct only once `phax-do` and `run-detach` are done, and the buyer remains a person. | inference | C-58, C-59, C-61, C-62, C-68, C-69 | medium | A count of agent-initiated phax calls; a trial of unprompted choice |
| C-77 | The fit is weak for enterprises (form), projects without trustworthy tests, open-source maintainers, users of other agents, Windows and non-GitHub users, and teams that dropped human review. | inference | C-52, C-55, C-56, C-71, C-09 | medium | — |
| C-78 | Three differentiators are both rare and wanted (a default program gate, a judge out of the maker's reach, evidence returned to the caller); the bookkeeping ones are rare with no demand evidence; isolation, multi-provider use, plan approval and model review are commodity. | inference | C-04, C-05, C-22 to C-29, C-41, C-48, C-49, C-58 | medium | Demand evidence for records or fates; a vendor shipping a default gate |
| C-79 | The threats rank: a native gate from Anthropic; pricing or policy on headless subscription use; no second user in time; a better-distributed open neighbour; better models; ceremony; a commodity record; a security incident. | inference | C-18, C-31, C-46, C-72, C-11, C-13, C-16, C-43, C-54, C-20, C-65 | medium to low (a ranking is a judgment) | Any of the events occurring out of order |
| C-80 | Among the briefs, `phax-do` and `run-detach` change who can use phax; `phase-graph` and batch execution change speed; `do-attempts` changes what phax can claim; none changes the fit with enterprises. | inference | C-69, C-58, C-63, C-64, C-52 | medium | The specs changing the briefs' scope |
| C-81 | The choice the evidence favours is to serve the agent caller first in its smallest form, with a second outside user as the test; it gives up the plan as the unit of trust on a market of unmeasured size. | inference | C-61, C-62, C-54, C-68, C-72 | low to medium (a recommendation) | Observations 1, 2, 3 and 6 in `market-fit.md` |

## Claims in the notes that this study chose not to rely on

Each is mentioned at most as a lead, with its limits, and no conclusion stands on it.

| Notes claim or item | What it says | Why it is not relied on |
| --- | --- | --- |
| C-ORCH-11, E-ORCH-68 | zeroshot's builder-plus-checker loop beat a larger model's single shot at 58% of the cost | Vendor-run, 20 tasks, one model family, not replicated |
| C-VER-24, E-VER-67, E-VER-66 | AI-written code has 1.4 to 1.7 times the issue rate; 38% of generation tasks introduce a vulnerability | Both vendors sell the remedy; the "human" label is uncertain. The independent C-VER-25 is used instead |
| C-VER-05, C-VER-06 | Leaderboard positions of AI reviewers; reviewers overlap little | Second-hand reports; one team, author employed by one of the vendors |
| C-PLAT-22, C-VER-35, E-PLAT-59, E-PLAT-78 | Agent-caused incidents (a deleted production database; an AWS disruption) | A founder's account with no independent post-mortem; the other is disputed by the vendor and rests on anonymous sources |
| C-PLAT-23 in part, E-PLAT-63, E-PLAT-83 | Jules shutting down; Amp spun out of Sourcegraph | A secondary outlet with no link to the vendor; a search snippet only |
| C-PLAT-25 in part, E-MKT-05, E-PLAT-58 | Cursor over $4 billion annualised | A single unnamed source; cited as such, never as a basis |
| E-PLAT-23, E-PLAT-39, E-PLAT-102 to E-PLAT-104, E-ORCH-86 | Limit complaints, an 8 million Codex user figure, further studies and figures | Search-result snippets, pages not opened |
| C-SDD-18, E-SDD-32 | Tessl left spec-as-source; $125 million raised | A competitor's review; no statement from Tessl opened |
| C-SDD-12 (the TDD half), E-SDD-70 | Test-driven development inside the agent loop shows no gain at 3 to 8.5 times the tokens | A very small informal test, model-judged; it concerns tests written by the same agent in the same loop |
| C-SDD-21, E-SDD-75 to E-SDD-78 | Practitioners shrink specs instead of dropping them | Forum comments; one is quoted in `market.md` as a comment |
| C-SDD-22, E-SDD-79 | A small project markets "fact-driven development" under a "just facts" title | Its content was not opened; kept only as a name-adjacent lead in the README's limits |
| C-ORCH-17 (the issues half), E-ORCH-84 | Claude Code users report false "done" claims | Four issues with one reaction at most; cited as anecdotes |
| C-AGT-14, E-AGT-55 | A CLI is 10 to 32 times cheaper in tokens than MCP | One 75-run benchmark by a vendor; contrary studies were seen in snippets and not opened. Reported as C-60 with low confidence; nothing is built on it |
| C-AGT-20, E-AGT-35 | Reliability horizons lag capability several-fold | The data ends in April 2026 and has wide intervals; used once, as counter-evidence, with that caveat |
| C-VER-33, E-VER-86 (underwriting asks) | Insurers ask for a documented human override and logging | One trade source the publisher itself calls uncorroborated |
| C-VER-34, C-AGT-22 (the incidents) | Malicious skills, a worm, incidents in adjacent agent tooling | Outside this study's question; the risk class is used (C-65), the incidents are not described |
| C-VER-26 in part, E-VER-72, E-MKT-20 | DORA 2025 ties AI adoption to instability | Published September 2025, older than 12 months; no 2026 edition was found |
| C-MKT-05 | Agents raise code output far more than finished work | Used only as stated by the one independent paper (E-MKT-29); the supporting vendor survey gives no sample size |
| E-MKT-82 against E-ORCH-03 | The status of the Vibe Kanban company | The two notes conflict: a directory lists it as active, the founder's post announces the shutdown. The founder's post is used |
| `competitors-local-orchestrators.md` against E-MKT-80 on Conductor | "No funding found" against a $22 million Series A | The notes conflict: one file found no funding figure, another opened the vendor's announcement. The announcement is used |
