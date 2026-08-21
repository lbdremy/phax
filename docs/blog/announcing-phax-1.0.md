# Announcing phax 1.0 — let an AI agent do the work, on your terms

*A deterministic CLI that drives a coding agent through isolated, gated, reviewable phases.*

---

## The problem I kept hitting

Coding agents got genuinely good. Point one at a real change and it will often do it. The
trouble is everything *around* the work:

- It does the whole thing in one breathless run. You get a 40-file diff and a pat on the
  back, and now it's *your* job to figure out whether any of it is right.
- It's non-deterministic. Run the same prompt twice, get two different shapes of change.
  There's nothing to anchor a review to.
- If it goes sideways halfway through, it has already touched your working tree. Untangling
  a half-finished agent run by hand is its own little nightmare.
- You end up babysitting it — watching the terminal, ready to Ctrl-C — which defeats the
  point of handing off the work in the first place.

I didn't want a smarter autocomplete or a chattier pair-programmer. I wanted the agent to
do a large piece of work *while I wasn't watching*, and then hand me something I could
actually review — in pieces, with a clear before/after, in an isolated branch that never
touched my working directory until I said so.

That's phax.

Plenty of tools now run agents in isolated worktrees and route across providers — that part
isn't new. What I cared about is the principle underneath: **put determinism wherever it can
go, and keep the probabilistic part — the agent — boxed into the one place it's actually
needed.** Everything around the model is a machine you can reason about; the model is a guest
inside it, not the thing in charge.

## The core idea: the phase

phax breaks a change into **phases**. A phase is the unit of everything: one focused chunk
of work, with its own objective, its own files-it's-allowed-to-touch, its own verification
step, and its own commit. You describe the phases up front in a plan, and phax executes
them one at a time.

Each phase runs in **its own Git worktree on its own branch**. Phase 1 branches off your
run's base commit; phase 2 branches off phase 1; and so on. Your actual working directory
is never touched. The agent works in `~/.phax/worktrees/<run>/phase-NN/`, completely out of
your way, and the worktrees stick around so you can open any of them and look.

That one decision — *the phase is the unit, and every phase is isolated* — is what makes
everything that follows possible.

## What I refused to compromise on

### 1. Control and determinism

Under the hood, phax is an explicit **state machine**. Every signal — a gate passed, a rate
limit hit, the agent finished, you asked to archive — is a typed event. A pure reducer
decides what happens. There is exactly one writer to the run's status files. Nothing
"just happens"; every state change is a transition you could point at.

The visible payoff is **gates**. After the agent finishes a phase, phax runs the phase's
verification commands — your typecheck, your tests, your linter, whatever you put in a
*gate profile*:

```json
"gateProfiles": {
  "fast": ["pnpm typecheck", "pnpm test:unit"],
  "full": ["pnpm typecheck", "pnpm lint", "pnpm test", "pnpm build"]
}
```

If a gate fails, phax doesn't shrug and move on. It resumes the *same agent session* — the
one with all the context of what it just did — and tells it to fix the failure, then runs
the gate again. A phase only advances when its gate is green. A phase that produced no
changes stops the run with a clear exit code instead of committing nothing and pretending.

The same principle reaches back to the plan itself. Turning `plan.md` into the structured
`phax-plan.json` that drives a run used to be an agent's job. Now it's a **deterministic
parser first**: a well-formed plan extracts instantly, identically, with no model in the loop.
Only a plan the parser can't read falls back to the LLM — and that fallback is recorded as a
warning, not hidden. Extractions are content-addressed and cached, so the same plan text never
gets extracted twice. Less of the pipeline is probabilistic than it was; that's the direction.

### 2. Human review at the center

phax is not trying to remove you from the loop. It's trying to give you a *good seat* in it.

- Every phase is a **reviewable unit**: one branch, one commit, one objective. You review a
  change the way it was actually built, not as one undifferentiated blob.
- After each phase, the agent writes a **handoff** (`phase-handoff.md`) — what it did, what
  the next phase should know. The next phase's prompt is built from it, so context flows
  forward deliberately instead of by accident.
- phax **reconciles** the files the agent actually touched against the files the plan said
  it would touch — more on this below, because it's one of my favorite parts.
- Every phase leaves a **record** — prompt, diff, gate logs, handoff, transcript — versioned in
  Git, not just in a folder on your laptop. Months later, `phax records explain <sha>` tells you
  *why* a commit exists. More on this below.
- The **final phase stays open**. When the run finishes, phax doesn't slam the door — it
  leaves the last phase's session and worktree live, writes a `review-handoff.md` pointing
  at the branch to review, and waits. You drop in with `phax enter`, `phax shell`, or
  `phax open` and pick up exactly where the agent left off.
- The review itself is **two pre-built passes you run on demand**, not a blank prompt you
  have to compose. `phax review-compliance` spawns an *independent* reviewer that judges
  only one thing — plan-vs-execution conformance — and emits a verdict per phase and for
  the run as a whole: `conformant`, `conformant-with-deviations`, or `divergent`. It mutates
  nothing; it just tells you whether the agent did what the plan said. Run it by hand, or set
  `review.compliance.enabled` and let it run as a step of the run itself (more on that below).
  Then `phax review-code`
  drops you into a *pre-prompted, resumable* agent session in the final worktree, already
  primed with the reconciliation and any compliance findings, so the code review starts from
  context instead of from "so, what changed?" — you investigate, argue, and apply fixes right
  there.

Nothing is destroyed along the way. Even `phax archive` — the only command that touches the
worktrees — *moves* them aside rather than deleting them. Every phase's working state is
preserved for as long as you want to look at it.

### 3. Provider independence

I didn't want phax welded to a single vendor. Phase execution can run through **Claude Code,
Mistral Vibe, or OpenAI Codex**, chosen by a routing layer you control.

I tried the obvious design first — an invented scale of capability tiers that each provider
maps onto — and threw it out. A made-up ladder is one more thing to maintain, and it hides the
real question. What shipped instead: the plan names **real, versioned models** (`claude-opus-4-8`
at `high`, say) from a **catalog** phax keeps current, and a small **equivalence table** — a
star with Claude at the hub — translates that request when a *different* provider family ends up
running it. Each edge carries only a capability relation (`equivalent`, `upgrade`, `downgrade`),
and the one policy knob is `allowDowngrade`. At run start a **preflight** checks every phase is
actually runnable on what you have installed; if not, it refuses with the valid alternatives so
the plan can be corrected *before* anything runs, not halfway through phase 4.

```bash
phax agent models                         # the catalog, equivalence table, provider priority
phax agent resolve --model claude-opus-4-8 --effort high
phax run --provider-priority codex-cli,claude-code   # override for one run
```

Claude Code is the default and the terminal fallback: if your preferred provider is
unavailable — or can't satisfy the security posture you asked for — phax falls back to
Claude rather than failing. On a clean install the other two ship disabled, so phax behaves
exactly like a Claude-only tool until you opt in. The applied routing (including any
fallback or downgrade) is recorded per phase, so you always know what actually ran.

### 4. The right model for each task

A phase is also the unit of *model selection*. Each phase in the plan declares the model and
effort level it needs. That matters because "which model, at
what thinking budget, for this specific task" is a genuinely hard call for a human to make
on the fly, change after change. Breaking the work into phases makes that call explicit and
per-task: a heavy refactor phase can ask for a frontier model at high effort; a mechanical
rename phase can run on something cheap and fast. You don't pay frontier prices — in tokens,
in money, in energy — for work that doesn't need it.

Let me be honest about where I actually am with this, because I don't want to oversell it:
the one setup I've tested hard and trust is **a frontier model (Opus) for the planning
itself** — that's the step where precision pays for itself, where getting the phase
breakdown and the per-phase file lists right determines everything downstream. The plan it
produces then carries the model/effort recommendations that route each *execution* phase.
The machinery is provider-independent and per-phase; the proven recipe today is "spend on
the plan, economize on the execution." That's an economy on every axis that matters to me.

## What a run actually looks like

```bash
phax init                            # once: scaffold a minimal phax.json
phax skills install --target claude  # once: teach your agent the plan format
```

Now write the plan — except you don't write it by hand. You hand your agent a spec and the
planning skill, and let it draft `plan.md` for you. (The spec doesn't have to be hand-written
either: a sibling `phax-spec` skill drafts it in the shape the planning skill expects — EARS
requirements, testable acceptance criteria, a consumption surface. Spec → plan → run, each step
consuming the last.) In Claude Code, the planning prompt is one line:

```text
Plan the spec @docs/specs/14-remove-network-controls.md using @phax-planning
```

This is the planning step — the one I run on **Claude Opus** (it's where precision pays off,
as above). The `@phax-planning` skill hands the agent the exact contract — one section per
phase with an objective, instructions, the files each phase may create/edit, a gate-profile
step, and the commit message — so what comes out is a `plan.md` phax can actually consume.

Then comes the part that matters most: you **review the plan, and argue with it.** This is a
normal back-and-forth with the agent — *why is this its own phase? these two should merge;
that file doesn't belong in phase 2; add a gate here.* You shape the plan until you actually
believe in it. It's the cheapest possible place to catch a bad idea: fixing a phase boundary
in `plan.md` costs a sentence, while catching it after the agent has written the code costs a
re-run. By the time you hand it to phax, you've already reviewed the *intent* — phax then
holds the execution to it, phase by phase, and the post-run reconciliation shows you where
reality drifted from the plan you signed off on.

When you believe in it, you say so — explicitly:

```bash
phax artifact approve docs/plans/44-gate-profile-steps.md
phax run --plan docs/plans/44-gate-profile-steps.md   # extracts, runs every phase, leaves a run to review
```

That approval isn't ceremony. Specs and plans carry a **lifecycle status** in their YAML
frontmatter — `Draft`, `Approved`, `Stale`, `Abandoned`, `Completed` — and `phax run` **refuses
to start from anything but an `Approved` plan**. A plan declares which spec it derives from
(or explicitly declares none), and approving it is chain-gated: the source spec must be
`Approved` too. Every transition is a path-scoped commit, so the history of *what you signed
off on, and when* is in Git, next to the code. The "review the intent first" step above used to
be a habit; now it's enforced.

The approval also records **what it was given against** — the spec's content, the plan's
content, and a baseline commit. That's what lets phax notice when the ground shifts under a
plan, which matters once you have more than one in flight (below).

That's the whole happy path: in normal use, `approve` then `run` are the commands you reach for.

The one other command you *will* use on any sizable run is **`phax resume`**. Long runs hit
usage limits — you're halfway through phase 4 of 7 and the provider cuts you off. phax doesn't
lose the work: every phase that already passed is committed on its own branch, so the run
simply stops at a resumable point. `phax resume <run>` picks up from the next pending phase
whenever you come back — minutes or hours later — and never re-runs a phase that already
committed. The same holds for any clean mid-run stop: resume continues, it doesn't restart.

Everything else is there when you want it, not on the critical path. `phax ls`, `phax enter`,
`phax publish-pr`, and `phax archive` list, step into, ship, or shelve a run;
`phax review-compliance` and `phax review-code` are the two review passes from above, run on
demand; and `phax plans status`, `phax plans overlap`, and `phax adjust-plan` come out when
you're juggling more than one plan at a time. And `phax extract-plan` exists on its own purely as a debugging aid — to
check that your `plan.md` extracts into a clean `phax-plan.json` before you commit to a full run.
You don't normally call it; `run` does the extraction for you.

The planning doctrine is short: **plan outside-in, implement inside-out, verify outside-in.**

## Plan-vs-actual reconciliation

This is the feature I find most useful day to day, and it falls straight out of phases having
declared file lists.

When you write a plan, each phase declares the files it intends to touch — the files it will
*create*, the files it will *edit*, and an optional set it *might* edit. Those lists aren't
decoration. After a phase runs, phax takes the **real** Git diff of what the agent actually
changed and **reconciles** it against what the phase *said* it would change. Deterministically,
no model involved, it sorts every changed file into buckets:

- created as planned / edited as planned / optional-and-touched,
- **planned but missing** — the agent never touched a file it promised to,
- **unplanned** — the agent created or edited a file the plan never mentioned,
- deletions and renames.

That's the *what*. The *why* comes from the agent itself: at the end of each phase, the
resumed session writes a **phase handoff** explaining what it did and why — including why it
deviated. phax then assembles a single **review document** (`review-handoff.md`) that puts the
two side by side, per phase: the cold, deterministic plan-vs-actual diff next to the agent's
own narrative explanation. A global "attention points" section flags every file that drifted
and links you straight to the handoff that explains it.

So when you sit down to review, you're not staring at a 40-file diff guessing at intent. You're
reading: *"the plan said this phase would touch these six files; it touched eight; here are the
two extra ones; and here, in the agent's own words, is why."* That is a fundamentally better
thing to review than a raw diff.

And it's not just for you at the end. Each phase's deviations are **fed forward into the next
phase's prompt**, so the agent sees how the previous phase drifted from its own plan and can
course-correct instead of compounding the drift silently.

There's an upstream dependency that makes all of this work: the reconciliation is only as good
as the planned-file lists it compares against. That's why phax ships a **planning skill** that
defines the exact plan format — the per-phase template with its create/edit/optional file
lists, gate-profile step, and commit metadata. Good plan in, meaningful reconciliation out.
The discipline the skill enforces up front is what pays off as a readable review at the end.

And the loop closes where you already do your reviewing: **GitHub**. Turn on `publish` in
`phax.json` and, when a run finishes, phax pushes the final phase branch and opens a pull
request whose **description is the review document itself** — the plan-vs-actual
reconciliation, the per-phase divergences, and the agent's reasons, all rendered into the PR
body.

And the conformance review folds into that same loop. Just as `publish.auto` opts a run into
auto-publishing, `review.compliance.enabled` opts it into running the compliance review **as a
step of the run** — automatically, right *before* the PR is opened — so the verdict lands in
the PR body with no extra command. It's the same independent reviewer `phax review-compliance`
runs by hand, just wired into the run, and its **verdict rides up front** in the description,
before the phase-by-phase breakdown: whoever opens the PR reads `conformant` /
`conformant-with-deviations` / `divergent` *before* a single line of diff, so they know where
to spend their attention. (The review is non-fatal — if it fails, the run still lands in
`review_open` and you can fall back to running it yourself.) Too long for GitHub's size cap? It
truncates gracefully and points to `review-handoff.md` on the branch. You can also publish by
hand or retry with `phax publish-pr <run>`.

One more thing rides on that branch. When the final phase's gates go green, the run appends the
plan's own `Approved → Completed` transition as a commit on the run branch — before review
opens, independent of how you publish. Merge the PR and the work and its completion land in one
gesture; revert it and they unland together. The plan's status can't drift from what actually
shipped, because they're the same commits. So the artifact you open in the morning isn't a
naked diff — it's a PR that already tells you *whether the plan was honored, what the plan was,
what actually happened, and exactly where the two diverged and why.*

## More than one plan in flight

The declared-file lists pay off a second time, pointed in the opposite direction. Once you're
breaking work into plans, you start wanting to run *several*, and that raises a question phax
can now answer deterministically: **which plans can run at the same time without colliding?**
`phax plans overlap` takes two or more `plan.md` files, unions each plan's declared phase
file-sets into a footprint, and intersects them pairwise. Out comes a severity-graded conflict
matrix, the clean pairs, the largest fully-disjoint set you can safely launch at once, and a
greedy wave schedule. It's the same discipline the reconciliation leans on, aimed at
*coordination* instead of review. (Conflicts are file-level, so two plans editing different
regions of the same file still get flagged — better a false alarm than a surprise merge.)

That's the *prediction*. The harder problem is **drift after the fact**: you land one plan and
the others you wrote against the old tree go quietly stale — referencing files, line numbers,
and decisions that just moved. `phax plans-overlap --landed <run>` answers the *confirmed*
version of the question — it reads the run's **actual** Git diff (from the very same
`global-file-reconciliation.json` the review used) and tells you which of your other plans now
need re-adjustment, with no false negatives. And `phax adjust-plan <plan> --landed <run>` opens
an interactive, pre-prompted session that walks the plan against what actually landed, proposes
concrete edits, waits for your explicit approval, and only then rewrites and commits the plan.

But drift doesn't only come from phax runs. A teammate merges a refactor by hand; you rewrite
the spec a plan was derived from; you edit the plan itself after approving it. This is where the
approval record earns its keep. `phax plans status` walks every `Approved` plan and checks it
against the three things its approval was recorded against, naming the reason when one has
moved — `spec-changed`, `ground-changed` (files in the plan's footprint changed since the
baseline commit), `self-changed`. It's a report, not a gate: it exits 0 either way, and only
`--apply` flips the stale ones to `Stale` — an explicit gesture, never automatic. A stale plan
can't run; `reopen` sends it back to `Draft` for re-planning, or `approve` re-records it against
the new ground if you've looked and it still holds.

The same plan-vs-actual machinery that makes a single run reviewable also keeps a *backlog* of
plans honest as the tree shifts underneath them — whoever shifted it.

## Run records: blame should reach the intent

Everything above produces evidence: the prompt a phase was given, the diff it produced, every
gate log from every fix attempt, the reconciliation, the handoff, the agent's full transcript,
the token usage. Before 1.0, all of that lived in `~/.phax/runs/` — a warehouse on one laptop.
The phase commit carried trailers pointing at a gate log *path* that existed on exactly one
filesystem. A reviewer on `main` could reach the commit and the diff, but not the prompt that
produced it, the gate that admitted it, or the transcript showing what the agent read and what
it abandoned. One `rm -rf ~/.phax` away from gone, and no teammate ever saw it.

So 1.0 **versions what it already produces**. When a phase ends — committed, failed, or
interrupted — phax writes a **record**: an ordinary Git tree on an orphan branch,
`phax/records/v1`, written with plumbing so your working tree and index are never touched.
Records are addressed by `Run-Id` + `Phase-Id`, which the phase commit's trailers already carry,
so a rebase or squash-merge that rewrites the sha doesn't orphan anything. Nothing is filtered,
redacted, or summarized; the transcript is stored as the provider emitted it, or the record says
plainly that it holds a skeleton without one.

Records follow the work rather than lead it: the record commits locally when the phase commits,
and is pushed when the run is published. A push that fails leaves the record *pending* — shown
in `phax ls` and `phax records status` — and never fails the run. Then, whenever you want to
know why a line exists:

```bash
phax records explain <sha>    # prompt, diff, gates, handoff, transcript, usage — for that commit
```

The one rule I wouldn't bend: **a record must never land somewhere more readable than the code it
describes.** A transcript can hold anything the agent saw. So records go into the source repo
only when that repo is private; if the repo is public and transcripts are on, they go to a
dedicated private records repo — and phax refuses to write otherwise. `phax records init` (or
the `phax init` wizard) asks whether to include transcripts and whether to push automatically;
it announces the destination, it doesn't offer a choice, and it tells you in so many words that
making a private repo public later publishes every transcript already in its history.

## Orientation before the gate

The gate is corrective: it fires *after* the agent has written code. 1.0 adds a preventive leg.
Register an **orient provider** and, when a phase is dispatched, phax asks it for a **brief**
keyed by the phase's planned files — the conventions, boundaries, and patterns the project
already knows about those files — and weaves it into the prompt as an *index* the agent can
expand on demand (`phax orient <id>`), including for files the plan didn't predict. It's purely
advisory: the brief arms the agent, it never jails it — the gate remains the only leg with teeth.
No provider registered? The prompt is dispatched unchanged.

## What 1.0 ships with

A few things that make phax feel like a finished tool rather than a clever script:

- **`phax init`** — one command to scaffold a minimal, valid, schema-backed `phax.json`. The
  `$schema` reference is real and versions with the release, so your editor gives you
  validation and completion that match the phax you actually installed.
- **Project namespaces** — runs belong to a project. `phax.json` carries a `name`,
  and runs are identified as `phax.remove-network-controls`, not a globally-ambiguous
  `remove-network-controls`. Inside a repo you still type the short name; phax resolves and
  *displays* the qualified one everywhere. Two projects can both have a
  `remove-network-controls` without ever colliding.
- **Locked agent binding** — once a phase launches with a provider and model, that choice is
  *frozen*. Re-entering, inspecting, or resuming a phase always uses the binding recorded at
  launch — never the router again. Change your routing config midway and your in-flight
  phases don't care; they finish on the agent that started them. Each provider gets its own
  session adapter instead of everything assuming Claude's session format — Codex is properly
  supported, and Mistral is handled explicitly rather than silently falling back to Claude.
- **A real CLI contract** — help, shell completions (zsh/bash/fish), and generated docs all
  come from one validated source of truth, so `--help`, the README, and the runtime can't
  drift apart. `phax <command> --help` actually tells you what a command does and what it
  touches.
- **Repo-rooted, from anywhere** — run phax from any subdirectory; paths resolve against where
  you invoked it, state resolves against the repo root.
- **An interactive `phax init`** — an `npm init`-style wizard that pre-fills the project slug
  and gate commands from your `package.json`, and asks the records questions above.

And a lot of deliberate *subtraction*: trimming convenience commands that didn't earn their
keep, so the surface you have to learn is the surface that matters.

## Security: agents run themselves, so I had to think about this hard

The whole premise — let the agent run unattended — means the agent is *running code on your
machine without you watching*. That deserves more than a hand-wave, so here's exactly how
phax thinks about it, and where it's honest about its limits.

### The baseline every run gets

The distributed phax binary is compiled with Deno under an explicit permission set, and
**network access is denied**. phax itself makes no network calls — there's no phax telemetry
phoning home, no update check, nothing.

Here's the honest caveat, because it matters: **that sandbox protects *phax*, not the agent
phax launches.** The moment phax spawns `claude`, `codex`, or `vibe`, that process runs under
its *own* permissions, with its own network access — Deno's sandbox doesn't reach into a child
process. So phax does not fully isolate the agent today. True external-sandbox isolation —
wrapping the whole agent in a container or VM — is the planned `isolated` mode, and it isn't
shipping in 1.0 (the CLI rejects it for now rather than pretending). I'd rather under-promise
that than ship a fake boundary.

So where does the real boundary come from? **The provider's own jail.**

### Provider jails are not equal

In the default `secure` mode, phax applies the strongest native controls each provider
exposes — and they differ a lot. This is straight from the capability table in the code:

| Provider     | Filesystem jail | Shell command control                          | MCP allowlist |
| ------------ | --------------- | ---------------------------------------------- | ------------- |
| Claude Code  | **Strong**      | **Per-command allowlist** (exact gate commands) | Supported     |
| Codex        | **Strong**      | OS-sandboxed (confined, no per-command list)    | Supported     |
| Mistral Vibe | **Partial**     | Auto-approved (no allowlist)                    | Supported     |

- **Claude Code** has the most advanced jail. Filesystem is locked to the worktree (edits
  auto-approved inside the working dirs, denied outside), and the shell is *denied by default*:
  phax allowlists **exactly** the phase's gate commands and nothing else. A `pnpm test` gate
  permits `pnpm test` — not `pnpm` anything-else. It's the tightest of the three.
- **Codex** is a strong second. Its filesystem jail is real (a `workspace-write` OS sandbox
  confined to the worktree and state root), but its shell model is different: any command may
  run, confined by the OS sandbox rather than a per-command allowlist. Strong isolation,
  coarser shell granularity.
- **Mistral Vibe** is the weakest. Its filesystem jail is only **partial**, and shell tool
  calls are auto-approved with no allowlist at all.

That last row has a concrete consequence. A strong filesystem jail is the hard requirement
for strict `secure`, and Mistral can't meet it. So under `secure`, routing **skips Mistral**
(unless it's the only provider left as terminal fallback), marks the run `partial-filesystem`,
and records the downgrade. You never silently get the weak jail when you asked for the strong
one — the applied posture, every downgrade, and every mark are written to a per-phase
`security.json` and summarized in `final-report.md`. `phax security status` probes your
installed providers and shows you their real capabilities before you run.

`unsafe` mode exists for trusted plans — full host access — and it prints a loud warning every
time so you can't enable it by accident.

The other boundary worth naming is mundane but load-bearing: phax **never interpolates your
data into shell strings.** Branch names, paths, plan fields — all passed as separate `argv`
tokens. No clever filename gets to become a command.

### Where security goes next

The honest gap above — that phax leans on each provider's own jail, and those jails aren't
equal — is the next thing I want to close. The direction I'm exploring is the `isolated` mode:
wrap the whole agent in a real sandbox that phax controls, so isolation no longer depends on
which provider happened to run the phase. The tool I'm looking at is
**[smolvm](https://github.com/smol-machines/smolvm)** — a lightweight microVM — to isolate the
agent **completely**: network and filesystem sealed off behind a hypervisor boundary, ideally
with fine-grained control over what's allowed in and out. That's still to be studied, not
promised. But it's the path, and it matters most for **Mistral Vibe**: a provider-independent
sandbox is exactly what lifts the weakest jail up to the same floor as the others, instead of
routing around it.

## Who it's for

If you've ever handed a coding agent a real task and then sat there watching the terminal
because you didn't quite trust it to run loose — phax is for you. It's a local CLI. It works
with the agent CLI you already have installed. It doesn't touch your working tree. It hands
you back something you can review the way you'd review a colleague's branch: in phases, with
green checks, on a branch you can read top to bottom.

Let the agent do the work. Keep the review.

```bash
npm install -g @lbdremy/phax
phax init
phax skills install --target claude
```

— *phax 1.0*
