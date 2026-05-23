import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Either } from "effect";
import { decodeShortName } from "../../src/domain/branded.js";
import { inspectResume } from "../../src/app/resume.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const shortName = unwrap(decodeShortName("test-run"));
const now = new Date().toISOString();

function makeRunStatus(state: string, extra: Record<string, unknown> = {}): object {
  return {
    version: 1,
    shortName: "test-run",
    runId: "test-run-123",
    state,
    createdAt: now,
    updatedAt: now,
    phasesCount: 1,
    ...extra,
  };
}

function makePhaseStatus(state: string): object {
  return {
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    state,
    model: "claude-sonnet-4-6",
    effort: "low",
    createdAt: now,
    updatedAt: now,
  };
}

describe("inspectResume", () => {
  let stateRoot: string;
  let runPath: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-resume-test-"));
    runPath = join(stateRoot, "runs", "test-run");
    mkdirSync(runPath, { recursive: true });
    mkdirSync(join(runPath, "phase-01"), { recursive: true });
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("refuses runs in created state with reason=created", () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("created")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("pending")),
    );

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("created");
    expect(result.left.message).toContain("test-run");
    expect(result.left.message).toContain("not been started");
  });

  it("refuses runs in failed state with reason=failed", () => {
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(makeRunStatus("failed", { lastError: "gate check failed" })),
    );
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("failed")),
    );

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("failed");
    expect(result.left.message).toContain("test-run");
    expect(result.left.message).toContain("failed");
  });

  it("refuses runs in review_open state with reason=review_open", () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("review_open")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("review_open")),
    );

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("review_open");
    expect(result.left.message).toContain("phax enter");
  });

  it("allows runs in rate_limited state", () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("rate_limited")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("rate_limited")),
    );

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error("expected decision");
    expect(result.right.fromState).toBe("rate_limited");
    expect(result.right.nextPhaseId).toBe("phase-01");
  });
});
