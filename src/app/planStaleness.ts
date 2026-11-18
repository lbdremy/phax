import { Effect, Result } from "effect";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import {
  type ApprovalLedgerMigrationRequiredError,
  type ApprovalRecordUnreadableError,
  type ArtifactCommitFailedError,
  type ArtifactDirtyWriteSetError,
  type ArtifactSidecarDivergedError,
  ArtifactValidationError,
  type InvalidArtifactTransitionError,
  type SpecApprovalUnrecordedError,
  type SpecEditedSinceApprovalError,
  type SpecNotApprovedError,
  type SpecRetirementBlockedError,
  type SurfaceSummariesUnwrittenError,
} from "../domain/errors.js";
import {
  archivePathFor,
  classifyArtifactPath,
  validateArtifact,
} from "../domain/artifact/document.js";
import {
  computeStaleness,
  type CodeStalenessInput,
  type PlanStalenessVerdict,
} from "../domain/artifact/lineage.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type {
  StalenessFlip,
  StalenessReport,
  StalenessReportEntry,
} from "../domain/artifact/render.js";
import { buildFootprint } from "../domain/planOverlap/compute.js";
import { planInputFromPhaxPlan } from "../domain/planOverlap/fromPhaxPlan.js";
import type { OrphanApprovalRecord } from "../domain/artifact/approvalRecordFile.js";
import {
  artifactFingerprint,
  findOrphanApprovalRecords,
  readPlanApprovalRecord,
  refuseOldApprovalLedgers,
} from "./approvalRecordStore.js";
import { resolveCodeLink, type CodeLink } from "./codeLink.js";
import { transitionArtifact, type TransitionArtifactOptions } from "./artifactStatus.js";
import type { ExtractPlanError } from "./extractPlan.js";
import { loadOrExtractPlan } from "./loadOrExtractPlan.js";

// Mirrors resolveDeclaredSpec in artifactStatus.ts.
function resolveSpecPath(declaredPath: string): Effect.Effect<string | null, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const classification = classifyArtifactPath(declaredPath);
    const candidates =
      classification !== null ? [declaredPath, archivePathFor(declaredPath)] : [declaredPath];
    for (const candidate of candidates) {
      if (classifyArtifactPath(candidate)?.kind !== "spec") continue;
      const exists = yield* fs.exists(candidate);
      if (exists) return candidate;
    }
    return null;
  });
}

export interface ComputeStalenessOptions {
  readonly repoRoot: string;
  /** The project's resolved code link; null or absent when the project declares none. */
  readonly codeLink?: CodeLink | null | undefined;
}

export function computeStalenessForPlan(
  planPath: string,
  planMd: string,
  footprint: readonly string[],
  opts: ComputeStalenessOptions,
): Effect.Effect<
  PlanStalenessVerdict,
  | FsError
  | GitError
  | ArtifactValidationError
  | ApprovalRecordUnreadableError
  | ApprovalLedgerMigrationRequiredError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    yield* refuseOldApprovalLedgers();
    const record = yield* readPlanApprovalRecord(planPath);
    const codeLink = opts.codeLink ?? null;
    const placeholderCode: CodeStalenessInput =
      codeLink === null
        ? { kind: "unlinked" }
        : {
            kind: "linked",
            root: codeLink.root,
            baselineExists: true,
            changedFilesSinceBaseline: [],
          };

    if (record === null) {
      return computeStaleness({
        planPath,
        record: null,
        baselineExists: false,
        currentPlanFingerprint: "",
        currentSpecFingerprint: null,
        changedFilesSinceBaseline: [],
        footprint,
        code: placeholderCode,
      });
    }

    const git = yield* Git;
    const baselineExists = yield* git.commitExists(record.baseline, opts.repoRoot);
    if (!baselineExists) {
      return computeStaleness({
        planPath,
        record,
        baselineExists: false,
        currentPlanFingerprint: "",
        currentSpecFingerprint: null,
        changedFilesSinceBaseline: [],
        footprint,
        code: placeholderCode,
      });
    }

    const currentPlanFingerprint = artifactFingerprint(planMd);

    let currentSpecFingerprint: string | null = null;
    if (record.sourceSpec !== null) {
      const resolvedSpecPath = yield* resolveSpecPath(record.sourceSpec.path);
      if (resolvedSpecPath === null) {
        return yield* Effect.fail(
          new ArtifactValidationError({
            path: planPath,
            message: `${planPath} declares Source-Spec: ${record.sourceSpec.path}, but no spec exists at that path or its archive counterpart`,
          }),
        );
      }
      const fs = yield* FileSystem;
      const specMd = yield* fs.readText(resolvedSpecPath);
      currentSpecFingerprint = artifactFingerprint(specMd);
    }

    // Under the link the process repository's diff is never ground.
    const changedFilesSinceBaseline =
      codeLink !== null ? [] : yield* git.changedFilesSince(record.baseline, opts.repoRoot);

    let code: CodeStalenessInput = { kind: "unlinked" };
    if (codeLink !== null) {
      const codeBaseline = record.code?.baseline ?? null;
      const codeBaselineExists =
        codeBaseline === null ? true : yield* git.commitExists(codeBaseline, codeLink.path);
      code = {
        kind: "linked",
        root: codeLink.root,
        baselineExists: codeBaselineExists,
        changedFilesSinceBaseline:
          codeBaseline !== null && codeBaselineExists
            ? yield* git.changedFilesSince(codeBaseline, codeLink.path)
            : [],
      };
    }

    return computeStaleness({
      planPath,
      record,
      baselineExists: true,
      currentPlanFingerprint,
      currentSpecFingerprint,
      changedFilesSinceBaseline,
      footprint,
      code,
    });
  });
}

export interface ComputePlanStalenessOptions {
  readonly repoRoot: string;
  readonly codeLink?: CodeLink | null | undefined;
  readonly stateRoot: string;
  readonly model: string;
  readonly effort: string;
  readonly nowIso: string;
  readonly noExtract?: boolean | undefined;
}

export function computePlanStaleness(
  planPath: string,
  opts: ComputePlanStalenessOptions,
): Effect.Effect<
  PlanStalenessVerdict,
  | FsError
  | GitError
  | ArtifactValidationError
  | ExtractPlanError
  | ApprovalRecordUnreadableError
  | ApprovalLedgerMigrationRequiredError,
  FileSystem | Git | Backend
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const planMd = yield* fs.readText(planPath);

    const { plan } = yield* loadOrExtractPlan({
      planMdPath: planPath,
      model: opts.model,
      effort: opts.effort,
      stateRoot: opts.stateRoot,
      nowIso: opts.nowIso,
      noExtract: opts.noExtract,
    });

    const input = planInputFromPhaxPlan(plan, planPath, planPath);
    const footprint = buildFootprint(input);

    return yield* computeStalenessForPlan(planPath, planMd, Array.from(footprint.all), {
      repoRoot: opts.repoRoot,
      codeLink: opts.codeLink ?? null,
    });
  });
}

export interface StalenessReportOptions {
  readonly repoRoot: string;
  /** The project's config, for resolving its code link. Absent: unlinked. */
  readonly config?: ResolvedConfig | undefined;
  readonly stateRoot: string;
  readonly model: string;
  readonly effort: string;
  readonly nowIso: string;
  readonly noExtract?: boolean | undefined;
}

export interface PlansStalenessResult {
  readonly report: StalenessReport;
  /** Plan record files whose plan does not exist; they never change `report`. */
  readonly orphanRecords: readonly OrphanApprovalRecord[];
}

export function plansStalenessReport(
  opts: StalenessReportOptions,
): Effect.Effect<
  PlansStalenessResult,
  FsError | ApprovalLedgerMigrationRequiredError,
  FileSystem | Git | Backend
> {
  return Effect.gen(function* () {
    // Fails the whole command, never a per-plan error entry.
    yield* refuseOldApprovalLedgers();
    const link =
      opts.config === undefined
        ? Result.succeed(null)
        : yield* Effect.result(resolveCodeLink(opts.config));
    const report = yield* approvedPlansReport(opts, link);
    const orphanRecords = yield* findOrphanApprovalRecords("plan");
    return { report, orphanRecords };
  });
}

function approvedPlansReport(
  opts: StalenessReportOptions,
  link: Result.Result<CodeLink | null, { readonly message: string }>,
): Effect.Effect<StalenessReport, FsError, FileSystem | Git | Backend> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const plansDirExists = yield* fs.exists("docs/plans");
    if (!plansDirExists) return [];

    // Sort so the report order is stable regardless of the adapter's readdir
    // order (the Node adapter does not sort; POSIX gives no ordering guarantee).
    const entries = (yield* fs.list("docs/plans")).toSorted();
    const report: StalenessReportEntry[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue; // skips the archive/ subdirectory entry
      const planPath = `docs/plans/${entry}`;
      const planMd = yield* fs.readText(planPath);
      const validated = validateArtifact(planPath, planMd);
      if (Result.isFailure(validated)) {
        report.push({
          path: planPath,
          result: { kind: "error", message: validated.failure.message },
        });
        continue;
      }
      if (validated.success.status !== "Approved") continue;

      if (Result.isFailure(link)) {
        report.push({ path: planPath, result: { kind: "error", message: link.failure.message } });
        continue;
      }
      const verdict = yield* Effect.result(
        computePlanStaleness(planPath, { ...opts, codeLink: link.success }),
      );
      if (Result.isFailure(verdict)) {
        report.push({
          path: planPath,
          result: { kind: "error", message: verdict.failure.message },
        });
      } else {
        report.push({ path: planPath, result: verdict.success });
      }
    }

    return report;
  });
}

export function applyStalenessReport(
  report: StalenessReport,
  opts: TransitionArtifactOptions,
): Effect.Effect<
  readonly StalenessFlip[],
  | FsError
  | ApprovalRecordUnreadableError
  | ApprovalLedgerMigrationRequiredError
  | ArtifactValidationError
  | InvalidArtifactTransitionError
  | SpecNotApprovedError
  | SpecApprovalUnrecordedError
  | SpecEditedSinceApprovalError
  | SpecRetirementBlockedError
  | ArtifactSidecarDivergedError
  | SurfaceSummariesUnwrittenError
  | ArtifactDirtyWriteSetError
  | ArtifactCommitFailedError
  | GitError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const flipped: StalenessFlip[] = [];
    for (const entry of report) {
      if (entry.result.kind !== "stale" && entry.result.kind !== "missing-record") continue;
      yield* transitionArtifact(entry.path, "Stale", opts);
      flipped.push({ path: entry.path, verdict: entry.result });
    }
    return flipped;
  });
}
