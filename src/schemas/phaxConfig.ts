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
    }),
  ),
  commands: Schema.optional(
    Schema.Struct({
      setup: Schema.optional(NonEmptyCommandArray),
      cleanup: Schema.optional(NonEmptyCommandArray),
    }),
  ),
  gateProfiles: GateProfilesSchema,
  workspaces: Schema.optional(Schema.Array(WorkspaceSchema)),
});

export type PhaxConfig = Schema.Schema.Type<typeof PhaxConfigSchema>;
export type PhaxConfigWorkspace = Schema.Schema.Type<typeof WorkspaceSchema>;

export interface ResolvedConfig {
  readonly raw: PhaxConfig;
  readonly stateRoot: string;
  readonly repoRoot: string;
  readonly editorCommand: string;
  readonly backend: "claude-code-cli";
  readonly maxFixAttempts: number;
}

export const decodePhaxConfig = Schema.decodeUnknownEither(PhaxConfigSchema, {
  onExcessProperty: "error",
});
