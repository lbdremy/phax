import { JSONSchema, Schema } from "effect";
import { SecurityConfigSchema, type ResolvedSecurityConfig } from "./securityConfig.js";
import { RecordsConfigSchema, type ResolvedRecordsConfig } from "./recordsConfig.js";
import { SurfaceSchema } from "./surface.js";
import { AssignmentsSchema, type Assignments } from "./assignments.js";

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

const BriefPushSchema = Schema.Literal("findings", "findings-and-rules");
export type BriefPush = Schema.Schema.Type<typeof BriefPushSchema>;

export const BriefConfigSchema = Schema.Struct({
  command: Schema.NonEmptyString.annotations({
    description:
      'The brief provider command, split on whitespace with no shell. phax writes a brief request on its stdin and reads a brief report {"$schema": "https://docs.phax.run/schemas/brief-report/<release>.json", "rules", "findings"} on stdout: the rules over the requested paths, and the findings there with their due. A provider that declines to run exits non-zero. A brief informs and never blocks. Full contract: `phax --usage`, cmd brief.',
  }),
  push: Schema.propertySignature(BriefPushSchema).annotations({
    description:
      'What the phase\'s first prompt lists from the phase\'s brief, at most 50 lines. "findings": the findings due in this phase. "findings-and-rules": those findings, then the rules over the phase\'s planned files, with their files and guides. Required, with no default, in every layer that declares brief.',
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

export const ArchitectureConfigSchema = Schema.Struct({
  command: Schema.NonEmptyString.annotations({
    description:
      'The architecture provider command. The string is split on whitespace with no shell — use a wrapper script for paths with spaces or pipelines. phax writes an architecture request {"$schema": "https://docs.phax.run/schemas/architecture-request/<release>.json", "files"} to its stdin and reads an architecture report {"$schema": "https://docs.phax.run/schemas/architecture-report/<release>.json", "body", "parts"} on stdout, which phax renders to Markdown; a provider that declines exits non-zero. Full contract: `phax --usage`, cmd architecture.',
  }),
});

export type ArchitectureConfig = Schema.Schema.Type<typeof ArchitectureConfigSchema>;

export const OraclesConfigSchema = Schema.Struct({
  command: Schema.NonEmptyString.annotations({
    description:
      'The oracles provider command. The string is split on whitespace with no shell — use a wrapper script for paths with spaces or pipelines. At the gate of an oracle phase or its discharging phase only, phax writes an oracle request {"$schema": "https://docs.phax.run/schemas/oracle-request/<release>.json", "verdict", "phase", "oraclePhase", "base", "files"} (plus "oracleCommit" on a "discharged" request) to its stdin, and judges the gate report the provider prints on stdout exactly like an `output: "gate-report"` step, with a fixed 120 s limit. `phax plans lint`, `phax validate`, the run preflight and authoring never run it. Full contract: `phax --usage`, cmd run.',
  }),
});

export type OraclesConfig = Schema.Schema.Type<typeof OraclesConfigSchema>;

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

const GateOutputSchema = Schema.Literal("log", "gate-report");
export type GateOutput = Schema.Schema.Type<typeof GateOutputSchema>;

const GATE_OUTPUT_DESCRIPTION =
  '"log" (default) streams raw command output. "gate-report": phax reads a gate report {"$schema": "https://docs.phax.run/schemas/gate-report/<release>.json", "outcome": "checked", "findings", "review"} on stdout, judges the step from it and saves it as printed as checks-attempt-NN.report-SS.json, SS being the step\'s position among the steps the attempt runs. Any finding fails the step whatever the exit code; an empty list passes on exit 0; anything else is a broken step that fails with the raw log. A report step does not have to declare input.';

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

// The other interactive judgment session beside plan adjustment, on the same
// basis: cheaper per token than Opus 5, scores above Fable 5.1 from medium
// effort up. `--model`/`--effort` override it; no phax.json key.
export const DEFAULT_DECIDE_MODEL = "claude-opus-5-5";
export const DEFAULT_DECIDE_EFFORT: Effort = "high";

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
  brief: Schema.optional(BriefConfigSchema).annotations({
    description:
      "The brief provider: a command that answers, for any paths, the rules over them and what fails there. phax pushes the phase's brief into the phase's first prompt and serves `phax brief`.",
  }),
  planAuditor: Schema.optional(PlanAuditorConfigSchema),
  architecture: Schema.optional(ArchitectureConfigSchema).annotations({
    description:
      "The architecture provider: a command that answers, for the whole repository or for some paths, the repository's architecture as a report (a Markdown body, then the parts of the code with their globs), which phax renders to Markdown. Serves `phax architecture`.",
  }),
  oracles: Schema.optional(OraclesConfigSchema).annotations({
    description:
      "The oracles provider: a command that judges the oracles an oracle phase authors and its discharging phase discharges.",
  }),
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
  assignments: Schema.optional(AssignmentsSchema).annotations({
    description:
      "The repository owner's assignment bounds: an ordered, non-empty list of part and globs bounds, each with a model and an effort range, from most to least demanding. The first bound that matches any of a phase's planned files governs it; `phax plans lint` and the `phax run` / `phax resume` start preflight hold every phase to it. Accepted in phax.json only: a user overlay that carries it is refused.",
  }),
});

export type PhaxConfig = Schema.Schema.Type<typeof PhaxConfigSchema>;
export type PhaxConfigWorkspace = Schema.Schema.Type<typeof WorkspaceSchema>;

// a tenth of Haiku 4.5's per-token price ($0.10/$0.50 vs $1/$5); 29 at low on AA (2026-10-13 read)
export const DEFAULT_EXTRACT_MODEL = "claude-haiku-5-5";

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
  readonly architecture?: ArchitectureConfig;
  readonly oracles?: OraclesConfig;
  readonly complianceReview: ResolvedComplianceReviewConfig;
  readonly codeReview: ResolvedCodeReviewConfig;
  readonly authoring: ResolvedAuthoringConfig;
  readonly records: ResolvedRecordsConfig;
  /** From phax.json alone: no user overlay carries it. */
  readonly assignments?: Assignments;
}

export type { ResolvedSecurityConfig, ResolvedRecordsConfig };

export const decodePhaxConfig = Schema.decodeUnknownEither(PhaxConfigSchema, {
  onExcessProperty: "error",
  errors: "all",
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
  brief: Schema.optional(BriefConfigSchema).annotations({
    description:
      "The brief provider: a command that answers, for any paths, the rules over them and what fails there. phax pushes the phase's brief into the phase's first prompt and serves `phax brief`.",
  }),
  planAuditor: Schema.optional(PlanAuditorConfigSchema),
  architecture: Schema.optional(ArchitectureConfigSchema).annotations({
    description:
      "The architecture provider: a command that answers, for the whole repository or for some paths, the repository's architecture as a report (a Markdown body, then the parts of the code with their globs), which phax renders to Markdown. Serves `phax architecture`.",
  }),
  oracles: Schema.optional(OraclesConfigSchema).annotations({
    description:
      "The oracles provider: a command that judges the oracles an oracle phase authors and its discharging phase discharges.",
  }),
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
  errors: "all",
});

export function getPhaxUserOverlayJsonSchema(): object {
  return JSONSchema.make(PhaxUserOverlaySchema);
}
