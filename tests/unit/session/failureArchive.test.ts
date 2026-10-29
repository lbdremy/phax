import { describe, expect, it } from "vitest";
import {
  archivedLogName,
  archivedTranscriptName,
  isArchivedTranscript,
  nextFailureNumber,
  transcriptOfLog,
  withTranscriptLine,
} from "../../../src/domain/session/failureArchive.js";

const LOG = [
  "failure: network",
  "provider: claude-code",
  "message: API Error: Connection dropped (ECONNRESET)",
  "session: 6d1f0c2a-3b4e-4f5a-8c9d-0e1f2a3b4c5d",
  "transcript: /state/runs/example.invoice-export/phase-02/output.jsonl",
  "",
  "claude --print --output-format stream-json",
  "exit code: 1",
  "",
  "transcript: a stderr line that happens to start the same way",
].join("\n");

describe("the archived failure names", () => {
  it("numbers the next archive after the highest one in the folder", () => {
    expect(nextFailureNumber(["output.jsonl", "agent-error.log"])).toBe(1);
    expect(
      nextFailureNumber(["agent-error.failed-01.log", "agent-error.failed-03.log", "x.log"]),
    ).toBe(4);
    expect(archivedLogName(4)).toBe("agent-error.failed-04.log");
  });

  it("inserts .failed-NN before a transcript's extension, for a name or a path", () => {
    expect(archivedTranscriptName("output.jsonl", 1)).toBe("output.failed-01.jsonl");
    expect(archivedTranscriptName("/runs/r/phase-02/fix-attempt-02.jsonl", 12)).toBe(
      "/runs/r/phase-02/fix-attempt-02.failed-12.jsonl",
    );
    expect(archivedTranscriptName("/runs/r.v2/stream", 2)).toBe("/runs/r.v2/stream.failed-02");
  });

  it("tells an archived transcript from a live one", () => {
    expect(isArchivedTranscript("output.failed-01.jsonl")).toBe(true);
    expect(isArchivedTranscript("handoff-generation.failed-02.jsonl")).toBe(true);
    expect(isArchivedTranscript("output.jsonl")).toBe(false);
    expect(isArchivedTranscript("agent-error.failed-01.log")).toBe(false);
  });

  it("reads and rewrites the header's transcript line only", () => {
    expect(transcriptOfLog(LOG)).toBe("/state/runs/example.invoice-export/phase-02/output.jsonl");
    expect(transcriptOfLog("failure: unknown\ntranscript: none\n")).toBeNull();
    expect(transcriptOfLog("claude --print\nexit code: 1\n")).toBeNull();
    const rewritten = withTranscriptLine(LOG, "/elsewhere/output.failed-01.jsonl");
    expect(rewritten.split("\n")[4]).toBe("transcript: /elsewhere/output.failed-01.jsonl");
    expect(rewritten.split("\n").at(-1)).toBe(
      "transcript: a stderr line that happens to start the same way",
    );
  });
});
