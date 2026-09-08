import { join } from "node:path";
import { Effect, Either } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { ConfigValidationError } from "../domain/errors.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { extractPlanDeterministic } from "../domain/plan/parsePlanMarkdown.js";
import { finalizeExtractedPlan } from "../domain/plan/finalize.js";
import {
  commandFindings,
  filePlanFindings,
  modelFindings,
  plannedPaths,
  structureFindings,
  type LintFinding,
} from "../domain/plan/lint.js";
import { resolveGateProfile } from "./gates.js";
import { loadModelRouting, loadProviderConfig } from "./loadRouting.js";

export interface LintReport {
  /** The plan path exactly as the caller gave it. */
  readonly plan: string;
  readonly findings: readonly LintFinding[];
}

export interface LintPlanOptions {
  readonly planMdPath: string;
  readonly config: ResolvedConfig;
}

/**
 * Read-only, model-free plan lint (spec 33 §5.1, §5.3): reads the plan, runs
 * the structure, file-plan, required-commands and model checks, and returns
 * the findings. The requirement set is `FileSystem` alone — no `Backend`, so
 * this use case cannot fall back to the extraction model by construction.
 *
 * An unreadable plan or an unusable global config is the effect's error, never
 * a finding: findings describe the plan, not the environment.
 */
export function lintPlan(
  opts: LintPlanOptions,
): Effect.Effect<LintReport, FsError | ConfigValidationError, FileSystem> {
  const { planMdPath, config } = opts;
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const planMd = yield* fs.readText(planMdPath);

    const findings: LintFinding[] = [...structureFindings(planMd)];

    const extracted = extractPlanDeterministic(planMd);
    if (Either.isLeft(extracted)) {
      // Every later check needs a parsed plan; the structural errors already
      // say why it could not be parsed.
      return { plan: planMdPath, findings };
    }

    const finalized = finalizeExtractedPlan(extracted.right, planMd);
    if (Either.isLeft(finalized)) {
      findings.push({
        severity: "error",
        check: "structure",
        phase: null,
        message: finalized.left.message,
      });
      return { plan: planMdPath, findings };
    }

    const { plan, warnings } = finalized.right;
    for (const warning of warnings) {
      findings.push({ severity: "warning", check: "structure", phase: null, message: warning });
    }

    // Files: probe exactly the paths the plan names, against the working tree.
    const existing = new Set<string>();
    for (const path of plannedPaths(plan.phases)) {
      const present = yield* fs.exists(join(config.repoRoot, path));
      if (present) existing.add(path);
    }
    findings.push(...filePlanFindings(plan.phases, existing));

    // Commands: the same inputs `executePlan` feeds its preflight.
    const profileId = Object.keys(config.raw.gateProfiles)[0];
    const gateCommands =
      profileId === undefined ? [] : resolveGateProfile(config, profileId).map((s) => s.command);
    findings.push(
      ...commandFindings(plan.run.requiredCommands, config.security.agentCommands, gateCommands),
    );

    // Models: the catalog as the run would read it.
    const routing = yield* loadModelRouting();
    const providerConfig = yield* loadProviderConfig();
    findings.push(...modelFindings(plan.phases, routing, providerConfig));

    return { plan: planMdPath, findings };
  });
}
