import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";

export const CodeReviewSessionSchema = Schema.Struct({
  version: Schema.Literal(1),
  shortName: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  provider: ProviderIdSchema,
  sessionId: Schema.NonEmptyString,
  worktreePath: Schema.NonEmptyString,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
});

export type CodeReviewSession = Schema.Schema.Type<typeof CodeReviewSessionSchema>;

export const decodeCodeReviewSession = Schema.decodeUnknownEither(CodeReviewSessionSchema, {
  onExcessProperty: "error",
});

export const encodeCodeReviewSession = Schema.encodeSync(CodeReviewSessionSchema);
