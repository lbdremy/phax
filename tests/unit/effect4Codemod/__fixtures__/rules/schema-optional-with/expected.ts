import { Schema } from "effect";

/** The options a run may set; an absent key keeps the project's own setting. */
export const RunOptions = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  maxAttempts: Schema.optionalKey(Schema.Number),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
});
