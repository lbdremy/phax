// `phax report [short-name]` as the runner reads it: the URL of the GitHub issue opened from local
// telemetry, and `Issue created: <url>` as its text. The `gh` calls print nothing before the
// answer. An invalid config or a failed report is a declared error with today's sentence, exit 1.
import { Data, Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { loadConfig } from "../../app/loadConfig.js";
import { PHAX_HOME_DIR } from "../../app/loadTelemetryConfig.js";
import { report } from "../../app/report.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitHubLayer } from "../../infra/github.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { readPackageVersion } from "../commands/usage.js";
import { exposeMessage, MessageFields, ShortNameArg } from "./shared.js";

/** The configuration did not decode, so the run's state root is unknown. */
class ReportConfigError extends Data.TaggedError("ReportConfigError")<{
  readonly message: string;
}> {}

/** The report could not be built or the issue not created. */
class ReportFailedError extends Data.TaggedError("ReportFailedError")<{
  readonly message: string;
}> {}

const ReportOutput = Schema.Struct({ issueUrl: Schema.String });

const ReportFlags = Schema.Struct({
  noGist: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: "Inline the full log in the issue body instead of creating a secret gist",
    }),
  ),
});

export const reportCommand = defineCommand({
  name: "report",
  summary: "Open a GitHub issue from local telemetry (run semantic.jsonl or latest daily journal)",
  help: "Creates a GitHub issue from local run telemetry. By default, uploads the full log as a secret GitHub gist and links it in the issue body. Use --no-gist to inline the log directly.\n\nSide effects: GitHub API calls — creates a GitHub issue and, unless --no-gist is set, a secret gist.",
  examples: ["phax report", "phax report usage-cli", "phax report usage-cli --no-gist"],
  input: {
    args: reject(Schema.Tuple([Schema.optionalKey(ShortNameArg)])),
    flags: reject(ReportFlags),
  },
  output: reject(ReportOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const shortName = input.args[0];
      let stateRoot: string | undefined;
      if (shortName !== undefined) {
        const configResult = loadConfig(process.cwd());
        if (Result.isFailure(configResult)) {
          return yield* Effect.fail(
            new ReportConfigError({ message: configResult.failure.message }),
          );
        }
        stateRoot = configResult.success.stateRoot;
      }
      const outcome = yield* Effect.result(
        report({
          ...(shortName !== undefined ? { shortName } : {}),
          ...(stateRoot !== undefined ? { stateRoot } : {}),
          phaxHomeDir: PHAX_HOME_DIR,
          noGist: input.flags.noGist ?? false,
          phaxVersion: readPackageVersion(),
          repo: process.cwd(),
        }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystemLayer, makeNodeGitHubLayer()))),
      );
      if (Result.isFailure(outcome)) {
        return yield* Effect.fail(new ReportFailedError({ message: outcome.failure.message }));
      }
      return { issueUrl: outcome.success };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { ReportConfigError: 1, ReportFailedError: 1 },
  errors: { ReportConfigError: MessageFields, ReportFailedError: MessageFields },
  texts: {
    ReportConfigError: (error) => `Config error: ${error.message}`,
    ReportFailedError: (error) => `phax report failed: ${error.message}`,
  },
  render: (value) => `Issue created: ${value.issueUrl}`,
});
