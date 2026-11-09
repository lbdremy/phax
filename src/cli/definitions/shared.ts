// What phax's command definitions share: the configuration read as a run's first step, the
// repository and a path argument made repo-relative, the fields an error line carries, and the
// errors of a command that runs an agent session.
import { execSync } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Data, Effect, Result } from "effect";
import * as Schema from "effect/Schema";
import { loadConfig } from "../../app/loadConfig.js";
import { ArtifactCommitFailedError, type ConfigValidationError } from "../../domain/errors.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { FileSystem } from "../../ports/fs.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import type { FormatId } from "../../schemas/schemaUrl.js";
import { currentSchemaUrl } from "../../schemas/persisted.js";
import { CompleterAnnotationId, Written, written } from "../commandLibrary/contract/index.js";
import { exitCodeForAuthoringError } from "../commands/runLayers.js";
import { splitFollowUps } from "../commands/sessionFailureOutput.js";

/** The fields of an error these commands declare, as the catalogue lists them: its message. */
export const MessageFields = Schema.Struct({ message: Schema.String });

/** An error as the runner reads its fields: a `Data.TaggedError` keeps its `message` off its
 *  enumerable own fields, so the `error` line under `--json` would carry none. The record keeps
 *  the tag and the fields, with the message among them when there is one. */
export function exposeMessage<E extends { readonly _tag: string; readonly message: string }>(
  error: E,
): E {
  // The tag is an own enumerable field, so the spread keeps it.
  return error.message === "" ? error : { ...error, message: error.message };
}

/** The configuration of the invocation directory's repository, or the error that refused it. */
export function configured(): Effect.Effect<ResolvedConfig, ConfigValidationError> {
  return Effect.suspend(() => {
    const config = loadConfig(process.cwd());
    return Result.isFailure(config) ? Effect.fail(config.left) : Effect.succeed(config.right);
  });
}

/** The root of the working tree holding `startDir`, or undefined outside any. */
export function gitRoot(startDir: string): string | undefined {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root.length > 0 ? root : undefined;
  } catch {
    return undefined;
  }
}

/** The root of the working tree holding `startDir`, or `startDir` outside any. */
export function findGitRoot(startDir: string): string {
  return gitRoot(startDir) ?? startDir;
}

/** `path` absolutized against the invocation directory, and made repo-relative and POSIX:
 *  classifyArtifactPath matches on repo-relative paths, and a path outside the repository yields
 *  `../…`, which never classifies as an artifact. */
export function repoPaths(
  path: string,
  repoRoot: string,
): { readonly absolute: string; readonly repoRelPath: string } {
  const absolute = resolve(process.cwd(), path);
  return { absolute, repoRelPath: relative(repoRoot, absolute).split(sep).join("/") };
}

/** A run's short name, as every definition that takes a run declares it: with the completer that
 *  lists the runs (`phax ls --complete`), written once in the usage spec for the identifier. */
export const ShortNameArg = Schema.String.annotate({
  identifier: "short-name",
  description: "Run short name, e.g. usage-cli",
  [CompleterAnnotationId]: { run: "phax ls --complete", descriptions: true },
});

/** A written file's path as its record names it: from the repository root when the file is inside
 *  the repository holding `root`, else absolute (~/.phax and ~/.claude have no repository root,
 *  nor has a file written outside any repository, whose `root` is undefined). */
export function recordedPath(path: string, root: string | undefined): string {
  if (root === undefined) return path;
  const relation = relative(root, path);
  return relation === "" || relation.startsWith("..") || isAbsolute(relation)
    ? path
    : relation.split(sep).join("/");
}

/** The annotation that names a published format as an output's JSON Schema: a reference to the
 *  format's current shape, which the catalogue writes in place of the generated schema. */
export function publishedFormat(formatId: FormatId): {
  readonly jsonSchema: { readonly $ref: string };
} {
  return { jsonSchema: { $ref: currentSchemaUrl(formatId) } };
}

/** The records of the repo-relative files that exist now, each read back from the disk: a path
 *  deleted or never written is left out. A file unreadable after it was found is a defect. */
export function writtenRecords(
  paths: ReadonlyArray<string>,
  repoRoot: string,
): Effect.Effect<ReadonlyArray<Written>> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const records: Written[] = [];
    for (const path of paths) {
      if (!(yield* fs.exists(path))) continue;
      records.push(yield* written(path, yield* fs.readBytes(path)));
    }
    return records;
  }).pipe(Effect.provide(makeRootedNodeFileSystemLayer(repoRoot)), Effect.orDie);
}

/** A failed commit after the files were written: the sentence of the use case's error, and the
 *  files the failed command left in the working tree, which the runner lifts into the `error`
 *  line's `written`. */
export class CommitFailedError extends Data.TaggedError("ArtifactCommitFailedError")<{
  readonly message: string;
  readonly written: ReadonlyArray<Written>;
}> {}

/** The fields of a failed commit's error, as the catalogue lists them. */
export const CommitFailedFields = Schema.Struct({
  message: Schema.String,
  written: Schema.Array(Written),
});

// ── A session command's record ──────────────────────────────────────────────────

/** What became of a session's record (a decision or an authoring record): written with its key,
 *  the note of a record kept on a diverged or unrelated records branch (or null) and the warning
 *  of a push that failed (or null); off; or not written with its warning. */
export const RecordOutcome = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("written"),
    key: Schema.String,
    branchNote: Schema.NullOr(Schema.String),
    pushWarning: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("off") }),
  Schema.Struct({ kind: Schema.Literal("not-written"), warning: Schema.String }),
]);

export type RecordOutcome = typeof RecordOutcome.Type;

/** A record's outcome from the use case's record and push, with the sentences of their
 *  warnings (`warningOf`, `pushWarningOf`) and the fallback when a refusal has none. */
export function recordOutcome<R extends { readonly kind: string }, P>(
  record: R,
  push: P,
  sentences: {
    readonly warningOf: (record: R) => string | undefined;
    readonly pushWarningOf: (push: P) => string | undefined;
    readonly fallback: string;
  },
): RecordOutcome {
  if (record.kind === "written") {
    // A written record can still owe a note (kept on a diverged records branch),
    // its own field beside the push's warning: pushWarning stays a failed push.
    return {
      kind: "written",
      key: String(Reflect.get(record, "key")),
      branchNote: sentences.warningOf(record) ?? null,
      pushWarning: sentences.pushWarningOf(push) ?? null,
    };
  }
  if (record.kind === "records-off") return { kind: "off" };
  return { kind: "not-written", warning: sentences.warningOf(record) ?? sentences.fallback };
}

/** The notes of a record's outcome: its warning, or its push's, on stderr after the answer. */
export function recordNotes(record: RecordOutcome): string {
  if (record.kind === "not-written") return record.warning;
  if (record.kind === "written") {
    return [record.branchNote, record.pushWarning].filter((note) => note !== null).join("\n");
  }
  return "";
}

// ── A session command's failure ─────────────────────────────────────────────────

/** What a command running an agent session (`artifact decide`, `artifact new --headless`) fails
 *  with, whatever the use case's error: its first line's sentence (`message`), the lines a person
 *  reads on stderr (`lines`: the failure, the session, the files to read, the retry), the warnings
 *  that ride on it (`followUps`: the record's and its push's), and the files left written in the
 *  working tree (`written`: the artifact and its sidecar when only the commit failed, else none). */
interface SessionCommandFields {
  readonly message: string;
  readonly lines: ReadonlyArray<string>;
  readonly followUps: ReadonlyArray<string>;
  readonly written: ReadonlyArray<Written>;
}

/** The fields of a session command's error, as the catalogue lists them. */
const SessionCommandFailureFields = Schema.Struct({
  message: Schema.String,
  lines: Schema.Array(Schema.String),
  followUps: Schema.Array(Schema.String),
  written: Schema.Array(Written),
});

/** Exit 1: a read, git or prompt failure, a config the command could not load. */
class CommandFailedError extends Data.TaggedError("CommandFailedError")<SessionCommandFields> {}

/** Exit 2: an invalid routing configuration. */
class ConfigInvalidError extends Data.TaggedError("ConfigInvalidError")<SessionCommandFields> {}

/** Exit 5: a failed agent session, or an answer refused after the one corrective resume. */
class SessionFailedError extends Data.TaggedError("SessionFailedError")<SessionCommandFields> {}

/** Exit 8: a provider rate or usage limit. */
class ProviderLimitError extends Data.TaggedError("ProviderLimitError")<SessionCommandFields> {}

/** Exit 11: the security policy refused the session. */
class SecurityRefusedError extends Data.TaggedError("SecurityRefusedError")<SessionCommandFields> {}

/** Exit 12: an artifact refusal, or a failed commit that left the files written. */
class ArtifactRefusedError extends Data.TaggedError("ArtifactRefusedError")<SessionCommandFields> {}

/** Exit 14: the provider was unreachable (a network failure). */
class ProviderUnreachableError extends Data.TaggedError(
  "ProviderUnreachableError",
)<SessionCommandFields> {}

export type SessionCommandError =
  | CommandFailedError
  | ConfigInvalidError
  | SessionFailedError
  | ProviderLimitError
  | SecurityRefusedError
  | ArtifactRefusedError
  | ProviderUnreachableError;

/** The session command error for an exit code (exitCodeForAuthoringError's): one tag per code. */
function sessionCommandError(code: number, fields: SessionCommandFields): SessionCommandError {
  switch (code) {
    case 2:
      return new ConfigInvalidError(fields);
    case 5:
      return new SessionFailedError(fields);
    case 8:
      return new ProviderLimitError(fields);
    case 11:
      return new SecurityRefusedError(fields);
    case 12:
      return new ArtifactRefusedError(fields);
    case 14:
      return new ProviderUnreachableError(fields);
    default:
      return new CommandFailedError(fields);
  }
}

/** A session command's refusal or failure before anything ran, as one sentence and its code. */
export function sessionCommandRefusal(code: number, line: string): SessionCommandError {
  return sessionCommandError(code, { message: line, lines: [line], followUps: [], written: [] });
}

/** What a session command declares of its errors: the codes, the fields and today's text — its
 *  lines, then each follow-up warning. */
export const sessionCommandExits = {
  CommandFailedError: 1,
  ConfigInvalidError: 2,
  SessionFailedError: 5,
  ProviderLimitError: 8,
  SecurityRefusedError: 11,
  ArtifactRefusedError: 12,
  ProviderUnreachableError: 14,
} as const;

export const sessionCommandErrors = {
  CommandFailedError: SessionCommandFailureFields,
  ConfigInvalidError: SessionCommandFailureFields,
  SessionFailedError: SessionCommandFailureFields,
  ProviderLimitError: SessionCommandFailureFields,
  SecurityRefusedError: SessionCommandFailureFields,
  ArtifactRefusedError: SessionCommandFailureFields,
  ProviderUnreachableError: SessionCommandFailureFields,
} as const;

/** A session command's use-case failure as the error the command declares: the code
 *  exitCodeForAuthoringError gives it, the cause's lines (`causeLines`, today's text of the
 *  command), the follow-up warnings that ride on it, and, when only the commit failed, the files
 *  it left written in the repository, each read back from the disk. */
export function sessionFailure(
  failure: unknown,
  causeLines: (cause: unknown) => ReadonlyArray<string>,
  repoRoot: string,
): Effect.Effect<SessionCommandError> {
  return Effect.gen(function* () {
    const { cause, followUps } = splitFollowUps(failure);
    const lines = causeLines(cause);
    const leftWritten =
      cause instanceof ArtifactCommitFailedError
        ? yield* writtenRecords(cause.paths, repoRoot)
        : [];
    return sessionCommandError(exitCodeForAuthoringError(failure), {
      message: lines[0] ?? "",
      lines,
      followUps,
      written: leftWritten,
    });
  });
}

const sessionCommandText = (error: SessionCommandFields): string =>
  [...error.lines, ...error.followUps].join("\n");

export const sessionCommandTexts = {
  CommandFailedError: sessionCommandText,
  ConfigInvalidError: sessionCommandText,
  SessionFailedError: sessionCommandText,
  ProviderLimitError: sessionCommandText,
  SecurityRefusedError: sessionCommandText,
  ArtifactRefusedError: sessionCommandText,
  ProviderUnreachableError: sessionCommandText,
} as const;
