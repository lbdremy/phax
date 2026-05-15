import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadPlan } from "../../app/loadPlan.js";
import { buildDryRunReport, formatDryRunReport } from "../../app/dryRun.js";
import { createRunFolder } from "../../app/runFolder.js";
import { executePlan } from "../../app/executePlan.js";
import { withRunLock } from "../../app/lock.js";
import { setRunInterruptContext, clearRunInterruptContext } from "../interruptHandler.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import { buildTracerLayer, exitCodeForError, provideRunLayers } from "./runLayers.js";

export interface RunCommandOptions {
  shortName?: string;
  planMd?: string;
  plan?: string;
  dryRun?: boolean;
  profile?: string;
  workspace?: string;
  allowDirty?: boolean;
  verbose?: boolean;
  trace?: boolean;
}

function pickGateProfileId(config: ResolvedConfig, profileOpt: string | undefined): string | null {
  const profiles = config.raw.gateProfiles;

  if (profileOpt !== undefined) {
    return profileOpt in profiles ? profileOpt : null;
  }

  if ("full" in profiles) return "full";
  if ("fast" in profiles) return "fast";

  const keys = Object.keys(profiles);
  return keys[0] ?? null;
}

export async function runRun(opts: RunCommandOptions, out: OutputPort): Promise<number> {
  const cwd = process.cwd();
  const planPath = resolve(cwd, opts.plan ?? "phax-plan.json");
  const planMdPath = resolve(cwd, opts.planMd ?? "plan.md");

  if (opts.dryRun) {
    const reportResult = buildDryRunReport(cwd, planPath, opts.profile);
    if (Either.isLeft(reportResult)) {
      out.error(reportResult.left);
      return 1;
    }
    out.log(formatDryRunReport(reportResult.right));
    return 0;
  }

  const configResult = loadConfig(cwd);
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 2;
  }
  const config = configResult.right;

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

  if (opts.shortName !== undefined && opts.shortName !== plan.run.shortName) {
    out.error(
      `Short name mismatch: argument "${opts.shortName}" does not match plan short name "${plan.run.shortName}"`,
    );
    return 2;
  }

  const shortNameResult = decodeShortName(plan.run.shortName);
  if (Either.isLeft(shortNameResult)) {
    out.error(
      `Invalid short name "${plan.run.shortName}" in plan: must match ^[a-z][a-z0-9-]*$ (1–64 chars)`,
    );
    return 2;
  }
  const shortName = shortNameResult.right;

  const gateProfileId = pickGateProfileId(config, opts.profile);
  if (gateProfileId === null) {
    if (opts.profile !== undefined) {
      out.error(
        `Gate profile "${opts.profile}" not found in phax.json. Available: ${Object.keys(config.raw.gateProfiles).join(", ")}`,
      );
    } else {
      out.error("No gate profiles configured in phax.json");
    }
    return 2;
  }

  const traceJsonlPath = join(config.stateRoot, "runs", shortName, "trace.jsonl");
  const tracerLayer = buildTracerLayer(opts, traceJsonlPath, out);

  setRunInterruptContext(shortName, config.stateRoot);
  try {
    const program = withRunLock(
      shortName,
      createRunFolder(shortName, planMd, plan, config).pipe(
        Effect.flatMap(({ runPath, runId }) =>
          executePlan({
            shortName,
            plan,
            planMd,
            config,
            gateProfileId,
            workspaceId: opts.workspace,
            allowDirty: opts.allowDirty ?? false,
            runPath,
            runId,
            startIndex: 0,
          }),
        ),
      ),
    );

    const result = await Effect.runPromise(
      Effect.either(provideRunLayers(program, config, tracerLayer)),
    );

    if (Either.isLeft(result)) {
      const err = result.left;
      out.error(`phax run failed: ${err instanceof Error ? err.message : String(err)}`);
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
