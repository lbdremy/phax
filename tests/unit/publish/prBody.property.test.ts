// The pull request body's findings section under any byte cap: the count line stays, the body
// holds the cap whenever the fully cut body fits it, the open lines kept are a prefix of the
// uncut ones, and a body that fits uncut is not marked shortened. On the project's fixed seed
// (docs/property-tests.md).
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildShortPrBody, type ShortPrBodyInput } from "../../../src/domain/publish/prBody.js";
import type { PrFinding } from "../../../src/domain/publish/prFindings.js";
import { CODE_REVIEW_ESCAPES, CODE_REVIEW_LENSES } from "../../../src/schemas/codeReview.js";
import { FINDING_FATES, type FindingFate } from "../../../src/schemas/findingList.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";

const operator = { kind: "operator", name: "Remy" } as const;
const at = "2026-01-01T00:00:00.000Z";

const messageArb = fc.string({
  unit: fc.constantFrom("a", "b", " ", "é", "日", "😀", "\n", "\n\n", "`", "@", "#"),
  maxLength: 200,
});

interface Spec {
  readonly source: "code-review" | "compliance-review";
  readonly fate: FindingFate;
  readonly severity: "bug" | "concern" | "info";
  readonly message: string;
}

const specArb: fc.Arbitrary<Spec> = fc.record({
  source: fc.constantFrom("code-review", "compliance-review"),
  fate: fc.constantFrom(...FINDING_FATES),
  severity: fc.constantFrom("bug", "concern", "info"),
  message: messageArb,
});

function toFindings(specs: readonly Spec[]): PrFinding[] {
  const codeSpecs = specs.filter((s) => s.source === "code-review");
  const complianceSpecs = specs.filter((s) => s.source === "compliance-review");
  const history = (fate: FindingFate): PrFinding["history"] =>
    fate === "deferred"
      ? [{ fate: "deferred", to: "docs/briefs/later.md", why: "later", by: operator, at }]
      : [];
  return [
    ...codeSpecs.map((s, i): PrFinding => ({
      id: `F${i + 1}`,
      source: "code-review",
      severity: s.severity,
      file: `src/file${i + 1}.ts`,
      line: i + 1,
      message: s.message,
      lens: CODE_REVIEW_LENSES[0],
      escape: CODE_REVIEW_ESCAPES[0],
      criterion: null,
      suggestion: "fix it",
      fate: s.fate,
      history: history(s.fate),
    })),
    ...complianceSpecs.map((s, i): PrFinding => ({
      id: `C${i + 1}`,
      source: "compliance-review",
      severity: "concern",
      phaseId: "phase-01",
      dimension: "files",
      message: s.message,
      fate: s.fate,
      history: history(s.fate),
    })),
  ];
}

const listArb = fc.array(specArb, { minLength: 1, maxLength: 60 }).map(toFindings);
const capArb = fc.integer({ min: 2000, max: 30000 });

const baseInput = (findings: readonly PrFinding[], maxBytes?: number): ShortPrBodyInput => ({
  qualifiedName: "acme.greet-cli",
  shortName: "greet-cli",
  sourceSpecOutcome: undefined,
  gateProfileId: "standard",
  phases: [{ phaseId: "phase-01", title: "The greet command", status: "passed", stop: null }],
  verifiedSurfaces: ["local"],
  compliance: { kind: "not-reviewed" },
  findings: { kind: "read", records: "read", findings },
  global: { files: [], unplanned: [], missing: [], attentionPoints: [] },
  phaseHandoffs: [],
  reviewNoteGroups: [],
  runFolder: { path: "/home/dev/.phax/runs/acme.greet-cli", homeDir: "/home/dev" },
  records: "not-configured",
  footer: {
    version: "9.8.7",
    plan: { kind: "path", path: "docs/plans/greet-cli-plan.md" },
    spec: { kind: "none" },
    agents: [],
    qualifiedName: "acme.greet-cli",
  },
  ...(maxBytes !== undefined ? { maxBytes } : {}),
});

const COUNT_LINE = /^Fixed: \d+ · Dismissed: \d+/m;

// The lines of the Open block: its entries, not the line counting the cut ones.
function openLines(body: string): string[] {
  const start = body.search(/^Open \(\d+\)$/m);
  if (start === -1) return [];
  const block = body.slice(start).split("\n\n")[0] ?? "";
  return block
    .split("\n")
    .slice(1)
    .filter((line) => !line.startsWith("- …and "));
}

const byteLength = (s: string): number => Buffer.byteLength(s, "utf8");

describe("the pull request body's findings section", () => {
  it(
    "holds the count line in every body built from a non-empty list",
    () => {
      checkProperty(fc.tuple(listArb, capArb), ([findings, cap]) =>
        COUNT_LINE.test(buildShortPrBody(baseInput(findings, cap)).body),
      );
    },
    propertyTimeout(),
  );

  it(
    "stays within the cap whenever the fully cut body fits",
    () => {
      checkProperty(fc.tuple(listArb, capArb), ([findings, cap]) => {
        const floor = byteLength(buildShortPrBody(baseInput(findings, 0)).body);
        if (floor > cap) return true;
        return byteLength(buildShortPrBody(baseInput(findings, cap)).body) <= cap;
      });
    },
    propertyTimeout(),
  );

  it(
    "keeps the open lines as an ordered prefix of the uncut body's",
    () => {
      checkProperty(fc.tuple(listArb, capArb), ([findings, cap]) => {
        const uncut = openLines(buildShortPrBody(baseInput(findings)).body);
        const kept = openLines(buildShortPrBody(baseInput(findings, cap)).body);
        return kept.length <= uncut.length && kept.every((line, i) => line === uncut[i]);
      });
    },
    propertyTimeout(),
  );

  it(
    "does not mark a body that fits uncut as shortened",
    () => {
      checkProperty(fc.tuple(listArb, capArb), ([findings, cap]) => {
        const uncut = buildShortPrBody(baseInput(findings));
        const capped = buildShortPrBody(baseInput(findings, cap));
        return byteLength(uncut.body) > cap || (!capped.shortened && capped.body === uncut.body);
      });
    },
    propertyTimeout(),
  );

  it("generates every fate, with newlines and multibyte text, in a sample", () => {
    const sample = fc.sample(listArb, { numRuns: 200, seed: 20261113 }).flat();
    expect(new Set(sample.map((f) => f.fate))).toEqual(new Set(FINDING_FATES));
    expect(sample.some((f) => f.message.includes("\n"))).toBe(true);
    expect(sample.some((f) => /[é日😀]/u.test(f.message))).toBe(true);
  });
});
