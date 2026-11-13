import { Effect, Result } from "effect";
import { join } from "node:path";
import { parseArbiterDeclaration } from "../domain/artifact/arbiter.js";
import type { SidecarDocument } from "../domain/artifact/sidecar.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { type RevisionRefusal, renderRevisedArtifact } from "../domain/decide/revision.js";
import {
  type AgentInvocationError,
  type AgentSessionFailedError,
  type AgentSessionIdMissingError,
  ArtifactArbiterRefusedError,
  type ArtifactCommitFailedError,
  type ArtifactValidationError,
  type DocumentMigrationRequiredError,
  type FailureWithFollowUpsError,
  type RateLimitError,
  ReviseDocumentError,
  ReviseRefusedError,
  type SecurityEnforcementError,
  type UsageLimitError,
  failWithFollowUps,
  isSessionFailureCause,
} from "../domain/errors.js";
import { buildReviseRetryPrompt, buildRevisePrompt } from "../domain/revise/prompt.js";
import {
  type AppendedQuestion,
  type RevisionRequester,
  decodeRevisedAnswer,
  rendersSameBody,
  reviseCommitMessage,
} from "../domain/revise/revision.js";
import { resolveModel } from "../domain/routing/resolve.js";
import type { ProviderId } from "../domain/routing/types.js";
import { resolveReviewSecurityPolicy } from "../domain/security/resolveReviewPolicy.js";
import { answerJson } from "../domain/session/structuredAnswer.js";
import { Backend, type AgentRunResult } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { OutputPort } from "../ports/output.js";
import type { Terminal } from "../ports/terminal.js";
import { answerJsonSchema } from "../schemas/answerSchemas.js";
import type { ModelRouting } from "../schemas/modelRouting.js";
import { type Effort, resolveAuthoringSelection } from "../schemas/phaxConfig.js";
import { currentSchemaUrl } from "../schemas/persisted.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../schemas/securityConfig.js";
import { AUTHORING_BRIEF_FILENAME, authoringSessionFolder } from "./authorArtifact.js";
import { nextDecisionIndex } from "./decideArtifact.js";
import {
  type ArtifactSnapshot,
  type ObservedWriter as WriterObserved,
  type WriterError,
  type WriterSession,
  chooseWriterSession,
  diffAnswer,
  landAnswer,
  readDraftArtifact,
  runWriter,
} from "./headlessWriter.js";
import { pushRecordsBranch } from "./recordsSync.js";
import { refuseUnmigratedDocuments } from "./unmigratedDocuments.js";
import { resolveArbiter } from "./resolveArbiter.js";
import { revisionFailureOf } from "./reviseFailure.js";
import {
  REVISE_AFTER_FILENAME,
  REVISE_AMENDMENT_FILENAME,
  REVISE_BEFORE_FILENAME,
  REVISE_DIFF_FILENAME,
  REVISE_DOCUMENT_FILENAME,
  REVISE_PROMPT_FILENAME,
  REVISE_RETRY_PROMPT_FILENAME,
  REVISE_RETRY_TRANSCRIPT_FILENAME,
  REVISE_TRANSCRIPT_FILENAME,
  type RevisionRecordEnd,
  type RevisionRecordPush,
  type RevisionRecordStatus,
  revisionRecordPushWarning,
  revisionRecordWarning,
  writeRevisionRecord,
} from "./writeRevisionRecord.js";

// The entry of `phax artifact revise`. Phase-05 freezes its input and result
// here and its acceptance tests against a body that dies; phase-06 replaces the
// body. The two interfaces are the contract: phase-06 does not change a field.

/** Where the revision's model or effort came from: the flag, or phax.json's `authoring.<kind>`. */
export type ReviseSource = "flag" | "authoring.spec" | "authoring.plan";

export interface ReviseArtifactInput {
  /** Repo-relative POSIX path of the spec or plan. */
  readonly path: string;
  /** The amendment's text, and how it reads in messages: the path as given, or `stdin`. */
  readonly amendment: { readonly text: string; readonly label: string };
  /** `--by`, as given (undefined when absent). */
  readonly by: string | undefined;
  /** `--model` and `--effort`, as given (undefined when absent). */
  readonly model: string | undefined;
  readonly effort: string | undefined;
  /** phax.json's resolved `authoring.spec` and `authoring.plan`. */
  readonly authoring: Readonly<Record<ArtifactKind, { model: string; effort: Effort }>>;
  /** The loaded model routing and provider catalog the writer's model is routed through. */
  readonly routing: ModelRouting;
  readonly providerConfig: ProviderConfig;
  /** The bundled `phax-spec` and `phax-planning` `SKILL.md` texts, verbatim. */
  readonly skills: Readonly<Record<ArtifactKind, string>>;
  readonly security: ResolvedSecurityConfig;
  readonly repoRoot: string;
  readonly stateRoot: string;
  /** The plan-extraction model/effort a plan's cache seed is keyed on (`phax run`'s). */
  readonly extractPlanModel: string;
  readonly extractPlanEffort: string;
  /** The command's clock: the cache seed. */
  readonly nowIso: string;
  readonly records: ResolvedRecordsConfig;
  /** The local records clone, required for a dedicated `repo` records destination. */
  readonly recordsClonePath?: string | undefined;
  /** `publish.remote` from `phax.json`: the push target for an in-repo records destination. */
  readonly publishRemote: string;
  /** Progress lines, the retry warning and a failed revision's record warnings. */
  readonly output: Pick<OutputPort, "log" | "warn">;
}

/** A revision that ran its writer to its end: a commit, or no change. The artifact stays Draft. */
export interface ReviseArtifactResult {
  readonly kind: "committed" | "unchanged";
  readonly path: string;
  /** The repo-relative paths the commit holds: the artifact, then its sidecar. Empty when unchanged. */
  readonly paths: readonly string[];
  readonly status: "Draft";
  readonly session: "new" | "resumed-authoring";
  /** The provider routing selected, which the writer ran on. */
  readonly provider: ProviderId;
  /** The concrete model the writer ran. */
  readonly model: string;
  /** The model asked for, by flag or configuration. */
  readonly requestedModel: string;
  readonly effort: Effort;
  readonly modelSource: ReviseSource;
  readonly effortSource: ReviseSource;
  readonly requester: RevisionRequester;
  /** The open questions the revision appended, in order. */
  readonly newQuestions: ReadonlyArray<{ readonly id: string; readonly question: string }>;
  /** The body diff, as `git diff --no-index` prints it (empty when unchanged). */
  readonly diff: string;
  /** The revision's commit; null when the answer changed nothing. */
  readonly commit: { readonly hash: string; readonly subject: string } | null;
  /** `<authoringId>/<NN>`: the `Revision-Id` trailer and the record's key tail. */
  readonly revisionId: string;
  readonly record: RevisionRecordStatus;
  readonly recordPush: RevisionRecordPush;
}

/** The errors a revision ends with: its own two, and what the shared writer path raises. */
export type ReviseArtifactError =
  | ReviseRefusedError
  | ReviseDocumentError
  | DocumentMigrationRequiredError
  | ArtifactValidationError
  | ArtifactCommitFailedError
  | AgentInvocationError
  | AgentSessionFailedError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | FailureWithFollowUpsError
  | SecurityEnforcementError
  | FsError
  | GitError;

// ── Refusals ───────────────────────────────────────────────────────────────

const REFUSED = "Revise refused: ";

function refused(reason: ReviseRefusedError["reason"], message: string): ReviseRefusedError {
  return new ReviseRefusedError({ reason, message: `${REFUSED}${message}` });
}

const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}

/** The effort a result reports: the effort routing selected when it is one of ours, else the one asked for. */
function reportedEffort(effective: string, asked: Effort): Effort {
  return isEffort(effective) ? effective : asked;
}

// ── Checking the writer's answer ───────────────────────────────────────────

/** A writer's answer that passed every check, ready to diff and write. */
interface AcceptedRevision {
  readonly document: SidecarDocument;
  readonly newQuestions: ReadonlyArray<AppendedQuestion>;
  /** The artifact's new text: the frontmatter as it was, then the rendered body. */
  readonly md: string;
  readonly sidecarText: string;
}

function checkAnswer(
  result: AgentRunResult,
  original: SidecarDocument,
  currentMd: string,
): Result.Result<AcceptedRevision, RevisionRefusal> {
  const answer = answerJson(result);
  if (Result.isFailure(answer)) return Result.fail({ path: "", message: answer.failure });
  const decoded = decodeRevisedAnswer(answer.success, original);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const { document, newQuestions } = decoded.success;
  const rendered = renderRevisedArtifact(currentMd, document);
  return Result.succeed({
    document,
    newQuestions,
    md: rendered.md,
    sidecarText: rendered.sidecarText,
  });
}

// ── Rendering ──────────────────────────────────────────────────────────────

function sessionLine(
  kind: ArtifactKind,
  slug: string,
  label: string,
  session: "new" | "resumed-authoring",
): string {
  return `revise ${kind} ${slug} — amendment from ${label} — headless, ${session === "resumed-authoring" ? "resumed authoring session" : "new session"}`;
}

function modelLine(input: {
  readonly requested: string;
  readonly concrete: string;
  readonly effort: string;
  readonly provider: ProviderId;
  readonly modelSource: ReviseSource;
  readonly effortSource: ReviseSource;
}): string {
  const source =
    input.modelSource === input.effortSource
      ? input.modelSource
      : `model ${input.modelSource}, effort ${input.effortSource}`;
  const requested = input.concrete === input.requested ? "" : `, requested ${input.requested}`;
  return `model      ${input.concrete} / ${input.effort} (${source}) on ${input.provider}${requested}`;
}

// ── The use case ───────────────────────────────────────────────────────────

/**
 * `phax artifact revise <path> --amendment <file|->`: revise a Draft,
 * headless-authored spec or plan from an amendment. Checks every precondition
 * before any session — the migration, a Draft artifact whose sidecar is in
 * sync, no uncommitted change on its write set, the requester, a committing
 * git identity, the writer's model through routing — and writes nothing on a
 * refusal. Then runs one read-only writer session on the provider routing
 * selects (the kept authoring session resumed when it ran on that provider in
 * this checkout, otherwise a new one; one corrective resume), checks its
 * answer, ends with no commit when the body renders the same, and otherwise
 * writes and commits the artifact and its sidecar (re-seeding a plan's
 * extraction cache first) with no prompt. The artifact stays Draft. Every end
 * after the writer started — committed, unchanged or failed — writes one
 * revision record, pushed when `records.autoPush` is on; a record never fails
 * the revision.
 */
export function reviseArtifact(
  input: ReviseArtifactInput,
): Effect.Effect<
  ReviseArtifactResult,
  ReviseArtifactError,
  FileSystem | Git | GitHub | Backend | Terminal
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const { path } = input;

    // Preconditions, in order; none writes.
    yield* refuseUnmigratedDocuments("Revise refused");
    const snapshot = yield* readDraftArtifact<ReviseRefusedError>({
      path,
      repoRoot: input.repoRoot,
      verb: "revised",
      refuse: (reason, message) =>
        refused(reason === "hand-format" ? "hand-authored" : reason, message),
      hand: {
        kind: "refuse",
        refusal: refused(
          "hand-authored",
          `${path} is hand-authored (no sidecar) — edit the .md directly`,
        ),
      },
    });
    const { kind, slug } = snapshot;
    const { authored } = snapshot;
    if (authored.variant !== "headless") {
      return yield* Effect.fail(
        refused("hand-authored", `${path} is hand-authored (no sidecar) — edit the .md directly`),
      );
    }

    const requester = yield* resolveArbiter(input.by, input.repoRoot).pipe(
      Effect.mapError((e) => {
        if (!(e instanceof ArtifactArbiterRefusedError)) return e;
        const invalid =
          input.by !== undefined && Result.isFailure(parseArbiterDeclaration(input.by));
        const reason = invalid ? "by" : e.message.startsWith("no terminal") ? "no-by" : "identity";
        return refused(reason, e.message);
      }),
    );
    const committer = yield* git.committerName(input.repoRoot);
    if (committer === null || committer.length === 0) {
      return yield* Effect.fail(
        refused(
          "identity",
          'the revision is committed under the git identity, and no user.name is set — set it with `git config user.name "<name>"`',
        ),
      );
    }

    if (input.effort !== undefined && !isEffort(input.effort)) {
      return yield* Effect.fail(
        refused("model", `--effort ${input.effort} is not an effort — use ${EFFORTS.join(", ")}`),
      );
    }
    const selection = resolveAuthoringSelection({
      ...(input.model === undefined ? {} : { flagModel: input.model }),
      ...(input.effort === undefined ? {} : { flagEffort: input.effort as Effort }),
      configured: input.authoring[kind],
    });
    const { selected } = resolveModel(selection, input.routing, input.providerConfig);
    const effort = selected.thinking ?? selection.effort;
    const configuredSource: ReviseSource = kind === "spec" ? "authoring.spec" : "authoring.plan";
    const modelSource: ReviseSource = input.model === undefined ? configuredSource : "flag";
    const effortSource: ReviseSource = input.effort === undefined ? configuredSource : "flag";

    // The session and its revision folder.
    const session = yield* chooseWriterSession({
      stateRoot: input.stateRoot,
      repoRoot: input.repoRoot,
      artifactId: snapshot.id,
      provider: selected.provider,
    });
    const sessionKind = session.kind === "resume" ? "resumed-authoring" : "new";
    const reviseRoot = join(input.stateRoot, "revise", snapshot.id);
    const index = yield* nextDecisionIndex(reviseRoot);
    const revisionId = `${snapshot.id}/${index}`;
    const folder = join(reviseRoot, index);

    const briefPath = join(
      authoringSessionFolder(input.stateRoot, snapshot.id),
      AUTHORING_BRIEF_FILENAME,
    );
    const brief = (yield* fs.exists(briefPath)) ? yield* fs.readText(briefPath) : null;
    const prompt = buildRevisePrompt({
      kind,
      artifactPath: path,
      session: session.kind,
      skillText: input.skills[kind],
      brief,
      document: authored.document,
      amendment: input.amendment.text,
      schemaUrl: currentSchemaUrl(`${kind}-document`),
    });
    yield* fs.mkdirp(folder);
    yield* fs.writeAtomic(join(folder, REVISE_AMENDMENT_FILENAME), input.amendment.text);
    yield* fs.writeAtomic(join(folder, REVISE_PROMPT_FILENAME), prompt);

    input.output.log(sessionLine(kind, slug, input.amendment.label, sessionKind));
    input.output.log(
      modelLine({
        requested: selection.model,
        concrete: selected.concreteModel,
        effort,
        provider: selected.provider,
        modelSource,
        effortSource,
      }),
    );

    // The record's `sourceSha`: HEAD as the session starts.
    const sourceSha = yield* git.headCommit(input.repoRoot);

    // The writer has started: whatever came of it (Right) or went wrong (Left)
    // is recorded, a committed revision after the commit it names, before a
    // failure is re-raised.
    const observed: WriterObserved<AcceptedRevision> = {
      retried: false,
      sessionIds: [],
      accepted: null,
    };
    const ended = yield* Effect.result(
      concludeRevision(input, {
        snapshot,
        original: authored.document,
        requester,
        session,
        folder,
        revisionId,
        prompt,
        provider: selected.provider,
        model: selected.concreteModel,
        effort,
        observed,
      }),
    );
    const end: RevisionRecordEnd = Result.isFailure(ended)
      ? { outcome: "failed", commit: null, failure: revisionFailureOf(ended.failure) }
      : ended.success.commit === null
        ? { outcome: "unchanged", commit: null }
        : { outcome: "committed", commit: ended.success.commit.hash };
    const newQuestions = observed.accepted?.newQuestions ?? [];
    const record: RevisionRecordStatus = yield* writeRevisionRecord({
      repoRoot: input.repoRoot,
      recordsClonePath: input.recordsClonePath,
      records: input.records,
      publishRemote: input.publishRemote,
      folder,
      revisionId,
      artifact: path,
      artifactKind: kind,
      session: sessionKind,
      requester,
      newQuestions: newQuestions.map((q) => q.id),
      sourceSha,
      provider: selected.provider,
      model: selected.concreteModel,
      requestedModel: selection.model,
      effort,
      end,
      retried: observed.retried,
      turnSessionIds: observed.sessionIds,
      sessionIds: [
        ...(session.id === null ? [] : [session.id]),
        ...session.keptIds,
        ...observed.sessionIds,
      ],
    }).pipe(
      Effect.catch((e) => Effect.succeed({ kind: "write-failed", message: e.message } as const)),
    );
    const recordPush: RevisionRecordPush =
      record.kind === "written"
        ? yield* pushRecordsBranch({
            records: input.records,
            repoRoot: input.repoRoot,
            publishRemote: input.publishRemote,
            recordsClonePath: input.recordsClonePath,
          })
        : { kind: "no-record" };
    if (Result.isFailure(ended)) {
      // The cause prints first: the record's warnings ride on the error.
      return yield* Effect.fail(
        failWithFollowUps(ended.failure, [
          revisionRecordWarning(record, isSessionFailureCause(ended.failure)),
          revisionRecordPushWarning(recordPush),
        ]),
      );
    }
    const landed = ended.success;
    return {
      kind: landed.commit === null ? "unchanged" : "committed",
      path,
      paths: landed.paths,
      status: "Draft",
      session: sessionKind,
      provider: selected.provider,
      model: selected.concreteModel,
      requestedModel: selection.model,
      effort: reportedEffort(effort, selection.effort),
      modelSource,
      effortSource,
      requester,
      newQuestions,
      diff: landed.diff,
      commit: landed.commit,
      revisionId,
      record,
      recordPush,
    } as const;
  });
}

interface LandedRevision {
  readonly paths: readonly string[];
  readonly diff: string;
  /** Null when the answer changed nothing. */
  readonly commit: { readonly hash: string; readonly subject: string } | null;
}

// After the writer started: its answer, the no-change judgement, the diff, the
// write and the commit. Nothing reaches the repository before the answer passed
// every check; the files are left written only when the commit itself fails.
function concludeRevision(
  input: ReviseArtifactInput,
  run: {
    readonly snapshot: ArtifactSnapshot;
    readonly original: SidecarDocument;
    readonly requester: RevisionRequester;
    readonly session: WriterSession;
    readonly folder: string;
    readonly revisionId: string;
    readonly prompt: string;
    readonly provider: ProviderId;
    readonly model: string;
    readonly effort: string;
    readonly observed: WriterObserved<AcceptedRevision>;
  },
): Effect.Effect<
  LandedRevision,
  WriterError<ReviseDocumentError> | ReviseRefusedError | ArtifactCommitFailedError | GitError,
  FileSystem | Git | Backend
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { snapshot, folder, observed } = run;
    const { kind, slug } = snapshot;
    const { path } = input;

    const security = resolveReviewSecurityPolicy({
      mode: input.security.profile,
      worktreePath: input.repoRoot,
      config: input.security,
    });
    const accepted = yield* runWriter({
      session: run.session,
      prompt: run.prompt,
      folder,
      options: {
        provider: run.provider,
        model: run.model,
        effort: run.effort,
        cwd: input.repoRoot,
        security,
        answerSchema: { call: "revise", schema: answerJsonSchema(`${kind}-document`) },
        phaseFolderPath: folder,
      },
      check: (result) => checkAnswer(result, run.original, snapshot.md),
      retryPrompt: buildReviseRetryPrompt,
      refusedWarning: (refusal) =>
        `revised document refused — ${refusal}\n  resuming the session once to ask for the whole document again`,
      rejectedTwice: (at, message) => new ReviseDocumentError({ path: at, message }),
      transcriptFileName: REVISE_TRANSCRIPT_FILENAME,
      retryPromptFileName: REVISE_RETRY_PROMPT_FILENAME,
      retryTranscriptFileName: REVISE_RETRY_TRANSCRIPT_FILENAME,
      observed,
      warn: input.output.warn,
    });

    // No change is judged on the rendered body: nothing is written.
    if (rendersSameBody(snapshot.md, accepted.document)) {
      yield* fs.writeAtomic(join(folder, REVISE_DOCUMENT_FILENAME), accepted.sidecarText);
      yield* fs.writeAtomic(join(folder, REVISE_DIFF_FILENAME), "");
      return { paths: [], diff: "", commit: null };
    }

    const diff = yield* diffAnswer({
      folder,
      repoRoot: input.repoRoot,
      path,
      beforeMd: snapshot.md,
      afterMd: accepted.md,
      documentJson: accepted.sidecarText,
      fileNames: {
        document: REVISE_DOCUMENT_FILENAME,
        before: REVISE_BEFORE_FILENAME,
        after: REVISE_AFTER_FILENAME,
        diff: REVISE_DIFF_FILENAME,
      },
    });

    const landed = yield* landAnswer({
      repoRoot: input.repoRoot,
      stateRoot: input.stateRoot,
      path,
      snapshotMd: snapshot.md,
      snapshotSidecarText: snapshot.sidecarText,
      md: accepted.md,
      sidecarText: accepted.sidecarText,
      planDocument: accepted.document.kind === "plan" ? accepted.document : null,
      extractPlanModel: input.extractPlanModel,
      extractPlanEffort: input.extractPlanEffort,
      nowIso: input.nowIso,
      commitMessage: reviseCommitMessage({
        kind,
        slug,
        path,
        amendment: input.amendment.text,
        model: run.model,
        effort: run.effort,
        provider: run.provider,
        requester: run.requester,
        revisionId: run.revisionId,
      }),
      changed: (changedPath) =>
        refused(
          "changed",
          `${changedPath} changed while the revise session ran — its change is left in place; rerun revise`,
        ),
    });
    return { paths: landed.paths, diff, commit: landed.commit };
  });
}
