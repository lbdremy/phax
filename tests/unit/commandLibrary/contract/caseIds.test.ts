import { describe, expect, it } from "vitest";
import { cases } from "../../../../src/cli/commandLibrary/contract/conformance/cases.js";

// The conformance case ids of the library's cli-json run (§5.28 of its spec): one case per
// runner behaviour, under the same id in the library's TypeScript suite and in its Rust twin's
// program tests. The port has no Rust twin, so only the TypeScript side is checked here.
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

// One case per gain the port carries for upstream.
const GAIN_IDS: ReadonlyArray<string> = [
  "groups.nested-alone-refused",
  "groups.nested-run",
  "usage.complete-nodes",
  "exits.verdict-code",
  "exits.verdict-collides",
  "stdin.text-document",
  "stdin.flag-value-required",
  "notes.progress-streamed",
  "error.text-form",
  "error.text-reached",
  "usage.program-flag",
  "usage.json-schema-listing",
  "usage.program-exits",
  "options.program-wide",
];

describe("the conformance case ids", () => {
  const ids = cases.map((each) => each.id);

  it("are all different", () => {
    expect(new Set(RUN_IDS).size).toBe(RUN_IDS.length);
    expect(new Set(GAIN_IDS).size).toBe(GAIN_IDS.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("are dotted lower-case words", () => {
    for (const id of ids) expect(id).toMatch(/^[a-z]+(\.[a-z-]+)*$/);
  });

  for (const id of [...RUN_IDS, ...GAIN_IDS]) {
    it(`${id} is a case`, () => {
      expect(ids).toContain(id);
    });
  }

  it("end with the gains' cases, in the order listed", () => {
    expect(ids.slice(-GAIN_IDS.length)).toEqual(GAIN_IDS);
  });
});
