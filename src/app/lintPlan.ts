import { join } from "node:path";
import { Effect, Either } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { ArtifactValidationError, ConfigValidationError } from "../domain/errors.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { Shell } from "../ports/shell.js";
import { classifyArtifactPath, validateArtifact } from "../domain/artifact/document.js";
import { readSourceSpec } from "../domain/artifact/lineage.js";
import { parseArtifactName } from "../domain/artifact/name.js";
import { extractPlanDeterministic } from "../domain/plan/parsePlanMarkdown.js";
import { finalizeExtractedPlan } from "../domain/plan/finalize.js";
import {
  advisoryFindings,
  auditorFailureFinding,
  commandFindings,
  filePlanFindings,
  lineageFindings,
  modelFindings,
  plannedPaths,
  structureFindings,
  type LintFinding,
} from "../domain/plan/lint.js";
import { makePlanAuditRequest } from "../domain/plan/projection.js";
import { queryPlanAuditor } from "./planAuditor.js";
import { resolveGateProfile } from "./gates.js";
import { loadModelRouting, loadProviderConfig } from "./loadRouting.js";

export interface LintReport {
  /** The plan path as the caller wants it reported — `LintPlanOptions.reportPath`. */
  readonly plan: string;
  readonly findings: readonly LintFinding[];
}

export interface LintPlanOptions {
  /** Absolute path the plan is read from. */
  readonly planMdPath: string;
  /**
   * The path the report names. The CLI absolutizes `planMdPath` against the
   * invocation directory, so it passes the argument as typed here — a reader
   * should see the path they wrote, not a resolved one.
   */
  readonly reportPath: string;
  /**
   * The plan's path relative to `config.repoRoot`, POSIX-separated. Decides
   * whether the plan is a repo-tracked artifact (under `docs/plans/`) that must
   * pass artifact validation and mirror its source spec's slug; a loose
   * `plan.md` anywhere else skips both.
   */
  readonly repoRelPath: string;
  readonly config: ResolvedConfig;
}

function fileNameOf(repoRelPath: string): string {
  return repoRelPath.slice(repoRelPath.lastIndexOf("/") + 1);
}

/** The slug of the plan's declared source spec, or null when there is none to compare. */
function sourceSpecSlug(planMd: string): string | null {
  const declaration = readSourceSpec(planMd);
  if (declaration === null || declaration.kind === "none") return null;
  if (classifyArtifactPath(declaration.path)?.kind !== "spec") return null;
  return parseArtifactName("spec", fileNameOf(declaration.path))?.slug ?? null;
}

/**
 * Read-only, model-free plan lint (spec 33 §5.1, §5.3): reads the plan, runs
 * the structure, file-plan, required-commands and model checks, and returns
 * the findings. The requirement set is `FileSystem` plus `Shell` for the
 * registered plan auditor — still no `Backend`, so this use case cannot fall
 * back to the extraction model by construction. Advisory findings are the one
 * check that reports on an external provider, and they are warnings by
 * construction: an auditor failure is a finding, never an effect error.
 *
 * An unreadable plan or an unusable global config is the effect's error, never
 * a finding: findings describe the plan, not the environment.
 *
 * A repo-tracked plan (under `docs/plans/`) is first validated like any
 * artifact — name grammar, frontmatter, status/location — and a failure is the
 * effect's `ArtifactValidationError`, not a finding; its slug is then compared
 * to its source spec's. A loose `plan.md` elsewhere skips both.
 */
export function lintPlan(
  opts: LintPlanOptions,
): Effect.Effect<
  LintReport,
  FsError | ConfigValidationError | ArtifactValidationError,
  FileSystem | Shell
> {
  const { planMdPath, reportPath, repoRelPath, config } = opts;
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const planMd = yield* fs.readText(planMdPath);

    const findings: LintFinding[] = [...structureFindings(planMd)];

    if (classifyArtifactPath(repoRelPath) !== null) {
      const validated = validateArtifact(repoRelPath, planMd);
      if (Either.isLeft(validated)) return yield* Effect.fail(validated.left);
      const planSlug = parseArtifactName("plan", fileNameOf(repoRelPath))?.slug;
      if (planSlug !== undefined) {
        findings.push(...lineageFindings(planSlug, sourceSpecSlug(planMd)));
      }
    }

    const extracted = extractPlanDeterministic(planMd);
    if (Either.isLeft(extracted)) {
      // Every later check needs a parsed plan; the structural errors already
      // say why it could not be parsed.
      return { plan: reportPath, findings };
    }

    const finalized = finalizeExtractedPlan(extracted.right, planMd);
    if (Either.isLeft(finalized)) {
      findings.push({
        severity: "error",
        check: "structure",
        phase: null,
        message: finalized.left.message,
      });
      return { plan: reportPath, findings };
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

    // Advisory: only when a plan auditor is registered, and only once the plan
    // parsed cleanly — an unparseable plan never spawns the auditor.
    if (config.planAuditor !== undefined) {
      const audited = yield* queryPlanAuditor(
        config.planAuditor,
        makePlanAuditRequest(plan.phases),
        config.repoRoot,
      );
      findings.push(
        ...(Either.isRight(audited)
          ? advisoryFindings(audited.right)
          : [auditorFailureFinding(audited.left)]),
      );
    }

    return { plan: reportPath, findings };
  });
}
