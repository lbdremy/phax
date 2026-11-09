// `phax architecture [path...]` as the runner reads it: the architecture report the configured
// provider answered, with the owner's assignment bounds, and today's rendering as its text. With
// no provider configured the answer is `{ kind: "no-provider", bounds }`, the verdict code 1: the
// line telling the agent to read the code, then the bounds with their parts unresolved. A
// provider that fails or is refused is a declared error with today's `✗ …` sentence and exit 1.
import { Data, Effect, Result } from "effect";
import * as Schema from "effect/Schema";
import { pullArchitecture } from "../../app/architectureProvider.js";
import { loadConfig, locateWorkingTree } from "../../app/loadConfig.js";
import {
  renderArchitectureReport,
  renderAssignmentBounds,
} from "../../domain/architecture/render.js";
import { NO_ARCHITECTURE_PROVIDER } from "../../domain/architecture/request.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { ArchitectureReportFileSchema } from "../../schemas/architecture.js";
import { AssignmentsSchema } from "../../schemas/assignments.js";
import { withSchemaUrl } from "../../schemas/persisted.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { configErrorText } from "../commands/reportConfigError.js";
import { exposeMessage, MessageFields } from "./shared.js";

/** The invocation directory is not inside a git working tree. */
class NotInWorkingTreeError extends Data.TaggedError("NotInWorkingTreeError")<{
  readonly message: string;
}> {}

/** The pull was refused before the provider ran (a path outside the tree). */
class ArchitectureRefusedError extends Data.TaggedError("ArchitectureRefusedError")<{
  readonly message: string;
}> {}

/** The provider failed, or its answer was refused. */
class ArchitectureFailedError extends Data.TaggedError("ArchitectureFailedError")<{
  readonly message: string;
}> {}

const Bounds = Schema.NullOr(AssignmentsSchema);

const ArchitectureOutput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("report"),
    report: ArchitectureReportFileSchema,
    bounds: Bounds,
    /** Whether the report answers for paths: a part bound it does not carry says so. */
    scoped: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("no-provider"), bounds: Bounds }),
]);

const PathArg = Schema.String.annotate({
  identifier: "path",
  description: "Paths to ask about, existing or not, relative to the current directory",
});

/** `phax architecture` over an invocation directory, which the kept run function
 *  (`runArchitecture`) names. */
function makeArchitectureCommand(cwdOf: () => string) {
  return defineCommand({
    name: "architecture",
    summary:
      "Ask the configured architecture provider for the repository's architecture; with paths, for the parts that hold them",
    help: 'Asks the architecture provider configured as "architecture": { "command": … } in phax.json, phax.local.json or ~/.phax/config.json for the repository\'s architecture, and prints its report: the Markdown body, then the report\'s parts rendered to Markdown, then the owner\'s assignment bounds (phax.json "assignments") as a "## Bounds" list, each as assignments[N] with its model and effort range; a part bound shows its part\'s name and globs, and a path-scoped report that does not carry the part says to run the command with no path for its globs. With no path, it asks about the whole repository; with paths, about the parts that hold them. Paths resolve against the current directory, may not exist yet, and must lie inside the working tree. Config is read from the repository\'s main checkout; the provider runs from the working tree\'s root, with no shell, one architecture request on stdin, and a fixed 60-second limit.\n\nThe request is {"$schema": ".../architecture-request/<release>.json", "files"}: files is null with no path (the whole repository), otherwise the paths relative to the working tree\'s root, deduplicated, in the order given, never checked for existence.\n\nThe provider prints an architecture report on stdout: {"$schema": ".../architecture-report/<release>.json", "body", "parts"}. The report must carry its own `$schema` naming architecture-report at a release this phax reads, and body is non-empty Markdown for the agent to read. parts is a list, possibly empty, of {"id", "name", "description", "globs"}: id is a kebab-case slug unique within the report, name and description are non-empty text, and globs is a non-empty list of working-tree-root-relative POSIX globs matched case-sensitively, where only ** (a whole segment), * and ? are special; a leading slash, a backslash, braces, an empty, . or .. segment and ** inside a segment are refused. A key the format does not name is refused, and no model or effort appears anywhere. phax prints the body as is, never parsing it, then a "## Parts" section with each part\'s name, id, description and globs in the report\'s order. A provider that declines exits non-zero.\n\nExits 0 on a readable report. Exits 1 with one line on stdout, telling the agent to read the architecture from the code and its documentation, when no architecture provider is configured; when bounds are declared, that line is followed by the bounds, part bounds marked unresolved, and the exit is still 1. Exits 1 with one line on stderr when the provider fails, exits non-zero, prints invalid JSON or outruns the limit; the report is refused at $schema or by shape (a missing parts, a repeated part id, an unknown key, an empty or refused glob); a path lies outside the working tree; or there is no git working tree at all. An invalid config exits 2.\n\nSide effects: runs the architecture provider. Writes no file, inside a phase worktree or outside one.',
    examples: ["phax architecture", "phax architecture src/core/billing/totals.ts"],
    input: { args: reject(Schema.Array(PathArg)) },
    output: reject(ArchitectureOutput),
    run: ({ input }) =>
      Effect.gen(function* () {
        const cwd = cwdOf();
        // Config comes from the repository's main checkout, so a provider declared in its
        // gitignored phax.local.json serves a call from a phase worktree too; the provider runs
        // from the cwd's own working tree. Nothing is written.
        const tree = locateWorkingTree(cwd);
        if (tree === undefined) {
          return yield* Effect.fail(
            new NotInWorkingTreeError({
              message: `✗ phax architecture: ${cwd} is not inside a git working tree`,
            }),
          );
        }
        const configResult = loadConfig(tree.mainRoot);
        if (Result.isFailure(configResult)) return yield* Effect.fail(configResult.left);
        const { architecture, assignments } = configResult.right;
        const bounds = assignments === undefined ? null : assignments;
        if (architecture === undefined) {
          return { kind: "no-provider" as const, bounds };
        }
        const result = yield* pullArchitecture({
          command: architecture.command,
          root: tree.root,
          cwd,
          paths: input.args,
        }).pipe(Effect.provide(NodeShellLayer));
        if (result.kind === "refused") {
          return yield* Effect.fail(
            new ArchitectureRefusedError({ message: `✗ phax architecture: ${result.message}` }),
          );
        }
        if (result.kind === "failed") {
          return yield* Effect.fail(new ArchitectureFailedError({ message: `✗ ${result.reason}` }));
        }
        return {
          kind: "report" as const,
          report: withSchemaUrl("architecture-report", result.report),
          bounds,
          scoped: input.args.length > 0,
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: {
      NotInWorkingTreeError: 1,
      ConfigValidationError: 2,
      ArchitectureRefusedError: 1,
      ArchitectureFailedError: 1,
    },
    errors: {
      NotInWorkingTreeError: MessageFields,
      ConfigValidationError: Schema.Struct({
        message: Schema.String,
        path: Schema.optional(Schema.String),
      }),
      ArchitectureRefusedError: MessageFields,
      ArchitectureFailedError: MessageFields,
    },
    texts: {
      NotInWorkingTreeError: (error) => error.message,
      ConfigValidationError: configErrorText,
      ArchitectureRefusedError: (error) => error.message,
      ArchitectureFailedError: (error) => error.message,
    },
    verdicts: { 1: (value) => value.kind === "no-provider" },
    render: (value) => architectureSections(value).join("\n"),
  });
}

/** The sections of the text, each printed as one block: the report (or the no-provider line),
 *  then, when bounds are declared, a blank line and the bounds. */
function architectureSections(
  value: Schema.Schema.Type<typeof ArchitectureOutput>,
): ReadonlyArray<string> {
  if (value.kind === "no-provider") {
    return value.bounds === null
      ? [NO_ARCHITECTURE_PROVIDER]
      : [
          NO_ARCHITECTURE_PROVIDER,
          "",
          renderAssignmentBounds(value.bounds, { kind: "no-provider" }),
        ];
  }
  const report = renderArchitectureReport(value.report);
  return value.bounds === null
    ? [report]
    : [
        report,
        "",
        renderAssignmentBounds(value.bounds, {
          kind: "report",
          report: value.report,
          scoped: value.scoped,
        }),
      ];
}

export const architectureCommand = makeArchitectureCommand(() => process.cwd());
