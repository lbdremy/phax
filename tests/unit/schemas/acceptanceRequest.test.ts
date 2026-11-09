import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeAcceptanceRequestFile,
  encodeAcceptanceRequestFile,
} from "../../../src/schemas/acceptanceRequest.js";
import { decodeOracleRequestV0_26_0 } from "../../../src/schemas/history/oracle-request/0.26.0.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import { SCHEMA_URL_BASE } from "../../../src/schemas/schemaUrl.js";

const BASE = "0123456789abcdef0123456789abcdef01234567";
const ACCEPTANCE_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";

const authored = {
  verdict: "authored",
  phase: "phase-02",
  acceptancePhase: "phase-02",
  base: BASE,
  files: ["tests/prune.test.ts", "tests/refunds.test.ts"],
} as const;

const passed = {
  verdict: "passed",
  phase: "phase-04",
  acceptancePhase: "phase-02",
  base: BASE,
  acceptanceCommit: ACCEPTANCE_COMMIT,
  files: ["tests/prune.test.ts"],
} as const;

const stamped = (value: object) => withSchemaUrl("acceptance-request", value);

describe("AcceptanceRequestFileSchema", () => {
  it.each([
    ["authored", authored],
    ["passed", passed],
  ])("round-trips a %s request, $schema first", (_name, request) => {
    const encoded = encodeAcceptanceRequestFile(stamped(request) as never);
    expect(Object.keys(encoded)[0]).toBe("$schema");
    expect(encoded.$schema).toMatch(
      new RegExp(`^${SCHEMA_URL_BASE}/acceptance-request/\\d+\\.\\d+\\.\\d+\\.json$`),
    );
    const decoded = decodeAcceptanceRequestFile(encoded);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) expect(decoded.right).toEqual(stamped(request));
  });

  it("is stamped 0.33.0", () => {
    expect(stamped(authored).$schema).toBe(`${SCHEMA_URL_BASE}/acceptance-request/0.33.0.json`);
  });

  it("keeps the declaration order of files", () => {
    const decoded = decodeAcceptanceRequestFile(stamped({ ...authored, files: ["b.ts", "a.ts"] }));
    expect(Result.isSuccess(decoded) && decoded.right.files).toEqual(["b.ts", "a.ts"]);
  });

  it.each([
    [
      "acceptanceCommit on an authored request",
      stamped({ ...authored, acceptanceCommit: ACCEPTANCE_COMMIT }),
      "acceptanceCommit",
    ],
    [
      "no acceptanceCommit on a passed request",
      stamped((({ acceptanceCommit: _c, ...rest }) => rest)(passed)),
      "acceptanceCommit",
    ],
    ["an extra key", stamped({ ...authored, extra: 1 }), "extra"],
    ["an old oraclePhase key", stamped({ ...authored, oraclePhase: "phase-02" }), "oraclePhase"],
    ["an empty files list", stamped({ ...authored, files: [] }), "files"],
    ["an empty file name", stamped({ ...authored, files: [""] }), "files"],
    ["a short base", stamped({ ...authored, base: "abc1234" }), "base"],
    [
      "a short acceptance commit",
      stamped({ ...passed, acceptanceCommit: "abc1234" }),
      "acceptanceCommit",
    ],
    ["the old discharged verdict", stamped({ ...authored, verdict: "discharged" }), "verdict"],
    ["an unknown verdict", stamped({ ...authored, verdict: "approved" }), "verdict"],
    ["a malformed phase id", stamped({ ...authored, phase: "phase-2" }), "phase"],
    [
      "a missing acceptancePhase",
      stamped((({ acceptancePhase: _a, ...rest }) => rest)(authored)),
      "acceptancePhase",
    ],
    ["a missing $schema", authored, "$schema"],
    [
      "another format's $schema",
      { ...authored, $schema: `${SCHEMA_URL_BASE}/gate-request/0.26.0.json` },
      "$schema",
    ],
    [
      "an oracle-request $schema",
      { ...authored, $schema: `${SCHEMA_URL_BASE}/oracle-request/0.26.0.json` },
      "$schema",
    ],
  ])("refuses %s", (_name, document, key) => {
    const decoded = decodeAcceptanceRequestFile(document);
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) expect(String(decoded.left)).toContain(key);
  });
});

describe("OracleRequestV0_26_0Schema, frozen", () => {
  const oracleDocument = {
    $schema: `${SCHEMA_URL_BASE}/oracle-request/0.26.0.json`,
    verdict: "discharged",
    phase: "phase-04",
    oraclePhase: "phase-02",
    base: BASE,
    oracleCommit: ACCEPTANCE_COMMIT,
    files: ["tests/prune.test.ts"],
  };

  it("still decodes a request phax 0.32.0 wrote", () => {
    expect(Result.isSuccess(decodeOracleRequestV0_26_0(oracleDocument))).toBe(true);
  });

  it("refuses a request in the acceptance names", () => {
    expect(
      Result.isFailure(decodeOracleRequestV0_26_0({ ...oracleDocument, verdict: "passed" })),
    ).toBe(true);
  });
});
