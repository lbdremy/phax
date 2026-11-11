// `phax plans status` as the runner reads it: today's unversioned `{ report, orphanRecords }`
// object as its output contract (with `applied` and `written` under `--apply`), today's report as
// its text, and the orphan-record warnings as notes. The flipped plans are the command's written
// files: each has its path from the repository root and the digest of the bytes read back.
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { applyStalenessReport, plansStalenessReport } from "../../app/planStaleness.js";
import {
  renderOrphanRecordWarning,
  renderStalenessApply,
  renderStalenessReport,
} from "../../domain/artifact/render.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { FileSystem } from "../../ports/fs.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { defineCommand, reject, Written, written } from "../commandLibrary/contract/index.js";
import { makeProviderBackendLayer, makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { configured, exposeMessage, MessageFields } from "./shared.js";

const Evidence = Schema.Union([
  Schema.Struct({ reason: Schema.Literal("spec-changed"), specPath: Schema.String }),
  Schema.Struct({
    reason: Schema.Literal("ground-changed"),
    baseline: Schema.String,
    files: Schema.Array(Schema.String),
  }),
  Schema.Struct({ reason: Schema.Literal("self-changed") }),
]);

const Verdict = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("fresh") }),
  Schema.Struct({ kind: Schema.Literal("stale"), evidence: Schema.Array(Evidence) }),
  Schema.Struct({ kind: Schema.Literal("missing-record"), detail: Schema.String }),
]);

const ReportEntry = Schema.Struct({
  path: Schema.String,
  result: Schema.Union([
    Verdict,
    Schema.Struct({ kind: Schema.Literal("error"), message: Schema.String }),
  ]),
});

const OrphanRecord = Schema.Struct({ recordFile: Schema.String, artifact: Schema.String });

const Flip = Schema.Struct({ path: Schema.String, verdict: Verdict });

/** The answer of `phax plans status`, as `--json` prints it: the unversioned object of today,
 *  carrying `applied` and `written` after the report only under `--apply`. */
const PlansStatusOutput = Schema.Union([
  Schema.Struct({
    report: Schema.Array(ReportEntry),
    orphanRecords: Schema.Array(OrphanRecord),
    applied: Schema.Array(Flip),
    written: Schema.Array(Written),
  }),
  Schema.Struct({
    report: Schema.Array(ReportEntry),
    orphanRecords: Schema.Array(OrphanRecord),
  }),
]);

const PlansStatusFlags = Schema.Struct({
  apply: Schema.optionalKey(
    Schema.Boolean.annotate({ description: "Flip stale-computed plans Approved -> Stale" }),
  ),
});

const message = (error: { readonly message: string }): string => error.message;

export const plansStatusCommand = defineCommand({
  name: "status",
  summary: "Report every Approved plan's staleness against its recorded approval",
  help: "Reports every live, Approved plan's staleness against the ground it was approved against: the declared source spec's content, the plan's own content, and the files changed since the recorded baseline intersected with the plan's footprint. Each stale entry names its reasons (spec-changed, ground-changed, self-changed) with evidence; a plan with no approval record — or one whose baseline commit no longer exists — reports missing-record, which renders as stale. This is a report, not a gate: it exits 0 whether or not stale plans exist. Use --apply to flip stale-computed plans Approved -> Stale as an explicit gesture (the flip is never automatic). Use --json for machine-readable output.\n\nSide effects: read-only unless --apply is set, in which case it writes the flipped plans' frontmatter status key.",
  examples: ["phax plans status", "phax plans status --apply", "phax plans status --json"],
  input: { flags: reject(PlansStatusFlags) },
  output: reject(PlansStatusOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const layer = Layer.mergeAll(
        makeProviderBackendLayer(DEFAULT_PROVIDER_CONFIG),
        makeRepoRootedFileSystemLayer(config),
        makeNodeGitLayer(),
        NoopSystemTelemetryLayer,
      );
      const nowIso = new Date().toISOString();
      const { report, orphanRecords } = yield* plansStalenessReport({
        repoRoot: config.repoRoot,
        stateRoot: config.stateRoot,
        model: config.extractPlanModel,
        effort: config.extractPlanEffort,
        nowIso,
      }).pipe(Effect.provide(layer));
      if (input.flags.apply !== true) return { report, orphanRecords };

      const applied = yield* applyStalenessReport(report, {
        repoRoot: config.repoRoot,
        nowIso,
        commit: true,
      }).pipe(Effect.provide(layer));
      // Each flipped plan, as the working tree holds it now.
      const writtenFiles = yield* Effect.forEach(applied, (flip) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          return yield* written(flip.path, yield* fs.readBytes(flip.path));
        }),
      ).pipe(Effect.provide(makeRepoRootedFileSystemLayer(config)));
      return { report, orphanRecords, applied, written: writtenFiles };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    ConfigValidationError: 1,
    FsError: 1,
    GitError: 1,
    ArtifactCommitFailedError: 1,
    ApprovalLedgerMigrationRequiredError: 12,
    ApprovalRecordUnreadableError: 12,
    ArtifactValidationError: 12,
    InvalidArtifactTransitionError: 12,
    SpecNotApprovedError: 12,
    SpecApprovalUnrecordedError: 12,
    SpecEditedSinceApprovalError: 12,
    SpecRetirementBlockedError: 12,
    ArtifactSidecarDivergedError: 12,
    SurfaceSummariesUnwrittenError: 12,
    ArtifactDirtyWriteSetError: 12,
  },
  errors: {
    ConfigValidationError: MessageFields,
    FsError: MessageFields,
    GitError: MessageFields,
    ArtifactCommitFailedError: MessageFields,
    ApprovalLedgerMigrationRequiredError: MessageFields,
    ApprovalRecordUnreadableError: MessageFields,
    ArtifactValidationError: MessageFields,
    InvalidArtifactTransitionError: MessageFields,
    SpecNotApprovedError: MessageFields,
    SpecApprovalUnrecordedError: MessageFields,
    SpecEditedSinceApprovalError: MessageFields,
    SpecRetirementBlockedError: MessageFields,
    ArtifactSidecarDivergedError: MessageFields,
    SurfaceSummariesUnwrittenError: MessageFields,
    ArtifactDirtyWriteSetError: MessageFields,
  },
  texts: {
    ConfigValidationError: (error) => `Config error: ${error.message}`,
    FsError: message,
    GitError: message,
    ArtifactCommitFailedError: message,
    ApprovalLedgerMigrationRequiredError: message,
    ApprovalRecordUnreadableError: message,
    ArtifactValidationError: message,
    InvalidArtifactTransitionError: message,
    SpecNotApprovedError: message,
    SpecApprovalUnrecordedError: message,
    SpecEditedSinceApprovalError: message,
    SpecRetirementBlockedError: message,
    ArtifactSidecarDivergedError: message,
    SurfaceSummariesUnwrittenError: message,
    ArtifactDirtyWriteSetError: message,
  },
  render: (value) =>
    "applied" in value
      ? `${renderStalenessReport(value.report)}\n\n${renderStalenessApply(value.applied)}`
      : renderStalenessReport(value.report),
  notes: (value) => value.orphanRecords.map(renderOrphanRecordWarning).join("\n"),
});
