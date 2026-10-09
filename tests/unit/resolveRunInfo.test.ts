import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Either } from "effect";
import { decodeShortName } from "../../src/domain/branded.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";

const now = new Date().toISOString();

function makeRunStatus(namespace: string, shortName: string, state = "running"): object {
  return {
    $schema: currentSchemaUrl("run-status"),
    namespace,
    shortName,
    runId: `${shortName}-id`,
    state,
    createdAt: now,
    updatedAt: now,
    phasesCount: 1,
  };
}

function makePhaseStatus(shortName: string): object {
  return {
    $schema: currentSchemaUrl("phase-status"),
    phaseId: "phase-01",
    phaseIndex: 0,
    state: "running",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: `phax/${shortName}--phase-01`,
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
  };
}

function writeRun(stateRoot: string, namespace: string, shortName: string): void {
  const runPath = join(stateRoot, "runs", `${namespace}.${shortName}`);
  mkdirSync(join(runPath, "phase-01"), { recursive: true });
  writeFileSync(
    join(runPath, "run-status.json"),
    JSON.stringify(makeRunStatus(namespace, shortName)),
  );
  writeFileSync(
    join(runPath, "phase-01", "status.json"),
    JSON.stringify(makePhaseStatus(shortName)),
  );
}

describe("resolveRun — qualified key lookup", () => {
  let stateRoot: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-resolverun-test-"));
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("resolves a run at the qualified key <namespace>.<shortName>", () => {
    writeRun(stateRoot, "my-project", "fix-bug");

    const shortName = Either.getOrThrow(decodeShortName("fix-bug"));
    const result = resolveRun("my-project", shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error("expected success");
    expect(result.right.namespace).toBe("my-project");
    expect(result.right.shortName).toBe("fix-bug");
  });

  it("two runs with the same shortName in different namespaces resolve independently", () => {
    writeRun(stateRoot, "ns-a", "shared-name");
    writeRun(stateRoot, "ns-b", "shared-name");

    const shortName = Either.getOrThrow(decodeShortName("shared-name"));

    const resultA = resolveRun("ns-a", shortName, stateRoot);
    const resultB = resolveRun("ns-b", shortName, stateRoot);

    expect(Either.isRight(resultA)).toBe(true);
    expect(Either.isRight(resultB)).toBe(true);

    if (Either.isLeft(resultA) || Either.isLeft(resultB))
      throw new Error("expected both to succeed");
    expect(resultA.right.namespace).toBe("ns-a");
    expect(resultB.right.namespace).toBe("ns-b");
    expect(resultA.right.runPath).not.toBe(resultB.right.runPath);
  });

  it("returns Left when run folder does not exist for the given namespace", () => {
    writeRun(stateRoot, "ns-b", "fix-bug");

    const shortName = Either.getOrThrow(decodeShortName("fix-bug"));
    const result = resolveRun("ns-a", shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("resolveRun — a phase status phax cannot read", () => {
  let stateRoot: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-resolverun-test-"));
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  const shortName = Either.getOrThrow(decodeShortName("fix-bug"));
  const statusPath = (): string =>
    join(stateRoot, "runs", "my-project.fix-bug", "phase-01", "status.json");

  it("refuses the run with the reader's message when phase-01/status.json lacks base", () => {
    writeRun(stateRoot, "my-project", "fix-bug");
    const { base: _base, ...withoutBase } = makePhaseStatus("fix-bug") as Record<string, unknown>;
    writeFileSync(statusPath(), JSON.stringify(withoutBase));

    const result = resolveRun("my-project", shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected a refusal");
    expect(result.left).toMatch(new RegExp(`^${statusPath()}: .*base`));
  });

  it("still skips a phase folder without status.json", () => {
    writeRun(stateRoot, "my-project", "fix-bug");
    mkdirSync(join(stateRoot, "runs", "my-project.fix-bug", "phase-02"));

    const result = resolveRun("my-project", shortName, stateRoot);

    if (Either.isLeft(result)) throw new Error(`expected success: ${result.left}`);
    expect(result.right.phaseStatuses.map((p) => p.phaseId)).toEqual(["phase-01"]);
  });
});
