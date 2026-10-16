import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";

/**
 * `<stateRoot>/authoring/<authoringId>/session.json`: the provider session a
 * headless authoring ran in, kept so `phax artifact decide` can resume it.
 * Local state only — it never reaches the records branch. `retrySessionId` is
 * the corrective resume's session id, or null when the first answer landed.
 */
export const AuthoringSessionSchema = Schema.Struct({
  version: Schema.Literal(1),
  provider: ProviderIdSchema,
  sessionId: Schema.NonEmptyString,
  retrySessionId: Schema.NullOr(Schema.NonEmptyString),
  cwd: Schema.NonEmptyString,
});

export type AuthoringSession = Schema.Schema.Type<typeof AuthoringSessionSchema>;

export const decodeAuthoringSession = Schema.decodeUnknownEither(AuthoringSessionSchema, {
  onExcessProperty: "error",
});

export const encodeAuthoringSession = Schema.encodeSync(AuthoringSessionSchema);
