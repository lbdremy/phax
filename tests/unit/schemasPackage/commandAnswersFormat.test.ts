import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import {
  parseArtifactStatus,
  parseDocument,
  parseFindingList,
  parsePlanLint,
  parsePlanOverview,
  parseRunList,
  toLatestArtifactStatus,
  toLatestFindingList,
  toLatestPlanLint,
  toLatestPlanOverview,
  toLatestRunList,
  UNKNOWN,
} from "../../../packages/schemas/src/index.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { validDocuments, withKey, withoutKey, type Doc } from "./documents.js";

// parse, toLatest and parseDocument for the three formats born at 0.34.0, and
// run-list's frozen 0.30.0 beside its current shape.

const FORMATS = [
  ["artifact-status", parseArtifactStatus, toLatestArtifactStatus],
  ["plan-overview", parsePlanOverview, toLatestPlanOverview],
  ["plan-lint", parsePlanLint, toLatestPlanLint],
  ["finding-list", parseFindingList, toLatestFindingList],
] as const;

describe.each(FORMATS)("%s", (id, parse, toLatest) => {
  const document = validDocuments[id];

  it("parses its current shape", () => {
    const parsed = parse(document);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.shape).toBe(CURRENT_SHAPES[id]);
  });

  it("lifts to a value without $schema and keeps every other fact", () => {
    const parsed = parse(document);
    if (!parsed.ok) throw new Error("the document does not parse");
    const { $schema: _schema, ...rest } = document;
    expect(toLatest(parsed.value as never)).toEqual(rest);
  });

  it("refuses an extra key, a missing key and a document without $schema", () => {
    expect(parse(withKey(document, "extra", 1)).ok).toBe(false);
    expect(parse(withoutKey(document, "$schema")).ok).toBe(false);
    const [first] = Object.keys(document).slice(1);
    expect(parse(withoutKey(document, first ?? "")).ok).toBe(false);
  });

  it("is identified by parseDocument from its $schema alone", () => {
    const parsed = parseDocument(document);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.format).toBe(id);
      expect(parsed.shape).toBe(CURRENT_SHAPES[id]);
    }
  });

  it("refuses another format's $schema", () => {
    const other = { ...document, $schema: schemaUrl("run-list", "0.34.0") };
    expect(parse(other).ok).toBe(false);
  });
});

describe("finding-list 0.40.0", () => {
  const by = { kind: "operator", name: "Ada Example" };
  const at = "2026-11-01T13:30:00Z";
  const fix = { fate: "fixed", commit: "1".repeat(40), pathClasses: ["code"], by, at };
  const finding = (id: string, fate: string, history: readonly unknown[]) => ({
    id,
    source: "code-review",
    severity: "bug",
    file: "src/example.ts",
    line: 12,
    message: "An empty name is accepted.",
    lens: "edge",
    escape: "unexplored-input",
    criterion: null,
    suggestion: "Refuse an empty name.",
    fate,
    history,
  });
  const findings = [
    finding("F1", "open", []),
    finding("F2", "fixed", [fix]),
    finding("F3", "deferred", [{ fate: "deferred", to: "NEXT_STEPS.md", why: "Later.", by, at }]),
    finding("F4", "unrecorded", []),
    {
      id: "C1",
      source: "compliance-review",
      severity: "deviation",
      phaseId: "phase-02",
      dimension: "files",
      message: "A planned file was not touched.",
      fate: "fixed",
      history: [fix],
    },
  ];
  const frozen: Doc = {
    $schema: schemaUrl("finding-list", "0.40.0"),
    run: { namespace: "garden", shortName: "garden-sync", runId: "r-1", state: "review_open" },
    records: "read",
    findings,
  };

  it("is still parsed, at its own shape", () => {
    const parsed = parseFindingList(frozen);
    expect(parsed.ok && parsed.shape).toBe("0.40.0");
    const identified = parseDocument(frozen);
    expect(identified.ok && identified.format === "finding-list" && identified.shape).toBe(
      "0.40.0",
    );
  });

  it("lifts with landed Unknown on a fixed finding and null on every other, never a guess", () => {
    const parsed = parseFindingList(frozen);
    if (!parsed.ok) throw new Error("the 0.40.0 list does not parse");
    const lifted = toLatestFindingList(parsed.value);
    expect(lifted.findings.map((entry) => [entry.id, entry.landed])).toEqual([
      ["F1", null],
      ["F2", UNKNOWN],
      ["F3", null],
      ["F4", null],
      ["C1", UNKNOWN],
    ]);
    expect(lifted.run.baseBranch).toEqual(UNKNOWN);
    expect(lifted.findings.map((entry) => entry.history)).toEqual(
      findings.map((entry) => entry.history),
    );
    expect("$schema" in lifted).toBe(false);
  });
});

describe("run-list 0.30.0", () => {
  const current: Doc = validDocuments["run-list"];
  const rows = current["runs"] as ReadonlyArray<Record<string, unknown>>;
  const frozen: Doc = {
    ...current,
    $schema: schemaUrl("run-list", "0.30.0"),
    runs: rows.map(({ pullRequest: _pullRequest, ...rest }) => rest),
  };

  it("is still parsed, at its own shape", () => {
    const parsed = parseRunList(frozen);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.shape).toBe("0.30.0");
    const identified = parseDocument(frozen);
    expect(identified.ok && identified.format === "run-list" && identified.shape).toBe("0.30.0");
  });

  it("lifts with pullRequest null on every row", () => {
    const parsed = parseRunList(frozen);
    if (!parsed.ok) throw new Error("the 0.30.0 list does not parse");
    const latest = toLatestRunList(parsed.value as never);
    expect(latest.runs.map((row) => row.pullRequest)).toEqual([null, null]);
  });

  it("lifts a current list unchanged apart from $schema", () => {
    const parsed = parseRunList(current);
    if (!parsed.ok) throw new Error("the current list does not parse");
    expect(parsed.shape).toBe(CURRENT_SHAPES["run-list"]);
    const { $schema: _schema, ...rest } = current;
    expect(toLatestRunList(parsed.value as never)).toEqual(rest);
  });
});
