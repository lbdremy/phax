import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cases } from "../src/internal/conformance/cases.ts";

// The conformance case ids of the cli-json run (§5.28): one case per runner behaviour, under the
// same id in the TypeScript suite (`src/internal/conformance/cases.ts`) and in the Rust program
// tests, where a test is named after its id with `.` and `-` turned into `_`.
const RUN_IDS: ReadonlyArray<string> = [
  "output.encoded-without-render",
  "json.skips-render",
  "json.grouped",
  "json.reserved",
  "json.schema-first",
  "document.unwrapped",
  "error.line",
  "refused.line",
  "defect.line",
  "notes.lines",
  "catalogue.program",
  "catalogue.command",
  "stdin.flag-sources",
  "stdin.piped",
  "stdin.terminal-refused",
  "stdin.flag-absent-unread",
  "stdin.required-flag-absent",
  "stdin.unreadable-refused",
  "written.record",
  "out.path",
  "out.dash",
  "out.reserved",
  "error.written",
  "groups.own-contracts",
  "usage.from-definitions",
  "help.long-and-examples",
];

/** The Rust test files of the library that hold the cases; `written.record` may be in either. */
const rustTests = ["program.rs", "written.rs"]
  .map((name) =>
    readFileSync(
      new URL(
        `../../../rust/steme-lab-cli-command/tests/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  )
  .join("\n");

const rustName = (id: string): string => id.replace(/[.-]/g, "_");

describe("the case ids of the run", () => {
  const typescript = cases.map((each) => each.id);

  it("are all different", () => {
    expect(new Set(RUN_IDS).size).toBe(RUN_IDS.length);
    expect(new Set(typescript).size).toBe(typescript.length);
  });

  for (const id of RUN_IDS) {
    it(`${id} is a TypeScript case and a Rust test`, () => {
      expect(typescript).toContain(id);
      expect(rustTests).toMatch(new RegExp(`\\bfn ${rustName(id)}\\(`));
    });
  }
});
