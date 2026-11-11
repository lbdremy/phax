import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodePhaseAgentBinding,
  encodePhaseAgentBinding,
  type PhaseAgentBinding,
} from "../../src/schemas/phaseAgentBinding.js";

const validBinding: PhaseAgentBinding = {
  version: 1,
  shortName: "agent-binding",
  runId: "run-abc123",
  phaseId: "phase-01",
  phaseIndex: 0,
  phaseName: "PhaseAgentBinding schema and provider mapping",
  provider: "claude-code",
  adapter: "claude",
  model: "claude-sonnet-4-6",
  effort: "low",
  sessionId: "sess_abc123",
  sessionHandle: null,
  worktreePath: "/home/user/.phax/worktrees/agent-binding/phase-01",
  cwd: "/home/user/.phax/worktrees/agent-binding/phase-01",
  launchedAt: "2026-06-18T00:00:00.000Z",
  status: "running",
};

describe("decodePhaseAgentBinding", () => {
  it("accepts a fully-populated valid binding", () => {
    expect(Result.isSuccess(decodePhaseAgentBinding(validBinding))).toBe(true);
  });

  it("accepts a binding with sessionId: null", () => {
    const binding = { ...validBinding, sessionId: null };
    expect(Result.isSuccess(decodePhaseAgentBinding(binding))).toBe(true);
  });

  it("accepts a binding with sessionHandle: null", () => {
    const binding = { ...validBinding, sessionHandle: null };
    expect(Result.isSuccess(decodePhaseAgentBinding(binding))).toBe(true);
  });

  it("accepts launching status with null sessionId", () => {
    const binding = { ...validBinding, status: "launching", sessionId: null };
    expect(Result.isSuccess(decodePhaseAgentBinding(binding))).toBe(true);
  });

  it("rejects an unknown provider", () => {
    const binding = { ...validBinding, provider: "openai" };
    expect(Result.isFailure(decodePhaseAgentBinding(binding))).toBe(true);
  });

  it("rejects an unknown adapter", () => {
    const binding = { ...validBinding, adapter: "openai" };
    expect(Result.isFailure(decodePhaseAgentBinding(binding))).toBe(true);
  });

  it("rejects an unknown status", () => {
    const binding = { ...validBinding, status: "paused" };
    expect(Result.isFailure(decodePhaseAgentBinding(binding))).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { model: _model, ...binding } = validBinding;
    expect(Result.isFailure(decodePhaseAgentBinding(binding))).toBe(true);
  });

  it("rejects a phaseId that doesn't match ^phase-\\d{2}$", () => {
    const binding = { ...validBinding, phaseId: "phase-1" };
    expect(Result.isFailure(decodePhaseAgentBinding(binding))).toBe(true);
  });

  it("rejects a phaseId that doesn't match pattern (prose)", () => {
    const binding = { ...validBinding, phaseId: "my-phase" };
    expect(Result.isFailure(decodePhaseAgentBinding(binding))).toBe(true);
  });
});

describe("encode → decode round-trip", () => {
  it("round-trips a valid binding", () => {
    const encoded = encodePhaseAgentBinding(validBinding);
    const decoded = decodePhaseAgentBinding(encoded);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual(validBinding);
    }
  });

  it("round-trips a binding with null sessionId and sessionHandle", () => {
    const binding: PhaseAgentBinding = {
      ...validBinding,
      sessionId: null,
      sessionHandle: null,
      status: "launching",
    };
    const encoded = encodePhaseAgentBinding(binding);
    const decoded = decodePhaseAgentBinding(encoded);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual(binding);
    }
  });
});
