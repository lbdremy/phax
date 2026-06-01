export type ProviderId = "claude-code" | "mistral-vibe" | "codex-cli";

export type ModelFamily =
  | "claude-haiku"
  | "claude-sonnet"
  | "claude-opus"
  | "mistral-medium"
  | "openai-chatgpt";

export type ThinkingLevel = "off" | "low" | "medium" | "high" | "xhigh" | "max";

export type RoutingTier =
  | "cheap"
  | "fast"
  | "standard"
  | "strong"
  | "very_strong"
  | "frontier"
  | "max";

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
}
