import { Schema } from "effect";

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
      backend: Schema.Literal("claude-code-cli"),
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
  readonly backend: "claude-code-cli";
  readonly maxFixAttempts: number;
  readonly extractPlanModel: string;
  readonly extractPlanEffort: Effort;
  readonly fileReconciliationMode: "report_only" | "warn";
}

export const decodePhaxConfig = Schema.decodeUnknownEither(PhaxConfigSchema, {
  onExcessProperty: "error",
});
