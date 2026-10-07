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
  parseAuthoringRecordManifest,
  parseComplianceReview,
  parseGateAttribution,
  parseGateDiagnostics,
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
  toLatestAuthoringRecordManifest,
  toLatestComplianceReview,
  toLatestGateAttribution,
  toLatestGateDiagnostics,
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
  readComplianceReviewFile,
  readGateAttributionFile,
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
import {
  FORMAT_IDS,
  PRE_SCHEMA_FORMAT_IDS,
  SCHEMA_BORN_FORMAT_IDS,
  compareReleases,
  isRelease,
  type FormatId,
} from "../../../src/schemas/schemaUrl.js";
import { preSchemaDocuments, validDocuments } from "./documents.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const snapshotsDir = join(repoRoot, "packages", "schemas", "snapshots");
const lock = JSON.parse(
  readFileSync(join(repoRoot, "packages", "schemas", "history.lock.json"), "utf8"),
) as Readonly<Record<string, string>>;

interface RenderedSchema {
  readonly required?: ReadonlyArray<string>;
  readonly properties?: Readonly<Record<string, { readonly pattern?: string }>>;
}

function rendered(id: FormatId): RenderedSchema {
  const entry = JSON_SCHEMA_FORMATS.find((format) => format.format === id);
  if (entry === undefined) throw new Error(`no JSON Schema table entry for ${id}`);
  const { files, failures } = renderJsonSchemas([entry]);
  expect(failures).toEqual([]);
  return JSON.parse(files.get(entry.fileName) ?? "null") as RenderedSchema;
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
    const schema = rendered(id);
    expect(schema.required).toContain("$schema");
    expect(schema.properties?.["$schema"]?.pattern).toContain(`schemas\\/${id}\\/`);
    expect(schema.properties).not.toHaveProperty("version");
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
    "%s: is born with $schema: no pre-schema slot, snapshot or frozen module",
    (id) => {
      expect(FORMAT_DEFINITIONS[id].preSchema).toBeNull();
      expect(existsSync(join(snapshotsDir, id, `${CURRENT_SHAPES[id]}.schema.json`))).toBe(true);
      expect(existsSync(join(snapshotsDir, id, "pre-schema.schema.json"))).toBe(false);
      expect(Object.keys(lock).filter((path) => path.includes(`/history/${id}/`))).toEqual([]);
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
  "gate-diagnostics": latest(parseGateDiagnostics, toLatestGateDiagnostics),
  "spec-document": latest(parseSpecDocument, toLatestSpecDocument),
  "plan-document": latest(parsePlanDocument, toLatestPlanDocument),
  "plan-approval-record": latest(parsePlanApprovalRecord, toLatestPlanApprovalRecord),
  "spec-approval-record": latest(parseSpecApprovalRecord, toLatestSpecApprovalRecord),
};

type BridgeReader = (file: string, input: unknown) => Either.Either<unknown, unknown>;

// phax never reads gate diagnostics documents back.
const BRIDGE_READERS: { readonly [F in FormatId]: BridgeReader | undefined } = {
  registry: readRegistryFile,
  "run-status": readRunStatusFile,
  "phase-status": readPhaseStatusFile,
  "phax-plan": readPhaxPlanFile,
  "compliance-review": readComplianceReviewFile,
  "plan-approvals": readPlanApprovalsFile,
  "spec-approvals": readSpecApprovalsFile,
  "phase-record-manifest": readRecordManifestFile,
  "authoring-record-manifest": readRecordManifestFile,
  "gate-attribution": readGateAttributionFile,
  "phase-file-reconciliation": readPhaseFileReconciliationFile,
  "gate-diagnostics": undefined,
  "spec-document": readSpecDocumentFile,
  "plan-document": readPlanDocumentFile,
  "plan-approval-record": readPlanRecordFile,
  "spec-approval-record": readSpecRecordFile,
};

const READ_BY_PHAX = FORMAT_IDS.filter((id) => BRIDGE_READERS[id] !== undefined);
// phax refuses every pre-schema phase status (it never recorded `base`); the
// package reads it with `base` Unknown. Covered below where they part.
const PRE_SCHEMA_READ_BY_PHAX = PRE_SCHEMA_FORMAT_IDS.filter(
  (id) => BRIDGE_READERS[id] !== undefined && id !== "phase-status",
);
// A pre-schema phase status upgrades with `base` Unknown, a phax-written one
// keeps its base, so the two never upgrade alike.
const UPGRADED_ALIKE = PRE_SCHEMA_FORMAT_IDS.filter((id) => id !== "phase-status");

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

  it.each(UPGRADED_ALIKE)(
    "%s: the package upgrades a pre-schema and a phax-written document alike",
    (id) => {
      expect(PACKAGE_LATEST[id](preSchemaDocuments[id])).toEqual(
        PACKAGE_LATEST[id](validDocuments[id]),
      );
    },
  );
});
