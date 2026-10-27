// Every format's current shape, after phax writes $schema: named by its
// snapshots (`CURRENT_SHAPES`), `$schema` required, no `version`, a current
// snapshot beside an untouched pre-schema snapshot, and a frozen module
// pinned in history.lock.json — or, for a format born with $schema, neither.
// Also
// checks that phax's bridge and the package's `toLatest*` read every
// pre-schema document to the same value.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  FORMAT_DEFINITIONS,
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
} from "../../../packages/schemas/build/jsonSchemas.js";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import {
  UNKNOWN,
  parseArchitectureReport,
  parseArchitectureRequest,
  parseOracleRequest,
  parseFirstReading,
  parseInteractiveHandoff,
  parseInteractiveSession,
  parseReviewStop,
  parseRunList,
  parseAuthoringRecordManifest,
  parseBriefRecord,
  parseBriefReport,
  parseBriefRequest,
  parseComplianceReview,
  parseCodeReview,
  parseCostLedger,
  parseDecisionRecordManifest,
  parseReviewRecordManifest,
  parseGateAttribution,
  parseGateReport,
  parseGateRequest,
  parseDecideVerdicts,
  parseHandDecisionAnswer,
  parsePhaseFileReconciliation,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parsePlanApprovalRecord,
  parsePlanApprovals,
  parsePlanDocument,
  parseRegistry,
  parseRunStatus,
  parseSpecApprovalRecord,
  parseSpecApprovals,
  parseSpecDocument,
  toLatestArchitectureReport,
  toLatestArchitectureRequest,
  toLatestOracleRequest,
  toLatestFirstReading,
  toLatestInteractiveHandoff,
  toLatestInteractiveSession,
  toLatestReviewStop,
  toLatestRunList,
  toLatestAuthoringRecordManifest,
  toLatestBriefRecord,
  toLatestBriefReport,
  toLatestBriefRequest,
  toLatestComplianceReview,
  toLatestCodeReview,
  toLatestCostLedger,
  toLatestDecisionRecordManifest,
  toLatestReviewRecordManifest,
  toLatestGateAttribution,
  toLatestGateReport,
  toLatestGateRequest,
  toLatestDecideVerdicts,
  toLatestHandDecisionAnswer,
  toLatestPhaseFileReconciliation,
  toLatestPhaseRecordManifest,
  toLatestPhaseStatus,
  toLatestPhaxPlan,
  toLatestPlanApprovalRecord,
  toLatestPlanApprovals,
  toLatestPlanDocument,
  toLatestRegistry,
  toLatestRunStatus,
  toLatestSpecApprovalRecord,
  toLatestSpecApprovals,
  toLatestSpecDocument,
} from "../../../packages/schemas/src/index.js";
import {
  readBriefRecordFile,
  readBriefRequestFile,
  readComplianceReviewFile,
  readCodeReviewFile,
  readCostLedgerFile,
  readGateAttributionFile,
  readInteractiveSessionFile,
  readReviewStopFile,
  readPhaseFileReconciliationFile,
  readPhaseStatusFile,
  readPhaxPlanFile,
  readPlanApprovalsFile,
  readPlanDocumentFile,
  readPlanRecordFile,
  readRecordManifestFile,
  readRegistryFile,
  readRunStatusFile,
  readSpecApprovalsFile,
  readSpecDocumentFile,
  readSpecRecordFile,
} from "../../../src/schemas/persisted.js";
import { SURFACE_SUMMARY_PLACEHOLDER } from "../../../src/schemas/specDocument.js";
import {
  FORMAT_IDS,
  PRE_SCHEMA_FORMAT_IDS,
  SCHEMA_BORN_FORMAT_IDS,
  compareReleases,
  isRelease,
  type FormatId,
} from "../../../src/schemas/schemaUrl.js";
import { EXAMPLE_SURFACE_SUMMARY, preSchemaDocuments, validDocuments } from "./documents.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const snapshotsDir = join(repoRoot, "packages", "schemas", "snapshots");
const lock = JSON.parse(
  readFileSync(join(repoRoot, "packages", "schemas", "history.lock.json"), "utf8"),
) as Readonly<Record<string, string>>;

interface RenderedSchema {
  readonly required?: ReadonlyArray<string>;
  readonly properties?: Readonly<Record<string, { readonly pattern?: string }>>;
  readonly anyOf?: ReadonlyArray<RenderedSchema>;
}

/** The rendered JSON Schema's document shapes: each variant of a root union, else the root. */
function rendered(id: FormatId): ReadonlyArray<RenderedSchema> {
  const entry = JSON_SCHEMA_FORMATS.find((format) => format.format === id);
  if (entry === undefined) throw new Error(`no JSON Schema table entry for ${id}`);
  const { files, failures } = renderJsonSchemas([entry]);
  expect(failures).toEqual([]);
  const schema = JSON.parse(files.get(entry.fileName) ?? "null") as RenderedSchema;
  return schema.anyOf ?? [schema];
}

function readSnapshot(id: FormatId, name: string): string {
  return readFileSync(join(snapshotsDir, id, `${name}.schema.json`), "utf8");
}

/** `next` when the format has a next snapshot, else its highest release-named one. */
function snapshotCurrentName(id: FormatId): string {
  if (existsSync(join(snapshotsDir, id, "next.schema.json"))) return "next";
  const releases = readdirSync(join(snapshotsDir, id))
    .map((file) => file.slice(0, -".schema.json".length))
    .filter((name) => isRelease(name))
    .toSorted(compareReleases);
  const highest = releases.at(-1);
  if (highest === undefined) throw new Error(`${id}: no next or release-named snapshot`);
  return highest;
}

describe("every format's current shape", () => {
  it.each(FORMAT_IDS)("%s: is named by its snapshots", (id) => {
    expect(FORMAT_DEFINITIONS[id].current.name).toBe(CURRENT_SHAPES[id]);
    expect(CURRENT_SHAPES[id]).toBe(snapshotCurrentName(id));
  });

  it.each(FORMAT_IDS)("%s: requires $schema bound to its own id, and has no version", (id) => {
    for (const schema of rendered(id)) {
      expect(schema.required).toContain("$schema");
      expect(schema.properties?.["$schema"]?.pattern).toContain(`schemas\\/${id}\\/`);
      expect(schema.properties).not.toHaveProperty("version");
    }
  });

  it.each(PRE_SCHEMA_FORMAT_IDS)(
    "%s: its current snapshot exists and differs from its pre-schema one",
    (id) => {
      const current = CURRENT_SHAPES[id];
      expect(existsSync(join(snapshotsDir, id, `${current}.schema.json`))).toBe(true);
      expect(readSnapshot(id, current)).not.toBe(readSnapshot(id, "pre-schema"));
    },
  );

  it.each(PRE_SCHEMA_FORMAT_IDS)("%s: pins its frozen module in history.lock.json", (id) => {
    expect(lock[`src/schemas/history/${id}/pre-schema.ts`]).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(SCHEMA_BORN_FORMAT_IDS)(
    "%s: is born with $schema: no pre-schema slot, snapshot or frozen module, and a frozen module only per released shape",
    (id) => {
      expect(FORMAT_DEFINITIONS[id].preSchema).toBeNull();
      expect(existsSync(join(snapshotsDir, id, `${CURRENT_SHAPES[id]}.schema.json`))).toBe(true);
      expect(existsSync(join(snapshotsDir, id, "pre-schema.schema.json"))).toBe(false);
      expect(Object.keys(lock).filter((path) => path.includes(`/history/${id}/`))).toEqual(
        FORMAT_DEFINITIONS[id].releases.map(
          ([release]) => `src/schemas/history/${id}/${release}.ts`,
        ),
      );
    },
  );

  it.each(PRE_SCHEMA_FORMAT_IDS)("%s: has a pre-schema slot", (id) => {
    expect(FORMAT_DEFINITIONS[id].preSchema).not.toBeNull();
  });
});

/** The package's reading of one document, upgraded to its latest value. */
type PackageLatest = (input: unknown) => unknown;

function latest<V>(
  parse: (input: unknown) => { readonly ok: true; readonly value: V } | { readonly ok: false },
  toLatest: (value: V) => unknown,
): PackageLatest {
  return (input) => {
    const result = parse(input);
    if (!result.ok) throw new Error(`the package rejected ${JSON.stringify(input)}`);
    return toLatest(result.value);
  };
}

const PACKAGE_LATEST: { readonly [F in FormatId]: PackageLatest } = {
  registry: latest(parseRegistry, toLatestRegistry),
  "run-status": latest(parseRunStatus, toLatestRunStatus),
  "phase-status": latest(parsePhaseStatus, toLatestPhaseStatus),
  "phax-plan": latest(parsePhaxPlan, toLatestPhaxPlan),
  "compliance-review": latest(parseComplianceReview, toLatestComplianceReview),
  "plan-approvals": latest(parsePlanApprovals, toLatestPlanApprovals),
  "spec-approvals": latest(parseSpecApprovals, toLatestSpecApprovals),
  "phase-record-manifest": latest(parsePhaseRecordManifest, toLatestPhaseRecordManifest),
  "authoring-record-manifest": latest(
    parseAuthoringRecordManifest,
    toLatestAuthoringRecordManifest,
  ),
  "gate-attribution": latest(parseGateAttribution, toLatestGateAttribution),
  "phase-file-reconciliation": latest(
    parsePhaseFileReconciliation,
    toLatestPhaseFileReconciliation,
  ),
  "spec-document": latest(parseSpecDocument, toLatestSpecDocument),
  "plan-document": latest(parsePlanDocument, toLatestPlanDocument),
  "plan-approval-record": latest(parsePlanApprovalRecord, toLatestPlanApprovalRecord),
  "spec-approval-record": latest(parseSpecApprovalRecord, toLatestSpecApprovalRecord),
  "gate-request": latest(parseGateRequest, toLatestGateRequest),
  "brief-request": latest(parseBriefRequest, toLatestBriefRequest),
  "brief-record": latest(parseBriefRecord, toLatestBriefRecord),
  "gate-report": latest(parseGateReport, toLatestGateReport),
  "brief-report": latest(parseBriefReport, toLatestBriefReport),
  "hand-decision-answer": latest(parseHandDecisionAnswer, toLatestHandDecisionAnswer),
  "decision-record-manifest": latest(parseDecisionRecordManifest, toLatestDecisionRecordManifest),
  "review-record-manifest": latest(parseReviewRecordManifest, toLatestReviewRecordManifest),
  "cost-ledger": latest(parseCostLedger, toLatestCostLedger),
  "code-review": latest(parseCodeReview, toLatestCodeReview),
  "architecture-request": latest(parseArchitectureRequest, toLatestArchitectureRequest),
  "architecture-report": latest(parseArchitectureReport, toLatestArchitectureReport),
  "oracle-request": latest(parseOracleRequest, toLatestOracleRequest),
  "first-reading": latest(parseFirstReading, toLatestFirstReading),
  "interactive-handoff": latest(parseInteractiveHandoff, toLatestInteractiveHandoff),
  "interactive-session": latest(parseInteractiveSession, toLatestInteractiveSession),
  "review-stop": latest(parseReviewStop, toLatestReviewStop),
  "run-list": latest(parseRunList, toLatestRunList),
  "decide-verdicts": latest(parseDecideVerdicts, toLatestDecideVerdicts),
};

type BridgeReader = (file: string, input: unknown) => Either.Either<unknown, unknown>;

// phax never reads gate requests back. It reads a gate report or a brief
// report only as a provider's answer, through readGateReport and
// readBriefReport, which name no file, and a hand decision answer only as a
// decide session's final message, through decodeCurrentHandDecisionAnswer.
const BRIDGE_READERS: { readonly [F in FormatId]: BridgeReader | undefined } = {
  registry: readRegistryFile,
  "run-status": readRunStatusFile,
  "phase-status": readPhaseStatusFile,
  // The reader reports the shape it read beside the plan; the plan is the lift.
  "phax-plan": (file, input) => Either.map(readPhaxPlanFile(file, input), (read) => read.plan),
  "compliance-review": readComplianceReviewFile,
  "plan-approvals": readPlanApprovalsFile,
  "spec-approvals": readSpecApprovalsFile,
  "phase-record-manifest": readRecordManifestFile,
  "authoring-record-manifest": readRecordManifestFile,
  "gate-attribution": readGateAttributionFile,
  "phase-file-reconciliation": readPhaseFileReconciliationFile,
  "spec-document": readSpecDocumentFile,
  "plan-document": readPlanDocumentFile,
  "plan-approval-record": readPlanRecordFile,
  "spec-approval-record": readSpecRecordFile,
  "gate-request": undefined,
  "brief-request": readBriefRequestFile,
  "brief-record": readBriefRecordFile,
  "gate-report": undefined,
  "brief-report": undefined,
  "hand-decision-answer": undefined,
  "decision-record-manifest": readRecordManifestFile,
  "review-record-manifest": readRecordManifestFile,
  "cost-ledger": readCostLedgerFile,
  "code-review": readCodeReviewFile,
  // phax writes the architecture request and never reads it back; it reads the
  // architecture report only as a provider's answer, through
  // readArchitectureReport, which names no file.
  "architecture-request": undefined,
  "architecture-report": undefined,
  // phax writes the oracle request on the oracles provider's stdin and never
  // reads it back.
  "oracle-request": undefined,
  // phax reads the first reading and the interactive handoff only as a turn's
  // answer, through readFirstReadingAnswer and readInteractiveHandoffAnswer,
  // which name no file.
  "first-reading": undefined,
  "interactive-handoff": undefined,
  "interactive-session": readInteractiveSessionFile,
  "review-stop": readReviewStopFile,
  // phax writes the run list for `phax ls --json` and never reads it back.
  "run-list": undefined,
  // phax reads the verdicts file a person writes through
  // decodeCurrentDecideVerdicts, which names no file.
  "decide-verdicts": undefined,
};

const READ_BY_PHAX = FORMAT_IDS.filter((id) => BRIDGE_READERS[id] !== undefined);
// phax refuses every pre-schema phase status (it never recorded `base`); the
// package reads it with `base` Unknown. A pre-schema spec document recorded no
// surface summary: phax lifts the placeholder, the package `Unknown`. A
// pre-schema phax-plan stated no test lines: phax gives its phases no
// `testLines` key, the package `Unknown`. All three are covered below where
// they part.
const PRE_SCHEMA_READ_BY_PHAX = PRE_SCHEMA_FORMAT_IDS.filter(
  (id) =>
    BRIDGE_READERS[id] !== undefined &&
    id !== "phase-status" &&
    id !== "spec-document" &&
    id !== "phax-plan",
);
// A pre-schema phase status upgrades with `base` Unknown, a phax-written one
// keeps its base; a pre-schema spec document upgrades with each summary
// Unknown, a phax-written one keeps its own; a pre-schema phax-plan upgrades
// with `testLines` Unknown, a phax-written one keeps its lines: they never
// upgrade alike.
const UPGRADED_ALIKE = PRE_SCHEMA_FORMAT_IDS.filter(
  (id) => id !== "phase-status" && id !== "spec-document" && id !== "phax-plan",
);

/** Each phase without its `testLines` key. */
function phasesWithoutLines(phases: readonly object[]): object[] {
  return phases.map((phase) => {
    const { testLines: _lines, ...rest } = phase as Record<string, unknown>;
    return rest;
  });
}

describe("phax's bridge and the package agree", () => {
  it.each(PRE_SCHEMA_READ_BY_PHAX)(
    "%s: the bridge reads a pre-schema document as toLatest does",
    (id) => {
      const read = BRIDGE_READERS[id];
      if (read === undefined) throw new Error(`${id}: phax does not read it`);
      const document = preSchemaDocuments[id];
      expect(read(`/work/example-repo/${id}.json`, document)).toEqual(
        Either.right(PACKAGE_LATEST[id](document)),
      );
    },
  );

  it.each(READ_BY_PHAX)("%s: the bridge reads a phax-written document as toLatest does", (id) => {
    const read = BRIDGE_READERS[id];
    if (read === undefined) throw new Error(`${id}: phax does not read it`);
    const document = validDocuments[id];
    expect(read(`/work/example-repo/${id}.json`, document)).toEqual(
      Either.right(PACKAGE_LATEST[id](document)),
    );
  });

  // Where they part: a pre-schema plan sidecar beside a spec path never said
  // whether its plan completes the spec. The package keeps that as Unknown;
  // phax, which needs the fact, refuses the sidecar.
  it("plan-document: a pre-schema sidecar beside a spec path is Unknown to the package, refused by phax", () => {
    const document = {
      ...preSchemaDocuments["plan-document"],
      sourceSpec: "docs/specs/example.md",
    };
    expect(PACKAGE_LATEST["plan-document"](document)).toMatchObject({
      sourceSpec: "docs/specs/example.md",
      completesSpec: UNKNOWN,
    });
    const read = readPlanDocumentFile("/work/example-repo/plan-document.json", document);
    expect(Either.isLeft(read)).toBe(true);
    if (Either.isLeft(read)) expect(read.left.message).toContain("lacks completesSpec");
  });

  // Where they part: a pre-schema phase status never recorded the commit its
  // branch was created from. The package keeps that as Unknown; phax, which
  // needs the fact, refuses the status.
  it("phase-status: a pre-schema status is Unknown base to the package, refused by phax", () => {
    const document = preSchemaDocuments["phase-status"];
    expect(PACKAGE_LATEST["phase-status"](document)).toMatchObject({ base: UNKNOWN });
    const read = readPhaseStatusFile("/work/example-repo/phase-status.json", document);
    expect(Either.isLeft(read)).toBe(true);
    if (Either.isLeft(read)) expect(read.left.message).toContain("lacks base");
  });

  // Where they part: a pre-schema spec document recorded no surface summary.
  // The package never invents one and keeps each as Unknown; phax lifts the
  // fixed placeholder, which approve and complete then refuse.
  it("spec-document: a pre-schema document's summaries are Unknown to the package, the placeholder to phax", () => {
    const document = preSchemaDocuments["spec-document"];
    expect(PACKAGE_LATEST["spec-document"](document)).toMatchObject({
      surface: [{ summary: UNKNOWN }],
    });
    const read = readSpecDocumentFile("/work/example-repo/spec-document.json", document);
    expect(Either.isRight(read)).toBe(true);
    if (Either.isRight(read)) {
      expect(read.right).toMatchObject({ surface: [{ summary: SURFACE_SUMMARY_PLACEHOLDER }] });
    }
    // A phax-written document keeps the summary it recorded, in either reading.
    const written = validDocuments["spec-document"];
    expect(PACKAGE_LATEST["spec-document"](written)).toMatchObject({
      surface: [{ summary: EXAMPLE_SURFACE_SUMMARY }],
    });
  });

  // Where they part: a phax-plan an older phax wrote stated no test lines. The
  // package keeps them as Unknown; phax's reader gives the phases no
  // `testLines` key, and only its display and sizing readers take that plan.
  it("phax-plan: a pre-schema plan's test lines are Unknown to the package, absent to phax", () => {
    const document = preSchemaDocuments["phax-plan"];
    const lifted = PACKAGE_LATEST["phax-plan"](document) as { phases: object[] };
    expect(lifted.phases.every((p) => "testLines" in p && p.testLines === UNKNOWN)).toBe(true);
    const read = readPhaxPlanFile("/work/example-repo/phax-plan.json", document);
    if (Either.isLeft(read)) throw new Error(read.left.message);
    expect(read.right.shape).toBe("pre-schema");
    expect(read.right.plan.phases.every((p) => !("testLines" in p))).toBe(true);
    // Every other recorded fact reads alike.
    expect(phasesWithoutLines(read.right.plan.phases)).toEqual(phasesWithoutLines(lifted.phases));
    // A phax-written plan keeps the lines it recorded, in either reading.
    const written = PACKAGE_LATEST["phax-plan"](validDocuments["phax-plan"]) as {
      phases: object[];
    };
    expect(written.phases.every((p) => "testLines" in p && Array.isArray(p.testLines))).toBe(true);
  });

  it.each(UPGRADED_ALIKE)(
    "%s: the package upgrades a pre-schema and a phax-written document alike",
    (id) => {
      expect(PACKAGE_LATEST[id](preSchemaDocuments[id])).toEqual(
        PACKAGE_LATEST[id](validDocuments[id]),
      );
    },
  );
});
