// `phax init` as the runner reads it: create phax.json, phax.schema.json and phax.user.schema.json in the invocation
// directory, through the init wizard on a terminal or with detected defaults with `--yes`. Under
// `--json` it answers the files it created as written-file records, or that the wizard was
// cancelled. Without `--yes` the wizard may ask a person something, whether or not stdin is a
// terminal (the predicate reads only the call), so `--json` is refused without `--yes`.
import { join } from "node:path";
import { Data, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { runInitWizard } from "../../app/initWizard.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import type { FileSystem } from "../../ports/fs.js";
import type { Git } from "../../ports/git.js";
import type { GitHub } from "../../ports/github.js";
import { PromptCancelled, type Prompt } from "../../ports/prompt.js";
import { defineCommand, reject, Written } from "../commandLibrary/contract/index.js";
import { exposeMessage, gitRoot, MessageFields, recordedPath, writtenRecords } from "./shared.js";

/** The layers a test swaps: the program instance gets the real ones. */
export interface InitLayers {
  readonly all: Layer.Layer<Prompt | FileSystem | Git | GitHub>;
}

/** The real adapters, built when the command runs (a test mocks the prompt module). */
const REAL_INIT_LAYERS: InitLayers = {
  all: Layer.suspend(() =>
    Layer.mergeAll(makeClackPromptLayer(), NodeFileSystemLayer, NodeGitLayer, NodeGitHubLayer),
  ),
};

/** phax.json already exists and was not reconfigured. */
class AlreadyInitializedError extends Data.TaggedError("AlreadyInitializedError")<{
  readonly message: string;
  readonly configPath: string;
}> {}

/** The wizard failed: its error's sentence. */
class InitFailedError extends Data.TaggedError("InitFailedError")<{ readonly message: string }> {}

const InitOutput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("created"),
    configPath: Schema.String,
    schemaPath: Schema.String,
    schemaReference: Schema.String,
    interactive: Schema.Boolean,
    written: Schema.Array(Written),
  }),
  Schema.Struct({ kind: Schema.Literal("aborted") }),
]);

function makeInitCommand(layers: InitLayers) {
  return defineCommand({
    name: "init",
    summary: "Create phax.json and phax.schema.json in the current directory",
    help: "Creates phax.json and phax.schema.json in the current directory. Use --force to overwrite an existing phax.json. Does not connect to any network or external service.",
    examples: ["phax init", "phax init --force"],
    input: {
      flags: reject(
        Schema.Struct({
          force: Schema.optionalKey(
            Schema.Boolean.annotate({
              description: "Overwrite and reconfigure an existing phax.json",
            }),
          ),
          yes: Schema.optionalKey(
            Schema.Boolean.annotate({
              description: "Accept detected defaults without prompting",
            }),
          ),
        }),
      ),
    },
    output: reject(InitOutput),
    // Without --yes the wizard may ask a person, a terminal or not.
    prompts: (input) => input.flags.yes !== true,
    unprompted: "pass --yes",
    run: ({ input }) =>
      Effect.gen(function* () {
        const cwd = process.cwd();
        const interactive = Boolean(process.stdin.isTTY) && input.flags.yes !== true;
        const outcome = yield* runInitWizard({
          cwd,
          ...(input.flags.force === true ? { force: true } : {}),
          interactive,
        }).pipe(
          Effect.provide(layers.all),
          Effect.map((result) => ({ cancelled: false as const, result })),
          Effect.catchIf(
            (error) => error instanceof PromptCancelled,
            () => Effect.succeed({ cancelled: true as const }),
          ),
          Effect.catch((error) => Effect.fail(new InitFailedError({ message: error.message }))),
        );
        if (outcome.cancelled) return { kind: "aborted" as const };
        const result = outcome.result;
        if (result.kind === "already_initialized") {
          return yield* Effect.fail(
            new AlreadyInitializedError({
              message: `PHAX is already initialized: ${result.configPath}\nUse --force to reconfigure.`,
              configPath: result.configPath,
            }),
          );
        }
        const root = gitRoot(cwd) ?? cwd;
        return {
          kind: "created" as const,
          configPath: result.configPath,
          schemaPath: result.schemaPath,
          schemaReference: result.schemaReference,
          interactive,
          written: yield* writtenRecords(
            [
              recordedPath(join(cwd, "phax.json"), root),
              recordedPath(join(cwd, "phax.schema.json"), root),
              recordedPath(result.userSchemaPath, root),
            ],
            root,
          ),
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: { AlreadyInitializedError: 1, InitFailedError: 1 },
    errors: {
      AlreadyInitializedError: Schema.Struct({ message: Schema.String, configPath: Schema.String }),
      InitFailedError: MessageFields,
    },
    texts: {
      AlreadyInitializedError: (error) => error.message,
      InitFailedError: (error) => error.message,
    },
    render: (value) => {
      if (value.kind === "aborted") return "phax init aborted — no changes written.";
      const lines = [
        `Created PHAX config: ${value.configPath}`,
        `Created JSON Schema: ${value.schemaPath}`,
        `Schema: local generated schema (${value.schemaReference})`,
      ];
      if (!value.interactive) {
        lines.push("Next: review phax.json, then run `phax validate` or `phax run`.");
      }
      return lines.join("\n");
    },
  });
}

export const initCommand = makeInitCommand(REAL_INIT_LAYERS);
