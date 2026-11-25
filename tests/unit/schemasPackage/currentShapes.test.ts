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
import { Result } from "effect";
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
  parseAcceptanceRequest,
  parseArtifactStatus,
  parseFindingFateRecordManifest,
  parseFindingList,
  parsePlanLint,
  parsePlanOverview,
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
  parseCodeReviewAnswer,
  parseComplianceReviewAnswer,
  parseCostLedger,
  parseDecisionRecordManifest,
  parseReviewRecordManifest,
  parseRevisionRecordManifest,
  parseGateAttribution,
  parseGateReport,
  parseGateRequest,
  parseDecideVerdicts,
  parsePhaxPlanExtraction,
  parseHandDecisionAnswer,
  parsePlanHandDecisionAnswer,
  parseSpecHandDecisionAnswer,
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
  toLatestAcceptanceRequest,
  toLatestArtifactStatus,
  toLatestFindingList,
  toLatestPlanLint,
  toLatestPlanOverview,
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
  toLatestCodeReviewAnswer,
  toLatestComplianceReviewAnswer,
  toLatestCostLedger,
  toLatestDecisionRecordManifest,
  toLatestReviewRecordManifest,
  toLatestFindingFateRecordManifest,
  toLatestRevisionRecordManifest,
  toLatestGateAttribution,
  toLatestGateReport,
  toLatestGateRequest,
  toLatestDecideVerdicts,
  toLatestPhaxPlanExtraction,
  toLatestHandDecisionAnswer,
  toLatestPlanHandDecisionAnswer,
  toLatestSpecHandDecisionAnswer,
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
  readAcceptanceRequestFile,
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
  readDocumentSidecar,
  readPlanDocumentFile,
  readPlanRecordFile,
  readFindingFateRecordManifestFile,
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
  schemaUrl,
  type FormatId,
} from "../../../src/schemas/schemaUrl.js";
import {
  codeReviewV0_29_0Document,
  codeReviewV0_32_0Document,
  complianceReviewV0_17_0Document,
  complianceReviewV0_32_0Document,
  EXAMPLE_SURFACE_SUMMARY,
  preSchemaDocuments,
  validDocuments,
  withKey,
  withOracleKey,
  withoutGateProfile,
  withoutKey,
  type Doc,
} from "./documents.js";
import type { PlanDocumentWithoutGateProfile } from "../../../src/schemas/planDocument.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const snapshotsDir = join(repoRoot, "packages", "schemas", "snapshots");
const lock = JSON.parse(
  readFileSync(join(repoRoot, "packages", "schemas", "history.lock.json"), "utf8"),
) as Readonly<Record<string, string>>;

interface RenderedSchema {
  readonly required?: ReadonlyArray<string>;
  readonly properties?: Readonly<
    Record<string, { readonly pattern?: string; readonly const?: string }>
  >;
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
      // An answer format (the strict leaf answers, from 0.32.0) names its
      // current stamp as a const; every other format, any release by pattern.
      const stamp = schema.properties?.["$schema"];
      if (stamp?.const !== undefined) {
        expect(stamp.const).toContain(`schemas/${id}/`);
      } else {
        expect(stamp?.pattern).toContain(`schemas\\/${id}\\/`);
      }
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
  "spec-hand-decision-answer": latest(parseSpecHandDecisionAnswer, toLatestSpecHandDecisionAnswer),
  "plan-hand-decision-answer": latest(parsePlanHandDecisionAnswer, toLatestPlanHandDecisionAnswer),
  "decision-record-manifest": latest(parseDecisionRecordManifest, toLatestDecisionRecordManifest),
  "review-record-manifest": latest(parseReviewRecordManifest, toLatestReviewRecordManifest),
  "revision-record-manifest": latest(parseRevisionRecordManifest, toLatestRevisionRecordManifest),
  "cost-ledger": latest(parseCostLedger, toLatestCostLedger),
  "code-review": latest(parseCodeReview, toLatestCodeReview),
  "code-review-answer": latest(parseCodeReviewAnswer, toLatestCodeReviewAnswer),
  "compliance-review-answer": latest(parseComplianceReviewAnswer, toLatestComplianceReviewAnswer),
  "architecture-request": latest(parseArchitectureRequest, toLatestArchitectureRequest),
  "architecture-report": latest(parseArchitectureReport, toLatestArchitectureReport),
  // parseAcceptanceRequest reads both requests: an oracle request is lifted to the acceptance names.
  "oracle-request": latest(parseAcceptanceRequest, toLatestAcceptanceRequest),
  "acceptance-request": latest(parseAcceptanceRequest, toLatestAcceptanceRequest),
  "artifact-status": latest(parseArtifactStatus, toLatestArtifactStatus),
  "plan-overview": latest(parsePlanOverview, toLatestPlanOverview),
  "plan-lint": latest(parsePlanLint, toLatestPlanLint),
  "finding-list": latest(parseFindingList, toLatestFindingList),
  "finding-fate-record-manifest": latest(
    parseFindingFateRecordManifest,
    toLatestFindingFateRecordManifest,
  ),
  "first-reading": latest(parseFirstReading, toLatestFirstReading),
  "interactive-handoff": latest(parseInteractiveHandoff, toLatestInteractiveHandoff),
  "interactive-session": latest(parseInteractiveSession, toLatestInteractiveSession),
  "review-stop": latest(parseReviewStop, toLatestReviewStop),
  "run-list": latest(parseRunList, toLatestRunList),
  "decide-verdicts": latest(parseDecideVerdicts, toLatestDecideVerdicts),
  "phax-plan-extraction": latest(parsePhaxPlanExtraction, toLatestPhaxPlanExtraction),
};

type BridgeReader = (file: string, input: unknown) => Result.Result<unknown, unknown>;

// phax never reads gate requests back. It reads a gate report or a brief
// report only as a provider's answer, through readGateReport and
// readBriefReport, which name no file, and a hand decision answer only as a
// decide session's final message, through decodeCurrentHandDecisionAnswer
// (the retired hand-decision-answer nowhere).
const BRIDGE_READERS: { readonly [F in FormatId]: BridgeReader | undefined } = {
  registry: readRegistryFile,
  "run-status": readRunStatusFile,
  "phase-status": readPhaseStatusFile,
  // The reader reports the shape it read beside the plan; the plan is the lift.
  "phax-plan": (file, input) => Result.map(readPhaxPlanFile(file, input), (read) => read.plan),
  // The reader reports the shape it read beside the review; the review is the lift.
  "compliance-review": (file, input) =>
    Result.map(readComplianceReviewFile(file, input), (read) => read.review),
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
  "spec-hand-decision-answer": undefined,
  "plan-hand-decision-answer": undefined,
  "decision-record-manifest": readRecordManifestFile,
  "review-record-manifest": readRecordManifestFile,
  "revision-record-manifest": readRecordManifestFile,
  "cost-ledger": readCostLedgerFile,
  // The reader reports the shape it read beside the review; the review is the read.
  "code-review": (file, input) =>
    Result.map(readCodeReviewFile(file, input), (read) => read.review),
  // phax reads a review session's answer as the final message, never as a file.
  "code-review-answer": undefined,
  "compliance-review-answer": undefined,
  // phax writes the architecture request and never reads it back; it reads the
  // architecture report only as a provider's answer, through
  // readArchitectureReport, which names no file.
  "architecture-request": undefined,
  "architecture-report": undefined,
  // phax writes the acceptance request on the acceptance provider's stdin and
  // reads it back only to finish a stop's close; it writes and reads no oracle
  // request since 0.33.0 (frozen at 0.26.0).
  "oracle-request": undefined,
  "acceptance-request": readAcceptanceRequestFile,
  // phax prints the artifact status, the plan overview and the plan lint on
  // stdout and never reads one back.
  "artifact-status": undefined,
  "plan-overview": undefined,
  "plan-lint": undefined,
  "finding-list": undefined,
  // A fate record is read by its own reader, outside the record-manifest union.
  "finding-fate-record-manifest": readFindingFateRecordManifestFile,
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
  // phax reads the plan extraction only as the fallback model's answer, through
  // readPlanExtractionAnswer, which names no file.
  "phax-plan-extraction": undefined,
};

const READ_BY_PHAX = FORMAT_IDS.filter((id) => BRIDGE_READERS[id] !== undefined);
// phax refuses every pre-schema phase status (it never recorded `base`); the
// package reads it with `base` Unknown. A pre-schema spec document recorded no
// surface summary: phax lifts the placeholder, the package `Unknown`. A
// pre-schema phax-plan stated no test lines: phax gives its phases no
// `testLines` key, the package `Unknown`. All three are covered below where
// they part. A pre-schema gate attribution ran no protected-paths check: phax
// lifts it with `protectedPaths: null`, the package keeps it as recorded. A
// pre-schema compliance review never recorded its ledgers: phax's reader gives
// it no ledger key, the package `Unknown` ones. A pre-schema plan document
// recorded no gate profile: phax's reader of a current document refuses it,
// and its sidecar lift agrees with the package (covered below).
const PRE_SCHEMA_READ_BY_PHAX = PRE_SCHEMA_FORMAT_IDS.filter(
  (id) =>
    BRIDGE_READERS[id] !== undefined &&
    id !== "plan-document" &&
    id !== "phase-status" &&
    id !== "spec-document" &&
    id !== "phax-plan" &&
    id !== "gate-attribution" &&
    id !== "compliance-review",
);
// A pre-schema phase status upgrades with `base` Unknown, a phax-written one
// keeps its base; a pre-schema spec document upgrades with each summary
// Unknown, a phax-written one keeps its own; a pre-schema phax-plan upgrades
// with `testLines` Unknown, a phax-written one keeps its lines: they never
// upgrade alike.
// A pre-schema gate attribution keeps no `protectedPaths`, a phax-written one
// records it.
// A pre-schema compliance review upgrades with `Unknown` ledgers, a
// phax-written one keeps its own.
// A pre-schema phase record manifest upgrades with `gateProfile: null` (not
// recorded), a phax-written one names the run's profile.
// A pre-schema plan document upgrades without a gate profile, a phax-written
// one declares its own.
const UPGRADED_ALIKE = PRE_SCHEMA_FORMAT_IDS.filter(
  (id) =>
    id !== "plan-document" &&
    id !== "phase-record-manifest" &&
    id !== "phase-status" &&
    id !== "spec-document" &&
    id !== "phax-plan" &&
    id !== "gate-attribution" &&
    id !== "compliance-review",
);

/** A compliance review with each finding of `perPhase` stripped of its `id`. */
function withoutFindingIds(review: Record<string, unknown>): Record<string, unknown> {
  const perPhase = review["perPhase"] as { findings: Record<string, unknown>[] }[];
  return {
    ...review,
    perPhase: perPhase.map((phase) => ({
      ...phase,
      findings: phase.findings.map(({ id: _id, ...finding }) => finding),
    })),
  };
}

/** An older plan sidecar as phax's sidecar reader lifts it: every fact but a gate profile. */
function sidecarLift(document: unknown): PlanDocumentWithoutGateProfile {
  const read = readDocumentSidecar("plan", "/work/example-repo/plan.json", document);
  if (Result.isFailure(read)) throw new Error(read.failure.message);
  const { success } = read;
  if (success.shape === "current" || success.lift.kind !== "missing-gate-profile") {
    throw new Error("the sidecar lifts without a gate profile");
  }
  return success.lift.document;
}

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
        Result.succeed(PACKAGE_LATEST[id](document)),
      );
    },
  );

  it.each(READ_BY_PHAX)("%s: the bridge reads a phax-written document as toLatest does", (id) => {
    const read = BRIDGE_READERS[id];
    if (read === undefined) throw new Error(`${id}: phax does not read it`);
    const document = validDocuments[id];
    expect(read(`/work/example-repo/${id}.json`, document)).toEqual(
      Result.succeed(PACKAGE_LATEST[id](document)),
    );
  });

  // Where they part: a pre-schema gate attribution ran no protected-paths
  // check and recorded no time. The package keeps it as recorded, without
  // either field; phax lifts it with `protectedPaths: null` and every time
  // `unknown`.
  it("gate-attribution: a pre-schema document keeps no protectedPaths or times in the package, null and unknown in phax", () => {
    const document = preSchemaDocuments["gate-attribution"];
    const kept = PACKAGE_LATEST["gate-attribution"](document) as {
      readonly phase: string;
      readonly steps: ReadonlyArray<Doc>;
    };
    expect(kept).not.toHaveProperty("protectedPaths");
    expect(kept).not.toHaveProperty("time");
    const unknown = { kind: "unknown" };
    expect(
      BRIDGE_READERS["gate-attribution"]?.("/work/example-repo/gate-attribution.json", document),
    ).toEqual(
      Result.succeed({
        phase: kept.phase,
        time: unknown,
        steps: kept.steps.map((step) => ({ ...step, time: unknown })),
        protectedPaths: null,
      }),
    );
  });

  // Where they part: a compliance review an older phax wrote never recorded its
  // ledgers. The package marks each Unknown; phax's reader gives the review no
  // ledger key at all, tagged with the shape it read. Neither invents an empty list.
  it.each([
    ["pre-schema", preSchemaDocuments["compliance-review"], "pre-schema"],
    ["0.17.0", complianceReviewV0_17_0Document, "0.17.0"],
  ] as const)(
    "compliance-review: a %s review's ledgers are Unknown to the package, absent to phax",
    (_name, document, shape) => {
      expect(PACKAGE_LATEST["compliance-review"](document)).toMatchObject({
        unplannedChanges: UNKNOWN,
        unmetPromises: UNKNOWN,
      });
      const read = readComplianceReviewFile("/work/example-repo/compliance-review.json", document);
      if (Result.isFailure(read)) throw new Error(read.failure.message);
      expect(read.success.shape).toBe(shape);
      expect(read.success.review).not.toHaveProperty("unplannedChanges");
      expect(read.success.review).not.toHaveProperty("unmetPromises");
      // Every other recorded fact reads alike, but for the finding ids: the
      // package gives an older finding an Unknown id, phax's reader none.
      const {
        unplannedChanges: _a,
        unmetPromises: _b,
        ...recorded
      } = PACKAGE_LATEST["compliance-review"](document) as Record<string, unknown>;
      expect(read.success.review).toEqual(withoutFindingIds(recorded));
    },
  );

  // Where they part: a compliance review before 0.40.0 never recorded its
  // findings' ids. The package marks each Unknown; phax's reader gives the
  // finding no id at all (`numberRunFindings` lifts one across the run's reviews).
  it("compliance-review: a 0.32.0 review's finding ids are Unknown to the package, absent to phax", () => {
    const document = complianceReviewV0_32_0Document;
    const lifted = PACKAGE_LATEST["compliance-review"](document) as {
      perPhase: { findings: { id: unknown }[] }[];
    };
    expect(lifted.perPhase[0]?.findings[0]?.id).toBe(UNKNOWN);
    const read = readComplianceReviewFile("/work/example-repo/compliance-review.json", document);
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    expect(read.success.shape).toBe("0.32.0");
    expect(read.success.review).toEqual(withoutFindingIds(lifted as Record<string, unknown>));
  });

  // Where they part: a code review before 0.40.0 never recorded its findings'
  // ids, in the same way.
  it.each([
    ["0.32.0", codeReviewV0_32_0Document],
    ["0.29.0", codeReviewV0_29_0Document],
  ] as const)(
    "code-review: a %s review's finding ids are Unknown to the package, absent to phax",
    (shape, document) => {
      const lifted = PACKAGE_LATEST["code-review"](document) as {
        findings: { id: unknown }[];
      };
      expect(lifted.findings[0]?.id).toBe(UNKNOWN);
      const read = readCodeReviewFile("/work/example-repo/code-review.json", document);
      if (Result.isFailure(read)) throw new Error(read.failure.message);
      expect(read.success.shape).toBe(shape);
      expect(read.success.review).toEqual({
        findings: lifted.findings.map(({ id: _id, ...finding }) => finding),
      });
    },
  );

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
    expect(Result.isFailure(read)).toBe(true);
    if (Result.isFailure(read)) expect(read.failure.message).toContain("lacks completesSpec");
  });

  // Where they part: a pre-schema phase status never recorded the commit its
  // branch was created from. The package keeps that as Unknown; phax, which
  // needs the fact, refuses the status.
  it("phase-status: a pre-schema status is Unknown base to the package, refused by phax", () => {
    const document = preSchemaDocuments["phase-status"];
    expect(PACKAGE_LATEST["phase-status"](document)).toMatchObject({ base: UNKNOWN });
    const read = readPhaseStatusFile("/work/example-repo/phase-status.json", document);
    expect(Result.isFailure(read)).toBe(true);
    if (Result.isFailure(read)) expect(read.failure.message).toContain("lacks base");
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
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success).toMatchObject({ surface: [{ summary: SURFACE_SUMMARY_PLACEHOLDER }] });
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
    if (Result.isFailure(read)) throw new Error(read.failure.message);
    expect(read.success.shape).toBe("pre-schema");
    expect(read.success.plan.phases.every((p) => !("testLines" in p))).toBe(true);
    // Every other recorded fact reads alike.
    expect(phasesWithoutLines(read.success.plan.phases)).toEqual(phasesWithoutLines(lifted.phases));
    // A phax-written plan keeps the lines it recorded, in either reading.
    const written = PACKAGE_LATEST["phax-plan"](validDocuments["phax-plan"]) as {
      phases: object[];
    };
    expect(written.phases.every((p) => "testLines" in p && Array.isArray(p.testLines))).toBe(true);
  });

  // No plan document older than the gate profile recorded one: phax's sidecar
  // reader lifts it all but its profile, as the package does, and phax's reader
  // of a current document refuses it, naming run.gateProfile.
  it("plan-document: a pre-schema document lifts alike in the bridge's sidecar reader and toLatest, without a gate profile", () => {
    const document = preSchemaDocuments["plan-document"];
    expect(sidecarLift(document)).toEqual(PACKAGE_LATEST["plan-document"](document));
    expect(sidecarLift(document).run).not.toHaveProperty("gateProfile");
    const read = readPlanDocumentFile("/work/example-repo/plan.json", document);
    expect(Result.isFailure(read) && read.failure.message).toBe(
      "/work/example-repo/plan.json: the plan declares no gate profile (run.gateProfile)",
    );
  });

  it("plan-document: the package upgrades a pre-schema document alike but for its gate profile, not recorded", () => {
    const id = "plan-document";
    const written = PACKAGE_LATEST[id](validDocuments[id]);
    expect(written).toMatchObject({ run: { gateProfile: "standard" } });
    expect(written).toEqual(withoutKey(validDocuments[id], "$schema"));
    expect(PACKAGE_LATEST[id](preSchemaDocuments[id])).toEqual(
      withoutGateProfile(withoutKey(validDocuments[id], "$schema")),
    );
  });

  // The test line loop `oracle` became `acceptance` at 0.33.0: phax's sidecar
  // reader and the package lift a plan document stamped 0.28.0 or 0.32.0
  // through the same functions (src/schemas/acceptanceLift.ts), so they read it
  // alike, neither inventing a gate profile.
  it.each(["0.28.0", "0.32.0"])(
    "plan-document: a %s sidecar with the loop oracle is lifted to acceptance by the bridge and by toLatest alike",
    (release) => {
      const current = withoutGateProfile(validDocuments["plan-document"]);
      // The phases also carry the `oracle` key a sidecar had before 0.33.0.
      const oldLoops = (current["phases"] as Doc[]).map((phase, i) =>
        withOracleKey({
          ...phase,
          acceptance: i === 0 ? { passedBy: "phase-02", files: ["tests/a.test.ts"] } : null,
          testStrategy: (phase["testStrategy"] as Doc[]).map((line) => ({
            ...line,
            loop: "oracle",
          })),
        }),
      );
      const document = withKey(
        withKey(current, "phases", oldLoops),
        "$schema",
        schemaUrl("plan-document", release),
      );
      const lifted = sidecarLift(document);
      expect(lifted).toEqual(PACKAGE_LATEST["plan-document"](document));
      const lines = lifted.phases.flatMap((phase) => phase.testStrategy);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => line.loop === "acceptance")).toBe(true);
      expect(lifted.phases[0]?.acceptance).toEqual({
        passedBy: "phase-02",
        files: ["tests/a.test.ts"],
      });
    },
  );

  it("phax-plan-extraction: a 0.32.0 answer with the loop oracle is lifted to acceptance by toLatest", () => {
    const current = validDocuments["phax-plan-extraction"];
    const plan = current["plan"] as Doc;
    const line = {
      guarantee: "every pair is refused as the table says",
      size: "small",
      technique: "table",
      oracle: "transition table",
      loop: "oracle",
      criterion: "AC-1",
    };
    const phases = (plan["phases"] as Doc[]).map((phase) => ({ ...phase, testLines: [line] }));
    const document = withKey(
      withKey(current, "plan", { ...plan, phases }),
      "$schema",
      schemaUrl("phax-plan-extraction", "0.32.0"),
    );
    const lifted = PACKAGE_LATEST["phax-plan-extraction"](document) as {
      plan: { phases: Array<{ testLines: unknown[] }> };
    };
    expect(lifted.plan.phases.map((phase) => phase.testLines)).toEqual(
      phases.map(() => [{ ...line, loop: "acceptance" }]),
    );
  });

  it.each(UPGRADED_ALIKE)(
    "%s: the package upgrades a pre-schema and a phax-written document alike",
    (id) => {
      expect(PACKAGE_LATEST[id](preSchemaDocuments[id])).toEqual(
        PACKAGE_LATEST[id](validDocuments[id]),
      );
    },
  );

  it("phase-record-manifest: the package upgrades a pre-schema document alike but for its gate profile, not recorded", () => {
    const id = "phase-record-manifest";
    const fromPreSchema = PACKAGE_LATEST[id](preSchemaDocuments[id]);
    const written = PACKAGE_LATEST[id](validDocuments[id]);
    expect(written).toMatchObject({ gateProfile: validDocuments[id]["gateProfile"] });
    expect(fromPreSchema).toEqual(
      PACKAGE_LATEST[id](withKey(validDocuments[id], "gateProfile", null)),
    );
  });
});
