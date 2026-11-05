// `phax artifact approve|stale|abandon|complete|reopen <path>` as the runner reads them: one
// definition each, from one table. Under `--json` each answers the transition's result — the
// status it reached, who gave the gesture, the bound plans it left as they are, its commit — and
// lists the files its commit holds as written-file records. Without `--json` each prints today's
// lines. `approve` and `reopen` name their arbiter with `--by`: a call without it would let a
// terminal stand for the operator, a person's gesture, so it is refused under `--json`.
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { transitionArtifactBy } from "../../app/artifactStatus.js";
import { describeArbiter } from "../../domain/artifact/arbiter.js";
import type { ArtifactStatus } from "../../domain/artifact/status.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import { ApprovedBySchema } from "../../schemas/approvedBy.js";
import { defineCommand, reject, Written } from "../commandLibrary/contract/index.js";
import {
  CommitFailedError,
  CommitFailedFields,
  exposeMessage,
  findGitRoot,
  MessageFields,
  repoPaths,
  writtenRecords,
} from "./shared.js";

const PathArg = reject(
  Schema.Tuple(
    Schema.String.annotations({
      identifier: "path",
      description: "Path to a spec or plan file under docs/specs/ or docs/plans/",
    }),
  ),
);

const ByFlag = reject(
  Schema.Struct({
    by: Schema.optionalWith(
      Schema.String.annotations({
        identifier: "arbiter",
        description: "operator or machine:<grant>; required without a terminal",
      }),
      { exact: true },
    ),
  }),
);

const Status = Schema.Literal("Draft", "Approved", "Stale", "Abandoned", "Completed");

const TransitionOutput = Schema.Struct({
  status: Status,
  previousStatus: Status,
  path: Schema.String,
  approvedBaseline: Schema.NullOr(Schema.String),
  approvedBy: Schema.NullOr(ApprovedBySchema),
  reopenedBy: Schema.NullOr(ApprovedBySchema),
  deletedRecord: Schema.NullOr(Schema.String),
  boundPlans: Schema.Array(Schema.Struct({ path: Schema.String, status: Schema.String })),
  commit: Schema.NullOr(Schema.Struct({ hash: Schema.String, subject: Schema.String })),
  written: Schema.Array(Written),
});

type TransitionOutput = typeof TransitionOutput.Type;

/** The transition to `target` of the artifact at `pathArg`, with the files it wrote read back. */
function transition(pathArg: string, target: ArtifactStatus, by: string | undefined) {
  return Effect.gen(function* () {
    const repoRoot = findGitRoot(process.cwd());
    const { repoRelPath } = repoPaths(pathArg, repoRoot);
    const result = yield* transitionArtifactBy(repoRelPath, target, {
      repoRoot,
      nowIso: new Date().toISOString(),
      commit: true,
      by,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeRootedNodeFileSystemLayer(repoRoot),
          makeNodeGitLayer(),
          NodeTerminalLayer,
        ),
      ),
      // A commit that failed leaves what the transition wrote in the working tree.
      Effect.catchTag("ArtifactCommitFailedError", (failed) =>
        Effect.flatMap(writtenRecords(failed.paths, repoRoot), (files) =>
          Effect.fail(new CommitFailedError({ message: failed.message, written: files })),
        ),
      ),
    );
    const output: TransitionOutput = {
      status: result.status,
      previousStatus: result.previousStatus,
      path: result.path,
      approvedBaseline: result.approvedBaseline ?? null,
      approvedBy: result.approvedBy ?? null,
      reopenedBy: result.reopenedBy ?? null,
      deletedRecord: result.deletedRecord ?? null,
      boundPlans: (result.boundPlans ?? []).map((plan) => ({
        path: plan.path,
        status: plan.status,
      })),
      commit: result.commit ?? null,
      written: yield* writtenRecords(result.written, repoRoot),
    };
    return output;
  }).pipe(Effect.mapError(exposeMessage));
}

/** Today's lines of a transition, from the answer alone. */
function transitionLines(value: TransitionOutput): string[] {
  const lines = [
    // Only a reopen names the record it deleted on its status line, as today.
    value.reopenedBy === null || value.deletedRecord === null
      ? `Status: ${value.status}`
      : `Status: ${value.status} (was ${value.previousStatus}; ${value.deletedRecord} deleted)`,
  ];
  if (value.approvedBy !== null) lines.push(`Approver: ${describeArbiter(value.approvedBy)}`);
  if (value.reopenedBy !== null) lines.push(`Reopened-By: ${describeArbiter(value.reopenedBy)}`);
  for (const plan of value.boundPlans) {
    lines.push(`Bound:  ${plan.path} (${plan.status}) — left as is`);
  }
  if (value.status === "Abandoned" || value.status === "Completed") {
    lines.push(`Path:   ${value.path}`);
  }
  if (value.approvedBaseline !== null)
    lines.push(`Baseline: ${value.approvedBaseline.slice(0, 7)}`);
  if (value.commit !== null) {
    lines.push(`Commit: ${value.commit.hash.slice(0, 7)} — ${value.commit.subject}`);
  }
  return lines;
}

function renderTransition(value: TransitionOutput): string {
  return transitionLines(value).join("\n");
}

// The exit codes of exitCodeForError: the lifecycle refusals are 12, a read or git failure and a
// failed commit are 1.
const exits = {
  FsError: 1,
  GitError: 1,
  ArtifactCommitFailedError: 1,
  ApprovalRecordUnreadableError: 12,
  ApprovalLedgerMigrationRequiredError: 12,
  ArtifactValidationError: 12,
  InvalidArtifactTransitionError: 12,
  SpecNotApprovedError: 12,
  SpecApprovalUnrecordedError: 12,
  SpecEditedSinceApprovalError: 12,
  SpecRetirementBlockedError: 12,
  ArtifactSidecarDivergedError: 12,
  SurfaceSummariesUnwrittenError: 12,
  ArtifactDirtyWriteSetError: 12,
  DocumentMigrationRequiredError: 12,
  ArtifactOpenQuestionsError: 12,
  ArtifactQuestionsUnparsedError: 12,
  ArtifactArbiterRefusedError: 12,
} as const;

const errors = {
  FsError: MessageFields,
  GitError: MessageFields,
  ArtifactCommitFailedError: CommitFailedFields,
  ApprovalRecordUnreadableError: MessageFields,
  ApprovalLedgerMigrationRequiredError: MessageFields,
  ArtifactValidationError: MessageFields,
  InvalidArtifactTransitionError: MessageFields,
  SpecNotApprovedError: MessageFields,
  SpecApprovalUnrecordedError: MessageFields,
  SpecEditedSinceApprovalError: MessageFields,
  SpecRetirementBlockedError: MessageFields,
  ArtifactSidecarDivergedError: MessageFields,
  SurfaceSummariesUnwrittenError: MessageFields,
  ArtifactDirtyWriteSetError: MessageFields,
  DocumentMigrationRequiredError: MessageFields,
  ArtifactOpenQuestionsError: MessageFields,
  ArtifactQuestionsUnparsedError: MessageFields,
  ArtifactArbiterRefusedError: MessageFields,
} as const;

const sentence = (error: { readonly message: string }): string => error.message;

const texts = {
  FsError: sentence,
  GitError: sentence,
  ArtifactCommitFailedError: sentence,
  ApprovalRecordUnreadableError: sentence,
  ApprovalLedgerMigrationRequiredError: sentence,
  ArtifactValidationError: sentence,
  InvalidArtifactTransitionError: sentence,
  SpecNotApprovedError: sentence,
  SpecApprovalUnrecordedError: sentence,
  SpecEditedSinceApprovalError: sentence,
  SpecRetirementBlockedError: sentence,
  ArtifactSidecarDivergedError: sentence,
  SurfaceSummariesUnwrittenError: sentence,
  ArtifactDirtyWriteSetError: sentence,
  DocumentMigrationRequiredError: sentence,
  ArtifactOpenQuestionsError: sentence,
  ArtifactQuestionsUnparsedError: sentence,
  ArtifactArbiterRefusedError: sentence,
} as const;

export const artifactApproveCommand = defineCommand({
  name: "approve",
  summary: "Transition an artifact to Approved",
  help: "Transitions an artifact to Approved. Legal from Draft (both kinds) and from Stale (plans only); re-approving an already-Approved artifact re-records the approval, refreshing its timestamp and baseline — this is the correct way to record an in-place revision of a spec, not editing the date by hand. Rewrites the frontmatter status key in place. An Approved artifact goes back to Draft only through `phax artifact reopen`, which voids the approval.\n\nEvery approval names its approver, and the approval record file records it as approvedBy. `--by machine:<grant>` declares a machine — a loop or a script — by its grant, a kebab-case slug matching ^[a-z0-9]+(-[a-z0-9]+)*$. `--by operator`, or no --by from a terminal, names the operator as git commits: GIT_COMMITTER_NAME, else the repository's git user.name, never a guessed name. Without a terminal there is no default: approve refuses with exit 12 unless --by is given, naming `--by operator` and `--by machine:<grant>`. An operator approval refuses with exit 12 when neither is set, naming `git config user.name`. A malformed --by or grant refuses with exit 12. Every refusal comes before anything is written. Approval records written before phax named the approver read as unattributed.\n\nFor specs: stamps `approved: { date, baseline }` in the frontmatter and writes the spec's approval record file, docs/specs/approvals/<spec file name>.json.\nFor plans: stamps `approved: { date, baseline }` in the frontmatter and writes the plan's approval record file, docs/plans/approvals/<plan file name>.json. Plan approval refuses with exit 12 if the declared Source-Spec is Approved but its approval is unrecorded or edited since approval — re-approve the spec first.\nFor headless-authored artifacts (either kind): approval refuses with exit 12 when the JSON document sidecar is diverged (the body differs from the sidecar's rendering) or invalid, naming the two remedies — re-author the artifact with --headless, or delete the sidecar to demote the artifact to hand-authored.\nWhile any live spec or plan sidecar is stamped below its document format's current shape, approval refuses with exit 12 before anything is written, naming each such sidecar and `phax artifact migrate-documents`.\n\nSide effects: writes the artifact file and commits the transition's write-set (the artifact file, its JSON document sidecar when headless-authored, plus its own approval record file under docs/plans/approvals/ or docs/specs/approvals/) in a single commit; no transition touches another artifact's record file. Refuses with exit code 12 if any write-set path already has uncommitted changes.",
  examples: [
    "phax artifact approve docs/plans/2607101056-typescript-7-migration-plan.md",
    "phax artifact approve docs/specs/2609030749-spec-approval-ground.md --by operator",
    "phax artifact approve docs/specs/2609030749-spec-approval-ground.md --by machine:roadmap-loop",
  ],
  input: { args: PathArg, flags: ByFlag },
  output: reject(TransitionOutput),
  // Without `--by` a terminal stands for the operator: a person's gesture, not a program's.
  prompts: (input) => input.flags.by === undefined,
  unprompted: "pass --by",
  run: ({ input }) => transition(input.args[0], "Approved", input.flags.by),
  exits,
  errors,
  texts,
  render: renderTransition,
});

export const artifactStaleCommand = defineCommand({
  name: "stale",
  summary: "Manually mark a plan Stale",
  help: "Manually marks a plan Stale. Legal from Approved only — Stale has no automatic trigger (that belongs to a future lineage spec). Rewrites the frontmatter status key in place.\n\nSide effects: writes the plan file and commits the write-set in a single commit; refuses with exit code 12 if the plan file already has uncommitted changes.",
  examples: ["phax artifact stale docs/plans/2607101056-typescript-7-migration-plan.md"],
  input: { args: PathArg },
  output: reject(TransitionOutput),
  run: ({ input }) => transition(input.args[0], "Stale", undefined),
  exits,
  errors,
  texts,
  render: renderTransition,
});

export const artifactAbandonCommand = defineCommand({
  name: "abandon",
  summary: "Abandon an artifact — terminal; moves the file to its archive/ directory",
  help: "Abandons an artifact — a terminal status distinct from Completed, for work dropped without execution. Legal from Draft or Approved (specs) or Draft, Approved, or Stale (plans).\n\nSide effects: moves the file into the artifact's archive/ subdirectory with its frontmatter status key rewritten to Abandoned, deletes its approval record file under docs/plans/approvals/ or docs/specs/approvals/ if it has one, and commits the move and the deletion in a single commit; refuses with exit code 12 if any write-set path already has uncommitted changes.",
  examples: ["phax artifact abandon docs/plans/2607101056-typescript-7-migration-plan.md"],
  input: { args: PathArg },
  output: reject(TransitionOutput),
  run: ({ input }) => transition(input.args[0], "Abandoned", undefined),
  exits,
  errors,
  texts,
  render: renderTransition,
});

export const artifactCompleteCommand = defineCommand({
  name: "complete",
  summary: "Complete an artifact — terminal; moves the file to its archive/ directory",
  help: "Completes an artifact — a terminal status for work that ran to completion. Legal from Approved (specs) or Approved or Stale (plans).\n\nSide effects: moves the file into the artifact's archive/ subdirectory with its frontmatter status key rewritten to Completed, deletes its approval record file under docs/plans/approvals/ or docs/specs/approvals/ if it has one, and commits the move and the deletion in a single commit; refuses with exit code 12 if any write-set path already has uncommitted changes.",
  examples: ["phax artifact complete docs/specs/2608091526-artifact-lifecycle-status.md"],
  input: { args: PathArg },
  output: reject(TransitionOutput),
  run: ({ input }) => transition(input.args[0], "Completed", undefined),
  exits,
  errors,
  texts,
  render: renderTransition,
});

export const artifactReopenCommand = defineCommand({
  name: "reopen",
  summary: "Reopen an Approved spec or plan, or a Stale plan, back to Draft",
  help: "Reopens an artifact back to Draft, voiding its approval, for when it must be revised before re-approval. Legal from Approved (specs and plans) and from Stale (plans only); a Draft, Completed or Abandoned artifact is refused with exit 12 and nothing is written. Rewrites the frontmatter status key in place and clears the `approved` stamp.\n\nEvery reopen names its arbiter, as approve does. `--by machine:<grant>` declares a machine by its grant, a kebab-case slug matching ^[a-z0-9]+(-[a-z0-9]+)*$. `--by operator`, or no --by from a terminal, names the operator as git commits: GIT_COMMITTER_NAME, else the repository's git user.name, never a guessed name. Without a terminal there is no default: reopen refuses with exit 12 unless --by is given, naming `--by operator` and `--by machine:<grant>`. An operator reopen refuses with exit 12 when neither is set. While any live spec or plan sidecar is stamped below its document format's current shape, reopen refuses with exit 12, naming each such sidecar and `phax artifact migrate-documents`. Every refusal comes before anything is written. The reopen commit ends with a `Reopened-By: machine (<grant>)` or `Reopened-By: operator (<name>)` trailer.\n\nReopening a spec leaves every live plan that names it in source-spec unchanged — its file, frontmatter and approval record file — and names each one with its status. Reopen changes only status and approved, which the fingerprint ignores, so a bound plan still reads fresh.\n\nSide effects: writes the artifact file, deletes its approval record file (docs/specs/approvals/<spec file name>.json or docs/plans/approvals/<plan file name>.json) if it has one, and commits them with its JSON document sidecar when headless-authored in a single commit; refuses with exit code 12 if any write-set path already has uncommitted changes.",
  examples: [
    "phax artifact reopen docs/plans/2607101056-typescript-7-migration-plan.md --by operator",
    "phax artifact reopen docs/specs/2609030749-spec-approval-ground.md --by machine:roadmap-loop",
  ],
  input: { args: PathArg, flags: ByFlag },
  output: reject(TransitionOutput),
  prompts: (input) => input.flags.by === undefined,
  unprompted: "pass --by",
  run: ({ input }) => transition(input.args[0], "Draft", input.flags.by),
  exits,
  errors,
  texts,
  render: renderTransition,
});
