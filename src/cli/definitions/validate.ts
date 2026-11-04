// `phax validate` as the runner reads it: what the configuration (and, with `--plan`, a plan)
// comes to when it decodes, and today's lines as its text. A config or plan that does not decode
// is a declared error, exit 2, with today's sentence.
import { resolve } from "node:path";
import { Data, Effect, Either } from "effect";
import * as Schema from "effect/Schema";
import { invalidBoundMessages } from "../../app/assignmentBounds.js";
import { describeConfigSources, loadConfig } from "../../app/loadConfig.js";
import { loadPlan } from "../../app/loadPlan.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { exposeMessage } from "./shared.js";

/** The configuration did not decode: `Config validation failed: …`, with the file it names. */
class ConfigInvalidError extends Data.TaggedError("ConfigInvalidError")<{
  readonly message: string;
  readonly path?: string | undefined;
}> {}

/** The assignment bounds fail the routing catalog: one sentence per problem. */
class BoundsInvalidError extends Data.TaggedError("BoundsInvalidError")<{
  readonly message: string;
  readonly problems: ReadonlyArray<string>;
  readonly at?: string | undefined;
}> {}

/** The plan did not decode: `Plan validation failed: …`, with the path as typed. */
class PlanInvalidError extends Data.TaggedError("PlanInvalidError")<{
  readonly message: string;
  readonly path?: string | undefined;
}> {}

const Sources = Schema.Struct({
  project: Schema.String,
  local: Schema.NullOr(Schema.String),
  global: Schema.NullOr(Schema.String),
});

const ValidateOutput = Schema.Struct({
  namespace: Schema.String,
  sources: Schema.NullOr(Sources),
  protectedPaths: Schema.NullOr(Schema.Array(Schema.String)),
  assignments: Schema.NullOr(
    Schema.Struct({ total: Schema.Number, part: Schema.Number, globs: Schema.Number }),
  ),
  plan: Schema.NullOr(
    Schema.Struct({ path: Schema.String, shortName: Schema.String, phases: Schema.Number }),
  ),
});

const ValidateFlags = Schema.Struct({
  plan: Schema.optionalWith(
    Schema.String.annotations({
      identifier: "path",
      description: "Also validate a phax-plan.json at this path",
    }),
    { exact: true },
  ),
});

const OptionalPath = Schema.Struct({
  message: Schema.String,
  path: Schema.optional(Schema.String),
});

export const validateCommand = defineCommand({
  name: "validate",
  summary:
    "Validate phax.json and its user overlays without any side effects; pass --plan to also validate a phax-plan.json",
  help: "Checks that the configuration decodes and, with --plan, that the given phax-plan.json decodes. The config layers (phax.json, phax.local.json, ~/.phax/config.json) are merged and decoded; a user overlay that carries assignments is refused, because assignments is accepted only in phax.json.\n\nThe protected paths are listed: the globs of phax.json's \"protectedPaths\" in order, then the phax.json phax loaded, which is protected too, by its repo-relative path. A malformed glob exits 2 naming protectedPaths[N], and protectedPaths in phax.local.json or ~/.phax/config.json is refused, because it is accepted only in phax.json.\n\nThe assignment bounds of phax.json are checked against the routing catalog: each bound's model must be in the catalog, its min and max efforts must be efforts that model offers, and min may not come after max. A bad bound exits 2 naming assignments[N] and the field. The shape of a bound is checked at decode time by every command; the catalog check is this command's, lint's and the run preflight's.\n\nExits 0 when everything is valid, 2 otherwise.\n\nSide effects: none.",
  examples: ["phax validate", "phax validate --plan phax-plan.json"],
  input: { flags: reject(ValidateFlags) },
  output: reject(ValidateOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const cwd = process.cwd();
      const loaded = loadConfig(cwd);
      if (Either.isLeft(loaded)) {
        return yield* Effect.fail(
          new ConfigInvalidError({ message: loaded.left.message, path: loaded.left.path }),
        );
      }
      const config = loaded.right;
      const sources = describeConfigSources(cwd);

      // The bounds are checked before the config is reported valid, so a bad bound never follows
      // a success line.
      if (config.assignments !== undefined) {
        const checked = yield* Effect.either(
          invalidBoundMessages(config).pipe(Effect.provide(makeRepoRootedFileSystemLayer(config))),
        );
        const problems = Either.isRight(checked) ? checked.right : [checked.left.message];
        if (problems.length > 0) {
          const at = Either.isRight(checked) ? sources?.project : checked.left.path;
          return yield* Effect.fail(
            new BoundsInvalidError({ message: problems.join("\n"), problems, at }),
          );
        }
      }

      const parts = config.assignments?.filter((bound) => bound.kind === "part").length ?? 0;
      const assignments =
        config.assignments === undefined
          ? null
          : {
              total: config.assignments.length,
              part: parts,
              globs: config.assignments.length - parts,
            };

      let plan: { path: string; shortName: string; phases: number } | null = null;
      if (input.flags.plan !== undefined) {
        const typed = input.flags.plan;
        // Resolved explicitly against the invocation directory, rather than relying on
        // loadPlan's underlying read to do it implicitly.
        const resolvedPlanPath = resolve(cwd, typed);
        const planResult = loadPlan(resolvedPlanPath);
        if (Either.isLeft(planResult)) {
          // loadPlan's message embeds the resolved absolute path; swap back to what the user
          // typed so the error names a path they wrote.
          return yield* Effect.fail(
            new PlanInvalidError({
              message: planResult.left.message.split(resolvedPlanPath).join(typed),
              path: planResult.left.path ? typed : undefined,
            }),
          );
        }
        plan = {
          path: typed,
          shortName: planResult.right.run.shortName,
          phases: planResult.right.phases.length,
        };
      }

      return {
        namespace: config.namespace,
        sources:
          sources === undefined
            ? null
            : {
                project: sources.project,
                local: sources.localOverlay ?? null,
                global: sources.globalOverlay ?? null,
              },
        protectedPaths: config.protectedPaths?.map((entry) => entry.glob) ?? null,
        assignments,
        plan,
      };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { ConfigInvalidError: 2, BoundsInvalidError: 2, PlanInvalidError: 2 },
  errors: {
    ConfigInvalidError: OptionalPath,
    BoundsInvalidError: Schema.Struct({
      message: Schema.String,
      problems: Schema.Array(Schema.String),
      at: Schema.optional(Schema.String),
    }),
    PlanInvalidError: OptionalPath,
  },
  texts: {
    ConfigInvalidError: (error) =>
      `Config validation failed: ${error.message}${error.path ? `\n  at: ${error.path}` : ""}`,
    BoundsInvalidError: (error) =>
      [
        ...error.problems.map((problem) => `Config validation failed: ${problem}`),
        ...(error.at === undefined ? [] : [`  at: ${error.at}`]),
      ].join("\n"),
    PlanInvalidError: (error) =>
      `Plan validation failed: ${error.message}${error.path ? `\n  at: ${error.path}` : ""}`,
  },
  render: (value) => {
    const lines = [`✓ config is valid (project: ${value.namespace})`];
    if (value.sources !== null) {
      lines.push(`  project: ${value.sources.project}`);
      lines.push(`  local:   ${value.sources.local ?? "(none)"}`);
      lines.push(`  global:  ${value.sources.global ?? "(none)"}`);
    }
    if (value.protectedPaths !== null) {
      lines.push(`  protected paths: ${value.protectedPaths.join(", ")}`);
    }
    if (value.assignments !== null) {
      const { total, part, globs } = value.assignments;
      lines.push(`  ${total} assignment bounds (${part} part, ${globs} globs)`);
    }
    if (value.plan !== null) {
      lines.push(
        `✓ ${value.plan.path} is valid (run: ${value.plan.shortName}, ${value.plan.phases} phase(s))`,
      );
    }
    return lines.join("\n");
  },
});
