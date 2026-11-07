// The `records` group as the runner reads it: `init`, `sync`, `status`, `list` and `explain`
// (recordsExplain.ts). Each answers one value under `--json` and today's text without it, with
// today's sentences and codes. `init` asks a person three questions through its Prompt port, so it
// declares that it prompts and `--json` is refused before it starts; its answer is phax.json's
// written-file record. `sync` writes into a Git clone, not a file the caller reads by path, so it
// answers what it pulled or found with no written-file record. A group called alone is refused by
// the runner with the group's help.
import { Data, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { configureRecords } from "../../app/configureRecords.js";
import { locatePhaxConfig } from "../../app/loadConfig.js";
import { listRecords } from "../../app/recordsList.js";
import { computeRecordsPending, groupPendingByRun } from "../../app/recordsStatus.js";
import { recordsClonePath, type RecordsSyncResult } from "../../app/recordsSync.js";
import { ORIGIN, RECORDS_BRANCH_NAME } from "../../app/recordsBranch.js";
import { syncRecordsBranch } from "../../app/recordsBranchSync.js";
import { readRegistry } from "../../app/registry.js";
import { RECORDS_BRANCH_STATES, recordsBranchPhrase } from "../../domain/records/branchState.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { FileSystem } from "../../ports/fs.js";
import type { GitHub } from "../../ports/github.js";
import type { Prompt } from "../../ports/prompt.js";
import { AuthoringRecordOutcomeSchema } from "../../schemas/authoringRecord.js";
import { DecisionRecordOutcomeSchema } from "../../schemas/decisionRecord.js";
import { ReviewRecordKindSchema } from "../../schemas/reviewRecord.js";
import { RecordPhaseOutcomeSchema, RecordShapeSchema } from "../../schemas/runRecord.js";
import { RecordedSurfaceSchema } from "../../schemas/surface.js";
import {
  defineCommand,
  defineGroup,
  reject,
  Written,
  written,
} from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { recordsExplainCommand } from "./recordsExplain.js";
import { configured, exposeMessage, MessageFields, recordedPath } from "./shared.js";

const DISABLED_TEXT = "Records are not configured for this project. Run `phax records init` first.";

/** `phax.json` is nowhere between the invocation directory and the repository root. */
class ConfigNotFoundError extends Data.TaggedError("ConfigNotFoundError")<{
  readonly message: string;
}> {}

/** Records are configured, and `--force` was not given. */
class RecordsAlreadyConfiguredError extends Data.TaggedError("RecordsAlreadyConfiguredError")<{
  readonly message: string;
}> {}

/** The records clone is not this project's records history: phax leaves it as it is. */
class RecordsSyncRefusedError extends Data.TaggedError("RecordsSyncRefusedError")<{
  readonly message: string;
  readonly remedy: string;
  readonly reason: "origin-mismatch" | "local-only-history";
  readonly path: string;
  readonly remote: string;
}> {}

/** The records branch has split from the remote's: sync moves nothing without `--replay`. */
class RecordsBranchDivergedError extends Data.TaggedError("RecordsBranchDivergedError")<{
  readonly message: string;
  readonly reason: "diverged" | "unrelated";
  readonly localTip: string;
  readonly remoteTip: string;
  readonly localOnly: number;
  readonly remedy: "phax records sync --replay";
}> {}

/** A local-only record's key is already on the remote side: the replay writes nothing. */
class RecordsReplayCollisionError extends Data.TaggedError("RecordsReplayCollisionError")<{
  readonly message: string;
  readonly key: string;
  readonly localCommit: string;
  readonly remoteCommit: string;
}> {}

// ── What a sync did ─────────────────────────────────────────────────────────────

const SyncDone = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("nothing-to-bootstrap") }),
  Schema.Struct({ kind: Schema.Literal("cloned"), path: Schema.String, remote: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("fetched"), path: Schema.String, remote: Schema.String }),
);

const SyncRefused = Schema.Struct({
  kind: Schema.Literal("refused"),
  reason: Schema.Literal("origin-mismatch", "local-only-history"),
  path: Schema.String,
  remote: Schema.String,
  message: Schema.String,
  remedy: Schema.String,
});

type SyncValue = typeof SyncDone.Type | typeof SyncRefused.Type;

/** What a sync result says on the standard output; a refusal says nothing there. */
function syncLines(sync: SyncValue): string[] {
  switch (sync.kind) {
    case "nothing-to-bootstrap":
      return ["Records destination is in-repo; nothing to sync."];
    case "cloned":
      return [`Cloned records into ${sync.path}`];
    case "fetched":
      return [`Fetched records into ${sync.path}`];
    case "refused":
      return [];
  }
}

/** The sync result as the answer holds it, without what the app's type does not promise. */
function syncValue(sync: RecordsSyncResult): SyncValue {
  switch (sync.kind) {
    case "nothing-to-bootstrap":
      return { kind: "nothing-to-bootstrap" };
    case "cloned":
    case "fetched":
      return { kind: sync.kind, path: sync.path, remote: sync.remote };
    case "refused":
      return {
        kind: "refused",
        reason: sync.reason,
        path: sync.path,
        remote: sync.remote,
        message: sync.message,
        remedy: sync.remedy,
      };
  }
}

// ── init ────────────────────────────────────────────────────────────────────────

const RecordsInitOutput = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("configured"),
    configPath: Schema.String,
    sync: Schema.Union(SyncDone, SyncRefused),
    /** phax.json, which the command configured. */
    written: Schema.Array(Written),
  }),
  Schema.Struct({ kind: Schema.Literal("aborted") }),
);

/** `phax records init` over this Prompt layer (and the GitHub layer that tells the repository's
 *  visibility): the program uses the clack prompts and the real `gh`; a test scripts both. */
export function makeRecordsInitCommand(
  promptLayer: Layer.Layer<Prompt>,
  githubLayer: Layer.Layer<GitHub> = NodeGitHubLayer,
) {
  return defineCommand({
    name: "init",
    summary: "Configure records for this project (transcript, destination, auto-push)",
    input: {
      flags: reject(
        Schema.Struct({
          force: Schema.optionalWith(
            Schema.Boolean.annotations({
              description: "Reconfigure records even if already configured",
            }),
            { exact: true },
          ),
        }),
      ),
    },
    output: reject(RecordsInitOutput),
    // It asks three questions on every call, so `--json` never reaches it.
    prompts: () => true,
    // A sync the records clone refuses configures records all the same, and exits 0 as today:
    // the refusal is reported, and `phax records sync` is the command that exits 1 on it.
    run: ({ input }) =>
      Effect.gen(function* () {
        const config = yield* configured();
        const configPath = locatePhaxConfig(process.cwd());
        if (configPath === undefined) {
          return yield* Effect.fail(
            new ConfigNotFoundError({
              message: "Could not find phax.json. Run `phax init` first.",
            }),
          );
        }
        const fileSystem = makeRepoRootedFileSystemLayer(config);
        const outcome = yield* configureRecords({
          configPath,
          repoRoot: config.repoRoot,
          stateRoot: config.stateRoot,
          namespace: config.namespace,
          ...(input.flags.force !== undefined ? { force: input.flags.force } : {}),
        }).pipe(
          Effect.provide(Layer.mergeAll(promptLayer, fileSystem, NodeGitLayer, githubLayer)),
          // A cancelled prompt writes nothing and is not a failure.
          Effect.catchTag("PromptCancelled", () => Effect.succeed(undefined)),
        );
        if (outcome === undefined) return { kind: "aborted" } as const;
        if (outcome.kind === "already_configured") {
          return yield* Effect.fail(
            new RecordsAlreadyConfiguredError({
              message: `Records are already configured in ${outcome.configPath}\nUse --force to reconfigure.`,
            }),
          );
        }
        // phax.json, as the disk holds it now.
        const bytes = yield* Effect.gen(function* () {
          const fs = yield* FileSystem;
          return yield* fs.readBytes(outcome.configPath);
        }).pipe(Effect.provide(fileSystem));
        return {
          kind: "configured",
          configPath: outcome.configPath,
          sync: syncValue(outcome.sync),
          written: [yield* written(recordedPath(outcome.configPath, config.repoRoot), bytes)],
        } as const;
      }).pipe(Effect.mapError(exposeMessage)),
    exits: {
      ConfigValidationError: 2,
      ConfigNotFoundError: 2,
      RecordsAlreadyConfiguredError: 1,
      FsError: 1,
      GitError: 1,
      GitHubError: 1,
      PromptError: 1,
    },
    errors: {
      ConfigValidationError: MessageFields,
      ConfigNotFoundError: MessageFields,
      RecordsAlreadyConfiguredError: MessageFields,
      FsError: MessageFields,
      GitError: MessageFields,
      GitHubError: MessageFields,
      PromptError: MessageFields,
    },
    texts: {
      ConfigValidationError: (error) => error.message,
      ConfigNotFoundError: (error) => error.message,
      RecordsAlreadyConfiguredError: (error) => error.message,
      FsError: (error) => error.message,
      GitError: (error) => error.message,
      GitHubError: (error) => error.message,
      PromptError: (error) => error.message,
    },
    render: (value) =>
      value.kind === "aborted"
        ? "phax records init aborted — no changes written."
        : [`Configured records in ${value.configPath}`, ...syncLines(value.sync)].join("\n"),
    // What the clone refused and how to put it right, on the standard error.
    notes: (value) =>
      value.kind === "configured" && value.sync.kind === "refused"
        ? `${value.sync.message}\n${value.sync.remedy}`
        : "",
  });
}

const recordsInitCommand = makeRecordsInitCommand(makeClackPromptLayer());

// ── sync ────────────────────────────────────────────────────────────────────────

/** What sync did to the local records branch (spec records-branch-tip §6). */
const BranchOutcome = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("created"), tip: Schema.String, records: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("fast-forwarded"), from: Schema.String, to: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("replayed"),
    count: Schema.Number,
    previousTip: Schema.String,
    newTip: Schema.String,
    remoteTip: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("unchanged"),
    state: Schema.Literal(...RECORDS_BRANCH_STATES),
    /** Local-only records, as `phax records status` counts them. */
    pending: Schema.Number,
  }),
);

const RecordsSyncOutput = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("disabled") }),
  Schema.Struct({
    kind: Schema.Literal("cloned", "fetched"),
    /** Where the records branch lives: the local clone, or the source repository in-repo. */
    path: Schema.String,
    /** The configured records remote's URL, or `publish.remote` in-repo. */
    remote: Schema.String,
    /** The remote's name inside `path`: `origin` for a clone, `publish.remote` in-repo. */
    remoteName: Schema.String,
    branch: BranchOutcome,
  }),
);

type SyncedValue = Extract<typeof RecordsSyncOutput.Type, { readonly kind: "cloned" | "fetched" }>;

const short = (sha: string): string => sha.slice(0, 7);

/** The lines after `Cloned …` / `Fetched …` that say what happened to the records branch. */
function branchLines(value: SyncedValue): string[] {
  const { branch, remoteName } = value;
  switch (branch.kind) {
    case "created":
      return [
        `Records branch created at ${remoteName}'s tip ${short(branch.tip)} (${branch.records} records)`,
      ];
    case "fast-forwarded":
      return [`Records branch fast-forwarded ${short(branch.from)} → ${short(branch.to)}`];
    case "replayed":
      return [
        `Replayed ${branch.count} record(s) onto ${remoteName}'s tip ${short(branch.remoteTip)} → new tip ${short(branch.newTip)} (previous tip ${short(branch.previousTip)})`,
        `Push them with the next record, or \`git -C ${value.path} push ${remoteName} ${RECORDS_BRANCH_NAME}\``,
      ];
    case "unchanged":
      return branch.state === "ahead"
        ? [`Records branch is ahead of ${remoteName}: ${branch.pending} record(s) pending`]
        : [`Records branch is ${recordsBranchPhrase(branch.state, remoteName)}`];
  }
}

const recordsSyncCommand = defineCommand({
  name: "sync",
  summary: "Bring the local records clone in line with its configured remote",
  input: {
    flags: reject(
      Schema.Struct({
        replay: Schema.optionalWith(
          Schema.Boolean.annotations({
            description:
              "Replay local-only records onto the remote tip when the records branch has diverged",
          }),
          { exact: true },
        ),
      }),
    ),
  },
  output: reject(RecordsSyncOutput),
  run: ({ input, say }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      if (!config.records.enabled) return { kind: "disabled" } as const;
      const sync = yield* syncRecordsBranch({
        records: config.records,
        stateRoot: config.stateRoot,
        namespace: config.namespace,
        repoRoot: config.repoRoot,
        publishRemote: config.publish.remote,
        replay: input.flags.replay === true,
      }).pipe(Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeGitLayer)));
      const remoteName =
        config.records.destination.kind === "in-repo" ? config.publish.remote : ORIGIN;
      switch (sync.kind) {
        case "refused":
          return yield* Effect.fail(
            new RecordsSyncRefusedError({
              message: sync.message,
              remedy: sync.remedy,
              reason: sync.reason,
              path: sync.path,
              remote: sync.remote,
            }),
          );
        case "diverged":
          // The fetch did happen: say so before the refusal, as a successful sync does.
          yield* say(`Fetched records into ${sync.path}`);
          return yield* Effect.fail(
            new RecordsBranchDivergedError({
              message: `records branch is ${recordsBranchPhrase(sync.reason, remoteName)}: local tip ${short(sync.localTip)}, ${remoteName} tip ${short(sync.remoteTip)}, ${sync.localOnly} local-only record(s)\n  replay them onto ${remoteName}'s tip with \`${sync.remedy}\``,
              reason: sync.reason,
              localTip: sync.localTip,
              remoteTip: sync.remoteTip,
              localOnly: sync.localOnly,
              remedy: sync.remedy,
            }),
          );
        case "replay-collision":
          return yield* Effect.fail(
            new RecordsReplayCollisionError({
              message: `record ${sync.key} exists on both sides (local ${short(sync.localCommit)}, ${remoteName} ${short(sync.remoteCommit)}); nothing replayed`,
              key: sync.key,
              localCommit: sync.localCommit,
              remoteCommit: sync.remoteCommit,
            }),
          );
        case "cloned":
        case "fetched":
          return {
            kind: sync.kind,
            path: sync.path,
            remote: sync.remote,
            remoteName,
            branch: sync.branch,
          } as const;
      }
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    ConfigValidationError: 2,
    FsError: 1,
    GitError: 1,
    RecordsSyncRefusedError: 1,
    RecordsBranchDivergedError: 1,
    RecordsReplayCollisionError: 1,
  },
  errors: {
    ConfigValidationError: MessageFields,
    FsError: MessageFields,
    GitError: MessageFields,
    RecordsSyncRefusedError: Schema.Struct({
      message: Schema.String,
      remedy: Schema.String,
      reason: Schema.Literal("origin-mismatch", "local-only-history"),
      path: Schema.String,
      remote: Schema.String,
    }),
    RecordsBranchDivergedError: Schema.Struct({
      message: Schema.String,
      reason: Schema.Literal("diverged", "unrelated"),
      localTip: Schema.String,
      remoteTip: Schema.String,
      localOnly: Schema.Number,
      remedy: Schema.Literal("phax records sync --replay"),
    }),
    RecordsReplayCollisionError: Schema.Struct({
      message: Schema.String,
      key: Schema.String,
      localCommit: Schema.String,
      remoteCommit: Schema.String,
    }),
  },
  texts: {
    ConfigValidationError: (error) => error.message,
    FsError: (error) => error.message,
    GitError: (error) => error.message,
    // What it found, then how to put it right.
    RecordsSyncRefusedError: (error) => `${error.message}\n${error.remedy}`,
    RecordsBranchDivergedError: (error) => `✗ ${error.message}`,
    RecordsReplayCollisionError: (error) => `✗ ${error.message}`,
  },
  render: (value) =>
    value.kind === "disabled"
      ? DISABLED_TEXT
      : [
          value.kind === "cloned"
            ? `Cloned records into ${value.path}`
            : `Fetched records into ${value.path}`,
          ...branchLines(value),
        ].join("\n"),
});

// ── status ──────────────────────────────────────────────────────────────────────

const RecordsStatusOutput = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("disabled") }),
  Schema.Struct({
    kind: Schema.Literal("status"),
    destination: Schema.Union(
      Schema.Struct({ kind: Schema.Literal("in-repo") }),
      Schema.Struct({ kind: Schema.Literal("repo"), remote: Schema.String }),
    ),
    /** The repository the records branch lives in: the source repository, or the local clone. */
    localPath: Schema.String,
    /** The remote pending is measured against. */
    remote: Schema.String,
    /** How many record commits are pending. */
    pending: Schema.Number,
    /** The pending records by run, with their phase ids. */
    runs: Schema.Array(
      Schema.Struct({
        runId: Schema.String,
        shortName: Schema.String,
        namespace: Schema.String,
        phaseIds: Schema.Array(Schema.String),
      }),
    ),
  }),
);

const recordsStatusCommand = defineCommand({
  name: "status",
  summary: "Show pending (unpushed) records, by run and phase",
  input: {},
  output: reject(RecordsStatusOutput),
  run: () =>
    Effect.gen(function* () {
      const config = yield* configured();
      if (!config.records.enabled) return { kind: "disabled" } as const;
      const clonePath =
        config.records.destination.kind === "repo"
          ? recordsClonePath(config.stateRoot, config.namespace)
          : undefined;
      const { pending, runs } = yield* Effect.gen(function* () {
        const computed = yield* computeRecordsPending({
          records: config.records,
          repoRoot: config.repoRoot,
          publishRemote: config.publish.remote,
          ...(clonePath !== undefined ? { recordsClonePath: clonePath } : {}),
        });
        const registry = yield* readRegistry(config.stateRoot);
        return { pending: computed, runs: groupPendingByRun(computed, registry) };
      }).pipe(Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeGitLayer)));
      return {
        kind: "status",
        destination:
          pending.destination.kind === "in-repo"
            ? ({ kind: "in-repo" } as const)
            : ({ kind: "repo", remote: pending.destination.remote } as const),
        localPath: pending.localPath,
        remote: pending.remote,
        pending: pending.pending.length,
        runs: runs.map((run) => ({
          runId: run.runId,
          shortName: run.shortName,
          namespace: run.namespace,
          phaseIds: run.phaseIds,
        })),
      } as const;
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    ConfigValidationError: 2,
    FsError: 1,
    GitError: 1,
    RegistryCorruptionError: 1,
  },
  errors: {
    ConfigValidationError: MessageFields,
    FsError: MessageFields,
    GitError: MessageFields,
    RegistryCorruptionError: MessageFields,
  },
  texts: {
    ConfigValidationError: (error) => error.message,
    FsError: (error) => error.message,
    GitError: (error) => error.message,
    RegistryCorruptionError: (error) => error.message,
  },
  render: (value) => {
    if (value.kind === "disabled") return DISABLED_TEXT;
    const destinationLabel =
      value.destination.kind === "in-repo"
        ? `in-repo (${value.localPath}, remote "${value.remote}")`
        : `repo "${value.destination.remote}" (local clone: ${value.localPath})`;
    const lines = [`Records destination: ${destinationLabel}`];
    if (value.runs.length === 0) {
      lines.push("All records are pushed. Nothing pending.");
      return lines.join("\n");
    }
    lines.push(`Pending: ${value.pending} record(s) across ${value.runs.length} run(s)`);
    for (const run of value.runs) lines.push(`  ${run.shortName} (${run.phaseIds.join(", ")})`);
    return lines.join("\n");
  },
});

// ── list ────────────────────────────────────────────────────────────────────────

const RecordListEntry = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("phase"),
    runId: Schema.String,
    phaseId: Schema.String,
    shape: RecordShapeSchema,
    outcome: RecordPhaseOutcomeSchema,
    recordCommitSha: Schema.String,
    verifiedSurfaces: Schema.Array(RecordedSurfaceSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("authoring"),
    authoringId: Schema.String,
    shape: RecordShapeSchema,
    outcome: AuthoringRecordOutcomeSchema,
    recordCommitSha: Schema.String,
    /** The artifact the session authored. */
    artifact: Schema.String,
    artifactKind: Schema.Literal("spec", "plan"),
  }),
  Schema.Struct({
    kind: Schema.Literal("decision"),
    decisionId: Schema.String,
    shape: RecordShapeSchema,
    outcome: DecisionRecordOutcomeSchema,
    recordCommitSha: Schema.String,
    /** The artifact the session decided. */
    artifact: Schema.String,
    artifactKind: Schema.Literal("spec", "plan"),
  }),
  Schema.Struct({
    kind: Schema.Literal("review"),
    runId: Schema.String,
    review: ReviewRecordKindSchema,
    recordCommitSha: Schema.String,
    /** The review's own file the entry carries. */
    file: Schema.String,
  }),
);

const RecordsListOutput = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("disabled") }),
  Schema.Struct({ kind: Schema.Literal("listed"), records: Schema.Array(RecordListEntry) }),
);

type ListEntry = typeof RecordListEntry.Type;

/** A row of the listing. An authoring or decision record lists under its key (`authoring <id>`,
 *  `decision <id>`), with the artifact path where a phase record shows its verified surfaces. A
 *  review entry has no shape or outcome: `-` holds those two columns, and its file sits where the
 *  detail goes. */
function listRow(entry: ListEntry): string {
  const [first, second, shape, outcome, detail] =
    entry.kind === "phase"
      ? [
          entry.runId,
          entry.phaseId,
          entry.shape,
          entry.outcome,
          entry.verifiedSurfaces.length > 0 ? entry.verifiedSurfaces.join(",") : "-",
        ]
      : entry.kind === "authoring"
        ? ["authoring", entry.authoringId, entry.shape, entry.outcome, entry.artifact]
        : entry.kind === "decision"
          ? ["decision", entry.decisionId, entry.shape, entry.outcome, entry.artifact]
          : [entry.runId, entry.review, "-", "-", entry.file];
  return `${first}  ${second}  ${shape}  ${outcome}  ${entry.recordCommitSha.slice(0, 8)}  ${detail}`;
}

const recordsListCommand = defineCommand({
  name: "list",
  summary:
    "List records present: phase records by run, phase, and verified surfaces; review entries by run and review; authoring and decision records by id and artifact",
  input: {
    flags: reject(
      Schema.Struct({
        run: Schema.optionalWith(
          Schema.String.annotations({
            identifier: "id",
            description: "Only show records for this run id",
          }),
          { exact: true },
        ),
      }),
    ),
  },
  output: reject(RecordsListOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const clonePath =
        config.records.destination.kind === "repo"
          ? recordsClonePath(config.stateRoot, config.namespace)
          : undefined;
      const outcome = yield* listRecords({
        records: config.records,
        repoRoot: config.repoRoot,
        publishRemote: config.publish.remote,
        ...(clonePath !== undefined ? { recordsClonePath: clonePath } : {}),
        ...(input.flags.run !== undefined ? { runId: input.flags.run } : {}),
      }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer)));
      return outcome.kind === "disabled"
        ? ({ kind: "disabled" } as const)
        : ({ kind: "listed", records: outcome.records } as const);
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { ConfigValidationError: 2, GitError: 1, ShellError: 1 },
  errors: {
    ConfigValidationError: MessageFields,
    GitError: MessageFields,
    ShellError: MessageFields,
  },
  texts: {
    ConfigValidationError: (error) => error.message,
    GitError: (error) => error.message,
    ShellError: (error) => error.message,
  },
  render: (value) => {
    if (value.kind === "disabled") return DISABLED_TEXT;
    if (value.records.length === 0) return "No records found.";
    return value.records.map(listRow).join("\n");
  },
});

export const recordsGroup = defineGroup({
  name: "records",
  summary: "Manage phax run records",
  commands: [
    recordsInitCommand,
    recordsSyncCommand,
    recordsStatusCommand,
    recordsListCommand,
    recordsExplainCommand,
  ],
});
