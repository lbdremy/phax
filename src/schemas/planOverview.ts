// The `plan-overview` document: what `phax plans overview <plan> --json`
// prints, never saved. Born at 0.34.0 with `$schema`, then exactly the fields
// of phax's plan overview in their order (src/domain/plan/overview.ts, whose
// type tests/type/schemasPackage.ts holds equal to this one); every key is
// required and any other key is refused. Imports only `effect` and schema
// modules, because the schemas package publishes it.
import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";
import { TestLineSchema } from "./testLine.js";

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

const FrontmatterSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("decoded"), status: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("undecodable"), problem: Schema.String }),
]).annotate({
  description:
    "The plan's frontmatter: decoded with its status, absent, or a block that does not decode.",
});

const ArchitectureSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("parts") }),
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("failed"), message: Schema.String }),
]).annotate({
  description:
    "What the architecture provider came to; the parts themselves are in each placement.",
});

const AcceptanceRoleSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("acceptance"), passedBy: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("passing"), acceptancePhase: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("none") }),
]);

const PlacementSchema = Schema.Struct({
  part: Schema.NullOr(Schema.String).annotate({
    description: "The architecture part holding these files, or null for the files no part holds.",
  }),
  files: Schema.Array(Schema.String),
});

const PhaseSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  mode: Schema.Literals(["headless", "interactive"]),
  acceptanceRole: AcceptanceRoleSchema,
  placement: Schema.Array(PlacementSchema),
  testLines: Schema.Array(TestLineSchema),
});

const CoverageSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("criteria"),
    spec: Schema.String,
    slug: Schema.String,
    criteria: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        lines: Schema.Array(
          Schema.Struct({
            phase: Schema.String,
            loop: Schema.Literals(["acceptance", "in-phase"]),
          }),
        ),
      }),
    ),
    uncovered: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("no-source-spec") }),
  Schema.Struct({ kind: Schema.Literal("frontmatter-undecodable"), message: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("no-criterion-ids"),
    spec: Schema.String,
    reason: Schema.Literals(["not-a-spec-path", "no-sidecar", "not-found", "unreadable"]),
    message: Schema.String,
  }),
]);

/** A `plan-overview` document: the answer of `phax plans overview --json`. */
export const PlanOverviewFileSchema = Schema.Struct({
  $schema: schemaUrlField("plan-overview"),
  plan: Schema.String.annotate({ description: "The plan path as the caller typed it." }),
  name: Schema.String,
  title: Schema.String,
  frontmatter: FrontmatterSchema,
  sourceSpec: Schema.NullOr(Schema.Struct({ path: Schema.String, slug: Schema.String })),
  architecture: ArchitectureSchema,
  phases: Schema.Array(PhaseSchema),
  coverage: CoverageSchema,
}).annotate(strictKeys);

export type PlanOverviewFile = Schema.Schema.Type<typeof PlanOverviewFileSchema>;
/** A plan overview without `$schema`. */
export type PlanOverviewDocument = Omit<PlanOverviewFile, "$schema">;

export const decodePlanOverviewFile = Schema.decodeUnknownResult(PlanOverviewFileSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

export const encodePlanOverviewFile = Schema.encodeSync(PlanOverviewFileSchema);
