// The two documents of an architecture call: the request phax writes on an
// architecture provider's stdin and the report the provider prints. Both are
// born with `$schema`, every key required and any other key refused. phax
// writes the request and never reads it back; it reads the report by its own
// `$schema` (readArchitectureReport in persisted.ts) and prints its body as is.
import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

// ── architecture request

/**
 * An `architecture-request` document: what phax writes on an architecture
 * provider's stdin. Exactly these two keys; any other key is refused.
 */
export const ArchitectureRequestFileSchema = Schema.Struct({
  $schema: schemaUrlField("architecture-request"),
  files: Schema.NullOr(Schema.NonEmptyArray(Schema.NonEmptyString)).annotations({
    description:
      "Null for the whole repository. Otherwise working-tree-root-relative paths, deduplicated, in the order given, never checked for existence.",
  }),
});

export type ArchitectureRequestFile = Schema.Schema.Type<typeof ArchitectureRequestFileSchema>;

/** An architecture request, without `$schema`. */
export type ArchitectureRequest = Omit<ArchitectureRequestFile, "$schema">;

export const decodeArchitectureRequestFile = Schema.decodeUnknownEither(
  ArchitectureRequestFileSchema,
  { onExcessProperty: "error" },
);

// ── architecture report

/**
 * An `architecture-report` document: what an architecture provider prints on
 * stdout. Exactly these two keys; any other key is refused.
 */
export const ArchitectureReportFileSchema = Schema.Struct({
  $schema: schemaUrlField("architecture-report"),
  body: Schema.NonEmptyString.annotations({
    description: "Markdown for the agent to read. phax prints it as is and never parses it.",
  }),
});

export type ArchitectureReportFile = Schema.Schema.Type<typeof ArchitectureReportFileSchema>;

export const decodeArchitectureReportFile = Schema.decodeUnknownEither(
  ArchitectureReportFileSchema,
  { onExcessProperty: "error" },
);
