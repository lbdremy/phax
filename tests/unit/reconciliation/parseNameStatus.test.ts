import { describe, expect, it } from "vitest";
import { parseNameStatus } from "../../../src/domain/reconciliation/parseNameStatus.js";
import type { ChangeStatus } from "../../../src/domain/reconciliation/types.js";

describe("parseNameStatus", () => {
  it("parses added files", () => {
    const result = parseNameStatus("A\tsrc/foo.ts");
    const status: ChangeStatus = "added";
    expect(result).toEqual([{ status, path: "src/foo.ts" }]);
  });

  it("parses modified files", () => {
    const result = parseNameStatus("M\tsrc/bar.ts");
    expect(result).toEqual([{ status: "modified", path: "src/bar.ts" }]);
  });

  it("parses deleted files", () => {
    const result = parseNameStatus("D\tsrc/baz.ts");
    expect(result).toEqual([{ status: "deleted", path: "src/baz.ts" }]);
  });

  it("parses renamed files with similarity score", () => {
    const result = parseNameStatus("R90\tsrc/old.ts\tsrc/new.ts");
    expect(result).toEqual([{ status: "renamed", path: "src/new.ts", oldPath: "src/old.ts" }]);
  });

  it("parses copy as added at new path", () => {
    const result = parseNameStatus("C85\tsrc/orig.ts\tsrc/copy.ts");
    expect(result).toEqual([{ status: "added", path: "src/copy.ts" }]);
  });

  it("handles multiple lines", () => {
    const result = parseNameStatus("A\tsrc/a.ts\nM\tsrc/b.ts\nD\tsrc/c.ts");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: "added", path: "src/a.ts" });
    expect(result[1]).toEqual({ status: "modified", path: "src/b.ts" });
    expect(result[2]).toEqual({ status: "deleted", path: "src/c.ts" });
  });

  it("skips blank lines", () => {
    const result = parseNameStatus("A\tsrc/a.ts\n\n\nM\tsrc/b.ts\n");
    expect(result).toHaveLength(2);
  });

  it("trims trailing whitespace on lines", () => {
    const result = parseNameStatus("A\tsrc/a.ts  \nM\tsrc/b.ts\t");
    expect(result).toHaveLength(2);
    expect(result[0]!.path).toBe("src/a.ts");
    expect(result[1]!.path).toBe("src/b.ts");
  });

  it("skips unknown status codes", () => {
    const result = parseNameStatus("X\tsrc/unknown.ts\nA\tsrc/a.ts");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ status: "added", path: "src/a.ts" });
  });

  it("handles empty input", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus("  \n  \n")).toEqual([]);
  });

  it("parses R100 rename", () => {
    const result = parseNameStatus("R100\tsrc/old-name.ts\tsrc/new-name.ts");
    expect(result).toEqual([
      { status: "renamed", path: "src/new-name.ts", oldPath: "src/old-name.ts" },
    ]);
  });
});
