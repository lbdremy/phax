import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as conformanceEntry from "../src/conformance.ts";
import * as entry from "../src/index.ts";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const pinnedValues = [
  "DocumentOutput",
  "OPTION_HELP",
  "Written",
  "argShapes",
  "catalogue",
  "commandContract",
  "defineCommand",
  "defineGroup",
  "defineProgram",
  "document",
  "encodedText",
  "flagShapes",
  "fullName",
  "kebabCase",
  "messages",
  "reject",
  "strip",
  "usageSpec",
  "written",
];
const pinnedTypes = [
  "ArgShape",
  "Binding",
  "Catalogue",
  "Command",
  "CommandContract",
  "CommandDef",
  "Document",
  "ErrorContract",
  "ExitCode",
  "FlagShape",
  "Group",
  "Grouping",
  "JsonSchema",
  "RefusalSource",
  "StdinContract",
  "Inputs",
  "Io",
  "Parsed",
  "Program",
  "ProgramExits",
  "Runner",
  "Source",
  "Tagged",
  "Terminal",
  "Undeclared",
];

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the root entry", () => {
  it("exposes exactly the pinned values at run time", () => {
    expect(Object.keys(entry).sort()).toEqual(pinnedValues);
  });

  it("only re-exports, and the names it re-exports are the pinned ones", () => {
    const statements = withoutComments(read("../src/index.ts"))
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const names: string[] = [];
    for (const statement of statements) {
      const match = /^export (?:type )?\{([^}]*)\} from "[^"]+"$/.exec(
        statement,
      );
      if (match === null) {
        throw new Error(`not a re-export: ${statement}`);
      }
      for (const name of (match[1] ?? "").split(",")) {
        if (name.trim() !== "") names.push(name.trim());
      }
    }
    expect(names.sort()).toEqual([...pinnedValues, ...pinnedTypes].sort());
  });

  it("is, with ./conformance, the only entries package.json exports", () => {
    const pkg = JSON.parse(read("../package.json")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(pkg.exports)).toEqual([".", "./conformance"]);
  });
});

describe("the conformance entry", () => {
  it("exposes exactly conformance at run time", () => {
    expect(Object.keys(conformanceEntry)).toEqual(["conformance"]);
  });

  it("only re-exports ConformanceReport and conformance", () => {
    const statements = withoutComments(read("../src/conformance.ts"))
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const names: string[] = [];
    for (const statement of statements) {
      const match = /^export (?:type )?\{([^}]*)\} from "[^"]+"$/.exec(
        statement,
      );
      if (match === null) {
        throw new Error(`not a re-export: ${statement}`);
      }
      for (const name of (match[1] ?? "").split(",")) {
        if (name.trim() !== "") names.push(name.trim());
      }
    }
    expect(names.sort()).toEqual(["ConformanceReport", "conformance"]);
  });
});
