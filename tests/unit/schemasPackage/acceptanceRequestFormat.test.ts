import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import {
  parseAcceptanceRequest,
  parseDocument,
  toLatestAcceptanceRequest,
} from "../../../packages/schemas/src/index.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const SNAPSHOTS = join(__dirname, "../../../packages/schemas/snapshots");

const SCHEMA = schemaUrl("acceptance-request", CURRENT_STAMPS["acceptance-request"]);
const ORACLE_SCHEMA = schemaUrl("oracle-request", CURRENT_STAMPS["oracle-request"]);
const BASE = "0123456789abcdef0123456789abcdef01234567";
const COMMIT = "89abcdef0123456789abcdef0123456789abcdef";

const authored = {
  $schema: SCHEMA,
  verdict: "authored",
  phase: "phase-02",
  acceptancePhase: "phase-02",
  base: BASE,
  files: ["tests/prune.test.ts"],
};

const passed = {
  $schema: SCHEMA,
  verdict: "passed",
  phase: "phase-04",
  acceptancePhase: "phase-02",
  base: BASE,
  acceptanceCommit: COMMIT,
  files: ["tests/prune.test.ts"],
};

// What phax 0.32.0 saved as checks-attempt-NN.oracle-request.json.
const oracleAuthored = {
  $schema: ORACLE_SCHEMA,
  verdict: "authored",
  phase: "phase-02",
  oraclePhase: "phase-02",
  base: BASE,
  files: ["tests/prune.test.ts"],
};

const oracleDischarged = {
  $schema: ORACLE_SCHEMA,
  verdict: "discharged",
  phase: "phase-04",
  oraclePhase: "phase-02",
  base: BASE,
  oracleCommit: COMMIT,
  files: ["tests/prune.test.ts"],
};

describe("acceptance request format in the schemas package", () => {
  it("is stamped 0.33.0 and oracle-request stays at 0.26.0", () => {
    expect(SCHEMA).toMatch(/acceptance-request\/0\.33\.0\.json$/);
    expect(ORACLE_SCHEMA).toMatch(/oracle-request\/0\.26\.0\.json$/);
  });

  it("parses an authored request and a passed request at the current shape", () => {
    const current = CURRENT_SHAPES["acceptance-request"];
    const first = parseAcceptanceRequest(authored);
    const second = parseAcceptanceRequest(passed);
    expect(first.ok && first.shape).toBe(current);
    expect(second.ok && second.shape).toBe(current);
  });

  it.each([
    ["an extra key", { ...authored, extra: 1 }],
    ["an empty files list", { ...authored, files: [] }],
    ["acceptanceCommit on an authored request", { ...authored, acceptanceCommit: COMMIT }],
    [
      "no acceptanceCommit on a passed request",
      (({ acceptanceCommit: _c, ...rest }) => rest)(passed),
    ],
    ["the old oraclePhase key", { ...authored, oraclePhase: "phase-02" }],
    ["the old discharged verdict", { ...passed, verdict: "discharged" }],
  ])("refuses %s", (_name, document) => {
    expect(parseAcceptanceRequest(document).ok).toBe(false);
  });

  it("refuses a request without $schema, a non-object and another format's request", () => {
    const { $schema: _schema, ...bare } = authored;
    expect(parseAcceptanceRequest(bare).ok).toBe(false);
    expect(parseAcceptanceRequest(null).ok).toBe(false);
    expect(
      parseAcceptanceRequest({ ...authored, $schema: schemaUrl("gate-request", "0.20.0") }).ok,
    ).toBe(false);
  });

  it("upgrades a parsed acceptance request by dropping $schema", () => {
    const parsed = parseAcceptanceRequest(passed);
    if (!parsed.ok) throw new Error("expected a request");
    const { $schema: _schema, ...rest } = passed;
    const latest = toLatestAcceptanceRequest(parsed.value);
    expect(latest).toEqual(rest);
    expect(Object.keys(latest)).toEqual(Object.keys(rest));
  });
});

// ac-read-old: a run folder saved by phax 0.32.0 still reads under the new names.
describe("oracle request read through the acceptance request parser", () => {
  it("reads an oracle request saved by phax 0.32.0 at its own 0.26.0 shape", () => {
    for (const saved of [oracleAuthored, oracleDischarged]) {
      const parsed = parseAcceptanceRequest(saved);
      expect(parsed.ok && parsed.shape).toBe("0.26.0");
    }
  });

  it("lifts an authored oracle request, oraclePhase becoming acceptancePhase", () => {
    const parsed = parseAcceptanceRequest(oracleAuthored);
    if (!parsed.ok) throw new Error("expected a request");
    const latest = toLatestAcceptanceRequest(parsed.value);
    expect(latest).toEqual({
      verdict: "authored",
      phase: "phase-02",
      acceptancePhase: "phase-02",
      base: BASE,
      files: ["tests/prune.test.ts"],
    });
    expect(Object.keys(latest)).toEqual(["verdict", "phase", "acceptancePhase", "base", "files"]);
  });

  it("lifts a discharged oracle request to passed with acceptancePhase and acceptanceCommit", () => {
    const parsed = parseAcceptanceRequest(oracleDischarged);
    if (!parsed.ok) throw new Error("expected a request");
    const latest = toLatestAcceptanceRequest(parsed.value);
    expect(latest).toEqual({
      verdict: "passed",
      phase: "phase-04",
      acceptancePhase: "phase-02",
      base: BASE,
      acceptanceCommit: COMMIT,
      files: ["tests/prune.test.ts"],
    });
    expect(Object.keys(latest)).toEqual([
      "verdict",
      "phase",
      "acceptancePhase",
      "base",
      "acceptanceCommit",
      "files",
    ]);
  });

  it("lifts an oracle request to exactly what an acceptance request parses to", () => {
    const old = parseAcceptanceRequest(oracleDischarged);
    const next = parseAcceptanceRequest(passed);
    if (!old.ok || !next.ok) throw new Error("expected requests");
    expect(toLatestAcceptanceRequest(old.value)).toEqual(toLatestAcceptanceRequest(next.value));
  });

  it("refuses an oracle request that is not at its 0.26.0 shape", () => {
    expect(parseAcceptanceRequest({ ...oracleAuthored, extra: 1 }).ok).toBe(false);
    expect(
      parseAcceptanceRequest((({ oracleCommit: _c, ...rest }) => rest)(oracleDischarged)).ok,
    ).toBe(false);
    expect(parseAcceptanceRequest({ ...oracleAuthored, verdict: "passed" }).ok).toBe(false);
  });
});

describe("parseDocument", () => {
  it("identifies an acceptance-request 0.33.0 and an oracle-request 0.26.0", () => {
    const acceptance = parseDocument(authored);
    expect(acceptance.ok && acceptance.format).toBe("acceptance-request");
    expect(acceptance.ok && acceptance.shape).toBe(CURRENT_SHAPES["acceptance-request"]);
    const oracle = parseDocument(oracleDischarged);
    expect(oracle.ok && oracle.format).toBe("oracle-request");
    expect(oracle.ok && oracle.shape).toBe("0.26.0");
  });
});

describe("acceptance request snapshots", () => {
  it("requires every key of each variant in its JSON Schema", () => {
    const shape = CURRENT_SHAPES["acceptance-request"];
    const schema = JSON.parse(
      readFileSync(join(SNAPSHOTS, "acceptance-request", `${shape}.schema.json`), "utf8"),
    ) as { anyOf: Array<{ required: string[]; additionalProperties: boolean }> };
    expect(schema.anyOf.map((variant) => variant.required)).toEqual([
      ["$schema", "verdict", "phase", "acceptancePhase", "base", "files"],
      ["$schema", "verdict", "phase", "acceptancePhase", "base", "acceptanceCommit", "files"],
    ]);
    expect(schema.anyOf.every((variant) => variant.additionalProperties === false)).toBe(true);
  });

  it("keeps oracle-request at its frozen 0.26.0 snapshot, with no next", () => {
    const dir = join(SNAPSHOTS, "oracle-request");
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual(["0.26.0.schema.json"]);
  });

  // `next` while the release is open, `<X.Y.Z>` once it is cut: either holds.
  it("has an acceptance-request snapshot", () => {
    const dir = join(SNAPSHOTS, "acceptance-request");
    const snapshots = existsSync(dir) ? readdirSync(dir) : [];
    expect(snapshots.some((name) => /^(next|\d+\.\d+\.\d+)\.schema\.json$/.test(name))).toBe(true);
  });
});
