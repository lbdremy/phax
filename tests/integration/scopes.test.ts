import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { queryClosedScopes } from "../../src/app/scopes.js";
import { ScopesProviderError } from "../../src/domain/errors.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { ScopesConfig } from "../../src/schemas/phaxConfig.js";
import type { ScopesRequest } from "../../src/domain/plan/projection.js";

const cwd = "/fake/worktrees/my-run/phase-02";
const config: ScopesConfig = { command: "scopes-provider" };
const request: ScopesRequest = {
  phase: "phase-02",
  phases: [
    { id: "phase-01", files: ["src/core/port.ts"] },
    { id: "phase-02", files: ["src/core/invoice.ts"] },
  ],
};

describe("queryClosedScopes", () => {
  it("returns the decoded closed scopes on a happy path", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({ closed: ["core"] }),
      stderr: "",
    });

    const result = await Effect.runPromise(
      queryClosedScopes(config, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.closed).toEqual(["core"]);
    }
    expect(fakeShell.impl.calls).toHaveLength(1);
    expect(fakeShell.impl.calls[0]?.command).toEqual(["scopes-provider"]);
    expect(fakeShell.impl.calls[0]?.stdin).toBe(JSON.stringify(request));
  });

  it("returns a typed failure on a non-zero exit", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "boom" });

    const result = await Effect.runPromise(
      queryClosedScopes(config, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ScopesProviderError);
      expect(result.left.exitCode).toBe(1);
      expect(result.left.stderrExcerpt).toBe("boom");
      expect(result.left.message).toContain("Scope provider");
    }
  });

  it("returns a typed failure on garbage stdout", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "not json", stderr: "" });

    const result = await Effect.runPromise(
      queryClosedScopes(config, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ScopesProviderError);
      expect(result.left.message).toContain("invalid JSON");
    }
  });

  it("returns a typed failure when the decoded response fails schema validation", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({ closed: [1] }),
      stderr: "",
    });

    const result = await Effect.runPromise(
      queryClosedScopes(config, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("schema validation");
      expect(result.left.message).toContain("closed");
    }
  });

  it("returns a typed failure for a whitespace-only command without spawning", async () => {
    const fakeShell = makeFakeShell();

    const result = await Effect.runPromise(
      queryClosedScopes({ command: "   " }, request, cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ScopesProviderError);
      expect(result.left.message).toContain("empty");
    }
    expect(fakeShell.impl.calls).toHaveLength(0);
  });
});
