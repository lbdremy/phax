import { Schema } from "effect";
import type { PublicationRecord } from "../domain/publish/types.js";

const PushStatusSchema = Schema.Union(
  Schema.Literal("not_attempted"),
  Schema.Literal("pushed"),
  Schema.Literal("failed"),
);

const PrStatusSchema = Schema.Union(
  Schema.Literal("not_attempted"),
  Schema.Literal("created"),
  Schema.Literal("exists"),
  Schema.Literal("failed"),
);

export const PublicationSchema = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  provider: Schema.Literal("github"),
  remote: Schema.NonEmptyString,
  branch: Schema.NonEmptyString,
  baseBranch: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  pushStatus: PushStatusSchema,
  prStatus: PrStatusSchema,
  pullRequestUrl: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  createdAt: Schema.NonEmptyString,
  failureReason: Schema.optionalWith(Schema.String, { exact: true }),
});

export type Publication = Schema.Schema.Type<typeof PublicationSchema>;

// Compile-time check: Publication (schema type) must be assignable to PublicationRecord (domain type).
// This ensures the schema and domain stay in sync.
type AssertPublicationRecord = Publication extends PublicationRecord ? true : never;
const assertPublicationRecord: AssertPublicationRecord = true as const;
void assertPublicationRecord;

export const decodePublication = Schema.decodeUnknownEither(PublicationSchema);
export const encodePublication = Schema.encodeSync(PublicationSchema);
