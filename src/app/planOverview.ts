import { Effect, Either } from "effect";
import { FileSystem } from "../ports/fs.js";
import { Shell } from "../ports/shell.js";
import { classifyArtifactPath, validateArtifact } from "../domain/artifact/document.js";
import { readPlanFrontmatter } from "../domain/artifact/lineage.js";
import { parseArtifactName } from "../domain/artifact/name.js";
import { finalizeExtractedPlan } from "../domain/plan/finalize.js";
import { extractPlanDeterministic } from "../domain/plan/parsePlanMarkdown.js";
import {
  buildOverview,
  planFilesOf,
  type ArchitectureOutcome,
  type PlanOverview,
} from "../domain/plan/overview.js";
import { onOneLine } from "../domain/reportText.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { pullArchitecture } from "./architectureProvider.js";
import { readSourceSpecCriteria } from "./sourceSpecCriteria.js";

export interface PlanOverviewOptions {
  /** Absolute path the plan is read from. */
  readonly planMdPath: string;
  /** The path the report names: the argument as the caller typed it. */
  readonly reportPath: string;
  /**
   * The plan's path relative to `config.repoRoot`, POSIX-separated. A plan under
   * `docs/plans/` is validated like any artifact; a loose plan.md is not.
   */
  readonly repoRelPath: string;
  readonly config: ResolvedConfig;
}

/** Why no overview could be made; `line` is the one stderr line the CLI prints. */
export type PlanOverviewFailure =
  | { readonly kind: "unreadable"; readonly line: string }
  | { readonly kind: "unparsable"; readonly line: string }
  | { readonly kind: "invalid-artifact"; readonly line: string };

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Read-only, model-free plan overview (test-strategy §5.13–§5.20). The
 * requirement set is `FileSystem` plus `Shell` for the architecture provider,
 * which runs once with the plan's planned files and never fails the overview:
 * a provider that fails, or is refused, leaves the architecture `failed` and
 * the planned files listed as they are. No `Backend`, so no model can be
 * reached by construction.
 *
 * The plan is read by the strict deterministic parse: a structure error or a
 * departing test line is `unparsable`. A plan under `docs/plans/` that fails
 * artifact validation is `invalid-artifact`, with the validation error's line
 * after the reported path.
 */
export function planOverview(
  opts: PlanOverviewOptions,
): Effect.Effect<PlanOverview, PlanOverviewFailure, FileSystem | Shell> {
  const { planMdPath, reportPath, repoRelPath, config } = opts;
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const readPlan = yield* fs.readText(planMdPath).pipe(Effect.either);
    if (Either.isLeft(readPlan)) {
      return yield* Effect.fail({
        kind: "unreadable",
        line: onOneLine(`${reportPath}: cannot be read (${readPlan.left.message})`),
      } satisfies PlanOverviewFailure);
    }
    const planMd = readPlan.right;

    const artifact = classifyArtifactPath(repoRelPath) !== null;
    if (artifact) {
      const validated = validateArtifact(repoRelPath, planMd);
      if (Either.isLeft(validated)) {
        return yield* Effect.fail({
          kind: "invalid-artifact",
          line: onOneLine(`${reportPath}: ${validated.left.message}`),
        } satisfies PlanOverviewFailure);
      }
    }
    // A validated artifact always decodes; a loose plan.md may have no
    // frontmatter, or a block that does not decode, and the overview says which.
    const frontmatter = readPlanFrontmatter(planMd);

    const unparsable: PlanOverviewFailure = {
      kind: "unparsable",
      line: `${reportPath}: the plan does not parse — run phax plans lint ${reportPath}`,
    };
    const extracted = extractPlanDeterministic(planMd);
    if (Either.isLeft(extracted)) return yield* Effect.fail(unparsable);
    const finalized = finalizeExtractedPlan(extracted.right, planMd);
    if (Either.isLeft(finalized)) return yield* Effect.fail(unparsable);
    const { plan } = finalized.right;

    const criteria = yield* readSourceSpecCriteria({ planMd, repoRoot: config.repoRoot });
    const declaration = frontmatter.kind === "decoded" ? frontmatter.sourceSpec : null;
    const sourceSpec =
      declaration === null || declaration.kind === "none"
        ? null
        : {
            path: declaration.path,
            slug: parseArtifactName("spec", fileNameOf(declaration.path))?.slug ?? declaration.path,
          };

    const architecture = yield* architectureOf(config, planFilesOf(plan.phases));

    return buildOverview({
      plan: reportPath,
      name:
        (artifact ? parseArtifactName("plan", fileNameOf(repoRelPath))?.slug : undefined) ??
        plan.run.shortName,
      title: plan.run.title,
      frontmatter:
        frontmatter.kind === "decoded"
          ? { kind: "decoded", status: frontmatter.status }
          : frontmatter,
      sourceSpec,
      phases: plan.phases,
      architecture,
      criteria,
    });
  });
}

/** One architecture provider call with the plan's planned files, or none without a provider. */
function architectureOf(
  config: ResolvedConfig,
  paths: readonly string[],
): Effect.Effect<ArchitectureOutcome, never, Shell> {
  return Effect.gen(function* () {
    if (config.architecture === undefined) return { kind: "none" } as const;
    const pulled = yield* pullArchitecture({
      command: config.architecture.command,
      root: config.repoRoot,
      cwd: config.repoRoot,
      paths,
    });
    switch (pulled.kind) {
      case "answered":
        return { kind: "parts", parts: pulled.report.parts } as const;
      case "failed":
        return { kind: "failed", message: pulled.reason } as const;
      case "refused":
        return { kind: "failed", message: pulled.message } as const;
    }
  });
}
