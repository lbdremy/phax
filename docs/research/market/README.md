# Market and competitor research for phax

> Checked on 2026-11-25 against phax 0.43.0 (`package.json`; latest tag `v0.42.0`, repository head `b0296fa0`).
> Ids in square brackets across this folder resolve to the files under [`evidence/`](evidence/).

This folder holds one research study and the notes it rests on. It answers a question the maintainer asked about
phax's place in the field. Three reports give the answer, one register lists the claims they rely on, and seven
notes files hold the evidence. The short version: the problem phax addresses is shown by independent measurement,
phax's mechanism is rare among the tools opened, and phax has one user on record; the fit is strongest for a
developer or small team with trustworthy automated checks on Claude Code, and for agents as callers it depends on
two briefs that are not yet specs [C-74] [C-75] [C-76] [C-72].

## The question

> Considering all of phax's briefs, specs and plans as done, who are the competitors of phax? Give a full competitor
> research, and a market research on where phax would be the most useful to its users, considering both humans and
> AI agents as users. Every claim must rest on recorded evidence. Deduce from it the potential market fit of phax in
> the current landscape (as of 2026-11-25).

The reports count the briefs as done where the question asks for it, and mark every capability with its real
status: **shipped**, **approved** (an approved spec or plan whose run has not merged), **brief** (no spec yet) or
**idea**. The fit today and the fit once the briefs land are given as two answers.

## The reports

| File | What it holds |
| --- | --- |
| [`competitors.md`](competitors.md) | The competitor research: five clusters, a ranked shortlist of eleven, one table on fixed axes, the 2026 market events, and what phax appears alone in doing |
| [`market.md`](market.md) | The market research: size, trust, the review bottleneck, measured agent misbehaviour, cost, regulation, then where phax is useful to people (seven segments) and to agents as callers (a 22-item checklist), then barriers and platform risks |
| [`market-fit.md`](market-fit.md) | The deduction: verdict, the problem, strong and weak fits, differentiators sorted by rarity and demand, traction, threats, the briefs that matter, the choices open to the operator, and the cheapest observations |
| [`claims.md`](claims.md) | The register: 81 synthesized claims with kind, evidence, confidence and what would overturn each, and the notes' claims the study did not rely on |

**`competitors.md`.** No tool opened does all of what phax does; many do one part with far more users. Most tools
leave "done" to the agent, to a second model or to a person reading a diff. A small group sequences work by program
and can run real commands as conditions (BMad Loop, zeroshot, Archon, Bernstein, Fabro, Goose recipes, Spec Kit's
workflow engine, Kiro), and in all but one the gate exists only where the author declares it. Anthropic and OpenAI
ship the building blocks natively, opt-in or advisory. Four things phax ships were not found elsewhere: a
planned-versus-touched file check, a plan lifecycle with staleness and recorded approval, a cost estimate before a
run, and gate results kept per phase in the user's Git. The nearest neighbours have 193 to 151,322 stars; phax
has 2.

**`market.md`.** Agents start a third or more of code and pull requests, and review became the measured constraint.
Agents misreport completion at about 2% of real sessions in severe form and bend the checks they can see. Spend is
rising and one vendor's subscription terms moved repeatedly in 2026. No text opened requires a record of what wrote
a piece of code; what texts require is evidence about changes. phax suits individuals and small teams on form, and
enterprises on need but not on form. Against a checklist of 22 things a delegation tool needs, phax ships twelve,
partly ships six, holds one as a brief and lacks three; what it lacks concerns the caller's time, not the truth of
the result.

**`market-fit.md`.** phax fits a proven problem and has unproven users. Three of its differentiators are both rare
and wanted: a gate on by default, a judge out of the maker's reach, evidence returned in place of a summary. Its
bookkeeping features are rare, with no evidence that anyone asks for them. The largest threat is the vendor phax
depends on making the gate native or re-pricing headless use before phax has a second user. The briefs that change
who can use phax are the one-task mode and the detached run. The recommendation is to serve the agent caller first
in its smallest form and to test it with one outside user.

## The method

Seven research threads ran on 2026-11-25. Each wrote one notes file under `evidence/`: numbered evidence items,
then profiles or findings, a comparison matrix, numbered claims and a list of gaps. Every web source was opened in
that session; nothing was written from memory. The reports and the register were then written from the notes alone,
with no further research.

| Notes file | Evidence prefix | Claim prefix | Evidence items | Claims | What it covered |
| --- | --- | --- | --- | --- | --- |
| [`phax-capabilities.md`](evidence/phax-capabilities.md) | `E-PHAX` | `C-PHAX` | 123 | 18 | What phax is; shipped, approved, brief and idea; constraints; its own usage evidence. Repository research only, no web |
| [`competitors-spec-driven.md`](evidence/competitors-spec-driven.md) | `E-SDD` | `C-SDD` | 80 | 22 | Spec-driven and plan-driven tools: Spec Kit, OpenSpec, Kiro, BMAD and BMad Loop, Tessl, Superpowers and others; native plan features; independent criticism |
| [`competitors-local-orchestrators.md`](evidence/competitors-local-orchestrators.md) | `E-ORCH` | `C-ORCH` | 87 | 25 | Local and open-source runners, session managers, loop tools, workflow engines; published in-house systems |
| [`competitors-vendor-platforms.md`](evidence/competitors-vendor-platforms.md) | `E-PLAT` | `C-PLAT` | 104 | 25 | Vendor and cloud platforms: Anthropic, OpenAI, GitHub, Cursor, Google, Cognition, Factory, AWS and others; their direction through 2026 |
| [`competitors-verification-provenance.md`](evidence/competitors-verification-provenance.md) | `E-VER` | `C-VER` | 91 | 37 | AI code review, provenance and session capture, guardrails and scanners, regulation and governance |
| [`market-human-demand.md`](evidence/market-human-demand.md) | `E-MKT` | `C-MKT` | 82 | 22 | Human demand: size, adoption, trust, review, misbehaviour, cost, segments, monetisation |
| [`market-agent-delegation.md`](evidence/market-agent-delegation.md) | `E-AGT` | `C-AGT` | 78 | 23 | Agents as callers: how they delegate, failure research, protocols, discovery, scale, competing primitives, a checklist |

In six of the seven files phax is called "the subject tool": those threads were given a description of phax and
did not search for it. The reports name it.

## How to read the ids

- `E-SDD-12` is evidence item 12 of `competitors-spec-driven.md`. Each item names its source, its date, the date it
  was accessed and how it was read.
- `C-SDD-07` is claim 7 of the same notes file, with the evidence it rests on and a confidence.
- `C-01` to `C-81` are the synthesized claims of [`claims.md`](claims.md). The three reports cite them next to the
  evidence ids for their main statements. `C-01` to `C-33` belong to `competitors.md`, `C-34` to `C-66` to
  `market.md`, `C-67` to `C-81` to `market-fit.md`.
- "Not found" and "nf" mean not found in the sources opened on 2026-11-25.
- *(extracted)* after a quote means the page was read through a fetch tool's extraction.
- "Vendor-run" and "vendor-claimed" mark a study or a figure published by a party that gains from it.

## Corrections after re-reading the primary sources

The comparison pages under [`docs/comparisons/`](../../comparisons/) were written the same day, each after
re-reading the tool's own repository and docs. Where they differ from the evidence notes, the pages are right and the
reports here were corrected; the notes are left as the record of what was read first.

- **Entire** does more than record. Its hosted Trails gate merges on review findings, approvals and CI checks. Its
  CLI still runs no agent and gates no commit. Affects C-07, C-20 and the Entire rows of `competitors.md`.
- **Fabro** no longer keeps execution records in Git. Each stage's file changes go on a run branch; execution state
  lives in its server's run store. Affects C-15, C-26 and the Fabro rows of `competitors.md`.
- **BMad Loop** detaches only runs started from its terminal UI, and runs one story at a time. Affects C-11.
- **zeroshot** has an opt-in worktree mode and token totals per run at its release tag; the notes said neither was
  found. No claim in the register rested on those absences.
- **Codex** has worktrees in its CLI (`codex exec --worktree`), not only in its desktop app.

## Limits of this research

- **Quotes need re-checking.** Many sources were read through a fetch tool that returns an extraction of the page.
  This applies to every item of `competitors-verification-provenance.md`, to most of `market-human-demand.md`
  (the JetBrains posts and the Harvard working paper excepted), to the items marked "extracted" in
  `competitors-local-orchestrators.md`, "S" in `competitors-vendor-platforms.md` and "via fetch summary" in
  `competitors-spec-driven.md`, and to the Codex subagents page in `market-agent-delegation.md`. No quote should be
  published verbatim before it is checked on the page.
- **Much quantitative evidence is vendor-run.** Sonar, Faros, LinearB, Jellyfish, GitLab, CloudBees, Harness,
  Atlassian, GitHub, JetBrains and Stack Overflow publish most of the figures on adoption, review time and quality,
  and several sell a remedy. The main independent quantitative sources are the Harvard working paper (not peer
  reviewed, built on one vendor's data), METR, and a handful of preprints.
- **The web-search budget ran out before some topics were opened.** Left without any opened source: surveys of how
  many developers use spec-driven tools, and coverage by InfoQ, The New Stack and The Pragmatic Engineer on that
  topic; Reddit threads in every thread; ISO/IEC 42001; NIST AI RMF updates; FDA; ISO 26262 and automotive;
  provenance or AI-code-detection features of Tabnine and Sonar; SBOM-for-AI in CycloneDX or SPDX; OpenTelemetry's
  agent conventions; Codex CLI sandboxing docs; Claude Code's default attribution setting; GitHub's enterprise
  agent-governance features; Coder Agent Boundaries; Mistral Vibe as a product. Also unread: the Claude Code
  changelog after mid-September 2026 and the Codex changelog from June to October 2026, so several launch dates are
  unknown.
- **phax's own name was never searched on the web.** There is no data here on name collisions, npm downloads or
  outside mentions of phax. One possibly name-adjacent project surfaced by accident: a small repository presented on
  Hacker News as "Replacing spec-driven development with just facts" (208 stars, last push 2026-06-03), whose
  content was not opened [E-SDD-79].
- **Absence claims are bounded by the sources opened.** "Not found" for a gate, a file reconciliation, a plan
  lifecycle, a pre-run estimate or a versioned schema rests on READMEs and the docs pages read, not on a reading of
  any tool's code or full documentation. Two small tools that advertise test gating or intent-conflict detection
  were seen in listings and never opened. Bernstein was read in excerpt.
- **phax was not run.** Every "shipped" capability rests on phax's README, docs and generated CLI reference. The
  repository's own comparison pages are old (Spec Kit and OpenSpec checked at phax 0.17.0) and were not used for
  facts about other tools.
- **Briefs are not specs.** "Briefs as done" describes a direction. Each live brief leaves questions open for its
  spec, two are deprioritised, and none has a design that is fixed.
- **Legal texts were read through mirrors and summaries.** The EU AI Act and DORA articles come from unofficial
  mirrors; the Cyber Resilience Act guidance, the AI Act omnibus and the FINRA report come from law-firm summaries.
  Nothing in `market.md` is legal advice.
- **Stars and downloads are weak proxies.** GitHub stars and registry downloads stand in for adoption throughout;
  downloads include automated installs.
- **Some figures are local.** Two evidence items (E-PHAX-117, E-PHAX-120) come from the operator's local machine
  state, not from the public repository. They are used once, in a marked paragraph of the traction section of
  `market-fit.md`, and support no claim in the register.
- **Dates move.** Pricing and documentation pages are undated and were read as served on 2026-11-25. Sources older
  than twelve months are flagged where they carry weight; the two most-quoted hands-on critiques of spec-driven
  tools are among them.
- **The notes disagree in two places.** One file found no funding figure for Conductor and another opened its
  Series A announcement; one file lists the Vibe Kanban company as active and another opened its shutdown post.
  `claims.md` says which reading was used.
