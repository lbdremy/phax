# Entire vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Entire CLI
> v0.13.4 (2026-11-13) — its website ([entire.com](https://entire.com), where
> entire.io redirects), its docs ([docs.entire.com](https://docs.entire.com)),
> and the README, CHANGELOG and `docs/` of
> [`entireio/cli`](https://github.com/entireio/cli) — and phax 0.43.0.

## The one-line difference

**Entire records the session behind a commit, whichever agent wrote it; phax
runs the agent and records what its checks said.** Entire is a Git forge with a
CLI whose hooks capture agent sessions as checkpoints and link them to your
commits. phax is verified delegation: it starts the agent itself, lets a phase
commit only when your project's gates exit green, and keeps the gate results,
the file reconciliation and the handoff beside the transcript. Both keep the
history in Git; they differ in what that history can prove.

## What Entire is, concretely

You install the CLI (Homebrew, an install script, or PowerShell on Windows)
and run `entire enable` in a repository: it "works in any Git repository, no
account needed" and installs agent hooks and Git hooks. Then you use your agent
and commit as usual. In the
[README](https://github.com/entireio/cli#agent-sessions)'s words: "each commit
that includes agent work gets a **checkpoint** — the prompts, transcript, and
files touched — linked to the commit by an `Entire-Checkpoint` trailer. Entire
never adds commits to your branch; by default, checkpoints are stored as their
own Git refs (`refs/entire/checkpoints/…`) and pushed alongside your code."

```
entire checkpoint explain <id>    # the prompt, transcript, and files behind one
entire why FILE:LINE              # from a line to its commit, checkpoint, prompt
entire search "how was auth changed"
```

The [docs](https://docs.entire.com/guides/sessions/overview) list what a
checkpoint stores: the linked commit, the sessions behind the change, "prompts
and transcript", "tool activity", "changed files", "token usage, when
available", and AI attribution for the changed lines. Checkpoints can go to a
[separate repository](https://docs.entire.com/guides/checkpoints/store-checkpoints-in-another-repo)
instead of the code's. The README is plain about exposure: "**Session
transcripts are pushed to your Git remote**", and "Entire redacts detected
secrets before writing a checkpoint, but redaction is best effort".

The CLI is now one part of a larger product, which the README opens with:
"Entire is a Git forge built for agent–human collaboration". Entire hosts
repositories, or mirrors your GitHub ones, searches sessions with the code,
and adds **Trails**, "our replacement for the pull request for agentic coding"
([docs](https://docs.entire.com/guides/trails/overview)). Review agents score
every push, and [Gates](https://docs.entire.com/guides/trails/gates) are "merge
requirements for a Trail": branch freshness, human approvals, unresolved
findings and CI checks.

The _agent that writes the change is still yours_: you start it, in your tree,
with its own permissions, and Entire's hooks watch it. The agents Entire starts
itself review, summarise or investigate. What checks the work is decided at
merge, on a Trail. The CLI is MIT-licensed, and the
[billing page](https://docs.entire.com/billing) says "Entire bills only for
Agent usage, using prepaid usage credits." It is a 0.x CLI with stable and
nightly channels and about 5,350 GitHub stars, from a funded company: TechCrunch
[reported](https://techcrunch.com/2026/02/10/former-github-ceo-raises-record-60m-dev-tool-seed-round-at-300m-valuation/)
a $60M seed round in February 2026.

## What phax is, concretely

A compiled CLI (Node launcher + Deno-compiled binary, Effect / TypeScript)
that **drives** an AI coding agent (Claude Code by default; Codex and Mistral
Vibe once enabled) through isolated, gated phases. You write a spec and a
`plan.md` — by hand with the bundled skills, or headlessly with `phax artifact
new spec|plan --headless --brief` — and approve them. `phax run` refuses a plan
that is not Approved or has gone Stale, then executes each phase in its **own
git worktree**, runs your project's **gate profile** after each phase with a
same-session fix loop, commits only when it passes, reconciles the planned
files against the actual diff, and stops at `review_open` with a review
handoff, an optional compliance review, an optional headless code review whose
findings each get a fate (fixed, dismissed or deferred) and an optional GitHub
PR. With records turned on, every phase leaves its manifest, gate results,
reconciliation, diff, handoff and, if you keep it, transcript on a
`phax/records/v1` branch, and every run keeps a cost ledger of its Claude Code
invocations. phax _is_ the runtime; it spawns the agent headlessly, and it
records its own runs only.

## Side-by-side

| Axis                     | Entire                                                                                                                                              | phax                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**           | A Git forge, and a CLI that captures agent sessions through hooks                                                                                   | A compiled CLI that runs the agent through an approved plan                                                                                          |
| **Which sessions**       | Every session of an enabled agent in the repository, whoever started it; past sessions can be imported or attached                                  | Only phax's own: phases, headless authoring, decisions, revisions, reviews. A session outside a run leaves no record                                 |
| **What is captured**     | Prompts, transcript, tool activity, changed files, token usage "when available", commit-level AI attribution                                        | Prompt, diff, handoff, logs and the transcript if kept — plus what phax itself did: gate results, file reconciliation, security mode                 |
| **Gate results**         | None in a checkpoint: the commands the agent ran are in its transcript, but no check had to pass                                                    | Every gate attempt with each step's command, result and duration; a `Gate-Log` trailer names the attempt that let the commit through                 |
| **Reconciliation**       | Not in its docs: a Trail carries the intended outcome as prose                                                                                      | Planned versus changed files, per phase and per run, computed by phax and carried into the handoff and the review                                    |
| **Cost**                 | Token counts per session and checkpoint (`entire checkpoint tokens`)                                                                                | `cost-ledger.json` per run: API-list dollars, tokens and duration of each Claude Code invocation (not Codex or Vibe)                                 |
| **Where it is stored**   | One Git ref per checkpoint under `refs/entire/checkpoints/`, pushed with your code by a pre-push hook, or to a separate checkpoint repository       | One commit per record on a `phax/records/v1` branch, in the same repository or a separate one; never force-pushed                                    |
| **Transcript privacy**   | Detected secrets redacted, "best effort"; on a public repository the transcripts are public unless you redirect or stop the upload                  | No redaction; transcripts are optional, and refused on a public repository's own records branch                                                      |
| **Linking a commit**     | An `Entire-Checkpoint: <id>` trailer added by a Git hook                                                                                            | Trailers phax writes when it commits: `Run-Id`, `Phase-Id`, `Model`, `Effort`, `Gate-Log`                                                            |
| **Explaining a commit**  | `entire checkpoint explain <id or commit>`; `entire why` and `entire blame` (labs) go from a line to its commit and prompt; search across all of it | `phax records explain <commit>`: prompt, diff, gates, handoff, transcript, usage. No per-line lookup, no search                                      |
| **Running the work**     | Does not: you start the agent, in your tree, with its permissions                                                                                   | Starts the agent headlessly, each phase in its own worktree, inside the provider's sandbox by default                                                |
| **Gating the work**      | At merge, on a hosted Trail: review agents' findings, human approvals, CI checks. A commit is recorded, never gated                                 | At every phase: the project's gate commands must exit 0 before the commit; then compliance and code review findings, each with a fate                |
| **Recording other work** | Its purpose                                                                                                                                         | Does not: an ad-hoc session, or a commit you make by hand, has no record                                                                             |
| **Agents**               | Eight built-in integrations (Claude Code, Codex, Cursor, Copilot CLI, OpenCode, Antigravity, Factory Droid, Pi) and a protocol to add others        | Claude Code (default), Codex, Mistral Vibe                                                                                                           |
| **Hosted**               | entire.com: hosting and GitHub mirrors in several regions, Trails, search, session views in a browser                                               | None — local only; state under `~/.phax/`                                                                                                            |
| **Footprint**            | MIT CLI in Go for macOS, Linux and Windows; 0.x, stable and nightly channels; a funded company; hosted features free except Agent usage             | Apache-2.0; npm launcher that downloads a binary, macOS and Linux; single maintainer, pre-1.0; local only, three providers, GitHub for pull requests |

## The key distinction

Both answer "why does this commit exist?" from Git, with a trailer on the
commit and a record beside it. The difference is **who writes the record, and
so what it can contain**:

- **Entire** observes. Hooks in the agent and in Git capture a session Entire
  did not start, so it works for any session of any supported agent. The
  record is what the agent said and did; whether the change is good is decided
  later, on a Trail, by review agents, people and CI.
- **phax** drives. It starts the session and makes the commit in the same
  process, so the record also holds what phax did: the gate that had to pass,
  the plan reconciled with the diff, each finding's fate. The price is scope:
  a session phax did not start leaves no record.

So Entire is closer to **a forge that keeps every agent session with its
commit**, whoever ran it; phax is **verified delegation**: it runs the work
behind your checks and hands back the evidence with the change.

## Where Entire is ahead today

- It records every session of an enabled agent in a repository, not only the
  sessions one tool started, and imports or attaches past ones (`entire
  import`, `entire session attach`).
- It has eight built-in agent integrations and a protocol to add more; phax
  drives three providers.
- It searches sessions, commits and checkpoints (`entire search`); phax has no
  search over its records.
- It goes from a line of code to its prompt (`entire why FILE:LINE`, a labs
  command); phax explains a commit, not a line.
- It redacts detected secrets before writing a transcript; phax does not.
- It has a hosted product (repository hosting, session views in a browser,
  Trails with review agents and merge gates); phax has none, and no UI.
- Its merge gates read CI results (GitHub checks; Depot, Buildkite, Dagger and
  RWX in public preview); phax runs its gates locally and reads no CI.
- It ships an MCP server (`entire mcp`, read-only); phax ships none.
- Its CLI runs on Windows; phax builds for macOS and Linux.
- It has a funded company behind it ($60M seed, reported February 2026) and
  69 contributors on the CLI repository; phax has one maintainer.

## When each fits

- **Entire** if you want the context behind every commit kept and searchable
  across whatever agents your team uses, without changing how you run them —
  and, if you host or mirror on entire.com, a review surface where agents,
  approvals and CI gate the merge.
- **phax** if you want the work itself run behind your checks: an approved
  plan, a worktree per phase, gates that must exit green before each commit,
  file reconciliation, findings with fates and a record of all of it — on
  three providers, locally, and for phax's own runs only.

## Two things worth noting

1. **phax tested Entire's checkpoints before building its own records.** The
   [spike](../spikes/entire-checkpoint-findings.md) (August 2026, Entire
   0.10.0, phax 0.8.3) ran a five-phase phax run with Entire enabled: all five
   phase sessions were captured, each phase commit got its own checkpoint, and
   the checkpoints were readable from Git alone. The decision was still to
   build `phax/records/v1`: phax already receives the agent's stream and makes
   the commit itself, so it needs no hooks, and its record holds the gate log,
   the reconciliation and the handoff beside the transcript. The loss it
   accepted, in its words: "phax records only phax runs."
2. **They are composable.** In that spike a phax phase agent was "captured by
   entire, unmodified" once Entire's enablement was committed, and each phase
   commit carried Entire's trailer beside phax's own. That was observed with
   Claude Code at those versions and has not been run again since. Entire then
   covers what phax does not record — the sessions outside a run — which the
   spike calls "a complement to add then".
