import { Either } from "effect";
import type { CatalogEntry } from "../../schemas/providerConfig.js";
import { DEFAULT_DECIDE_EFFORT, DEFAULT_DECIDE_MODEL } from "../../schemas/phaxConfig.js";
import { DEFAULT_PROVIDER_CONFIG } from "../routing/defaults.js";

/** The model and effort a decide session runs with, and where each came from. */
export interface DecideModel {
  readonly model: string;
  readonly effort: string;
  readonly modelSource: "flag" | "catalog default";
  readonly effortSource: "flag" | "catalog default";
}

// Every Claude Code entry of the built-in catalog, newest first per family.
function claudeEntries(): readonly CatalogEntry[] {
  const families = DEFAULT_PROVIDER_CONFIG.providers["claude-code"]?.families ?? {};
  return Object.values(families).flatMap((family) => family.models);
}

/**
 * The decide session's model and effort: `--model` and `--effort` when given,
 * else the built-in defaults (§5.3). decide runs on Claude Code only, so the
 * model must be a `claude-code` entry of the built-in catalog, by its exact
 * id, and the effort one that entry lists; anything else is refused, naming
 * Claude Code as the one provider decide supports.
 */
export function resolveDecideModel(
  flagModel: string | undefined,
  flagEffort: string | undefined,
): Either.Either<DecideModel, string> {
  const model = flagModel ?? DEFAULT_DECIDE_MODEL;
  const effort = flagEffort ?? DEFAULT_DECIDE_EFFORT;
  const entries = claudeEntries();
  const entry = entries.find((e) => e.id === model);
  if (entry === undefined) {
    return Either.left(
      `--model ${model} is not a Claude Code model — decide runs on Claude Code only (its models: ${entries.map((e) => e.id).join(", ")})`,
    );
  }
  if (!(entry.efforts as readonly string[]).includes(effort)) {
    return Either.left(
      `--effort ${effort} is not an effort ${model} offers on Claude Code — decide runs on Claude Code only (its efforts: ${entry.efforts.join(", ")})`,
    );
  }
  return Either.right({
    model,
    effort,
    modelSource: flagModel === undefined ? "catalog default" : "flag",
    effortSource: flagEffort === undefined ? "catalog default" : "flag",
  });
}
