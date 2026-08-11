import { Effect, Either } from "effect";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import {
  type ArtifactCommitFailedError,
  type ArtifactDirtyWriteSetError,
  ArtifactValidationError,
  type InvalidArtifactTransitionError,
  type SpecNotApprovedError,
  type SpecRetirementBlockedError,
} from "../domain/errors.js";
import {
  archivePathFor,
  classifyArtifactPath,
  validateArtifact,
} from "../domain/artifact/document.js";
import { computeStaleness, type PlanStalenessVerdict } from "../domain/artifact/lineage.js";
import type {
  StalenessFlip,
  StalenessReport,
  StalenessReportEntry,
} from "../domain/artifact/render.js";
import { buildFootprint } from "../domain/planOverlap/compute.js";
import { planInputFromPhaxPlan } from "../domain/planOverlap/fromPhaxPlan.js";
import { artifactFingerprint, readApprovalStore } from "./approvalRecordStore.js";
import { transitionArtifact, type TransitionArtifactOptions } from "./artifactStatus.js";
import type { ExtractPlanCoreError } from "./extractPlan.js";
import { loadOrExtractPlan } from "./loadOrExtractPlan.js";

// Mirrors resolveDeclaredSpec in artifactStatus.ts. Duplicated deliberately:
// this phase's boundary contract exports only readApprovalStore and
// artifactFingerprint from that phase's work, so declared-spec resolution is
// re-derived here rather than importing a phase-03 private helper.
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
}

export function computeStalenessForPlan(
  planPath: string,
  planMd: string,
  footprint: readonly string[],
  opts: ComputeStalenessOptions,
): Effect.Effect<
  PlanStalenessVerdict,
  FsError | GitError | ArtifactValidationError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const store = yield* readApprovalStore();
    const record = store.records[planPath] ?? null;

    if (record === null) {
      return computeStaleness({
        record: null,
        baselineExists: false,
        currentPlanFingerprint: "",
        currentSpecFingerprint: null,
        changedFilesSinceBaseline: [],
        footprint,
      });
    }

    const git = yield* Git;
    const baselineExists = yield* git.commitExists(record.baseline, opts.repoRoot);
    if (!baselineExists) {
      return computeStaleness({
        record,
        baselineExists: false,
        currentPlanFingerprint: "",
        currentSpecFingerprint: null,
        changedFilesSinceBaseline: [],
        footprint,
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

    const changedFilesSinceBaseline = yield* git.changedFilesSince(record.baseline, opts.repoRoot);

    return computeStaleness({
      record,
      baselineExists: true,
      currentPlanFingerprint,
      currentSpecFingerprint,
      changedFilesSinceBaseline,
      footprint,
    });
  });
}

export interface ComputePlanStalenessOptions {
  readonly repoRoot: string;
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
  FsError | GitError | ArtifactValidationError | ExtractPlanCoreError,
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
    });
  });
}

export interface StalenessReportOptions {
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly model: string;
  readonly effort: string;
  readonly nowIso: string;
  readonly noExtract?: boolean | undefined;
}

export function plansStalenessReport(
  opts: StalenessReportOptions,
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
      if (Either.isLeft(validated)) {
        report.push({ path: planPath, result: { kind: "error", message: validated.left.message } });
        continue;
      }
      if (validated.right.status !== "Approved") continue;

      const verdict = yield* Effect.either(computePlanStaleness(planPath, opts));
      if (Either.isLeft(verdict)) {
        report.push({ path: planPath, result: { kind: "error", message: verdict.left.message } });
      } else {
        report.push({ path: planPath, result: verdict.right });
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
  | ArtifactValidationError
  | InvalidArtifactTransitionError
  | SpecNotApprovedError
  | SpecRetirementBlockedError
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
