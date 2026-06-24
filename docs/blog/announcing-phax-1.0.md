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

### 2. Human review at the center

phax is not trying to remove you from the loop. It's trying to give you a *good seat* in it.

- Every phase is a **reviewable unit**: one branch, one commit, one objective. You review a
  change the way it was actually built, not as one undifferentiated blob.
- After each phase, the agent writes a **handoff** (`phase-handoff.md`) — what it did, what
  the next phase should know. The next phase's prompt is built from it, so context flows
  forward deliberately instead of by accident.
- phax **reconciles** the files the agent actually touched against the files the plan said
  it would touch — more on this below, because it's one of my favorite parts.
- The **final phase stays open**. When the run finishes, phax doesn't slam the door — it
  leaves the last phase's session and worktree live, writes a `review-handoff.md` pointing
  at the branch to review, and waits. You drop in with `phax enter`, `phax shell`, or
  `phax open` and pick up exactly where the agent left off.

Nothing is destroyed along the way. Even `phax archive` — the only command that touches the
worktrees — *moves* them aside rather than deleting them. Every phase's working state is
preserved for as long as you want to look at it.

### 3. Provider independence

I didn't want phax welded to a single vendor. Phase execution can run through **Claude Code,
Mistral Vibe, or OpenAI Codex**, chosen by a routing layer you control.

The trick is that routing speaks in **model families** and **capability tiers**, not in
versioned model IDs that rot every two months. You ask for a tier — `standard`, `strong`,
`frontier-high` — and phax maps it to the best offering each provider has, then picks the
first available provider from your priority list:

```bash
phax agent models                         # the routing table + provider priority
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
planning skill, and let it draft `plan.md` for you. In Claude Code, that's one prompt:

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

Only then do you point `phax run` at it:

```bash
phax run --plan plan.md              # extracts the plan, runs every phase, leaves a run to review
```

That's the whole happy path: in normal use, `run` is the command you reach for.

The one other command you *will* use on any sizable run is **`phax resume`**. Long runs hit
usage limits — you're halfway through phase 4 of 7 and the provider cuts you off. phax doesn't
lose the work: every phase that already passed is committed on its own branch, so the run
simply stops at a resumable point. `phax resume <run>` picks up from the next pending phase
whenever you come back — minutes or hours later — and never re-runs a phase that already
committed. The same holds for any clean mid-run stop: resume continues, it doesn't restart.

Everything else is there when you want it, not on the critical path. `phax ls`, `phax enter`,
`phax publish-pr`, and `phax archive` list, step into, ship, or shelve a run. And
`phax extract-plan` exists on its own purely as a debugging aid — to check that your `plan.md`
extracts into a clean `phax-plan.json` before you commit to a full run. You don't normally call
it; `run` does the extraction for you.

The planning doctrine is short: **plan outside-in, implement inside-out, verify outside-in.**

## Plan-vs-actual reconciliation

This is the feature I find most useful day to day, and it falls straight out of phases having
declared file lists.

When you write a plan, each phase declares the files it intends to touch — the files it will
*create*, the files it will *edit*, and an optional set it *might* edit. Those lists aren't
decoration. After a phase runs, phax takes the **real** Git diff of what the agent actually
changed and **reconciles** it against what the phase *said* it would change. Deterministically,
no model involved, it sorts every changed file into buckets:

- created as planned / edited as planned,
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
body. (Too long for GitHub's size cap? It truncates gracefully and points to
`review-handoff.md` on the branch.) You can also do it by hand or retry with
`phax publish-pr <run>`. So the artifact you open in the morning isn't a naked diff — it's a
PR that already tells you *what the plan was, what actually happened, and exactly where the
two diverged and why.*

## What 1.0 ships with

A few things that make phax feel like a finished tool rather than a clever script:

- **`phax init`** — one command to scaffold a minimal, valid, schema-backed `phax.json`. The
  `$schema` reference is real and versions with the release, so your editor gives you
  validation and completion that match the phax you actually installed.
- **Project namespaces** — runs now belong to a project. `phax.json` carries a `name`,
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
```

— *phax 1.0*
