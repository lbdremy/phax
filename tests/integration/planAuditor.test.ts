import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { queryPlanAuditor } from "../../src/app/planAuditor.js";
import { PlanAuditorError } from "../../src/domain/errors.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { PlanAuditorConfig } from "../../src/schemas/phaxConfig.js";
import type { PlanAuditRequest } from "../../src/domain/plan/projection.js";

const cwd = "/fake/repo";
const config: PlanAuditorConfig = { command: "audit-plan" };
const request: PlanAuditRequest = {
  phases: [
    { id: "phase-01", files: ["src/a.ts"] },
    { id: "phase-02", files: ["src/b.ts"] },
  ],
};

describe("queryPlanAuditor", () => {
  it("returns the decoded findings on a happy path", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({ findings: [{ message: "m", phases: ["phase-01"] }] }),
      stderr: "",
    });

    const result = await Effect.runPromise(
      queryPlanAuditor(config, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.findings).toEqual([{ message: "m", phases: ["phase-01"] }]);
    }
    expect(fakeShell.impl.calls).toHaveLength(1);
    expect(fakeShell.impl.calls[0]?.command).toEqual(["audit-plan"]);
    expect(fakeShell.impl.calls[0]?.stdin).toBe(JSON.stringify(request));
  });

  it("returns a typed failure on a non-zero exit", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "boom" });

    const result = await Effect.runPromise(
      queryPlanAuditor(config, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PlanAuditorError);
      expect(result.left.exitCode).toBe(1);
      expect(result.left.stderrExcerpt).toBe("boom");
      expect(result.left.message).toContain("Plan auditor");
    }
  });

  it("returns a typed failure on garbage stdout", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "not json", stderr: "" });

    const result = await Effect.runPromise(
      queryPlanAuditor(config, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PlanAuditorError);
      expect(result.left.message).toContain("invalid JSON");
    }
  });

  it("returns a typed failure when the decoded response fails schema validation", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({ findings: [{ message: "", phases: [] }] }),
      stderr: "",
    });

    const result = await Effect.runPromise(
      queryPlanAuditor(config, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("schema validation");
    }
  });

  it("returns a typed failure for a whitespace-only command without spawning", async () => {
    const fakeShell = makeFakeShell();

    const result = await Effect.runPromise(
      queryPlanAuditor({ command: "   " }, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PlanAuditorError);
      expect(result.left.message).toContain("empty");
    }
    expect(fakeShell.impl.calls).toHaveLength(0);
  });
});
