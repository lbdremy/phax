import { Effect, Either } from "effect";
import { join, resolve } from "node:path";
import { type ClaudeSessionId, decodeClaudeSessionId } from "../domain/branded.js";
import {
  parseArbiterDeclaration,
  resolveArbiter as resolveArbiterFacts,
} from "../domain/artifact/arbiter.js";
import { type SidecarDocument, sidecarPathFor } from "../domain/artifact/sidecar.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { parseFinalMessageJson } from "../domain/authoring/retry.js";
import type { Doctrine } from "../domain/decide/doctrine.js";
import { planPhaseIds } from "../domain/decide/handAuthored.js";
import { type VerdictsModel, resolveVerdictsModel } from "../domain/decide/model.js";
import { buildDecideRetryPrompt } from "../domain/decide/prompt.js";
import {
  type RevisionRefusal,
  describeRevisionRefusal,
  renderRevisedArtifact,
} from "../domain/decide/revision.js";
import {
  type BoundVerdicts,
  type QuestionFacts,
  type TranscribedVerdict,
  bindVerdicts,
  checkHandTranscription,
  checkTranscription,
  parseVerdictsFile,
  questionFactsOfDocument,
  questionFactsOfHand,
} from "../domain/decide/verdicts.js";
import { buildVerdictsPrompt } from "../domain/decide/verdictsPrompt.js";
import {
  AgentInvocationError,
  type AgentSessionFailedError,
  type AgentSessionIdMissingError,
  ArtifactCommitFailedError,
  DecideDocumentError,
  type DecideRefusedError,
  failWithFollowUps,
  isSessionFailureCause,
  type RateLimitError,
  type SecurityEnforcementError,
  type UsageLimitError,
} from "../domain/errors.js";
import type { ProviderId } from "../domain/routing/types.js";
import { resolveReviewSecurityPolicy } from "../domain/security/resolveReviewPolicy.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { OutputPort } from "../ports/output.js";
import type { PromptError } from "../ports/prompt.js";
import { Terminal } from "../ports/terminal.js";
import { decodeAuthoringSession } from "../schemas/authoringSession.js";
import type { ModelRouting } from "../schemas/modelRouting.js";
import { currentSchemaUrl } from "../schemas/persisted.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../schemas/securityConfig.js";
import { AUTHORING_SESSION_FILENAME, authoringSessionFolder } from "./authorArtifact.js";
import {
  type ArtifactSnapshot,
  type DecideArtifactError,
  nextDecisionIndex,
  readArtifact,
  refused,
} from "./decideArtifact.js";
import { seedPlanCache } from "./planCacheStore.js";
import { pushRecordsBranch } from "./recordsSync.js";
import { resolveDoctrine } from "./resolveDoctrine.js";
import { refuseUnmigratedDocuments } from "./unmigratedDocuments.js";
import {
  DECIDE_AFTER_FILENAME,
  DECIDE_BEFORE_FILENAME,
  DECIDE_DIFF_FILENAME,
  DECIDE_DOCUMENT_FILENAME,
  DECIDE_PROMPT_FILENAME,
  DECIDE_RETRY_PROMPT_FILENAME,
  DECIDE_RETRY_TRANSCRIPT_FILENAME,
  DECIDE_TRANSCRIPT_FILENAME,
  DECIDE_VERDICTS_FILENAME,
  type DecisionRecordPush,
  type DecisionRecordStatus,
  type VerdictsRecordEnd,
  decisionRecordPushWarning,
  decisionRecordWarning,
  writeDecisionRecord,
} from "./writeDecisionRecord.js";
import { decisionFailureOf } from "./decideFailure.js";

/** Where the verdicts file is read from: a repo-relative or absolute path, or stdin. */
export type VerdictsSource =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "stdin" };

export interface DecideVerdictsInput {
  /** Repo-relative POSIX path of the spec or plan. */
  readonly path: string;
  readonly verdicts: VerdictsSource;
  /** How the source reads in messages: the path as given, or `stdin`. */
  readonly label: string;
  /** `--by`, as given (undefined when absent). */
  readonly by: string | undefined;
  /** `--doctrine`, repo-relative, or null. */
  readonly doctrinePath: string | null;
  /** `--model` and `--effort`, as given (undefined when absent). */
  readonly model: string | undefined;
  readonly effort: string | undefined;
  /** The loaded model routing and provider catalog the writer's model is routed through. */
  readonly routing: ModelRouting;
  readonly providerConfig: ProviderConfig;
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
  /** Progress lines (session, model), the retry warning and a failed decide's record warnings. */
  readonly output: Pick<OutputPort, "log" | "warn">;
}

/**
 * A verdicts-mode decide that landed: the artifact (and its sidecar) in one
 * commit, still Draft. Everything a report shows: each verdict as it landed,
 * the questions left open, the body diff, the commit and the decision.
 */
export interface DecideVerdictsResult {
  readonly kind: "committed";
  readonly path: string;
  /** The repo-relative paths the commit holds: the artifact, then its sidecar when it has one. */
  readonly paths: readonly string[];
  readonly status: "Draft";
  readonly session: "new" | "resumed-authoring";
  /** The provider routing selected, which the writer ran on. */
  readonly provider: ProviderId;
  /** The concrete model the writer ran. */
  readonly model: string;
  /** The model asked for, by flag or built-in default. */
  readonly requestedModel: string;
  readonly effort: string;
  readonly modelSource: VerdictsModel["modelSource"];
  readonly effortSource: VerdictsModel["effortSource"];
  /** The verdicts as they landed, in the artifact's document order. */
  readonly verdicts: readonly TranscribedVerdict[];
  /** The open questions the file did not name, in document order. */
  readonly open: readonly string[];
  /** The body diff, as `git diff --no-index` prints it. */
  readonly diff: string;
  readonly commit: { readonly hash: string; readonly subject: string };
  /** `<stamp>-<slug>/<NN>`: the `Decision-Id` trailer. */
  readonly decisionId: string;
  readonly record: DecisionRecordStatus;
  readonly recordPush: DecisionRecordPush;
}

/** Interactive decide's errors, bar its prompt's; an unreadable stdin is a refusal. */
export type DecideVerdictsError = Exclude<DecideArtifactError, PromptError>;

// ── The writer session ─────────────────────────────────────────────────────

/** The session the writer runs in: the kept authoring session, or a new one. */
interface WriterSession {
  readonly kind: "new" | "resume";
  /** The session to resume (kind `resume`). */
  readonly id: ClaudeSessionId | null;
  /** Every session id kept for the authoring session (none for a new one). */
  readonly keptIds: readonly string[];
}

// The authoring session kept in `session.json`, resumed only when it decodes,
// was authored on the provider routing selected, and ran in this checkout; a
// new session otherwise. The state root is shared by every checkout, so a
// session authored in another clone, or one since moved or deleted, is not
// resumed.
function chooseWriterSession(
  input: DecideVerdictsInput,
  artifactId: string,
  provider: ProviderId,
): Effect.Effect<WriterSession, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const fresh: WriterSession = { kind: "new", id: null, keptIds: [] };
    const file = join(
      authoringSessionFolder(input.stateRoot, artifactId),
      AUTHORING_SESSION_FILENAME,
    );
    if (!(yield* fs.exists(file))) return fresh;
    let json: unknown;
    try {
      json = JSON.parse(yield* fs.readText(file));
    } catch {
      return fresh;
    }
    const kept = decodeAuthoringSession(json);
    if (Either.isLeft(kept)) return fresh;
    if (kept.right.provider !== provider) return fresh;
    if (resolve(kept.right.cwd) !== resolve(input.repoRoot)) return fresh;
    const id = decodeClaudeSessionId(kept.right.retrySessionId ?? kept.right.sessionId);
    if (Either.isLeft(id)) return fresh;
    return {
      kind: "resume",
      id: id.right,
      keptIds: [
        kept.right.sessionId,
        ...(kept.right.retrySessionId === null ? [] : [kept.right.retrySessionId]),
      ],
    };
  });
}

// ── Checking the writer's answer ───────────────────────────────────────────

/** A writer's answer that passed every check, ready to diff and write. */
interface AcceptedTranscription {
  readonly verdicts: readonly TranscribedVerdict[];
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
  readonly bound: BoundVerdicts;
  readonly doctrine: Doctrine;
  readonly operator: { readonly name: string };
  readonly atIso: string;
}

function checkAnswer(
  finalText: string,
  ctx: CheckContext,
): Either.Either<AcceptedTranscription, RevisionRefusal> {
  const answer = parseFinalMessageJson(finalText);
  if (Either.isLeft(answer)) return Either.left({ path: "", message: answer.left });
  const { snapshot, bound, doctrine, operator, atIso } = ctx;
  const { authored } = snapshot;
  const common = { bound, operator, atIso, principleIds: doctrine.principleIds };

  if (authored.variant === "headless") {
    const checked = checkTranscription({
      ...common,
      original: authored.document,
      answer: answer.right,
    });
    if (Either.isLeft(checked)) return Either.left(checked.left);
    const { document, verdicts } = checked.right;
    const rendered = renderRevisedArtifact(snapshot.md, document);
    return Either.right({
      verdicts,
      md: rendered.md,
      sidecarText: rendered.sidecarText,
      documentJson: rendered.sidecarText,
      planDocument: document.kind === "plan" ? document : null,
    });
  }

  if (authored.parsed === null) {
    return Either.left({ path: "decisions", message: "the artifact has no question section" });
  }
  const checked = checkHandTranscription({
    ...common,
    kind: snapshot.kind,
    md: snapshot.md,
    parsed: authored.parsed,
    answer: answer.right,
    phaseIds: snapshot.kind === "plan" ? planPhaseIds(snapshot.md) : [],
  });
  if (Either.isLeft(checked)) return Either.left(checked.left);
  const { answer: decoded, md, verdicts } = checked.right;
  return Either.right({
    verdicts,
    md,
    sidecarText: null,
    documentJson: `${JSON.stringify({ $schema: currentSchemaUrl(`${snapshot.kind}-hand-decision-answer`), ...decoded }, null, 2)}\n`,
    planDocument: null,
  });
}

/** What the decision record needs to know of the session once it has started. */
interface ObservedWriter {
  /** Set before the corrective resume runs, so even a failed resume records it. */
  retried: boolean;
  /** The session id each turn reported. */
  readonly sessionIds: string[];
  /** The answer that passed every check, once there is one. */
  accepted: AcceptedTranscription | null;
}

type WriterError =
  | DecideDocumentError
  | AgentInvocationError
  | AgentSessionFailedError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError;

// One headless turn: the kept session resumed, or a new session. A refused
// answer resumes the session once more with the refusal (transcript in
// retry-output.jsonl); a second refusal fails naming both. Provider errors
// and limits are never retried.
function runWriter(
  ctx: CheckContext,
  session: WriterSession,
  prompt: string,
  folder: string,
  options: Omit<AgentRunOptions, "outputJsonlPath">,
  observed: ObservedWriter,
  warn: (message: string) => void,
): Effect.Effect<AcceptedTranscription, WriterError, FileSystem | Backend> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const backend = yield* Backend;
    const variant = ctx.snapshot.authored.variant;

    const firstOptions: AgentRunOptions = {
      ...options,
      outputJsonlPath: join(folder, DECIDE_TRANSCRIPT_FILENAME),
    };
    const first: AgentRunResult =
      session.id === null
        ? yield* backend.runAgent(prompt, firstOptions)
        : yield* backend.resumeAgentSession(session.id, prompt, firstOptions);
    observed.sessionIds.push(first.sessionId);
    const firstAnswer = checkAnswer(first.finalText, ctx);
    if (Either.isRight(firstAnswer)) return firstAnswer.right;

    const firstRefusal = describeRevisionRefusal(firstAnswer.left);
    const retryPrompt = buildDecideRetryPrompt(variant, firstRefusal);
    yield* fs.writeAtomic(join(folder, DECIDE_RETRY_PROMPT_FILENAME), retryPrompt);
    warn(
      `${variant === "hand" ? "hand decision answer" : "revised document"} refused — ${firstRefusal}\n  resuming the session once to ask for the whole ${variant === "hand" ? "answer" : "document"} again`,
    );
    observed.retried = true;
    const retried = yield* backend.resumeAgentSession(first.sessionId, retryPrompt, {
      ...options,
      outputJsonlPath: join(folder, DECIDE_RETRY_TRANSCRIPT_FILENAME),
    });
    observed.sessionIds.push(retried.sessionId);
    const retryAnswer = checkAnswer(retried.finalText, ctx);
    if (Either.isRight(retryAnswer)) return retryAnswer.right;
    return yield* Effect.fail(
      new DecideDocumentError({
        path: retryAnswer.left.path,
        message: `revised document rejected twice — first answer: ${firstRefusal}; retry: ${describeRevisionRefusal(retryAnswer.left)}`,
      }),
    );
  });
}

// ── Rendering ──────────────────────────────────────────────────────────────

/** The session line, first of the progress: the ids named, and which session the writer runs in. */
function sessionLine(
  kind: ArtifactKind,
  slug: string,
  label: string,
  ids: readonly string[],
  session: "new" | "resumed-authoring",
): string {
  return `decide ${kind} ${slug} — verdicts from ${label}: ${ids.join(", ")} — headless, ${session === "resumed-authoring" ? "resumed authoring session" : "new session"}`;
}

/** The model line: the concrete model, the effort and where each came from, the provider, and what was asked for when routing chose otherwise. */
function modelLine(model: VerdictsModel, effort: string): string {
  const source =
    model.modelSource === model.effortSource
      ? model.modelSource
      : `model ${model.modelSource}, effort ${model.effortSource}`;
  const requested = model.concreteModel === model.model ? "" : `, requested ${model.model}`;
  return `model      ${model.concreteModel} / ${effort} (${source}) on ${model.provider}${requested}`;
}

/** The commit that lands a verdicts-mode decide: the decided ids, the writer, the operator and the decision. */
export function verdictsCommitMessage(input: {
  readonly kind: ArtifactKind;
  readonly slug: string;
  readonly path: string;
  readonly decided: readonly string[];
  readonly model: string;
  readonly effort: string;
  readonly provider: ProviderId;
  readonly operator: string;
  readonly decisionId: string;
}): { readonly subject: string; readonly body: string } {
  const scope = input.kind === "spec" ? "specs" : "plans";
  return {
    subject: `docs(${scope}): decide ${input.slug} ${input.decided.join(", ")}`,
    body: [
      `Decided from a verdicts file, transcribed in a headless session (${input.model} / ${input.effort} on ${input.provider}).`,
      "",
      `Artifact: ${input.path}`,
      `Decided-By: operator (${input.operator})`,
      "Decided-Via: verdicts",
      `Decision-Id: ${input.decisionId}`,
    ].join("\n"),
  };
}

// ── The use case ───────────────────────────────────────────────────────────

const BY_OPERATOR = "`--by operator`";

/**
 * `phax artifact decide <artifact> --verdicts <file|->`: transcribe verdicts a
 * person already made. Checks every precondition before any session — the
 * migration, a Draft artifact whose sidecar is in sync or whose hand-authored
 * §9 parses, no uncommitted change on the write set, the verdicts file read,
 * parsed and bound to the artifact, the arbiter (never a machine, never
 * unattributed), the writer's model through routing, the doctrine — and
 * writes nothing on a refusal. Then runs one headless writer session on the
 * provider routing selects (the kept authoring session resumed when it was
 * authored on that provider in this checkout, otherwise a new one; one
 * corrective resume), checks its answer against the file, and writes and
 * commits the artifact (and its sidecar, re-seeding a plan's extraction cache
 * first) with no prompt. The artifact stays Draft and nothing approves it.
 * Every end after the writer started — committed or failed — writes one
 * decision record on `phax/records/v1`, pushed when `records.autoPush` is on;
 * a record never fails the decide.
 */
export function decideVerdicts(
  input: DecideVerdictsInput,
): Effect.Effect<
  DecideVerdictsResult,
  DecideVerdictsError,
  FileSystem | Git | GitHub | Backend | Terminal
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const terminal = yield* Terminal;
    const { path, label } = input;

    // Preconditions, in order; none writes.
    yield* refuseUnmigratedDocuments("Decide refused");
    const snapshot = yield* readArtifact(input);
    const { kind, slug } = snapshot;

    const source = input.verdicts;
    // `--verdicts -` reads a pipe: a terminal on stdin would block on a person.
    if (source.kind === "stdin" && (yield* terminal.stdinIsTerminal)) {
      return yield* refused(
        "verdicts-file",
        "--verdicts - reads the verdicts from a pipe; pipe a file or pass its path",
      );
    }
    const text =
      source.kind === "stdin"
        ? yield* terminal.readStdin.pipe(
            Effect.mapError((e) =>
              refused(
                "verdicts-file",
                `cannot read the verdicts from stdin: ${e.message} — pipe the file again or pass its path`,
              ),
            ),
          )
        : yield* fs
            .readText(source.path)
            .pipe(
              Effect.mapError((e) =>
                refused("verdicts-file", `cannot read ${source.path}: ${e.message}`),
              ),
            );
    const file = parseVerdictsFile(text);
    if (Either.isLeft(file)) {
      const { path: at, message } = file.left;
      return yield* refused(
        "verdicts-file",
        `${label} is not a valid verdicts file — ${at.length > 0 ? `${at}: ` : ""}${message}`,
      );
    }
    const facts: readonly QuestionFacts[] =
      snapshot.authored.variant === "headless"
        ? questionFactsOfDocument(snapshot.authored.document)
        : snapshot.authored.parsed === null
          ? []
          : questionFactsOfHand(snapshot.authored.parsed);
    const bound = bindVerdicts({ file: file.right, artifactPath: path, questions: facts, label });
    if (Either.isLeft(bound)) return yield* refused("verdicts-binding", bound.left);

    // Only the operator gives verdicts: a machine, or a value that does not
    // parse, is refused with the same remedy.
    const declared = input.by === undefined ? null : parseArbiterDeclaration(input.by);
    if (declared !== null && (Either.isLeft(declared) || declared.right.kind !== "operator")) {
      return yield* refused(
        Either.isLeft(declared) ? "by" : "by-machine",
        `--by ${input.by ?? ""} — a verdict always comes from the operator; pass ${BY_OPERATOR}`,
      );
    }
    const stdinIsTerminal = yield* terminal.stdinIsTerminal;
    if (declared === null && !stdinIsTerminal) {
      return yield* refused(
        "no-by",
        `no terminal and no --by — pass ${BY_OPERATOR}: a verdict always comes from the operator`,
      );
    }
    const arbiter = resolveArbiterFacts({
      declared: { kind: "operator" },
      stdinIsTerminal,
      committerName: yield* git.committerName(input.repoRoot),
    });
    if (Either.isLeft(arbiter)) return yield* refused("operator", arbiter.left);
    if (arbiter.right.kind !== "operator") {
      return yield* refused("operator", "decide is the operator's gesture");
    }
    const operator = { name: arbiter.right.name };

    const model = resolveVerdictsModel(
      input.model,
      input.effort,
      input.routing,
      input.providerConfig,
    );
    if (Either.isLeft(model)) return yield* refused("model", model.left);
    const routed = model.right;
    const doctrine = yield* resolveDoctrine({
      kind,
      bundledSkillText: input.bundledSkills[kind],
      doctrinePath: input.doctrinePath,
    });

    // The session and its decision folder.
    const session = yield* chooseWriterSession(input, snapshot.id, routed.provider);
    const sessionKind = session.kind === "resume" ? "resumed-authoring" : "new";
    const index = yield* nextDecisionIndex(join(input.stateRoot, "decide", snapshot.id));
    const decisionId = `${snapshot.id}/${index}`;
    const folder = join(input.stateRoot, "decide", snapshot.id, index);
    const ids = bound.right.verdicts.map((v) => v.question);
    const effort = routed.thinking ?? routed.effort;
    const prompt = buildVerdictsPrompt({
      kind,
      artifactPath: path,
      doctrine,
      bound: bound.right,
      authoring:
        snapshot.authored.variant === "headless"
          ? { variant: "headless", document: snapshot.authored.document }
          : { variant: "hand", markdown: snapshot.md },
      schemaUrl: currentSchemaUrl(
        snapshot.authored.variant === "hand"
          ? `${kind}-hand-decision-answer`
          : kind === "spec"
            ? "spec-document"
            : "plan-document",
      ),
    });
    yield* fs.mkdirp(folder);
    yield* fs.writeAtomic(join(folder, DECIDE_VERDICTS_FILENAME), text);
    yield* fs.writeAtomic(join(folder, DECIDE_PROMPT_FILENAME), prompt);

    input.output.log(sessionLine(kind, slug, label, ids, sessionKind));
    input.output.log(modelLine(routed, effort));

    // The decision record's `sourceSha`: HEAD as the session starts.
    const sourceSha = yield* git.headCommit(input.repoRoot);

    // The writer has started: whatever came of it (Right) or went wrong (Left)
    // is recorded, a committed decide after the commit it names, before a
    // failure is re-raised.
    const observed: ObservedWriter = { retried: false, sessionIds: [], accepted: null };
    const ended = yield* Effect.either(
      concludeVerdicts(input, {
        ctx: { snapshot, bound: bound.right, doctrine, operator, atIso: input.nowIso },
        session,
        folder,
        decisionId,
        prompt,
        model: routed,
        effort,
        observed,
      }),
    );
    const accepted = observed.accepted;
    const end: VerdictsRecordEnd = Either.isLeft(ended)
      ? { outcome: "failed", commit: null, failure: decisionFailureOf(ended.left) }
      : { outcome: "committed", commit: ended.right.commit.hash };
    const record = yield* writeDecisionRecord({
      mode: "verdicts",
      repoRoot: input.repoRoot,
      recordsClonePath: input.recordsClonePath,
      records: input.records,
      folder,
      decisionId,
      artifact: path,
      artifactKind: kind,
      session: sessionKind,
      doctrine: doctrine.sources,
      questions: ids,
      arbitrated: accepted?.verdicts.length ?? 0,
      departed: accepted?.verdicts.filter((v) => v.departs).length ?? 0,
      sourceSha,
      provider: routed.provider,
      model: routed.concreteModel,
      requestedModel: routed.model,
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
      Effect.catchAll((e) => Effect.succeed({ kind: "write-failed", message: e.message } as const)),
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
    if (Either.isLeft(ended)) {
      // The cause prints first: the record's warnings ride on the error.
      return yield* Effect.fail(
        failWithFollowUps(ended.left, [
          decisionRecordWarning(record, isSessionFailureCause(ended.left)),
          decisionRecordPushWarning(recordPush),
        ]),
      );
    }
    const landed = ended.right;
    return {
      kind: "committed",
      path,
      paths: landed.paths,
      status: "Draft",
      session: sessionKind,
      provider: routed.provider,
      model: routed.concreteModel,
      requestedModel: routed.model,
      effort,
      modelSource: routed.modelSource,
      effortSource: routed.effortSource,
      verdicts: landed.verdicts,
      open: bound.right.open,
      diff: landed.diff,
      commit: landed.commit,
      decisionId,
      record,
      recordPush,
    } as const;
  });
}

interface LandedVerdicts {
  readonly paths: readonly string[];
  readonly verdicts: readonly TranscribedVerdict[];
  readonly diff: string;
  readonly commit: { readonly hash: string; readonly subject: string };
}

// After the writer started: its answer, the diff, the write and the commit.
// Nothing reaches the repository before the answer passed every check; the
// files are left written only when the commit itself fails.
function concludeVerdicts(
  input: DecideVerdictsInput,
  run: {
    readonly ctx: CheckContext;
    readonly session: WriterSession;
    readonly folder: string;
    readonly decisionId: string;
    readonly prompt: string;
    readonly model: VerdictsModel;
    readonly effort: string;
    readonly observed: ObservedWriter;
  },
): Effect.Effect<
  LandedVerdicts,
  WriterError | DecideRefusedError | ArtifactCommitFailedError | GitError,
  FileSystem | Git | Backend
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const { ctx, folder, model, observed } = run;
    const { snapshot, operator } = ctx;
    const { kind, slug } = snapshot;
    const { path } = input;

    const security = resolveReviewSecurityPolicy({
      mode: input.security.profile,
      worktreePath: input.repoRoot,
      config: input.security,
    });
    const accepted = yield* runWriter(
      ctx,
      run.session,
      run.prompt,
      folder,
      {
        provider: model.provider,
        model: model.concreteModel,
        effort: run.effort,
        cwd: input.repoRoot,
        security,
        readOnly: true,
        phaseFolderPath: folder,
      },
      observed,
      input.output.warn,
    );
    observed.accepted = accepted;
    yield* fs.writeAtomic(join(folder, DECIDE_DOCUMENT_FILENAME), accepted.documentJson);

    const beforePath = join(folder, DECIDE_BEFORE_FILENAME);
    const afterPath = join(folder, DECIDE_AFTER_FILENAME);
    yield* fs.writeAtomic(beforePath, snapshot.md);
    yield* fs.writeAtomic(afterPath, accepted.md);
    const diff = yield* git.diffNoIndex(input.repoRoot, beforePath, afterPath, path);
    yield* fs.writeAtomic(join(folder, DECIDE_DIFF_FILENAME), diff);

    // Changed while the writer ran: leave the change, write nothing.
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

    const { subject, body } = verdictsCommitMessage({
      kind,
      slug,
      path,
      decided: accepted.verdicts.map((v) => v.question),
      model: model.concreteModel,
      effort: run.effort,
      provider: model.provider,
      operator: operator.name,
      decisionId: run.decisionId,
    });
    const committed = yield* Effect.either(git.commitPaths(input.repoRoot, paths, subject, body));
    if (Either.isLeft(committed)) {
      return yield* Effect.fail(
        new ArtifactCommitFailedError({
          paths,
          cause: committed.left.message,
          commitMessage: { subject, body },
        }),
      );
    }
    const hash = yield* git.headCommit(input.repoRoot);
    return { paths, verdicts: accepted.verdicts, diff, commit: { hash, subject } };
  });
}
