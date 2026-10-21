import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import { parseOracleRequest, toLatestOracleRequest } from "../../../packages/schemas/src/index.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const SNAPSHOTS = join(__dirname, "../../../packages/schemas/snapshots");

const SCHEMA = schemaUrl("oracle-request", CURRENT_STAMPS["oracle-request"]);
const BASE = "0123456789abcdef0123456789abcdef01234567";

const authored = {
  $schema: SCHEMA,
  verdict: "authored",
  phase: "phase-02",
  oraclePhase: "phase-02",
  base: BASE,
  files: ["tests/prune.test.ts"],
};

describe("oracle request format in the schemas package", () => {
  it("parses an authored request and a discharged request", () => {
    expect(parseOracleRequest(authored).ok).toBe(true);
    expect(
      parseOracleRequest({
        ...authored,
        verdict: "discharged",
        phase: "phase-04",
        oracleCommit: BASE,
      }).ok,
    ).toBe(true);
  });

  it("refuses an extra key and a request without files", () => {
    expect(parseOracleRequest({ ...authored, extra: 1 }).ok).toBe(false);
    expect(parseOracleRequest({ ...authored, files: [] }).ok).toBe(false);
  });

  it("refuses a request without $schema", () => {
    const { $schema: _schema, ...bare } = authored;
    expect(parseOracleRequest(bare).ok).toBe(false);
  });

  it("upgrades a parsed request by dropping $schema", () => {
    const parsed = parseOracleRequest(authored);
    if (!parsed.ok) throw new Error("expected a request");
    const { $schema: _schema, ...rest } = authored;
    expect(toLatestOracleRequest(parsed.value)).toEqual(rest);
  });

  it("requires every key of each variant in its JSON Schema", () => {
    const shape = CURRENT_SHAPES["oracle-request"];
    const schema = JSON.parse(
      readFileSync(join(SNAPSHOTS, "oracle-request", `${shape}.schema.json`), "utf8"),
    ) as { anyOf: Array<{ required: string[]; additionalProperties: boolean }> };
    expect(schema.anyOf.map((variant) => variant.required)).toEqual([
      ["$schema", "verdict", "phase", "oraclePhase", "base", "files"],
      ["$schema", "verdict", "phase", "oraclePhase", "base", "oracleCommit", "files"],
    ]);
    expect(schema.anyOf.every((variant) => variant.additionalProperties === false)).toBe(true);
  });

  // `next` while the release is open, `<X.Y.Z>` once it is cut: either holds.
  it("has a snapshot", () => {
    const dir = join(SNAPSHOTS, "oracle-request");
    const snapshots = existsSync(dir) ? readdirSync(dir) : [];
    expect(snapshots.some((name) => /^(next|\d+\.\d+\.\d+)\.schema\.json$/.test(name))).toBe(true);
  });
});
