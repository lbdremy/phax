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

  describe("landed", () => {
    const A = "1".repeat(40);
    const B = "2".repeat(40);
    const C = "3".repeat(40);
    const fix = {
      fate: "fixed",
      commit: A,
      pathClasses: ["code"],
      by: { kind: "operator", name: "Ada Example" },
      at: "2026-11-01T13:30:00Z",
    };
    const fixedWith = (landed: unknown) =>
      withFindings([{ ...code, fate: "fixed", history: [fix], landed }]);
    const found = (by: string, commit: string) => ({
      status: "found",
      by,
      commit,
      branch: "main",
      recorded: A,
    });

    it.each([
      ["found by recorded", found("recorded", A)],
      ["found by key", found("key", B)],
      ["found by patch id", found("patch-id", C)],
      ["found with sha-256 names", { ...found("key", "b".repeat(64)), recorded: "a".repeat(64) }],
      ["ambiguous", { status: "ambiguous", commits: [B, C], branch: "main", recorded: A }],
      ["not found on one branch", { status: "not-found", branches: ["main"], recorded: A }],
      [
        "not found on two branches",
        { status: "not-found", branches: ["origin/main", "phax/x--phase-01"], recorded: A },
      ],
    ])("decodes %s and round-trips it", (_name, landed) => {
      const input = fixedWith(landed);
      const decoded = decodeFindingListFile(input);
      if (Result.isFailure(decoded)) throw new Error(String(decoded.failure));
      expect(encodeFindingListFile(decoded.success)).toEqual(input);
    });

    it("decodes a fixed finding with a null landed: the shape is checked, not its pairing", () => {
      expect(Result.isSuccess(decodeFindingListFile(fixedWith(null)))).toBe(true);
    });

    it.each([
      ["landed missing", withFindings([{ ...code, landed: undefined }]), "findings.0.landed"],
      [
        "an unknown status",
        fixedWith({ ...found("key", B), status: "landed" }),
        "findings.0.landed.status",
      ],
      [
        "found without commit",
        fixedWith({ status: "found", by: "key", branch: "main", recorded: A }),
        "findings.0.landed.commit: is missing",
      ],
      [
        "ambiguous with one commit",
        fixedWith({ status: "ambiguous", commits: [B], branch: "main", recorded: A }),
        "an ambiguous resolution names at least two commits",
      ],
      [
        "not-found with no branch",
        fixedWith({ status: "not-found", branches: [], recorded: A }),
        "a not-found resolution names at least one branch",
      ],
      [
        "a short sha",
        fixedWith(found("key", "2222222")),
        '"2222222" is not a full commit sha (expected 40 or 64 lowercase hex digits)',
      ],
      [
        "an upper-case sha",
        fixedWith({ ...found("key", B), recorded: "A".repeat(40) }),
        "is not a full commit sha",
      ],
      ["an extra key", fixedWith({ ...found("key", B), extra: 1 }), "findings.0.landed.extra"],
      ["an unknown step", fixedWith(found("guess", B)), '"guess" is not a resolution step'],
    ])("refuses %s", (_name, input, expected) => {
      const parsed = parseFindingList(input);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(`${parsed.error.path}: ${parsed.error.message}`).toContain(expected);
    });

    it("refuses a run without its base branch", () => {
      const decoded = decodeFindingListFile(document);
      if (Result.isFailure(decoded)) throw new Error("the document was refused");
      const { baseBranch: _baseBranch, ...run } = decoded.success.run;
      expect(refusal({ ...document, run })).toContain("baseBranch");
    });
  });

  it("refuses a document without $schema and an unknown records value", () => {
    const { $schema: _schema, ...rest } = document;
    expect(refusal(rest)).toContain("$schema");
    expect(refusal({ ...document, records: "maybe" })).toContain("records");
  });
});
