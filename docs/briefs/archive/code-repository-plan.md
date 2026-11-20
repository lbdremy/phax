Write the phax plan "Process and code in two repositories" for the approved spec
`docs/specs/2611171616-code-repository.md`. It is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/code-repository.md`. These are settled; do not
reopen them:
- the four operator decisions of 2026-11-17 in §9b (q-link-side `process-side`, q-run-lifecycle `gated-artifact`,
  q-pr-names `omit`, q-record-shape `required-null`);
- everything §10 lists as settled, and its constraints. In particular: `plan-approval-record` moves to the opened
  version with a required `code` key (`{ root, baseline }` or `null`), records stamped earlier are read through the
  schema history readers as `"code": null` and never rewritten, and a project with no link sees no other change.

This plan takes every requirement, §5.1 to §5.18, every §6 surface and every §8 criterion.

Release context. 0.39.0 is released and installed; 0.40.0 is the opened version. Runs on this repository use the
installed phax. The spec's examples stamp 0.40.0; derive every stamp from the code, never from the examples.

Concurrent work. Another run (`finding-ids-and-the-findings-list`) is open and adds three formats to
`src/schemas/persisted.ts`, the schemas package and the property tests' format registry; it lands before this plan
runs. This plan's run starts after that merge, so plan against today's code but expect those files to have grown: add
to registries, never reorder or rewrite their existing entries.

What exists (read it before planning):
- **Config**: the project, local and global config layers and their schemas; how `phax validate` reports a bad field.
  §5.2 refuses `code` outside the project layer.
- **Approval**: `src/domain/artifact/approvalRecordFile.ts`, `frontmatter.ts`, the approve use case and the
  `plan-approval-record` format in `src/schemas/persisted.ts` with its history readers and frozen shapes.
- **Staleness**: `src/app/planStaleness.ts` and `computeStaleness` in `src/domain/artifact/lineage.ts` (self-changed,
  spec-changed, ground-changed, missing-record), and every caller that judges staleness (`phax run`'s preflight in
  `src/app/runPreflight.ts`, `phax plans status` with `--apply`, and any other the code shows).
- **The run**: how `phax run --plan <path>` tells a lifecycle plan from a loose one, how the run gates an artifact, and
  how a lifecycle run completes its plan (`completeRunArtifacts.ts`).
- **The pull request**: `src/app/publishRun.ts` and the body footer's Plan and Spec entries.
- **plans lint**: `src/app/lintPlan.ts`, its `files` check against the working tree.
- **The Git port**: all access to the code repository goes through it (§10).

Settle in Technical arbitrations, with the dominant loss of each, the points §10 leaves open:
- the exact spelling of the config key, the record key and the frontmatter key;
- how a linked run, started in the code repository, discovers the process repository from the plan path, and how it
  confirms that the link names the current code repository; what it does when it does not;
- whether `phax plans status --json`'s ground-changed evidence gains a field naming the code root or keeps today's
  shape;
- the exit codes of the link refusals, within the existing families.

Shape. Every §8 criterion has its own named test. Core to surface: the config link and its refusals, then the
approval record's new shape and its history reader, then staleness under the link, then the linked run, the pull
request footer and `plans lint`, docs last. Show the surface in an acceptance phase first when an acceptance provider
is configured. Tests build both repositories as temporary git repositories; none reads a real `~/.phax`, a real
credential store or the global git config. The docs are `docs/code-repository.md` (§11) and the `docs/upgrading.md`
entry §10 requires.

A counter-example found during the run is a bug in the code under test unless the test made it. Never change a
persisted format's shape or stamp except as the spec says.

Lessons from the runs on this repository:
- **knip runs at every phase's gate.** An export that only a later phase uses fails the gate. Test it in the phase
  that creates it, or export it where it is first used.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version or
  expect a `next` shape literally, except behaviour-corpus cases.
- **A changed persisted format needs its property-test entry in the same phase**: the frozen shape of the older
  `plan-approval-record` in `tests/helpers/property/formatRegistry.ts`, or the coverage test fails by name. Run that
  property file once with `pnpm test:property:deep <file>` before handing off, and record the seed and the result.
- **A new or changed flag or config key regenerates the usage spec and the CLI docs** (`pnpm gen:usage-spec`,
  `pnpm docs:cli`) in the phase that adds it.
- **After the acceptance phase, edit only the expected-failure markers in an acceptance test file.** Never retype a
  test's title.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a space
in it covers only itself. `pnpm gen:usage-spec`, `pnpm docs:cli`, `pnpm exec tsx`, `pnpm test:unit` and
`pnpm test:property:deep` are `agentCommands` entries.
