import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeOracleRequestFile,
  encodeOracleRequestFile,
} from "../../../src/schemas/oracleRequest.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import { SCHEMA_URL_BASE } from "../../../src/schemas/schemaUrl.js";

const BASE = "0123456789abcdef0123456789abcdef01234567";
const ORACLE_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";

const authored = {
  verdict: "authored",
  phase: "phase-02",
  oraclePhase: "phase-02",
  base: BASE,
  files: ["tests/prune.test.ts", "tests/refunds.test.ts"],
} as const;

const discharged = {
  verdict: "discharged",
  phase: "phase-04",
  oraclePhase: "phase-02",
  base: BASE,
  oracleCommit: ORACLE_COMMIT,
  files: ["tests/prune.test.ts"],
} as const;

const stamped = (value: object) => withSchemaUrl("oracle-request", value);

describe("OracleRequestFileSchema", () => {
  it.each([
    ["authored", authored],
    ["discharged", discharged],
  ])("round-trips a %s request, $schema first", (_name, request) => {
    const encoded = encodeOracleRequestFile(stamped(request) as never);
    expect(Object.keys(encoded)[0]).toBe("$schema");
    expect(encoded.$schema).toMatch(
      new RegExp(`^${SCHEMA_URL_BASE}/oracle-request/\\d+\\.\\d+\\.\\d+\\.json$`),
    );
    const decoded = decodeOracleRequestFile(encoded);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) expect(decoded.right).toEqual(stamped(request));
  });

  it("keeps the declaration order of files", () => {
    const decoded = decodeOracleRequestFile(stamped({ ...authored, files: ["b.ts", "a.ts"] }));
    expect(Either.isRight(decoded) && decoded.right.files).toEqual(["b.ts", "a.ts"]);
  });

  it.each([
    ["oracleCommit on an authored request", stamped({ ...authored, oracleCommit: ORACLE_COMMIT })],
    [
      "no oracleCommit on a discharged request",
      stamped((({ oracleCommit: _c, ...rest }) => rest)(discharged)),
    ],
    ["an extra key", stamped({ ...authored, extra: 1 })],
    ["an empty files list", stamped({ ...authored, files: [] })],
    ["an empty file name", stamped({ ...authored, files: [""] })],
    ["a short base", stamped({ ...authored, base: "abc1234" })],
    ["a short oracle commit", stamped({ ...discharged, oracleCommit: "abc1234" })],
    ["an unknown verdict", stamped({ ...authored, verdict: "approved" })],
    ["a malformed phase id", stamped({ ...authored, phase: "phase-2" })],
    ["a missing oraclePhase", stamped((({ oraclePhase: _o, ...rest }) => rest)(authored))],
    ["a missing $schema", authored],
    [
      "another format's $schema",
      { ...authored, $schema: `${SCHEMA_URL_BASE}/gate-request/0.26.0.json` },
    ],
  ])("refuses %s", (_name, document) => {
    expect(Either.isLeft(decodeOracleRequestFile(document))).toBe(true);
  });
});
