import { describe, expect, it } from "vitest";
import { outsideBriefRequest, phaseBriefRequest } from "../../src/domain/brief/request.js";
import type { GateRequest } from "../../src/schemas/gateRequest.js";

// Made-up phase facts.
const facts: GateRequest = {
  phase: "phase-02",
  base: "0123456789abcdef0123456789abcdef01234567",
  terminal: true,
  phases: [
    { id: "phase-01", files: ["src/billing/port.ts"] },
    { id: "phase-02", files: ["src/billing/invoice.ts", "src/billing/tax.ts"] },
  ],
};

describe("phaseBriefRequest", () => {
  it("copies the four facts unchanged, then files, in the format's key order", () => {
    const request = phaseBriefRequest(facts, null);
    expect(Object.keys(request)).toEqual(["phase", "base", "terminal", "phases", "files"]);
    expect(request).toEqual({ ...facts, files: null });
    expect(request.phases).toEqual(facts.phases);
  });

  it("carries a list of paths as given", () => {
    const request = phaseBriefRequest(facts, ["src/billing/tax.ts", "docs/notes.md"]);
    expect(request.files).toEqual(["src/billing/tax.ts", "docs/notes.md"]);
    expect(request.phase).toBe("phase-02");
  });
});

describe("outsideBriefRequest", () => {
  it("holds exactly the paths", () => {
    expect(outsideBriefRequest(["src/greet.ts"])).toStrictEqual({ files: ["src/greet.ts"] });
  });
});
