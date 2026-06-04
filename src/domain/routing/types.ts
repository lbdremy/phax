export type ProviderId = "claude-code" | "mistral-vibe" | "codex-cli";

export type ModelFamily =
  | "claude-haiku"
  | "claude-sonnet"
  | "claude-opus"
  | "mistral-medium"
  | "openai-gpt";

export type ClaudeHaikuEffort = "none";
export type ClaudeSonnetEffort = "low" | "medium" | "high" | "max";
export type ClaudeOpusEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultracode";
export type MistralMediumEffort = "off" | "low" | "medium" | "high" | "max";
export type OpenAiGptEffort = "low" | "medium" | "high" | "xhigh";

export type EffortLevel =
  | ClaudeHaikuEffort
  | ClaudeSonnetEffort
  | ClaudeOpusEffort
  | MistralMediumEffort
  | OpenAiGptEffort;

export type ThinkingLevel = EffortLevel;

export const FAMILY_EFFORTS: Record<ModelFamily, readonly EffortLevel[]> = {
  "claude-haiku": ["none"],
  "claude-sonnet": ["low", "medium", "high", "max"],
  "claude-opus": ["low", "medium", "high", "xhigh", "max", "ultracode"],
  "mistral-medium": ["off", "low", "medium", "high", "max"],
  "openai-gpt": ["low", "medium", "high", "xhigh"],
};

export function isEffortSupported(family: ModelFamily, effort: EffortLevel): boolean {
  return (FAMILY_EFFORTS[family] as readonly EffortLevel[]).includes(effort);
}

export type RoutingTier =
  | "cheap"
  | "fast"
  | "standard"
  | "strong"
  | "very_strong"
  | "frontier"
  | "max"
  | "ultra";

export type Relationship = "exact" | "equivalent" | "fallback" | "downgrade" | "no_equivalent";

export interface RoutingRequest {
  readonly model: string;
  readonly effort: ThinkingLevel;
}

export interface RoutingResolution {
  readonly requested: {
    readonly model: string;
    readonly family: ModelFamily;
    readonly effort: ThinkingLevel;
  };
  readonly normalizedTier: RoutingTier;
  readonly selected: {
    readonly provider: ProviderId;
    readonly family: ModelFamily;
    readonly thinking?: ThinkingLevel;
    readonly concreteModel: string;
  };
  readonly relationship: Relationship;
  readonly reason: string;
  readonly skippedForSecurity?: ReadonlyArray<{
    readonly provider: ProviderId;
    readonly reason: string;
  }>;
}

export type SecurityFilter = (provider: ProviderId) => {
  readonly allowed: boolean;
  readonly reason?: string;
};
