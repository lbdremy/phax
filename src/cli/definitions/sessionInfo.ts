// `phax session-info <short-name>` as the runner reads it: the facts of a run's current phase,
// its agent binding, the stop of a run in awaiting_review and the commands that continue it, and
// today's text rendered from them alone. A run reference that does not resolve (an archived run
// included) is a declared error, exit 1, with the resolver's sentence.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Data, Effect, Result, type Layer } from "effect";
import * as Schema from "effect/Schema";
import { readAgentBinding } from "../../app/agentBinding.js";
import { planEnterPhase, type EnterPhaseResult } from "../../app/enterPhase.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadProviderConfig } from "../../app/loadRouting.js";
import { composePhaxState } from "../../app/phaxState.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { findCurrentPhase, type RunReviewInfo } from "../../app/resolveRunInfo.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { canResume } from "../../app/resume.js";
import { readStopInfo } from "../../app/stopInfo.js";
import { runKey } from "../../domain/runRef.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import type { FileSystem } from "../../ports/fs.js";
import {
  type PhaseAgentBinding,
  PhaseAgentBindingSchema,
} from "../../schemas/phaseAgentBinding.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import type { RunStatus } from "../../schemas/status.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { exposeMessage, MessageFields, ShortNameArg } from "./shared.js";

/** The run reference was refused: the resolver's sentence. */
class RunRefError extends Data.TaggedError("RunRefError")<{ readonly message: string }> {}

const Stop = Schema.Struct({
  phaseId: Schema.String,
  phaseTitle: Schema.String,
  /** The held phase's commit, a full sha; null at a declared stop. */
  phaseCommit: Schema.NullOr(Schema.String),
  position: Schema.Number,
  of: Schema.Number,
  worktree: Schema.String,
  seed: Schema.String,
  session: Schema.NullOr(
    Schema.Struct({
      provider: Schema.String,
      sessionId: Schema.String,
      origin: Schema.String,
      enterPhase: Schema.String,
    }),
  ),
});

const SessionInfoOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  runId: Schema.String,
  state: Schema.String,
  /** The stop's cause, for a run in awaiting_review. */
  stopCause: Schema.NullOr(Schema.String),
  phase: Schema.Struct({ id: Schema.String, title: Schema.String, state: Schema.String }),
  stop: Schema.NullOr(Stop),
  binding: Schema.NullOr(PhaseAgentBindingSchema),
  /** Why `phax enter-phase` cannot continue the session, when the binding says it cannot. */
  enterRefusal: Schema.NullOr(Schema.String),
  canEnter: Schema.Boolean,
  canResume: Schema.Boolean,
  lastError: Schema.NullOr(Schema.String),
  stoppedReason: Schema.NullOr(Schema.String),
  /** The raw metadata, only under `--debug`. */
  debug: Schema.NullOr(
    Schema.Struct({
      agentBinding: Schema.NullOr(PhaseAgentBindingSchema),
      modelResolution: Schema.NullOr(Schema.String),
    }),
  ),
});

const SessionInfoFlags = Schema.Struct({
  debug: Schema.optionalKey(
    Schema.Boolean.annotations({
      description: "Dump raw binding and model-resolution metadata",
    }),
  ),
});

interface Target {
  readonly namespace: string;
  readonly shortName: string;
  readonly stateRoot: string;
  readonly fsLayer: Layer.Layer<FileSystem>;
}

// What `phax enter-phase` would do for the phase, without running it: only whether it can, and
// why not. providers.json is read for the command's flags alone, so a file that cannot be read
// falls back to the defaults.
async function planEnter(
  target: Target,
  info: RunReviewInfo,
  phaseId: string,
): Promise<EnterPhaseResult> {
  const providerConfig: ProviderConfig = await Effect.runPromise(
    loadProviderConfig().pipe(
      Effect.provide(target.fsLayer),
      Effect.orElseSucceed(() => DEFAULT_PROVIDER_CONFIG),
    ),
  );
  const planned = await Effect.runPromise(
    Effect.result(
      planEnterPhase({
        namespace: target.namespace,
        shortName: target.shortName,
        info,
        phaseId,
        newSession: false,
        stateRoot: target.stateRoot,
        providerConfig,
      }).pipe(Effect.provide(target.fsLayer)),
    ),
  );
  return Result.isSuccess(planned)
    ? planned.right
    : { kind: "refused", message: planned.left.message };
}

type Output = Schema.Schema.Type<typeof SessionInfoOutput>;

/** Today's text, from the answer alone. */
function renderSessionInfo(value: Output): string {
  const lines: string[] = [];
  if (value.crossProject) lines.push(`Target: ${value.qualifiedName}`);
  lines.push(`Run:              ${value.qualifiedName} (${value.runId})`);
  const { stop, binding } = value;
  lines.push(
    `Status:           ${stop !== null ? `${value.state} (${value.stopCause ?? ""})` : value.state}`,
  );
  lines.push(`Phase:            ${value.phase.id} — ${value.phase.title} (${value.phase.state})`);
  if (stop !== null) {
    lines.push(
      `Stopped phase:    ${stop.phaseId} — ${stop.phaseTitle} (${
        stop.phaseCommit === null
          ? "interactive"
          : `headless, committed ${stop.phaseCommit.slice(0, 7)}`
      }, ${stop.position}/${stop.of})`,
    );
    lines.push(`Worktree:         ${stop.worktree}`);
    lines.push(`Seed:             ${stop.seed}`);
    lines.push(
      `Session:          ${
        stop.session === null
          ? "none"
          : `${stop.session.provider} ${stop.session.sessionId} (${stop.session.origin}; continue: ${stop.session.enterPhase})`
      }`,
    );
  } else if (binding !== null) {
    lines.push(`Provider:         ${binding.provider}`);
    lines.push(`Adapter:          ${binding.adapter}`);
    lines.push(`Model:            ${binding.model}`);
    lines.push(`Effort:           ${binding.effort}`);
    lines.push(`Session ID:       ${binding.sessionId ?? "(none)"}`);
    lines.push(`Session handle:   ${binding.sessionHandle ?? "(none)"}`);
    lines.push(`Worktree:         ${binding.worktreePath}`);
    lines.push(`Launched:         ${binding.launchedAt}`);
    lines.push(`Binding status:   ${binding.status}`);
    if (value.enterRefusal !== null) lines.push(`Resume:           ${value.enterRefusal}`);
  } else {
    lines.push(
      `Provider:         (no agent binding recorded — run \`phax session-info ${value.qualifiedName} --debug\` for raw metadata)`,
    );
  }
  lines.push(
    `Suggested enter:  ${
      value.canEnter
        ? `phax enter-phase ${value.qualifiedName} ${value.phase.id}`
        : "(interactive resume not available for this provider/session)"
    }`,
  );
  lines.push(
    `Suggested resume: ${
      value.canResume
        ? `phax resume ${value.qualifiedName}`
        : "(run is not resumable from this state)"
    }`,
  );
  if (value.lastError !== null) lines.push(`Last error:       ${value.lastError}`);
  if (value.stoppedReason !== null) lines.push(`Stopped reason:   ${value.stoppedReason}`);
  if (value.debug !== null) {
    lines.push(`\n--- Debug: agent-binding.json ---`);
    lines.push(
      value.debug.agentBinding === null
        ? "(not present)"
        : JSON.stringify(value.debug.agentBinding, null, 2),
    );
    lines.push(`\n--- Debug: model-resolution.json ---`);
    lines.push(value.debug.modelResolution ?? "(not present)");
  }
  return lines.join("\n");
}

export const sessionInfoCommand = defineCommand({
  name: "session-info",
  summary: "Print session diagnostics for a run (state, phase, worktree, session id)",
  help: "Prints diagnostic information about a run: its current state, active phase, worktree path, and agent session id. For a run in awaiting_review it prints the stop's cause, the stopped phase, its worktree, the seed and the current session with the phax enter-phase command that continues it. A held stop reads `headless, committed <short sha>`, and its session is the builder's. Read-only — no side effects.",
  examples: ["phax session-info usage-cli", "phax session-info usage-cli --debug"],
  input: {
    args: reject(Schema.Tuple(ShortNameArg)),
    flags: reject(SessionInfoFlags),
  },
  output: reject(SessionInfoOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const configResult = loadConfig(process.cwd());
      const config = Result.isSuccess(configResult) ? configResult.right : undefined;
      const stateRoot = effectiveStateRoot(config);

      const resolved = resolveRunRef(input.args[0], config, stateRoot);
      if (Result.isFailure(resolved)) {
        return yield* Effect.fail(new RunRefError({ message: resolved.left.message }));
      }
      const { namespace, shortName, info, crossProject } = resolved.right;
      const qualifiedName = runKey(namespace, shortName);
      // Every path read here is absolute: a run of another project needs no project config.
      const target: Target = {
        namespace,
        shortName,
        stateRoot,
        fsLayer:
          config !== undefined
            ? makeRepoRootedFileSystemLayer(config)
            : makeRootedNodeFileSystemLayer(process.cwd()),
      };

      const currentPhase = findCurrentPhase(info.phaseStatuses);
      const finalPhaseId = currentPhase?.phaseId ?? info.finalPhaseId;
      const phaseFolderPath = join(info.runPath, finalPhaseId);
      const phaseTitle =
        info.planPhases.find((phase) => phase.id === finalPhaseId)?.title ?? info.finalPhaseTitle;

      const stopResult = yield* Effect.result(
        readStopInfo(info).pipe(Effect.provide(target.fsLayer)),
      );
      const stop = Result.isSuccess(stopResult) ? stopResult.right : null;

      const bindingResult = yield* Effect.promise(() => readAgentBinding(phaseFolderPath));
      const binding: PhaseAgentBinding | null = Result.isSuccess(bindingResult)
        ? bindingResult.right
        : null;

      const entered = yield* Effect.promise(() => planEnter(target, info, finalPhaseId));
      const runState = composePhaxState(
        info.runState as RunStatus["state"],
        info.lastError,
        currentPhase,
      );

      let debug: Output["debug"] = null;
      if (input.flags.debug === true) {
        const modelResolution = yield* Effect.promise(() =>
          readFile(join(phaseFolderPath, "model-resolution.json"), "utf8").then(
            (raw) => raw,
            () => null,
          ),
        );
        debug = { agentBinding: binding, modelResolution };
      }

      return {
        qualifiedName,
        crossProject,
        runId: info.runId,
        state: info.runState,
        stopCause: stop?.cause ?? null,
        phase: {
          id: finalPhaseId,
          title: phaseTitle,
          state: currentPhase?.state ?? "review_open",
        },
        stop:
          stop === null
            ? null
            : {
                phaseId: stop.phaseId,
                phaseTitle: stop.phaseTitle,
                phaseCommit: stop.phaseCommit,
                position: stop.position,
                of: stop.of,
                worktree: stop.worktree,
                seed: stop.seed,
                session:
                  stop.session === null
                    ? null
                    : {
                        provider: stop.session.provider,
                        sessionId: stop.session.sessionId,
                        origin: stop.session.origin,
                        enterPhase: stop.enterPhase,
                      },
              },
        binding,
        enterRefusal: entered.kind === "refused" ? entered.message : null,
        canEnter: entered.kind === "command",
        canResume: canResume(runState),
        lastError: info.lastError ? info.lastError : null,
        stoppedReason: info.stoppedReason ? info.stoppedReason : null,
        debug,
      };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { RunRefError: 1 },
  errors: { RunRefError: MessageFields },
  texts: { RunRefError: (error) => error.message },
  render: renderSessionInfo,
});
