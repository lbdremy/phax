import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as conformanceEntry from "../../../../src/cli/commandLibrary/contract/conformance/index.js";
import * as entry from "../../../../src/cli/commandLibrary/contract/index.js";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const INDEX = "../../../../src/cli/commandLibrary/contract/index.ts";
const CONFORMANCE = "../../../../src/cli/commandLibrary/contract/conformance/index.ts";

/** The library's own names, unchanged. */
const libraryValues = [
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
const libraryTypes = [
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

/** The names the port's gains add. */
const gainValues = ["AliasAnnotationId", "CompleterAnnotationId", "Refused", "stdinFlagHelp"];
const gainTypes = ["Completer", "ErrorText", "ProgramUsage", "RunContext", "StdinDocument"];

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The names an entry re-exports; throws on a statement that is not a re-export. */
function reExported(source: string): string[] {
  const statements = withoutComments(source)
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
  return names;
}

describe("the root entry", () => {
  it("exposes exactly the library's values and the gains' at run time", () => {
    expect(Object.keys(entry).toSorted()).toEqual([...libraryValues, ...gainValues].toSorted());
  });

  it("only re-exports, and the names it re-exports are the library's and the gains'", () => {
    expect(reExported(read(INDEX)).toSorted()).toEqual(
      [...libraryValues, ...gainValues, ...libraryTypes, ...gainTypes].toSorted(),
    );
  });
});

describe("the conformance entry", () => {
  it("exposes exactly conformance at run time", () => {
    expect(Object.keys(conformanceEntry)).toEqual(["conformance"]);
  });

  it("only re-exports ConformanceReport and conformance", () => {
    expect(reExported(read(CONFORMANCE)).toSorted()).toEqual(["ConformanceReport", "conformance"]);
  });
});
