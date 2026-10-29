import { describe, expect, it } from "vitest";
import {
  decodeBranchName,
  decodeClaudeSessionId,
  decodePhaseId,
  decodeRunId,
  decodeWorktreePath,
} from "../../src/domain/branded.js";
import type { PhaxEvent, PhaxEventType } from "../../src/domain/events.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import { AgentSessionFailedError, RateLimitError } from "../../src/domain/errors.js";
import { Either } from "effect";
import { reviewStop } from "../helpers/phaseStatusFixture.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const runId = unwrap(decodeRunId("run-1"));
const phaseId = unwrap(decodePhaseId("phase-01"));
const sessionId = unwrap(decodeClaudeSessionId("session-1"));
const worktreePath = unwrap(decodeWorktreePath("/tmp/wt"));

const reviewInfo: RunReviewInfo = {
  namespace: "test",
  shortName: "run-1",
  runId: "run-1",
  runState: "review_open",
  branch: "ai/run-1",
  runTitle: "Run 1",
  finalPhaseBranch: unwrap(decodeBranchName("ai/run-1--phase-01")),
  stateRoot: "/tmp/state",
  runPath: "/tmp/state/runs/run-1",
  finalPhaseId: "phase-01",
  finalPhaseTitle: "Phase 01",
  worktreePath: "/tmp/wt",
  claudeSessionId: undefined,
  gateProfileId: "full",
  phaseStatuses: [],
  planPhases: [],
  updatedAt: "2026-05-20T12:00:00Z",
  stoppedReason: undefined,
  lastError: undefined,
};

const base = {
  eventId: "evt-1",
  occurredAt: "2026-05-20T12:00:00Z",
  run: runId,
} as const;

const rateLimitError = new RateLimitError({
  message: "rate limited",
  rawMessage: "rate limited",
});

const networkFailureError = new AgentSessionFailedError({
  message: "claude-code session failed (network): API Error: getaddrinfo ENOTFOUND",
  failure: {
    provider: "claude-code",
    kind: "network",
    message: "API Error: getaddrinfo ENOTFOUND",
    sessionId: "session-9",
    resetAt: null,
  },
  agentErrorLog: null,
  transcript: null,
});

/**
 * Sample one event of every variant. Used both to verify constructibility
 * and to drive the exhaustiveness check below — if a new variant is added
 * to PhaxEvent, this map fails to type-check until it is covered.
 */
const samples = {
  RunStarted: { ...base, type: "RunStarted" },
  RunResumeRequested: { ...base, type: "RunResumeRequested" },
  RunInterruptRequested: { ...base, type: "RunInterruptRequested" },
  RunArchiveRequested: {
    ...base,
    type: "RunArchiveRequested",
    force: false,
    from: "/tmp/state/runs/run-1",
    to: "/tmp/state/archive/run-1",
  },
  RunFailed: { ...base, type: "RunFailed", cause: new Error("boom") },
  FinalReviewOpened: { ...base, type: "FinalReviewOpened", info: reviewInfo },
  RunCompleted: { ...base, type: "RunCompleted" },
  PhaseStartRequested: { ...base, type: "PhaseStartRequested", phaseId },
  WorktreeCreated: { ...base, type: "WorktreeCreated", phase: phaseId, path: worktreePath },
  AgentInvocationStarted: { ...base, type: "AgentInvocationStarted", phase: phaseId },
  AgentInvocationCompleted: {
    ...base,
    type: "AgentInvocationCompleted",
    phase: phaseId,
    sessionId,
  },
  GateStarted: { ...base, type: "GateStarted", phase: phaseId, attempt: 0 },
  GatePassed: { ...base, type: "GatePassed", phase: phaseId, attempt: 0 },
  GateFailed: {
    ...base,
    type: "GateFailed",
    phase: phaseId,
    failedStep: "configured",
    command: "pnpm test",
    exitCode: 1,
    protectedChanges: [],
    logPath: "/tmp/gate.log",
    attempt: 0,
  },
  FixStarted: { ...base, type: "FixStarted", phase: phaseId, attempt: 1 },
  FixCompleted: { ...base, type: "FixCompleted", phase: phaseId, sessionId },
  FixAttemptsExhausted: {
    ...base,
    type: "FixAttemptsExhausted",
    phase: phaseId,
    phaseId,
    attempt: 3,
    worktreePath,
    sessionId,
    command: "pnpm test",
    failedStep: "configured",
    protectedChanges: [],
    lastFixTranscript: null,
  },
  GateStepRefused: {
    ...base,
    type: "GateStepRefused",
    phase: phaseId,
    phaseId,
    attempt: 1,
    worktreePath,
    sessionId,
    command: "node ./audit.mjs",
    failedStep: "configured",
    reason: "the checks need hw-rules 2, and 1 is installed",
    remedy: "pnpm add -D hw-rules@2",
    protectedChanges: [],
  },
  HandoffRequested: { ...base, type: "HandoffRequested", phase: phaseId },
  HandoffValidated: { ...base, type: "HandoffValidated", phase: phaseId },
  HandoffMissing: {
    ...base,
    type: "HandoffMissing",
    phase: phaseId,
    missingSections: ["## Summary"],
  },
  CommitCreated: { ...base, type: "CommitCreated", phase: phaseId, hash: "abc123" },
  CommitFailed: {
    ...base,
    type: "CommitFailed",
    phase: phaseId,
    phaseId,
    worktreePath,
    sessionId,
    reason: "hook rejected",
  },
  CleanupStarted: { ...base, type: "CleanupStarted", phase: phaseId },
  CleanupCompleted: { ...base, type: "CleanupCompleted", phase: phaseId },
  CleanupFailed: {
    ...base,
    type: "CleanupFailed",
    phase: phaseId,
    phaseId,
    worktreePath,
    reason: "cleanup command failed",
  },
  PhaseHadNoChanges: {
    ...base,
    type: "PhaseHadNoChanges",
    phase: phaseId,
    phaseId,
    worktreePath,
    sessionId,
    reason: "empty diff",
  },
  ArtifactCompletionFailed: {
    ...base,
    type: "ArtifactCompletionFailed",
    phase: phaseId,
    phaseId,
    worktreePath,
    reason: "dirty artifact",
  },
  PhaseResetRequested: { ...base, type: "PhaseResetRequested", phaseId },
  RateLimitDetected: {
    ...base,
    type: "RateLimitDetected",
    phase: phaseId,
    kind: "rate_limit",
    cause: rateLimitError,
  },
  NetworkFailureDetected: {
    ...base,
    type: "NetworkFailureDetected",
    phase: phaseId,
    cause: networkFailureError,
    worktreePath,
    sessionId,
  },
  HandoffTurnFailed: {
    ...base,
    type: "HandoffTurnFailed",
    phase: phaseId,
    cause: networkFailureError,
  },
  HandoffProtectedPathsChanged: {
    ...base,
    type: "HandoffProtectedPathsChanged",
    phase: phaseId,
    changes: [
      { path: "a/steme.baseline.json", kind: "edited", entry: "protectedPaths[0]", glob: "**/x" },
    ],
    worktreePath,
  },
  ReviewStopReached: {
    ...base,
    type: "ReviewStopReached",
    phaseId,
    cause: "declared",
    worktreePath,
    reviewStop: reviewStop(),
  },
  StopCloseRefused: {
    ...base,
    type: "StopCloseRefused",
    phaseId,
    lastClose: { result: "interrupted", at: base.occurredAt, exitCode: 130 },
  },
  StopCommitted: {
    ...base,
    type: "StopCommitted",
    phaseId,
    hash: "abc123",
    closure: { outcome: "unchanged", closedBy: { name: "Ada Example", email: "ada@example.com" } },
  },
  HeldStopClosed: {
    ...base,
    type: "HeldStopClosed",
    phaseId,
    phaseCommit: "abc123",
    closure: {
      outcome: "corrected",
      reviewCommit: "def456",
      oracleStep: "none",
      closedBy: { name: "Ada Example", email: "ada@example.com" },
    },
  },
  HoldPointFailed: {
    ...base,
    type: "HoldPointFailed",
    phaseId,
    phaseCommit: "abc123",
    worktreePath,
    reason: "the seed could not be written",
  },
  StopRecordRefused: {
    ...base,
    type: "StopRecordRefused",
    phaseId,
    cause: "declared",
    phaseCommit: "abc123",
    worktreePath,
    reason: "records destination refused",
  },
} satisfies { readonly [K in PhaxEventType]: PhaxEvent & { type: K } };

function assertNever(x: never): never {
  throw new Error(`Unexpected event variant: ${JSON.stringify(x)}`);
}

/**
 * Total visitor over PhaxEvent — exists purely to fail compilation when a
 * new variant is added to PhaxEvent without being handled here.
 */
function visit(event: PhaxEvent): string {
  switch (event.type) {
    case "RunStarted":
    case "RunResumeRequested":
    case "RunInterruptRequested":
    case "RunArchiveRequested":
    case "FinalReviewOpened":
    case "RunCompleted":
    case "AgentInvocationStarted":
    case "FixAttemptsExhausted":
    case "HandoffRequested":
    case "HandoffValidated":
    case "CleanupStarted":
    case "CleanupCompleted":
      return event.type;
    case "RunFailed":
      return `${event.type}:${String(event.cause)}`;
    case "PhaseStartRequested":
      return `${event.type}:${event.phaseId}`;
    case "WorktreeCreated":
      return `${event.type}:${event.path}`;
    case "AgentInvocationCompleted":
    case "FixCompleted":
      return `${event.type}:${event.sessionId}`;
    case "GateStarted":
    case "FixStarted":
      return `${event.type}:${event.attempt}`;
    case "GatePassed":
      return `${event.type}:${event.attempt}`;
    case "GateFailed":
      return event.failedStep === "protected-paths"
        ? `${event.type}:${event.failedStep}:${event.attempt}`
        : `${event.type}:${event.command}:${event.exitCode}:${event.attempt}`;
    case "GateStepRefused":
      return `${event.type}:${event.command}:${event.remedy}`;
    case "HandoffMissing":
      return `${event.type}:${event.missingSections.join(",")}`;
    case "HandoffProtectedPathsChanged":
      return `${event.type}:${event.changes.map((change) => change.path).join(",")}`;
    case "CommitCreated":
      return `${event.type}:${event.hash}`;
    case "CommitFailed":
    case "CleanupFailed":
    case "PhaseHadNoChanges":
    case "ArtifactCompletionFailed":
      return `${event.type}:${event.phaseId}:${event.reason}`;
    case "PhaseResetRequested":
      return `${event.type}:${event.phaseId}`;
    case "RateLimitDetected":
      return `${event.type}:${event.kind}`;
    case "NetworkFailureDetected":
    case "HandoffTurnFailed":
      return `${event.type}:${event.cause.failure.kind}`;
    case "ReviewStopReached":
      return `${event.type}:${event.phaseId}:${event.cause}`;
    case "StopCloseRefused":
      return `${event.type}:${event.lastClose.result}`;
    case "StopCommitted":
      return `${event.type}:${event.hash}:${event.closure.outcome}`;
    case "HeldStopClosed":
      return `${event.type}:${event.phaseCommit}:${event.closure.outcome}`;
    case "HoldPointFailed":
      return `${event.type}:${event.phaseId}:${event.reason}`;
    case "StopRecordRefused":
      return `${event.type}:${event.phaseId}:${event.cause}:${event.reason}`;
    default:
      return assertNever(event);
  }
}

describe("PhaxEvent", () => {
  it("exposes a sample of every variant covering PhaxEventType", () => {
    const keys = Object.keys(samples).toSorted();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const event = samples[key as PhaxEventType];
      expect(event.type).toBe(key);
      expect(event.run).toBe(runId);
      expect(event.eventId).toBe("evt-1");
    }
  });

  it("visits every variant exhaustively (round-trip via discriminator)", () => {
    for (const event of Object.values(samples) as PhaxEvent[]) {
      const out = visit(event);
      expect(out.startsWith(event.type)).toBe(true);
    }
  });

  it("preserves payload on RateLimitDetected", () => {
    const event = samples.RateLimitDetected;
    expect(event.kind).toBe("rate_limit");
    expect(event.cause).toBe(rateLimitError);
  });

  it("preserves the session failure on NetworkFailureDetected and HandoffTurnFailed", () => {
    expect(samples.NetworkFailureDetected.cause).toBe(networkFailureError);
    expect(samples.NetworkFailureDetected.sessionId).toBe(sessionId);
    expect(samples.HandoffTurnFailed.cause.failure.kind).toBe("network");
  });

  it("preserves payload on GateFailed", () => {
    const event = samples.GateFailed;
    expect(event.exitCode).toBe(1);
    expect(event.attempt).toBe(0);
    expect(event.command).toBe("pnpm test");
  });

  it("preserves payload on HandoffMissing", () => {
    expect(samples.HandoffMissing.missingSections).toEqual(["## Summary"]);
  });
});
