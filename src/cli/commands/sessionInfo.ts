import { Effect, Either, type Layer } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadProviderConfig } from "../../app/loadRouting.js";
import { findCurrentPhase } from "../../app/resolveRunInfo.js";
import type { RunReviewInfo } from "../../app/resolveRunInfo.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { readAgentBinding } from "../../app/agentBinding.js";
import { planEnterPhase, type EnterPhaseResult } from "../../app/enterPhase.js";
import { readStopInfo } from "../../app/stopInfo.js";
import { canResume } from "../../app/resume.js";
import { composePhaxState } from "../../app/phaxState.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import type { FileSystem } from "../../ports/fs.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import type { RunStatus } from "../../schemas/status.js";
import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";
import { makeRepoRootedFileSystemLayer } from "./runLayers.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";

interface SessionInfoTarget {
  readonly namespace: string;
  readonly shortName: string;
  readonly stateRoot: string;
  readonly fsLayer: Layer.Layer<FileSystem>;
}

// What `phax enter-phase` would do for the phase, without running it: only
// whether it can, and why not. providers.json is read for the command's
// flags alone, so a file that cannot be read falls back to the defaults.
async function planEnter(
  target: SessionInfoTarget,
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
    Effect.either(
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
  return Either.isRight(planned)
    ? planned.right
    : { kind: "refused", message: planned.left.message };
}

async function printSessionInfo(
  target: SessionInfoTarget,
  info: RunReviewInfo,
  qualifiedName: string,
  out: OutputPort,
  opts: { debug?: boolean },
): Promise<number> {
  const currentPhase = findCurrentPhase(info.phaseStatuses);

  out.log(`Run:              ${qualifiedName} (${info.runId})`);

  const finalPhaseId = currentPhase?.phaseId ?? info.finalPhaseId;
  const phaseFolderPath = join(info.runPath, finalPhaseId);
  const phasePlan = info.planPhases.find((p) => p.id === finalPhaseId);
  const phaseName = phasePlan?.title ?? info.finalPhaseTitle;
  const phaseState = currentPhase?.state ?? "review_open";

  const stopResult = await Effect.runPromise(
    Effect.either(readStopInfo(info).pipe(Effect.provide(target.fsLayer))),
  );
  const stop = Either.isRight(stopResult) ? stopResult.right : null;

  out.log(
    `Status:           ${stop !== null ? `${info.runState} (${stop.cause})` : info.runState}`,
  );
  out.log(`Phase:            ${finalPhaseId} — ${phaseName} (${phaseState})`);

  const bindingResult = await readAgentBinding(phaseFolderPath);

  let binding: PhaseAgentBinding | undefined;
  if (Either.isRight(bindingResult)) {
    binding = bindingResult.right;
  }

  const entered = await planEnter(target, info, finalPhaseId);
  const canEnter = entered.kind === "command";

  if (stop !== null) {
    out.log(
      `Stopped phase:    ${stop.phaseId} — ${stop.phaseTitle} (${
        stop.phaseCommit === null
          ? "interactive"
          : `headless, committed ${stop.phaseCommit.slice(0, 7)}`
      }, ${stop.position}/${stop.of})`,
    );
    out.log(`Worktree:         ${stop.worktree}`);
    out.log(`Seed:             ${stop.seed}`);
    out.log(
      `Session:          ${
        stop.session === null
          ? "none"
          : `${stop.session.provider} ${stop.session.sessionId} (${stop.session.origin}; continue: ${stop.enterPhase})`
      }`,
    );
  } else if (binding) {
    out.log(`Provider:         ${binding.provider}`);
    out.log(`Adapter:          ${binding.adapter}`);
    out.log(`Model:            ${binding.model}`);
    out.log(`Effort:           ${binding.effort}`);
    out.log(`Session ID:       ${binding.sessionId ?? "(none)"}`);
    out.log(`Session handle:   ${binding.sessionHandle ?? "(none)"}`);
    out.log(`Worktree:         ${binding.worktreePath}`);
    out.log(`Launched:         ${binding.launchedAt}`);
    out.log(`Binding status:   ${binding.status}`);
    if (entered.kind === "refused") {
      out.log(`Resume:           ${entered.message}`);
    }
  } else {
    out.log(
      `Provider:         (no agent binding recorded — run \`phax session-info ${qualifiedName} --debug\` for raw metadata)`,
    );
  }

  out.log(
    `Suggested enter:  ${
      canEnter
        ? `phax enter-phase ${qualifiedName} ${finalPhaseId}`
        : "(interactive resume not available for this provider/session)"
    }`,
  );

  const runState = composePhaxState(
    info.runState as RunStatus["state"],
    info.lastError,
    currentPhase,
  );
  out.log(
    `Suggested resume: ${
      canResume(runState)
        ? `phax resume ${qualifiedName}`
        : "(run is not resumable from this state)"
    }`,
  );

  if (info.lastError) {
    out.log(`Last error:       ${info.lastError}`);
  }
  if (info.stoppedReason) {
    out.log(`Stopped reason:   ${info.stoppedReason}`);
  }

  if (opts.debug) {
    out.log(`\n--- Debug: agent-binding.json ---`);
    if (binding) {
      out.log(JSON.stringify(binding, null, 2));
    } else {
      out.log("(not present)");
    }

    out.log(`\n--- Debug: model-resolution.json ---`);
    try {
      const raw = await readFile(join(phaseFolderPath, "model-resolution.json"), "utf8");
      out.log(raw);
    } catch {
      out.log("(not present)");
    }
  }

  return 0;
}

export async function runSessionInfo(
  shortNameArg: string,
  out: OutputPort,
  opts: { debug?: boolean } = {},
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  const config: ResolvedConfig | undefined = Either.isRight(configResult)
    ? configResult.right
    : undefined;
  const stateRoot = effectiveStateRoot(config);

  const resolveResult = resolveRunRef(shortNameArg, config, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName, info, crossProject } = resolveResult.right;
  const qualifiedName = runKey(namespace, shortName);
  if (crossProject) {
    out.log(`Target: ${qualifiedName}`);
  }

  // Every path read here is absolute: a run of another project needs no project config.
  const fsLayer =
    config !== undefined
      ? makeRepoRootedFileSystemLayer(config)
      : makeRootedNodeFileSystemLayer(process.cwd());
  return printSessionInfo(
    { namespace, shortName, stateRoot, fsLayer },
    info,
    qualifiedName,
    out,
    opts,
  );
}
