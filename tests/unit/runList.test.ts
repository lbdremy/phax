import { Result } from "effect";
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
  pullRequest: "https://github.com/example/invoices/pull/12",
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
  pullRequest: undefined,
};

describe("buildRunList", () => {
  it("keeps what is known", () => {
    expect(buildRunList([KNOWN]).runs).toEqual([KNOWN]);
  });

  it("writes null for an unknown phase, profile, pending count, archive path and pull request", () => {
    expect(buildRunList([UNKNOWN]).runs[0]).toMatchObject({
      currentPhase: null,
      gateProfile: null,
      recordsPending: null,
      archivePath: null,
      stop: null,
      pullRequest: null,
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
    expect(Result.isSuccess(decodeRunListFile(document()))).toBe(true);
  });

  it("refuses an extra key on a row", () => {
    const doc = document();
    const bad = { ...doc, runs: [{ ...doc.runs[0], extra: 1 }] };
    expect(Result.isFailure(decodeRunListFile(bad))).toBe(true);
  });

  it("refuses a row without stop", () => {
    const doc = document();
    const { stop: _stop, ...withoutStop } = doc.runs[0]!;
    expect(Result.isFailure(decodeRunListFile({ ...doc, runs: [withoutStop] }))).toBe(true);
  });

  it("refuses a row without pullRequest", () => {
    const doc = document();
    const { pullRequest: _pullRequest, ...withoutPullRequest } = doc.runs[0]!;
    expect(Result.isFailure(decodeRunListFile({ ...doc, runs: [withoutPullRequest] }))).toBe(true);
  });

  it("refuses a document without $schema", () => {
    expect(Result.isFailure(decodeRunListFile(buildRunList([KNOWN])))).toBe(true);
  });
});
