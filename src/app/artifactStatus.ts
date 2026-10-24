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
  ArtifactOpenQuestionsError,
  SurfaceSummariesUnwrittenError,
  ArtifactQuestionsUnparsedError,
  ArtifactSidecarDivergedError,
  ArtifactValidationError,
  type DocumentMigrationRequiredError,
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
import { unwrittenSummaries } from "../domain/artifact/surfaceSummaries.js";
import {
  type SidecarAgreement,
  describeStampedShape,
  inspectSidecar,
  sidecarPathFor,
  sidecarRemedy,
} from "../domain/artifact/sidecar.js";
import {
  type QuestionSummary,
  parseHandAuthoredQuestions,
  summarizeDocumentQuestions,
  summarizeParsedQuestions,
} from "../domain/artifact/questions.js";
import type { DocumentSidecar } from "../schemas/persisted.js";
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
import { refuseUnmigratedDocuments } from "./unmigratedDocuments.js";

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

/**
 * An artifact's questions as status reports them: a summary, the first line
 * of a hand-authored §9 that departs from the format, or none — a plan
 * without questions, an invalid sidecar, or a hand-authored artifact with
 * neither question section.
 */
export type ArtifactQuestions =
  | { readonly kind: "none" }
  | { readonly kind: "summary"; readonly summary: QuestionSummary }
  | { readonly kind: "departs"; readonly line: number; readonly text: string };

export interface ArtifactReport {
  readonly kind: ArtifactKind;
  readonly status: ArtifactStatus;
  readonly legalTargets: readonly ArtifactStatus[];
  readonly approval: ApprovalInfo;
  readonly authoring: ArtifactAuthoring;
  readonly questions: ArtifactQuestions;
  /** Record files of the inspected artifact's kind whose artifact does not exist. */
  readonly orphanRecords: readonly OrphanApprovalRecord[];
}

interface Sidecar {
  readonly path: string;
  readonly text: string;
  readonly agreement: SidecarAgreement;
  /** The sidecar as read, lifted to the current shape; null when it is invalid. */
  readonly read: DocumentSidecar | null;
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
    const { agreement, sidecar } = inspectSidecar({
      md,
      sidecarJson: text,
      kind,
      sidecarPath: path,
    });
    return { path, text, agreement, read: sidecar };
  });
}

function authoringOf(sidecar: Sidecar | null): ArtifactAuthoring {
  return sidecar === null
    ? { kind: "interactive" }
    : { kind: "headless", sidecarPath: sidecar.path, agreement: sidecar.agreement };
}

// A headless artifact's questions come from its sidecar, lifted when it is
// older; a hand-authored one's from its §9 sections. A plan reports questions
// only when it has some, since its question sections render only then.
function questionsOf(kind: ArtifactKind, md: string, sidecar: Sidecar | null): ArtifactQuestions {
  if (sidecar === null) {
    const parsed = parseHandAuthoredQuestions(kind, md);
    return parsed.kind === "parsed"
      ? { kind: "summary", summary: summarizeParsedQuestions(parsed) }
      : parsed;
  }
  if (sidecar.read === null) return { kind: "none" };
  const arrays =
    sidecar.read.kind === "spec" ? sidecar.read.document : sidecar.read.document.preamble;
  if (
    sidecar.read.kind === "plan" &&
    arrays.openQuestions.length === 0 &&
    arrays.arbitratedQuestions.length === 0
  ) {
    return { kind: "none" };
  }
  return { kind: "summary", summary: summarizeDocumentQuestions(arrays) };
}

function describeDisagreement(agreement: Exclude<SidecarAgreement, "in-sync">): string {
  if (agreement === "diverged") return "has a body that differs from its sidecar's rendering";
  return agreement.kind === "invalid"
    ? `has an invalid sidecar (${agreement.message})`
    : `has a sidecar stamped ${describeStampedShape(agreement.format, agreement.shape)}`;
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
    const sidecar = yield* readSidecar(repoRelPath, kind, md);
    const authoring = authoringOf(sidecar);
    const questions = questionsOf(kind, md, sidecar);
    const orphanRecords = yield* findOrphanApprovalRecords(kind);

    return { kind, status, legalTargets, approval, authoring, questions, orphanRecords };
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
  | SurfaceSummariesUnwrittenError
  | ArtifactDirtyWriteSetError
  | ArtifactCommitFailedError
  | GitError;

/** What only approve or reopen can fail with, beyond any transition's errors. */
export type ArbitratedTransitionError =
  | DocumentMigrationRequiredError
  | ArtifactOpenQuestionsError
  | ArtifactQuestionsUnparsedError;

/** The artifact as read, once its move to `target` is known legal. Writes nothing. */
function readLegalTransition(
  repoRelPath: string,
  target: ArtifactStatus,
): Effect.Effect<
  { readonly md: string; readonly kind: ArtifactKind; readonly status: ArtifactStatus },
  FsError | ArtifactValidationError | InvalidArtifactTransitionError,
  FileSystem
> {
  return Effect.gen(function* () {
    const md = yield* (yield* FileSystem).readText(repoRelPath);
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
    return { md, kind, status };
  });
}

function refuseUnwrittenSummaries(
  gesture: "Approval refused" | "Completion refused",
  path: string,
  sidecar: { readonly path: string; readonly read: DocumentSidecar | null } | null,
): Effect.Effect<void, SurfaceSummariesUnwrittenError> {
  const surfaces = unwrittenSummaries(sidecar?.read ?? null);
  return sidecar !== null && surfaces.length > 0
    ? Effect.fail(
        new SurfaceSummariesUnwrittenError({ gesture, path, sidecarPath: sidecar.path, surfaces }),
      )
    : Effect.void;
}

/** Approve or reopen: also refused while any live sidecar is unmigrated. */
export function transitionArtifact(
  repoRelPath: string,
  target: ArbitratedTarget,
  opts: ArbitratedTransitionOptions,
): Effect.Effect<
  ArtifactTransitionResult,
  TransitionArtifactError | ArbitratedTransitionError,
  FileSystem | Git
>;
/**
 * Stale, complete or abandon: carries an older sidecar as it is. Complete
 * still refuses a current-shape spec sidecar holding a summary placeholder.
 */
export function transitionArtifact(
  repoRelPath: string,
  target: Exclude<ArtifactStatus, ArbitratedTarget>,
  opts: TransitionArtifactOptions,
): Effect.Effect<ArtifactTransitionResult, TransitionArtifactError, FileSystem | Git>;
/** Any target: approve or reopen wait for migration, and approve for no open question. */
export function transitionArtifact(
  repoRelPath: string,
  ...request: TransitionRequest
): Effect.Effect<
  ArtifactTransitionResult,
  TransitionArtifactError | ArbitratedTransitionError,
  FileSystem | Git
>;
export function transitionArtifact(
  repoRelPath: string,
  ...[target, opts]: TransitionRequest
): Effect.Effect<
  ArtifactTransitionResult,
  TransitionArtifactError | ArbitratedTransitionError,
  FileSystem | Git
> {
  // Non-null exactly on an approval: the approver its record names.
  const approver = target === "Approved" ? opts.arbiter : null;
  // Non-null exactly on a reopen: the arbiter its commit trailer names.
  const reopener = target === "Draft" ? opts.arbiter : null;
  return Effect.gen(function* () {
    // Before anything is read or written, so a refused transition (and the
    // run completion built on it) leaves the tree untouched. Approve and
    // reopen also wait for every live sidecar to be migrated; complete,
    // abandon and stale carry an older sidecar as it is.
    yield* refuseOldApprovalLedgers();
    if (isArbitratedTarget(target)) yield* refuseUnmigratedDocuments(REFUSED_GESTURE[target]);
    const fs = yield* FileSystem;
    const git = yield* Git;
    const { md, kind, status } = yield* readLegalTransition(repoRelPath, target);

    // A headless artifact is approved only while its body is its sidecar's
    // rendering at the current shape; an older sidecar is migrated first.
    // Other transitions carry the sidecar along whatever its state.
    const sidecar = yield* readSidecar(repoRelPath, kind, md);
    // Completion refuses a spec whose current-shape sidecar still holds the
    // placeholder, before anything is moved or written.
    if (target === "Completed" && kind === "spec") {
      yield* refuseUnwrittenSummaries("Completion refused", repoRelPath, sidecar);
    }
    if (target === "Approved" && sidecar !== null && sidecar.agreement !== "in-sync") {
      const slug =
        parseArtifactName(kind, repoRelPath.slice(repoRelPath.lastIndexOf("/") + 1))?.slug ??
        repoRelPath;
      const unmigrated =
        typeof sidecar.agreement === "object" && sidecar.agreement.kind === "unmigrated";
      return yield* Effect.fail(
        new ArtifactSidecarDivergedError({
          path: repoRelPath,
          sidecarPath: sidecar.path,
          problem: describeDisagreement(sidecar.agreement),
          remedy: unmigrated
            ? `Run \`phax artifact migrate-documents\` first, to rewrite ${sidecar.path} at its current shape.`
            : sidecarRemedy(kind, slug, sidecar.path),
        }),
      );
    }

    if (target === "Approved") {
      yield* refuseUnwrittenSummaries("Approval refused", repoRelPath, sidecar);
    }

    // The approval lock: an artifact is approved only once no question is
    // open, read from its single source — the sidecar's arrays, or the
    // hand-authored §9. An artifact with neither question section has
    // nothing to lock.
    if (target === "Approved") {
      const questions = questionsOf(kind, md, sidecar);
      if (questions.kind === "departs") {
        return yield* Effect.fail(
          new ArtifactQuestionsUnparsedError({
            path: repoRelPath,
            line: questions.line,
            text: questions.text,
          }),
        );
      }
      if (questions.kind === "summary" && questions.summary.open.length > 0) {
        return yield* Effect.fail(
          new ArtifactOpenQuestionsError({ path: repoRelPath, open: questions.summary.open }),
        );
      }
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
 * arbiter is resolved from `--by` and the terminal before anything is written,
 * so a refusal writes nothing; any other target ignores `by`. An illegal move
 * is refused first, so reopening a Draft says it is Draft whatever `--by` says.
 */
export function transitionArtifactBy(
  repoRelPath: string,
  target: ArtifactStatus,
  opts: TransitionArtifactByOptions,
): Effect.Effect<
  ArtifactTransitionResult,
  TransitionArtifactError | ArbitratedTransitionError | ArtifactArbiterRefusedError,
  FileSystem | Git | Terminal
> {
  return Effect.gen(function* () {
    const { by, ...transitionOpts } = opts;
    if (!isArbitratedTarget(target)) {
      return yield* transitionArtifact(repoRelPath, target, transitionOpts);
    }
    yield* readLegalTransition(repoRelPath, target);
    // Before the arbiter is resolved, so an unmigrated repository refuses
    // whatever `--by` says; transitionArtifact checks again.
    yield* refuseUnmigratedDocuments(REFUSED_GESTURE[target]);
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
