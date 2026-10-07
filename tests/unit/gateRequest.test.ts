import { describe, expect, it } from "vitest";
import { makeGateRequest, requestPathFor } from "../../src/domain/gate/gateRequest.js";

const base = "0123456789abcdef0123456789abcdef01234567";

describe("makeGateRequest", () => {
  it("orders the keys phase, base, terminal, phases", () => {
    const request = makeGateRequest({ phaseId: "phase-01", base, terminal: false, phases: [] });
    expect(Object.keys(request)).toEqual(["phase", "base", "terminal", "phases"]);
  });

  it("projects every phase to its create ∪ edit files, deduplicated in plan order", () => {
    const request = makeGateRequest({
      phaseId: "phase-02",
      base,
      terminal: false,
      phases: [
        {
          id: "phase-01",
          plannedFilesToCreate: ["src/greet.ts", "tests/greet.test.ts"],
          plannedFilesToEdit: ["src/index.ts", "src/greet.ts"],
        },
        { id: "phase-02", plannedFilesToCreate: [], plannedFilesToEdit: ["README.md"] },
      ],
    });
    expect(request.phases).toEqual([
      { id: "phase-01", files: ["src/greet.ts", "tests/greet.test.ts", "src/index.ts"] },
      { id: "phase-02", files: ["README.md"] },
    ]);
  });

  it("excludes optional files", () => {
    const phase = {
      id: "phase-01",
      plannedFilesToCreate: ["src/a.ts"],
      plannedFilesToEdit: [],
      optionalFilesToEdit: ["src/optional.ts"],
    };
    const request = makeGateRequest({ phaseId: "phase-01", base, terminal: true, phases: [phase] });
    expect(request.phases).toEqual([{ id: "phase-01", files: ["src/a.ts"] }]);
  });

  it("passes phase, base and terminal through", () => {
    for (const terminal of [true, false]) {
      const request = makeGateRequest({ phaseId: "phase-03", base, terminal, phases: [] });
      expect(request).toMatchObject({ phase: "phase-03", base, terminal });
    }
  });
});

describe("requestPathFor", () => {
  it("replaces a trailing .log with .request.json", () => {
    expect(requestPathFor("/runs/r/phase-01/checks-attempt-01.log")).toBe(
      "/runs/r/phase-01/checks-attempt-01.request.json",
    );
  });

  it("appends .request.json to a path without .log", () => {
    expect(requestPathFor("/runs/r/phase-01/checks")).toBe("/runs/r/phase-01/checks.request.json");
  });
});
