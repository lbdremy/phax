import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Result } from "effect";
import { decodeShortName } from "../../src/domain/branded.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import type { RunStatus } from "../../src/schemas/status.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { runStatusFile } from "../helpers/runStatusFixture.js";

const now = new Date().toISOString();

function makeRunStatus(namespace: string, shortName: string, state = "running"): object {
  return runStatusFile({
    namespace,
    shortName,
    runId: `${shortName}-id`,
    state: state as RunStatus["state"],
    createdAt: now,
    updatedAt: now,
    phasesCount: 1,
  });
}

function makePhaseStatus(shortName: string): object {
  return phaseStatusFile({
    phaseId: "phase-01",
    phaseIndex: 0,
    state: "running",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: `phax/${shortName}--phase-01`,
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
  });
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

    const shortName = Result.getOrThrow(decodeShortName("fix-bug"));
    const result = resolveRun("my-project", shortName, stateRoot);

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) throw new Error("expected success");
    expect(result.success.namespace).toBe("my-project");
    expect(result.success.shortName).toBe("fix-bug");
  });

  it("two runs with the same shortName in different namespaces resolve independently", () => {
    writeRun(stateRoot, "ns-a", "shared-name");
    writeRun(stateRoot, "ns-b", "shared-name");

    const shortName = Result.getOrThrow(decodeShortName("shared-name"));

    const resultA = resolveRun("ns-a", shortName, stateRoot);
    const resultB = resolveRun("ns-b", shortName, stateRoot);

    expect(Result.isSuccess(resultA)).toBe(true);
    expect(Result.isSuccess(resultB)).toBe(true);

    if (Result.isFailure(resultA) || Result.isFailure(resultB))
      throw new Error("expected both to succeed");
    expect(resultA.success.namespace).toBe("ns-a");
    expect(resultB.success.namespace).toBe("ns-b");
    expect(resultA.success.runPath).not.toBe(resultB.success.runPath);
  });

  it("returns Left when run folder does not exist for the given namespace", () => {
    writeRun(stateRoot, "ns-b", "fix-bug");

    const shortName = Result.getOrThrow(decodeShortName("fix-bug"));
    const result = resolveRun("ns-a", shortName, stateRoot);

    expect(Result.isFailure(result)).toBe(true);
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

  const shortName = Result.getOrThrow(decodeShortName("fix-bug"));
  const statusPath = (): string =>
    join(stateRoot, "runs", "my-project.fix-bug", "phase-01", "status.json");

  it("refuses the run with the reader's message when phase-01/status.json lacks base", () => {
    writeRun(stateRoot, "my-project", "fix-bug");
    const { base: _base, ...withoutBase } = makePhaseStatus("fix-bug") as Record<string, unknown>;
    writeFileSync(statusPath(), JSON.stringify(withoutBase));

    const result = resolveRun("my-project", shortName, stateRoot);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) throw new Error("expected a refusal");
    expect(result.failure).toMatch(new RegExp(`^${statusPath()}: .*base`));
  });

  it("still skips a phase folder without status.json", () => {
    writeRun(stateRoot, "my-project", "fix-bug");
    mkdirSync(join(stateRoot, "runs", "my-project.fix-bug", "phase-02"));

    const result = resolveRun("my-project", shortName, stateRoot);

    if (Result.isFailure(result)) throw new Error(`expected success: ${result.failure}`);
    expect(result.success.phaseStatuses.map((p) => p.phaseId)).toEqual(["phase-01"]);
  });
});

describe("resolveRun — the final phase branch", () => {
  let stateRoot: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-resolverun-test-"));
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  const shortName = Result.getOrThrow(decodeShortName("fix-bug"));
  const runPath = (): string => join(stateRoot, "runs", "my-project.fix-bug");

  /** A plan whose run branch is `phax/fix-bug`, so the derived final branch is `phax/fix-bug--phase-01`. */
  function writePlan(): void {
    writeFileSync(
      join(runPath(), "phax-plan.json"),
      JSON.stringify({
        version: 1,
        run: {
          shortName: "fix-bug",
          title: "Fix bug",
          branch: "phax/fix-bug",
          requiredCommands: [],
        },
        phases: [
          {
            id: "phase-01",
            title: "Phase 01",
            model: "claude-sonnet-4-6",
            effort: "low",
            planMarkdownAnchor: "#phase-01",
            plannedFilesToCreate: [],
            plannedFilesToEdit: [],
            optionalFilesToEdit: [],
            commit: { subject: "feat: phase-01", body: "Phase 01 body" },
          },
        ],
      }),
    );
  }

  it("is the branch the final phase recorded, not the name derived from the plan's run branch", () => {
    writeRun(stateRoot, "my-project", "fix-bug");
    writePlan();
    writeFileSync(
      join(runPath(), "phase-01", "status.json"),
      JSON.stringify({
        ...(makePhaseStatus("fix-bug") as Record<string, unknown>),
        branchName: "feature/fix-bug--phase-01",
      }),
    );

    const result = resolveRun("my-project", shortName, stateRoot);

    if (Result.isFailure(result)) throw new Error(`expected success: ${result.failure}`);
    expect(result.success.branch).toBe("phax/fix-bug");
    expect(result.success.finalPhaseBranch).toBe("feature/fix-bug--phase-01");
  });

  it("is derived from the plan's run branch when no phase recorded one", () => {
    const shortRunPath = runPath();
    mkdirSync(shortRunPath, { recursive: true });
    writeFileSync(
      join(shortRunPath, "run-status.json"),
      JSON.stringify(makeRunStatus("my-project", "fix-bug")),
    );
    writePlan();

    const result = resolveRun("my-project", shortName, stateRoot);

    if (Result.isFailure(result)) throw new Error(`expected success: ${result.failure}`);
    expect(result.success.finalPhaseBranch).toBe("phax/fix-bug--phase-01");
  });
});
