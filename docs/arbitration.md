# Deciding open questions

A spec or a plan can carry questions it could not settle. `phax artifact decide` is how you answer them, in one of two modes. In interactive mode, the default, you decide in a Claude Code session under a written doctrine. In verdicts mode (`--verdicts`), you hand phax the decisions you already made, in a file, and a headless writer records them. In both modes phax checks and commits what comes out. Approval waits until no question is open.

## The flow

```bash
phax artifact new spec plan-prune --headless --brief brief.md
phax artifact status docs/specs/2609251400-plan-prune.md
#   Questions:         3 — open 3 (Q1, Q2, Q3) · arbitrated 0 (0 lifted)
#     decide with `phax artifact decide docs/specs/2609251400-plan-prune.md`
phax artifact decide docs/specs/2609251400-plan-prune.md          # framing F1–F5, then decide; accept the body diff
phax artifact approve docs/specs/2609251400-plan-prune.md --by operator
phax artifact reopen docs/specs/2609251400-plan-prune.md --by operator     # back to Draft to reconsider
phax artifact decide docs/specs/2609251400-plan-prune.md --question Q1     # re-arbitrate one question; the old verdict stays in its history
```

Interactive decide needs a terminal; both modes need a Draft artifact. Decide runs on the main checkout, never inside a phase worktree, and never inside a run: a run stays autonomous, and human input goes to the review notes.

## What happens in the session (interactive mode)

The session is facilitated, and you decide. phax prints which session it opened and the model:

```
decide spec plan-prune — framing F1–F5, then Q1, Q2, Q3 — interactive, resumed authoring session
```

It resumes the artifact's headless authoring session when phax kept its id, and starts a new one otherwise (an artifact written by hand, or whose local state is gone, always starts a new one).

**Framing first.** Before any question, the agent raises five framing questions and lets you correct the framing:

- `F1` — who consumes this, and what exactly does it read?
- `F2` — what persists, and how is it read in a year?
- `F3` — how is a thing identified without its location?
- `F4` — what can be removed?
- `F5` — does the cited doctrine still say what the operator intends?

**Then each question.** For each open question, the agent lays out its options, each with the loss it abandons, and its recommendation. For your verdict it gathers the option you chose, why, the strongest case for each abandoned option, the doctrine principles you cite, how reversible the choice is, and on a plan the phase it belongs to. When your verdict departs from the recommendation, the agent proposes the revisions to the body that it implies: requirements, surface, acceptance criteria, planning note.

When you are done, exit the session. phax then resumes it headless and asks for the revised document.

## What phax checks, and what it writes

phax does not trust the answer. Before it writes anything it checks, deterministically, that:

- the answer names its format and current shape in `$schema`;
- only the questions presented moved, and every other question is as it was;
- each verdict names one of the question's options, or the reserved `other`, as chosen, and exactly the other listed options as abandoned;
- every principle cited is one the doctrine defines;
- a verdict that departs from the recommendation names the body sections it revised, and when none departs, nothing outside the questions changed.

phax sets who decided and when on each verdict itself: the committing git identity (`GIT_COMMITTER_NAME`, or `git config user.name`) and the clock. A session cannot attribute a verdict to anyone else. A refused answer gets one corrective resume; a second refusal exits 5 and nothing is written.

phax then prints the body diff and one line per question presented, and asks `accept the body diff?`. The default is no:

```
Q1 arbitrated keep-10 — departs: revises requirements, acceptance criteria
Q2 arbitrated store (recommended)
Q3 open (not decided this session)
```

Declining writes nothing and exits 0. Accepting writes the artifact and its sidecar (a hand-authored artifact has none) and commits exactly those paths in one commit, with a `Decision-Id:` trailer. If you or anything else changed the artifact while the session ran, phax writes nothing, leaves your change in place and exits 12.

A hand-authored artifact is decided in place: phax moves each decided block to the arbitrated section with its `Decision:` block and adds to the decision log, and changes no other line outside the edits you accepted. The question sections of a hand-authored artifact must follow the §9 format; decide refuses one that does not, naming the first line that departs.

## Deciding from a verdicts file

For a person who already knows their verdicts, or for the agent or loop applying them for that person. The file holds the decisions; phax needs no interactive session. A verdicts file looks like this:

```json
{
  "$schema": "https://docs.phax.run/schemas/decide-verdicts/0.28.0.json",
  "artifact": "docs/specs/2609251400-plan-prune.md",
  "verdicts": [
    { "question": "Q1", "chosen": "keep-10", "note": "Ten is what the nightly job keeps today." },
    { "question": "Q2", "chosen": "store", "note": null },
    { "question": "Q3", "chosen": "other", "note": "Prune on size, not on count." }
  ]
}
```

Decide it, read the report, then approve:

```bash
phax artifact decide docs/specs/2609251400-plan-prune.md --verdicts verdicts.json --by operator
phax artifact approve docs/specs/2609251400-plan-prune.md --by operator
```

`--verdicts -` reads the file from stdin. `phax artifact schema verdicts` prints the file's JSON Schema.

**What the file holds.** `$schema` names the `decide-verdicts` format of the release you run; a file with none, or one stamped for another release, is refused, and phax names the URL it reads. `artifact` is the artifact's repo-relative path. phax compares it with the path you gave and never reads the artifact from it: an absolute path, or one that leaves the repository, names another artifact and is refused. `verdicts` is a non-empty list of `{ question, chosen, note }`, at most one per question. Every key is required and an unknown key is refused. A question the file does not name stays open. An arbitrated question it names is re-arbitrated, and its old verdict goes to its history even when the new choice is the same.

**`chosen` and `other`.** `chosen` is one of the question's option ids, or the reserved id `other`, which is implicit on every question and means none of the listed options. No option carries the id `other` and no recommendation names it. A verdict that chooses `other` abandons every listed option.

**The note.** `note` is your reason, a non-empty string or `null`. A verdict that departs from the question's recommendation, `other` included, must carry a note, because the writer revises the body from it; a departing verdict with `note: null` is refused. A verdict that follows the recommendation may have none. A verdict that follows cannot revise the body, so to ask for a body change, choose `other` and describe it.

**Who decided.** `--by operator` names you as git commits. A machine cannot give verdicts: `--by machine:<grant>` is refused, and a value that does not parse is refused with the parser's message. Without `--by`, decide takes you from the terminal; with no terminal and no `--by`, it is refused.

**The writer.** One headless session writes the verdicts into the revised document under the same doctrine as interactive mode: for each verdict the strongest case for an abandoned option, the principles it cites and its reversibility, and on a plan the phase. For a departing verdict it also revises the requirements, surface and acceptance criteria the choice implies, and names them in `revised`. It never adds an option. The default model is `claude-sonnet-5-5` at `medium`; `--model` and `--effort` override it. The model is routed like headless authoring's, so the session runs on the provider routing selects, not only Claude Code. A model with no equivalent on that provider runs as the concrete model routing chose, and the report names it beside the model you asked for. An effort outside `low`, `medium` and `high` is refused before any session.

**The session.** The writer resumes the artifact's kept authoring session when that session ran on the same provider as the writer, in this checkout. Otherwise it starts a new session. The report's first line says which.

**What phax checks.** Before any session, phax refuses a bad file: unreadable, not JSON, a missing or wrong `$schema`, any other violation of the format (named by its path, such as `verdicts[0].note`), another artifact, an unknown question (naming the artifact's ids), a question named twice, a chosen id that is neither listed nor `other`, a departing verdict with no note. After the session it checks the writer's answer against the file, deterministically:

- the question set is unchanged, and every question the file does not name is as it was;
- each named question is arbitrated with your `chosen`, and exactly the other listed options abandoned;
- each question keeps its id, question, options, recommendation and rationale;
- a re-arbitrated question keeps its earlier verdicts in its history;
- every principle cited is one the doctrine defines;
- a departing verdict names the body sections it revised, a following verdict names none, and when no verdict departs nothing outside the questions changed.

A refused answer gets one corrective resume; a second refusal exits 5 and nothing is written.

**`why`, `by` and `at`.** phax sets them itself, never the writer. `why` is your note verbatim, or the question's rationale when the note is null. `by` is the operator and `at` is the clock.

**The report.** phax writes and commits without asking, then prints what to read before approving: a header naming the session, the model line, one line per verdict in the artifact's order (the choice, whether it follows the recommendation or departs from it and which sections it revised, then its `why`), the questions left open, the body diff, the commit and the status.

```
decide spec plan-prune — verdicts from verdicts.json: Q1, Q2, Q3 — headless, resumed authoring session
model      claude-sonnet-5-5 / medium (built-in default) on claude-code
Q1 keep-10 departs from keep-5 — revised: requirements, acceptance criteria
   why: Ten is what the nightly job keeps today.
Q2 store (recommended)
   why: Storing is cheaper to undo than recomputing.
Q3 other departs from by-count — revised: requirements
   why: Prune on size, not on count.
…
commit     3f9a1c2 — docs(specs): decide plan-prune Q1 Q2 Q3
status     Draft — read the verdicts and the diff above, then `phax artifact approve docs/specs/2609251400-plan-prune.md`
```

`--json` prints the same report as one JSON object on stdout: `artifact`, `status`, `session`, `provider`, `model` (the concrete model the writer ran), `requestedModel`, `effort`, `verdicts` (each with `question`, `chosen`, `recommendation`, `departs`, `why`, `revised` and `by`), `open`, `diff`, `commit` (`hash` and `subject`) and `decisionId`. Progress, warnings and record lines go to stderr.

**The artifact stays Draft.** Nothing approves it. The writer revised the body, so read the verdicts and the diff before you run `phax artifact approve`.

**The commit.** The subject is the interactive one, `docs(specs|plans): decide <slug> <ids>`. The body says the verdicts were transcribed in a headless session, with the model, effort and provider. The trailers are `Artifact`, `Decided-By: operator (<name>)`, `Decided-Via: verdicts` and `Decision-Id`. An interactive decide commit has no `Decided-Via`.

**Undoing a decision.** If you approved, `phax artifact reopen <path> --by operator`, then decide again, from a corrected file or interactively: a re-arbitrated question keeps the earlier verdict in its history.

**Where it refuses.** Verdicts mode refuses, with nothing written and exit 12, in the same places interactive mode does, except for the terminal and the Claude Code model. Its own refusals come before any session: `--question` with `--verdicts`; `--json` or `--by` without `--verdicts`; a file that cannot be read or parsed; a file that does not bind to the artifact; `--by machine:<grant>`; no `--by` and no terminal; and an effort outside `low`, `medium` and `high`.

## Re-arbitrating a question

`--question <id>` presents that question alone, open or already arbitrated. A new verdict on an arbitrated question keeps the previous one in its history. To reconsider an Approved artifact, reopen it first:

```bash
phax artifact reopen docs/specs/2609251400-plan-prune.md --by operator
phax artifact decide docs/specs/2609251400-plan-prune.md --question Q1
```

An unknown id exits 12 and lists the ids the artifact has. A re-arbitration session cannot also decide the other open questions: that takes a second decide.

## The approval lock

`phax artifact approve` refuses while a question is open, headless or hand-authored, and names the ids:

```
Approval refused: docs/specs/2609251400-plan-prune.md has open questions — Q2, Q3. Answer them with `phax artifact decide docs/specs/2609251400-plan-prune.md`.
```

A hand-authored section 9 that does not parse is refused too, at its first departing line; so is one that lists an option, or a recommendation, with the reserved id `other`. A `Decision: other — …` line is accepted. An artifact with no question section is approved as before. `phax artifact status` points at decide while a question is open and lists `Approved (once no question is open)` among the legal transitions.

## Who approved

An approval record names its approver. `--by operator` is a human at a terminal, named as git commits; `--by machine:<grant>` is a loop or script acting under a grant; a record written before phax named approvers reads as `unattributed`. A verdict decided in a session or from a verdicts file is attributed to the operator who committed it. A verdict lifted from an older artifact, by `phax artifact migrate-documents`, stays `lifted` and unattributed. `phax artifact status` names the approver.

## The doctrine

The agent follows a doctrine skill chosen by the artifact's kind:

| Artifact | Skill              |
| -------- | ------------------ |
| spec     | `phax-decide-spec` |
| plan     | `phax-decide-plan` |

`phax skills install` installs these with `phax-decide-review`, the doctrine for turning a code review's findings into a plan. To change the doctrine for your project, put a copy at `.claude/skills/<skill name>/SKILL.md`: it replaces the bundled text. To add rules without replacing the skill, pass `--doctrine <file>`: phax appends the file after the skill under a `Project doctrine` heading.

A verdict may cite only the ids that open a list item in the doctrine, such as `` - `S1` **Adopt the recommendation** ``. phax refuses a `--doctrine` file that is unreadable, defines no id, or redefines an id the skill defines, before any session starts.

## Models

Interactive decide runs on Claude Code only, whatever your project's provider priority. The default is `claude-opus-5-5` at `high`; `--model` and `--effort` override it. A model outside the Claude Code catalog exits 12 before any session.

Verdicts mode is routed: the default is `claude-sonnet-5-5` at `medium`, and the session runs on the provider routing selects. When the model has no equivalent there, the writer runs as the concrete model routing chose; the report's model line and the `--json` `model` field name it, beside `requested <model>` and `requestedModel`.

## The decision record

When records are enabled, every decide session that started leaves a record on `phax/records/v1`, whether it committed, was declined, arbitrated nothing or failed. A verdicts-mode run leaves one too, with `mode: verdicts` and an outcome of committed or failed. It holds `verdicts.json` (your file exactly as given), the writer's prompt and answer, the accepted document and the body diff, with no handback prompt because the writer answers in its first turn. It names both `model` (the concrete model the writer ran) and `requestedModel`. It holds the prompt, the doctrine sources with their fingerprints, the questions presented, the accepted document and the body diff, the transcript per your `records.transcript` setting, and the model, effort and usage. It never holds a session id. `phax records explain <commit>` resolves a decide commit to it through the `Decision-Id` trailer.

## Exit codes

| Code | When                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | Decided and committed, a declined diff, nothing decided, or no open question                                  |
| 1    | Run inside a phase worktree                                                                                   |
| 5    | No document, not JSON, a wrong `$schema`, or a document the checks refuse, after one retry; nothing written |
| 8    | A provider rate or usage limit; nothing written                                                               |
| 12   | An artifact or verdicts-mode refusal, a change during the session, or a failed commit                         |

The refusals before the session starts are exit 12: an artifact that is not Draft (an Approved one names `phax artifact reopen`), a diverged sidecar or one `phax artifact migrate-documents` has not lifted, uncommitted changes on the artifact, an unknown `--question`, a bad doctrine file, or no committing git identity. Interactive mode also refuses no terminal and a model outside Claude Code. Verdicts mode's own refusals are listed under [Deciding from a verdicts file](#deciding-from-a-verdicts-file).
