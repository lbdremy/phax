import { describe, expect, it } from "vitest";
import {
  NO_ARCHITECTURE_PROVIDER,
  architectureRequest,
} from "../../../src/domain/architecture/request.js";

describe("architectureRequest", () => {
  it("asks for the whole repository with null files", () => {
    expect(architectureRequest(null)).toEqual({ files: null });
  });

  it("carries the paths as given", () => {
    expect(architectureRequest(["src/core/billing/totals.ts", "src/http"])).toEqual({
      files: ["src/core/billing/totals.ts", "src/http"],
    });
  });
});

describe("NO_ARCHITECTURE_PROVIDER", () => {
  it("is one line", () => {
    expect(NO_ARCHITECTURE_PROVIDER).not.toContain("\n");
  });

  it("points the agent to the code and its documentation, and says it is no failure", () => {
    expect(NO_ARCHITECTURE_PROVIDER).toContain("the code and its documentation");
    expect(NO_ARCHITECTURE_PROVIDER).toContain("README");
    expect(NO_ARCHITECTURE_PROVIDER).toContain("CLAUDE.md");
    expect(NO_ARCHITECTURE_PROVIDER).toContain("not a failure of the repository");
  });
});
