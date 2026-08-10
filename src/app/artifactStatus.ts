import { Effect, Either } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import {
  ArtifactValidationError,
  InvalidArtifactTransitionError,
  PlanNotApprovedError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
} from "../domain/errors.js";
import {
  type ArtifactKind,
  type ArtifactStatus,
  type PlanStatus,
  isTerminalStatus,
  legalTargetsFrom,
  parsePlanStatus,
  PLAN_STATUSES,
  requestTransition,
} from "../domain/artifact/status.js";
import {
  archivePathFor,
  classifyArtifactPath,
  readStatusLine,
  replaceStatusLine,
  validateArtifact,
} from "../domain/artifact/document.js";
import { readSourceSpecLine, upsertApprovedLine } from "../domain/artifact/lineage.js";
import {
  artifactFingerprint,
  putApprovalRecord,
  removeApprovalRecord,
} from "./approvalRecordStore.js";

export interface ArtifactReport {
  readonly kind: ArtifactKind;
  readonly status: ArtifactStatus;
  readonly legalTargets: readonly ArtifactStatus[];
}

export function inspectArtifact(
  repoRelPath: string,
): Effect.Effect<ArtifactReport, FsError | ArtifactValidationError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const md = yield* fs.readText(repoRelPath);
    const validated = validateArtifact(repoRelPath, md);
    if (Either.isLeft(validated)) {
      return yield* Effect.fail(validated.left);
    }
    const { kind, status } = validated.right;
    const legalTargets =
      kind === "spec"
        ? legalTargetsFrom("spec", status as never)
        : legalTargetsFrom("plan", status as never);
    return { kind, status, legalTargets };
  });
}

export interface ArtifactTransitionResult {
  readonly status: ArtifactStatus;
  readonly path: string;
  readonly approvedBaseline?: string;
}

export interface TransitionArtifactOptions {
  readonly repoRoot: string;
  readonly nowIso: string;
}

// Resolves a Source-Spec declaration to the spec's actual location: the declared
// path if it still lives there, else its archive/ counterpart (a spec archived
// after its dependents went terminal moves file location, but the declaration
// keeps naming the pre-archive path). Returns null when neither exists or the
// resolved path is not a spec.
function resolveDeclaredSpec(
  declaredPath: string,
): Effect.Effect<string | null, FsError, FileSystem> {
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

function findDependentPlans(
  specPath: string,
): Effect.Effect<
  readonly { readonly path: string; readonly status: string }[],
  FsError | ArtifactValidationError,
  FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const plansDirExists = yield* fs.exists("docs/plans");
    if (!plansDirExists) return [];
    const entries = yield* fs.list("docs/plans");
    const specCandidates = new Set([specPath, archivePathFor(specPath)]);
    const dependents: { path: string; status: string }[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue; // skips the archive/ subdirectory entry
      const planPath = `docs/plans/${entry}`;
      const planMd = yield* fs.readText(planPath);
      const planValidated = validateArtifact(planPath, planMd);
      if (Either.isLeft(planValidated)) {
        return yield* Effect.fail(planValidated.left);
      }
      const declaration = readSourceSpecLine(planMd);
      if (
        declaration !== null &&
        declaration.kind === "spec" &&
        specCandidates.has(declaration.path)
      ) {
        dependents.push({ path: planPath, status: planValidated.right.status });
      }
    }

    return dependents;
  });
}

export function transitionArtifact(
  repoRelPath: string,
  target: ArtifactStatus,
  opts: TransitionArtifactOptions,
): Effect.Effect<
  ArtifactTransitionResult,
  | FsError
  | ArtifactValidationError
  | InvalidArtifactTransitionError
  | SpecNotApprovedError
  | SpecRetirementBlockedError
  | GitError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const md = yield* fs.readText(repoRelPath);
    const validated = validateArtifact(repoRelPath, md);
    if (Either.isLeft(validated)) {
      return yield* Effect.fail(validated.left);
    }
    const { kind, status } = validated.right;

    const requested =
      kind === "spec"
        ? requestTransition("spec", status as never, target as never)
        : requestTransition("plan", status as never, target as never);
    if (Either.isLeft(requested)) {
      return yield* Effect.fail(requested.left);
    }

    let updatedMd = replaceStatusLine(md, target);
    let approvedBaseline: string | undefined;

    if (kind === "plan" && target === "Approved") {
      const declaration = readSourceSpecLine(md);
      let sourceSpec: { path: string; fingerprint: string } | null = null;

      if (declaration !== null && declaration.kind === "spec") {
        const resolvedSpecPath = yield* resolveDeclaredSpec(declaration.path);
        if (resolvedSpecPath === null) {
          return yield* Effect.fail(
            new ArtifactValidationError({
              path: repoRelPath,
              message: `${repoRelPath} declares Source-Spec: ${declaration.path}, but no spec exists at that path or its archive counterpart`,
            }),
          );
        }
        const specMd = yield* fs.readText(resolvedSpecPath);
        const specValidated = validateArtifact(resolvedSpecPath, specMd);
        if (Either.isLeft(specValidated)) {
          return yield* Effect.fail(specValidated.left);
        }
        if (specValidated.right.status !== "Approved") {
          return yield* Effect.fail(
            new SpecNotApprovedError({
              planPath: repoRelPath,
              specPath: declaration.path,
              specStatus: specValidated.right.status,
            }),
          );
        }
        sourceSpec = { path: declaration.path, fingerprint: artifactFingerprint(specMd) };
      }

      const git = yield* Git;
      const baseline = yield* git.headCommit(opts.repoRoot);
      updatedMd = upsertApprovedLine(updatedMd, opts.nowIso, baseline.slice(0, 7));
      const planFingerprint = artifactFingerprint(updatedMd);
      yield* putApprovalRecord(repoRelPath, {
        planFingerprint,
        approvedAt: opts.nowIso,
        baseline,
        sourceSpec,
      });
      approvedBaseline = baseline;
    }

    if (kind === "spec" && isTerminalStatus(target)) {
      const dependents = yield* findDependentPlans(repoRelPath);
      if (dependents.length > 0) {
        return yield* Effect.fail(
          new SpecRetirementBlockedError({ specPath: repoRelPath, dependents }),
        );
      }
    }

    if (isTerminalStatus(target)) {
      const destination = archivePathFor(repoRelPath);
      // Never clobber an existing archived artifact (e.g. a reused plan number):
      // the move writes then deletes, so an overwrite here is silent data loss.
      const destinationExists = yield* fs.exists(destination);
      if (destinationExists) {
        return yield* Effect.fail(
          new ArtifactValidationError({
            path: repoRelPath,
            message: `Cannot archive ${repoRelPath}: destination ${destination} already exists. Remove or rename it first.`,
          }),
        );
      }
      const archiveDir = destination.slice(0, destination.lastIndexOf("/"));
      yield* fs.mkdirp(archiveDir);
      yield* fs.writeAtomic(destination, updatedMd);
      yield* fs.remove(repoRelPath);
      if (kind === "plan") {
        yield* removeApprovalRecord(repoRelPath);
      }
      return { status: target, path: destination };
    }

    yield* fs.writeAtomic(repoRelPath, updatedMd);
    return {
      status: target,
      path: repoRelPath,
      ...(approvedBaseline !== undefined ? { approvedBaseline } : {}),
    };
  });
}

export function checkPlanRunnable(
  planMd: string,
  planPath: string,
): Either.Either<void, PlanNotApprovedError> {
  const rawStatus = readStatusLine(planMd);
  if (rawStatus === null) {
    return Either.left(
      new PlanNotApprovedError({
        path: planPath,
        status: "missing",
        message: `${planPath} has no "Status:" line. Add "Status: Approved" (via phax artifact approve) before running.`,
      }),
    );
  }

  const status = parsePlanStatus(rawStatus);
  if (status === null) {
    return Either.left(
      new PlanNotApprovedError({
        path: planPath,
        status: "invalid",
        message: `${planPath} has status "${rawStatus}", which is not a valid plan status (allowed: ${PLAN_STATUSES.join(", ")}).`,
      }),
    );
  }

  const refusal = refusalFor(planPath, status);
  if (refusal !== null) {
    return Either.left(refusal);
  }

  const classification = classifyArtifactPath(planPath);
  if (classification !== null) {
    const terminal = isTerminalStatus(status);
    if (terminal !== classification.inArchive) {
      return Either.left(
        new PlanNotApprovedError({
          path: planPath,
          status,
          message: `${planPath} has status "${status}" which disagrees with its location (${terminal ? "expected it under archive/" : "expected it outside archive/"}).`,
        }),
      );
    }
  }

  return Either.right(undefined);
}

function refusalFor(planPath: string, status: PlanStatus): PlanNotApprovedError | null {
  switch (status) {
    case "Approved":
      return null;
    case "Draft":
      return new PlanNotApprovedError({
        path: planPath,
        status,
        message: `${planPath} is still in Draft status. Approve it (phax artifact approve) before running.`,
      });
    case "Stale":
      return new PlanNotApprovedError({
        path: planPath,
        status,
        message: `${planPath} is Stale. Re-plan and re-approve it before running.`,
      });
    case "Abandoned":
    case "Archived":
      return new PlanNotApprovedError({
        path: planPath,
        status,
        message: `${planPath} is ${status}, a retired plan that cannot be run.`,
      });
  }
}
