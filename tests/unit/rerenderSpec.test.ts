import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { rerenderSpec } from "../../scripts/rerender-spec.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { readSpecDocumentFile } from "../../src/schemas/persisted.js";
import { preSchemaDocuments, validDocuments, withKey } from "./schemasPackage/documents.js";

const MD_PATH = "docs/specs/2610010000-made-up.md";
const SIDECAR_PATH = "docs/specs/2610010000-made-up.json";
const FRONTMATTER = "---\nstatus: Draft\ndate: 2026-10-01\n---\n";

function specMarkdown(sidecar: unknown): string {
  const doc = readSpecDocumentFile(SIDECAR_PATH, sidecar);
  if (Either.isLeft(doc)) throw new Error(doc.left.message);
  return FRONTMATTER + renderSpecBody(doc.right);
}

describe("rerenderSpec", () => {
  // The sidecar phax writes since 0.17.0 carries `$schema`; the script read
  // it with the authoring decoder, which expects `version`, and refused it.
  it("re-renders from a $schema sidecar, keeping the frontmatter", () => {
    const sidecar = validDocuments["spec-document"];
    const md = specMarkdown(sidecar);
    expect(rerenderSpec(MD_PATH, md, SIDECAR_PATH, sidecar)).toEqual(Either.right(md));
  });

  it("re-renders from a pre-schema (version: 1) sidecar", () => {
    const sidecar = preSchemaDocuments["spec-document"];
    const md = specMarkdown(sidecar);
    expect(rerenderSpec(MD_PATH, md, SIDECAR_PATH, sidecar)).toEqual(Either.right(md));
  });

  it("applies a sidecar edit to the body and keeps the frontmatter", () => {
    const sidecar = validDocuments["spec-document"];
    const before = specMarkdown(sidecar);
    const edited = withKey(sidecar, "title", "An edited title");
    const result = rerenderSpec(MD_PATH, before, SIDECAR_PATH, edited);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).not.toBe(before);
      expect(result.right.startsWith(FRONTMATTER)).toBe(true);
      expect(result.right).toContain("An edited title");
    }
  });

  it("refuses an invalid sidecar, naming it", () => {
    const result = rerenderSpec(MD_PATH, FRONTMATTER, SIDECAR_PATH, { title: 1 });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.startsWith(SIDECAR_PATH)).toBe(true);
  });

  it("refuses a spec with no frontmatter", () => {
    const result = rerenderSpec(
      MD_PATH,
      "# No frontmatter\n",
      SIDECAR_PATH,
      validDocuments["spec-document"],
    );
    expect(result).toEqual(Either.left(`${MD_PATH}: no frontmatter block`));
  });
});
