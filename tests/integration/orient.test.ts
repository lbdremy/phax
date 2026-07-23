import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { expandOrientRow, queryOrientIndex } from "../../src/app/orient.js";
import { OrientProviderError } from "../../src/domain/errors.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { OrientConfig } from "../../src/schemas/phaxConfig.js";

const cwd = "/fake/worktrees/my-run/phase-02";
const config: OrientConfig = { command: "orient-provider" };

describe("queryOrientIndex", () => {
  it("returns the decoded index on a happy path", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({
        rows: [{ id: "row-1", title: "Watch X", severity: "warn", trigger: "touches foo.ts" }],
      }),
      stderr: "",
    });

    const result = await Effect.runPromise(
      queryOrientIndex(config, ["src/foo.ts"], cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.rows).toHaveLength(1);
      expect(result.right.rows[0]?.id).toBe("row-1");
    }
    expect(fakeShell.impl.calls).toHaveLength(1);
    expect(fakeShell.impl.calls[0]?.command).toEqual(["orient-provider"]);
    expect(fakeShell.impl.calls[0]?.stdin).toBe(JSON.stringify({ files: ["src/foo.ts"] }));
  });

  it("returns a typed failure on a non-zero exit", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "boom" });

    const result = await Effect.runPromise(
      queryOrientIndex(config, ["src/foo.ts"], cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(OrientProviderError);
      expect(result.left.exitCode).toBe(1);
    }
  });

  it("returns a typed failure on garbage stdout", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "not json", stderr: "" });

    const result = await Effect.runPromise(
      queryOrientIndex(config, ["src/foo.ts"], cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(OrientProviderError);
    }
  });

  it("returns a typed failure when the decoded response fails schema validation", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({ rows: [{ id: "row-1" }] }),
      stderr: "",
    });

    const result = await Effect.runPromise(
      queryOrientIndex(config, ["src/foo.ts"], cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("expandOrientRow", () => {
  it("returns the decoded row on a happy path", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({
        row: {
          id: "row-1",
          title: "Watch X",
          severity: "warn",
          trigger: "touches foo.ts",
          body: "Full explanation.",
        },
      }),
      stderr: "",
    });

    const result = await Effect.runPromise(
      expandOrientRow(config, "row-1", cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.row?.body).toBe("Full explanation.");
    }
    expect(fakeShell.impl.calls[0]?.stdin).toBe(JSON.stringify({ expand: "row-1" }));
  });

  it("returns a null row when the provider has nothing to serve", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({
      exitCode: 0,
      stdout: JSON.stringify({ row: null }),
      stderr: "",
    });

    const result = await Effect.runPromise(
      expandOrientRow(config, "row-1", cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.row).toBeNull();
    }
  });

  it("returns a typed failure on a non-zero exit", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "boom" });

    const result = await Effect.runPromise(
      expandOrientRow(config, "row-1", cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(OrientProviderError);
      expect(result.left.exitCode).toBe(1);
    }
  });

  it("returns a typed failure on garbage stdout", async () => {
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "not json", stderr: "" });

    const result = await Effect.runPromise(
      expandOrientRow(config, "row-1", cwd).pipe(Effect.provide(fakeShell.layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(OrientProviderError);
    }
  });
});

describe("orient provider command tokenisation", () => {
  // `NonEmptyString` admits a whitespace-only command; it must surface as a
  // typed failure, never as a defect that would fail the dispatching phase.
  it("returns a typed failure for a whitespace-only command without spawning", async () => {
    const fakeShell = makeFakeShell();

    const result = await Effect.runPromise(
      queryOrientIndex({ command: "   " }, ["src/foo.ts"], cwd).pipe(
        Effect.provide(fakeShell.layer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(OrientProviderError);
      expect(result.left.message).toContain("empty");
    }
    expect(fakeShell.impl.calls).toHaveLength(0);
  });
});
