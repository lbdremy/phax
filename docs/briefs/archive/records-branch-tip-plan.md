Write the phax plan "Records land on the records remote's tip" for the approved spec
`docs/specs/2611061447-records-branch-tip.md`. It is the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the three operator decisions of 2026-11-06 in §9b: q-replay `replay-flag`, q-two-writers `support`, q-in-repo-sync
  `sync-in-repo`;
- everything §10 lists as settled, and its constraints (never forced, no persisted format bump, Git port only,
  branch-state classification as pure domain logic).

Release context. 0.34.0 is released (tag v0.34.0) and installed; 0.35.0 is the open release. Runs on this repository use
the installed phax, so the run that implements this plan writes its own records with 0.34.0.

What already exists (read it before planning):
- `src/infra/git.ts`: `writeTreeCommitEffect` (the parent lookup on `refs/heads/<branch>`, orphan on the first write),
  `resolveRefEffect`, `cloneRepo`, `fetchRemote`.
- `src/ports/git.ts`: the Git port; any new read (merge-base, ancestry, the commits between two tips) or ref update is a
  port method with an adapter and a fake.
- `src/app/recordsSync.ts`: `reconcileRecordsSync`, `pushRecordsBranch`, `recordsClonePath`.
- `src/app/recordsStatus.ts`: `computeRecordsPending` (the first-parent walk §5.10 replaces).
- `src/app/recordPlumbing.ts`, `src/app/writeRecord.ts` and the other record writers (authoring, decision, review):
  every writer goes through one commit path, so the parent rule lands once.
- The places that print a refused push: `src/app/publishRun.ts`, `src/app/authorArtifact.ts`, and the decision and
  review record writers.
- `src/cli/definitions/records.ts`: `phax records sync` and `phax records status`, their text and `--json` shapes, and
  their refusal reasons. The new `--replay` flag, the `branch` field and the sync refusal follow the command library's
  contract (`phax.usage.kdl`, `docs/cli/reference.md` regenerate from it).
- The integration tests that build real git repositories for records (`tests/integration/records*.test.ts`): the
  branch states are cheap to build there with two clones of one bare remote.

Settle in Technical arbitrations, with the dominant loss of each:
- where the parent rule lives (in the Git adapter's commit, or in the app before it), and how both destinations share it;
- how a replay is written (commit-tree per record, oldest first, same tree and message), how a record's key is read for
  §5.8, and whether the previous tip is kept under a named ref (§10 leaves it open);
- how the branch state is computed (merge-base and ancestry through the port) and how pending is counted on a diverged
  or unrelated branch;
- how `phax records sync` fetches `publish.remote`'s records branch for in-repo without touching the source repository's
  working tree or its checked-out branch.

Shape. Every §8 criterion has its own named test. Domain classification first, then the port and adapter, then the
write-time parent rule, then sync (create, fast-forward, refuse, replay) for both destinations, then status and the
refused-push messages, docs last (the §11 page and `docs/upgrading.md` 0.35.0).
