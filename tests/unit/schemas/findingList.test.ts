import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  FINDING_FATES,
  decodeFindingListFile,
  encodeFindingListFile,
} from "../../../src/schemas/findingList.js";
import { parseFindingList } from "../../../packages/schemas/src/index.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { validDocuments } from "../schemasPackage/documents.js";

const document = validDocuments["finding-list"];
const findings = document["findings"] as ReadonlyArray<Record<string, unknown>>;
const [code, compliance] = findings as [Record<string, unknown>, Record<string, unknown>];

function withFindings(list: ReadonlyArray<unknown>): unknown {
  return { ...document, findings: list };
}

function refusal(input: unknown): string {
  const decoded = decodeFindingListFile(input);
  if (Result.isSuccess(decoded)) throw new Error("the document was accepted");
  return String(decoded.failure);
}

describe("the finding-list format", () => {
  it("is stamped with the current stamp and starts with $schema", () => {
    expect(Object.keys(document)[0]).toBe("$schema");
    expect(document["$schema"]).toBe(schemaUrl("finding-list", CURRENT_STAMPS["finding-list"]));
  });

  it("decodes a document of each source and round-trips it", () => {
    for (const input of [
      document,
      withFindings([code]),
      withFindings([compliance]),
      withFindings([]),
    ]) {
      const decoded = decodeFindingListFile(input);
      if (Result.isFailure(decoded)) throw new Error("the document was refused");
      expect(encodeFindingListFile(decoded.success)).toEqual(input);
    }
  });

  it("lists the five fates, in the order of the spec", () => {
    expect(FINDING_FATES).toEqual(["open", "fixed", "dismissed", "deferred", "unrecorded"]);
  });

  it("refuses a key it does not name, at the root and in a finding", () => {
    expect(refusal({ ...document, extra: 1 })).toContain("extra");
    expect(refusal(withFindings([{ ...code, extra: 1 }]))).toContain("extra");
  });

  it("refuses a fate outside the five, naming the set", () => {
    const parsed = parseFindingList(withFindings([{ ...code, fate: "wontfix" }]));
    expect(parsed.ok).toBe(false);
    expect(refusal(withFindings([{ ...code, fate: "wontfix" }]))).toContain("fate");
    if (!parsed.ok) {
      expect(parsed.error.path).toBe("findings.0.fate");
      expect(parsed.error.message).toContain(FINDING_FATES.join(", "));
    }
  });

  it("refuses an id of the wrong kind", () => {
    expect(refusal(withFindings([{ ...code, id: "C1" }]))).toContain("id");
    expect(refusal(withFindings([{ ...compliance, id: "F1" }]))).toContain("id");
  });

  it("refuses a compliance finding with a file", () => {
    expect(refusal(withFindings([{ ...compliance, file: "src/a.ts" }]))).toContain("file");
  });

  it("decodes histories of each fate variant, oldest first, and round-trips them", () => {
    const at = "2026-11-01T13:30:00Z";
    const operator = { kind: "operator", name: "Ada Example" } as const;
    const history = [
      {
        fate: "dismissed",
        verdict: {
          kind: "decided",
          chosen: "dismiss",
          abandoned: ["fix", "defer"],
          why: "The caller validates it.",
          advocate: "Refuse an empty name.",
          principles: [],
          reversibility: "cheap",
          by: operator,
          at,
          revised: [],
        },
      },
      { fate: "deferred", to: "NEXT_STEPS.md", why: "Needs its own design.", by: operator, at },
      {
        fate: "fixed",
        commit: "0123456789abcdef0123456789abcdef01234567",
        pathClasses: ["code", "tests"],
        by: { kind: "machine", grant: "ci-fixer" },
        at,
      },
    ];
    const input = withFindings([{ ...code, fate: "fixed", history }]);
    const decoded = decodeFindingListFile(input);
    if (Result.isFailure(decoded)) throw new Error("the document was refused");
    expect(encodeFindingListFile(decoded.success)).toEqual(input);
  });

  it("refuses a history entry with a fate of open, naming its path", () => {
    const input = withFindings([{ ...code, history: [{ fate: "open" }] }]);
    expect(refusal(input)).toContain("history");
    const parsed = parseFindingList(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.path).toContain("findings.0.history");
  });

  it("refuses a history entry with an unknown key", () => {
    const entry = {
      fate: "deferred",
      to: "NEXT_STEPS.md",
      why: "Needs its own design.",
      by: { kind: "operator", name: "Ada Example" },
      at: "2026-11-01T13:30:00Z",
      extra: 1,
    };
    expect(refusal(withFindings([{ ...code, history: [entry] }]))).toContain("extra");
  });

  it("refuses a document without $schema and an unknown records value", () => {
    const { $schema: _schema, ...rest } = document;
    expect(refusal(rest)).toContain("$schema");
    expect(refusal({ ...document, records: "maybe" })).toContain("records");
  });
});
