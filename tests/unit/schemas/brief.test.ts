import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { decodeBriefRecordFile, decodeBriefRequestFile } from "../../../src/schemas/brief.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";

// Every document here is made up.
const BASE = "0123456789abcdef0123456789abcdef01234567";

function phaseRequest(): Record<string, unknown> {
  return {
    $schema: currentSchemaUrl("brief-request"),
    phase: "phase-02",
    base: BASE,
    terminal: false,
    phases: [
      { id: "phase-01", files: ["src/billing/port.ts"] },
      { id: "phase-02", files: ["src/billing/invoice.ts"] },
    ],
    files: null,
  };
}

function outsideRequest(): Record<string, unknown> {
  return {
    $schema: currentSchemaUrl("brief-request"),
    files: ["src/billing/invoice.ts"],
  };
}

/** The spec §6 brief report, made up: the answer a brief record keeps as printed. */
function answer(): Record<string, unknown> {
  return {
    $schema: currentSchemaUrl("brief-report"),
    rules: [
      {
        rule: "a module under src/ imports no node: module",
        files: ["src/greet.ts", "src/farewell.ts"],
        guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
      },
    ],
    findings: [
      {
        id: "no-node-import src/greet.ts node:fs",
        rule: "a module under src/ imports no node: module",
        location: { file: "src/greet.ts", lines: [1, 1] },
        message: "imports node:fs",
        related: [],
        guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
        due: "this-phase",
      },
    ],
  };
}

function decodes(decode: (input: unknown) => Either.Either<unknown, unknown>, input: unknown) {
  return Either.isRight(decode(input));
}

describe("the brief-request document", () => {
  it("decodes the in-phase variant, with null files and with a list", () => {
    const decoded = decodeBriefRequestFile(phaseRequest());
    expect(Either.isRight(decoded) && decoded.right).toEqual(phaseRequest());
    const named = { ...phaseRequest(), files: ["src/billing/tax.ts", "src/billing/invoice.ts"] };
    expect(decodes(decodeBriefRequestFile, named)).toBe(true);
  });

  it("decodes the outside variant: $schema and files only", () => {
    const decoded = decodeBriefRequestFile(outsideRequest());
    expect(Either.isRight(decoded) && decoded.right).toEqual(outsideRequest());
  });

  it("rejects an extra key in either variant", () => {
    expect(decodes(decodeBriefRequestFile, { ...phaseRequest(), touched: [] })).toBe(false);
    expect(decodes(decodeBriefRequestFile, { ...outsideRequest(), touched: [] })).toBe(false);
  });

  it.each(["$schema", "phase", "base", "terminal", "phases", "files"])(
    "rejects an in-phase request without %s",
    (key) => {
      const document = phaseRequest();
      delete document[key];
      expect(decodes(decodeBriefRequestFile, document)).toBe(false);
    },
  );

  it("rejects empty files in either variant, and null files outside a phase", () => {
    expect(decodes(decodeBriefRequestFile, { ...phaseRequest(), files: [] })).toBe(false);
    expect(decodes(decodeBriefRequestFile, { ...outsideRequest(), files: [] })).toBe(false);
    expect(decodes(decodeBriefRequestFile, { ...outsideRequest(), files: null })).toBe(false);
  });

  it("rejects an abbreviated base", () => {
    expect(decodes(decodeBriefRequestFile, { ...phaseRequest(), base: "0123456" })).toBe(false);
  });

  it("rejects a $schema naming another format", () => {
    const foreign = { ...phaseRequest(), $schema: currentSchemaUrl("gate-request") };
    expect(decodes(decodeBriefRequestFile, foreign)).toBe(false);
  });
});

describe("the brief-record document", () => {
  const pushed = {
    $schema: currentSchemaUrl("brief-record"),
    moment: "pushed",
    request: phaseRequest(),
    outcome: { kind: "answered", answer: { ...answer(), note: "kept as printed" } },
  };

  const pulled = {
    $schema: currentSchemaUrl("brief-record"),
    moment: "pulled",
    request: { ...phaseRequest(), files: ["src/billing/tax.ts"] },
    outcome: { kind: "failed", reason: "brief provider exited with code 1" },
  };

  it("decodes a pushed record with an answered outcome, keeping the answer as printed", () => {
    const decoded = decodeBriefRecordFile(pushed);
    expect(Either.isRight(decoded) && decoded.right).toEqual(pushed);
  });

  it("decodes a pulled record with a failed outcome", () => {
    expect(decodes(decodeBriefRecordFile, pulled)).toBe(true);
  });

  it("decodes a pulled record whose request is the outside variant", () => {
    expect(decodes(decodeBriefRecordFile, { ...pulled, request: outsideRequest() })).toBe(true);
  });

  it("rejects an extra top-level key", () => {
    expect(decodes(decodeBriefRecordFile, { ...pushed, phase: "phase-02" })).toBe(false);
  });

  it("rejects an extra key in the request or the outcome", () => {
    expect(
      decodes(decodeBriefRecordFile, { ...pushed, request: { ...phaseRequest(), extra: 1 } }),
    ).toBe(false);
    expect(
      decodes(decodeBriefRecordFile, { ...pulled, outcome: { ...pulled.outcome, code: 1 } }),
    ).toBe(false);
  });

  it("rejects an unknown moment", () => {
    expect(decodes(decodeBriefRecordFile, { ...pushed, moment: "later" })).toBe(false);
  });
});
