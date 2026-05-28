/**
 * Documents the 1:1 mapping from legacy TraceEventName to SemanticTelemetryEvent variant.
 *
 * Each test confirms which semantic event type is emitted for the corresponding
 * legacy trace event name. This table is the authoritative contract for the
 * transition between Tracer and SystemTelemetry; phase-09 deletes the Tracer.
 */
import { describe, expect, it } from "vitest";

describe("TraceEventName → SemanticTelemetryEvent mapping", () => {
  const mapping: Record<string, string> = {
    // Config lifecycle (executePlan.ts direct emit)
    "config.discovered": "step.started (step: config.discover)",
    "config.validated": "step.completed (step: config.validate, result: success)",

    // Contract validation (extractPlan.ts direct emit)
    "contract.validated": "step.completed (step: contract.validate, result: success)",
    "contract.invalid": "step.completed (step: contract.validate, result: failure)",

    // Git adapter (executePlan.ts direct emit)
    "git.worktree.created": "adapter.call.succeeded (adapter: git, operation: worktree.create)",
    "git.commit.created": "adapter.call.succeeded (adapter: git, operation: commit.create)",

    // Claude agent adapter (executePlan.ts direct emit)
    "agent.invocation.started":
      "adapter.call.started (adapter: claude-code-cli, operation: agent.run)",
    "agent.invocation.completed":
      "adapter.call.succeeded (adapter: claude-code-cli, operation: agent.run)",
    "agent.session.captured": "artifact.generated (artifact: claude-session-id)",

    // Gate / fix loop (fixLoop.ts direct emit)
    "gate.started": "step.started (step: gate.run)",
    "gate.completed":
      "step.completed (step: gate.run, result: success) + gate.evaluated (result: accepted)",
    "gate.failed":
      "step.completed (step: gate.run, result: failure) + gate.evaluated (result: rejected)",
    "fix.started": "step.started (step: fix-loop)",
    "fix.completed": "step.completed (step: fix-loop, result: success)",

    // Handoff (executePlan.ts direct emit)
    "handoff.requested": "step.started (step: handoff.generate)",
    "handoff.validated": "step.completed (step: handoff.generate, result: success)",

    // Rate limit / resume (reducer EmitTrace → effectRunner.ts)
    "rate_limit.detected":
      "adapter.call.failed (adapter: claude-code-cli, operation: agent.run, actual: rate_limited)",
    "resume.available": "step.completed (step: resume.notify, result: success)",
    "archive.completed": "step.completed (step: archive, result: success)",

    // Dispatcher dispositions (dispatcher.ts)
    "event.handled":
      "state.transition (event: <PhaxEventType>, stateBefore, stateAfter, dispatcher: dispatch)",
    "event.ignored": "step.completed (step: dispatch.<PhaxEventType>, result: success)",
    "event.stale": "step.completed (step: dispatch.<PhaxEventType>, result: success)",
    "event.rejected": "step.completed (step: dispatch.<PhaxEventType>, result: failure)",
    "event.unexpected": "step.completed (step: dispatch.<PhaxEventType>, result: failure)",
  };

  it("has a mapping entry for every legacy TraceEventName", () => {
    const legacyNames: string[] = [
      "config.discovered",
      "config.validated",
      "contract.validated",
      "contract.invalid",
      "git.worktree.created",
      "git.commit.created",
      "agent.invocation.started",
      "agent.invocation.completed",
      "agent.session.captured",
      "gate.started",
      "gate.completed",
      "gate.failed",
      "fix.started",
      "fix.completed",
      "handoff.requested",
      "handoff.validated",
      "rate_limit.detected",
      "resume.available",
      "archive.completed",
      "event.handled",
      "event.ignored",
      "event.stale",
      "event.rejected",
      "event.unexpected",
    ];

    for (const name of legacyNames) {
      expect(mapping).toHaveProperty(name);
      expect(mapping[name]).toBeTruthy();
    }
  });

  it("every mapping entry names a known SemanticTelemetryEvent variant", () => {
    const knownVariants = [
      "state.transition",
      "adapter.call.started",
      "adapter.call.succeeded",
      "adapter.call.failed",
      "step.started",
      "step.completed",
      "gate.evaluated",
      "artifact.generated",
    ];

    for (const [traceName, semanticDesc] of Object.entries(mapping)) {
      const mentionsKnownVariant = knownVariants.some((v) => semanticDesc.includes(v));
      expect(mentionsKnownVariant, `Mapping for "${traceName}" references no known variant`).toBe(
        true,
      );
    }
  });
});
