import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { buildRunList, type LsRunRow } from "../../src/domain/runList.js";
import { decodeRunListFile } from "../../src/schemas/runList.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

const KNOWN: LsRunRow = {
  qualifiedName: "example.invoice-export",
  namespace: "example",
  shortName: "invoice-export",
  state: "running",
  branch: "phax/invoice-export",
  currentPhase: "2/6",
  gateProfile: "standard",
  updatedAt: "2026-10-24 09:30",
  lockState: "active",
  recordsPending: 3,
  archivePath: "/archive/invoice-export",
  stop: null,
};

const UNKNOWN: LsRunRow = {
  ...KNOWN,
  qualifiedName: "example.payments-fix",
  shortName: "payments-fix",
  state: "failed",
  currentPhase: "-",
  gateProfile: "-",
  recordsPending: undefined,
  archivePath: undefined,
};

describe("buildRunList", () => {
  it("keeps what is known", () => {
    expect(buildRunList([KNOWN]).runs).toEqual([KNOWN]);
  });

  it("writes null for an unknown phase, profile, pending count and archive path", () => {
    expect(buildRunList([UNKNOWN]).runs[0]).toMatchObject({
      currentPhase: null,
      gateProfile: null,
      recordsPending: null,
      archivePath: null,
      stop: null,
    });
  });

  it("writes every key of every row", () => {
    for (const r of buildRunList([KNOWN, UNKNOWN]).runs) {
      expect(Object.keys(r).toSorted()).toEqual(Object.keys(KNOWN).toSorted());
    }
  });
});

describe("the run-list schema", () => {
  const document = () => withSchemaUrl("run-list", buildRunList([KNOWN, UNKNOWN]));

  it("accepts a built document", () => {
    expect(Either.isRight(decodeRunListFile(document()))).toBe(true);
  });

  it("refuses an extra key on a row", () => {
    const doc = document();
    const bad = { ...doc, runs: [{ ...doc.runs[0], extra: 1 }] };
    expect(Either.isLeft(decodeRunListFile(bad))).toBe(true);
  });

  it("refuses a row without stop", () => {
    const doc = document();
    const { stop: _stop, ...withoutStop } = doc.runs[0]!;
    expect(Either.isLeft(decodeRunListFile({ ...doc, runs: [withoutStop] }))).toBe(true);
  });

  it("refuses a document without $schema", () => {
    expect(Either.isLeft(decodeRunListFile(buildRunList([KNOWN])))).toBe(true);
  });
});
