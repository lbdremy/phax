// The two documents of an architecture call: the request phax writes on an
// architecture provider's stdin and the report the provider prints. Both are
// born with `$schema`, every key required and any other key refused. phax
// writes the request and never reads it back; it reads the report by its own
// `$schema` (readArchitectureReport in persisted.ts) and renders its body as
// is, then its parts.
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

// The first rule a glob breaks, as a message, or undefined for a glob in phax's
// dialect. Syntax only: src/domain/architecture/glob.ts matches it. Exported so
// a caller that checks a glob before a full decode words its refusal the same way.
export function architectureGlobProblem(glob: string): string | undefined {
  const quoted = JSON.stringify(glob);
  if (glob.startsWith("/")) return `${quoted} starts with /`;
  if (glob.includes("\\")) return `${quoted} contains a backslash`;
  if (glob.includes("{") || glob.includes("}")) return `${quoted} uses braces`;
  // phax prints a glob as a Markdown code span on one line: a backtick or a
  // control character would break out of it.
  if (glob.includes("`")) return `${quoted} contains a backtick`;
  if ([...glob].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
    return `${quoted} contains a control character`;
  }
  for (const segment of glob.split("/")) {
    if (segment === "") return `${quoted} has an empty segment`;
    if (segment === "." || segment === "..") return `${quoted} has a ${segment} segment`;
    if (segment.includes("**") && segment !== "**") return `${quoted} uses ** inside a segment`;
  }
  return undefined;
}

/**
 * phax's glob dialect, in words: both JSON Schemas that admit globs (the
 * report's parts and phax.json's globs bounds) restate it.
 */
export const GLOB_DIALECT =
  "working-tree-root-relative POSIX paths, matched case-sensitively and the same on every host. `**` as a whole segment matches zero or more segments, `*` matches zero or more characters within a segment, `?` matches one character other than `/`. A leading dot is not special. Every other character is literal, `[`, `]` and `!` included. Braces are refused. A glob covers files: write `src/core/**` to cover a directory.";

/** One glob in phax's dialect: a report part's globs and a phax.json globs bound share it. */
export const ArchitectureGlobSchema = Schema.NonEmptyString.pipe(
  Schema.filter((glob) => architectureGlobProblem(glob), {
    jsonSchema: {
      description:
        "Checked by phax's parser: no leading /, backslash, brace, backtick or control character, no empty, . or .. segment, and ** only as a whole segment.",
    },
  }),
);

function firstRepeatedPartId(parts: ReadonlyArray<{ readonly id: string }>): string | undefined {
  const seen = new Set<string>();
  for (const { id } of parts) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

/** One part of the code an architecture report describes. */
/** A part id: a kebab-case slug, as a report declares it and a phax.json bound names it. */
export const ArchitecturePartIdSchema = Schema.NonEmptyString.pipe(
  Schema.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: () => "a kebab-case slug: lowercase letters and digits, single hyphens between",
  }),
);

const ArchitecturePartSchema = Schema.Struct({
  id: ArchitecturePartIdSchema.annotations({
    description:
      "The part's stable id, a kebab-case slug unique within the report. A phax.json bound names a part by it.",
  }),
  name: Schema.NonEmptyString.annotations({
    description: "The part's name, shown to the agent and never interpreted by phax.",
  }),
  description: Schema.NonEmptyString.annotations({
    description: "One sentence on what the part holds.",
  }),
  globs: Schema.NonEmptyArray(ArchitectureGlobSchema).annotations({
    description: `The files the part holds, as globs: ${GLOB_DIALECT}`,
  }),
});

/**
 * An `architecture-report` document: what an architecture provider prints on
 * stdout. Exactly these three keys; any other key is refused.
 */
export const ArchitectureReportFileSchema = Schema.Struct({
  $schema: schemaUrlField("architecture-report"),
  body: Schema.NonEmptyString.annotations({
    description:
      "Markdown for the agent to read. phax prints it as is, before the parts, and never parses it.",
  }),
  parts: Schema.Array(ArchitecturePartSchema).pipe(
    Schema.filter(
      (parts) => {
        const repeated = firstRepeatedPartId(parts);
        return repeated === undefined
          ? undefined
          : `part id ${JSON.stringify(repeated)} is used twice`;
      },
      {
        jsonSchema: {
          description:
            "The parts of the code the report describes, possibly empty. No two parts share an id (checked by phax's parser). A part names no model or effort: the repository's owner binds those in phax.json.",
        },
      },
    ),
  ),
});

export type ArchitectureReportFile = Schema.Schema.Type<typeof ArchitectureReportFileSchema>;

/** An architecture report, without `$schema`. */
export type ArchitectureReport = Omit<ArchitectureReportFile, "$schema">;

export const decodeArchitectureReportFile = Schema.decodeUnknownEither(
  ArchitectureReportFileSchema,
  { onExcessProperty: "error" },
);
