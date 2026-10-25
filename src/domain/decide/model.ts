import { Either } from "effect";
import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { CatalogEntry, ProviderConfig } from "../../schemas/providerConfig.js";
import {
  DEFAULT_DECIDE_EFFORT,
  DEFAULT_DECIDE_MODEL,
  DEFAULT_VERDICTS_EFFORT,
  DEFAULT_VERDICTS_MODEL,
  type Effort,
} from "../../schemas/phaxConfig.js";
import { DEFAULT_PROVIDER_CONFIG } from "../routing/defaults.js";
import { resolveModel } from "../routing/resolve.js";
import type { ProviderId, Relationship, ThinkingLevel } from "../routing/types.js";

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

/** The model and effort a verdicts-mode writer runs with, once routed. */
export interface VerdictsModel {
  /** The model asked for: `--model`, else the built-in default. */
  readonly model: string;
  readonly effort: Effort;
  readonly modelSource: "flag" | "built-in default";
  readonly effortSource: "flag" | "built-in default";
  /** The provider routing selected. */
  readonly provider: ProviderId;
  /** The model the writer runs: `model` itself, or what routing resolved it to. */
  readonly concreteModel: string;
  readonly relationship: Relationship;
  /** The effort routing selected, when it names one; the writer runs at it. */
  readonly thinking: ThinkingLevel | undefined;
}

const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}

/**
 * The verdicts-mode writer's model: `--model` and `--effort` when given, else
 * the built-in defaults (claude-sonnet-5-5 at medium), routed through
 * `resolveModel` like headless authoring. Routing never fails: a model with no
 * equivalent on the selected provider falls back, and the writer runs on the
 * concrete model routing chose, `model` keeping the one asked for. The only
 * refusal is an effort outside `low | medium | high`.
 */
export function resolveVerdictsModel(
  flagModel: string | undefined,
  flagEffort: string | undefined,
  routing: ModelRouting,
  providerConfig: ProviderConfig,
): Either.Either<VerdictsModel, string> {
  const model = flagModel ?? DEFAULT_VERDICTS_MODEL;
  const effort = flagEffort ?? DEFAULT_VERDICTS_EFFORT;
  if (!isEffort(effort)) {
    return Either.left(`--effort ${effort} is not an effort — use ${EFFORTS.join(", ")}`);
  }
  const { selected, relationship } = resolveModel({ model, effort }, routing, providerConfig);
  return Either.right({
    model,
    effort,
    modelSource: flagModel === undefined ? "built-in default" : "flag",
    effortSource: flagEffort === undefined ? "built-in default" : "flag",
    provider: selected.provider,
    concreteModel: selected.concreteModel,
    relationship,
    thinking: selected.thinking,
  });
}
