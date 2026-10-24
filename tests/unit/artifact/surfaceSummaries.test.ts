import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  summariesToWrite,
  unwrittenSummaries,
} from "../../../src/domain/artifact/surfaceSummaries.js";
import { type DocumentSidecar, readDocumentSidecar } from "../../../src/schemas/persisted.js";
import {
  SURFACE_SUMMARY_PLACEHOLDER,
  type SpecDocument,
} from "../../../src/schemas/specDocument.js";
import { validDocuments, withSurfaceSummary } from "../schemasPackage/documents.js";

const WRITTEN = "An operator can rotate one run's log.";

function element(surface: string, summary: string) {
  return {
    surface,
    summary,
    binding: "normative",
    before: null,
    after: "phax rotate\n  rotated",
  };
}

function specSidecar(summaries: readonly string[]): DocumentSidecar {
  const surface = summaries.map((summary, i) => element(`cli: \`phax cmd-${String(i)}\``, summary));
  const read = readDocumentSidecar("spec", "docs/specs/x.json", {
    ...withSurfaceSummary(validDocuments["spec-document"], WRITTEN),
    surface,
  });
  if (Either.isLeft(read)) throw new Error(read.left.message);
  return read.right;
}

function planSidecar(): DocumentSidecar {
  const read = readDocumentSidecar("plan", "docs/plans/x.json", validDocuments["plan-document"]);
  if (Either.isLeft(read)) throw new Error(read.left.message);
  return read.right;
}

// An older-stamped sidecar as the reader lifts it: every element holds the
// placeholder, though the file holds none.
function lifted(shape: "0.25.0" | "0.17.0" | "pre-schema"): DocumentSidecar {
  const current = specSidecar([SURFACE_SUMMARY_PLACEHOLDER, SURFACE_SUMMARY_PLACEHOLDER]);
  return { ...current, shape } as unknown as DocumentSidecar;
}

describe("unwrittenSummaries", () => {
  it.each([
    [
      "a current spec with placeholders on two of three elements, in document order",
      specSidecar([SURFACE_SUMMARY_PLACEHOLDER, WRITTEN, SURFACE_SUMMARY_PLACEHOLDER]),
      ["cli: `phax cmd-0`", "cli: `phax cmd-2`"],
    ],
    ["a current spec with every summary written", specSidecar([WRITTEN, WRITTEN]), []],
    ["a current spec with no surface element", specSidecar([]), []],
    ["a lifted 0.25.0 sidecar", lifted("0.25.0"), []],
    ["a lifted 0.17.0 sidecar", lifted("0.17.0"), []],
    ["a lifted pre-schema sidecar", lifted("pre-schema"), []],
    ["a plan sidecar", planSidecar(), []],
    ["no sidecar", null, []],
  ] as const)("returns %s", (_name, sidecar, expected) => {
    expect(unwrittenSummaries(sidecar)).toEqual(expected);
  });

  it("matches the placeholder by exact equality", () => {
    expect(unwrittenSummaries(specSidecar([`${SURFACE_SUMMARY_PLACEHOLDER} `, WRITTEN]))).toEqual(
      [],
    );
  });
});

describe("summariesToWrite", () => {
  it("counts the elements holding the placeholder", () => {
    const doc = (summaries: readonly string[]): SpecDocument => {
      const sidecar = specSidecar(summaries);
      if (sidecar.kind !== "spec") throw new Error("spec expected");
      return sidecar.document;
    };
    expect(summariesToWrite(doc([SURFACE_SUMMARY_PLACEHOLDER, WRITTEN]))).toBe(1);
    expect(summariesToWrite(doc([WRITTEN]))).toBe(0);
    expect(summariesToWrite(doc([]))).toBe(0);
  });
});
