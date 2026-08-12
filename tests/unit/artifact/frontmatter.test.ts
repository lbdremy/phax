import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeArtifactFrontmatter,
  fingerprintSource,
  setFrontmatterKeys,
  splitFrontmatter,
} from "../../../src/domain/artifact/frontmatter.js";

const SPEC_DOC = `---
status: Draft
date: 2026-08-11
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Some Spec

Body text.
`;

const PLAN_DOC = `---
status: Approved
source-spec: docs/specs/26-artifact-frontmatter-metadata.md
approved:
  date: 2026-08-11
  baseline: 4ae687b
---

# Some Plan

Body text.
`;

describe("splitFrontmatter", () => {
  it("accepts a block at offset 0", () => {
    const split = splitFrontmatter(SPEC_DOC);
    expect(split).not.toBeNull();
    expect(split?.yamlText).toBe(
      [
        "status: Draft",
        "date: 2026-08-11",
        "audience: implementation planning with Claude Code",
        "scope: functional behavior and consumption surface",
      ].join("\n"),
    );
  });

  it("preserves the body byte-for-byte including trailing newline", () => {
    const split = splitFrontmatter(SPEC_DOC);
    expect(split?.body).toBe("\n# Some Spec\n\nBody text.\n");
  });

  it("returns null for a leading blank line", () => {
    const md = `\n${SPEC_DOC}`;
    expect(splitFrontmatter(md)).toBeNull();
  });

  it("returns null for leading whitespace before the delimiter", () => {
    const md = ` ---\nstatus: Draft\n---\n\nBody.\n`;
    expect(splitFrontmatter(md)).toBeNull();
  });

  it("returns null when the closing delimiter is missing", () => {
    const md = `---\nstatus: Draft\n\n# No closing delimiter\n`;
    expect(splitFrontmatter(md)).toBeNull();
  });

  it("splits at the first closing delimiter when the body itself contains --- separators", () => {
    const md = `---\nstatus: Draft\n---\n\nBody with a\n\n---\n\nseparator inside it.\n`;
    const split = splitFrontmatter(md);
    expect(split).toEqual({
      yamlText: "status: Draft",
      body: "\nBody with a\n\n---\n\nseparator inside it.\n",
    });
  });
});

describe("decodeArtifactFrontmatter", () => {
  it("decodes a valid spec key set", () => {
    const decoded = decodeArtifactFrontmatter("spec", SPEC_DOC);
    expect(decoded).toEqual(
      Either.right({
        status: "Draft",
        date: "2026-08-11",
        audience: "implementation planning with Claude Code",
        scope: "functional behavior and consumption surface",
      }),
    );
  });

  it("decodes a valid plan key set", () => {
    const decoded = decodeArtifactFrontmatter("plan", PLAN_DOC);
    expect(decoded).toEqual(
      Either.right({
        status: "Approved",
        "source-spec": "docs/specs/26-artifact-frontmatter-metadata.md",
        approved: { date: "2026-08-11", baseline: "4ae687b" },
      }),
    );
  });

  it("decodes source-spec: null as null", () => {
    const md = `---\nstatus: Draft\nsource-spec: null\n---\n\n# Plan\n`;
    const decoded = decodeArtifactFrontmatter("plan", md);
    expect(Either.isRight(decoded)).toBe(true);
    if (!Either.isRight(decoded)) return;
    expect((decoded.right as { "source-spec": string | null })["source-spec"]).toBeNull();
  });

  it("decodes a plan with approved absent as valid", () => {
    const md = `---\nstatus: Draft\nsource-spec: null\n---\n\n# Plan\n`;
    const decoded = decodeArtifactFrontmatter("plan", md);
    expect(Either.isRight(decoded)).toBe(true);
    if (!Either.isRight(decoded)) return;
    expect("approved" in decoded.right).toBe(false);
  });

  it("fails naming the offending key when an unknown key is present", () => {
    const md = `---\nstatus: Draft\ndate: 2026-08-11\naudience: x\nscope: y\nstaus: Draft\n---\n\n# Spec\n`;
    const decoded = decodeArtifactFrontmatter("spec", md);
    expect(Either.isLeft(decoded)).toBe(true);
    if (!Either.isLeft(decoded)) return;
    expect(decoded.left.kind).toBe("schema");
    expect(decoded.left).toMatchObject({ kind: "schema" });
    if (decoded.left.kind === "schema") {
      expect(decoded.left.detail).toContain("staus");
    }
  });

  it("fails naming source-spec when it is missing from a plan", () => {
    const md = `---\nstatus: Draft\n---\n\n# Plan\n`;
    const decoded = decodeArtifactFrontmatter("plan", md);
    expect(Either.isLeft(decoded)).toBe(true);
    if (!Either.isLeft(decoded)) return;
    expect(decoded.left.kind).toBe("schema");
    if (decoded.left.kind === "schema") {
      expect(decoded.left.detail).toContain("source-spec");
    }
  });

  it("fails on a bad status value", () => {
    const md = `---\nstatus: NotAStatus\ndate: 2026-08-11\naudience: x\nscope: y\n---\n\n# Spec\n`;
    const decoded = decodeArtifactFrontmatter("spec", md);
    expect(Either.isLeft(decoded)).toBe(true);
    if (!Either.isLeft(decoded)) return;
    expect(decoded.left.kind).toBe("schema");
  });

  it("fails with missing-block when there is no frontmatter", () => {
    const md = `# Spec\n\nStatus: Draft\n`;
    const decoded = decodeArtifactFrontmatter("spec", md);
    expect(decoded).toEqual(Either.left({ kind: "missing-block" }));
  });

  it("fails with yaml-syntax when the block is not a mapping", () => {
    const md = `---\n- one\n- two\n---\n\n# Spec\n`;
    const decoded = decodeArtifactFrontmatter("spec", md);
    expect(Either.isLeft(decoded)).toBe(true);
    if (!Either.isLeft(decoded)) return;
    expect(decoded.left.kind).toBe("yaml-syntax");
  });

  it("fails with yaml-syntax on malformed YAML", () => {
    const md = `---\nstatus: [unterminated\n---\n\n# Spec\n`;
    const decoded = decodeArtifactFrontmatter("spec", md);
    expect(Either.isLeft(decoded)).toBe(true);
    if (!Either.isLeft(decoded)) return;
    expect(decoded.left.kind).toBe("yaml-syntax");
  });
});

describe("setFrontmatterKeys", () => {
  it("rewrites status leaving other keys and the body byte-identical", () => {
    const md = `---\nstatus: Draft # a comment\nsource-spec: docs/specs/1-a.md\n---\n\n# Plan\n\nBody.\n`;
    const result = setFrontmatterKeys(md, [{ key: "status", value: "Approved" }]);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right).toContain("status: Approved # a comment");
    expect(result.right).toContain("source-spec: docs/specs/1-a.md");
    expect(result.right.endsWith("\n# Plan\n\nBody.\n")).toBe(true);
  });

  it("upserts approved, replacing a previous value in place", () => {
    const result = setFrontmatterKeys(PLAN_DOC, [
      { key: "approved", value: { date: "2026-08-12", baseline: "abcdef1" } },
    ]);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    const decoded = decodeArtifactFrontmatter("plan", result.right);
    expect(Either.isRight(decoded)).toBe(true);
    if (!Either.isRight(decoded)) return;
    expect(decoded.right).toMatchObject({
      approved: { date: "2026-08-12", baseline: "abcdef1" },
    });
  });

  it("emits a numeric-looking baseline quoted, and it re-decodes as a string", () => {
    const result = setFrontmatterKeys(PLAN_DOC, [
      { key: "approved", value: { date: "2026-08-12", baseline: "1234567" } },
    ]);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right).toContain('baseline: "1234567"');
    const decoded = decodeArtifactFrontmatter("plan", result.right);
    expect(Either.isRight(decoded)).toBe(true);
    if (!Either.isRight(decoded)) return;
    expect(decoded.right).toMatchObject({ approved: { baseline: "1234567" } });
  });

  it("fails with missing-block when there is no frontmatter to rewrite", () => {
    const md = `# Plan\n\nStatus: Draft\n`;
    const result = setFrontmatterKeys(md, [{ key: "status", value: "Approved" }]);
    expect(result).toEqual(Either.left({ kind: "missing-block" }));
  });
});

describe("fingerprintSource", () => {
  it("is identical for two documents differing only in status", () => {
    const other = PLAN_DOC.replace("status: Approved", "status: Draft");
    expect(fingerprintSource(PLAN_DOC)).toBe(fingerprintSource(other));
  });

  it("is identical for two documents differing only in approved", () => {
    const other = PLAN_DOC.replace("baseline: 4ae687b", "baseline: 9999999");
    expect(fingerprintSource(PLAN_DOC)).toBe(fingerprintSource(other));
  });

  it("is identical for two documents differing in both status and approved", () => {
    const other = PLAN_DOC.replace("status: Approved", "status: Draft").replace(
      "baseline: 4ae687b",
      "baseline: 9999999",
    );
    expect(fingerprintSource(PLAN_DOC)).toBe(fingerprintSource(other));
  });

  it("differs when source-spec differs", () => {
    const other = PLAN_DOC.replace(
      "source-spec: docs/specs/26-artifact-frontmatter-metadata.md",
      "source-spec: docs/specs/27-other.md",
    );
    expect(fingerprintSource(PLAN_DOC)).not.toBe(fingerprintSource(other));
  });

  it("differs when the body differs", () => {
    const other = PLAN_DOC.replace("Body text.", "Different body text.");
    expect(fingerprintSource(PLAN_DOC)).not.toBe(fingerprintSource(other));
  });

  it("returns the document verbatim when there is no frontmatter block", () => {
    const md = `# Plan\n\nStatus: Draft\n`;
    expect(fingerprintSource(md)).toBe(md);
  });
});
