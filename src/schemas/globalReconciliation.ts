import { Schema } from "effect";

const GlobalFileStatusSchema = Schema.Union(
  Schema.Literal("matched"),
  Schema.Literal("missing"),
  Schema.Literal("unplanned"),
  Schema.Literal("extra-touch"),
  Schema.Literal("partially-matched"),
  Schema.Literal("action-mismatch"),
  Schema.Literal("deleted"),
  Schema.Literal("renamed"),
  Schema.Literal("unknown"),
);

const ActualActionSchema = Schema.Union(
  Schema.Literal("added"),
  Schema.Literal("modified"),
  Schema.Literal("deleted"),
  Schema.Literal("renamed"),
);

const ExpectedActionSchema = Schema.Union(Schema.Literal("create"), Schema.Literal("edit"));

const GlobalFileEntrySchema = Schema.Struct({
  path: Schema.String,
  plannedInPhases: Schema.Array(Schema.String),
  touchedInPhases: Schema.Array(Schema.String),
  expectedActions: Schema.Array(ExpectedActionSchema),
  actualActions: Schema.Array(ActualActionSchema),
  status: GlobalFileStatusSchema,
  planned: Schema.Boolean,
  unplanned: Schema.Boolean,
  missing: Schema.Boolean,
  extraTouch: Schema.Boolean,
  attention: Schema.Union(Schema.Literal("ok"), Schema.Literal("review")),
});

export const GlobalFileReconciliationSchema = Schema.Struct({
  files: Schema.Array(GlobalFileEntrySchema),
  unplanned: Schema.Array(GlobalFileEntrySchema),
  missing: Schema.Array(GlobalFileEntrySchema),
  attentionPoints: Schema.Array(GlobalFileEntrySchema),
});

export type GlobalFileEntry = Schema.Schema.Type<typeof GlobalFileEntrySchema>;
export type GlobalFileReconciliation = Schema.Schema.Type<typeof GlobalFileReconciliationSchema>;

export const decodeGlobalFileReconciliation = Schema.decodeUnknownEither(
  GlobalFileReconciliationSchema,
);
