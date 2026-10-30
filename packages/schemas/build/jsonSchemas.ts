// Pure renderer behind scripts/schemas-json.ts: one draft-07 JSON Schema per
// persisted format, rendered from the schema its parse function decodes with.
// A refinement JSON Schema cannot express fails its format rather than being
// dropped: effect's JSONSchema renders an unannotated refinement as its base.
import { SchemaAST, type Schema } from "effect";
import { RecordManifestSchema } from "../../../src/schemas/authoringRecord.js";
import {
  renderPublishedJsonSchema,
  type Excess,
} from "../../../src/schemas/publishedJsonSchema.js";
import { FORMAT_IDS, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { briefRecordFormat, briefRequestFormat } from "../src/formats/brief.js";
import {
  authoringRecordManifestFormat,
  decisionRecordManifestFormat,
  phaseRecordManifestFormat,
  reviewRecordManifestFormat,
} from "../src/formats/recordManifests.js";
import {
  gateAttributionFormat,
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
import {
  architectureReportFormat,
  architectureRequestFormat,
} from "../src/formats/architecture.js";
import {
  firstReadingFormat,
  interactiveHandoffFormat,
  interactiveSessionFormat,
  reviewStopFormat,
  runListFormat,
} from "../src/formats/interactive.js";
import { oracleRequestFormat } from "../src/formats/oracleRequest.js";
import { briefReportFormat, gateReportFormat } from "../src/formats/reports.js";
import {
  decideVerdictsFormat,
  handDecisionAnswerFormat,
  phaxPlanExtractionFormat,
  planHandDecisionAnswerFormat,
  specHandDecisionAnswerFormat,
} from "../src/formats/answers.js";
import {
  codeReviewFormat,
  complianceReviewFormat,
  costLedgerFormat,
  phaseStatusFormat,
  phaxPlanFormat,
  registryFormat,
  runStatusFormat,
} from "../src/formats/runDirectory.js";

export type { Excess };

/** One file of `packages/schemas/json/`. */
export interface JsonSchemaFormat {
  /** A format id, or `record-manifest` for the union of the three manifests. */
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
  "spec-document": specDocumentFormat,
  "plan-document": planDocumentFormat,
  "plan-approval-record": planApprovalRecordFormat,
  "spec-approval-record": specApprovalRecordFormat,
  "gate-request": gateRequestFormat,
  "brief-request": briefRequestFormat,
  "brief-record": briefRecordFormat,
  "gate-report": gateReportFormat,
  "brief-report": briefReportFormat,
  "hand-decision-answer": handDecisionAnswerFormat,
  "decision-record-manifest": decisionRecordManifestFormat,
  "review-record-manifest": reviewRecordManifestFormat,
  "code-review": codeReviewFormat,
  "cost-ledger": costLedgerFormat,
  "architecture-request": architectureRequestFormat,
  "architecture-report": architectureReportFormat,
  "oracle-request": oracleRequestFormat,
  "first-reading": firstReadingFormat,
  "interactive-handoff": interactiveHandoffFormat,
  "interactive-session": interactiveSessionFormat,
  "review-stop": reviewStopFormat,
  "run-list": runListFormat,
  "decide-verdicts": decideVerdictsFormat,
  "phax-plan-extraction": phaxPlanExtractionFormat,
  "spec-hand-decision-answer": specHandDecisionAnswerFormat,
  "plan-hand-decision-answer": planHandDecisionAnswerFormat,
};

// phax's decoders for the run directory's status files, the registry and the
// timeline files keep effect's default and ignore unknown keys; every other
// decoder passes `onExcessProperty: "error"`.
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
  "spec-document": "error",
  "plan-document": "error",
  "plan-approval-record": "error",
  "spec-approval-record": "error",
  "gate-request": "error",
  "brief-request": "error",
  "brief-record": "error",
  "gate-report": "error",
  "brief-report": "error",
  "hand-decision-answer": "error",
  "decision-record-manifest": "error",
  "review-record-manifest": "error",
  "code-review": "error",
  "cost-ledger": "error",
  "architecture-request": "error",
  "architecture-report": "error",
  "oracle-request": "error",
  "first-reading": "error",
  "interactive-handoff": "error",
  "interactive-session": "error",
  "review-stop": "error",
  "run-list": "error",
  "decide-verdicts": "error",
  "phax-plan-extraction": "error",
  "spec-hand-decision-answer": "error",
  "plan-hand-decision-answer": "error",
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
      files.set(
        entry.fileName,
        `${JSON.stringify(
          renderPublishedJsonSchema({
            schema: entry.schema,
            title: entry.title,
            excess: entry.excess,
          }),
          null,
          2,
        )}\n`,
      );
    } catch (error) {
      failures.push({
        format: entry.format,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { files, failures };
}
