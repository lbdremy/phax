import { describe, it, expect } from "vitest";
import { Schema, Either } from "effect";
import { ExtractedPhaxPlanSchema, PhaxPlanSchema } from "../../src/schemas/phaxPlan.js";

const decodeExtracted = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

const decodePhaxPlan = Schema.decodeUnknownEither(PhaxPlanSchema, {
  onExcessProperty: "error",
});

const basePhase = {
  id: "phase-01",
  title: "First Phase",
  model: "claude-sonnet-4-6",
  effort: "low",
  planMarkdownAnchor: "#phase-01-first",
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
  commit: { subject: "feat: do thing", body: "Does the thing." },
};

describe("ExtractedPhaxPlanSchema — requiredCommands", () => {
  it("decodes successfully when requiredCommands is present and non-empty", () => {
    const result = decodeExtracted({
      version: 1,
      run: {
        shortName: "my-run",
        title: "My Run",
        requiredCommands: ["deno fmt", "deno lint"],
      },
      phases: [basePhase],
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.run.requiredCommands).toEqual(["deno fmt", "deno lint"]);
    }
  });

  it("decodes successfully when requiredCommands is an empty array", () => {
    const result = decodeExtracted({
      version: 1,
      run: {
        shortName: "my-run",
        title: "My Run",
        requiredCommands: [],
      },
      phases: [basePhase],
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("fails decode when requiredCommands is absent", () => {
    const result = decodeExtracted({
      version: 1,
      run: {
        shortName: "my-run",
        title: "My Run",
      },
      phases: [basePhase],
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PhaxPlanSchema — requiredCommands", () => {
  it("decodes successfully with requiredCommands on run", () => {
    const result = decodePhaxPlan({
      version: 1,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "phax/my-run",
        requiredCommands: ["pnpm test"],
      },
      phases: [basePhase],
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.run.requiredCommands).toEqual(["pnpm test"]);
    }
  });

  it("fails decode when requiredCommands is absent from persisted plan", () => {
    const result = decodePhaxPlan({
      version: 1,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "phax/my-run",
      },
      phases: [basePhase],
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
