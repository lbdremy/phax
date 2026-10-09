import { JSONSchema, Schema } from "effect";
import { SecurityConfigSchema, type ResolvedSecurityConfig } from "./securityConfig.js";
import { RecordsConfigSchema, type ResolvedRecordsConfig } from "./recordsConfig.js";
import { SurfaceSchema } from "./surface.js";

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

export const BriefConfigSchema = Schema.Struct({
  command: Schema.NonEmptyString.annotations({
    description:
      "The brief provider command, split on whitespace with no shell. phax writes a brief request on its stdin and reads a brief answer, carrying its own $schema, on stdout. A brief informs and never blocks. Full contract: `phax --usage`, cmd brief.",
  }),
});

export type BriefConfig = Schema.Schema.Type<typeof BriefConfigSchema>;

export const PlanAuditorConfigSchema = Schema.Struct({
  command: Schema.NonEmptyString.annotations({
    description:
      'The plan auditor command. The string is split on whitespace with no shell — use a wrapper script for paths with spaces or pipelines. phax writes the plan projection ({"phases": [{"id", "files"}]}) to the provider\'s stdin from `phax plans lint` whenever the plan\'s deterministic extraction succeeds, and expects exit 0 with {"findings": [{"message", "phases": [...]}]} on stdout. Every finding is a warning on the lint\'s advisory check, one per phase it names; a failing auditor is one warning, and the command is capped at 30s; findings never set the exit code. `phax run` never queries it. Full contract: `phax --usage`, cmd plans lint.',
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

const GateOutputSchema = Schema.Literal("log", "diagnostics", "gate-report");
export type GateOutput = Schema.Schema.Type<typeof GateOutputSchema>;

const GATE_OUTPUT_DESCRIPTION =
  '"log" (default) streams raw command output. "gate-report": phax reads a gate report {"$schema": "https://docs.phax.run/schemas/gate-report/<release>.json", "outcome": "checked", "findings", "review"} on stdout, judges the step from it and saves it as printed as checks-attempt-NN.report-SS.json, SS being the step\'s position among the steps the attempt runs. Any finding fails the step whatever the exit code; an empty list passes on exit 0; anything else is a broken step that fails with the raw log. A report step does not have to declare input.' +
  ' "diagnostics" expects {"$schema": "https://docs.phax.run/schemas/gate-diagnostics/<release>.json", "diagnostics": [{"rule", "class": "invariant"|"completion", "location": {"file", "line"?}, "message", "repair"}]} on stdout.' +
  " Verdict rules: a non-empty list fails the step whatever the exit code, an invariant and a completion alike; exit 0 with an empty list passes; a missing, undecodable or malformed document (one without $schema included), or a non-zero exit with an empty list, is a provider error that fails the step with the raw log; a document from a newer release is refused by name." +
  " A failing document is saved as checks-attempt-NN.diagnostics.json and drives the fix prompt.";

const GATE_INPUT_DESCRIPTION =
  "Absent: the step's stdin is not connected. \"gate-request\": phax writes the gate request {$schema, phase, base, terminal, phases} on the step's stdin and saves it as checks-attempt-NN.request.json.";

const GateStepSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  firing: FiringSchema,
  output: Schema.optionalWith(GateOutputSchema, { default: () => "log" as const }).annotations({
    description: GATE_OUTPUT_DESCRIPTION,
  }),
  // The description rides the jsonSchema annotation: a plain `description` on
  // the literal would replace `Expected "gate-request"` in the config refusal,
  // and one on the property signature is dropped from this transformed
  // struct's JSON Schema.
  input: Schema.optionalWith(
    Schema.Literal("gate-request").annotations({
      jsonSchema: { description: GATE_INPUT_DESCRIPTION },
    }),
    { exact: true },
  ),
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

export const AuthoringKindConfigSchema = Schema.Struct({
  model: Schema.optional(Schema.NonEmptyString),
  effort: Schema.optional(EffortLiteral),
});

export type AuthoringKindConfig = Schema.Schema.Type<typeof AuthoringKindConfigSchema>;

export const AuthoringConfigSchema = Schema.Struct({
  spec: Schema.optional(AuthoringKindConfigSchema),
  plan: Schema.optional(AuthoringKindConfigSchema),
});

export type AuthoringConfig = Schema.Schema.Type<typeof AuthoringConfigSchema>;

export const DEFAULT_AUTHORING_MODEL = "claude-opus-5-5";
export const DEFAULT_AUTHORING_EFFORT: Effort = "high";

export interface ResolvedAuthoringConfig {
  readonly spec: { readonly model: string; readonly effort: Effort };
  readonly plan: { readonly model: string; readonly effort: Effort };
}

export function resolveAuthoringConfig(raw: AuthoringConfig | undefined): ResolvedAuthoringConfig {
  return {
    spec: {
      model: raw?.spec?.model ?? DEFAULT_AUTHORING_MODEL,
      effort: raw?.spec?.effort ?? DEFAULT_AUTHORING_EFFORT,
    },
    plan: {
      model: raw?.plan?.model ?? DEFAULT_AUTHORING_MODEL,
      effort: raw?.plan?.effort ?? DEFAULT_AUTHORING_EFFORT,
    },
  };
}

export function resolveAuthoringSelection(input: {
  readonly flagModel?: string;
  readonly flagEffort?: Effort;
  readonly configured: { readonly model: string; readonly effort: Effort };
}): { readonly model: string; readonly effort: Effort } {
  return {
    model: input.flagModel ?? input.configured.model,
    effort: input.flagEffort ?? input.configured.effort,
  };
}

export interface ResolvedComplianceReviewConfig {
  readonly enabled: boolean;
  readonly model: string;
  readonly effort: Effort;
}

// $2/$10, same as Sonnet 5; 41 vs 28 at medium on AA (2026-10-05 read)
export const DEFAULT_COMPLIANCE_REVIEW_MODEL = "claude-sonnet-5-5";

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
  brief: Schema.optional(BriefConfigSchema),
  planAuditor: Schema.optional(PlanAuditorConfigSchema),
  review: Schema.optional(
    Schema.Struct({
      compliance: Schema.optional(ComplianceReviewConfigSchema),
      code: Schema.optional(CodeReviewConfigSchema),
    }),
  ),
  authoring: Schema.optional(AuthoringConfigSchema),
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

// cheaper per token than Opus 5, scores above Fable 5.1 from medium effort up
export const DEFAULT_CODE_REVIEW_MODEL = "claude-opus-5-5";

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
  readonly brief?: BriefConfig;
  readonly planAuditor?: PlanAuditorConfig;
  readonly complianceReview: ResolvedComplianceReviewConfig;
  readonly codeReview: ResolvedCodeReviewConfig;
  readonly authoring: ResolvedAuthoringConfig;
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
  brief: Schema.optional(BriefConfigSchema),
  planAuditor: Schema.optional(PlanAuditorConfigSchema),
  review: Schema.optional(
    Schema.Struct({
      compliance: Schema.optional(ComplianceReviewConfigSchema),
      code: Schema.optional(CodeReviewConfigSchema),
    }),
  ),
  authoring: Schema.optional(AuthoringConfigSchema),
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
