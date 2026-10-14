import { Effect, Either } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError, type GitOps } from "../ports/git.js";
import type { Terminal } from "../ports/terminal.js";
import {
  type ApprovalLedgerMigrationRequiredError,
  type ApprovalRecordUnreadableError,
  ArtifactArbiterRefusedError,
  ArtifactCommitFailedError,
  ArtifactDirtyWriteSetError,
  ArtifactSidecarDivergedError,
  ArtifactValidationError,
  InvalidArtifactTransitionError,
  PlanNotApprovedError,
  SpecApprovalUnrecordedError,
  SpecEditedSinceApprovalError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
} from "../domain/errors.js";
import {
  type ArtifactKind,
  type ArtifactStatus,
  type PlanStatus,
  isTerminalStatus,
  legalTargetsFrom,
  requestTransition,
} from "../domain/artifact/status.js";
import {
  archivePathFor,
  classifyArtifactPath,
  frontmatterProblemMessage,
  validateArtifact,
} from "../domain/artifact/document.js";
import type { Arbiter, ResolvedArbiter } from "../domain/artifact/arbiter.js";
import {
  approvalVerdict,
  clearApproved,
  readSourceSpec,
  specApprovalVerdict,
  stampApproved,
} from "../domain/artifact/lineage.js";
import { decodeArtifactFrontmatter, setFrontmatterKeys } from "../domain/artifact/frontmatter.js";
import { parseArtifactName } from "../domain/artifact/name.js";
import {
  type SidecarAgreement,
  sidecarAgreement,
  sidecarPathFor,
  sidecarRemedy,
} from "../domain/artifact/sidecar.js";
import { transitionCommitMessage, transitionWriteSet } from "../domain/artifact/writeSet.js";
import {
  artifactFingerprint,
  findOrphanApprovalRecords,
  planApprovalRecordExists,
  putPlanApprovalRecord,
  putSpecApprovalRecord,
  readPlanApprovalRecord,
  readSpecApprovalRecord,
  refuseOldApprovalLedgers,
  removePlanApprovalRecord,
  removeSpecApprovalRecord,
  specApprovalRecordExists,
} from "./approvalRecordStore.js";
import {
  approvalRecordPathFor,
  type OrphanApprovalRecord,
} from "../domain/artifact/approvalRecordFile.js";
import { resolveArbiter } from "./resolveArbiter.js";

/** A spec's or plan's approval as status reports it. */
export type ApprovalInfo =
  | { readonly kind: "none" }
  | { readonly kind: "unrecorded" }
  | {
      readonly kind: "recorded";
      readonly date: string;
      readonly baseline: string;
      readonly approvedBy: Arbiter;
      readonly editedSinceApproval: boolean;
    };

export type ArtifactAuthoring =
  | { readonly kind: "interactive" }
  | {
      readonly kind: "headless";
      readonly sidecarPath: string;
      readonly agreement: SidecarAgreement;
    };

export interface ArtifactReport {
  readonly kind: ArtifactKind;
  readonly status: ArtifactStatus;
  readonly legalTargets: readonly ArtifactStatus[];
  readonly approval: ApprovalInfo;
  readonly authoring: ArtifactAuthoring;
  /** Record files of the inspected artifact's kind whose artifact does not exist. */
  readonly orphanRecords: readonly OrphanApprovalRecord[];
}

interface Sidecar {
  readonly path: string;
  readonly text: string;
  readonly agreement: SidecarAgreement;
}

// A sidecar beside the artifact marks it headless-authored; its absence,
// interactive. Agreement is computed from the two texts only.
function readSidecar(
  repoRelPath: string,
  kind: ArtifactKind,
  md: string,
): Effect.Effect<Sidecar | null, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = sidecarPathFor(repoRelPath);
    if (!(yield* fs.exists(path))) return null;
    const text = yield* fs.readText(path);
    const agreement = sidecarAgreement({ md, sidecarJson: text, kind, sidecarPath: path });
    return { path, text, agreement };
  });
}

function authoringOf(sidecar: Sidecar | null): ArtifactAuthoring {
  return sidecar === null
    ? { kind: "interactive" }
    : { kind: "headless", sidecarPath: sidecar.path, agreement: sidecar.agreement };
}

function describeDisagreement(agreement: Exclude<SidecarAgreement, "in-sync">): string {
  return agreement === "diverged"
    ? "has a body that differs from its sidecar's rendering"
    : `has an invalid sidecar (${agreement.message})`;
}

// The artifact's own record, with the fingerprint it recorded for the artifact.
function readOwnApprovalRecord(
  kind: ArtifactKind,
  repoRelPath: string,
): Effect.Effect<
  { readonly fingerprint: string; readonly approvedBy: Arbiter } | null,
  FsError | ApprovalRecordUnreadableError,
  FileSystem
> {
  return kind === "spec"
    ? Effect.map(readSpecApprovalRecord(repoRelPath), (r) =>
        r === null ? null : { fingerprint: r.specFingerprint, approvedBy: r.approvedBy },
      )
    : Effect.map(readPlanApprovalRecord(repoRelPath), (r) =>
        r === null ? null : { fingerprint: r.planFingerprint, approvedBy: r.approvedBy },
      );
}

function computeApprovalInfo(
  kind: ArtifactKind,
  repoRelPath: string,
  md: string,
  status: ArtifactStatus,
): Effect.Effect<ApprovalInfo, FsError | ApprovalRecordUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    const decoded = decodeArtifactFrontmatter(kind, md);
    const stamp = Either.isRight(decoded) ? decoded.right.approved : undefined;

    if (status !== "Approved" && stamp == null) {
      return { kind: "none" };
    }

    const record = yield* readOwnApprovalRecord(kind, repoRelPath);
    const verdict = approvalVerdict(record?.fingerprint ?? null, artifactFingerprint(md));
    if (record === null || verdict.kind === "unrecorded" || stamp == null) {
      return { kind: "unrecorded" };
    }

    return {
      kind: "recorded",
      date: stamp.date,
      baseline: stamp.baseline,
      approvedBy: record.approvedBy,
      editedSinceApproval: verdict.editedSinceApproval,
    };
  });
}

export function inspectArtifact(
  repoRelPath: string,
): Effect.Effect<
  ArtifactReport,
  | FsError
  | ArtifactValidationError
  | ApprovalRecordUnreadableError
  | ApprovalLedgerMigrationRequiredError,
  FileSystem
> {
  return Effect.gen(function* () {
    yield* refuseOldApprovalLedgers();
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

    const approval = yield* computeApprovalInfo(kind, repoRelPath, md, status);
    const authoring = authoringOf(yield* readSidecar(repoRelPath, kind, md));
    const orphanRecords = yield* findOrphanApprovalRecords(kind);

    return { kind, status, legalTargets, approval, authoring, orphanRecords };
  });
}

/** A live plan naming a reopened spec in `source-spec`: named, never touched. */
export interface BoundPlan {
  readonly path: string;
  readonly status: string;
}

export interface ArtifactTransitionResult {
  readonly status: ArtifactStatus;
  /** The status the artifact had before the transition. */
  readonly previousStatus: ArtifactStatus;
  readonly path: string;
  readonly approvedBaseline?: string;
  /** Who approved: set on every transition to Approved. */
  readonly approvedBy?: ResolvedArbiter;
  /** Who reopened: set on every transition to Draft. */
  readonly reopenedBy?: ResolvedArbiter;
  /** The artifact's own record file, when a reopen deleted it. */
  readonly deletedRecord?: string;
  /** A reopened spec's live bound plans, left as they are. */
  readonly boundPlans?: readonly BoundPlan[];
  readonly commit?: { readonly hash: string; readonly subject: string };
}

export interface TransitionArtifactOptions {
  readonly repoRoot: string;
  readonly nowIso: string;
  readonly commit: boolean;
}

/** The targets whose gesture names who performs it: the caller resolves the arbiter first. */
export type ArbitratedTarget = Extract<ArtifactStatus, "Approved" | "Draft">;

/** The options of a transition to an arbitrated target: they carry its resolved arbiter. */
export interface ArbitratedTransitionOptions extends TransitionArtifactOptions {
  readonly arbiter: ResolvedArbiter;
}

// A transition to an arbitrated target (approve or reopen) takes its arbiter;
// any other takes none, so run completion and plan staleness never name one,
// and phax never invents one.
type TransitionRequest =
  | [target: ArbitratedTarget, opts: ArbitratedTransitionOptions]
  | [target: Exclude<ArtifactStatus, ArbitratedTarget>, opts: TransitionArtifactOptions];

// Resolves a Source-Spec declaration to the spec's actual location: the declared
// path if it still lives there, else its archive/ counterpart (a spec archived
// after its dependents went terminal moves file location, but the declaration
// keeps naming the pre-archive path). Returns null when neither exists or the
// resolved path is not a spec.
export function resolveDeclaredSpec(
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
): Effect.Effect<readonly BoundPlan[], FsError | ArtifactValidationError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const plansDirExists = yield* fs.exists("docs/plans");
    if (!plansDirExists) return [];
    const entries = yield* fs.list("docs/plans");
    const specCandidates = new Set([specPath, archivePathFor(specPath)]);
    const dependents: BoundPlan[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue; // skips the archive/ subdirectory entry
      const planPath = `docs/plans/${entry}`;
      const planMd = yield* fs.readText(planPath);
      const planValidated = validateArtifact(planPath, planMd);
      if (Either.isLeft(planValidated)) {
        return yield* Effect.fail(planValidated.left);
      }
      const declaration = readSourceSpec(planMd);
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

export type TransitionArtifactError =
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
  | ArtifactDirtyWriteSetError
  | ArtifactCommitFailedError
  | GitError;

export function transitionArtifact(
  repoRelPath: string,
  ...[target, opts]: TransitionRequest
): Effect.Effect<ArtifactTransitionResult, TransitionArtifactError, FileSystem | Git> {
  // Non-null exactly on an approval: the approver its record names.
  const approver = target === "Approved" ? opts.arbiter : null;
  // Non-null exactly on a reopen: the arbiter its commit trailer names.
  const reopener = target === "Draft" ? opts.arbiter : null;
  return Effect.gen(function* () {
    // Before anything is read or written, so a refused transition (and the
    // run completion built on it) leaves the tree untouched.
    yield* refuseOldApprovalLedgers();
    const fs = yield* FileSystem;
    const git = yield* Git;
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

    // A headless artifact is approved only while its body is its sidecar's
    // rendering; other transitions carry the sidecar along whatever its state.
    const sidecar = yield* readSidecar(repoRelPath, kind, md);
    if (target === "Approved" && sidecar !== null && sidecar.agreement !== "in-sync") {
      const slug =
        parseArtifactName(kind, repoRelPath.slice(repoRelPath.lastIndexOf("/") + 1))?.slug ??
        repoRelPath;
      return yield* Effect.fail(
        new ArtifactSidecarDivergedError({
          path: repoRelPath,
          sidecarPath: sidecar.path,
          problem: describeDisagreement(sidecar.agreement),
          remedy: sidecarRemedy(kind, slug, sidecar.path),
        }),
      );
    }

    const hasRecordFile =
      kind === "plan"
        ? yield* planApprovalRecordExists(repoRelPath)
        : yield* specApprovalRecordExists(repoRelPath);
    const writeSet = transitionWriteSet(kind, repoRelPath, target, {
      hasSidecar: sidecar !== null,
      hasRecordFile,
    });
    if (opts.commit) {
      const dirty = yield* git.dirtyPaths(opts.repoRoot, writeSet);
      if (dirty.length > 0) {
        return yield* Effect.fail(new ArtifactDirtyWriteSetError({ paths: dirty }));
      }
    }

    // A reopened spec's bound plans are only named: read before anything is
    // written, never rewritten.
    const boundPlans =
      kind === "spec" && reopener !== null ? yield* findDependentPlans(repoRelPath) : null;

    const statusRewrite = setFrontmatterKeys(md, [{ key: "status", value: target }]);
    if (Either.isLeft(statusRewrite)) {
      return yield* Effect.fail(
        new ArtifactValidationError({
          path: repoRelPath,
          message: frontmatterProblemMessage(repoRelPath, kind, statusRewrite.left),
        }),
      );
    }
    let updatedMd = statusRewrite.right;
    let approvedBaseline: string | undefined;

    if (kind === "spec" && approver !== null) {
      const baseline = yield* git.headCommit(opts.repoRoot);
      const stamped = stampApproved(updatedMd, opts.nowIso, baseline.slice(0, 7));
      if (Either.isLeft(stamped)) {
        return yield* Effect.fail(
          new ArtifactValidationError({
            path: repoRelPath,
            message: frontmatterProblemMessage(repoRelPath, kind, stamped.left),
          }),
        );
      }
      updatedMd = stamped.right;
      const specFingerprint = artifactFingerprint(updatedMd);
      yield* putSpecApprovalRecord(
        repoRelPath,
        { specFingerprint, approvedAt: opts.nowIso, baseline },
        approver,
      );
      approvedBaseline = baseline;
    }

    if (kind === "plan" && approver !== null) {
      const declaration = readSourceSpec(md);
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

        const specFingerprint = artifactFingerprint(specMd);
        const specRecord = yield* readSpecApprovalRecord(resolvedSpecPath);
        const specVerdict = specApprovalVerdict(specRecord, specFingerprint);

        if (specVerdict.kind === "unrecorded") {
          return yield* Effect.fail(
            new SpecApprovalUnrecordedError({
              planPath: repoRelPath,
              specPath: declaration.path,
            }),
          );
        }

        if (specRecord !== null && specVerdict.editedSinceApproval) {
          return yield* Effect.fail(
            new SpecEditedSinceApprovalError({
              planPath: repoRelPath,
              specPath: declaration.path,
              baseline: specRecord.baseline,
            }),
          );
        }

        sourceSpec = { path: declaration.path, fingerprint: specFingerprint };
      }

      const baseline = yield* git.headCommit(opts.repoRoot);
      const stamped = stampApproved(updatedMd, opts.nowIso, baseline.slice(0, 7));
      if (Either.isLeft(stamped)) {
        return yield* Effect.fail(
          new ArtifactValidationError({
            path: repoRelPath,
            message: frontmatterProblemMessage(repoRelPath, kind, stamped.left),
          }),
        );
      }
      updatedMd = stamped.right;
      const planFingerprint = artifactFingerprint(updatedMd);
      yield* putPlanApprovalRecord(
        repoRelPath,
        { planFingerprint, approvedAt: opts.nowIso, baseline, sourceSpec },
        approver,
      );
      approvedBaseline = baseline;
    }

    // Reopen (Approved → Draft, or a plan's Stale → Draft) is the mirror of
    // completion's cleanup: the artifact is about to be rewritten, so it must
    // not keep an approval of its old text — clear both the `approved:` stamp
    // and its own record file (read first, so an unreadable one is refused,
    // not deleted). Both land before finalizeTransition commits the write-set.
    if (reopener !== null) {
      const cleared = clearApproved(updatedMd);
      if (Either.isLeft(cleared)) {
        return yield* Effect.fail(
          new ArtifactValidationError({
            path: repoRelPath,
            message: frontmatterProblemMessage(repoRelPath, kind, cleared.left),
          }),
        );
      }
      updatedMd = cleared.right;
      if (kind === "plan") yield* removePlanApprovalRecord(repoRelPath);
      if (kind === "spec") yield* removeSpecApprovalRecord(repoRelPath);
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
      // The sidecar's destination gets the same guard, checked before either
      // file moves.
      const sidecarDestination = sidecar !== null ? sidecarPathFor(destination) : null;
      for (const occupied of [destination, sidecarDestination]) {
        if (occupied === null || !(yield* fs.exists(occupied))) continue;
        return yield* Effect.fail(
          new ArtifactValidationError({
            path: repoRelPath,
            message: `Cannot archive ${repoRelPath}: destination ${occupied} already exists. Remove or rename it first.`,
          }),
        );
      }
      // The record file goes first: an unreadable one is refused before
      // anything moves. Run completion reads a plan missing from its source
      // path as already completed, so a move left uncommitted would be skipped.
      if (kind === "plan") yield* removePlanApprovalRecord(repoRelPath);
      if (kind === "spec") yield* removeSpecApprovalRecord(repoRelPath);
      const archiveDir = destination.slice(0, destination.lastIndexOf("/"));
      yield* fs.mkdirp(archiveDir);
      yield* fs.writeAtomic(destination, updatedMd);
      yield* fs.remove(repoRelPath);
      if (sidecar !== null && sidecarDestination !== null) {
        yield* fs.writeAtomic(sidecarDestination, sidecar.text);
        yield* fs.remove(sidecar.path);
      }
      const result: ArtifactTransitionResult = {
        status: target,
        previousStatus: status,
        path: destination,
      };
      return yield* finalizeTransition(git, kind, target, repoRelPath, writeSet, opts, result);
    }

    yield* fs.writeAtomic(repoRelPath, updatedMd);
    const recordPath = approvalRecordPathFor(kind, repoRelPath);
    const result: ArtifactTransitionResult = {
      status: target,
      previousStatus: status,
      path: repoRelPath,
      ...(approvedBaseline !== undefined ? { approvedBaseline } : {}),
      ...(approver !== null ? { approvedBy: approver } : {}),
      ...(reopener !== null ? { reopenedBy: reopener } : {}),
      ...(reopener !== null && hasRecordFile && recordPath !== null
        ? { deletedRecord: recordPath }
        : {}),
      ...(boundPlans !== null ? { boundPlans } : {}),
    };
    return yield* finalizeTransition(git, kind, target, repoRelPath, writeSet, opts, result);
  });
}

export interface TransitionArtifactByOptions extends TransitionArtifactOptions {
  /** The raw `--by` value, or undefined when it was not given. */
  readonly by: string | undefined;
}

const REFUSED_GESTURE: Readonly<Record<ArbitratedTarget, string>> = {
  Approved: "Approval refused",
  Draft: "Reopen refused",
};

function isArbitratedTarget(target: ArtifactStatus): target is ArbitratedTarget {
  return Object.hasOwn(REFUSED_GESTURE, target);
}

/**
 * A transition as a person or a script asks for it: an arbitrated target's
 * arbiter is resolved from `--by` and the terminal first, so a refusal writes
 * nothing; any other target ignores `by`.
 */
export function transitionArtifactBy(
  repoRelPath: string,
  target: ArtifactStatus,
  opts: TransitionArtifactByOptions,
): Effect.Effect<
  ArtifactTransitionResult,
  TransitionArtifactError | ArtifactArbiterRefusedError,
  FileSystem | Git | Terminal
> {
  return Effect.gen(function* () {
    const { by, ...transitionOpts } = opts;
    if (!isArbitratedTarget(target)) {
      return yield* transitionArtifact(repoRelPath, target, transitionOpts);
    }
    const arbiter = yield* resolveArbiter(by, opts.repoRoot).pipe(
      Effect.catchTag("ArtifactArbiterRefusedError", (refused) =>
        Effect.fail(
          new ArtifactArbiterRefusedError({
            message: `${REFUSED_GESTURE[target]}: ${refused.message}`,
          }),
        ),
      ),
    );
    return yield* transitionArtifact(repoRelPath, target, { ...transitionOpts, arbiter });
  });
}

// Commits exactly the transition write-set after a successful write, unless the
// write produced no diff against HEAD (the on-disk content was already identical)
// or the caller opted out.
function finalizeTransition(
  git: GitOps,
  kind: ArtifactKind,
  target: ArtifactStatus,
  repoRelPath: string,
  writeSet: readonly string[],
  opts: TransitionArtifactOptions,
  result: ArtifactTransitionResult,
): Effect.Effect<ArtifactTransitionResult, ArtifactCommitFailedError | GitError> {
  return Effect.gen(function* () {
    if (!opts.commit) return result;

    const stillDirty = yield* git.dirtyPaths(opts.repoRoot, writeSet);
    if (stillDirty.length === 0) return result;

    const { subject, body } = transitionCommitMessage(kind, target, repoRelPath, result.reopenedBy);
    const committed = yield* Effect.either(git.commitPaths(opts.repoRoot, writeSet, subject, body));
    if (Either.isLeft(committed)) {
      return yield* Effect.fail(
        new ArtifactCommitFailedError({
          paths: writeSet,
          cause: committed.left.message,
          commitMessage: { subject, body },
        }),
      );
    }

    const hash = yield* git.headCommit(opts.repoRoot);
    return { ...result, commit: { hash, subject } };
  });
}

export function checkPlanRunnable(
  planMd: string,
  planPath: string,
): Either.Either<void, PlanNotApprovedError> {
  const decoded = decodeArtifactFrontmatter("plan", planMd);
  if (Either.isLeft(decoded)) {
    if (decoded.left.kind === "missing-block") {
      return Either.left(
        new PlanNotApprovedError({
          path: planPath,
          status: "missing",
          message: `${planPath} has no frontmatter block. Add a YAML frontmatter block with "status: Approved" (via phax artifact approve) before running.`,
        }),
      );
    }
    return Either.left(
      new PlanNotApprovedError({
        path: planPath,
        status: "invalid",
        message: frontmatterProblemMessage(planPath, "plan", decoded.left),
      }),
    );
  }

  const status = decoded.right.status as PlanStatus;

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
    case "Completed":
      return new PlanNotApprovedError({
        path: planPath,
        status,
        message: `${planPath} is ${status}, a retired plan that cannot be run.`,
      });
  }
}
