import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { basename, join, relative } from "node:path";
import { type ClaudeSessionId, decodeClaudeSessionId } from "../domain/branded.js";
import { validateArtifact } from "../domain/artifact/document.js";
import { parseArtifactName } from "../domain/artifact/name.js";
import {
  type ParsedHandQuestions,
  parseHandAuthoredQuestions,
} from "../domain/artifact/questions.js";
import {
  type SidecarDocument,
  describeStampedShape,
  inspectSidecar,
  sidecarPathFor,
  sidecarRemedy,
} from "../domain/artifact/sidecar.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { parseFinalMessageJson } from "../domain/authoring/retry.js";
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
  type AgentSessionIdMissingError,
  ArtifactCommitFailedError,
  type ArtifactValidationError,
  DecideDocumentError,
  DecideRefusedError,
  type DocumentMigrationRequiredError,
  type RateLimitError,
  type SecurityEnforcementError,
  type UsageLimitError,
} from "../domain/errors.js";
import { resolveReviewSecurityPolicy } from "../domain/security/resolveReviewPolicy.js";
import { claudePermissionFlags } from "../domain/session/claudePermissionFlags.js";
import { buildDecideInvocation } from "../domain/session/claude.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { OutputPort } from "../ports/output.js";
import { Prompt, type PromptError } from "../ports/prompt.js";
import { Session } from "../ports/session.js";
import { Terminal } from "../ports/terminal.js";
import { decodeAuthoringSession } from "../schemas/authoringSession.js";
import type { HandDecisionAnswer } from "../schemas/handDecisionAnswer.js";
import { currentSchemaUrl } from "../schemas/persisted.js";
import type { ResolvedSecurityConfig } from "../schemas/securityConfig.js";
import { AUTHORING_SESSION_FILENAME, authoringSessionFolder } from "./authorArtifact.js";
import { seedPlanCache } from "./planCacheStore.js";
import { resolveArbiter } from "./resolveArbiter.js";
import { resolveDoctrine } from "./resolveDoctrine.js";
import { refuseUnmigratedDocuments } from "./unmigratedDocuments.js";

/**
 * Files of a decision folder, `<stateRoot>/decide/<stamp>-<slug>/<NN>/`. A
 * retried handback also holds `retry-prompt.md` and `retry-output.jsonl`.
 * `document.json` is written once an answer decodes; `before.md`, `after.md`
 * and `body.diff` once its diff is shown.
 */
export const DECIDE_PROMPT_FILENAME = "prompt.md";
export const DECIDE_HANDBACK_PROMPT_FILENAME = "handback-prompt.md";
export const DECIDE_RETRY_PROMPT_FILENAME = "retry-prompt.md";
export const DECIDE_TRANSCRIPT_FILENAME = "output.jsonl";
export const DECIDE_RETRY_TRANSCRIPT_FILENAME = "retry-output.jsonl";
export const DECIDE_DOCUMENT_FILENAME = "document.json";
export const DECIDE_BEFORE_FILENAME = "before.md";
export const DECIDE_AFTER_FILENAME = "after.md";
export const DECIDE_DIFF_FILENAME = "body.diff";

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
  /** Progress lines (mode, model, diff, verdicts) and the retry warning. */
  readonly output: Pick<OutputPort, "log" | "warn">;
}

/** The decision a session ran under, once it spawned: its id and folder. */
export interface DecideSessionFacts {
  /** `<stamp>-<slug>/<NN>`: the `Decision-Id` trailer. */
  readonly decisionId: string;
  /** Absolute path of `<stateRoot>/decide/<stamp>-<slug>/<NN>/`. */
  readonly folder: string;
  readonly session: "new" | "resumed-authoring";
}

/**
 * What a decide came to. `nothing`: no open question and no `--question`, no
 * session spawned. `undecided`: the session returned a document that decided
 * nothing. `declined`: the operator refused the body diff. `committed`: the
 * artifact (and its sidecar) landed in one commit. Nothing is written but in
 * `committed`.
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
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | PromptError
  | FsError
  | GitError;

// ── What decide reads ──────────────────────────────────────────────────────

/** How the artifact was authored, as decide reads its questions. */
type Authored =
  | {
      readonly variant: "headless";
      readonly sidecarPath: string;
      readonly document: SidecarDocument;
    }
  | {
      readonly variant: "hand";
      /** Its parsed §9 sections, or null when it has neither section. */
      readonly parsed: ParsedHandQuestions | null;
    };

interface ArtifactSnapshot {
  readonly kind: ArtifactKind;
  readonly slug: string;
  /** `<stamp>-<slug>`: the authoring id and the decision folder's parent. */
  readonly id: string;
  readonly md: string;
  /** The sidecar's text, or null for a hand-authored artifact. */
  readonly sidecarText: string | null;
  readonly authored: Authored;
}

function refused(reason: DecideRefusedError["reason"], message: string): DecideRefusedError {
  return new DecideRefusedError({ reason, message: `Decide refused: ${message}` });
}

// Preconditions (2)–(4): a Draft artifact whose sidecar is in sync, or whose
// hand-authored §9 parses, with no uncommitted change on what decide writes.
function readArtifact(
  input: DecideArtifactInput,
): Effect.Effect<
  ArtifactSnapshot,
  DecideRefusedError | ArtifactValidationError | FsError | GitError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const { path } = input;
    const md = yield* fs.readText(path);
    const validated = validateArtifact(path, md);
    if (Either.isLeft(validated)) return yield* Effect.fail(validated.left);
    const { kind, status } = validated.right;
    if (status === "Approved" || status === "Stale") {
      return yield* refused(
        "not-draft",
        `${path} is ${status} — reopen it first with \`phax artifact reopen ${path}\``,
      );
    }
    if (status !== "Draft") {
      return yield* refused("not-draft", `${path} is ${status} — only a Draft artifact is decided`);
    }

    const name = parseArtifactName(kind, basename(path));
    const slug = name?.slug ?? basename(path, ".md");
    const id = name === null ? basename(path, ".md") : `${name.stamp}-${name.slug}`;

    const sidecarPath = sidecarPathFor(path);
    let authored: Authored;
    let sidecarText: string | null = null;
    if (yield* fs.exists(sidecarPath)) {
      sidecarText = yield* fs.readText(sidecarPath);
      const { agreement, sidecar } = inspectSidecar({
        md,
        sidecarJson: sidecarText,
        kind,
        sidecarPath,
      });
      if (agreement !== "in-sync" || sidecar === null || sidecar.shape !== "current") {
        const problem =
          agreement === "diverged"
            ? "has a body that differs from its sidecar's rendering"
            : typeof agreement === "object" && agreement.kind === "unmigrated"
              ? `has a sidecar stamped ${describeStampedShape(agreement.format, agreement.shape)} — run \`phax artifact migrate-documents\` first`
              : `has an invalid sidecar (${typeof agreement === "object" && agreement.kind === "invalid" ? agreement.message : "unreadable"})`;
        return yield* refused(
          "sidecar",
          `${path} ${problem}. ${sidecarRemedy(kind, slug, sidecarPath)}`,
        );
      }
      authored = {
        variant: "headless",
        sidecarPath,
        document:
          sidecar.kind === "spec"
            ? { kind: "spec", document: sidecar.document }
            : { kind: "plan", document: sidecar.document },
      };
    } else {
      const parsed = parseHandAuthoredQuestions(kind, md);
      if (parsed.kind === "departs") {
        return yield* refused(
          "hand-format",
          `${path} line ${String(parsed.line)} departs from the §9 format: ${parsed.text}`,
        );
      }
      authored = { variant: "hand", parsed: parsed.kind === "parsed" ? parsed : null };
    }

    const writeSet = sidecarText === null ? [path] : [path, sidecarPath];
    const dirty = yield* git.dirtyPaths(input.repoRoot, writeSet);
    if (dirty.length > 0) {
      return yield* refused(
        "dirty",
        `${dirty.join(", ")} ${dirty.length === 1 ? "has" : "have"} uncommitted changes — commit or discard them first`,
      );
    }
    return { kind, slug, id, md, sidecarText, authored };
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
    if (Either.isLeft(kept) || kept.right.provider !== "claude-code") return fresh();
    const sessionId = decodeClaudeSessionId(kept.right.retrySessionId ?? kept.right.sessionId);
    if (Either.isLeft(sessionId)) return fresh();
    return { kind: "resume", id: sessionId.right, cwd: kept.right.cwd };
  });
}

// The next two-digit index under `<stateRoot>/decide/<id>/`.
function nextDecisionIndex(dir: string): Effect.Effect<string, FsError, FileSystem> {
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
): Either.Either<AcceptedAnswer, RevisionRefusal> {
  const decoded = decodeRevisedDocument(json, {
    original,
    scope: ctx.scope,
    operator: ctx.operator,
    atIso: ctx.atIso,
  });
  if (Either.isLeft(decoded)) return Either.left(decoded.left);
  const after = decoded.right;
  const documents = { before: original, after, scope: ctx.scope };
  const violation = firstRevisionViolation({
    ...documents,
    principleIds: ctx.doctrine.principleIds,
  });
  if (violation !== undefined) return Either.left(violation);
  const rendered = renderRevisedArtifact(ctx.snapshot.md, after);
  return Either.right({
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
): Either.Either<AcceptedAnswer, RevisionRefusal> {
  const { kind, md } = ctx.snapshot;
  const decoded = decodeHandAnswer(json, {
    scope: ctx.scope,
    operator: ctx.operator,
    atIso: ctx.atIso,
  });
  if (Either.isLeft(decoded)) return Either.left(decoded.left);
  const answer: HandDecisionAnswer = decoded.right;
  const documentJson = `${JSON.stringify({ $schema: currentSchemaUrl("hand-decision-answer"), ...answer }, null, 2)}\n`;
  if (parsed === null) {
    return answer.decisions.length === 0
      ? Either.right({ decided: [], md, sidecarText: null, documentJson, planDocument: null })
      : Either.left({ path: "decisions", message: "the artifact has no question section" });
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
  if (violation !== undefined) return Either.left(violation);
  const written = writeHandDecisions({
    kind,
    md,
    answer,
    parsed,
    reArbitrated: ctx.scope.reArbitrated,
  });
  if (Either.isLeft(written)) return Either.left({ path: "markdown", message: written.left });
  const recommendation = new Map(
    [...parsed.open, ...parsed.arbitrated].map((q) => [q.id, q.recommendation]),
  );
  const order = [...parsed.open, ...parsed.arbitrated].map((q) => q.id);
  const decisions = answer.decisions.toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return Either.right({
    decided: decisions.map(({ id, verdict }) => ({
      id,
      chosen: verdict.chosen,
      departs: verdict.chosen !== recommendation.get(id),
      revised: verdict.revised,
    })),
    md: written.right,
    sidecarText: null,
    documentJson,
    planDocument: null,
  });
}

function checkAnswer(
  finalText: string,
  ctx: CheckContext,
): Either.Either<AcceptedAnswer, RevisionRefusal> {
  const parsed = parseFinalMessageJson(finalText);
  if (Either.isLeft(parsed)) return Either.left({ path: "", message: parsed.left });
  const { authored } = ctx.snapshot;
  return authored.variant === "headless"
    ? checkHeadless(parsed.right, ctx, authored.document)
    : checkHand(parsed.right, ctx, authored.parsed);
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
): Effect.Effect<
  AcceptedAnswer,
  | DecideDocumentError
  | AgentInvocationError
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
          ? "hand-decision-answer"
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
    const firstAnswer = checkAnswer(first.finalText, ctx);
    if (Either.isRight(firstAnswer)) return firstAnswer.right;

    const firstRefusal = describeRevisionRefusal(firstAnswer.left);
    const retryPrompt = buildDecideRetryPrompt(firstRefusal);
    yield* fs.writeAtomic(join(folder, DECIDE_RETRY_PROMPT_FILENAME), retryPrompt);
    input.output.warn(
      `revised document refused — ${firstRefusal}\n  resuming the session once to ask for the whole document again`,
    );
    const retried = yield* backend.resumeAgentSession(first.sessionId, retryPrompt, {
      ...options,
      outputJsonlPath: join(folder, DECIDE_RETRY_TRANSCRIPT_FILENAME),
    });
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
 * the files are left written only when the commit itself fails.
 */
export function decideArtifact(
  input: DecideArtifactInput,
): Effect.Effect<
  DecideArtifactResult,
  DecideArtifactError,
  FileSystem | Git | Backend | Session | Prompt | Terminal
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
    if (Either.isLeft(scoped)) return yield* refused("unknown-question", scoped.left);
    const scope = scoped.right;
    if (scope.presented.length === 0) return { kind: "nothing", path } as const;
    if (!(yield* (yield* Terminal).stdinIsTerminal)) {
      return yield* refused(
        "no-terminal",
        "no terminal — phax artifact decide is interactive only",
      );
    }
    const model = resolveDecideModel(input.model, input.effort);
    if (Either.isLeft(model)) return yield* refused("model", model.left);
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
    const facts: DecideSessionFacts = {
      decisionId,
      folder,
      session: session.kind === "resume" ? "resumed-authoring" : "new",
    };
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
    yield* fs.writeAtomic(join(folder, DECIDE_PROMPT_FILENAME), prompt);
    // The session reads its prompt from a gitignored copy in the repository
    // (one argument is capped at 128 KiB on Linux); removed after the session.
    const repoPromptDir = join(
      input.repoRoot,
      ".phax-context",
      "decide",
      `${snapshot.id}-${index}`,
    );
    const repoPromptPath = join(repoPromptDir, DECIDE_PROMPT_FILENAME);
    yield* fs.mkdirp(repoPromptDir);
    yield* fs.writeAtomic(repoPromptPath, prompt);

    const security = resolveReviewSecurityPolicy({
      mode: input.security.profile,
      worktreePath: session.cwd,
      config: input.security,
    });
    const invocation = buildDecideInvocation({
      cwd: session.cwd,
      session: { kind: session.kind, id: session.id },
      model: model.right.model,
      effort: model.right.effort,
      permissionFlags: claudePermissionFlags({
        security,
        cwd: session.cwd,
        agentCommands: [],
        grantSettings: undefined,
      }),
      prompt: positionalPrompt(relative(session.cwd, repoPromptPath)),
    });

    input.output.log(
      `decide ${kind} ${slug} — framing ${FRAMING_QUESTIONS[0]?.id ?? "F1"}–${FRAMING_QUESTIONS.at(-1)?.id ?? "F5"}, then ${scope.presented.join(", ")} — interactive, ${session.kind === "resume" ? "resumed authoring session" : "new session"}`,
    );
    input.output.log(modelLine(model.right));

    // The interactive session: its exit status says nothing about the document.
    yield* (yield* Session).resume(invocation).pipe(
      Effect.mapError(
        (e) =>
          new AgentInvocationError({
            message: `failed to launch claude: ${e.message}`,
            argv: [invocation.executable, ...invocation.args],
          }),
      ),
      Effect.ensuring(fs.remove(repoPromptDir).pipe(Effect.ignore)),
    );

    const ctx: CheckContext = { snapshot, scope, doctrine, operator, atIso: input.nowIso };
    const accepted = yield* handBack(input, ctx, session, folder, {
      provider: "claude-code",
      model: model.right.model,
      effort: model.right.effort,
      cwd: session.cwd,
      security,
      phaseFolderPath: folder,
    });
    yield* fs.writeAtomic(join(folder, DECIDE_DOCUMENT_FILENAME), accepted.documentJson);
    if (accepted.decided.length === 0) return { kind: "undecided", path, ...facts } as const;

    // The body diff, accepted before anything is written.
    const beforePath = join(folder, DECIDE_BEFORE_FILENAME);
    const afterPath = join(folder, DECIDE_AFTER_FILENAME);
    yield* fs.writeAtomic(beforePath, snapshot.md);
    yield* fs.writeAtomic(afterPath, accepted.md);
    const diff = yield* git.diffNoIndex(input.repoRoot, beforePath, afterPath);
    yield* fs.writeAtomic(join(folder, DECIDE_DIFF_FILENAME), diff);
    for (const line of diff.trimEnd().split("\n")) input.output.log(line);
    for (const line of verdictLines(scope, accepted)) input.output.log(line);
    const accept = yield* (yield* Prompt)
      .confirm({ message: "accept the body diff?", initialValue: false })
      .pipe(Effect.catchTag("PromptCancelled", () => Effect.succeed(false)));
    if (!accept) return { kind: "declined", path, ...facts } as const;

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
      model: model.right.model,
      effort: model.right.effort,
      operator: operator.name,
      decisionId,
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
    return {
      kind: "committed",
      path,
      paths,
      decided,
      commit: { hash, subject },
      ...facts,
    } as const;
  });
}
