import { describe, it, expect } from "vitest";
import { Effect, Either, Layer } from "effect";
import { tmpdir } from "node:os";
import { extractPlanCore } from "../../src/app/extractPlan.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { RateLimitError } from "../../src/domain/errors.js";

const PLAN_MD = [
  "# Plan — Sealed extraction test",
  "",
  "## phase-01 — Alpha phase {#phase-01-alpha}",
  "",
  "Some phase content.",
].join("\n");

function validJson(): string {
  return JSON.stringify({
    version: 1,
    run: { shortName: "sealed-test", title: "Sealed extraction test", requiredCommands: [] },
    phases: [
      {
        id: "phase-01",
        model: "claude-sonnet-4-6",
        effort: "low",
        planMarkdownAnchor: "#phase-01-alpha",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        commit: { subject: "feat: phase-01", body: "body" },
      },
    ],
  });
}

function setup() {
  const fakeBackend = makeFakeBackend();
  const fakeFs = makeFakeFileSystem();
  fakeFs.impl.setFile("/repo/plan.md", PLAN_MD);
  const layer = Layer.mergeAll(fakeBackend.layer, fakeFs.layer);
  return { fakeBackend, fakeFs, layer };
}

describe("extractPlanCore — sealed completion path", () => {
  it("calls complete instead of runAgent", async () => {
    const { fakeBackend, fakeFs, layer } = setup();
    fakeBackend.impl.addCompletionResponse({ finalText: validJson() });

    const result = await Effect.runPromise(
      Effect.either(
        extractPlanCore({
          planMdPath: "/repo/plan.md",
          model: "claude-sonnet-4-6",
          effort: "low",
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    expect(fakeBackend.impl.completeCalls).toHaveLength(1);
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });

  it("passes a throwaway temp dir (not the repo path) to complete", async () => {
    const { fakeBackend, fakeFs, layer } = setup();
    fakeBackend.impl.addCompletionResponse({ finalText: validJson() });

    await Effect.runPromise(
      Effect.either(
        extractPlanCore({
          planMdPath: "/repo/plan.md",
          model: "claude-sonnet-4-6",
          effort: "low",
        }).pipe(Effect.provide(layer)),
      ),
    );

    const cwd = fakeBackend.impl.completeCalls[0]?.options.cwd;
    expect(cwd).toBeDefined();
    expect(cwd).not.toBe("/repo");
    expect(cwd).toMatch(/phax-extract-/);
    expect(cwd!.startsWith(tmpdir())).toBe(true);
  });

  it("removes the temp dir after a successful call", async () => {
    const { fakeBackend, fakeFs, layer } = setup();
    fakeBackend.impl.addCompletionResponse({ finalText: validJson() });

    await Effect.runPromise(
      Effect.either(
        extractPlanCore({
          planMdPath: "/repo/plan.md",
          model: "claude-sonnet-4-6",
          effort: "low",
        }).pipe(Effect.provide(layer)),
      ),
    );

    const cwd = fakeBackend.impl.completeCalls[0]?.options.cwd!;
    expect(fakeFs.impl.dirs.has(cwd)).toBe(false);
  });

  it("removes the temp dir even when complete fails", async () => {
    const { fakeBackend, fakeFs, layer } = setup();
    fakeBackend.impl.failCompleteWithRateLimit(0, { kind: "rate_limit" });

    const result = await Effect.runPromise(
      Effect.either(
        extractPlanCore({
          planMdPath: "/repo/plan.md",
          model: "claude-sonnet-4-6",
          effort: "low",
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    expect(result).toSatisfy((r) => Either.isLeft(r) && r.left instanceof RateLimitError);

    const cwd = fakeBackend.impl.completeCalls[0]?.options.cwd!;
    expect(fakeFs.impl.dirs.has(cwd)).toBe(false);
  });

  it("passes provider claude-code to complete", async () => {
    const { fakeBackend, fakeFs, layer } = setup();
    fakeBackend.impl.addCompletionResponse({ finalText: validJson() });

    await Effect.runPromise(
      Effect.either(
        extractPlanCore({ planMdPath: "/repo/plan.md", model: "my-model", effort: "high" }).pipe(
          Effect.provide(layer),
        ),
      ),
    );

    const opts = fakeBackend.impl.completeCalls[0]?.options;
    expect(opts?.provider).toBe("claude-code");
    expect(opts?.model).toBe("my-model");
    expect(opts?.effort).toBe("high");
  });
});
