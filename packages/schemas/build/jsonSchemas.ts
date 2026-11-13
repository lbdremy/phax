// Pure renderer behind scripts/schemas-json.ts: one draft-07 JSON Schema per
// persisted format, rendered from the schema its parse function decodes with.
// A check JSON Schema cannot express fails its format rather than being
// dropped: effect's generator renders a filter without toJsonSchema as nothing.
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
  revisionRecordManifestFormat,
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
import { acceptanceRequestFormat, oracleRequestFormat } from "../src/formats/acceptanceRequest.js";
import {
  artifactStatusFormat,
  planLintFormat,
  planOverviewFormat,
} from "../src/formats/commandAnswers.js";
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
  readonly schema: Schema.Top;
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
    readonly shape: { readonly schema: Schema.Top };
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
  "revision-record-manifest": revisionRecordManifestFormat,
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
  "acceptance-request": acceptanceRequestFormat,
  "artifact-status": artifactStatusFormat,
  "plan-overview": planOverviewFormat,
  "plan-lint": planLintFormat,
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
  "revision-record-manifest": "error",
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
  "acceptance-request": "error",
  "artifact-status": "error",
  "plan-overview": "error",
  "plan-lint": "error",
  "record-manifest": "error",
};

function tableEntry(
  format: JsonSchemaFormatId,
  label: string,
  schema: Schema.Top,
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

/** True when a check renders to JSON Schema: it, or every check of its group, has `toJsonSchema`. */
function isExpressible(check: SchemaAST.Check<never>): boolean {
  if (check.annotations?.toJsonSchema !== undefined) return true;
  // A FilterGroup, the only check with checks of its own, renders when each of them does.
  return "checks" in check && check.checks.every(isExpressible);
}

function child(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

/**
 * The path of every check JSON Schema would silently drop: a filter with no
 * `toJsonSchema` annotation. Effect's built-in checks (`isMinLength`,
 * `isPattern`, `isInt`, …) carry one, and a brand adds no check. A suspended
 * schema is followed once; an encoding's targets are walked at the node's
 * path. The root is reported as `(root)`, an array element as `[]`, a record
 * value as `*`.
 */
export function findJsonSchemaGaps(schema: Schema.Top): string[] {
  const gaps = new Set<string>();
  const followed = new Set<SchemaAST.AST>();

  function visit(ast: SchemaAST.AST, path: string): void {
    if (ast.checks?.some((check) => !isExpressible(check)) === true) {
      gaps.add(path === "" ? "(root)" : path);
    }
    for (const link of ast.encoding ?? []) visit(link.to, path);
    if (SchemaAST.isObjects(ast)) {
      for (const property of ast.propertySignatures) {
        visit(property.type, child(path, String(property.name)));
      }
      for (const index of ast.indexSignatures) {
        visit(index.parameter, child(path, "<key>"));
        visit(index.type, child(path, "*"));
      }
    } else if (SchemaAST.isArrays(ast)) {
      ast.elements.forEach((element, position) => visit(element, `${path}[${position}]`));
      for (const rest of ast.rest) visit(rest, `${path}[]`);
    } else if (SchemaAST.isUnion(ast)) {
      for (const member of ast.types) visit(member, path);
    } else if (SchemaAST.isSuspend(ast)) {
      if (followed.has(ast)) return;
      followed.add(ast);
      visit(ast.thunk(), path);
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
        reason: `JSON Schema cannot express the check at ${gaps.join(", ")} — give it a toJsonSchema annotation`,
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

/** The frozen copy of the shipped JSON Schemas, repo-relative. */
export const SHIPPED_JSON_PATH = "packages/schemas/shipped-json.json";

/** `shipped-json.json`'s content: file name under `packages/schemas/json/` → exact file content. */
export type ShippedJson = Readonly<Record<string, string>>;

/** The formats whose documents `record-manifest.schema.json` reads, one per member of its union. */
export const RECORD_MANIFEST_MEMBERS: ReadonlyArray<FormatId> = [
  "phase-record-manifest",
  "authoring-record-manifest",
  "decision-record-manifest",
  "review-record-manifest",
  "revision-record-manifest",
];

/**
 * True when the table entry `format` ships its generated schema rather than
 * its `shipped-json.json` entry: its format has a `next` snapshot, or, for
 * `record-manifest`, one of its members does.
 */
export function shipsGenerated(format: string, nextFormats: ReadonlySet<string>): boolean {
  return format === "record-manifest"
    ? RECORD_MANIFEST_MEMBERS.some((member) => nextFormats.has(member))
    : nextFormats.has(format);
}

/** `shipped-json.json` as the build reads it and `--write` writes it: entries sorted by file name. */
export function renderShippedJson(shipped: ShippedJson): string {
  const sorted = Object.fromEntries(
    Object.entries(shipped).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** Parses `shipped-json.json`: an object of strings, else a reason it is not one. */
export function parseShippedJson(text: string): ShippedJson | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "not a JSON object";
  }
  const shipped: Record<string, string> = {};
  for (const [fileName, content] of Object.entries(parsed)) {
    if (typeof content !== "string") return `${fileName} is not a string`;
    shipped[fileName] = content;
  }
  return shipped;
}

/**
 * What the build ships under `packages/schemas/json/`: every entry's
 * `shipped-json.json` content, verbatim, except for a format that ships its
 * generated schema (`shipsGenerated`) or has no entry, which is rendered.
 * Only those are rendered, so a failure can name only them.
 */
export function shippedJsonSchemas(
  table: ReadonlyArray<JsonSchemaFormat>,
  shipped: ShippedJson,
  nextFormats: ReadonlySet<string>,
): {
  readonly files: ReadonlyMap<string, string>;
  readonly failures: ReadonlyArray<JsonSchemaFailure>;
} {
  const frozen = (entry: JsonSchemaFormat): string | undefined =>
    shipsGenerated(entry.format, nextFormats) ? undefined : shipped[entry.fileName];
  const rendered = renderJsonSchemas(table.filter((entry) => frozen(entry) === undefined));
  const files = new Map<string, string>();
  for (const entry of table) {
    const content = frozen(entry) ?? rendered.files.get(entry.fileName);
    if (content !== undefined) files.set(entry.fileName, content);
  }
  return { files, failures: rendered.failures };
}
