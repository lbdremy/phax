import { describe, it, expect } from "vitest";
import { Effect, Layer, Schema, Either } from "effect";
import { extractPlanLlm } from "../../src/app/extractPlan.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { ExtractedPhaxPlanSchema, decodePhaxPlanFile } from "../../src/schemas/phaxPlan.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const decodeExtracted = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

const PHAX_PLAN_URL = schemaUrl("phax-plan", CURRENT_STAMPS["phax-plan"]);

// The extraction model's answer phase: no `title` (derived from the plan
// heading), no `mode` and no `oracle` (read from the header lines).
const baseAnswerPhase = {
  id: "phase-01",
  model: "claude-sonnet-4-6",
  effort: "low",
  planMarkdownAnchor: "#phase-01-first",
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
  commit: { subject: "feat: do thing", body: "Does the thing." },
};

// The extracted phase: the answer plus phax's `mode` and `oracle`.
const { commit: baseCommit, ...baseAnswerFields } = baseAnswerPhase;
const baseExtractedPhase = {
  ...baseAnswerFields,
  mode: "headless",
  oracle: null,
  commit: baseCommit,
};

// The persisted phase carries the heading-derived `title`.
const basePersistedPhase = { ...baseExtractedPhase, title: "First Phase" };

describe("ExtractedPhaxPlanSchema — title is not extracted", () => {
  it("decodes a phase that omits title", () => {
    const result = decodeExtracted({
      version: 1,
      run: { shortName: "my-run", title: "My Run", requiredCommands: [] },
      phases: [baseExtractedPhase],
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects a phase that includes title (excess property)", () => {
    const result = decodeExtracted({
      version: 1,
      run: { shortName: "my-run", title: "My Run", requiredCommands: [] },
      phases: [{ ...baseExtractedPhase, title: "Should Not Be Here" }],
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ExtractedPhaxPlanSchema — requiredCommands", () => {
  it("decodes successfully when requiredCommands is present and non-empty", () => {
    const result = decodeExtracted({
      version: 1,
      run: {
        shortName: "my-run",
        title: "My Run",
        requiredCommands: ["deno fmt", "deno lint"],
      },
      phases: [baseExtractedPhase],
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
      phases: [baseExtractedPhase],
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
      phases: [baseExtractedPhase],
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PhaxPlanFileSchema — requiredCommands", () => {
  it("decodes successfully with requiredCommands on run", () => {
    const result = decodePhaxPlanFile({
      $schema: PHAX_PLAN_URL,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "phax/my-run",
        requiredCommands: ["pnpm test"],
      },
      phases: [basePersistedPhase],
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.run.requiredCommands).toEqual(["pnpm test"]);
    }
  });

  it("fails decode when requiredCommands is absent from persisted plan", () => {
    const result = decodePhaxPlanFile({
      $schema: PHAX_PLAN_URL,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "phax/my-run",
      },
      phases: [basePersistedPhase],
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

/** The extraction model's final text: a plan answer carrying these phases. */
function answer(phases: readonly object[]): string {
  return JSON.stringify({
    version: 1,
    run: { shortName: "my-run", title: "My Run", requiredCommands: [] },
    phases,
  });
}

describe("extractPlanLlm — mode and oracle come from the header lines", () => {
  const PLAN_MD = [
    "# My Run",
    "",
    "## phase-01 — First {#phase-01-first}",
    "",
    "**Recommended model:** claude-sonnet-4-6",
    "**Recommended effort:** low",
    "**Mode:** interactive",
    "**Oracle phase:** yes",
    "**Oracle files:** `tests/a.test.ts`, `tests/b.test.ts`",
    "",
    "Does the first thing.",
    "",
    "## phase-02 — Second {#phase-02-second}",
    "",
    "**Recommended model:** claude-sonnet-4-6",
    "**Recommended effort:** low",
    "",
    "Does the second thing.",
    "",
  ].join("\n");

  const secondAnswerPhase = {
    ...baseAnswerPhase,
    id: "phase-02",
    planMarkdownAnchor: "#phase-02-second",
  };

  function extract(finalText: string) {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();
    backend.impl.addCompletionResponse({ finalText });
    return Effect.runPromise(
      Effect.either(
        extractPlanLlm(PLAN_MD, { model: "claude-sonnet-4-6", effort: "low" }).pipe(
          Effect.provide(Layer.merge(fs.layer, backend.layer)),
        ),
      ),
    );
  }

  it("adds mode and oracle to an answer that carries neither, after optionalFilesToEdit", async () => {
    const result = await extract(answer([baseAnswerPhase, secondAnswerPhase]));
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    const [first, second] = result.right.phases;
    expect(first!.mode).toBe("interactive");
    expect(first!.oracle).toEqual({
      dischargedBy: "phase-02",
      files: ["tests/a.test.ts", "tests/b.test.ts"],
    });
    expect(second!.mode).toBe("headless");
    expect(second!.oracle).toBeNull();
    const keys = Object.keys(first!);
    expect(keys.slice(keys.indexOf("optionalFilesToEdit"))).toEqual([
      "optionalFilesToEdit",
      "mode",
      "oracle",
      "commit",
    ]);
  });

  it("refuses an answer whose phases carry mode or oracle", async () => {
    const withMode = await extract(
      answer([{ ...baseAnswerPhase, mode: "headless" }, secondAnswerPhase]),
    );
    expect(Either.isLeft(withMode)).toBe(true);
    const withOracle = await extract(
      answer([{ ...baseAnswerPhase, oracle: null }, secondAnswerPhase]),
    );
    expect(Either.isLeft(withOracle)).toBe(true);
  });

  it("refuses an answer phase plan.md has no heading for, naming it", async () => {
    const result = await extract(
      answer([baseAnswerPhase, { ...secondAnswerPhase, id: "phase-07" }]),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.message).toContain("phase-07");
  });
});
