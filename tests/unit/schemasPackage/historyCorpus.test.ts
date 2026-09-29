// Parses every committed corpus document with its format's own parse
// function on every gate (spec §5.18). A failure names the file and the
// first violation, so a real decoder gap is visible in `pnpm test`.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORPUS_PARSERS, corpusPath } from "../../../packages/schemas/build/corpus.js";
import { isFormatId } from "../../../src/schemas/schemaUrl.js";

const corpusRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages/schemas/corpus",
);

interface CorpusFile {
  readonly relativePath: string;
  readonly format: string;
  readonly shape: string;
  readonly name: string;
  readonly content: string;
}

function listCorpusFiles(): CorpusFile[] {
  const files: CorpusFile[] = [];
  for (const format of readdirSync(corpusRoot, { withFileTypes: true })) {
    if (!format.isDirectory()) continue;
    const formatDir = join(corpusRoot, format.name);
    for (const shape of readdirSync(formatDir, { withFileTypes: true })) {
      if (!shape.isDirectory()) continue;
      const shapeDir = join(formatDir, shape.name);
      for (const entry of readdirSync(shapeDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const path = join(shapeDir, entry.name);
        files.push({
          relativePath: relative(corpusRoot, path),
          format: format.name,
          shape: shape.name,
          name: entry.name,
          content: readFileSync(path, "utf8"),
        });
      }
    }
  }
  return files.toSorted((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
}

const files = listCorpusFiles();

describe("history corpus", () => {
  it("is not empty", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file): [string, CorpusFile] => [file.relativePath, file]))(
    "%s",
    (_relativePath, file) => {
      expect(isFormatId(file.format), `${file.relativePath}: unknown format directory`).toBe(true);
      if (!isFormatId(file.format)) return;

      expect(file.name, `${file.relativePath}: unexpected file name`).toMatch(
        /^[0-9a-f]{16}\.json$/,
      );
      const expectedPath = corpusPath(file.format, file.shape, file.content);
      expect(
        `${file.format}/${file.shape}/${file.name}`,
        `${file.relativePath}: file name does not match its content hash`,
      ).toBe(expectedPath);

      const value = JSON.parse(file.content);
      const result = CORPUS_PARSERS[file.format](value);
      expect(
        result.ok,
        result.ok
          ? undefined
          : `${file.relativePath}: ${result.error.path}: ${result.error.message}`,
      ).toBe(true);
      if (result.ok) {
        expect(result.shape, `${file.relativePath}: shape does not match its directory`).toBe(
          file.shape,
        );
      }
    },
  );

  it("holds a mixed history of the phase record's v1 and v2 shapes", () => {
    const v1 = files.filter(
      (file) => file.format === "phase-record-manifest" && file.shape === "v1",
    );
    const v2 = files.filter(
      (file) => file.format === "phase-record-manifest" && file.shape === "v2",
    );
    expect(v1.length).toBeGreaterThan(0);
    expect(v2.length).toBeGreaterThan(0);
  });

  it("holds both legacy authoring-record shapes, with and without sourceSha", () => {
    const manifests = files
      .filter((file) => file.format === "authoring-record-manifest" && file.shape === "v1")
      .map((file) => JSON.parse(file.content) as { sourceSha?: unknown });
    expect(manifests.length).toBeGreaterThan(0);
    expect(manifests.some((manifest) => typeof manifest.sourceSha === "string")).toBe(true);
    expect(manifests.some((manifest) => !("sourceSha" in manifest))).toBe(true);
  });
});
