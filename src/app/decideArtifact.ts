import { Effect, Result } from "effect";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { type ClaudeSessionId, decodeClaudeSessionId } from "../domain/branded.js";
import type { ParsedHandQuestions } from "../domain/artifact/questions.js";
import { type SidecarDocument, sidecarPathFor } from "../domain/artifact/sidecar.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { answerJson } from "../domain/session/structuredAnswer.js";
import type { Doctrine } from "../domain/decide/doctrine.js";
import {
  decodeHandAnswer,
  firstHandAnswerViolation,
  planPhaseIds,
  writeHandDecisions,
} from "../domain/decide/handAuthored.js";
import { type DecideModel, resolveDecideModel } from "../domain/decide/model.js";
import {
  FRAMING_QUESTIONS,
  buildDecidePrompt,
  buildDecideRetryPrompt,
  buildHandbackPrompt,
  positionalPrompt,
} from "../domain/decide/prompt.js";
import {
  type DecideScope,
  type RevisionRefusal,
  decideScope,
  decidedInSession,
  decodeRevisedDocument,
  describeRevisionRefusal,
  firstRevisionViolation,
  questionsOf,
  renderRevisedArtifact,
} from "../domain/decide/revision.js";
import {
  AgentInvocationError,
  type AgentSessionFailedError,
  type AgentSessionIdMissingError,
  ArtifactCommitFailedError,
  type ArtifactValidationError,
  DecideDocumentError,
  DecideRefusedError,
  type DocumentMigrationRequiredError,
  type FailureWithFollowUpsError,
  failWithFollowUps,
  isSessionFailureCause,
  type RateLimitError,
  type SecurityEnforcementError,
  type UsageLimitError,
} from "../domain/errors.js";
import { resolveReviewSecurityPolicy } from "../domain/security/resolveReviewPolicy.js";
import { claudeReadOnlyFlags } from "../domain/session/claudePermissionFlags.js";
import { buildDecideInvocation } from "../domain/session/claude.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { OutputPort } from "../ports/output.js";
import { Prompt, type PromptError } from "../ports/prompt.js";
import { Session } from "../ports/session.js";
import { Terminal } from "../ports/terminal.js";
import { answerJsonSchema } from "../schemas/answerSchemas.js";
import { decodeAuthoringSession } from "../schemas/authoringSession.js";
import type { HandDecisionAnswer } from "../schemas/handDecisionAnswer.js";
import { currentSchemaUrl } from "../schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../schemas/securityConfig.js";
import { AUTHORING_SESSION_FILENAME, authoringSessionFolder } from "./authorArtifact.js";
import { type ArtifactSnapshot, type Authored, readDraftArtifact } from "./headlessWriter.js";
import { seedPlanCache } from "./planCacheStore.js";
import { pushRecordsBranch } from "./recordsSync.js";
import { resolveArbiter } from "./resolveArbiter.js";
import { resolveDoctrine } from "./resolveDoctrine.js";
import { refuseUnmigratedDocuments } from "./unmigratedDocuments.js";
import {
  DECIDE_AFTER_FILENAME,
  DECIDE_BEFORE_FILENAME,
  DECIDE_DIFF_FILENAME,
  DECIDE_DOCUMENT_FILENAME,
  DECIDE_HANDBACK_PROMPT_FILENAME,
  DECIDE_PROMPT_FILENAME,
  DECIDE_RETRY_PROMPT_FILENAME,
  DECIDE_RETRY_TRANSCRIPT_FILENAME,
  DECIDE_TRANSCRIPT_FILENAME,
  type DecisionRecordEnd,
  type DecisionRecordPush,
  type DecisionRecordStatus,
  decisionRecordPushWarning,
  decisionRecordWarning,
  writeDecisionRecord,
} from "./writeDecisionRecord.js";
import { decisionFailureOf } from "./decideFailure.js";

export interface DecideArtifactInput {
  /** Repo-relative path of the spec or plan. */
  readonly path: string;
  /** `--question`, or null. */
  readonly question: string | null;
  /** `--doctrine`, repo-relative, or null. */
  readonly doctrinePath: string | null;
  /** `--model` and `--effort`, as given (undefined when absent). */
  readonly model: string | undefined;
  readonly effort: string | undefined;
  /** The bundled `SKILL.md` of each kind's doctrine skill, verbatim. */
  readonly bundledSkills: Readonly<Record<ArtifactKind, string>>;
  readonly security: ResolvedSecurityConfig;
  readonly repoRoot: string;
  readonly stateRoot: string;
  /** The plan-extraction model/effort a plan's cache seed is keyed on (`phax run`'s). */
  readonly extractPlanModel: string;
  readonly extractPlanEffort: string;
  /** The command's clock: the decision folder, each verdict's `at`, the cache seed. */
  readonly nowIso: string;
  readonly records: ResolvedRecordsConfig;
  /** The local records clone, required for a dedicated `repo` records destination. */
  readonly recordsClonePath?: string | undefined;
  /** `publish.remote` from `phax.json`: the push target for an in-repo records destination. */
  readonly publishRemote: string;
  /**
   * Progress lines (mode, model, diff, verdicts), the retry warning, and a
   * failed decide's record and push warnings.
   */
  readonly output: Pick<OutputPort, "log" | "warn">;
}

/** The decision a session ran under, once it spawned: its id, folder and record. */
export interface DecideSessionFacts {
  /** `<stamp>-<slug>/<NN>`: the `Decision-Id` trailer. */
  readonly decisionId: string;
  /** Absolute path of `<stateRoot>/decide/<stamp>-<slug>/<NN>/`. */
  readonly folder: string;
  readonly session: "new" | "resumed-authoring";
  /** The decision record, written once the session ended. */
  readonly record: DecisionRecordStatus;
  /** The push of `phax/records/v1` after the record was written. */
  readonly recordPush: DecisionRecordPush;
}

/**
 * What a decide came to. `nothing`: no open question and no `--question`, no
 * session spawned. `undecided`: the session returned a document that decided
 * nothing. `declined`: the operator refused the body diff. `committed`: the
 * artifact (and its sidecar) landed in one commit. Nothing is written to the
 * repository but in `committed`; every outcome after the session spawned
 * carries its decision record.
 */
export type DecideArtifactResult =
  | { readonly kind: "nothing"; readonly path: string }
  | ({ readonly kind: "undecided"; readonly path: string } & DecideSessionFacts)
  | ({ readonly kind: "declined"; readonly path: string } & DecideSessionFacts)
  | ({
      readonly kind: "committed";
      readonly path: string;
      /** The repo-relative paths the commit holds: the artifact, then its sidecar. */
      readonly paths: readonly string[];
      readonly decided: readonly string[];
      readonly commit: { readonly hash: string; readonly subject: string };
    } & DecideSessionFacts);

export type DecideArtifactError =
  | DecideRefusedError
  | DecideDocumentError
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
  | PromptError
  | FsError
  | GitError;

// ── What decide reads ──────────────────────────────────────────────────────

export type { Authored, ArtifactSnapshot } from "./headlessWriter.js";

/** A refusal of decide, whichever mode: the reason and the operator-facing message. */
export function refused(reason: DecideRefusedError["reason"], message: string): DecideRefusedError {
  return new DecideRefusedError({ reason, message: `Decide refused: ${message}` });
}

// Preconditions (2)–(4): a Draft artifact whose sidecar is in sync, or whose
// hand-authored §9 parses, with no uncommitted change on what decide writes.
export function readArtifact(
  input: Pick<DecideArtifactInput, "path" | "repoRoot">,
): Effect.Effect<
  ArtifactSnapshot,
  DecideRefusedError | ArtifactValidationError | FsError | GitError,
  FileSystem | Git
> {
  return readDraftArtifact({
    path: input.path,
    repoRoot: input.repoRoot,
    refuse: refused,
    verb: "decided",
    hand: { kind: "parse" },
  });
}

function questionIds(authored: Authored): {
  readonly openQuestions: ReadonlyArray<{ readonly id: string }>;
  readonly arbitratedQuestions: ReadonlyArray<{ readonly id: string }>;
} {
  if (authored.variant === "headless") return questionsOf(authored.document);
  return {
    openQuestions: authored.parsed?.open ?? [],
    arbitratedQuestions: authored.parsed?.arbitrated ?? [],
  };
}

// ── The session ────────────────────────────────────────────────────────────

/** The Claude session decide runs in: the kept authoring session, or a new one. */
interface DecideSession {
  readonly kind: "new" | "resume";
  readonly id: ClaudeSessionId;
  readonly cwd: string;
  /** Every session id kept for the authoring session (none for a new one). */
  readonly keptIds: readonly string[];
}

// The authoring session kept in `session.json`, when it names claude-code
// and decodes; a new session at the repository otherwise. phax never guesses
// the provider from the bare id file.
function chooseSession(
  input: DecideArtifactInput,
  id: string,
): Effect.Effect<DecideSession, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const fresh = (): DecideSession => ({
      kind: "new",
      id: randomUUID() as ClaudeSessionId,
      cwd: input.repoRoot,
      keptIds: [],
    });
    const file = join(authoringSessionFolder(input.stateRoot, id), AUTHORING_SESSION_FILENAME);
    if (!(yield* fs.exists(file))) return fresh();
    let json: unknown;
    try {
      json = JSON.parse(yield* fs.readText(file));
    } catch {
      return fresh();
    }
    const kept = decodeAuthoringSession(json);
    if (Result.isFailure(kept) || kept.success.provider !== "claude-code") return fresh();
    // The state root is shared by every checkout: a session authored in
    // another clone, or one since moved or deleted, is not resumed.
    if (resolve(kept.success.cwd) !== resolve(input.repoRoot)) return fresh();
    const sessionId = decodeClaudeSessionId(kept.success.retrySessionId ?? kept.success.sessionId);
    if (Result.isFailure(sessionId)) return fresh();
    return {
      kind: "resume",
      id: sessionId.success,
      cwd: kept.success.cwd,
      keptIds: [
        kept.success.sessionId,
        ...(kept.success.retrySessionId === null ? [] : [kept.success.retrySessionId]),
      ],
    };
  });
}

// The next two-digit index under `<stateRoot>/decide/<id>/`.
export function nextDecisionIndex(dir: string): Effect.Effect<string, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const taken = (yield* fs.exists(dir))
      ? (yield* fs.list(dir)).filter((e) => /^\d+$/.test(e)).map(Number)
      : [];
    return String(Math.max(0, ...taken) + 1).padStart(2, "0");
  });
}

// ── The handback ───────────────────────────────────────────────────────────

/** A handback answer that passed every check, ready to diff and write. */
interface AcceptedAnswer {
  /** The questions decided in this session, in document order. */
  readonly decided: ReadonlyArray<{
    readonly id: string;
    readonly chosen: string;
    readonly departs: boolean;
    readonly revised: readonly string[];
  }>;
  /** The artifact's new text. */
  readonly md: string;
  /** The sidecar's new text, or null for a hand-authored artifact. */
  readonly sidecarText: string | null;
  /** The accepted answer as phax keeps it in the decision folder. */
  readonly documentJson: string;
  /** A headless plan's document, for the extraction cache seed. */
  readonly planDocument: Extract<SidecarDocument, { kind: "plan" }> | null;
}

interface CheckContext {
  readonly snapshot: ArtifactSnapshot;
  readonly scope: DecideScope;
  readonly doctrine: Doctrine;
  readonly operator: { readonly name: string };
  readonly atIso: string;
}

function checkHeadless(
  json: unknown,
  ctx: CheckContext,
  original: SidecarDocument,
): Result.Result<AcceptedAnswer, RevisionRefusal> {
  const decoded = decodeRevisedDocument(json, {
    original,
    scope: ctx.scope,
    operator: ctx.operator,
    atIso: ctx.atIso,
  });
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const after = decoded.success;
  const documents = { before: original, after, scope: ctx.scope };
  const violation = firstRevisionViolation({
    ...documents,
    principleIds: ctx.doctrine.principleIds,
  });
  if (violation !== undefined) return Result.fail(violation);
  const rendered = renderRevisedArtifact(ctx.snapshot.md, after);
  return Result.succeed({
    decided: decidedInSession(documents).map(({ id, verdict, departs }) => ({
      id,
      chosen: verdict.chosen,
      departs,
      revised: verdict.kind === "decided" ? verdict.revised : [],
    })),
    md: rendered.md,
    sidecarText: rendered.sidecarText,
    documentJson: rendered.sidecarText,
    planDocument: after.kind === "plan" ? after : null,
  });
}

function checkHand(
  json: unknown,
  ctx: CheckContext,
  parsed: ParsedHandQuestions | null,
): Result.Result<AcceptedAnswer, RevisionRefusal> {
  const { kind, md } = ctx.snapshot;
  const decoded = decodeHandAnswer(json, {
    kind,
    scope: ctx.scope,
    operator: ctx.operator,
    atIso: ctx.atIso,
  });
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const answer: HandDecisionAnswer = decoded.success;
  const documentJson = `${JSON.stringify({ $schema: currentSchemaUrl(`${kind}-hand-decision-answer`), ...answer }, null, 2)}\n`;
  if (parsed === null) {
    return answer.decisions.length === 0
      ? Result.succeed({ decided: [], md, sidecarText: null, documentJson, planDocument: null })
      : Result.fail({ path: "decisions", message: "the artifact has no question section" });
  }
  const violation = firstHandAnswerViolation({
    kind,
    md,
    parsed,
    answer,
    scope: ctx.scope,
    principleIds: ctx.doctrine.principleIds,
    phaseIds: kind === "plan" ? planPhaseIds(md) : [],
  });
  if (violation !== undefined) return Result.fail(violation);
  const written = writeHandDecisions({
    kind,
    md,
    answer,
    parsed,
    reArbitrated: ctx.scope.reArbitrated === null ? [] : [ctx.scope.reArbitrated],
  });
  if (Result.isFailure(written)) return Result.fail({ path: "markdown", message: written.failure });
  const recommendation = new Map(
    [...parsed.open, ...parsed.arbitrated].map((q) => [q.id, q.recommendation]),
  );
  const order = [...parsed.open, ...parsed.arbitrated].map((q) => q.id);
  const decisions = answer.decisions.toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return Result.succeed({
    decided: decisions.map(({ id, verdict }) => ({
      id,
      chosen: verdict.chosen,
      departs: verdict.chosen !== recommendation.get(id),
      revised: verdict.revised,
    })),
    md: written.success,
    sidecarText: null,
    documentJson,
    planDocument: null,
  });
}

function checkAnswer(
  result: AgentRunResult,
  ctx: CheckContext,
): Result.Result<AcceptedAnswer, RevisionRefusal> {
  const parsed = answerJson(result);
  if (Result.isFailure(parsed)) return Result.fail({ path: "", message: parsed.failure });
  const { authored } = ctx.snapshot;
  return authored.variant === "headless"
    ? checkHeadless(parsed.success, ctx, authored.document)
    : checkHand(parsed.success, ctx, authored.parsed);
}

/** What the decision record needs to know of the session once it has spawned. */
interface ObservedDecide {
  /** Set before the corrective resume runs, so even a failed resume records it. */
  retried: boolean;
  /** Every session id a handback turn reported. */
  readonly sessionIds: string[];
  /** The answer that passed every check, once there is one. */
  accepted: AcceptedAnswer | null;
}

// Resumes the session headless for its answer; a refused answer resumes it
// once more with the refusal (transcript in retry-output.jsonl). A second
// refusal fails naming both. Provider errors and limits are never retried.
function handBack(
  input: DecideArtifactInput,
  ctx: CheckContext,
  session: DecideSession,
  folder: string,
  options: Omit<AgentRunOptions, "outputJsonlPath">,
  observed: ObservedDecide,
): Effect.Effect<
  AcceptedAnswer,
  | DecideDocumentError
  | AgentInvocationError
  | AgentSessionFailedError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError,
  FileSystem | Backend
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const backend = yield* Backend;
    const { kind, authored } = ctx.snapshot;
    const handback = buildHandbackPrompt({
      kind,
      variant: authored.variant,
      schemaUrl: currentSchemaUrl(
        authored.variant === "hand"
          ? `${kind}-hand-decision-answer`
          : kind === "spec"
            ? "spec-document"
            : "plan-document",
      ),
    });
    yield* fs.writeAtomic(join(folder, DECIDE_HANDBACK_PROMPT_FILENAME), handback);
    const first = yield* backend.resumeAgentSession(session.id, handback, {
      ...options,
      outputJsonlPath: join(folder, DECIDE_TRANSCRIPT_FILENAME),
    });
    observed.sessionIds.push(first.sessionId);
    const firstAnswer = checkAnswer(first, ctx);
    if (Result.isSuccess(firstAnswer)) return firstAnswer.success;

    const firstRefusal = describeRevisionRefusal(firstAnswer.failure);
    const retryPrompt = buildDecideRetryPrompt(authored.variant, firstRefusal);
    yield* fs.writeAtomic(join(folder, DECIDE_RETRY_PROMPT_FILENAME), retryPrompt);
    input.output.warn(
      `${authored.variant === "hand" ? "hand decision answer" : "revised document"} refused — ${firstRefusal}\n  resuming the session once to ask for the whole ${authored.variant === "hand" ? "answer" : "document"} again`,
    );
    observed.retried = true;
    const retried = yield* backend.resumeAgentSession(first.sessionId, retryPrompt, {
      ...options,
      outputJsonlPath: join(folder, DECIDE_RETRY_TRANSCRIPT_FILENAME),
    });
    observed.sessionIds.push(retried.sessionId);
    const retryAnswer = checkAnswer(retried, ctx);
    if (Result.isSuccess(retryAnswer)) return retryAnswer.success;
    return yield* Effect.fail(
      new DecideDocumentError({
        path: retryAnswer.failure.path,
        message: `revised document rejected twice — first answer: ${firstRefusal}; retry: ${describeRevisionRefusal(retryAnswer.failure)}`,
      }),
    );
  });
}

// ── Rendering ──────────────────────────────────────────────────────────────

function modelLine(model: DecideModel): string {
  const source =
    model.modelSource === model.effortSource
      ? model.modelSource
      : `model ${model.modelSource}, effort ${model.effortSource}`;
  return `model      ${model.model} / ${model.effort} (${source})`;
}

function verdictLines(scope: DecideScope, accepted: AcceptedAnswer): string[] {
  return scope.presented.map((id) => {
    const decided = accepted.decided.find((d) => d.id === id);
    if (decided === undefined) return `${id.padEnd(10)} open        (not decided this session)`;
    return decided.departs
      ? `${id.padEnd(10)} arbitrated  ${decided.chosen} — departs: revises ${decided.revised.join(", ")}`
      : `${id.padEnd(10)} arbitrated  ${decided.chosen} (recommended)`;
  });
}

/** The commit that lands a decide: the decided ids, the model, the operator and the decision. */
export function decideCommitMessage(input: {
  readonly kind: ArtifactKind;
  readonly slug: string;
  readonly path: string;
  readonly decided: readonly string[];
  readonly model: string;
  readonly effort: string;
  readonly operator: string;
  readonly decisionId: string;
}): { readonly subject: string; readonly body: string } {
  const scope = input.kind === "spec" ? "specs" : "plans";
  return {
    subject: `docs(${scope}): decide ${input.slug} ${input.decided.join(", ")}`,
    body: [
      `Decided in an interactive session (${input.model} / ${input.effort}).`,
      "",
      `Artifact: ${input.path}`,
      `Decided-By: operator (${input.operator})`,
      `Decision-Id: ${input.decisionId}`,
    ].join("\n"),
  };
}

// ── The use case ───────────────────────────────────────────────────────────

/**
 * `phax artifact decide <artifact>`: on a Draft spec or plan, from a
 * terminal, check every precondition before any session — migration, Draft,
 * a sidecar in sync or a hand-authored §9 that parses, no uncommitted change
 * on the write set, a known `--question`, a Claude model, the doctrine, the
 * committing identity — and write nothing on a refusal. Then run the
 * interactive Claude Code session (the kept authoring session resumed, or a
 * new one) under the read-only review policy, resume it headless for the
 * revised document (once more on a refusal), validate it, show the body
 * diff, and, once the operator accepts it, write the artifact (and its
 * sidecar, re-seeding a plan's extraction cache first) and commit exactly
 * those paths. Nothing reaches the repository before the operator accepts;
 * the files are left written only when the commit itself fails. Every end
 * after the session spawned — committed, declined, undecided or failed —
 * then writes one decision record on `phax/records/v1`, pushed when
 * `records.autoPush` is on; a record never fails the decide.
 */
export function decideArtifact(
  input: DecideArtifactInput,
): Effect.Effect<
  DecideArtifactResult,
  DecideArtifactError,
  FileSystem | Git | GitHub | Backend | Session | Prompt | Terminal
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;

    // Preconditions, in order; none writes.
    yield* refuseUnmigratedDocuments("Decide refused");
    const snapshot = yield* readArtifact(input);
    const { kind, slug } = snapshot;
    const { path } = input;
    const scoped = decideScope(questionIds(snapshot.authored), input.question);
    if (Result.isFailure(scoped)) return yield* refused("unknown-question", scoped.failure);
    const scope = scoped.success;
    if (scope.presented.length === 0) return { kind: "nothing", path } as const;
    if (!(yield* (yield* Terminal).stdinIsTerminal)) {
      return yield* refused(
        "no-terminal",
        "no terminal — interactive decide needs one; decide headless with `--verdicts <file> --by operator`",
      );
    }
    const model = resolveDecideModel(input.model, input.effort);
    if (Result.isFailure(model)) return yield* refused("model", model.failure);
    const doctrine = yield* resolveDoctrine({
      kind,
      bundledSkillText: input.bundledSkills[kind],
      doctrinePath: input.doctrinePath,
    });
    const arbiter = yield* resolveArbiter("operator", input.repoRoot).pipe(
      Effect.catchTag("ArtifactArbiterRefusedError", (e) =>
        Effect.fail(refused("operator", e.message)),
      ),
    );
    if (arbiter.kind !== "operator") {
      return yield* refused("operator", "decide is the operator's gesture");
    }
    const operator = { name: arbiter.name };

    // The session and its decision folder.
    const session = yield* chooseSession(input, snapshot.id);
    const index = yield* nextDecisionIndex(join(input.stateRoot, "decide", snapshot.id));
    const decisionId = `${snapshot.id}/${index}`;
    const folder = join(input.stateRoot, "decide", snapshot.id, index);
    const sessionKind = session.kind === "resume" ? "resumed-authoring" : "new";
    const prompt = buildDecidePrompt({
      kind,
      artifactPath: path,
      doctrine,
      scope,
      authoring:
        snapshot.authored.variant === "headless"
          ? { variant: "headless", document: snapshot.authored.document }
          : { variant: "hand", markdown: snapshot.md },
    });
    yield* fs.mkdirp(folder);
    // The session reads its prompt from the decision folder, added as a
    // read-only working directory (one argument is capped at 128 KiB on
    // Linux), so nothing is written to the repository.
    const promptPath = join(folder, DECIDE_PROMPT_FILENAME);
    yield* fs.writeAtomic(promptPath, prompt);

    const security = resolveReviewSecurityPolicy({
      mode: input.security.profile,
      worktreePath: session.cwd,
      config: input.security,
    });
    const invocation = buildDecideInvocation({
      cwd: session.cwd,
      session: { kind: session.kind, id: session.id },
      model: model.success.model,
      effort: model.success.effort,
      permissionFlags: claudeReadOnlyFlags([folder]),
      prompt: positionalPrompt(promptPath),
    });

    input.output.log(
      `decide ${kind} ${slug} — framing ${FRAMING_QUESTIONS[0]?.id ?? "F1"}–${FRAMING_QUESTIONS.at(-1)?.id ?? "F5"}, then ${scope.presented.join(", ")} — interactive, ${session.kind === "resume" ? "resumed authoring session" : "new session"}`,
    );
    input.output.log(modelLine(model.success));

    // The decision record's `sourceSha`: HEAD as the session starts.
    const sourceSha = yield* git.headCommit(input.repoRoot);

    // The interactive session: its exit status says nothing about the document.
    // A launch failure ends the decide here: no session spawned, no record.
    yield* (yield* Session).resume({ ...invocation, env: {} }).pipe(
      Effect.mapError(
        (e) =>
          new AgentInvocationError({
            message: `failed to launch claude: ${e.message}`,
            argv: [invocation.executable, ...invocation.args],
          }),
      ),
    );

    // The session has ended: whatever came of it (Right) or went wrong (Left)
    // is recorded, a committed decide after the commit it names, before a
    // failure is re-raised.
    const observed: ObservedDecide = { retried: false, sessionIds: [], accepted: null };
    const ended = yield* Effect.result(
      concludeSession(input, {
        ctx: { snapshot, scope, doctrine, operator, atIso: input.nowIso },
        session,
        folder,
        decisionId,
        model: model.success,
        security,
        observed,
      }),
    );
    const accepted = observed.accepted;
    const end: DecisionRecordEnd = Result.isFailure(ended)
      ? { outcome: "failed", commit: null, failure: decisionFailureOf(ended.failure) }
      : ended.success.kind === "committed"
        ? { outcome: "committed", commit: ended.success.commit.hash }
        : { outcome: ended.success.kind, commit: null };
    const record = yield* writeDecisionRecord({
      repoRoot: input.repoRoot,
      recordsClonePath: input.recordsClonePath,
      records: input.records,
      publishRemote: input.publishRemote,
      folder,
      mode: "interactive",
      decisionId,
      artifact: path,
      artifactKind: kind,
      session: sessionKind,
      doctrine: doctrine.sources,
      questions: scope.presented,
      arbitrated: accepted?.decided.length ?? 0,
      departed: accepted?.decided.filter((d) => d.departs).length ?? 0,
      sourceSha,
      provider: "claude-code",
      model: model.success.model,
      effort: model.success.effort,
      end,
      retried: observed.retried,
      sessionIds: [session.id, ...session.keptIds, ...observed.sessionIds],
    }).pipe(
      Effect.catch((e) => Effect.succeed({ kind: "write-failed", message: e.message } as const)),
    );
    const recordPush: DecisionRecordPush =
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
          decisionRecordWarning(record, isSessionFailureCause(ended.failure)),
          decisionRecordPushWarning(recordPush),
        ]),
      );
    }
    const facts: DecideSessionFacts = {
      decisionId,
      folder,
      session: sessionKind,
      record,
      recordPush,
    };
    return { ...ended.success, path, ...facts };
  });
}

/** How a spawned session ended without an error: what decide reports, before its record. */
type SessionEnd =
  | { readonly kind: "undecided" }
  | { readonly kind: "declined" }
  | {
      readonly kind: "committed";
      readonly paths: readonly string[];
      readonly decided: readonly string[];
      readonly commit: { readonly hash: string; readonly subject: string };
    };

// After the interactive session: the handback, the diff and its confirm, the
// write and the commit. Nothing reaches the repository before the operator
// accepts; the files are left written only when the commit itself fails.
function concludeSession(
  input: DecideArtifactInput,
  run: {
    readonly ctx: CheckContext;
    readonly session: DecideSession;
    readonly folder: string;
    readonly decisionId: string;
    readonly model: DecideModel;
    readonly security: AgentRunOptions["security"];
    readonly observed: ObservedDecide;
  },
): Effect.Effect<
  SessionEnd,
  Exclude<DecideArtifactError, DocumentMigrationRequiredError | ArtifactValidationError>,
  FileSystem | Git | Backend | Prompt
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const { ctx, folder, model, observed } = run;
    const { snapshot, scope, operator } = ctx;
    const { kind, slug } = snapshot;
    const { path } = input;

    const accepted = yield* handBack(
      input,
      ctx,
      run.session,
      folder,
      {
        provider: "claude-code",
        model: model.model,
        effort: model.effort,
        cwd: run.session.cwd,
        security: run.security,
        readOnly: true,
        answerSchema: {
          call: "decide-handback",
          schema: answerJsonSchema(
            ctx.snapshot.authored.variant === "hand"
              ? `${kind}-hand-decision-answer`
              : `${kind}-document`,
          ),
        },
        phaseFolderPath: folder,
      },
      observed,
    );
    observed.accepted = accepted;
    yield* fs.writeAtomic(join(folder, DECIDE_DOCUMENT_FILENAME), accepted.documentJson);
    if (accepted.decided.length === 0) return { kind: "undecided" } as const;

    // The body diff, accepted before anything is written.
    const beforePath = join(folder, DECIDE_BEFORE_FILENAME);
    const afterPath = join(folder, DECIDE_AFTER_FILENAME);
    yield* fs.writeAtomic(beforePath, snapshot.md);
    yield* fs.writeAtomic(afterPath, accepted.md);
    const diff = yield* git.diffNoIndex(input.repoRoot, beforePath, afterPath, path);
    yield* fs.writeAtomic(join(folder, DECIDE_DIFF_FILENAME), diff);
    for (const line of diff.trimEnd().split("\n")) input.output.log(line);
    for (const line of verdictLines(scope, accepted)) input.output.log(line);
    const accept = yield* (yield* Prompt)
      .confirm({ message: "accept the body diff?", initialValue: false })
      .pipe(Effect.catchTag("PromptCancelled", () => Effect.succeed(false)));
    if (!accept) return { kind: "declined" } as const;

    // Changed while the session ran: leave the change, write nothing.
    const sidecarPath = sidecarPathFor(path);
    const mdNow = yield* fs.readText(path);
    const sidecarNow = (yield* fs.exists(sidecarPath)) ? yield* fs.readText(sidecarPath) : null;
    if (mdNow !== snapshot.md || sidecarNow !== snapshot.sidecarText) {
      return yield* refused(
        "changed",
        `${sidecarNow !== snapshot.sidecarText && mdNow === snapshot.md ? sidecarPath : path} changed while the decide session ran — its change is left in place; rerun decide`,
      );
    }

    // Seeded before the plan is written: the entry is content-addressed, so a
    // seed whose plan never lands is inert.
    if (accepted.planDocument !== null) {
      yield* seedPlanCache({
        stateRoot: input.stateRoot,
        planMd: accepted.md,
        document: accepted.planDocument.document,
        extractPlanModel: input.extractPlanModel,
        extractPlanEffort: input.extractPlanEffort,
        nowIso: input.nowIso,
      });
    }
    yield* fs.writeAtomic(path, accepted.md);
    const paths = [path];
    if (accepted.sidecarText !== null) {
      yield* fs.writeAtomic(sidecarPath, accepted.sidecarText);
      paths.push(sidecarPath);
    }

    const decided = accepted.decided.map((d) => d.id);
    const { subject, body } = decideCommitMessage({
      kind,
      slug,
      path,
      decided,
      model: model.model,
      effort: model.effort,
      operator: operator.name,
      decisionId: run.decisionId,
    });
    const committed = yield* Effect.result(git.commitPaths(input.repoRoot, paths, subject, body));
    if (Result.isFailure(committed)) {
      return yield* Effect.fail(
        new ArtifactCommitFailedError({
          paths,
          cause: committed.failure.message,
          commitMessage: { subject, body },
        }),
      );
    }
    const hash = yield* git.headCommit(input.repoRoot);
    return { kind: "committed", paths, decided, commit: { hash, subject } } as const;
  });
}
