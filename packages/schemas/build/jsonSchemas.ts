// Pure renderer behind scripts/schemas-json.ts: one draft-07 JSON Schema per
// persisted format, rendered from the schema its parse function decodes with.
// A refinement JSON Schema cannot express fails its format rather than being
// dropped: effect's JSONSchema renders an unannotated refinement as its base.
import { JSONSchema, SchemaAST, type Schema } from "effect";
import { RecordManifestSchema } from "../../../src/schemas/authoringRecord.js";
import { FORMAT_IDS, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { briefAnswerFormat, briefRecordFormat, briefRequestFormat } from "../src/formats/brief.js";
import {
  authoringRecordManifestFormat,
  phaseRecordManifestFormat,
} from "../src/formats/recordManifests.js";
import {
  gateAttributionFormat,
  gateDiagnosticsFormat,
  gateRequestFormat,
  phaseFileReconciliationFormat,
} from "../src/formats/recordTimeline.js";
import {
  planApprovalRecordFormat,
  planApprovalsFormat,
  planDocumentFormat,
  specApprovalRecordFormat,
  specApprovalsFormat,
  specDocumentFormat,
} from "../src/formats/repository.js";
import { briefReportFormat, gateReportFormat } from "../src/formats/reports.js";
import {
  complianceReviewFormat,
  phaseStatusFormat,
  phaxPlanFormat,
  registryFormat,
  runStatusFormat,
} from "../src/formats/runDirectory.js";

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

/**
 * How a format's decoder treats a key its schema does not name: `error`
 * rejects it, `ignore` accepts and drops it. The JSON Schema follows suit.
 */
export type Excess = "error" | "ignore";

/** One file of `packages/schemas/json/`. */
export interface JsonSchemaFormat {
  /** A format id, or `record-manifest` for the union of the two manifests. */
  readonly format: string;
  readonly fileName: string;
  readonly title: string;
  readonly schema: Schema.Schema.Any;
  readonly excess: Excess;
}

export interface JsonSchemaFailure {
  readonly format: string;
  readonly reason: string;
}

type JsonSchemaFormatId = FormatId | "record-manifest";

interface CurrentShape {
  readonly label: string;
  /** The frozen pre-schema shape; null for a format born with `$schema`. */
  readonly preSchema?: object | null;
  /** The released shapes the format has a frozen decoder for, by release. */
  readonly releases: ReadonlyArray<readonly [string, unknown]>;
  readonly current: {
    readonly name: string;
    readonly shape: { readonly schema: Schema.Schema.Any };
  };
}

/** Every format's label, released shapes and current shape, by format id. */
export const FORMAT_DEFINITIONS: { readonly [F in FormatId]: CurrentShape } = {
  registry: registryFormat,
  "run-status": runStatusFormat,
  "phase-status": phaseStatusFormat,
  "phax-plan": phaxPlanFormat,
  "compliance-review": complianceReviewFormat,
  "plan-approvals": planApprovalsFormat,
  "spec-approvals": specApprovalsFormat,
  "phase-record-manifest": phaseRecordManifestFormat,
  "authoring-record-manifest": authoringRecordManifestFormat,
  "gate-attribution": gateAttributionFormat,
  "phase-file-reconciliation": phaseFileReconciliationFormat,
  "gate-diagnostics": gateDiagnosticsFormat,
  "spec-document": specDocumentFormat,
  "plan-document": planDocumentFormat,
  "plan-approval-record": planApprovalRecordFormat,
  "spec-approval-record": specApprovalRecordFormat,
  "gate-request": gateRequestFormat,
  "brief-request": briefRequestFormat,
  "brief-answer": briefAnswerFormat,
  "brief-record": briefRecordFormat,
  "gate-report": gateReportFormat,
  "brief-report": briefReportFormat,
};

// phax's decoders for the run directory's status files, the registry and the
// timeline files keep effect's default and ignore unknown keys, as does the
// brief answer a provider prints; every other decoder passes
// `onExcessProperty: "error"`.
const EXCESS: { readonly [F in JsonSchemaFormatId]: Excess } = {
  registry: "ignore",
  "run-status": "ignore",
  "phase-status": "ignore",
  "phax-plan": "error",
  "compliance-review": "error",
  "plan-approvals": "error",
  "spec-approvals": "error",
  "phase-record-manifest": "error",
  "authoring-record-manifest": "error",
  "gate-attribution": "ignore",
  "phase-file-reconciliation": "ignore",
  "gate-diagnostics": "ignore",
  "spec-document": "error",
  "plan-document": "error",
  "plan-approval-record": "error",
  "spec-approval-record": "error",
  "gate-request": "error",
  "brief-request": "error",
  "brief-answer": "ignore",
  "brief-record": "error",
  "gate-report": "error",
  "brief-report": "error",
  "record-manifest": "error",
};

function tableEntry(
  format: JsonSchemaFormatId,
  label: string,
  schema: Schema.Schema.Any,
): JsonSchemaFormat {
  return {
    format,
    fileName: `${format}.schema.json`,
    title: `phax ${label}`,
    schema,
    excess: EXCESS[format],
  };
}

/** Every file the build writes: one per format id, then the record-manifest union. */
export const JSON_SCHEMA_FORMATS: ReadonlyArray<JsonSchemaFormat> = [
  ...FORMAT_IDS.map((id) =>
    tableEntry(id, FORMAT_DEFINITIONS[id].label, FORMAT_DEFINITIONS[id].current.shape.schema),
  ),
  tableEntry("record-manifest", "record manifest", RecordManifestSchema),
];

function hasJsonSchemaAnnotation(ast: SchemaAST.AST): boolean {
  return Object.hasOwn(ast.annotations, SchemaAST.JSONSchemaAnnotationId);
}

function isBrand(ast: SchemaAST.Refinement): boolean {
  return Object.hasOwn(ast.annotations, SchemaAST.BrandAnnotationId);
}

function child(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

/**
 * The path of every refinement JSON Schema would silently drop: one with no
 * `jsonSchema` annotation that is not a brand. Effect's built-in refinements
 * (`minLength`, `pattern`, `int`, …) carry their annotation. A suspended
 * schema is followed once; a non-refinement node with its own `jsonSchema`
 * annotation is rendered from it, so its inside is not walked. The root is
 * reported as `(root)`, an array element as `[]`, a record value as `*`.
 */
export function findJsonSchemaGaps(schema: Schema.Schema.Any): string[] {
  const gaps = new Set<string>();
  const followed = new Set<SchemaAST.AST>();

  function visit(ast: SchemaAST.AST, path: string): void {
    if (SchemaAST.isRefinement(ast)) {
      if (!hasJsonSchemaAnnotation(ast) && !isBrand(ast)) gaps.add(path === "" ? "(root)" : path);
      visit(ast.from, path);
    } else if (hasJsonSchemaAnnotation(ast)) {
      return;
    } else if (SchemaAST.isTypeLiteral(ast)) {
      for (const property of ast.propertySignatures) {
        visit(property.type, child(path, String(property.name)));
      }
      for (const index of ast.indexSignatures) {
        visit(index.parameter, child(path, "<key>"));
        visit(index.type, child(path, "*"));
      }
    } else if (SchemaAST.isTupleType(ast)) {
      ast.elements.forEach((element, position) => visit(element.type, `${path}[${position}]`));
      for (const rest of ast.rest) visit(rest.type, `${path}[]`);
    } else if (SchemaAST.isUnion(ast)) {
      for (const member of ast.types) visit(member, path);
    } else if (SchemaAST.isSuspend(ast)) {
      if (followed.has(ast)) return;
      followed.add(ast);
      visit(ast.f(), path);
    } else if (SchemaAST.isTransformation(ast)) {
      visit(ast.from, path);
      visit(ast.to, path);
    } else if (SchemaAST.isDeclaration(ast)) {
      for (const parameter of ast.typeParameters) visit(parameter, path);
    }
  }

  visit(schema.ast, "");
  return [...gaps];
}

/**
 * `JSONSchema.make` with the format's excess-property strategy, which only
 * `fromAST` takes, and the table's root title.
 */
function renderOne(entry: JsonSchemaFormat): Record<string, unknown> {
  const definitions: Record<string, JSONSchema.JsonSchema7> = {};
  const rendered: Record<string, unknown> = {
    ...JSONSchema.fromAST(entry.schema.ast, {
      definitions,
      target: "jsonSchema7",
      additionalPropertiesStrategy: entry.excess === "ignore" ? "allow" : "strict",
    }),
  };
  const { title: _ownTitle, ...body } = rendered;
  return {
    $schema: DRAFT_07,
    title: entry.title,
    ...(Object.keys(definitions).length > 0 ? { $defs: definitions } : {}),
    ...body,
  };
}

/**
 * Renders every entry. A format with a gap or a rendering error gets a
 * failure naming it and no file; every other format gets its file content.
 */
export function renderJsonSchemas(table: ReadonlyArray<JsonSchemaFormat>): {
  readonly files: ReadonlyMap<string, string>;
  readonly failures: ReadonlyArray<JsonSchemaFailure>;
} {
  const files = new Map<string, string>();
  const failures: JsonSchemaFailure[] = [];
  for (const entry of table) {
    const gaps = findJsonSchemaGaps(entry.schema);
    if (gaps.length > 0) {
      failures.push({
        format: entry.format,
        reason: `JSON Schema cannot express the refinement at ${gaps.join(", ")} — give it a jsonSchema annotation`,
      });
      continue;
    }
    try {
      files.set(entry.fileName, `${JSON.stringify(renderOne(entry), null, 2)}\n`);
    } catch (error) {
      failures.push({
        format: entry.format,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { files, failures };
}
