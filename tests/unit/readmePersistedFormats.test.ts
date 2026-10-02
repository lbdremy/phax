// The README's Persisted formats table and Read phax files from code
// section: checks it lists exactly the package's formats and exports, and
// that its example is the smoked consumer script (spec §6, §11).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as schemasPackage from "../../packages/schemas/src/index.js";
import { JSON_SCHEMA_FORMATS } from "../../packages/schemas/build/jsonSchemas.js";
import { FORMAT_IDS } from "../../src/schemas/schemaUrl.js";
import { CONSUMER_SCRIPT } from "../../scripts/schemas-smoke.js";

const readme = readFileSync(join(import.meta.dirname, "../../README.md"), "utf8");

function tableRows(heading: string): ReadonlyArray<ReadonlyArray<string>> {
  const headingIndex = readme.indexOf(heading);
  if (headingIndex === -1) throw new Error(`README.md has no "${heading}" section`);
  const afterHeading = readme.slice(headingIndex + heading.length);
  const nextHeadingIndex = afterHeading.search(/\n## /);
  const section = nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex);
  const lines = section.split("\n").filter((line) => line.trim().startsWith("|"));
  // Drop the header row and the `| --- |` separator row.
  return lines.slice(2).map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
}

function cellCode(cell: string): string {
  return cell.replace(/`/g, "");
}

describe("README persisted formats", () => {
  it("has no Experimental formats section", () => {
    expect(readme).not.toContain("## Experimental formats");
  });

  const rows = tableRows("## Persisted formats");

  it("lists every format id plus record-manifest, each once", () => {
    const ids = rows.map((row) => cellCode(row[1]!));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set([...FORMAT_IDS, "record-manifest"]));
  });

  it("names a real exported function for every 'Read it with' entry", () => {
    for (const row of rows) {
      const fn = cellCode(row[3]!);
      expect(
        typeof (schemasPackage as Record<string, unknown>)[fn],
        `${fn} is not exported by packages/schemas/src/index.ts`,
      ).toBe("function");
    }
  });

  it("names the right JSON Schema file for every format id", () => {
    const byFormat = new Map(JSON_SCHEMA_FORMATS.map((entry) => [entry.format, entry.fileName]));
    for (const row of rows) {
      const id = cellCode(row[1]!);
      const jsonSchemaCell = cellCode(row[4]!);
      expect(jsonSchemaCell).toContain(byFormat.get(id));
    }
  });
});

describe("Read phax files from code", () => {
  it("embeds the smoked consumer script verbatim", () => {
    const heading = "## Read phax files from code";
    const headingIndex = readme.indexOf(heading);
    expect(headingIndex).toBeGreaterThan(-1);
    const after = readme.slice(headingIndex);
    const match = after.match(/```js\n([\s\S]*?)```/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(CONSUMER_SCRIPT);
  });
});
