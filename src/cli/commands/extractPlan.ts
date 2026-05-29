import { Effect, Either } from "effect";
import { dirname, join, resolve } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { extractPlan } from "../../app/extractPlan.js";
import { loadConfig } from "../../app/loadConfig.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { buildSystemTelemetryLayer } from "./runLayers.js";

export interface ExtractPlanCliOptions {
  planMd: string;
  out: string;
  force?: boolean | undefined;
  model?: string | undefined;
  effort?: string | undefined;
  verbose?: boolean | undefined;
  trace?: boolean | undefined;
}

export async function runExtractPlan(
  opts: ExtractPlanCliOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;

  const planMdPath = resolve(process.cwd(), opts.planMd);
  const outPath = resolve(process.cwd(), opts.out);
  // Precedence: explicit CLI flag > phax.json agent.extractPlan > built-in default
  const model = opts.model ?? config.extractPlanModel;
  const effort = opts.effort ?? config.extractPlanEffort;

  const telemetryLayer = buildSystemTelemetryLayer(
    opts,
    join(dirname(outPath), "semantic.jsonl"),
    out,
    "extract-plan" as unknown as import("../../domain/branded.js").RunId,
  );

  const effect = extractPlan({
    planMdPath,
    outPath,
    force: opts.force ?? false,
    model,
    effort,
    cwd: process.cwd(),
    backend: config.backend,
  }).pipe(
    Effect.provide(makeNodeBackendLayer()),
    Effect.provide(NodeFileSystemLayer),
    Effect.provide(makeNodeLockLayer(config.stateRoot)),
    Effect.provide(telemetryLayer),
  );

  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isLeft(result)) {
    const err = result.left;
    out.error(`extract-plan failed: ${err.message}`);
    if ("path" in err && typeof err.path === "string" && err.path.length > 0) {
      out.error(`  at: ${err.path}`);
    }
    return 1;
  }

  const { outPath: writtenPath, reportPath, warnings, plan } = result.right;
  out.log(`✓ Extracted ${plan.phases.length} phase(s) to "${writtenPath}"`);
  out.log(`✓ Report written to "${reportPath}"`);
  if (warnings.length > 0) {
    out.warn(`Warnings (${warnings.length}):`);
    for (const w of warnings) {
      out.warn(`  - ${w}`);
    }
  }
  return 0;
}
