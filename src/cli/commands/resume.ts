import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeRunId, decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadPlan } from "../../app/loadPlan.js";
import { inspectResume } from "../../app/resume.js";
import { decodeRunStatus } from "../../schemas/status.js";
import { executePlan } from "../../app/executePlan.js";
import { withRunLock } from "../../app/lock.js";
import { setRunInterruptContext, clearRunInterruptContext } from "../interruptHandler.js";
import { exitCodeForError, provideRunLayers } from "./runLayers.js";

export interface ResumeCommandOptions {
  yes?: boolean;
}

export async function runResume(
  shortNameArg: string,
  opts: ResumeCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const { stateRoot } = config;

  const shortNameResult = decodeShortName(shortNameArg);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Invalid short name "${shortNameArg}": must match ^[a-z][a-z0-9-]*$ (1–64 chars)`);
    return 1;
  }
  const shortName = shortNameResult.right;

  const decisionResult = inspectResume(shortName, stateRoot);
  if (Either.isLeft(decisionResult)) {
    const refusal = decisionResult.left;
    if (refusal.reason === "review_open") {
      out.warn(refusal.message);
      return 0;
    }
    out.error(refusal.message);
    return 1;
  }

  const decision = decisionResult.right;
  out.log(
    `Run "${decision.shortName}" (state: ${decision.fromState}) — would resume from phase ${decision.nextPhaseIndex + 1}: ${decision.nextPhaseId}`,
  );

  if (!opts.yes) {
    out.log("Pass --yes to proceed.");
    return 0;
  }

  const runPath = join(stateRoot, "runs", shortName);
  const planPath = join(runPath, "phax-plan.json");
  const planMdPath = join(runPath, "plan.md");

  const planResult = loadPlan(planPath);
  if (Either.isLeft(planResult)) {
    out.error(`Plan error: ${planResult.left.message}`);
    return 2;
  }
  const plan = planResult.right;

  let planMd: string;
  try {
    planMd = readFileSync(planMdPath, "utf8");
  } catch (e) {
    out.error(
      `Cannot read plan.md at "${planMdPath}": ${e instanceof Error ? e.message : String(e)}`,
    );
    return 2;
  }

  let runStatusRaw: unknown;
  try {
    runStatusRaw = JSON.parse(readFileSync(join(runPath, "run-status.json"), "utf8"));
  } catch (e) {
    out.error(`Cannot read run-status.json: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  const runStatusResult = decodeRunStatus(runStatusRaw);
  if (Either.isLeft(runStatusResult)) {
    out.error(`Invalid run-status.json: ${String(runStatusResult.left)}`);
    return 2;
  }
  const runStatus = runStatusResult.right;

  const runIdResult = decodeRunId(runStatus.runId);
  if (Either.isLeft(runIdResult)) {
    out.error(`Invalid runId in run-status.json`);
    return 2;
  }
  const runId = runIdResult.right;

  const profiles = config.raw.gateProfiles;
  const gateProfileId =
    runStatus.gateProfileId ??
    ("full" in profiles
      ? "full"
      : "fast" in profiles
        ? "fast"
        : (Object.keys(profiles)[0] ?? null));

  if (gateProfileId === null) {
    out.error("No gate profiles configured in phax.json");
    return 2;
  }

  setRunInterruptContext(shortName, stateRoot);
  try {
    const program = withRunLock(
      shortName,
      executePlan({
        shortName,
        plan,
        planMd,
        config,
        gateProfileId,
        workspaceId: undefined,
        allowDirty: true,
        runPath,
        runId,
        startIndex: decision.nextPhaseIndex,
      }),
    );

    const result = await Effect.runPromise(Effect.either(provideRunLayers(program, config)));

    if (Either.isLeft(result)) {
      const err = result.left;
      out.error(`phax resume failed: ${err instanceof Error ? err.message : String(err)}`);
      return exitCodeForError(err);
    }

    out.log(
      `Run "${shortName}" reached review_open. Use \`phax enter ${shortName}\` or \`phax archive ${shortName}\` when done.`,
    );
    return 0;
  } finally {
    clearRunInterruptContext();
  }
}
