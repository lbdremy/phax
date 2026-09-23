import { Effect, Either, Schema } from "effect";
import { join } from "node:path";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { OutputPort } from "../ports/output.js";
import {
  ArtifactCommitFailedError,
  ArtifactCreationError,
  AuthoringDocumentError,
  type AgentInvocationError,
  type RateLimitError,
  type SecurityEnforcementError,
  type UsageLimitError,
} from "../domain/errors.js";
import { sidecarPathFor } from "../domain/artifact/sidecar.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { formatStamp } from "../domain/artifact/name.js";
import { stripJsonCodeFence } from "../domain/authoring/jsonText.js";
import { AUTHORING_PROMPT_FILENAME, buildAuthoringPrompt } from "../domain/authoring/prompt.js";
import { renderPlanBody } from "../domain/authoring/renderPlan.js";
import { renderSpecBody } from "../domain/authoring/renderSpec.js";
import { EXTRACTOR_VERSION, planCacheKey } from "../domain/planCache/key.js";
import type { RoutingResolution } from "../domain/routing/types.js";
import { resolveReviewSecurityPolicy } from "../domain/security/resolveReviewPolicy.js";
import { formatFirstViolation } from "../schemas/formatError.js";
import type { Effort } from "../schemas/phaxConfig.js";
import {
  PlanDocumentSchema,
  decodePlanDocument,
  getPlanDocumentJsonSchema,
  projectExtractedPlan,
  type PlanDocument,
} from "../schemas/planDocument.js";
import type { ProviderId } from "../schemas/providerId.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../schemas/securityConfig.js";
import {
  SpecDocumentSchema,
  decodeSpecDocument,
  getSpecDocumentJsonSchema,
  type SpecDocument,
} from "../schemas/specDocument.js";
import {
  planSkeleton,
  resolveArtifactTarget,
  specSkeleton,
  type ArtifactTarget,
} from "./createArtifact.js";
import { planMdSha256, writeCacheEntry } from "./planCacheStore.js";
import { writeAuthoringRecord, type WriteAuthoringRecordResult } from "./writeAuthoringRecord.js";

/** Files of an authoring session folder, `<stateRoot>/authoring/<authoringId>/`. */
export const AUTHORING_BRIEF_FILENAME = "brief.md";
export const AUTHORING_DOCUMENT_FILENAME = "document.json";
export const AUTHORING_TRANSCRIPT_FILENAME = "output.jsonl";

export interface AuthorArtifactInput {
  readonly kind: ArtifactKind;
  readonly slug: string;
  /** The brief's text, and its path when it was read from a file (null for stdin). */
  readonly brief: { readonly text: string; readonly path: string | null };
  /** A plan's `--spec` path (validated like the interactive path); null otherwise. */
  readonly sourceSpec: string | null;
  /** The selected authoring model and effort (flag → config → catalog), as requested. */
  readonly model: string;
  readonly effort: Effort;
  /** The routing resolution of `model`/`effort`: which provider and concrete model run. */
  readonly resolution: RoutingResolution;
  /** The bundled skill's SKILL.md (`phax-spec` or `phax-planning`), verbatim. */
  readonly skillText: string;
  readonly security: ResolvedSecurityConfig;
  readonly repoRoot: string;
  readonly stateRoot: string;
  /** The plan-extraction model/effort the cache seed is keyed on (`phax run`'s). */
  readonly extractPlanModel: string;
  readonly extractPlanEffort: string;
  readonly nowIso: string;
  /** Where the session's authoring record goes (`records` off: nowhere). */
  readonly records: ResolvedRecordsConfig;
  /** The local records clone, required for a dedicated `repo` records destination. */
  readonly recordsClonePath?: string | undefined;
  /**
   * Where a failed session's record warning goes. A committed session's record
   * is returned in the result for the caller to render instead.
   */
  readonly output: Pick<OutputPort, "warn">;
}

/**
 * What became of the session's authoring record. A record never fails the
 * authoring: an I/O failure degrades to `write-failed`, a refused destination
 * is reported, not raised.
 */
export type AuthoringRecordStatus =
  | WriteAuthoringRecordResult
  | { readonly kind: "write-failed"; readonly message: string };

export interface AuthorArtifactResult {
  /** Repo-relative path of the rendered artifact. */
  readonly path: string;
  /** Repo-relative path of the JSON sidecar beside it. */
  readonly sidecarPath: string;
  readonly commit: { readonly hash: string; readonly subject: string };
  /** `<stamp>-<slug>`: the session folder's name and the `Authoring-Id` trailer. */
  readonly authoringId: string;
  /** Absolute path of `<stateRoot>/authoring/<authoringId>/`. */
  readonly sessionFolder: string;
  /** The authoring record, written after the artifact commit. */
  readonly record: AuthoringRecordStatus;
}

export type AuthorArtifactError =
  | ArtifactCreationError
  | AuthoringDocumentError
  | ArtifactCommitFailedError
  | AgentInvocationError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError
  | GitError;

type AuthoredDocument =
  | { readonly kind: "spec"; readonly doc: SpecDocument }
  | { readonly kind: "plan"; readonly doc: PlanDocument };

export function authoringSessionFolder(stateRoot: string, authoringId: string): string {
  return join(stateRoot, "authoring", authoringId);
}

/** The commit that lands a headless-authored artifact and its sidecar. */
export function authoringCommitMessage(input: {
  readonly kind: ArtifactKind;
  readonly slug: string;
  readonly path: string;
  readonly authoringId: string;
  readonly model: string;
  readonly effort: string;
}): { readonly subject: string; readonly body: string } {
  const scope = input.kind === "spec" ? "specs" : "plans";
  const subject = `docs(${scope}): draft ${input.slug}`;
  const body = [
    `Authored headless (${input.model} / ${input.effort}); the JSON sidecar beside it is the document it renders.`,
    "",
    `Artifact: ${input.path}`,
    `Authoring-Id: ${input.authoringId}`,
  ].join("\n");
  return { subject, body };
}

function documentError(kind: ArtifactKind, slug: string, reason: string): AuthoringDocumentError {
  return new AuthoringDocumentError({
    kind,
    slug,
    message: `${kind} document rejected — ${reason}`,
  });
}

// The session's final message → a decoded document of the requested kind, or
// the reason it is unusable (not JSON, or the first schema violation).
function parseAuthoredDocument(
  kind: ArtifactKind,
  slug: string,
  finalText: string,
): Either.Either<AuthoredDocument, AuthoringDocumentError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonCodeFence(finalText));
  } catch {
    return Either.left(
      documentError(
        kind,
        slug,
        `the session's final message is not JSON: ${finalText.slice(0, 200)}`,
      ),
    );
  }

  if (kind === "spec") {
    const decoded = decodeSpecDocument(parsed);
    return Either.isLeft(decoded)
      ? Either.left(documentError(kind, slug, formatFirstViolation(decoded.left)))
      : Either.right({ kind, doc: decoded.right });
  }
  const decoded = decodePlanDocument(parsed);
  return Either.isLeft(decoded)
    ? Either.left(documentError(kind, slug, formatFirstViolation(decoded.left)))
    : Either.right({ kind, doc: decoded.right });
}

function encodeDocument(authored: AuthoredDocument): string {
  const encoded =
    authored.kind === "spec"
      ? Schema.encodeSync(SpecDocumentSchema)(authored.doc)
      : Schema.encodeSync(PlanDocumentSchema)(authored.doc);
  return JSON.stringify(encoded, null, 2) + "\n";
}

function renderArtifact(
  authored: AuthoredDocument,
  nowIso: string,
  sourceSpec: string | null,
): string {
  return authored.kind === "spec"
    ? specSkeleton(nowIso) + renderSpecBody(authored.doc)
    : planSkeleton(sourceSpec) + renderPlanBody(authored.doc);
}

// Steps 3–7: spawn the session, accept its document, render, seed, write, commit.
// Nothing reaches the repository before the document decodes; the two files are
// left in place (uncommitted) only when the commit itself fails.
function runAuthoringSession(
  input: AuthorArtifactInput,
  target: ArtifactTarget,
  session: {
    readonly authoringId: string;
    readonly folder: string;
    readonly prompt: string;
    readonly binding: SessionBinding;
    /** Set once the agent returns, so the record can locate a vibe session's usage. */
    readonly observed: { sessionId?: string };
  },
): Effect.Effect<
  Omit<AuthorArtifactResult, "record">,
  AuthorArtifactError,
  FileSystem | Git | Backend
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const backend = yield* Backend;

    const agentResult = yield* backend.runAgent(session.prompt, {
      provider: session.binding.provider,
      model: session.binding.model,
      effort: session.binding.effort,
      cwd: input.repoRoot,
      security: resolveReviewSecurityPolicy({
        mode: input.security.profile,
        worktreePath: input.repoRoot,
        config: input.security,
      }),
      outputJsonlPath: join(session.folder, AUTHORING_TRANSCRIPT_FILENAME),
      phaseFolderPath: session.folder,
    });
    session.observed.sessionId = agentResult.sessionId;

    const parsed = parseAuthoredDocument(input.kind, input.slug, agentResult.finalText);
    if (Either.isLeft(parsed)) return yield* Effect.fail(parsed.left);

    // `--spec` is authoritative for a plan's source spec: the frontmatter carries
    // it, so the sidecar must agree with the frontmatter whatever the session said.
    const sourceSpec = target.sourceSpec?.path ?? null;
    const authored: AuthoredDocument =
      parsed.right.kind === "plan"
        ? { kind: "plan", doc: { ...parsed.right.doc, sourceSpec } }
        : parsed.right;

    const sidecarText = encodeDocument(authored);
    yield* fs.writeAtomic(join(session.folder, AUTHORING_DOCUMENT_FILENAME), sidecarText);

    const artifactMd = renderArtifact(authored, input.nowIso, sourceSpec);

    // Seeded before the artifact is written: the entry is content-addressed, so a
    // seed whose artifact never lands is inert, and a failed seed lands nothing.
    if (authored.kind === "plan") {
      const key = planCacheKey(artifactMd, input.extractPlanModel, input.extractPlanEffort);
      yield* writeCacheEntry(input.stateRoot, key, {
        planMdSha256: planMdSha256(artifactMd),
        model: input.extractPlanModel,
        effort: input.extractPlanEffort,
        extractorVersion: EXTRACTOR_VERSION,
        extractedAt: input.nowIso,
        extracted: projectExtractedPlan(authored.doc),
      });
    }

    const sidecarPath = sidecarPathFor(target.path);
    yield* fs.mkdirp(target.dir);
    yield* fs.writeAtomic(target.path, artifactMd);
    yield* fs
      .writeAtomic(sidecarPath, sidecarText)
      .pipe(Effect.tapError(() => fs.remove(target.path).pipe(Effect.ignore)));

    const { subject, body } = authoringCommitMessage({
      kind: input.kind,
      slug: input.slug,
      path: target.path,
      authoringId: session.authoringId,
      model: input.model,
      effort: input.effort,
    });
    const paths = [target.path, sidecarPath];
    const committed = yield* Effect.either(git.commitPaths(input.repoRoot, paths, subject, body));
    if (Either.isLeft(committed)) {
      return yield* Effect.fail(
        new ArtifactCommitFailedError({ paths, cause: committed.left.message }),
      );
    }
    const hash = yield* git.headCommit(input.repoRoot);

    return {
      path: target.path,
      sidecarPath,
      commit: { hash, subject },
      authoringId: session.authoringId,
      sessionFolder: session.folder,
    };
  });
}

/**
 * `artifact new spec|plan --headless`: from a brief, run one recorded authoring
 * session under the read-only review posture rooted at the repository, accept a
 * schema-valid document as its final message, render the artifact with the
 * interactive frontmatter, write the JSON sidecar beside it, seed the extraction
 * cache for a plan, and commit exactly the two paths. Every session that ran —
 * committed or failed — then writes one authoring record on `phax/records/v1`.
 *
 * Every refusal (the interactive path's, plus an existing sidecar) precedes the
 * session and records nothing; a document failure writes nothing to the
 * repository. The use case
 * never reads `phax.json`, stdin or the skill bundle: the caller resolves them.
 */
export function authorArtifact(
  input: AuthorArtifactInput,
): Effect.Effect<AuthorArtifactResult, AuthorArtifactError, FileSystem | Git | GitHub | Backend> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const target = yield* resolveArtifactTarget(input);
    const sidecarPath = sidecarPathFor(target.path);
    if (yield* fs.exists(sidecarPath)) {
      return yield* Effect.fail(
        new ArtifactCreationError({ message: `${sidecarPath} already exists` }),
      );
    }

    const authoringId = `${formatStamp(input.nowIso)}-${input.slug}`;
    const folder = authoringSessionFolder(input.stateRoot, authoringId);
    const prompt = buildAuthoringPrompt({
      kind: input.kind,
      skillText: input.skillText,
      jsonSchema: input.kind === "spec" ? getSpecDocumentJsonSchema() : getPlanDocumentJsonSchema(),
      brief: input.brief.text,
      sourceSpec: target.sourceSpec,
      slug: input.slug,
    });
    yield* fs.mkdirp(folder);
    yield* fs.writeAtomic(join(folder, AUTHORING_BRIEF_FILENAME), input.brief.text);
    yield* fs.writeAtomic(join(folder, AUTHORING_PROMPT_FILENAME), prompt);

    const binding: SessionBinding = {
      provider: input.resolution.selected.provider,
      model: input.resolution.selected.concreteModel,
      effort: input.resolution.selected.thinking ?? input.effort,
    };
    const observed: { sessionId?: string } = {};
    const outcome = yield* Effect.either(
      runAuthoringSession(input, target, { authoringId, folder, prompt, binding, observed }),
    );

    // The session has ended, committed (Right) or failed (Left): record both,
    // the committed one after the artifact commit it points back to, before a
    // failure is re-raised. `folder` holds brief.md, prompt.md, output.jsonl
    // and, when the document was accepted, document.json.
    const record = yield* recordSession(input, {
      authoringId,
      folder,
      artifact: target.path,
      binding,
      sessionId: observed.sessionId,
      sourceSha: Either.isRight(outcome) ? outcome.right.commit.hash : undefined,
    });
    if (Either.isLeft(outcome)) {
      const warning = recordWarning(record);
      if (warning !== undefined) input.output.warn(warning);
      return yield* Effect.fail(outcome.left);
    }
    return { ...outcome.right, record };
  });
}

/** The provider, concrete model and effort the session actually ran with. */
interface SessionBinding {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
}

function recordSession(
  input: AuthorArtifactInput,
  session: {
    readonly authoringId: string;
    readonly folder: string;
    readonly artifact: string;
    readonly binding: SessionBinding;
    readonly sessionId: string | undefined;
    /** The artifact commit, or undefined when the session did not commit. */
    readonly sourceSha: string | undefined;
  },
): Effect.Effect<AuthoringRecordStatus, never, FileSystem | Git | GitHub> {
  return writeAuthoringRecord({
    repoRoot: input.repoRoot,
    recordsClonePath: input.recordsClonePath,
    sessionFolder: session.folder,
    authoringId: session.authoringId,
    artifact: session.artifact,
    artifactKind: input.kind,
    provider: session.binding.provider,
    model: session.binding.model,
    effort: session.binding.effort,
    outcome: session.sourceSha === undefined ? "failed" : "committed",
    records: input.records,
    ...(session.sourceSha !== undefined ? { sourceSha: session.sourceSha } : {}),
    ...(session.sessionId !== undefined ? { sessionId: session.sessionId } : {}),
  }).pipe(
    Effect.catchAll((e) => Effect.succeed({ kind: "write-failed", message: e.message } as const)),
  );
}

/**
 * The warning a record outcome deserves, or undefined when there is nothing to
 * say (written, or records off). A refused destination names its remedy, as
 * phase records do.
 */
export function recordWarning(record: AuthoringRecordStatus): string | undefined {
  switch (record.kind) {
    case "written":
    case "records-off":
      return undefined;
    case "deferred-destination":
      return "authoring record not written — the dedicated records clone is not configured (run `phax records sync`)";
    case "refused":
      return `authoring record refused: ${record.message} (remedy: ${record.remedy})`;
    case "write-failed":
      return `failed to write the authoring record (${record.message})`;
  }
}
