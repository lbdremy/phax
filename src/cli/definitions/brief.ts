// `phax brief [path...]` as the runner reads it: the brief report the configured provider
// answered, with the files asked about, and today's rendering as its text. The record warning of
// a pull that could not record itself is a note. Every refusal and failure is a declared error
// with today's `✗ …` sentence and exit 1; an invalid config is exit 2.
import { Data, Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { loadConfig, locateWorkingTree } from "../../app/loadConfig.js";
import { pullBrief } from "../../app/pullBrief.js";
import { isEmptyBrief, renderNoBrief, renderWholeBrief } from "../../domain/brief/render.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { BriefReportFileSchema } from "../../schemas/briefReport.js";
import { withSchemaUrl } from "../../schemas/persisted.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { configErrorText } from "../commands/reportConfigError.js";
import { exposeMessage, MessageFields } from "./shared.js";

/** The invocation directory is not inside a git working tree. */
class NotInWorkingTreeError extends Data.TaggedError("NotInWorkingTreeError")<{
  readonly message: string;
}> {}

/** No brief provider is configured in any layer. */
class NoBriefProviderError extends Data.TaggedError("NoBriefProviderError")<{
  readonly message: string;
}> {}

/** The pull was refused before the provider ran (a path outside the tree, no path outside a
 *  phase, a brief request that is not a phase's). */
class BriefRefusedError extends Data.TaggedError("BriefRefusedError")<{
  readonly message: string;
}> {}

/** The provider failed, or its answer was refused; `recordWarning` is the note a pull that could
 *  not record itself adds. */
class BriefFailedError extends Data.TaggedError("BriefFailedError")<{
  readonly message: string;
  readonly recordWarning: string | null;
}> {}

const BriefOutput = Schema.Struct({
  files: Schema.NullOr(Schema.Array(Schema.String)),
  report: BriefReportFileSchema,
  recordWarning: Schema.NullOr(Schema.String),
});

const PathArg = Schema.String.annotate({
  identifier: "path",
  description: "Paths to brief, existing or not, relative to the current directory",
});

const warningLine = (warning: string): string => `[phax] Warning: ${warning}.`;

/** `phax brief` over an invocation directory, which the kept run function (`runBrief`) names. */
function makeBriefCommand(cwdOf: () => string) {
  return defineCommand({
    name: "brief",
    summary:
      "Ask the configured brief provider for the rules over the given paths and the findings there; with no path, inside a phase, the phase's brief",
    help: 'Asks the brief provider configured as "brief": { "command": …, "push": … } in phax.json, phax.local.json or ~/.phax/config.json which rules cover the given paths, what fails there and how to fix it. Paths resolve against the current directory, may not exist yet, and must lie inside the working tree; they are sent relative to its root, deduplicated, in the order given. Config is read from the repository\'s main checkout; the provider runs from the working tree\'s root, with no shell, one brief request on stdin, and a fixed 60-second limit.\n\nInside a phase worktree, the request is `$schema`, the phase facts copied from .phax-context/brief-request.json (phase, base, terminal, phases), then files: the paths, or null with no path, which asks for the phase\'s brief (its planned files). Outside a phase, the request is `$schema` and files only, and at least one path is required.\n\nThe provider prints a brief report on stdout: {"$schema": ".../brief-report/<release>.json", "rules": [{ rule, files, guide }], "findings": [{ id, rule, location, message, related, guide, due }]}. The report must carry its own `$schema` naming brief-report at a release this phax reads. A location is { file, lines }, with lines [start, end] or null; a guide is { summary, read } or null; due is this-phase, later or null. The provider\'s order is its rank, a key the format does not name is refused, and empty rules and findings lists mean nothing to report. phax checks nothing in the report beyond its shape: a brief informs and never blocks.\n\nPrints the whole report, every rule with its files and guide, then every finding with its location, due, rule, message, related locations and guide, in the provider\'s order, and exits 0 on any readable report. Exits 1 otherwise: the provider fails, exits non-zero, prints invalid JSON or outruns the limit; the report is refused at $schema or by shape; no brief provider is configured; .phax-context/brief-request.json is not a phase\'s brief request; no path outside a phase; a path outside the working tree; or no git working tree at all. An invalid config exits 2.\n\nSide effects: runs the brief provider. Inside a phase whose briefs are not yet collected, each pull is recorded as .phax-context/briefs/brief-NN.json, numbered from 01 in call order; outside a phase nothing is written.',
    examples: ["phax brief src/core/billing/invoice.ts src/core/billing/tax.ts", "phax brief"],
    input: { args: reject(Schema.Array(PathArg)) },
    output: reject(BriefOutput),
    run: ({ input }) =>
      Effect.gen(function* () {
        const cwd = cwdOf();
        // Config comes from the repository's main checkout, so a provider declared in its
        // gitignored phax.local.json serves a pull from a phase worktree too; the provider runs
        // from the cwd's own working tree.
        const tree = locateWorkingTree(cwd);
        if (tree === undefined) {
          return yield* Effect.fail(
            new NotInWorkingTreeError({
              message: `✗ phax brief: ${cwd} is not inside a git working tree`,
            }),
          );
        }
        const configResult = loadConfig(tree.mainRoot);
        if (Result.isFailure(configResult)) return yield* Effect.fail(configResult.failure);
        const { brief } = configResult.success;
        if (brief === undefined) {
          return yield* Effect.fail(
            new NoBriefProviderError({
              message:
                '✗ No brief provider is configured: add "brief": { "command": "…", "push": "findings" } to phax.json',
            }),
          );
        }
        const result = yield* pullBrief({
          command: brief.command,
          root: tree.root,
          cwd,
          paths: input.args,
        }).pipe(
          Effect.provide(Layer.mergeAll(makeRootedNodeFileSystemLayer(tree.root), NodeShellLayer)),
        );
        if (result.kind === "refused") {
          return yield* Effect.fail(
            new BriefRefusedError({ message: `✗ phax brief: ${result.message}` }),
          );
        }
        if (result.kind === "failed") {
          return yield* Effect.fail(
            new BriefFailedError({
              message: `✗ ${result.reason}`,
              recordWarning: result.recordWarning ?? null,
            }),
          );
        }
        return {
          files: result.files === null ? null : [...result.files],
          report: withSchemaUrl("brief-report", result.report),
          recordWarning: result.recordWarning ?? null,
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: {
      NotInWorkingTreeError: 1,
      ConfigValidationError: 2,
      NoBriefProviderError: 1,
      BriefRefusedError: 1,
      BriefFailedError: 1,
    },
    errors: {
      NotInWorkingTreeError: MessageFields,
      ConfigValidationError: Schema.Struct({
        message: Schema.String,
        path: Schema.optional(Schema.String),
      }),
      NoBriefProviderError: MessageFields,
      BriefRefusedError: MessageFields,
      BriefFailedError: Schema.Struct({
        message: Schema.String,
        recordWarning: Schema.NullOr(Schema.String),
      }),
    },
    texts: {
      NotInWorkingTreeError: (error) => error.message,
      ConfigValidationError: configErrorText,
      NoBriefProviderError: (error) => error.message,
      BriefRefusedError: (error) => error.message,
      BriefFailedError: (error) =>
        error.recordWarning === null
          ? error.message
          : `${warningLine(error.recordWarning)}\n${error.message}`,
    },
    render: (value) =>
      isEmptyBrief(value.report) ? renderNoBrief(value.files) : renderWholeBrief(value.report),
    notes: (value) => (value.recordWarning === null ? "" : warningLine(value.recordWarning)),
  });
}

export const briefCommand = makeBriefCommand(() => process.cwd());
