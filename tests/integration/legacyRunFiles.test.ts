// ac-own-legacy for run files: a run-status.json written before phax wrote
// `$schema` (`version: 1`) is still read by the dispatcher and by run info, and
// rewritten with `$schema` first on the next state change. A phase status
// written before `$schema` lacks `base` and is refused
// (tests/unit/persisted.test.ts), so the phase status here is one phax writes
// today. Every run directory here is made up.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../../src/app/dispatcher.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import {
  decodeShortName,
  type ClaudeSessionId,
  type PhaseId,
  type RunId,
  type WorktreePath,
} from "../../src/domain/branded.js";
import { RateLimitError } from "../../src/domain/errors.js";
import type { PhaxEvent } from "../../src/domain/events.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";

const NAMESPACE = "example";
const SHORT_NAME = "example-run";
const CREATED_AT = "2026-01-01T09:00:00.000Z";

const preSchemaRunStatus = {
  version: 1,
  namespace: NAMESPACE,
  shortName: SHORT_NAME,
  runId: "run-0001",
  state: "running",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  phasesCount: 1,
  currentPhaseIndex: 0,
  gateProfileId: "standard",
  planRepoRelPath: "docs/plans/example.md",
};

const phaseStatus = {
  $schema: currentSchemaUrl("phase-status"),
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "running",
  model: "example-model",
  effort: "medium",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  branchName: "phax/example-run--phase-01",
  base: "0123456789abcdef0123456789abcdef01234567",
  worktreePath: "/work/example-repo/worktrees/phase-01",
  claudeSessionId: "session-0001",
};

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function withoutKeys(doc: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !keys.includes(key)));
}

describe("a run status written before $schema", () => {
  let stateRoot: string;
  let runPath: string;
  let runStatusPath: string;
  let phaseStatusPath: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-legacy-run-"));
    runPath = join(stateRoot, "runs", `${NAMESPACE}.${SHORT_NAME}`);
    runStatusPath = join(runPath, "run-status.json");
    phaseStatusPath = join(runPath, "phase-01", "status.json");
    mkdirSync(join(runPath, "phase-01"), { recursive: true });
    writeFileSync(runStatusPath, JSON.stringify(preSchemaRunStatus, null, 2));
    writeFileSync(phaseStatusPath, JSON.stringify(phaseStatus, null, 2));
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("is read by run info (loadRunReviewInfo)", () => {
    const result = resolveRun(NAMESPACE, Either.getOrThrow(decodeShortName(SHORT_NAME)), stateRoot);
    if (Either.isLeft(result)) throw new Error(result.left);
    expect(result.right.runId).toBe("run-0001");
    expect(result.right.runState).toBe("running");
    expect(result.right.gateProfileId).toBe("standard");
    expect(result.right.phaseStatuses).toHaveLength(1);
    expect(result.right.phaseStatuses[0]).toEqual(withoutKeys(phaseStatus, "$schema"));
  });

  it("is read by the dispatcher, and one transition rewrites it with $schema first", async () => {
    const layer = Layer.mergeAll(
      NodeFileSystemLayer,
      makeFakeSystemTelemetry().layer,
      makeFakeGit().layer,
      makeFakeShell().layer,
    );
    const event: PhaxEvent = {
      type: "RateLimitDetected",
      eventId: "evt-0001",
      occurredAt: "2026-01-01T10:00:00.000Z",
      run: SHORT_NAME as RunId,
      phase: "phase-01" as PhaseId,
      kind: "rate_limit",
      cause: new RateLimitError({ message: "rate limited", rawMessage: "429 example" }),
      worktreePath: phaseStatus.worktreePath as WorktreePath,
      sessionId: phaseStatus.claudeSessionId as ClaudeSessionId,
    };

    const result = await Effect.runPromise(
      dispatch(event, {
        runPath,
        shortName: SHORT_NAME,
        phaseFolderPath: join(runPath, "phase-01"),
        phaseId: "phase-01",
      }).pipe(Effect.provide(layer)),
    );
    expect(result.disposition).toBe("Handled");
    expect(result.stateBefore).toMatchObject({ run: "running", phase: { state: "running" } });

    const runStatus = readJson(runStatusPath);
    expect(Object.keys(runStatus)[0]).toBe("$schema");
    expect(runStatus["$schema"]).toBe(currentSchemaUrl("run-status"));
    expect(runStatus).not.toHaveProperty("version");
    expect(
      withoutKeys(runStatus, "$schema", "state", "updatedAt", "stoppedReason", "lastError"),
    ).toEqual(withoutKeys(preSchemaRunStatus, "version", "state", "updatedAt"));
    expect(runStatus["state"]).toBe("rate_limited");

    const rewritten = readJson(phaseStatusPath);
    expect(withoutKeys(rewritten, "state", "updatedAt")).toEqual(
      withoutKeys(phaseStatus, "state", "updatedAt"),
    );
    expect(rewritten["state"]).toBe("rate_limited");

    const reread = resolveRun(NAMESPACE, Either.getOrThrow(decodeShortName(SHORT_NAME)), stateRoot);
    expect(Either.isRight(reread)).toBe(true);
  });

  it("fails with a message naming the file when a status file is in no known shape", () => {
    writeFileSync(runStatusPath, JSON.stringify({ ...preSchemaRunStatus, version: 7 }));
    const result = resolveRun(NAMESPACE, Either.getOrThrow(decodeShortName(SHORT_NAME)), stateRoot);
    if (Either.isRight(result)) throw new Error("expected a failure");
    expect(result.left.startsWith(`${runStatusPath}: run status without $schema`)).toBe(true);
  });
});
