import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { decodeGateRequestFile } from "../../../src/schemas/gateRequest.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";

const BASE = "0123456789abcdef0123456789abcdef01234567";

function request(): Record<string, unknown> {
  return {
    $schema: currentSchemaUrl("gate-request"),
    phase: "phase-02",
    base: BASE,
    terminal: false,
    phases: [
      { id: "phase-01", files: ["src/alpha.ts", "tests/alpha.test.ts"] },
      { id: "phase-02", files: ["src/beta.ts"] },
    ],
  };
}

function decodes(document: unknown): boolean {
  return Either.isRight(decodeGateRequestFile(document));
}

describe("the gate-request document", () => {
  it("decodes a valid document", () => {
    const decoded = decodeGateRequestFile(request());
    expect(Either.isRight(decoded) && decoded.right).toEqual(request());
  });

  it("decodes a SHA-256 base", () => {
    expect(decodes({ ...request(), base: BASE + "0123456789abcdef01234567" })).toBe(true);
  });

  it.each(["$schema", "phase", "base", "terminal", "phases"])("rejects a missing %s", (key) => {
    const document = request();
    delete document[key];
    expect(decodes(document)).toBe(false);
  });

  it("rejects an extra top-level key", () => {
    expect(decodes({ ...request(), touched: [] })).toBe(false);
  });

  it("rejects an extra key in a phases entry", () => {
    expect(
      decodes({ ...request(), phases: [{ id: "phase-01", files: [], optional: ["src/x.ts"] }] }),
    ).toBe(false);
  });

  it("rejects an abbreviated base", () => {
    expect(decodes({ ...request(), base: "0123456" })).toBe(false);
  });

  it.each(["phase-1", "phase-001", "p-01", "phase-ab"])("rejects the phase id %s", (id) => {
    expect(decodes({ ...request(), phase: id })).toBe(false);
    expect(decodes({ ...request(), phases: [{ id, files: [] }] })).toBe(false);
  });

  it("rejects a non-boolean terminal", () => {
    expect(decodes({ ...request(), terminal: "false" })).toBe(false);
  });

  it("rejects a $schema naming another format", () => {
    expect(decodes({ ...request(), $schema: currentSchemaUrl("gate-diagnostics") })).toBe(false);
  });
});
