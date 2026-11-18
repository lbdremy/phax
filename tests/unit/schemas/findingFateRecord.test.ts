import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { parseFindingFateRecordManifest } from "../../../packages/schemas/src/index.js";
import {
  decodeFindingFateRecordManifestFile,
  encodeFindingFateRecordManifest,
  type FindingFateRecordManifest,
} from "../../../src/schemas/findingFateRecord.js";
import {
  currentSchemaUrl,
  readFindingFateRecordManifestFile,
  readRecordManifestFile,
  withSchemaUrl,
} from "../../../src/schemas/persisted.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

// The finding fate record manifest (spec finding-ids-and-fates): born with `$schema`,
// an explicit union of a fix, a dismissal and a deferral, outside the record-manifest union.

const COMMON = { kind: "finding-fate", runId: "2611011300-garden-sync" } as const;
const AT = "2026-11-01T13:30:00Z";
const OPERATOR = { kind: "operator", name: "Ada Example" } as const;

const FIXED: FindingFateRecordManifest = {
  ...COMMON,
  finding: "F1",
  fate: "fixed",
  commit: "0123456789abcdef0123456789abcdef01234567",
  pathClasses: ["code", "tests"],
  by: OPERATOR,
  at: AT,
};
const FIXED_BY_MACHINE: FindingFateRecordManifest = {
  ...FIXED,
  finding: "C2",
  pathClasses: ["docs"],
  by: { kind: "machine", grant: "ci-fixer" },
};
const DISMISSED: FindingFateRecordManifest = {
  ...COMMON,
  finding: "F2",
  fate: "dismissed",
  verdict: {
    kind: "decided",
    chosen: "dismiss",
    abandoned: ["fix", "defer"],
    why: "The caller validates it.",
    advocate: "Refuse an empty name.",
    principles: [],
    reversibility: "cheap",
    by: OPERATOR,
    at: AT,
    revised: [],
  },
};
const DEFERRED: FindingFateRecordManifest = {
  ...COMMON,
  finding: "F3",
  fate: "deferred",
  to: "NEXT_STEPS.md",
  why: "Needs its own design.",
  by: OPERATOR,
  at: AT,
};

const VARIANTS = [
  ["a fix by an operator", FIXED],
  ["a fix by a machine", FIXED_BY_MACHINE],
  ["a dismissal", DISMISSED],
  ["a deferral", DEFERRED],
] as const;

const file = (manifest: FindingFateRecordManifest): Record<string, unknown> =>
  withSchemaUrl("finding-fate-record-manifest", manifest);

// The refusal as the package states it: the path, then the message.
function refusal(input: unknown): string {
  const decoded = decodeFindingFateRecordManifestFile(input);
  if (Result.isSuccess(decoded)) throw new Error("the document was accepted");
  const parsed = parseFindingFateRecordManifest(input);
  if (parsed.ok) throw new Error("the package accepted the document");
  return `${parsed.error.path}: ${parsed.error.message}`;
}

describe("the finding-fate-record-manifest format", () => {
  it.each(VARIANTS)("decodes %s and round-trips it, $schema first", (_label, manifest) => {
    const written = file(manifest);
    expect(Object.keys(written)[0]).toBe("$schema");
    expect(written["$schema"]).toBe(currentSchemaUrl("finding-fate-record-manifest"));
    const decoded = decodeFindingFateRecordManifestFile(written);
    if (Result.isFailure(decoded)) throw new Error("the document was refused");
    expect(encodeFindingFateRecordManifest(decoded.success)).toEqual(written);
    const read = readFindingFateRecordManifestFile("record.json", written);
    if (Result.isFailure(read)) throw new Error("read failed");
    expect(read.success).toEqual(manifest);
    expect(parseFindingFateRecordManifest(written).ok).toBe(true);
  });

  it("stays outside the record-manifest union", () => {
    expect(Result.isFailure(readRecordManifestFile("record.json", file(FIXED)))).toBe(true);
  });

  it.each([
    ["an unknown key", { ...file(FIXED), extra: 1 }, "extra"],
    ["no $schema", { ...file(FIXED), $schema: undefined }, "$schema"],
    ["a fate of open", { ...file(FIXED), fate: "open" }, "fate"],
    ["another kind", { ...file(FIXED), kind: "review" }, "kind"],
    ["a fix without a commit", { ...file(FIXED), commit: undefined }, "commit"],
    ["a fix with no path class", { ...file(FIXED), pathClasses: [] }, "pathClasses"],
    [
      "path classes out of order",
      { ...file(FIXED), pathClasses: ["tests", "code"] },
      "in the order code, docs, gate-config, tests",
    ],
    [
      "a duplicated path class",
      { ...file(FIXED), pathClasses: ["code", "code"] },
      "in the order code, docs, gate-config, tests",
    ],
    [
      "a dismissal that chooses fix",
      { ...file(DISMISSED), verdict: { ...DISMISSED_VERDICT(), chosen: "fix" } },
      "verdict.chosen",
    ],
    [
      "a dismissal with a revision",
      { ...file(DISMISSED), verdict: { ...DISMISSED_VERDICT(), revised: ["x"] } },
      "verdict.revised",
    ],
    [
      "a dismissal by a machine",
      {
        ...file(DISMISSED),
        verdict: { ...DISMISSED_VERDICT(), by: { kind: "machine", grant: "ci-fixer" } },
      },
      "verdict.by",
    ],
    [
      "a deferral by a machine",
      { ...file(DEFERRED), by: { kind: "machine", grant: "ci-fixer" } },
      "by",
    ],
    ["a finding id of X1", { ...file(FIXED), finding: "X1" }, "F<n> or C<n>"],
  ])("refuses %s", (_label, document, mention) => {
    expect(refusal(document)).toContain(mention);
    expect(Result.isFailure(readFindingFateRecordManifestFile("record.json", document))).toBe(true);
  });

  it("refuses a stamp newer than this phax by release", () => {
    const named = schemaUrl("finding-fate-record-manifest", "99.0.0");
    const read = readFindingFateRecordManifestFile("record.json", {
      ...file(FIXED),
      $schema: named,
    });
    expect(Result.isFailure(read)).toBe(true);
  });
});

function DISMISSED_VERDICT() {
  if (DISMISSED.fate !== "dismissed") throw new Error("not a dismissal");
  return DISMISSED.verdict;
}
