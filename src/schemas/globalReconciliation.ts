// `global-file-reconciliation.json`: the run's files across every phase. It has
// no `$schema` and no format id, so its older shape is not a frozen module
// under src/schemas/history/; it is the legacy schema below, which the decoder
// falls back to and lifts. `plans overlap --landed`, adjust-plan and
// review-code read it from live and archived runs.
import { Either, Schema } from "effect";

const ActualActionSchema = Schema.Union(
  Schema.Literal("added"),
  Schema.Literal("modified"),
  Schema.Literal("deleted"),
  Schema.Literal("renamed"),
);

const ExpectedActionSchema = Schema.Union(Schema.Literal("create"), Schema.Literal("edit"));

const LegacyGlobalFileStatusSchema = Schema.Union(
  Schema.Literal("matched"),
  Schema.Literal("missing"),
  Schema.Literal("unplanned"),
  Schema.Literal("optional-touched"),
  Schema.Literal("extra-touch"),
  Schema.Literal("partially-matched"),
  Schema.Literal("action-mismatch"),
  Schema.Literal("deleted"),
  Schema.Literal("renamed"),
  Schema.Literal("unknown"),
);

const GlobalFileStatusSchema = Schema.Union(
  LegacyGlobalFileStatusSchema,
  Schema.Literal("review-corrected"),
);

const legacyEntryFields = {
  path: Schema.String,
  plannedInPhases: Schema.Array(Schema.String),
  touchedInPhases: Schema.Array(Schema.String),
  optionalInPhases: Schema.Array(Schema.String),
  expectedActions: Schema.Array(ExpectedActionSchema),
  actualActions: Schema.Array(ActualActionSchema),
  planned: Schema.Boolean,
  unplanned: Schema.Boolean,
  missing: Schema.Boolean,
  extraTouch: Schema.Boolean,
  attention: Schema.Union(Schema.Literal("ok"), Schema.Literal("review")),
};

const GlobalFileEntrySchema = Schema.Struct({
  ...legacyEntryFields,
  reviewCorrectedInPhases: Schema.Array(Schema.String),
  status: GlobalFileStatusSchema,
});

export const GlobalFileReconciliationSchema = Schema.Struct({
  files: Schema.Array(GlobalFileEntrySchema),
  unplanned: Schema.Array(GlobalFileEntrySchema),
  missing: Schema.Array(GlobalFileEntrySchema),
  attentionPoints: Schema.Array(GlobalFileEntrySchema),
});

// The shape before review corrections: no `reviewCorrectedInPhases`, and no
// `review-corrected` status. Never edit it: archived runs carry this shape.
const LegacyGlobalFileEntrySchema = Schema.Struct({
  ...legacyEntryFields,
  status: LegacyGlobalFileStatusSchema,
});

const LegacyGlobalFileReconciliationSchema = Schema.Struct({
  files: Schema.Array(LegacyGlobalFileEntrySchema),
  unplanned: Schema.Array(LegacyGlobalFileEntrySchema),
  missing: Schema.Array(LegacyGlobalFileEntrySchema),
  attentionPoints: Schema.Array(LegacyGlobalFileEntrySchema),
});

export type GlobalFileEntry = Schema.Schema.Type<typeof GlobalFileEntrySchema>;
export type GlobalFileReconciliation = Schema.Schema.Type<typeof GlobalFileReconciliationSchema>;

const decodeCurrent = Schema.decodeUnknownEither(GlobalFileReconciliationSchema);
const decodeLegacy = Schema.decodeUnknownEither(LegacyGlobalFileReconciliationSchema);

type LegacyEntry = Schema.Schema.Type<typeof LegacyGlobalFileEntrySchema>;

function lifted(entry: LegacyEntry): GlobalFileEntry {
  return { ...entry, reviewCorrectedInPhases: [] };
}

/**
 * Reads a `global-file-reconciliation.json`: the current shape, else the
 * legacy shape lifted with `reviewCorrectedInPhases: []` on every entry. A
 * document neither reads fails with the current shape's error.
 */
export function decodeGlobalFileReconciliation(input: unknown) {
  const current = decodeCurrent(input);
  if (Either.isRight(current)) return current;
  const legacy = decodeLegacy(input);
  if (Either.isLeft(legacy)) return current;
  const { files, unplanned, missing, attentionPoints } = legacy.right;
  return Either.right<GlobalFileReconciliation>({
    files: files.map(lifted),
    unplanned: unplanned.map(lifted),
    missing: missing.map(lifted),
    attentionPoints: attentionPoints.map(lifted),
  });
}
