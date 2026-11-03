import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as entry from "../../../../src/cli/commandLibrary/commander/index.js";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const INDEX = "../../../../src/cli/commandLibrary/commander/index.ts";

const pinnedValues = ["processIo", "runner"];
const pinnedTypes: string[] = [];

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the root entry", () => {
  it("exposes exactly the pinned values at run time", () => {
    expect(Object.keys(entry).toSorted()).toEqual(pinnedValues);
  });

  it("only re-exports, and the names it re-exports are the pinned ones", () => {
    const statements = withoutComments(read(INDEX))
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const names: string[] = [];
    for (const statement of statements) {
      const match = /^export (?:type )?\{([^}]*)\} from "[^"]+"$/.exec(statement);
      if (match === null) {
        throw new Error(`not a re-export: ${statement}`);
      }
      for (const name of (match[1] ?? "").split(",")) {
        if (name.trim() !== "") names.push(name.trim());
      }
    }
    expect(names.toSorted()).toEqual([...pinnedValues, ...pinnedTypes].toSorted());
  });
});
