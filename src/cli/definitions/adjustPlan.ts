// `phax adjust-plan <plan> --landed <run>` as the runner reads it: open an interactive session that
// adjusts a plan.md after a landed run. It prompts, so `--json` refuses it with 64 before anything
// is read; without `--json` it writes today's lines before the session and exits the session's
// code. The plan is read through the FileSystem port, its path resolved against the invocation
// directory.
import { join, resolve } from "node:path";
import { Effect, Either, Layer } from "effect";
import * as Schema from "effect/Schema";
import { readAgentBinding } from "../../app/agentBinding.js";
import { landedRunRefusal, prepareAdjustPlanSession } from "../../app/adjustPlan.js";
import { loadConfig } from "../../app/loadConfig.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import type { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import type { Session } from "../../ports/session.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { makeProviderBackendLayer, makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { exposeMessage } from "./shared.js";
import {
  failedFor,
  HandedOver,
  handOver,
  handoverErrors,
  HandoverRefusedError,
  handoverExits,
  handoverTexts,
  resolveTarget,
} from "./sessions.js";

const VALID_EFFORT_VALUES = ["low", "medium", "high"] as const;
type ValidEffort = (typeof VALID_EFFORT_VALUES)[number];

function isValidEffort(value: string): value is ValidEffort {
  return (VALID_EFFORT_VALUES as readonly string[]).includes(value);
}

// cheaper per token than Opus 5, scores above Fable 5.1 from medium effort up
export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_EFFORT: ValidEffort = "high";

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface AdjustPlanDeps {
  readonly sessionLayer?: Layer.Layer<Session>;
  readonly backendLayer?: Layer.Layer<Backend>;
}

const ADJUST_PLAN_HELP =
  "Opens an interactive, pre-prompted session to help you adjust a plan.md after a landed run has introduced drift. The session establishes which of the plan's declared files, line references, and decisions are invalidated by the landed run's actual changes, asks clarifying questions where needed, proposes concrete edits and waits for your explicit approval, and only then edits and commits the plan — all interactively within the session. The command itself mutates nothing.\n\nInput: the path to the plan.md to adjust and --landed <run> (the run whose actual changes drive the adjustment). The landed run must have a global-file-reconciliation.json (i.e. it must have reached review); a run in awaiting_review is refused until it lands. Re-invocation without --new-session resumes the same session; --new-session starts a fresh one.\n\nSide effects: spawns a long-lived interactive provider session (network I/O); the session may, after developer approval, edit and commit the plan.md.";

const optional = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.optionalWith(schema, { exact: true });

export function makeAdjustPlanCommand(deps: AdjustPlanDeps = {}) {
  return defineCommand({
    name: "adjust-plan",
    summary: "Open an interactive session to adjust a plan after a landed run",
    help: ADJUST_PLAN_HELP,
    examples: ["phax adjust-plan docs/plans/2609101030-plan-prune-plan.md --landed my-feature"],
    input: {
      args: reject(
        Schema.Tuple(
          Schema.String.annotations({
            identifier: "plan",
            description: "Path to the plan.md to adjust",
          }),
        ),
      ),
      flags: reject(
        Schema.Struct({
          landed: Schema.String.annotations({
            identifier: "run",
            description: "The landed run whose actual changes drive the adjustment",
          }),
          newSession: optional(
            Schema.Boolean.annotations({
              description: "Start a fresh adjustment session instead of resuming",
            }),
          ),
          model: optional(
            Schema.String.annotations({
              identifier: "model",
              description: "Override the model (default: claude-opus-5-5)",
            }),
          ),
          effort: optional(
            Schema.String.annotations({
              identifier: "effort",
              description: "Override the effort (low | medium | high)",
            }),
          ),
        }),
      ),
    },
    output: reject(HandedOver),
    // The session is a person's terminal, and it has no flag that lifts that.
    prompts: () => true,
    run: ({ input, say }) =>
      Effect.gen(function* () {
        const planPathArg = input.args[0];
        const flags = input.flags;
        const loaded = loadConfig(process.cwd());
        if (Either.isLeft(loaded)) {
          return yield* Effect.fail(
            new HandoverRefusedError({ message: `Config error: ${loaded.left.message}` }),
          );
        }
        const config = loaded.right;
        if (flags.effort !== undefined && !isValidEffort(flags.effort)) {
          return yield* Effect.fail(
            new HandoverRefusedError({
              message: `Invalid --effort value "${flags.effort}". Allowed values: ${VALID_EFFORT_VALUES.join(" | ")}`,
            }),
          );
        }
        const effectiveModel = flags.model ?? DEFAULT_MODEL;
        const effectiveEffort: ValidEffort =
          flags.effort !== undefined && isValidEffort(flags.effort) ? flags.effort : DEFAULT_EFFORT;

        const target = yield* resolveTarget(flags.landed, config);
        const { info, qualifiedName, crossProject, stateRoot } = target;
        const notLanded = landedRunRefusal(qualifiedName, info.runState);
        if (notLanded !== null) return yield* Effect.fail(failedFor(target, notLanded));

        const fsLayer = makeRepoRootedFileSystemLayer(config);
        // Resolved against the invocation directory, not left to the file system's root.
        const planMarkdown = yield* Effect.gen(function* () {
          const fs = yield* FileSystem;
          return yield* fs.readText(resolve(process.cwd(), planPathArg));
        }).pipe(
          Effect.provide(fsLayer),
          Effect.mapError(() =>
            failedFor(
              target,
              `Cannot read plan.md at "${planPathArg}": file not found or not readable.`,
            ),
          ),
        );

        const binding = yield* Effect.promise(() =>
          readAgentBinding(join(info.runPath, info.finalPhaseId)),
        );
        if (Either.isLeft(binding)) {
          return yield* Effect.fail(
            failedFor(target, `No agent binding found for run "${qualifiedName}": ${binding.left}`),
          );
        }

        const prepared = yield* prepareAdjustPlanSession({
          planPath: planPathArg,
          planMarkdown,
          runPath: info.runPath,
          runKey: qualifiedName,
          provider: binding.right.provider,
          cwd: process.cwd(),
          extract: {
            model: config.extractPlanModel,
            effort: config.extractPlanEffort,
            stateRoot,
          },
          newSession: flags.newSession ?? false,
          nowIso: new Date().toISOString(),
          ...(flags.model !== undefined ? { modelOverride: flags.model } : {}),
          ...(flags.effort !== undefined ? { effortOverride: flags.effort } : {}),
          model: effectiveModel,
          effort: effectiveEffort,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              deps.backendLayer ?? makeProviderBackendLayer(DEFAULT_PROVIDER_CONFIG),
              fsLayer,
              NoopSystemTelemetryLayer,
            ),
          ),
          Effect.mapError((error) =>
            failedFor(target, `Unexpected error during adjust-plan preparation: ${error.message}`),
          ),
        );
        if (prepared.kind === "unsupported" || prepared.kind === "refused") {
          return yield* Effect.fail(failedFor(target, prepared.message));
        }

        const { invocation, mode } = prepared;
        if (crossProject) yield* say(`Target: ${qualifiedName}`);
        yield* say(
          mode === "new"
            ? `Starting plan adjustment session in ${invocation.cwd}`
            : `Resuming plan adjustment session in ${invocation.cwd}`,
        );
        const exit = yield* handOver(
          deps.sessionLayer,
          { ...invocation, env: {} },
          invocation.executable,
        );
        return {
          qualifiedName,
          crossProject,
          executable: invocation.executable,
          cwd: invocation.cwd,
          exit,
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: handoverExits,
    errors: handoverErrors,
    texts: handoverTexts,
    render: () => "",
    handsOver: (value) => value.exit,
  });
}

/** The command as the program declares it: real adapters. */
export const adjustPlanCommand = makeAdjustPlanCommand();
