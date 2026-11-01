// Acceptance tests of the acceptance loop, through the schemas package's public
// entries: an older record or status document lifts to the acceptance names, and a
// 0.33.0 one parses. Each test is expected to fail until the formats move to 0.33.0.
import { describe, expect, it } from "vitest";
import {
  parseDocument,
  parseGateAttribution,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parseRunStatus,
  toLatestGateAttribution,
  toLatestPhaseRecordManifest,
  toLatestPhaseStatus,
  toLatestRunStatus,
} from "../../../packages/schemas/src/index.js";
import { liftCases, stampCases, type LiftFormat } from "../schemas/acceptanceRecordLiftCases.js";

interface Entry {
  readonly parse: (input: unknown) => {
    readonly ok: boolean;
    readonly value?: unknown;
  };
  readonly toLatest: (value: never) => unknown;
}

const ENTRIES: Readonly<Record<LiftFormat, Entry>> = {
  "run-status": { parse: parseRunStatus, toLatest: toLatestRunStatus },
  "phase-status": { parse: parsePhaseStatus, toLatest: toLatestPhaseStatus },
  "gate-attribution": { parse: parseGateAttribution, toLatest: toLatestGateAttribution },
  "phase-record-manifest": {
    parse: parsePhaseRecordManifest,
    toLatest: toLatestPhaseRecordManifest,
  },
};

/** The latest value of a document, or `undefined` when the package refuses it. */
function latest(format: LiftFormat, input: unknown): unknown {
  const entry = ENTRIES[format];
  const result = entry.parse(input);
  return result.ok ? entry.toLatest(result.value as never) : undefined;
}

describe("the package lifts an older document to the acceptance names", () => {
  it.fails.each(liftCases)("$label", ({ format, input, expected }) => {
    expect(parseDocument(input)).toMatchObject({ ok: true, format });
    expect(latest(format, input)).toEqual(expected);
  });
});

describe("the package parses a 0.33.0 document with the acceptance names", () => {
  it.fails.each(stampCases)("$label", ({ format, written, expected }) => {
    expect(parseDocument(written)).toMatchObject({ ok: true, format });
    expect(latest(format, written)).toEqual(expected);
  });
});

describe("a lifted record manifest keeps its verified surfaces sorted", () => {
  it.fails("oracle becomes acceptance and sorts first", () => {
    const input = liftCases.find(
      (c) => c.format === "phase-record-manifest" && c.label.includes("0.30.0 of an oracle phase"),
    )?.input;
    expect(latest("phase-record-manifest", input)).toMatchObject({
      verifiedSurfaces: ["acceptance", "local"],
    });
  });
});
