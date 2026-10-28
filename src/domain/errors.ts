import { Data } from "effect";
import type { PlanStalenessVerdict } from "./artifact/lineage.js";
import type { GateFinding } from "../schemas/gateReport.js";
import type { InteractiveSession } from "../schemas/interactiveSession.js";
import type { DeclaredReviewStop, HeldReviewStop, LastClose } from "../schemas/reviewStop.js";
import type { LintFinding } from "./plan/lint.js";
import type { PruneRefusal } from "./prune.js";
import type { SessionFailure } from "./session/outcome.js";

export class PlanValidationError extends Data.TaggedError("PlanValidationError")<{
  message: string;
  path?: string | undefined;
}> {}

/**
 * A plan the deterministic parser cannot read, so `phax plans estimate` has
 * nothing to estimate. Its message points at `phax plans lint`, which names
 * every structural problem. Exit code 1: the plan is not refused, only unread.
 */
export class PlanUnparseableError extends Data.TaggedError("PlanUnparseableError")<{
  message: string;
  path: string;
}> {}

export class ConfigValidationError extends Data.TaggedError("ConfigValidationError")<{
  message: string;
  path?: string | undefined;
}> {}

export class UnsafeGitStateError extends Data.TaggedError("UnsafeGitStateError")<{
  message: string;
  repoPath: string;
}> {}

export class WorktreeCreationError extends Data.TaggedError("WorktreeCreationError")<{
  message: string;
  branch: string;
  path: string;
}> {}

export class SetupCommandFailedError extends Data.TaggedError("SetupCommandFailedError")<{
  message: string;
  command: string;
  exitCode: number;
  stderr: string;
}> {}

export class AgentInvocationError extends Data.TaggedError("AgentInvocationError")<{
  message: string;
  exitCode?: number | undefined;
  stderr?: string | undefined;
  argv?: readonly string[];
  stderrExcerpt?: string;
  expected?: string;
  phaseFolderPath?: string | undefined;
}> {}

export class AgentSessionIdMissingError extends Data.TaggedError("AgentSessionIdMissingError")<{
  message: string;
  outputPath: string;
}> {}

/**
 * A provider session that ended without an answer, for every failure kind but
 * the limits (those raise `RateLimitError` / `UsageLimitError`). `message` is
 * the failure line `<provider> session failed (<kind>): <provider message>`;
 * the files are null when the session had no phase folder or no transcript.
 */
export class AgentSessionFailedError extends Data.TaggedError("AgentSessionFailedError")<{
  message: string;
  failure: SessionFailure;
  agentErrorLog: string | null;
  transcript: string | null;
  phaseId?: string | undefined;
}> {}

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  message: string;
  rawMessage: string;
  resetAt?: string | undefined;
  phaseId?: string | undefined;
  agentErrorLog?: string | null | undefined;
  transcript?: string | null | undefined;
}> {}

export class UsageLimitError extends Data.TaggedError("UsageLimitError")<{
  message: string;
  rawMessage: string;
  resetAt?: string | undefined;
  phaseId?: string | undefined;
  agentErrorLog?: string | null | undefined;
  transcript?: string | null | undefined;
}> {}

/** Whether an error is a failed agent session: a session failure or a limit. */
export function isSessionFailureCause(error: unknown): boolean {
  return (
    error instanceof AgentSessionFailedError ||
    error instanceof RateLimitError ||
    error instanceof UsageLimitError
  );
}

/**
 * A command's failure that also has secondary warnings (a record refused or
 * not pushed after the failed session). The use case hands them over instead
 * of printing them, so the CLI prints the cause first and each follow-up
 * after it; the exit code is the cause's.
 */
export class FailureWithFollowUpsError extends Data.TaggedError("FailureWithFollowUpsError")<{
  message: string;
  cause: unknown;
  followUps: readonly string[];
}> {}

/**
 * Fail with `cause`, wrapped with the follow-ups when there are any, else as
 * itself.
 */
export function failWithFollowUps<E>(
  cause: E,
  followUps: readonly (string | undefined)[],
): E | FailureWithFollowUpsError {
  const present = followUps.filter((line): line is string => line !== undefined);
  if (present.length === 0) return cause;
  return new FailureWithFollowUpsError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
    followUps: present,
  });
}

export class GateFailedError extends Data.TaggedError("GateFailedError")<{
  message: string;
  command: string;
  exitCode: number;
  logPath: string;
  /** The findings of a checked gate report that failed its step, with the
   *  step's 1-based position among the steps the attempt ran. Null for a log
   *  step or a broken step. */
  reportFindings: {
    readonly step: number;
    readonly findings: readonly GateFinding[];
  } | null;
  /** Which step failed: a configured gate step, or the oracle step phax
   *  appends for an oracle pair. */
  failedStep: "configured" | "oracle";
  stderrExcerpt?: string;
}> {}

export class GateAttemptsExhaustedError extends Data.TaggedError("GateAttemptsExhaustedError")<{
  message: string;
  command: string;
  exitCode: number;
  logPath: string;
  attempt: number;
  phaseId: string;
  /** Which step exhausted the fix loop: a configured gate step, or the oracle step. */
  failedStep: "configured" | "oracle";
}> {}

/** A report step printed a refused gate report: the phase stops without a fix
 *  attempt, and the operator acts on the remedy. */
export class GateStepRefusedError extends Data.TaggedError("GateStepRefusedError")<{
  message: string;
  command: string;
  reason: string;
  remedy: string;
  /** The step's exit code, which does not decide anything for a refusal. */
  exitCode: number;
  logPath: string;
  phaseId: string;
  /** Which step refused: a configured gate step, or the oracle step. */
  failedStep: "configured" | "oracle";
}> {}

export class FixAttemptFailedError extends Data.TaggedError("FixAttemptFailedError")<{
  message: string;
  attempt: number;
  sessionId: string;
}> {}

export class ArchiveBlockedByDirtyWorktreeError extends Data.TaggedError(
  "ArchiveBlockedByDirtyWorktreeError",
)<{
  message: string;
  worktreePath: string;
}> {}

export class ArchiveRefusedError extends Data.TaggedError("ArchiveRefusedError")<{
  message: string;
  shortName: string;
  state: string;
}> {}

/**
 * `phax prune` refused its whole selection before deleting anything: a named
 * run is unknown, not archived, or in another namespace. `message` lists every
 * offending run with its reason, one per line. Exits 1 through the default of
 * `exitCodeForError`.
 */
export class PruneRefusedError extends Data.TaggedError("PruneRefusedError")<{
  message: string;
  refusals: ReadonlyArray<PruneRefusal>;
}> {}

export class PhaseHadNoChangesError extends Data.TaggedError("PhaseHadNoChangesError")<{
  message: string;
  phaseId: string;
  worktreePath: string;
  runPath: string;
}> {}

export class HandoffPausedError extends Data.TaggedError("HandoffPausedError")<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

/** A first turn at a stop that did not answer: refused for an edit, or failed. */
export type FirstTurnProblem = Exclude<
  InteractiveSession["firstTurns"][number],
  { readonly outcome: "answered" }
>;

/** What a run that stopped at a declared interactive phase reports. */
export interface DeclaredStopReport {
  readonly cause: "declared";
  /** The review-stop value the reducer's effect wrote, and where. */
  readonly reviewStop: DeclaredReviewStop;
  readonly reviewStopPath: string;
  /** The first reading's markdown, or null when no first turn answered. */
  readonly firstReading: string | null;
  /** The first turn's refusal (with `keptAt`) or failure, or null when it answered. */
  readonly firstTurnProblem: FirstTurnProblem | null;
  /** True when phax has not verified the provider's interactive resume. */
  readonly unverifiedProvider: boolean;
}

/** What a run that stopped at a held phase reports. No first turn ran. */
export interface HeldStopReport {
  readonly cause: "held";
  /** The review-stop value the reducer's effect wrote, and where. */
  readonly reviewStop: HeldReviewStop;
  readonly reviewStopPath: string;
  /** The phase's commit (a full sha) and its subject line. */
  readonly phaseCommit: string;
  readonly phaseCommitSubject: string;
  /** The phase's validated handoff in its run folder. */
  readonly handoffPath: string;
  /** True when phax has not verified the provider's interactive resume. */
  readonly unverifiedProvider: boolean;
}

/** What a run that stopped reports, by the stop's cause. */
export type StopReport = DeclaredStopReport | HeldStopReport;

/**
 * A run stopped at an interactive or held phase and waits for a person. A
 * pause, like a rate limit: no RunFailed and no record; it exits 13.
 */
export class AwaitingReviewStopError extends Data.TaggedError("AwaitingReviewStopError")<{
  message: string;
  run: string;
  phase: string;
  report: StopReport;
}> {}

/**
 * The hold point of a committed phase failed before the run reached its held
 * stop. HoldPointFailed already left the run interrupted with the phase
 * committed: a resumable pause, so no record and no RunFailed. Exits 1.
 */
export class HoldPointPausedError extends Data.TaggedError("HoldPointPausedError")<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

/**
 * The records destination refused the record a closed stop owes, declared or
 * held. StopRecordRefused already left the run interrupted with the phase
 * committed and its stop closed: a resumable pause, so no `failed` record and
 * no RunFailed; the next resume writes the record once. Exits 1.
 */
export class StopRecordPausedError extends Data.TaggedError("StopRecordPausedError")<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

/** How a refused close of a stop ended: any lastClose but `interrupted`. */
export type RefusedClose = Exclude<LastClose, { readonly result: "interrupted" }>;

/**
 * A close of a stop was refused: the run is back in awaiting_review, with
 * review-stop.json restored carrying `lastClose`. It exits with
 * `lastClose.exitCode` (4, 5, 1 or 8). An interrupted close never raises it.
 */
export class StopCloseRefusedError extends Data.TaggedError("StopCloseRefusedError")<{
  message: string;
  run: string;
  phase: string;
  lastClose: RefusedClose;
}> {}

/**
 * A phase reached its committed outcome but its records destination refused
 * the write (spec §5.4) — transcripts enabled with an in-repo destination on
 * a repo detected public, or an unacknowledged unknown visibility. This is a
 * deliberate policy refusal, not a transient write failure, so it fails the
 * run loudly rather than degrading to a warning.
 */
export class RecordsDestinationRefusedError extends Data.TaggedError(
  "RecordsDestinationRefusedError",
)<{
  message: string;
  phaseId: string;
  reason: string;
  remedy: string;
}> {}

export class RecordsSyncRequiredError extends Data.TaggedError("RecordsSyncRequiredError")<{
  message: string;
  path: string;
  remote: string;
}> {}

export class CommitPausedError extends Data.TaggedError("CommitPausedError")<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

export class CleanupPausedError extends Data.TaggedError("CleanupPausedError")<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

export class ArtifactCompletionPausedError extends Data.TaggedError(
  "ArtifactCompletionPausedError",
)<{
  message: string;
  phaseId: string;
  cause: unknown;
}> {}

export class RegistryCorruptionError extends Data.TaggedError("RegistryCorruptionError")<{
  message: string;
  registryPath: string;
}> {}

/**
 * An approval record file (`docs/plans/approvals/<plan>.json` or
 * `docs/specs/approvals/<spec>.json`) exists but cannot be read: it is not
 * JSON, fails to decode, has no `$schema`, names a newer release, or records
 * another artifact. phax refuses rather than reading it as no record, and
 * leaves the file byte-identical. `message` starts with the file.
 */
export class ApprovalRecordUnreadableError extends Data.TaggedError(
  "ApprovalRecordUnreadableError",
)<{
  message: string;
  recordPath: string;
}> {}

/**
 * An approval ledger from an older phax (`docs/plans/approvals.json` or
 * `docs/specs/approvals.json`) still exists. Every command that reads or
 * writes approval records refuses before writing anything until
 * `phax artifact migrate-approvals` splits it into record files. Either
 * ledger refuses commands for both kinds.
 */
export class ApprovalLedgerMigrationRequiredError extends Data.TaggedError(
  "ApprovalLedgerMigrationRequiredError",
)<{
  message: string;
  ledgerPath: string;
}> {}

/**
 * `phax artifact migrate-approvals` refuses before writing anything: a ledger
 * entry's key is not a live artifact path of the ledger's kind, or a target
 * record file already exists and is unreadable or holds a different record.
 * `path` is the file that causes the refusal; `message` starts with the ledger.
 */
export class ApprovalMigrationRefusedError extends Data.TaggedError(
  "ApprovalMigrationRefusedError",
)<{
  message: string;
  path: string;
}> {}

/**
 * A live spec or plan sidecar is stamped below its document format's current
 * shape, or written before `$schema`. Approve and reopen (and, later, decide)
 * refuse before anything is written until `phax artifact migrate-documents`
 * has rewritten it. `gesture` names the refused command ("Approval refused").
 */
export class DocumentMigrationRequiredError extends Data.TaggedError(
  "DocumentMigrationRequiredError",
)<{
  gesture: string;
  sidecars: readonly { readonly sidecarPath: string; readonly shape: string }[];
}> {
  override get message(): string {
    const remedy = "run `phax artifact migrate-documents` first";
    const [only] = this.sidecars;
    if (this.sidecars.length === 1 && only !== undefined) {
      return `${this.gesture}: ${only.sidecarPath} is stamped ${only.shape} — ${remedy}`;
    }
    return [
      `${this.gesture}: ${String(this.sidecars.length)} live sidecars are stamped below their current shape — ${remedy}`,
      ...this.sidecars.map((s) => `  ${s.sidecarPath} is stamped ${s.shape}`),
    ].join("\n");
  }
}

/**
 * `phax artifact migrate-documents` refuses before writing anything: a
 * sidecar is invalid, or a body is not its sidecar's own-shape rendering.
 * One entry per refused artifact; `message` renders them all.
 */
export class DocumentMigrationRefusedError extends Data.TaggedError(
  "DocumentMigrationRefusedError",
)<{
  message: string;
  refusals: readonly { readonly path: string; readonly problem: string; readonly remedy: string }[];
}> {}

export class LockConflictError extends Data.TaggedError("LockConflictError")<{
  message: string;
  shortName: string;
  lockPath: string;
  lockingPid: number;
}> {}

export class SecurityEnforcementError extends Data.TaggedError("SecurityEnforcementError")<{
  message: string;
  provider: string;
  mode: string;
}> {}

export class InvalidTransitionError extends Data.TaggedError("InvalidTransitionError")<{
  from: string;
  to: string;
  entity: "run" | "phase";
}> {
  override get message(): string {
    return `Invalid ${this.entity} state transition: ${this.from} → ${this.to}`;
  }
}

export class SecurityPreflightError extends Data.TaggedError("SecurityPreflightError")<{
  message: string;
  missing: readonly string[];
}> {}

// The plan declares `.claude/skills/**` files but the run has no skill edit
// consent (`phax run --allow-skill-edits`, or consent recorded for resume).
export class SkillEditConsentError extends Data.TaggedError("SkillEditConsentError")<{
  message: string;
  phases: readonly { readonly phaseId: string; readonly files: readonly string[] }[];
}> {}

export class ModelPreflightError extends Data.TaggedError("ModelPreflightError")<{
  message: string;
  failures: readonly {
    readonly phaseId: string;
    readonly model: string;
    readonly effort: string;
    readonly reasons: readonly string[];
    readonly alternatives: readonly {
      readonly id: string;
      readonly family: string;
      readonly efforts: readonly string[];
    }[];
  }[];
}> {}

// A plan phase has no section in plan.md that `locatePlanSections` can find.
export class PlanSectionsPreflightError extends Data.TaggedError("PlanSectionsPreflightError")<{
  message: string;
  phases: readonly string[];
  planPath: string;
}> {}

// A phase declares a Mode or oracle line this phax cannot run (yet), or a malformed one.
export class InteractivePreflightError extends Data.TaggedError("InteractivePreflightError")<{
  message: string;
  findings: readonly LintFinding[];
  planPath: string;
}> {}

// A --hold selection the plan cannot honour; one finding per defect.
export class HoldPreflightError extends Data.TaggedError("HoldPreflightError")<{
  message: string;
  findings: readonly { readonly phase: string | null; readonly message: string }[];
}> {}

export class OraclePreflightError extends Data.TaggedError("OraclePreflightError")<{
  message: string;
  findings: readonly LintFinding[];
  planPath: string;
}> {}

/** A discharging phase's oracle phase noted no commit (it was skipped for
 *  producing no changes): there are no oracles to discharge, and no resume
 *  can give the oracle phase a commit. Refused at the discharging phase's
 *  entry, before its agent runs; the run fails. */
export class OracleCommitMissingError extends Data.TaggedError("OracleCommitMissingError")<{
  message: string;
  oraclePhase: string;
  dischargingPhase: string;
}> {}

// The errors of the bounds check (the `models` errors lint reports from the
// assignment bounds): an unstated departure, an unresolved or invalid bound.
export class AssignmentPreflightError extends Data.TaggedError("AssignmentPreflightError")<{
  message: string;
  findings: readonly LintFinding[];
  planPath: string;
}> {}

export class ReviewHandoffArtifactMissingError extends Data.TaggedError(
  "ReviewHandoffArtifactMissingError",
)<{
  message: string;
  missingPhases: readonly string[];
  missingPaths: readonly string[];
}> {}

export class SkillInstallError extends Data.TaggedError("SkillInstallError")<{
  message: string;
}> {}

export class PlanAuditorError extends Data.TaggedError("PlanAuditorError")<{
  message: string;
  exitCode?: number;
  stderrExcerpt?: string;
}> {}

export class InvalidArtifactTransitionError extends Data.TaggedError(
  "InvalidArtifactTransitionError",
)<{
  kind: "spec" | "plan";
  from: string;
  to: string;
  legalTargets: readonly string[];
}> {
  override get message(): string {
    const targets =
      this.legalTargets.length > 0 ? this.legalTargets.join(", ") : "(none — terminal)";
    return `Invalid ${this.kind} status transition: ${this.from} → ${this.to}. Legal transitions from ${this.from}: ${targets}`;
  }
}

export class ArtifactValidationError extends Data.TaggedError("ArtifactValidationError")<{
  path: string;
  message: string;
}> {}

/**
 * A gesture that must name its arbiter could not: a `--by` that is not
 * `operator` or `machine:<grant>`, a grant that is not a kebab-case slug, no
 * terminal and no `--by`, or an operator without a git user.name. Refused
 * before anything is written.
 */
export class ArtifactArbiterRefusedError extends Data.TaggedError("ArtifactArbiterRefusedError")<{
  message: string;
}> {}

export class ArtifactCreationError extends Data.TaggedError("ArtifactCreationError")<{
  message: string;
}> {}

/**
 * `artifact decide` refused before writing anything: a precondition failed
 * (`reason` names which) or the artifact changed during the session.
 * `message` is the operator-facing refusal.
 */
export class DecideRefusedError extends Data.TaggedError("DecideRefusedError")<{
  reason:
    | "not-draft"
    | "sidecar"
    | "dirty"
    | "no-terminal"
    | "hand-format"
    | "unknown-question"
    | "doctrine"
    | "model"
    | "operator"
    | "changed"
    | "verdicts-file"
    | "verdicts-binding"
    | "by"
    | "by-machine"
    | "no-by";
  message: string;
}> {}

/**
 * A decide session handed back no usable document, twice: its answer was not
 * JSON, not stamped with the current shape, refused by the decoder, or broke
 * a revision rule. `path` is the first violation's document-relative path
 * (`""` when the refusal is not about one place); `message` names both
 * refusals. Nothing was written or committed. Reported as a provider error.
 */
export class DecideDocumentError extends Data.TaggedError("DecideDocumentError")<{
  path: string;
  message: string;
}> {}

/**
 * A headless authoring session ended without a usable document: its final
 * message was not JSON, or the JSON failed the kind's document schema.
 * `message` carries the reason (the first violation's path for a schema
 * failure). Nothing was written or committed. Reported as a provider error.
 */
export class AuthoringDocumentError extends Data.TaggedError("AuthoringDocumentError")<{
  kind: "spec" | "plan";
  slug: string;
  message: string;
}> {}

/**
 * `artifact approve` refused a headless-authored artifact whose body is no
 * longer the rendering of its JSON sidecar (`problem` says how: the body
 * diverged, or the sidecar is not a valid document). `remedy` names the two
 * ways out: re-author headless, or delete the sidecar to demote the artifact
 * to hand-authored.
 */
export class ArtifactSidecarDivergedError extends Data.TaggedError("ArtifactSidecarDivergedError")<{
  path: string;
  sidecarPath: string;
  problem: string;
  remedy: string;
}> {
  override get message(): string {
    return `Approval refused: ${this.path} ${this.problem}. ${this.remedy}`;
  }
}

/** Approval refused: the artifact still has open questions. */
export class ArtifactOpenQuestionsError extends Data.TaggedError("ArtifactOpenQuestionsError")<{
  path: string;
  open: readonly string[];
}> {
  override get message(): string {
    return `Approval refused: ${this.path} has open questions — ${this.open.join(", ")}. Answer them with \`phax artifact decide ${this.path}\`.`;
  }
}

/** Approval or completion refused: a current-shape spec still holds the summary placeholder. */
export class SurfaceSummariesUnwrittenError extends Data.TaggedError(
  "SurfaceSummariesUnwrittenError",
)<{
  gesture: "Approval refused" | "Completion refused";
  path: string;
  sidecarPath: string;
  surfaces: readonly string[];
}> {
  override get message(): string {
    const n = this.surfaces.length;
    return [
      `${this.gesture}: ${this.path} has ${String(n)} surface ${n === 1 ? "summary" : "summaries"} still to write`,
      ...this.surfaces.map((surface) => `  ${surface}`),
      `  Write each one in ${this.sidecarPath} and on its §6 \`Summary:\` line, then rerun.`,
    ].join("\n");
  }
}

/** Approval refused: a hand-authored question section departs from the §9 format. */
export class ArtifactQuestionsUnparsedError extends Data.TaggedError(
  "ArtifactQuestionsUnparsedError",
)<{
  path: string;
  line: number;
  text: string;
}> {
  override get message(): string {
    return `Approval refused: ${this.path} has a question section that does not follow the §9 format, at line ${this.line}: ${this.text}`;
  }
}

export class PlanNotApprovedError extends Data.TaggedError("PlanNotApprovedError")<{
  path: string;
  status: string;
  message: string;
}> {}

export class SpecNotApprovedError extends Data.TaggedError("SpecNotApprovedError")<{
  planPath: string;
  specPath: string;
  specStatus: string;
}> {
  override get message(): string {
    return `${this.planPath} declares Source-Spec: ${this.specPath}, but ${this.specPath} has status "${this.specStatus}" (not Approved) — approve the spec first`;
  }
}

export class SpecApprovalUnrecordedError extends Data.TaggedError("SpecApprovalUnrecordedError")<{
  planPath: string;
  specPath: string;
}> {
  override get message(): string {
    return `${this.planPath} declares Source-Spec: ${this.specPath}, but ${this.specPath} is Approved with no recorded approval — re-approve the spec first`;
  }
}

export class SpecEditedSinceApprovalError extends Data.TaggedError("SpecEditedSinceApprovalError")<{
  planPath: string;
  specPath: string;
  baseline: string;
}> {
  override get message(): string {
    return `${this.planPath} declares Source-Spec: ${this.specPath}, but ${this.specPath} is Approved but edited since its approval (${this.baseline.slice(0, 7)}) — re-approve the spec first`;
  }
}

export class SpecRetirementBlockedError extends Data.TaggedError("SpecRetirementBlockedError")<{
  specPath: string;
  dependents: readonly { readonly path: string; readonly status: string }[];
}> {
  override get message(): string {
    const names = this.dependents.map((d) => `${d.path} (${d.status})`).join(", ");
    return `${this.specPath} cannot be retired: it is still declared as Source-Spec by ${names} — abandon or complete them first`;
  }
}

export class ArtifactDirtyWriteSetError extends Data.TaggedError("ArtifactDirtyWriteSetError")<{
  paths: readonly string[];
}> {
  override get message(): string {
    const verb = this.paths.length === 1 ? "has" : "have";
    return `Transition refused: ${this.paths.join(", ")} ${verb} uncommitted changes — commit or stash them first`;
  }
}

// POSIX single-quoting: the word pastes into a shell intact, newlines included.
function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The commit of an artifact write-set failed (headless authoring or any
 * transition). `commitMessage` is the full message phax tried to commit with,
 * trailers included, so the printed remedy reproduces it exactly — an
 * authoring commit keeps the `Authoring-Id` trailer `phax records explain`
 * resolves.
 */
export class ArtifactCommitFailedError extends Data.TaggedError("ArtifactCommitFailedError")<{
  paths: readonly string[];
  cause: string;
  commitMessage: { readonly subject: string; readonly body: string };
}> {
  override get message(): string {
    const cause = this.cause.trim().replace(/\.$/, "");
    const command = [
      "git commit",
      `-m ${shellQuote(this.commitMessage.subject)}`,
      `-m ${shellQuote(this.commitMessage.body)}`,
      "--",
      ...this.paths.map(shellQuote),
    ].join(" ");
    const lines = [
      `Wrote ${this.paths.join(", ")} but the commit failed: ${cause}.`,
      "A commit hook (often a formatter) may have rejected them.",
      "Run the repository's formatter on those paths, then commit exactly them with phax's message:",
      `  ${command}`,
    ];
    // A sidecar is the `.json` twin of a listed `.md` (sidecarPathFor's rule,
    // inlined: importing the artifact modules here would form a cycle).
    const sidecars = this.paths.filter(
      (p) => p.endsWith(".json") && this.paths.includes(`${p.slice(0, -".json".length)}.md`),
    );
    if (sidecars.length > 0) {
      lines.push(
        `Formatting the JSON sidecar (${sidecars.join(", ")}) is safe: phax compares its parsed document with the Markdown, not its bytes.`,
      );
    }
    return lines.join("\n");
  }
}

export class PlanStaleError extends Data.TaggedError("PlanStaleError")<{
  path: string;
  verdict: PlanStalenessVerdict;
}> {
  override get message(): string {
    const remedy = `re-approve with "phax artifact approve ${this.path}"`;
    if (this.verdict.kind === "missing-record") {
      return `${this.path} is stale: ${this.verdict.detail} — ${remedy}`;
    }
    if (this.verdict.kind === "fresh") {
      return `${this.path} is fresh`;
    }
    const lines = this.verdict.evidence.map((e) => {
      if (e.reason === "spec-changed") return `spec-changed: ${e.specPath} changed since approval`;
      if (e.reason === "ground-changed") {
        return `ground-changed: ${e.files.join(", ")} changed since baseline ${e.baseline}`;
      }
      return "self-changed: the plan itself changed since approval";
    });
    return `${this.path} is stale (${lines.join("; ")}) — ${remedy}`;
  }
}
