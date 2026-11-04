Write the phax spec `commit-trailers-paths`: a phase's commit carries no path of the machine that ran it, so a
repository's history says nothing of who ran phax, nor where, nor of the folders on their disk.

## Why

Every phase commit ends with phax's trailers (`buildCommitBody` in `src/app/commit.ts`, and the interactive phase's
body beside it):

    Run-Id: <run id>
    Short-Name: <short name>
    Phase-Id: phase-02
    Phase-Title: <title>
    Model: <model>
    Effort: <effort>
    Worktree: /Users/<name>/.phax/worktrees/<namespace>.<short name>/phase-02
    Session-Id: <provider session id>
    Gate-Log: /Users/<name>/.phax/runs/<namespace>.<short name>/phase-02/checks-attempt-01.log

`Worktree` and `Gate-Log` are absolute paths under the state root, which is in the user's home: they put the user's
account name and the layout of their disk into the history of every repository phax commits to. No setting removes
them. A pull request merged by rebase or by merge keeps them on the default branch, so they reach every clone, and in a
public repository they are published: phax's own history holds them in 176 of its last 400 commits.

Nothing outside the run needs them as absolute paths. `closeStop` reads `Gate-Log` back from the commit it closes
(`src/app/closeStop.ts`, `trailerValue(message, "Gate-Log")`) to find the gate attempt that let the commit through,
while the run is still on this machine; `phax records explain` finds a phase's commits by `Phase-Id`. The record of a
phase, on the records branch, is where the run's own data belongs.

There is also an inconsistency to settle: a decision or authoring record withholds its provider session ids
(`[session id withheld]`, `src/app/recordPlumbing.ts`), while every phase commit carries `Session-Id` in clear.

## What the spec must cover

- **Which trailers a phase commit keeps**, and in which form. At least: `Worktree` and `Gate-Log` either go, or become
  relative to the state root (`runs/<namespace>.<short name>/phase-02/checks-attempt-01.log`), which names no person
  and no disk. The interactive phase's commit follows the same rule.
- **What still finds the gate attempt** when a stop is closed: the trailer in its new form, or the phase folder, which
  the run already knows. A commit written before the change must still close.
- **`Session-Id`**: kept, withheld as the records withhold it, or made a setting, with the reason.
- **Whether any of this is a setting.** A trailer that is only ever a leak is better gone than configurable; one that a
  reader of the history needs may stay on by default.
- **What phax says about history it already wrote.** Rewriting a repository's history is the user's, never phax's: the
  spec may name the trailers a user would strip (`git filter-branch --msg-filter`, `git filter-repo`) without phax
  doing it.

## Constraints

- **Additive where it can be**: `Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Model` and `Effort` keep their
  names and their meaning; `phax records explain` keeps finding a phase's commits.
- **No persisted format bumps**: a record or a run file changes only by what it no longer writes, at its current
  version.
- **phax knows no project**: the words are phax's.
- **§9 holds genuine choices only**, each with its options, what each abandons and a recommended default. At least:
  drop or relativise `Worktree` and `Gate-Log`; what becomes of `Session-Id`.

## Out of scope

- Rewriting any repository's existing history, phax's included.
- The pull request's body (the brief `code-repository` covers what it names).
- The records branch and its contents.
