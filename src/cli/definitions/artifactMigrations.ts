// `phax artifact migrate-approvals` and `phax artifact migrate-documents` as the runner reads
// them: each answers its use case's report and lists the files it wrote as written-file records,
// and prints today's lines from the report alone. An orphan approval record is a note beside the
// report, one line each.
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { migrateApprovals } from "../../app/migrateApprovals.js";
import { migrateDocuments } from "../../app/migrateDocuments.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import type { DocumentMigrationResult } from "../../domain/artifact/documentMigration.js";
import {
  renderDocumentMigrationReport,
  renderMigrationReport,
  renderOrphanRecordWarning,
} from "../../domain/artifact/render.js";
import { sidecarPathFor } from "../../domain/artifact/sidecar.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { defineCommand, reject, Written } from "../commandLibrary/contract/index.js";
import {
  CommitFailedError,
  CommitFailedFields,
  configured,
  exposeMessage,
  findGitRoot,
  MessageFields,
  writtenRecords,
} from "./shared.js";

const Commit = Schema.Struct({ hash: Schema.String, subject: Schema.String });

const ApprovalMigrationOutput = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("nothing-to-migrate"),
    written: Schema.Array(Written),
  }),
  Schema.Struct({
    kind: Schema.Literal("migrated"),
    ledgers: Schema.Array(
      Schema.Struct({ ledgerPath: Schema.String, recordFiles: Schema.Array(Schema.String) }),
    ),
    orphans: Schema.Array(Schema.Struct({ recordFile: Schema.String, artifact: Schema.String })),
    commit: Commit,
    written: Schema.Array(Written),
  }),
);

const QuestionCounts = Schema.Struct({
  open: Schema.Array(Schema.String),
  arbitrated: Schema.Number,
  lifted: Schema.Number,
});

const DocumentMigrationOutput = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("nothing-to-migrate"),
    written: Schema.Array(Written),
  }),
  Schema.Struct({
    kind: Schema.Literal("migrated"),
    groups: Schema.Array(
      Schema.Struct({
        format: Schema.Literal("spec-document", "plan-document"),
        fromShape: Schema.String,
        toShape: Schema.String,
        artifacts: Schema.Array(
          Schema.Struct({
            path: Schema.String,
            status: Schema.Literal("Draft", "Approved", "Stale", "Abandoned", "Completed"),
            questions: QuestionCounts,
            summariesToWrite: Schema.Number,
            bodyChanged: Schema.Boolean,
            editedSinceApproval: Schema.Boolean,
          }),
        ),
      }),
    ),
    stalePlans: Schema.Array(Schema.Struct({ path: Schema.String, specPath: Schema.String })),
    commit: Commit,
    written: Schema.Array(Written),
  }),
);

const sentence = (error: { readonly message: string }): string => error.message;

export const artifactMigrateApprovalsCommand = defineCommand({
  name: "migrate-approvals",
  summary: "Split the old approval ledgers into one record file per artifact (one-time)",
  help: "Reads docs/plans/approvals.json and docs/specs/approvals.json in any released shape, writes one record file per entry under docs/plans/approvals/ and docs/specs/approvals/, deletes the ledgers, and commits exactly those paths in one commit. Exits 0 when migrated or when there is nothing to migrate; exits 12, writing nothing, on an unreadable ledger, an entry that is not a live artifact path, an uncommitted change to any path it would write, or an existing record file holding a different record.\n\nAn entry whose artifact no longer exists still migrates, and is reported on stderr as an orphan record file to delete. An existing record file that already holds the entry's record is kept as is.\n\nSide effects: writes the record files, deletes the ledgers and commits those paths in one commit.",
  examples: ["phax artifact migrate-approvals"],
  input: {},
  output: reject(ApprovalMigrationOutput),
  run: () =>
    Effect.gen(function* () {
      const repoRoot = findGitRoot(process.cwd());
      const report = yield* migrateApprovals({ repoRoot }).pipe(
        Effect.provide(Layer.mergeAll(makeRootedNodeFileSystemLayer(repoRoot), makeNodeGitLayer())),
        Effect.catchTag("ArtifactCommitFailedError", (failed) =>
          Effect.flatMap(writtenRecords(failed.paths, repoRoot), (files) =>
            Effect.fail(new CommitFailedError({ message: failed.message, written: files })),
          ),
        ),
      );
      // The record files its commit holds: those it wrote, and those it found already as it
      // would have written them.
      const files =
        report.kind === "migrated"
          ? yield* writtenRecords(
              report.ledgers.flatMap((ledger) => ledger.recordFiles),
              repoRoot,
            )
          : [];
      return { ...report, written: files };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    FsError: 1,
    GitError: 1,
    ArtifactCommitFailedError: 1,
    ApprovalRecordUnreadableError: 12,
    ApprovalMigrationRefusedError: 12,
    ArtifactDirtyWriteSetError: 12,
  },
  errors: {
    FsError: MessageFields,
    GitError: MessageFields,
    ArtifactCommitFailedError: CommitFailedFields,
    ApprovalRecordUnreadableError: MessageFields,
    ApprovalMigrationRefusedError: MessageFields,
    ArtifactDirtyWriteSetError: MessageFields,
  },
  texts: {
    FsError: sentence,
    GitError: sentence,
    ArtifactCommitFailedError: sentence,
    ApprovalRecordUnreadableError: sentence,
    ApprovalMigrationRefusedError: sentence,
    ArtifactDirtyWriteSetError: sentence,
  },
  render: (value) => renderMigrationReport(value).join("\n"),
  notes: (value) =>
    value.kind === "migrated" ? value.orphans.map(renderOrphanRecordWarning).join("\n") : "",
});

export const artifactMigrateDocumentsCommand = defineCommand({
  name: "migrate-documents",
  summary:
    "Rewrite every live spec and plan sidecar below its current shape, re-rendering its body (one-time)",
  help: "Rewrites every live spec and plan sidecar (a <name>.json directly under docs/specs/ or docs/plans/ beside its <name>.md) stamped below its document format's current shape, or written before $schema, at that shape, and re-renders its body in the current layout, keeping its frontmatter byte for byte. A spec's questions are lifted by the author's rationale marker: a question whose rationale opens with `Decided by the author on <YYYY-MM-DD>` becomes arbitrated with a lifted, unattributed verdict; every other question stays open. A plan document stamped 0.20.0 lifts with empty preamble questions and keeps its body, lineage and frontmatter as they were. A plan sidecar stamped 0.26.0 or below has each phase's testStrategy string read as test lines: one whose every line follows the line format (`- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`) is lifted to those lines, and one holding prose is refused, naming the phase, its first departing line and the remedy: rewrite each phase's test strategy in the line format, in the sidecar and plan.md alike, or re-author the plan, then rerun. Archived artifacts, hand-authored artifacts and approval record files are never touched.\n\nBefore writing anything it decides everything, and exits 12, writing nothing, on an invalid sidecar (including a plan document stamped 0.17.0–0.19.x, which stays refused), on a plan sidecar whose test strategy is not in the line format, on a body that is not its sidecar's own-shape rendering (a hand edit would be overwritten), or on an uncommitted change to any path it would write; each refused artifact is named with its remedy: re-author it headless, or delete its sidecar to demote it to hand-authored.\n\nThe report names each migrated artifact with its status and question counts (open, with their ids, and arbitrated, with how many are lifted), or `body unchanged`. It names every Approved artifact the re-rendering leaves edited since approval — with its open question ids and `phax artifact reopen <path>` when it has any, else `phax artifact approve <path>` — and every live plan it leaves stale with spec-changed evidence. With nothing to migrate it says so, writes nothing and exits 0.\n\nUntil it has run, phax artifact approve and phax artifact reopen refuse with exit 12, naming each unmigrated sidecar; complete, abandon and run completion carry an older sidecar as before.\n\nSide effects: writes the sidecars and re-rendered bodies, re-seeds each rewritten plan's extraction cache so phax run never re-extracts it, and commits exactly the rewritten paths in one commit. A failed commit exits 12, leaving the files written but uncommitted.",
  examples: ["phax artifact migrate-documents"],
  input: {},
  output: reject(DocumentMigrationOutput),
  run: () =>
    Effect.gen(function* () {
      const config = yield* configured();
      const report = yield* migrateDocuments({
        repoRoot: config.repoRoot,
        stateRoot: effectiveStateRoot(config),
        extractPlanModel: config.extractPlanModel,
        extractPlanEffort: config.extractPlanEffort,
        nowIso: new Date().toISOString(),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(makeRootedNodeFileSystemLayer(config.repoRoot), makeNodeGitLayer()),
        ),
        Effect.catchTag("ArtifactCommitFailedError", (failed) =>
          Effect.flatMap(writtenRecords(failed.paths, config.repoRoot), (files) =>
            Effect.fail(new CommitFailedError({ message: failed.message, written: files })),
          ),
        ),
      );
      // Each sidecar it rewrote, and each body it re-rendered.
      const paths =
        report.kind === "migrated"
          ? report.groups.flatMap((group) =>
              group.artifacts.flatMap((artifact) =>
                artifact.bodyChanged
                  ? [artifact.path, sidecarPathFor(artifact.path)]
                  : [sidecarPathFor(artifact.path)],
              ),
            )
          : [];
      return { ...report, written: yield* writtenRecords(paths, config.repoRoot) };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    ConfigValidationError: 1,
    FsError: 1,
    GitError: 1,
    ApprovalRecordUnreadableError: 12,
    ApprovalLedgerMigrationRequiredError: 12,
    DocumentMigrationRefusedError: 12,
    ArtifactDirtyWriteSetError: 12,
    ArtifactCommitFailedError: 12,
  },
  errors: {
    ConfigValidationError: MessageFields,
    FsError: MessageFields,
    GitError: MessageFields,
    ApprovalRecordUnreadableError: MessageFields,
    ApprovalLedgerMigrationRequiredError: MessageFields,
    DocumentMigrationRefusedError: MessageFields,
    ArtifactDirtyWriteSetError: MessageFields,
    ArtifactCommitFailedError: CommitFailedFields,
  },
  texts: {
    ConfigValidationError: (error) => `Config error: ${error.message}`,
    FsError: sentence,
    GitError: sentence,
    ApprovalRecordUnreadableError: sentence,
    ApprovalLedgerMigrationRequiredError: sentence,
    DocumentMigrationRefusedError: sentence,
    ArtifactDirtyWriteSetError: sentence,
    ArtifactCommitFailedError: sentence,
  },
  // `fromShape` is a release or `pre-schema` in the use case's report; the answer holds it as text.
  render: (value) => renderDocumentMigrationReport(value as DocumentMigrationResult).join("\n"),
});
