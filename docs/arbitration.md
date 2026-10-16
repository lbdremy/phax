# Deciding open questions

A spec or a plan can carry questions it could not settle. `phax artifact decide` is how you answer them: an interactive Claude Code session in which you decide, under a written doctrine, and phax checks and commits what comes out. Approval waits until no question is open.

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

decide needs a terminal and a Draft artifact. It runs on the main checkout, never inside a phase worktree, and never inside a run: a run stays autonomous, and human input goes to the review notes.

## What happens in the session

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
- each verdict names one of the question's options as chosen and exactly the others as abandoned;
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

A hand-authored section 9 that does not parse is refused too, at its first departing line. An artifact with no question section is approved as before. `phax artifact status` points at decide while a question is open and lists `Approved (once no question is open)` among the legal transitions.

## Who approved

An approval record names its approver. `--by operator` is a human at a terminal, named as git commits; `--by machine:<grant>` is a loop or script acting under a grant; a record written before phax named approvers reads as `unattributed`. A verdict decided in a session is attributed to the operator who committed it. A verdict lifted from an older artifact, by `phax artifact migrate-documents`, stays `lifted` and unattributed. `phax artifact status` names the approver.

## The doctrine

The agent follows a doctrine skill chosen by the artifact's kind:

| Artifact | Skill              |
| -------- | ------------------ |
| spec     | `phax-decide-spec` |
| plan     | `phax-decide-plan` |

`phax skills install` installs these with `phax-decide-review`, the doctrine for turning a code review's findings into a plan. To change the doctrine for your project, put a copy at `.claude/skills/<skill name>/SKILL.md`: it replaces the bundled text. To add rules without replacing the skill, pass `--doctrine <file>`: phax appends the file after the skill under a `Project doctrine` heading.

A verdict may cite only the ids that open a list item in the doctrine, such as `` - `S1` **Adopt the recommendation** ``. phax refuses a `--doctrine` file that is unreadable, defines no id, or redefines an id the skill defines, before any session starts.

## Models

decide runs on Claude Code only, whatever your project's provider priority. The default is `claude-opus-5-5` at `high`; `--model` and `--effort` override it. A model outside the Claude Code catalog exits 12 before any session.

## The decision record

When records are enabled, every decide session that started leaves a record on `phax/records/v1`, whether it committed, was declined, arbitrated nothing or failed. It holds the prompt, the doctrine sources with their fingerprints, the questions presented, the accepted document and the body diff, the transcript per your `records.transcript` setting, and the model, effort and usage. It never holds a session id. `phax records explain <commit>` resolves a decide commit to it through the `Decision-Id` trailer.

## Exit codes

| Code | When                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | Decided and committed, a declined diff, nothing decided, or no open question                                  |
| 1    | Run inside a phase worktree                                                                                   |
| 5    | No document, not JSON, a wrong `$schema`, or a document the checks refuse, after one retry; nothing written |
| 8    | A provider rate or usage limit; nothing written                                                               |
| 12   | An artifact refusal, a change during the session, or a failed commit                                          |

The refusals before the session starts are exit 12: an artifact that is not Draft (an Approved one names `phax artifact reopen`), a diverged sidecar or one `phax artifact migrate-documents` has not lifted, uncommitted changes on the artifact, no terminal, an unknown `--question`, a model outside Claude Code, a bad doctrine file, or no committing git identity.
