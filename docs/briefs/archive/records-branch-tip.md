Write the phax spec `records-branch-tip`: a record written into a dedicated records clone always lands on top of what
the records remote already holds, so a push of `phax/records/v1` never fails for want of a common history and never
needs to be forced.

## Why

With `records.destination` `{ "kind": "repo", "remote": <url> }`, records go to a local clone of that remote
(`recordsClonePath`, under the state root), and `pushRecordsBranch` (`src/app/recordsSync.ts`) pushes
`phax/records/v1` from it. A record is one commit written by `writeTreeCommitEffect` (`src/infra/git.ts`), whose parent
is the tip of the **local** branch `refs/heads/phax/records/v1`, or none at all when that ref does not exist ("orphan on
the first write").

Two cases break the push:

- **A fresh clone of a remote that already has records.** `phax records sync` clones the remote (`git.cloneRepo`): the
  clone has `refs/remotes/origin/phax/records/v1` but no local `refs/heads/phax/records/v1` unless the records branch is
  the remote's default branch. The first record is then written as an orphan, and every record after it on top of that
  orphan. The push is refused as non-fast-forward, and the branch shares no commit with the remote's: forcing it would
  erase every record the remote held. Measured: a remote whose records branch held some 300 records, a fresh
  `phax records sync`, one run of two phases; its three records stayed pending, on a branch with no common ancestor.
- **A clone whose local branch is behind its remote.** `phax records sync` on an existing clone only fetches
  (`git.fetchRemote`): it never moves the local branch. When something else pushed records to the same remote since (a
  second machine, a second project sharing the remote, or an in-repo destination pushing to the same repository), the
  next record parents onto the stale local tip and diverges.

`phax records status` reports such records as pending and `pushRecordsBranch` reports the rejected push, but nothing
says why, nor how to bring the records home without losing either side.

## What the spec must cover

- **The parent of a record commit** in a dedicated clone: the local branch's tip when the remote-tracking branch is an
  ancestor of it, the remote-tracking tip when the local branch is missing or an ancestor of it (the local branch moved
  there first), and what happens when they have diverged.
- **What `phax records sync` does to the local branch**: create it from the remote's when it is missing, fast-forward it
  when it is behind, and refuse, naming both tips and the remedy, when it has diverged. It never resets or forces.
- **Divergence already on disk**: records written on an orphan or a stale tip before the change. Whether phax replays
  them onto the remote's tip (a record is self-contained under its `<key>/` folder, so a replay cannot conflict unless
  two records share a key), or reports them with the commands that do it.
- **The pending message**: when a push is rejected, `phax records status` and the command that wrote the record say
  whether the local branch is behind, diverged or unrelated, and what to run.
- **Two writers on one remote**: whether phax supports two projects (or an in-repo destination and a dedicated one)
  writing the same records branch of the same remote, or refuses the configuration, naming the reason.

## Constraints

- **Never forced**: no path of phax pushes `phax/records/v1` with force or resets it.
- **No persisted format bumps**: records keep their layout and manifests at their current version.
- **The in-repo destination** keeps its behaviour unless the spec shows it has the same defect.
- **phax knows no project**: the words are phax's.
- **§9 holds genuine choices only**, each with its options, what each abandons and a recommended default. At least:
  replay records written on an unrelated or stale tip, or only report them; support or refuse two writers on one
  records branch.

## Out of scope

- Moving records between remotes, and choosing a project's records remote.
- The records' contents, their transcripts and what they withhold.
