import { Effect, Either } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import {
  ArtifactValidationError,
  InvalidArtifactTransitionError,
  PlanNotApprovedError,
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
}

export function transitionArtifact(
  repoRelPath: string,
  target: ArtifactStatus,
): Effect.Effect<
  ArtifactTransitionResult,
  FsError | ArtifactValidationError | InvalidArtifactTransitionError,
  FileSystem
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

    const updatedMd = replaceStatusLine(md, target);

    if (isTerminalStatus(target)) {
      const destination = archivePathFor(repoRelPath);
      const archiveDir = destination.slice(0, destination.lastIndexOf("/"));
      yield* fs.mkdirp(archiveDir);
      yield* fs.writeAtomic(destination, updatedMd);
      yield* fs.remove(repoRelPath);
      return { status: target, path: destination };
    }

    yield* fs.writeAtomic(repoRelPath, updatedMd);
    return { status: target, path: repoRelPath };
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
