import { Effect, Result } from "effect";
import { basename, join, resolve } from "node:path";
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
import { type RevisionRefusal, describeRevisionRefusal } from "../domain/decide/revision.js";
import {
  type AgentInvocationError,
  type AgentSessionFailedError,
  type AgentSessionIdMissingError,
  ArtifactCommitFailedError,
  type ArtifactValidationError,
  type RateLimitError,
  type SecurityEnforcementError,
  type UsageLimitError,
} from "../domain/errors.js";
import type { ProviderId } from "../domain/routing/types.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { decodeAuthoringSession } from "../schemas/authoringSession.js";
import { AUTHORING_SESSION_FILENAME, authoringSessionFolder } from "./authorArtifact.js";
import { seedPlanCache } from "./planCacheStore.js";

// The headless writer path decide's verdicts mode and revise share: which
// session the writer runs in, the writer turn with its one corrective resume,
// and the landing of an accepted answer. Each is parameterized by what the
// answer is checked against, how a refusal is worded, the error each failure
// becomes, the folder's file names and the commit message.

// ── Reading a Draft artifact ───────────────────────────────────────────────

/** How the artifact was authored, as the writer reads its questions. */
export type Authored =
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

export interface ArtifactSnapshot {
  readonly kind: ArtifactKind;
  readonly slug: string;
  /** `<stamp>-<slug>`: the authoring id and the decision folder's parent. */
  readonly id: string;
  readonly md: string;
  /** The sidecar's text, or null for a hand-authored artifact. */
  readonly sidecarText: string | null;
  readonly authored: Authored;
}

/** The reasons the shared reading refuses with, each built into the caller's error. */
export type DraftRefusalReason = "not-draft" | "dirty" | "sidecar" | "hand-format";

export interface ReadDraftArtifactInput<E> {
  readonly path: string;
  readonly repoRoot: string;
  /** Builds the caller's refusal from a reason and its message (no caller prefix). */
  readonly refuse: (reason: DraftRefusalReason, message: string) => E;
  /** The verb in `only a Draft artifact is <verb>`. */
  readonly verb: string;
  /** What a hand-authored artifact (no sidecar) gets: its §9 parsed, or the caller's refusal. */
  readonly hand: { readonly kind: "parse" } | { readonly kind: "refuse"; readonly refusal: E };
}

/**
 * Validate the artifact, require it Draft, no uncommitted change on its write
 * set, then its sidecar in sync and current, or the hand-authored branch.
 * Writes nothing.
 */
export function readDraftArtifact<E>(
  input: ReadDraftArtifactInput<E>,
): Effect.Effect<
  ArtifactSnapshot,
  E | ArtifactValidationError | FsError | GitError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const { path, refuse } = input;
    const md = yield* fs.readText(path);
    const validated = validateArtifact(path, md);
    if (Result.isFailure(validated)) return yield* Effect.fail(validated.failure);
    const { kind, status } = validated.success;
    if (status === "Approved" || status === "Stale") {
      return yield* Effect.fail(
        refuse(
          "not-draft",
          `${path} is ${status} — reopen it first with \`phax artifact reopen ${path}\``,
        ),
      );
    }
    if (status !== "Draft") {
      return yield* Effect.fail(
        refuse("not-draft", `${path} is ${status} — only a Draft artifact is ${input.verb}`),
      );
    }

    const name = parseArtifactName(kind, basename(path));
    const slug = name?.slug ?? basename(path, ".md");
    const id = name === null ? basename(path, ".md") : `${name.stamp}-${name.slug}`;

    // Uncommitted changes first: a stray edit is named as such, not as a
    // sidecar the body diverged from.
    const sidecarPath = sidecarPathFor(path);
    const hasSidecar = yield* fs.exists(sidecarPath);
    const writeSet = hasSidecar ? [path, sidecarPath] : [path];
    const dirty = yield* git.dirtyPaths(input.repoRoot, writeSet);
    if (dirty.length > 0) {
      return yield* Effect.fail(
        refuse(
          "dirty",
          `${dirty.join(", ")} ${dirty.length === 1 ? "has" : "have"} uncommitted changes — commit or discard them first`,
        ),
      );
    }

    let authored: Authored;
    let sidecarText: string | null = null;
    if (hasSidecar) {
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
        return yield* Effect.fail(
          refuse("sidecar", `${path} ${problem}. ${sidecarRemedy(kind, slug, sidecarPath)}`),
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
    } else if (input.hand.kind === "refuse") {
      return yield* Effect.fail(input.hand.refusal);
    } else {
      const parsed = parseHandAuthoredQuestions(kind, md);
      if (parsed.kind === "departs") {
        return yield* Effect.fail(
          refuse(
            "hand-format",
            `${path} line ${String(parsed.line)} departs from the §9 format: ${parsed.text}`,
          ),
        );
      }
      authored = { variant: "hand", parsed: parsed.kind === "parsed" ? parsed : null };
    }
    return { kind, slug, id, md, sidecarText, authored };
  });
}

// ── The writer session ─────────────────────────────────────────────────────

/** The session the writer runs in: the kept authoring session, or a new one. */
export interface WriterSession {
  readonly kind: "new" | "resume";
  /** The session to resume (kind `resume`). */
  readonly id: ClaudeSessionId | null;
  /** Every session id kept for the authoring session (none for a new one). */
  readonly keptIds: readonly string[];
}

/**
 * The authoring session kept in `session.json`, resumed only when it decodes,
 * was authored on the provider routing selected, and ran in this checkout; a
 * new session otherwise. The state root is shared by every checkout, so a
 * session authored in another clone, or one since moved or deleted, is not
 * resumed.
 */
export function chooseWriterSession(input: {
  readonly stateRoot: string;
  readonly repoRoot: string;
  readonly artifactId: string;
  readonly provider: ProviderId;
}): Effect.Effect<WriterSession, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const fresh: WriterSession = { kind: "new", id: null, keptIds: [] };
    const file = join(
      authoringSessionFolder(input.stateRoot, input.artifactId),
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
    if (Result.isFailure(kept)) return fresh;
    if (kept.success.provider !== input.provider) return fresh;
    if (resolve(kept.success.cwd) !== resolve(input.repoRoot)) return fresh;
    const id = decodeClaudeSessionId(kept.success.retrySessionId ?? kept.success.sessionId);
    if (Result.isFailure(id)) return fresh;
    return {
      kind: "resume",
      id: id.success,
      keptIds: [
        kept.success.sessionId,
        ...(kept.success.retrySessionId === null ? [] : [kept.success.retrySessionId]),
      ],
    };
  });
}

// ── The writer turn ────────────────────────────────────────────────────────

/** What a record needs to know of the session once it has started. */
export interface ObservedWriter<A> {
  /** Set before the corrective resume runs, so even a failed resume records it. */
  retried: boolean;
  /** The session id each turn reported. */
  readonly sessionIds: string[];
  /** The answer that passed every check, once there is one. */
  accepted: A | null;
}

export type WriterError<E> =
  | E
  | AgentInvocationError
  | AgentSessionFailedError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError;

export interface RunWriterInput<A, E> {
  readonly session: WriterSession;
  readonly prompt: string;
  readonly folder: string;
  /** The agent options bar the transcript path; the run is always read-only. */
  readonly options: Omit<AgentRunOptions, "outputJsonlPath" | "readOnly">;
  /** What the answer is checked against. */
  readonly check: (result: AgentRunResult) => Result.Result<A, RevisionRefusal>;
  /** The prompt of the corrective resume, from the first refusal's description. */
  readonly retryPrompt: (refusal: string) => string;
  /** The warn line printed before the corrective resume. */
  readonly refusedWarning: (refusal: string) => string;
  /** The error of a second refusal; its message names both refusals. */
  readonly rejectedTwice: (path: string, message: string) => E;
  readonly transcriptFileName: string;
  readonly retryPromptFileName: string;
  readonly retryTranscriptFileName: string;
  readonly observed: ObservedWriter<A>;
  readonly warn: (message: string) => void;
}

/**
 * One headless read-only turn: the kept session resumed, or a new session. A
 * refused answer resumes the session once more with the refusal; a second
 * refusal fails through `rejectedTwice`. Provider errors and limits are never
 * retried.
 */
export function runWriter<A, E>(
  input: RunWriterInput<A, E>,
): Effect.Effect<A, WriterError<E>, FileSystem | Backend> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const backend = yield* Backend;
    const { session, prompt, folder, observed } = input;
    const options = { ...input.options, readOnly: true } as const;

    const firstOptions: AgentRunOptions = {
      ...options,
      outputJsonlPath: join(folder, input.transcriptFileName),
    };
    const first: AgentRunResult =
      session.id === null
        ? yield* backend.runAgent(prompt, firstOptions)
        : yield* backend.resumeAgentSession(session.id, prompt, firstOptions);
    observed.sessionIds.push(first.sessionId);
    const firstAnswer = input.check(first);
    if (Result.isSuccess(firstAnswer)) {
      observed.accepted = firstAnswer.success;
      return firstAnswer.success;
    }

    const firstRefusal = describeRevisionRefusal(firstAnswer.failure);
    const retryPrompt = input.retryPrompt(firstRefusal);
    yield* fs.writeAtomic(join(folder, input.retryPromptFileName), retryPrompt);
    input.warn(input.refusedWarning(firstRefusal));
    observed.retried = true;
    const retried = yield* backend.resumeAgentSession(first.sessionId, retryPrompt, {
      ...options,
      outputJsonlPath: join(folder, input.retryTranscriptFileName),
    });
    observed.sessionIds.push(retried.sessionId);
    const retryAnswer = input.check(retried);
    if (Result.isSuccess(retryAnswer)) {
      observed.accepted = retryAnswer.success;
      return retryAnswer.success;
    }
    return yield* Effect.fail(
      input.rejectedTwice(
        retryAnswer.failure.path,
        `revised document rejected twice — first answer: ${firstRefusal}; retry: ${describeRevisionRefusal(retryAnswer.failure)}`,
      ),
    );
  });
}

// ── Landing an accepted answer ─────────────────────────────────────────────

/** The names of the files an answer leaves in the writer's folder. */
export interface AnswerFileNames {
  readonly document: string;
  readonly before: string;
  readonly after: string;
  readonly diff: string;
}

/**
 * Keep the accepted answer in the folder: its document, the artifact's text
 * before and after, and their body diff, which it returns. Writes nothing to
 * the repository.
 */
export function diffAnswer(input: {
  readonly folder: string;
  readonly repoRoot: string;
  readonly path: string;
  readonly beforeMd: string;
  readonly afterMd: string;
  readonly documentJson: string;
  readonly fileNames: AnswerFileNames;
}): Effect.Effect<string, FsError | GitError, FileSystem | Git> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const { folder, fileNames } = input;
    yield* fs.writeAtomic(join(folder, fileNames.document), input.documentJson);
    const beforePath = join(folder, fileNames.before);
    const afterPath = join(folder, fileNames.after);
    yield* fs.writeAtomic(beforePath, input.beforeMd);
    yield* fs.writeAtomic(afterPath, input.afterMd);
    const diff = yield* git.diffNoIndex(input.repoRoot, beforePath, afterPath, input.path);
    yield* fs.writeAtomic(join(folder, fileNames.diff), diff);
    return diff;
  });
}

export interface LandAnswerInput<E> {
  readonly repoRoot: string;
  readonly stateRoot: string;
  /** Repo-relative path of the artifact. */
  readonly path: string;
  /** The artifact and sidecar as the session started. */
  readonly snapshotMd: string;
  readonly snapshotSidecarText: string | null;
  /** The accepted artifact text and sidecar text (null: no sidecar). */
  readonly md: string;
  readonly sidecarText: string | null;
  /** A headless plan's document, for the extraction cache seed. */
  readonly planDocument: Extract<SidecarDocument, { kind: "plan" }> | null;
  readonly extractPlanModel: string;
  readonly extractPlanEffort: string;
  readonly nowIso: string;
  readonly commitMessage: { readonly subject: string; readonly body: string };
  /** Whether the commit keeps its message byte for byte, past git's cleanup. */
  readonly verbatimMessage: boolean;
  /** The caller's refusal when the artifact or its sidecar changed while the session ran. */
  readonly changed: (path: string, which: "artifact" | "sidecar") => E;
}

/**
 * Write the accepted answer and commit it. A change made while the writer ran
 * is left in place and refused through `changed`, writing nothing. A plan's
 * extraction cache is seeded before the write, the artifact and its sidecar
 * are written and exactly those paths committed in one commit. The files are
 * left written only when the commit itself fails.
 */
export function landAnswer<E>(input: LandAnswerInput<E>): Effect.Effect<
  {
    readonly paths: readonly string[];
    readonly commit: { readonly hash: string; readonly subject: string };
  },
  E | ArtifactCommitFailedError | FsError | GitError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const { path } = input;

    const sidecarPath = sidecarPathFor(path);
    const mdNow = yield* fs.readText(path);
    const sidecarNow = (yield* fs.exists(sidecarPath)) ? yield* fs.readText(sidecarPath) : null;
    if (mdNow !== input.snapshotMd || sidecarNow !== input.snapshotSidecarText) {
      const sidecarChanged = sidecarNow !== input.snapshotSidecarText && mdNow === input.snapshotMd;
      return yield* Effect.fail(
        input.changed(sidecarChanged ? sidecarPath : path, sidecarChanged ? "sidecar" : "artifact"),
      );
    }

    // Seeded before the plan is written: the entry is content-addressed, so a
    // seed whose plan never lands is inert.
    if (input.planDocument !== null) {
      yield* seedPlanCache({
        stateRoot: input.stateRoot,
        planMd: input.md,
        document: input.planDocument.document,
        extractPlanModel: input.extractPlanModel,
        extractPlanEffort: input.extractPlanEffort,
        nowIso: input.nowIso,
      });
    }
    yield* fs.writeAtomic(path, input.md);
    const paths = [path];
    if (input.sidecarText !== null) {
      yield* fs.writeAtomic(sidecarPath, input.sidecarText);
      paths.push(sidecarPath);
    }

    const { subject, body } = input.commitMessage;
    const committed = yield* Effect.result(
      git.commitPaths(input.repoRoot, paths, subject, body, { verbatim: input.verbatimMessage }),
    );
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
    return { paths, commit: { hash, subject } };
  });
}
