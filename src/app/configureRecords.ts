import { Effect, Either, Schema } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { GitHub, type GitHubError } from "../ports/github.js";
import { Prompt, type PromptCancelled, type PromptError } from "../ports/prompt.js";
import type { RepoVisibility } from "../domain/records/destination.js";
import {
  RecordsRemoteSchema,
  resolveRecordsConfig,
  type RecordsConfig,
  type RecordsDestination,
} from "../schemas/recordsConfig.js";
import { reconcileRecordsSync, type RecordsSyncResult } from "./recordsSync.js";

/**
 * Ask the three records questions in the order spec §5.6 requires: whether to
 * include the transcript, then — only where §5.4 forces a dedicated
 * destination (transcripts on and the source repo detected public) — the
 * records remote, then whether to push automatically. There is no select
 * between an in-repo and a dedicated destination: the destination is derived
 * from `visibility`, never offered as a choice.
 */
export function askRecordsAnswers(input: {
  readonly visibility: RepoVisibility;
}): Effect.Effect<RecordsConfig, PromptError | PromptCancelled, Prompt> {
  return Effect.gen(function* () {
    const prompt = yield* Prompt;

    const transcript = yield* prompt.confirm({
      message: "Include the agent transcript in records?",
      initialValue: true,
    });

    const requiresDedicatedDestination = transcript && input.visibility === "public";

    let destination: RecordsDestination;
    if (requiresDedicatedDestination) {
      const remote = yield* prompt.text({
        message:
          "Records remote (this repo is public, so records with transcripts cannot be stored in it)",
        required: true,
        validate: (value) => {
          const decoded = Schema.decodeUnknownEither(RecordsRemoteSchema)(value);
          return Either.isLeft(decoded)
            ? "Must be an https://, ssh://, or git@host:path URL"
            : undefined;
        },
      });
      destination = { kind: "repo", remote };
    } else {
      destination = { kind: "in-repo" };
      if (transcript) {
        yield* prompt.note(
          "Records will be stored in this repository. If it later becomes public, every " +
            "transcript already recorded in its history is published with it.",
        );
      }
    }

    const autoPush = yield* prompt.confirm({
      message: "Push records automatically when the run is published?",
      initialValue: true,
    });

    return { transcript, destination, autoPush };
  });
}

export interface ConfigureRecordsInput {
  /** Absolute path to the project's `phax.json`, already known to exist. */
  readonly configPath: string;
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly namespace: string;
  readonly force?: boolean;
}

export type ConfigureRecordsResult =
  | { readonly kind: "already_configured"; readonly configPath: string }
  | {
      readonly kind: "configured";
      readonly configPath: string;
      readonly records: RecordsConfig;
      readonly sync: RecordsSyncResult;
    };

/**
 * The single use case behind both `phax init`'s records block and
 * `phax records init`: detect the source repo's visibility, ask the three
 * questions, patch the `records` block into an existing `phax.json`, and
 * reconcile the local clone for a dedicated destination (a no-op for
 * `in-repo`). Refuses on an already-configured project unless `force`,
 * mirroring `phax init`'s `already_initialized` behavior — asking nothing and
 * writing nothing in that case.
 */
export function configureRecords(
  input: ConfigureRecordsInput,
): Effect.Effect<
  ConfigureRecordsResult,
  FsError | GitError | GitHubError | PromptError | PromptCancelled,
  FileSystem | Git | GitHub | Prompt
> {
  return Effect.gen(function* () {
    const { configPath, repoRoot, stateRoot, namespace, force = false } = input;
    const fs = yield* FileSystem;

    const text = yield* fs.readText(configPath);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      raw = {};
    }

    if (raw["records"] !== undefined && !force) {
      return { kind: "already_configured", configPath } as const;
    }

    const github = yield* GitHub;
    const visibility = yield* github.visibility(repoRoot);

    const records = yield* askRecordsAnswers({ visibility });

    const updated = { ...raw, records };
    yield* fs.writeAtomic(configPath, JSON.stringify(updated, null, 2) + "\n");

    const sync = yield* reconcileRecordsSync({
      records: resolveRecordsConfig(records),
      stateRoot,
      namespace,
    });

    return { kind: "configured", configPath, records, sync } as const;
  });
}
