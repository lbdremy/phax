import { Schema } from "effect";

export const ScopesResponseSchema = Schema.Struct({
  closed: Schema.Array(Schema.NonEmptyString),
});

export type ScopesResponse = Schema.Schema.Type<typeof ScopesResponseSchema>;

export const decodeScopesResponse = Schema.decodeUnknownEither(ScopesResponseSchema);
