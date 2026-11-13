# Revising a Draft

A Draft spec or plan sometimes needs a change that no open question asks for: a requirement the review found missing, a phase to split, a constraint that arrived after authoring. `phax artifact revise` takes that change as an amendment, in prose, and one headless writer session returns the whole revised document. phax checks it and commits it. The artifact stays Draft.

## When to revise

- **Revise** when the artifact was authored headlessly (its JSON sidecar sits beside the `.md`), it is Draft, and the change is a change request: something to carry into the document wherever it applies.
- **[Decide](arbitration.md)** when the artifact already holds an open question for the change. A verdict answers a question; an amendment does not.
- **Re-author** (`phax artifact new … --headless`) when the change rethinks the artifact's decomposition. Revise makes a minimal edit and leaves the structure as it is.
- **Edit by hand** when the artifact was hand-authored. It has no sidecar, and revise refuses it.

## The flow

A sample amendment, `amendment.md`:

```
The identity store must also expose a purge operation for a user's records,
for the right-to-erasure requirement. Cover it in the store's phase and in
its acceptance tests; leave the other phases as they are.
```

Revise, then read the report:

```bash
phax artifact revise docs/plans/2610271402-identity-store-plan.md --amendment amendment.md --by machine:plan-loop
```

```
revise plan identity-store — amendment from amendment.md — headless, resumed authoring session
model      claude-sonnet-5-5 / medium (authoring.plan) on claude-code
questions  1 new open: Q4 — Should purge be a soft or a hard delete?
--- body diff ---
@@ …
commit     3f9c2ab — docs(plans): revise identity-store
status     Draft — read the diff above, then `phax artifact decide docs/plans/2610271402-identity-store-plan.md` (Q4 open), then `phax artifact approve docs/plans/2610271402-identity-store-plan.md`
record     revision/2610271402-identity-store/01
```

Read the diff, decide every question still open with `phax artifact decide` (the status line names them, new ones first), then approve:

```bash
phax artifact approve docs/plans/2610271402-identity-store-plan.md --by operator
```

`--amendment <file|->` reads the amendment from a file or from stdin (`-`). An empty amendment, an unreadable file, or a terminal on stdin for `-` is refused with exit 64 before anything runs.

## The writer session

One headless writer session returns the whole revised document, with the amendment carried wherever it applies and everything else left as it is.

- It **resumes the kept authoring session** when that session ran on the writer's provider in this checkout. Otherwise it starts a **new session**. The report says which (`resumed-authoring` or `new`).
- A new session also gets the kind's authoring skill (`phax-spec` or `phax-planning`) and the kept brief as background.
- The model is `--model` and `--effort`, else phax.json's `authoring.<kind>`, which carries the catalog default when phax.json sets none. It is routed to a provider like headless authoring. A model with no equivalent on the selected provider runs as the concrete model routing chose, and the report names it beside the requested one. The effort is `low`, `medium` or `high`.
- The writer runs **read-only** on whatever provider routing selects, Mistral Vibe included. No model is refused for its provider.

## What phax checks

phax checks the answer before it writes anything:

- the document carries its kind's current `$schema` and decodes;
- every existing question is unchanged and in place: an arbitrated question with its verdict and history, and every open question as it was;
- new open questions are only appended after the existing ones, with ids new to the artifact.

When a check fails, phax asks once more, resuming the same session. If the second answer fails too, the exit is 5 and nothing is written.

Existing questions are frozen. A new open question is decided later with `phax artifact decide`. A writer that inserts a new question between existing ones is refused and corrected once, even though no existing question changed.

## What it writes

- The **frontmatter is kept byte for byte**.
- **No change, no commit.** When the revised body renders the same as the current one, phax writes nothing and exits 0; the report says the amendment changed nothing.
- Otherwise phax writes the `.md` and its sidecar, re-seeds a plan's extraction cache, and commits both in **one commit, without asking**.
- The commit body carries the amendment verbatim, followed by the trailers `Artifact`, `Revised-By` and `Revision-Id`. The `Revision-Id` is `<authoringId>/<NN>`.

## Who asked: `--by`

`--by operator` or `--by machine:<grant>` names who asked for the revision. Without it, the operator is assumed when stdin is a terminal; a call without a terminal needs `--by`. A committing git identity (`user.name`) is required in every case, since the revision commits.

## `--json`

`--json` prints the report as one indented JSON object on stdout: `artifact`, `status`, `session`, `provider`, `model`, `requestedModel`, `effort`, `newQuestions`, `openQuestions` (the ids of every question open after the revision), `diff`, `commit`, `revisionId`, `written` (the files its commit holds) and `record` (the revision record's outcome). `commit` is `null` when nothing changed. Progress and warnings are note lines on stderr.

## Refusals before any session

These exit 12 and write nothing:

| Refusal                                                | Remedy                                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The artifact is Approved or Stale                      | `phax artifact reopen <path>`, then revise                                                                                                                                                   |
| The sidecar is not yet migrated                        | `phax artifact migrate-documents`                                                                                                                                                            |
| The artifact is hand-authored                          | Edit it by hand                                                                                                                                                                              |
| The sidecar has diverged from the `.md`, or is invalid | Re-author it headless (remove the artifact and its sidecar, then `phax artifact new <kind> <slug> --headless --brief <file>`), or delete the sidecar to demote the artifact to hand-authored |
| Uncommitted changes on the artifact or its sidecar     | Commit or discard them                                                                                                                                                                       |
| An unusable `--by`                                     | `operator` or `machine:<grant>`                                                                                                                                                              |
| No committing git identity                             | Set `user.name`                                                                                                                                                                              |
| A model or effort it cannot use                        | Pass a catalog model, and `low`, `medium` or `high`                                                                                                                                          |

A bad amendment (unreadable, empty, or a terminal on stdin for `-`) is exit 64, before anything runs.

## Exit codes

| Code | When                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Revised and committed, or nothing changed                                                                                             |
| 1    | Run inside a phase worktree                                                                                                           |
| 5    | No document, not JSON, a wrong `$schema`, an answer the checks refuse after one retry, or a failed agent session; nothing written     |
| 8    | A provider rate or usage limit; nothing written                                                                                       |
| 12   | A refusal, a change to the artifact during the session (left in place), or a failed commit (files left written but uncommitted)       |
| 14   | The provider is unreachable; nothing written                                                                                          |
| 64   | An amendment that cannot be read or is empty, before anything runs                                                                    |

## The session folder

phax keeps the amendment, the prompts, the answer, the body diff and the transcripts under the state root's `revise/<authoringId>/<NN>/`.

## The revision record

When records are enabled, every writer session that ran leaves one revision record on `phax/records/v1`, keyed `revision/<authoringId>/<NN>`, whether it committed, changed nothing or failed. It holds the amendment, the prompts, the accepted document, the body diff, the transcripts per your `records.transcript` setting, and the model, effort and usage. It never holds a session id.

`phax records explain <commit>` resolves a revise commit to its record through the `Revision-Id` trailer in the commit message's last paragraph. A line of the amendment shaped like a trailer never addresses another record.
