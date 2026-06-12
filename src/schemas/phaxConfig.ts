import { Schema } from "effect";
import { SecurityConfigSchema, type ResolvedSecurityConfig } from "./securityConfig.js";

export const PublishConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  remote: Schema.optional(Schema.NonEmptyString),
  provider: Schema.optional(Schema.Literal("github")),
  pushBranch: Schema.optional(Schema.Boolean),
  createPullRequest: Schema.optional(Schema.Boolean),
  baseBranch: Schema.optional(Schema.NonEmptyString),
  title: Schema.optional(Schema.NonEmptyString),
});

export type PublishConfig = Schema.Schema.Type<typeof PublishConfigSchema>;

export interface ResolvedPublishConfig {
  readonly enabled: boolean;
  readonly remote: string;
  readonly provider: "github";
  readonly pushBranch: boolean;
  readonly createPullRequest: boolean;
  readonly baseBranch?: string;
  readonly title?: string;
}

export function resolvePublishConfig(raw: PublishConfig | undefined): ResolvedPublishConfig {
  return {
    enabled: raw?.enabled ?? false,
    remote: raw?.remote ?? "origin",
    provider: raw?.provider ?? "github",
    pushBranch: raw?.pushBranch ?? true,
    createPullRequest: raw?.createPullRequest ?? true,
    ...(raw?.baseBranch !== undefined ? { baseBranch: raw.baseBranch } : {}),
    ...(raw?.title !== undefined ? { title: raw.title } : {}),
  };
}

const NonEmptyCommandArray = Schema.NonEmptyArray(Schema.NonEmptyString);

const GateProfilesSchema = Schema.Record({
  key: Schema.NonEmptyString,
  value: NonEmptyCommandArray,
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

const FileReconciliationConfigSchema = Schema.Struct({
  mode: Schema.Literal("report_only", "warn"),
});

export const PhaxConfigSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  version: Schema.Literal(1),
  project: Schema.Struct({
    name: Schema.NonEmptyString,
    type: Schema.Literal("single-package", "monorepo"),
  }),
  state: Schema.Struct({
    root: Schema.NonEmptyString,
  }),
  editor: Schema.optional(
    Schema.Struct({
      command: Schema.NonEmptyString,
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
  gateProfiles: GateProfilesSchema,
  workspaces: Schema.optional(Schema.Array(WorkspaceSchema)),
});

export type PhaxConfig = Schema.Schema.Type<typeof PhaxConfigSchema>;
export type PhaxConfigWorkspace = Schema.Schema.Type<typeof WorkspaceSchema>;

export const DEFAULT_EXTRACT_MODEL = "claude-haiku-4-5-20251001";

export interface ResolvedConfig {
  readonly raw: PhaxConfig;
  readonly stateRoot: string;
  readonly repoRoot: string;
  readonly editorCommand: string;
  readonly maxFixAttempts: number;
  readonly extractPlanModel: string;
  readonly extractPlanEffort: Effort;
  readonly fileReconciliationMode: "report_only" | "warn";
  readonly security: ResolvedSecurityConfig;
  readonly publish: ResolvedPublishConfig;
}

export type { ResolvedSecurityConfig };

export const decodePhaxConfig = Schema.decodeUnknownEither(PhaxConfigSchema, {
  onExcessProperty: "error",
});
