import { describe, expect, it } from "vitest";
import {
  decodeClaudeSessionId,
  decodePhaseId,
  decodeRunId,
  decodeWorktreePath,
} from "../../src/domain/branded.js";
import type { PhaxEvent, PhaxEventType } from "../../src/domain/events.js";
import { RateLimitError } from "../../src/domain/errors.js";
import { Either } from "effect";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const runId = unwrap(decodeRunId("run-1"));
const phaseId = unwrap(decodePhaseId("phase-01"));
const sessionId = unwrap(decodeClaudeSessionId("session-1"));
const worktreePath = unwrap(decodeWorktreePath("/tmp/wt"));

const base = {
  eventId: "evt-1",
  occurredAt: "2026-05-20T12:00:00Z",
  run: runId,
} as const;

const rateLimitError = new RateLimitError({
  message: "rate limited",
  rawMessage: "rate limited",
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
  RunArchiveRequested: { ...base, type: "RunArchiveRequested" },
  RunFailed: { ...base, type: "RunFailed", cause: new Error("boom") },
  FinalReviewOpened: { ...base, type: "FinalReviewOpened" },
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
    command: "pnpm test",
    exitCode: 1,
    logPath: "/tmp/gate.log",
    attempt: 0,
  },
  FixStarted: { ...base, type: "FixStarted", phase: phaseId, attempt: 1 },
  FixCompleted: { ...base, type: "FixCompleted", phase: phaseId, sessionId },
  FixAttemptsExhausted: { ...base, type: "FixAttemptsExhausted", phase: phaseId },
  HandoffRequested: { ...base, type: "HandoffRequested", phase: phaseId },
  HandoffValidated: { ...base, type: "HandoffValidated", phase: phaseId },
  HandoffMissing: {
    ...base,
    type: "HandoffMissing",
    phase: phaseId,
    missingSections: ["## Summary"],
  },
  CommitCreated: { ...base, type: "CommitCreated", phase: phaseId, hash: "abc123" },
  CleanupStarted: { ...base, type: "CleanupStarted", phase: phaseId },
  CleanupCompleted: { ...base, type: "CleanupCompleted", phase: phaseId },
  RateLimitDetected: {
    ...base,
    type: "RateLimitDetected",
    phase: phaseId,
    kind: "rate_limit",
    cause: rateLimitError,
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
    case "GatePassed":
    case "FixStarted":
      return `${event.type}:${event.attempt}`;
    case "GateFailed":
      return `${event.type}:${event.command}:${event.exitCode}:${event.attempt}`;
    case "HandoffMissing":
      return `${event.type}:${event.missingSections.join(",")}`;
    case "CommitCreated":
      return `${event.type}:${event.hash}`;
    case "RateLimitDetected":
      return `${event.type}:${event.kind}`;
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
