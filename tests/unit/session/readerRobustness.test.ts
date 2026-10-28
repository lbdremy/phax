import { describe, expect, it } from "vitest";
import { scanCodexOutcomeEvents } from "../../../src/schemas/codexOutput.js";
import {
  readClaudeOutcome,
  readCodexOutcome,
  readVibeOutcome,
} from "../../../src/domain/session/outcome.js";
import type {
  EndedSession,
  SessionEnd,
  VibeExportRead,
} from "../../../src/domain/session/outcome.js";

const exited = (code: number): SessionEnd => ({ kind: "exited", code });

// Lines a provider might print that no reader may choke on.
const MALFORMED_LINES: readonly string[] = [
  "",
  "   ",
  "not json",
  "{",
  "}",
  "null",
  "42",
  '"text"',
  "[]",
  '{"type":null}',
  '{"type":"result"}',
  '{"type":"result","is_error":"yes","subtype":3}',
  '{"type":"system","subtype":"api_retry","error":{"message":7}}',
  '{"type":"turn.failed","error":"flat"}',
  '{"type":"error","message":null}',
  '{"type":"item.completed","item":{"type":"agent_message"}}',
  '{"type":"message","role":"assistant","content":"flat"}',
  "\u0000�",
];

const MALFORMED_EXPORTS: readonly VibeExportRead[] = [
  { kind: "text", path: "/tmp/export.json", text: "" },
  { kind: "text", path: "/tmp/export.json", text: "{" },
  { kind: "text", path: "/tmp/export.json", text: "null" },
  { kind: "text", path: "/tmp/export.json", text: '{"schema_version":1,"error":"flat"}' },
  { kind: "absent", path: "/tmp/export.json" },
  { kind: "unreadable", path: "/tmp/export.json", detail: "EACCES" },
  { kind: "not-requested" },
];

const ENDS: readonly SessionEnd[] = [
  exited(0),
  exited(1),
  { kind: "signalled", signal: "SIGTERM" },
  { kind: "timed-out" },
];

describe("the readers on malformed output", () => {
  it("return an outcome for every malformed line and every end, whatever the reader", () => {
    for (const end of ENDS) {
      const ended: EndedSession = { lines: MALFORMED_LINES, stderr: "\n\n", end };
      expect(readClaudeOutcome(ended).kind).toBe("failure");
      expect(readCodexOutcome(ended).kind).toBe("failure");
      for (const exported of MALFORMED_EXPORTS) {
        expect(["answer", "failure"]).toContain(readVibeOutcome(ended, exported).kind);
      }
    }
  });

  it("read each malformed line alone without throwing", () => {
    for (const line of MALFORMED_LINES) {
      const ended: EndedSession = { lines: [line], stderr: "", end: exited(0) };
      expect(readClaudeOutcome(ended).kind).toBe("failure");
      expect(readCodexOutcome(ended).kind).toBe("failure");
      expect(readVibeOutcome(ended, { kind: "not-requested" }).kind).toBe("failure");
    }
  });

  it("read nothing at all as unknown when the process exited silently", () => {
    const ended: EndedSession = { lines: [], stderr: "", end: exited(1) };
    for (const outcome of [readClaudeOutcome(ended), readCodexOutcome(ended)]) {
      expect(outcome).toMatchObject({ kind: "failure", failure: { kind: "unknown" } });
    }
  });
});

describe("scanCodexOutcomeEvents", () => {
  it("reads the thread id, the last agent message, the turn's end and the last error", () => {
    const events = scanCodexOutcomeEvents([
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({ type: "thread.started", thread_id: "t2" }),
      JSON.stringify({ type: "error", message: "first" }),
      JSON.stringify({ type: "error", message: "Reconnecting... 2/5" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "one" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "two" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_2", type: "command_execution", aggregated_output: "429" },
      }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }),
    ]);
    expect(events).toEqual({
      threadId: "t1",
      agentMessage: "two",
      turnEnd: { kind: "completed" },
      errorMessage: "Reconnecting... 2/5",
    });
  });

  it("reads a turn.failed's message, and none when it has no error", () => {
    const withMessage = scanCodexOutcomeEvents([
      JSON.stringify({ type: "turn.failed", error: { message: "tool crashed" } }),
    ]);
    const without = scanCodexOutcomeEvents([JSON.stringify({ type: "turn.failed" })]);
    expect(withMessage.turnEnd).toEqual({ kind: "failed", message: "tool crashed" });
    expect(without.turnEnd).toEqual({ kind: "failed", message: undefined });
  });

  it("lets the last of turn.completed and turn.failed decide", () => {
    const events = scanCodexOutcomeEvents([
      JSON.stringify({ type: "turn.failed", error: { message: "x" } }),
      JSON.stringify({ type: "turn.completed" }),
    ]);
    expect(events.turnEnd).toEqual({ kind: "completed" });
  });

  it("skips lines that are not events it reads", () => {
    expect(scanCodexOutcomeEvents(["", "not json", "null", '{"type":"turn.started"}'])).toEqual({
      threadId: undefined,
      agentMessage: undefined,
      turnEnd: undefined,
      errorMessage: undefined,
    });
  });
});
