import { JSONSchema, Schema } from "effect";
import { SecurityConfigSchema, type ResolvedSecurityConfig } from "./securityConfig.js";
import { RecordsConfigSchema, type ResolvedRecordsConfig } from "./recordsConfig.js";

export const PublishConfigSchema = Schema.Struct({
  auto: Schema.Boolean,
  remote: Schema.optional(Schema.NonEmptyString),
  provider: Schema.optional(Schema.Literal("github")),
  pushBranch: Schema.optional(Schema.Boolean),
  createPullRequest: Schema.optional(Schema.Boolean),
  baseBranch: Schema.optional(Schema.NonEmptyString),
  title: Schema.optional(Schema.NonEmptyString),
});

export type PublishConfig = Schema.Schema.Type<typeof PublishConfigSchema>;

export const OrientConfigSchema = Schema.Struct({
  command: Schema.NonEmptyString.annotations({
    description:
      "The orient provider command. The string is split on whitespace with no shell — use a wrapper script for paths with spaces or pipelines. phax writes a JSON request to the provider's stdin and reads a JSON response from stdout. Full contract: `phax --usage`, cmd orient.",
  }),
});

export type OrientConfig = Schema.Schema.Type<typeof OrientConfigSchema>;

export const ScopesConfigSchema = Schema.Struct({
  command: Schema.NonEmptyString.annotations({
    description:
      'The scopes provider command. The string is split on whitespace with no shell — use a wrapper script for paths with spaces or pipelines. phax writes the plan projection ({"phase", "phases": [{"id", "files"}]}) to the provider\'s stdin before each non-terminal phase gate that has a diagnostic step and expects exit 0 with {"closed": ["<scope>", ...]} on stdout. A completion diagnostic fails the step only when every scope it names is closed, otherwise it is pending; the terminal phase closes every scope without a query. Full contract: `phax --usage`, cmd run.',
  }),
});

export type ScopesConfig = Schema.Schema.Type<typeof ScopesConfigSchema>;

export const PlanAuditorConfigSchema = Schema.Struct({
  command: Schema.NonEmptyString.annotations({
    description:
      'The plan auditor command. The string is split on whitespace with no shell — use a wrapper script for paths with spaces or pipelines. phax writes the plan projection ({"phases": [{"id", "files"}]}) to the provider\'s stdin from `phax plans lint` whenever the plan\'s deterministic extraction succeeds, and expects exit 0 with {"findings": [{"message", "phases": [...]}]} on stdout. Every finding is a warning on the lint\'s advisory check, one per phase it names; a failing auditor is one warning; findings never set the exit code. `phax run` never queries it. Full contract: `phax --usage`, cmd plans lint.',
  }),
});

export type PlanAuditorConfig = Schema.Schema.Type<typeof PlanAuditorConfigSchema>;

export interface ResolvedPublishConfig {
  readonly auto: boolean;
  readonly remote: string;
  readonly provider: "github";
  readonly pushBranch: boolean;
  readonly createPullRequest: boolean;
  readonly baseBranch?: string;
  readonly title?: string;
}

export function resolvePublishConfig(raw: PublishConfig | undefined): ResolvedPublishConfig {
  return {
    auto: raw?.auto ?? false,
    remote: raw?.remote ?? "origin",
    provider: raw?.provider ?? "github",
    pushBranch: raw?.pushBranch ?? true,
    createPullRequest: raw?.createPullRequest ?? true,
    ...(raw?.baseBranch !== undefined ? { baseBranch: raw.baseBranch } : {}),
    ...(raw?.title !== undefined ? { title: raw.title } : {}),
  };
}

const NonEmptyCommandArray = Schema.NonEmptyArray(Schema.NonEmptyString);

const FiringSchema = Schema.Literal("every-phase", "terminal");
export type Firing = Schema.Schema.Type<typeof FiringSchema>;

export const SurfaceSchema = Schema.Literal("local", "structural", "product");
export type Surface = Schema.Schema.Type<typeof SurfaceSchema>;

const GateOutputSchema = Schema.Literal("log", "diagnostics");
export type GateOutput = Schema.Schema.Type<typeof GateOutputSchema>;

const GATE_OUTPUT_DESCRIPTION =
  '"log" (default) streams raw command output. "diagnostics" expects {"diagnostics": [{"rule", "class": "invariant"|"completion", "scopes"?: [...], "location": {"file", "line"?}, "message", "repair"}]} on stdout.' +
  " Verdict rules: a non-empty list fails the step whatever the exit code; exit 0 with an empty list passes; a missing or undecodable document, or a non-zero exit with an empty list, is a provider error that fails the step with the raw log." +
  " A failing document is saved as checks-attempt-NN.diagnostics.json and drives the fix prompt." +
  ' A completion diagnostic names one or more scopes and is pending — not failing — until every scope it names is closed by the "scopes" provider.';

const GateStepSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  firing: FiringSchema,
  output: Schema.optionalWith(GateOutputSchema, { default: () => "log" as const }).annotations({
    description: GATE_OUTPUT_DESCRIPTION,
  }),
});
export type GateStep = Schema.Schema.Type<typeof GateStepSchema>;

const GateProfilesSchema = Schema.Record({
  key: Schema.NonEmptyString,
  value: Schema.NonEmptyArray(GateStepSchema),
});

const WorkspaceSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  path: Schema.NonEmptyString,
  gateProfiles: Schema.optional(GateProfilesSchema),
});

const EffortLiteral = Schema.Literal("low", "medium", "high");
export type Effort = Schema.Schema.Type<typeof EffortLiteral>;

const ExtractPlanConfigSchema = Schema.Struct({
  model: Schema.optional(Schema.NonEmptyString),
  effort: Schema.optional(EffortLiteral),
});

export const ComplianceReviewConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  model: Schema.optional(Schema.NonEmptyString),
  effort: Schema.optional(EffortLiteral),
});

export const CodeReviewConfigSchema = Schema.Struct({
  model: Schema.optional(Schema.NonEmptyString),
  effort: Schema.optional(EffortLiteral),
});

export type CodeReviewConfig = Schema.Schema.Type<typeof CodeReviewConfigSchema>;

export type ComplianceReviewConfig = Schema.Schema.Type<typeof ComplianceReviewConfigSchema>;

export interface ResolvedComplianceReviewConfig {
  readonly enabled: boolean;
  readonly model: string;
  readonly effort: Effort;
}

// $2/$10 vs Sonnet 4.6's $3/$15, same effort curve
export const DEFAULT_COMPLIANCE_REVIEW_MODEL = "claude-sonnet-5";

export function resolveComplianceReviewConfig(
  raw: ComplianceReviewConfig | undefined,
): ResolvedComplianceReviewConfig {
  return {
    enabled: raw?.enabled ?? false,
    model: raw?.model ?? DEFAULT_COMPLIANCE_REVIEW_MODEL,
    effort: raw?.effort ?? "medium",
  };
}

const FileReconciliationConfigSchema = Schema.Struct({
  mode: Schema.Literal("report_only", "warn"),
});

export const PhaxConfigSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  version: Schema.Literal(1),
  name: Schema.NonEmptyString,
  state: Schema.optional(
    Schema.Struct({
      root: Schema.NonEmptyString,
    }),
  ),
  agent: Schema.optional(
    Schema.Struct({
      maxFixAttempts: Schema.optional(Schema.Int.pipe(Schema.between(1, 10))),
      extractPlan: Schema.optional(ExtractPlanConfigSchema),
    }),
  ),
  commands: Schema.optional(
    Schema.Struct({
      setup: Schema.optional(NonEmptyCommandArray),
      cleanup: Schema.optional(NonEmptyCommandArray),
    }),
  ),
  fileReconciliation: Schema.optional(FileReconciliationConfigSchema),
  security: Schema.optional(SecurityConfigSchema),
  publish: Schema.optional(PublishConfigSchema),
  orient: Schema.optional(OrientConfigSchema),
  scopes: Schema.optional(ScopesConfigSchema),
  planAuditor: Schema.optional(PlanAuditorConfigSchema),
  review: Schema.optional(
    Schema.Struct({
      compliance: Schema.optional(ComplianceReviewConfigSchema),
      code: Schema.optional(CodeReviewConfigSchema),
    }),
  ),
  gateProfiles: GateProfilesSchema,
  workspaces: Schema.optional(Schema.Array(WorkspaceSchema)),
  records: Schema.optional(RecordsConfigSchema),
});

export type PhaxConfig = Schema.Schema.Type<typeof PhaxConfigSchema>;
export type PhaxConfigWorkspace = Schema.Schema.Type<typeof WorkspaceSchema>;

export const DEFAULT_EXTRACT_MODEL = "claude-haiku-4-5-20251001";

export interface ResolvedCodeReviewConfig {
  readonly model: string;
  readonly effort: Effort;
}

// same per-token tier as Opus 4.8, fewer generated tokens
export const DEFAULT_CODE_REVIEW_MODEL = "claude-opus-5";

export function resolveCodeReviewConfig(
  raw: CodeReviewConfig | undefined,
): ResolvedCodeReviewConfig {
  return {
    model: raw?.model ?? DEFAULT_CODE_REVIEW_MODEL,
    effort: raw?.effort ?? "high",
  };
}

export interface ResolvedConfig {
  readonly raw: PhaxConfig;
  readonly namespace: string;
  readonly stateRoot: string;
  readonly repoRoot: string;
  readonly maxFixAttempts: number;
  readonly extractPlanModel: string;
  readonly extractPlanEffort: Effort;
  readonly fileReconciliationMode: "report_only" | "warn";
  readonly security: ResolvedSecurityConfig;
  readonly publish: ResolvedPublishConfig;
  readonly orient?: OrientConfig;
  readonly scopes?: ScopesConfig;
  readonly planAuditor?: PlanAuditorConfig;
  readonly complianceReview: ResolvedComplianceReviewConfig;
  readonly codeReview: ResolvedCodeReviewConfig;
  readonly records: ResolvedRecordsConfig;
}

export type { ResolvedSecurityConfig, ResolvedRecordsConfig };

export const decodePhaxConfig = Schema.decodeUnknownEither(PhaxConfigSchema, {
  onExcessProperty: "error",
});

export function getPhaxConfigJsonSchema(): object {
  return JSONSchema.make(PhaxConfigSchema);
}

export const PhaxUserOverlaySchema = Schema.Struct({
  state: Schema.optional(
    Schema.Struct({
      root: Schema.NonEmptyString,
    }),
  ),
  agent: Schema.optional(
    Schema.Struct({
      maxFixAttempts: Schema.optional(Schema.Int.pipe(Schema.between(1, 10))),
      extractPlan: Schema.optional(ExtractPlanConfigSchema),
    }),
  ),
  commands: Schema.optional(
    Schema.Struct({
      setup: Schema.optional(NonEmptyCommandArray),
      cleanup: Schema.optional(NonEmptyCommandArray),
    }),
  ),
  fileReconciliation: Schema.optional(FileReconciliationConfigSchema),
  security: Schema.optional(SecurityConfigSchema),
  publish: Schema.optional(PublishConfigSchema),
  orient: Schema.optional(OrientConfigSchema),
  scopes: Schema.optional(ScopesConfigSchema),
  planAuditor: Schema.optional(PlanAuditorConfigSchema),
  review: Schema.optional(
    Schema.Struct({
      compliance: Schema.optional(ComplianceReviewConfigSchema),
      code: Schema.optional(CodeReviewConfigSchema),
    }),
  ),
  gateProfiles: Schema.optional(GateProfilesSchema),
  workspaces: Schema.optional(Schema.Array(WorkspaceSchema)),
});

export type PhaxUserOverlay = Schema.Schema.Type<typeof PhaxUserOverlaySchema>;

export const decodePhaxUserOverlay = Schema.decodeUnknownEither(PhaxUserOverlaySchema, {
  onExcessProperty: "error",
});

export function getPhaxUserOverlayJsonSchema(): object {
  return JSONSchema.make(PhaxUserOverlaySchema);
}
