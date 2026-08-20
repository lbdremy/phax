---
status: Draft
date: 2026-08-20
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# phax Run Records

## 1. Context

phax already captures everything a run record would hold. A phase runs
`claude --print --output-format stream-json --verbose`, so the whole event stream flows
through phax's own process, and phax writes it to `~/.phax/runs/<name>.<shortName>/<phase>/`:
`output.jsonl` (the transcript, ~90 KB for a real phase), `prompt.md`, `diff.patch`,
`checks-attempt-NN.log`, `file-reconciliation.{json,md}`, `phase-handoff.md`, `security.json`
(the frozen policy the phase actually ran under), `model-resolution.json`, `orient-brief.json`,
`agent-binding.json`, `status.json`.

phax also already binds each phase commit to that material. Every phase commit carries
trailers written by `buildCommitBody`:

```
Run-Id: entire-checkpoint-spike-1786807559589   Phase-Id: phase-01
Short-Name: entire-checkpoint-spike             Phase-Title: Probe hook survival …
Model: claude-fable-5                           Effort: medium
Session-Id: 0d2f…                               Gate-Log: /Users/…/checks-attempt-01.log
```

(one per line in the real message; paired here for brevity)

What is missing is durability and reach. The state root is a warehouse on one laptop:
`phax archive` retires a run, nothing versions its artifacts, nothing survives the machine,
and no teammate ever sees them. A commit's trailers name a `Gate-Log` path that exists on
exactly one filesystem.

The entire.io spike (`docs/spikes/entire-checkpoint-findings.md`) answered whether to adopt an
existing tool instead. Verdict: build. Its decisions — destination, transcript policy, keying,
feature scope, setup — are settled in `NEXT_STEPS.md` and written up here, not re-litigated.

## 2. Problem

A run's evidence dies with the machine that produced it, and it never reaches anyone else.

Concretely: a reviewer looking at a line of code on `main` can reach the commit, the diff and
the trailers, but not the prompt that produced it, the gate log that admitted it, the
reconciliation that judged it, or the transcript that shows what the agent read and what it
abandoned. That material exists — it is just unversioned, unshared, and one `rm -rf ~/.phax`
away from gone. Blame stops at the commit; it should reach the intent.

The same gap blocks two queued items: compliance review can compare a diff against the plan
but not against the trajectory, and a cross-run durable context layer cannot be built on
artifacts that do not travel.

## 3. Product goal

phax versions what it already produces. Each phase's artifacts become a **record** — an
ordinary git tree on a versioned branch, written without touching the working tree, addressed
by the run and phase identifiers the commit message already carries. Records live in the
source repo when that is safe and in a dedicated private repo when it is not, are readable
offline, and travel with the project rather than with the laptop.

> Nothing needs to be captured — it needs to be versioned, and it must never land somewhere
> more readable than the code it describes.

## 4. Terminology

- **Record** — the versioned form of one phase's artifacts: the skeleton always, the
  transcript when enabled and available.
- **Skeleton** — every artifact except the transcript.
- **Record key** — `Run-Id` + `Phase-Id`. The address of a record; a commit sha is a recorded
  back-reference, never an address.
- **Records branch** — `phax/records/v1`, an orphan branch. The version is in the name.
- **Destination** — where the records branch lives: the source repo, or a dedicated records
  repo (one per project).
- **Local records clone** — the persistent clone of a dedicated records repo, under the state
  root. The read *and* write path; the network is a sync concern only.
- **Pending record** — written and committed locally, not yet pushed.

## 5. Functional requirements

### 5.1 One record per phase

WHEN a phase reaches a terminal outcome THE system SHALL write a record holding that phase's
artifacts.

The system SHALL write exactly one record per phase, regardless of how many fix-loop attempts
the phase took; every attempt's gate log belongs to that record.

WHERE a phase ends without a commit — failed, abandoned, or interrupted — THE system SHALL
still write its record, since the key does not depend on a commit existing.

IF a commit is phax's own bookkeeping and no agent session produced it THEN the system SHALL
NOT write a record for it.

### 5.2 Key and binding

The system SHALL address every record by its `Run-Id` and `Phase-Id`.

WHEN resolving the record for a commit THE system SHALL read the key from that commit's
message trailers, and SHALL NOT address any record by commit sha.

The system SHALL NOT add a new trailer to the phase commit: the key is already on the message.

IF a commit carries no `Run-Id`/`Phase-Id` trailers THEN the system SHALL report that the
commit was not produced by a phax phase — an outcome distinct from "no record for this
commit".

### 5.3 Storage

The system SHALL store records on a branch whose name carries the record format version.

WHEN writing a record THE system SHALL leave the working tree and the index unchanged.

The system SHALL store a record's own back-reference to the source commit sha, and SHALL
tolerate that sha becoming unreachable after a rebase or squash merge.

### 5.4 Destination

WHERE the source repo is private THE system SHALL store records in the source repo itself.

WHERE transcripts are enabled and the source repo is public THE system SHALL store records in
the configured records repo, which serves exactly one project.

WHERE transcripts are disabled THE system SHALL permit the source repo as the destination
whatever its visibility.

IF transcripts are enabled, the destination is the source repo, and the source repo is
detected public THEN the system SHALL refuse with the destination and the remedy named.

IF the host's visibility cannot be determined THEN the system SHALL require an explicit
acknowledgement in configuration before writing records with transcripts enabled.

### 5.5 Transcript and degradation

WHERE transcripts are disabled THE system SHALL write a skeleton record rather than no record.

WHERE the provider produced no transcript THE system SHALL write a skeleton record.

The system SHALL declare in every record which shape it holds, and SHALL report that shape
when the record is read.

WHERE a provider reports token usage outside its transcript stream THE system SHALL capture
that source alongside the transcript.

IF token usage cannot be obtained for a phase THEN the system SHALL report it as unavailable,
and SHALL NOT report it as zero.

The system SHALL NOT filter, redact, or transform the transcript it stores.

### 5.6 Setup

WHEN `phax init` runs interactively THE system SHALL ask whether to include the transcript,
then — only where §5.4 requires a dedicated destination — for the records remote, then whether
to push automatically.

WHEN `phax records init` runs THE system SHALL ask the same questions for a project that
already has a `phax.json`, and SHALL write the same configuration.

The system SHALL NOT offer a choice between the source repo and a dedicated repo: the
destination follows §5.4 and is announced, not asked.

IF the configured records repo does not exist THEN the system SHALL refuse with the remedy;
the system SHALL NOT create a repository on a hosting account.

IF a `records` configuration already exists THEN `phax records init` SHALL refuse unless
reconfiguration is explicitly requested, as `phax init` already does.

WHEN the configured destination is the source repo and transcripts are enabled THE system
SHALL state that making the repo public later publishes every transcript already stored in its
history.

IF the configured records remote is not an `https://`, `ssh://`, or `git@host:path` URL THEN
the system SHALL reject the configuration.

### 5.7 Reconciliation

WHEN `phax records sync` runs THE system SHALL make the local state match the configured
destination: clone when no local clone exists, fetch when one does, and push any pending
records.

IF a local clone exists whose origin differs from the configured remote THEN the system SHALL
refuse rather than re-point it.

IF a local-only records repo holds commits and a non-empty remote is then configured THEN the
system SHALL refuse with the remedy.

WHERE a dedicated destination is configured and no local clone exists, WHEN a run starts THE
system SHALL refuse before running any phase, naming `phax records sync` and the destination
it would clone.

### 5.8 Push

WHERE automatic push is enabled, WHEN the run is published THE system SHALL push the records
it wrote, whatever the destination.

Records mirror the work rather than lead it, and nothing is lost by waiting: the record is
already committed locally when its phase commits, so the only thing publish adds is sharing.

| the work                | its records                        |
| ----------------------- | ---------------------------------- |
| phase commit            | record commit, locally             |
| run push and publish    | record push, shared                |

IF a push fails THEN the system SHALL leave the records pending and SHALL NOT fail the run,
the phase, or the publish.

WHILE records are pending THE system SHALL report their count in `phax ls` and their detail in
`phax records status`.

### 5.9 Reading

WHEN `phax records explain <sha>` runs THE system SHALL report the phase's prompt, diff, gate
outcome, handoff, transcript availability and token usage for the commit's record.

The system SHALL resolve records from the local clone or the source repo's remote-tracking
ref, and SHALL NOT require a checked-out local records branch.

IF a record is not found locally and the remote is reachable THEN the system SHALL refresh and
re-resolve before reporting.

IF a record is not found locally and the remote is not reachable THEN the system SHALL report
that no record was found locally and the remote was not consulted — never that no record
exists.

## 6. Surface

**`phax.json`, before → after.** The two-variant `destination` discriminant is **normative**
(§5.4 admits exactly these two, and no third state); field spellings are **indicative**.

```jsonc
// before — no records block
{ "version": 1, "name": "phax", "gateProfiles": { … } }

// after — public source repo, transcripts on
{ "version": 1, "name": "phax", "gateProfiles": { … },
  "records": {
    "transcript": true,
    "destination": { "kind": "repo", "remote": "git@github.com:acme/phax-records-phax.git" },
    "autoPush": true } }

// after — private source repo
{ "version": 1, "name": "acme-api", "gateProfiles": { … },
  "records": { "transcript": true, "destination": { "kind": "in-repo" }, "autoPush": true } }
```

**Wizard block**, in `phax init` and `phax records init` (order and the announce-don't-ask
shape **normative**, wording **indicative**):

```
◇ Include the agent transcript in run records?         › Yes
│  This repo is public — records go to a dedicated private repo.
◇ Records repo remote                                  › git@github.com:acme/phax-records-phax.git
◇ Push records automatically when a run completes?      › Yes
```

**Commands** (names **normative**, output **indicative**):

```
$ phax ls
RUN                                    STATUS      PHASES   PROFILE   RECORDS
entire-checkpoint-spike-1786807559589  completed   5/5      full      2 pending
```

```
phax records init [--force]       # ask the three questions, write config, reconcile
phax records sync                 # clone or fetch, push pending
phax records status               # destination, local clone, pending count
phax records list [--run <id>]    # records present, by run and phase
phax records explain <sha>        # commit → prompt, diff, gates, handoff, transcript
```

```
$ phax records explain a726aff
phase-01 · Probe hook survival inside the run jail
run      entire-checkpoint-spike-1786807559589   model claude-fable-5 (medium)
record   full (transcript 90 KB)                 tokens 41,203 in / 8,117 out
gates    green on attempt 2 of 3
source   a726aff (not reachable — rebased or squashed)
prompt   45,263 bytes   diff  6 files, +412 −38   handoff  present

  phax records explain a726aff --prompt | --diff | --transcript | --gates
```

**Refusals** (exit code and the named cause **normative**, wording **indicative**):

```
$ phax run
✗ run refused: records destination is not set up
  destination  git@github.com:acme/phax-records-phax.git
  remedy       phax records sync
$? = 1

$ phax records init
✗ refused: transcripts enabled, records in-repo, and this repo is public
  records would be published with the code — set a records repo, or disable transcripts
$? = 1
```

```
$ phax records explain 9f31c02
✗ no record found locally; the remote was not consulted (offline)
$? = 1
```

**Records branch layout** (paths **indicative**; the versioned branch name and the absence of
any project level **normative**):

```
phax/records/v1        (orphan branch)
  <run-id>/<phase-id>/
    prompt.md  diff.patch  phase-handoff.md  security.json  status.json
    checks-attempt-01.log  checks-attempt-02.log  file-reconciliation.json
    output.jsonl                      # full records only
    record.json                       # shape, source sha, model, token usage
```

## 7. Non-goals

- **Retention.** No pruning, no cap, no expiry in v1. Records are written and kept.
- **Capturing non-phax sessions.** A record covers a phase; ad-hoc sessions in the repo are
  invisible to phax, knowingly.
- **Redaction.** No filter, no regex scrubber — the destination handles exposure (§5.4), not a
  filter that would invite trust it cannot earn.
- **Semantic search** over records, and any embedding index.
- **Cross-run summaries** — `activity`, `recap`, digest views. They consume records; they wait
  until records exist and travel.
- **Squash-merge trailer collapse.** Rebase merges preserve trailers and are the tested path.
- **Creating repositories** on anyone's hosting account.
- **A per-run opt-out.** No flag skips records for one invocation: the refusal in §5.7 already
  names its remedy, and a habitual flag would silently produce runs with no evidence.
- **Task-level granularity.** The phase is phax's unit of record.
- **A records repo shared across projects.** One per project; anything else makes access to
  one client's records imply access to another's.

## 8. Acceptance criteria

### A phase produces exactly one record

Given a phase that took two fix-loop attempts before its gates went green, when the run
completes, then one record exists under that run and phase, holding both attempts' gate logs.
(refs §5.1)

### A failed phase is still recorded

Given a phase that exhausted its fix budget and produced no commit, when the run stops, then a
record exists for it and `phax records list` shows it. (refs §5.1)

### Records survive a rebase merge

Given a run whose branch is rebase-merged so every phase commit gets a new sha, when
`phax records explain <new-sha>` runs, then it resolves the record via the commit's `Run-Id`
and `Phase-Id` trailers. (refs §5.2)

### A non-phax commit is reported as such

Given a hand-written commit with no phax trailers, when `phax records explain <sha>` runs,
then it reports that the commit was not produced by a phax phase, and exits non-zero.
(refs §5.2)

### Writing a record does not disturb the tree

Given a clean working tree, when a phase's record is written, then `git status` is unchanged.
(refs §5.3)

### Transcripts in a public repo are refused

Given a public source repo and a configuration with transcripts enabled and an in-repo
destination, when `phax records init` runs, then it refuses, names the destination, and exits
non-zero. (refs §5.4)

### Declining transcripts yields a skeleton

Given a project configured with `"transcript": false`, when a phase completes, then its record
holds `prompt.md`, `diff.patch` and the gate logs but no `output.jsonl`, and
`phax records explain` reports the record as a skeleton. (refs §5.5)

### A newcomer is refused with the remedy

Given a freshly cloned project whose `phax.json` names a records remote and no local clone,
when `phax run` starts, then it refuses before the first phase, names `phax records sync` and
the destination, and exits non-zero. (refs §5.7)

### A failing records push never fails a publish

Given automatic push enabled and a records remote that rejects the push, when the run is
published, then the publish succeeds and `phax records status` reports the records as pending.
(refs §5.8)

### Records are shared when the work is

Given automatic push enabled, when a run completes but is not published, then its records are
committed locally and absent from the remote; when the run is then published, then
`phax/records/v1` exists on the destination remote. (refs §5.8)

### Pending records are visible without asking for them

Given a run whose records failed to push, when `phax ls` runs, then its row reports the
pending count, and `phax records status` names the run and the phases. (refs §5.8)

### Token usage is reported for every provider, or declared absent

Given a phase run by `mistral-vibe`, whose transcript stream carries no usage, when
`phax records explain <sha>` runs, then it reports the phase's token usage from the captured
session statistics; and given a phase whose usage could not be captured, then it reports usage
as unavailable rather than as zero. (refs §5.5)

### A hostile records remote is rejected

Given a `phax.json` whose records remote is `ext::sh -c '…'`, when any command loads the
configuration, then it is rejected and no clone is attempted. (refs §5.6)

### A local miss offline is never reported as absence

Given a record that exists on the remote but not in the local clone, and no network, when
`phax records explain <sha>` runs, then it reports that no record was found locally and the
remote was not consulted. (refs §5.9)

## 9. Open questions for implementation planning

None outstanding. Three arbitrations were raised while drafting and are settled above rather
than left to the planner:

- **Push cadence.** Both destinations push at publish (§5.8), not at run completion. Nothing
  is lost by waiting, because the record is committed locally when its phase commits; publish
  adds sharing only, and records should be shared exactly when the work is.
- **`phax records init` on an already-configured project** refuses without an explicit
  reconfiguration flag (§5.6), mirroring `phax init` rather than inventing a second rule.
- **Pending records** are reported in both `phax ls` (count) and `phax records status`
  (detail) (§5.8); one line of duplicated output is cheaper than either omission.

The one question the plan must answer for itself is the `codex` / `mistral-vibe` transcript
shape — see §10.

## 10. Implementation-planning note

Settled, and not to be re-opened by the plan: the destination follows source-repo visibility
and is announced rather than chosen (§5.4); records are keyed by `Run-Id` + `Phase-Id`, never
by sha, and need no new trailer (§5.2); the local clone is the read and write path with the
network as a sync concern only (§5.7, §5.9); records are committed locally per phase and
pushed at publish, whatever the destination (§5.8); declining transcripts yields a skeleton
record, not no record (§5.5); one records repo per project (§7); no retention mechanism (§7).

Constraints the plan must respect:

- **Provider transcript shapes are probed, not assumed — done 2026-08-20, live, all three.**
  Every adapter already pipes the provider's raw stdout to `output.jsonl`
  (`claudeCode.ts:55`, `codexCli.ts:170`, `mistralVibe.ts:131`), so a transcript exists for
  all three and each carries tool calls with their inputs and results. What is **not**
  uniform is token usage:

  | provider              | transcript                                   | token usage                          |
  | --------------------- | -------------------------------------------- | ------------------------------------ |
  | Claude Code           | `stream-json` — assistant/user/system/result | in `output.jsonl`, `result.usage` + `total_cost_usd` |
  | codex-cli 0.144.3     | `item.completed` — `command_execution` with command, aggregated output, exit code | in `output.jsonl`, `turn.completed.usage` |
  | mistral-vibe 2.13.0   | role-keyed messages — `tool_calls` with name + JSON arguments, tool results, `reasoning_content` | **not in the stream** — `~/.vibe/logs/session/<id>/meta.json` → `.stats` |

  So §5.5's degradation rule is real, but the axis that degrades is **usage, not the
  transcript**. For vibe the plan must capture the session `meta.json` as part of the record —
  phax already reads that directory to discover the session id (`findVibeSessionId`), so the
  path is known. It is also the richest of the three: session token totals, `session_cost` in
  dollars, and `tool_calls_agreed` / `rejected` / `failed` / `succeeded`, the last of which is
  compliance-review material nothing else exposes.

- Writing a record needs git object plumbing behind the existing `GitPort` — the one genuinely
  new capability here. Everything else is assembling files phax already writes.
- The record shape is a persisted schema, decoded at the boundary like every other one, and
  carries no back-compat shims: new fields are required. A layout change is a new branch
  version, which is why the version is in the branch name.
- `GithubPort` needs a visibility query beside the existing `repoRecognized`, used to **refuse**
  under §5.4 — never to choose a destination.
- The setup wizard block and `phax records init` must go through one app-layer use case; the
  CLI stays a view layer.

The first consumer, once records exist, is compliance review as diff-vs-intent evidence: it
runs on the machine that ran the phases, so it needs no distribution answer and can start as
soon as records are written locally.
