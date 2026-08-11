import { describe, expect, it } from "vitest";
import { parseDirtyPaths } from "../../../src/schemas/git.js";

describe("parseDirtyPaths", () => {
  it("returns an empty array for empty output", () => {
    expect(parseDirtyPaths("")).toEqual([]);
  });

  it("parses a modified path", () => {
    expect(parseDirtyPaths(" M src/foo.ts\n")).toEqual(["src/foo.ts"]);
  });

  it("parses a staged path", () => {
    expect(parseDirtyPaths("M  src/foo.ts\n")).toEqual(["src/foo.ts"]);
  });

  it("parses an untracked path", () => {
    expect(parseDirtyPaths("?? src/new.ts\n")).toEqual(["src/new.ts"]);
  });

  it("parses both sides of a rename line", () => {
    expect(parseDirtyPaths("R  old.ts -> new.ts\n")).toEqual(["old.ts", "new.ts"]);
  });

  it("parses multiple lines", () => {
    const output = " M src/foo.ts\n?? src/new.ts\nR  old.ts -> new.ts\n";
    expect(parseDirtyPaths(output)).toEqual(["src/foo.ts", "src/new.ts", "old.ts", "new.ts"]);
  });
});
