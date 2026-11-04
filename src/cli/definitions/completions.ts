// `phax completions <shell>` as the runner reads it: the completion script the `usage` CLI
// generates from phax.usage.kdl, with the shell it is for. Its text is the script itself, which
// shell setups source, so `--json` answers an object rather than the script as a document. A
// shell phax does not know, a missing spec or `usage` CLI, or a failed generation is a declared
// error with today's sentence and exit 1.
import { spawnSync } from "node:child_process";
import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { readUsageSpec } from "../commands/usageSpec.js";
import { exposeMessage, MessageFields } from "./shared.js";

const VALID_SHELLS: ReadonlyArray<string> = ["zsh", "bash", "fish", "nu", "powershell"];

/** The shell is none phax generates a script for. */
class InvalidShellError extends Data.TaggedError("InvalidShellError")<{
  readonly message: string;
}> {}

/** phax.usage.kdl was not found beside the package. */
class UsageSpecMissingError extends Data.TaggedError("UsageSpecMissingError")<{
  readonly message: string;
}> {}

/** The `usage` CLI is not on PATH. */
class UsageCliMissingError extends Data.TaggedError("UsageCliMissingError")<{
  readonly message: string;
}> {}

/** `usage generate completion` exited non-zero. */
class CompletionGenerationError extends Data.TaggedError("CompletionGenerationError")<{
  readonly message: string;
}> {}

const CompletionsOutput = Schema.Struct({ shell: Schema.String, script: Schema.String });

export const completionsCommand = defineCommand({
  name: "completions",
  summary:
    "Generate a shell completion script (zsh, bash, fish, nu, powershell). Requires the usage CLI.",
  input: {
    // A string, not a literal union: a shell that is none of the five is refused by `run` with
    // its own sentence and exit 1, as today.
    args: reject(
      Schema.Tuple(
        Schema.String.annotations({
          identifier: "shell",
          description: "Shell to generate completions for (zsh, bash, fish, nu, powershell)",
        }),
      ),
    ),
  },
  output: reject(CompletionsOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const shell = input.args[0];
      if (!VALID_SHELLS.includes(shell)) {
        return yield* Effect.fail(
          new InvalidShellError({
            message:
              `Error: invalid shell "${shell}". Valid choices: ${VALID_SHELLS.join(", ")}\n` +
              "Run `phax completions --help` for usage.",
          }),
        );
      }

      const spec = readUsageSpec();
      if (!spec.found) {
        return yield* Effect.fail(
          new UsageSpecMissingError({
            message:
              `Error: phax.usage.kdl not found at ${spec.path}\n` +
              "If running from source, ensure the spec exists at the repo root.",
          }),
        );
      }

      const result = spawnSync("usage", ["generate", "completion", shell, "phax", "-f", "-"], {
        encoding: "utf8",
        input: spec.content,
        env: { ...process.env },
      });

      if (result.error !== undefined) {
        const isNotFound =
          (result.error as NodeJS.ErrnoException).code === "ENOENT" ||
          result.error.message.includes("ENOENT");
        if (isNotFound) {
          return yield* Effect.fail(
            new UsageCliMissingError({
              message:
                "Error: The `usage` CLI is required to generate shell completions but was not found on PATH.\n" +
                "Install it with: brew install usage\n" +
                "See https://usage.jdx.dev/cli/ for other install options.",
            }),
          );
        }
        // Any other spawn error is a defect, as its throw is today.
        return yield* Effect.die(result.error);
      }

      if (result.status !== 0) {
        const errOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
        return yield* Effect.fail(
          new CompletionGenerationError({
            message: `Error: usage generate completion failed (exit ${result.status ?? "unknown"}):\n${errOutput}`,
          }),
        );
      }

      return { shell, script: result.stdout };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    InvalidShellError: 1,
    UsageSpecMissingError: 1,
    UsageCliMissingError: 1,
    CompletionGenerationError: 1,
  },
  errors: {
    InvalidShellError: MessageFields,
    UsageSpecMissingError: MessageFields,
    UsageCliMissingError: MessageFields,
    CompletionGenerationError: MessageFields,
  },
  texts: {
    InvalidShellError: (error) => error.message,
    UsageSpecMissingError: (error) => error.message,
    UsageCliMissingError: (error) => error.message,
    CompletionGenerationError: (error) => error.message,
  },
  // The runner writes one newline after the text: the script less its own keeps its bytes.
  render: (value) => (value.script.endsWith("\n") ? value.script.slice(0, -1) : value.script),
});
