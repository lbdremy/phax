export type ProviderId = "claude-code" | "mistral-vibe" | "codex-cli";

export type ModelFamily =
  | "claude-haiku"
  | "claude-sonnet"
  | "claude-opus"
  | "claude-fable"
  | "mistral-medium"
  | "openai-gpt";

export type ThinkingLevel =
  | "none"
  | "off"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultracode"
  | "ultra";

export type Relationship =
  | "exact"
  | "equivalent"
  | "upgrade"
  | "fallback"
  | "downgrade"
  | "no_equivalent";

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
