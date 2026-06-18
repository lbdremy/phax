import { describe, it, expect } from "vitest";
import { Effect, Either, Layer } from "effect";
import { extractPlanCore } from "../../src/app/extractPlan.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { PlanValidationError } from "../../src/domain/errors.js";

// The model emits everything except `title`; phax derives titles from headings.
function extractedJson(phases: ReadonlyArray<{ id: string; anchor: string }>): string {
  return JSON.stringify({
    version: 1,
    run: { shortName: "my-run", title: "My Run", requiredCommands: [] },
    phases: phases.map((p) => ({
      id: p.id,
      model: "claude-sonnet-4-6",
      effort: "low",
      planMarkdownAnchor: p.anchor,
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: `feat: ${p.id}`, body: "body" },
    })),
  });
}

function run(planMd: string, finalText: string) {
  const fakeFs = makeFakeFileSystem();
  const fakeBackend = makeFakeBackend();
  const fakeTelemetry = makeFakeSystemTelemetry();

  fakeFs.impl.setFile("/repo/plan.md", planMd);
  fakeBackend.impl.addRunResponse({
    sessionId: "sess-1" as ClaudeSessionId,
    outputPath: "/repo/out.json",
    finalText,
  });

  const layer = Layer.mergeAll(fakeFs.layer, fakeBackend.layer, fakeTelemetry.layer);
  return Effect.runPromise(
    Effect.either(
      extractPlanCore({
        planMdPath: "/repo/plan.md",
        model: "claude-sonnet-4-6",
        effort: "low",
        cwd: "/repo",
      }).pipe(Effect.provide(layer)),
    ),
  );
}

describe("extractPlanCore — title derivation from headings", () => {
  it("derives phase titles from headings even though the model omits them", async () => {
    const planMd = [
      "# Plan — My Run",
      "",
      "## phase-01 — Alpha phase {#phase-01-alpha}",
      "",
      "## phase-02 — Beta phase {#phase-02-beta}",
    ].join("\n");
    const result = await run(
      planMd,
      extractedJson([
        { id: "phase-01", anchor: "#phase-01-alpha" },
        { id: "phase-02", anchor: "#phase-02-beta" },
      ]),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.plan.phases.map((p) => p.title)).toEqual(["Alpha phase", "Beta phase"]);
    }
  });

  it("preserves a title containing double quotes (the case that derailed extraction)", async () => {
    const planMd = [
      "# Plan — My Run",
      "",
      '## phase-01 — Guard "all I/O goes through a port" {#phase-01-quoted}',
    ].join("\n");
    const result = await run(
      planMd,
      extractedJson([{ id: "phase-01", anchor: "#phase-01-quoted" }]),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.plan.phases[0]!.title).toBe('Guard "all I/O goes through a port"');
    }
  });

  it("fails loudly when a phase has no matching heading", async () => {
    const planMd = ["# Plan — My Run", "", "## phase-01 — Alpha phase {#phase-01-alpha}"].join(
      "\n",
    );
    // Model reports phase-02 but the plan has no phase-02 heading.
    const result = await run(
      planMd,
      extractedJson([
        { id: "phase-01", anchor: "#phase-01-alpha" },
        { id: "phase-02", anchor: "#phase-02-missing" },
      ]),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PlanValidationError);
      expect(result.left.message).toContain("phase-02");
    }
  });
});
