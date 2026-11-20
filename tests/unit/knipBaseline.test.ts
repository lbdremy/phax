// The dead-code check's comparison (scripts/knipBaseline.ts): what knip finds against the findings the
// operator accepted in knip-baseline.json.
import { describe, expect, it } from "vitest";

import {
  DEBT,
  compare,
  initialBaseline,
  mergeReports,
  parseBaseline,
  parseReport,
  passes,
  prune,
  renderBaseline,
  renderFailure,
  type Baseline,
  type KnipFinding,
  type KnipReport,
} from "../../scripts/knipBaseline.js";

const unusedExport: KnipFinding = {
  type: "exports",
  file: "src/domain/state.ts",
  name: "initialState",
};
const unusedType: KnipFinding = { type: "types", file: "src/domain/events.ts", name: "EventKind" };
const unusedFile: KnipFinding = {
  type: "files",
  file: "src/app/finalReview.ts",
  name: "src/app/finalReview.ts",
};

const reportOf = (...findings: KnipFinding[]): KnipReport => ({ findings, hints: [] });
const baselineOf = (...findings: KnipFinding[]): Baseline => ({
  entries: findings.map((finding) => ({ ...finding, reason: DEBT })),
});

describe("compare", () => {
  it("passes when every finding is in the baseline and every entry is found", () => {
    const comparison = compare(
      reportOf(unusedExport, unusedType),
      baselineOf(unusedType, unusedExport),
    );
    expect(passes(comparison)).toBe(true);
    expect(renderFailure(comparison)).toBe("");
  });

  it("fails on a finding the baseline does not hold", () => {
    const comparison = compare(reportOf(unusedExport, unusedType), baselineOf(unusedExport));
    expect(passes(comparison)).toBe(false);
    expect(comparison.unaccepted).toEqual([unusedType]);
    expect(renderFailure(comparison)).toContain("types  src/domain/events.ts  EventKind");
  });

  it("fails on an entry no finding matches any more", () => {
    const comparison = compare(reportOf(unusedExport), baselineOf(unusedExport, unusedFile));
    expect(passes(comparison)).toBe(false);
    expect(comparison.stale).toEqual([{ ...unusedFile, reason: DEBT }]);
    expect(renderFailure(comparison)).toContain("pnpm knip --prune");
  });

  it("fails on an entry whose reason is empty", () => {
    const baseline: Baseline = { entries: [{ ...unusedExport, reason: "  " }] };
    const comparison = compare(reportOf(unusedExport), baseline);
    expect(passes(comparison)).toBe(false);
    expect(comparison.unreasoned).toEqual(baseline.entries);
  });

  it("fails on a configuration hint, which no baseline holds", () => {
    const report: KnipReport = {
      findings: [unusedExport],
      hints: [{ type: "ignoreDependencies", identifier: "esbuild" }],
    };
    const comparison = compare(report, baselineOf(unusedExport));
    expect(passes(comparison)).toBe(false);
    expect(renderFailure(comparison)).toContain("ignoreDependencies  esbuild");
  });

  it("names a finding by its type, file and symbol: one of another type or file is another finding", () => {
    const sameNameOtherType: KnipFinding = { ...unusedExport, type: "types" };
    const sameNameOtherFile: KnipFinding = { ...unusedExport, file: "src/domain/other.ts" };
    const comparison = compare(
      reportOf(sameNameOtherType, sameNameOtherFile),
      baselineOf(unusedExport),
    );
    expect(comparison.unaccepted).toHaveLength(2);
    expect(comparison.stale).toHaveLength(1);
  });

  it("never reads a line: a finding that moved within its file still matches its entry", () => {
    // The reporter prints no line; a line knip would add is ignored by the comparison.
    const moved = { ...unusedExport, line: 120 } as KnipFinding;
    const baseline = parseBaseline(
      JSON.stringify({ entries: [{ ...unusedExport, line: 12, reason: DEBT }] }),
    );
    expect(passes(compare(reportOf(moved), baseline))).toBe(true);
    expect(renderBaseline(baseline)).not.toContain(`"line"`);
  });
});

describe("mergeReports", () => {
  it("counts once a finding both the default and the production run report", () => {
    const defaultRun = reportOf(unusedExport, unusedType);
    const productionRun: KnipReport = {
      findings: [{ ...unusedExport }, unusedFile],
      hints: [{ type: "ignoreBinaries", identifier: "vibe" }],
    };
    const merged = mergeReports([defaultRun, productionRun]);
    expect(merged.findings).toHaveLength(3);
    expect(merged.hints).toEqual([{ type: "ignoreBinaries", identifier: "vibe" }]);
    expect(passes(compare(merged, baselineOf(unusedExport, unusedType, unusedFile)))).toBe(false);
    expect(
      passes(compare({ ...merged, hints: [] }, baselineOf(unusedExport, unusedType, unusedFile))),
    ).toBe(true);
  });
});

describe("prune", () => {
  it("drops the entries nothing matches and keeps the others with their reason", () => {
    const baseline: Baseline = {
      entries: [
        { ...unusedExport, reason: "test support" },
        { ...unusedFile, reason: DEBT },
      ],
    };
    expect(prune(baseline, reportOf(unusedExport))).toEqual({
      entries: [{ ...unusedExport, reason: "test support" }],
    });
  });

  it("never adds an entry for a finding the baseline does not hold", () => {
    const pruned = prune(baselineOf(unusedExport), reportOf(unusedExport, unusedType, unusedFile));
    expect(pruned).toEqual(baselineOf(unusedExport));
    expect(passes(compare(reportOf(unusedExport, unusedType), pruned))).toBe(false);
  });
});

describe("the baseline file", () => {
  it("is written first from every finding, each as debt, and read back as written", () => {
    const baseline = initialBaseline(reportOf(unusedType, unusedExport, unusedFile));
    expect(baseline.entries.every((entry) => entry.reason === DEBT)).toBe(true);
    expect(parseBaseline(renderBaseline(baseline))).toEqual({
      entries: [unusedFile, unusedType, unusedExport].map((finding) => ({
        ...finding,
        reason: DEBT,
      })),
    });
  });

  it("refuses an entry without a reason and an entry written twice", () => {
    expect(() =>
      parseBaseline(JSON.stringify({ entries: [{ type: "exports", file: "a.ts", name: "a" }] })),
    ).toThrow("no string `reason`");
    const entry = { ...unusedExport, reason: DEBT };
    expect(() => parseBaseline(JSON.stringify({ entries: [entry, entry] }))).toThrow("repeats");
  });
});

describe("the reporter's line", () => {
  it("is read as a report when its findings and hints are well formed", () => {
    const line = JSON.stringify({
      findings: [{ type: "exports", file: "src/a.ts", name: "a" }],
      hints: [{ type: "ignoreDependencies", identifier: "esbuild" }],
    });
    expect(parseReport(line)).toEqual({
      findings: [{ type: "exports", file: "src/a.ts", name: "a" }],
      hints: [{ type: "ignoreDependencies", identifier: "esbuild" }],
    });
  });

  it("is refused when a finding lacks a field or the lists are missing", () => {
    expect(() =>
      parseReport(JSON.stringify({ findings: [{ type: "exports", file: "src/a.ts" }], hints: [] })),
    ).toThrow(/finding 0/);
    expect(() => parseReport(JSON.stringify({ findings: [] }))).toThrow(/hints/);
  });
});
