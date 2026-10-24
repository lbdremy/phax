import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSafeSessionId,
  recordedSessions,
  sha256Hex,
  transcriptFile,
  type RecordedSession,
} from "../../../src/domain/interactive/transcripts.js";
import { removeTempDir } from "../../helpers/tempGit.js";

const session = (sessionId: string, origin: RecordedSession["origin"]): RecordedSession => ({
  provider: "codex-cli",
  model: "gpt-5.5",
  effort: "medium",
  sessionId,
  startedAt: "2026-10-24T10:00:00.000Z",
  origin,
});

describe("recordedSessions", () => {
  const x0 = session("X0", "builder");
  const x1 = session("X1", "first-turn");
  const x2 = session("X2", "new-session");

  it.each([
    ["nothing when there is no session", { current: null, history: [] }, []],
    ["the current session alone", { current: x2, history: [] }, ["X2"]],
    ["the history alone", { current: null, history: [x1, x2] }, ["X1", "X2"]],
    [
      "the history, then the current session",
      { current: x2, history: [x0, x1] },
      ["X0", "X1", "X2"],
    ],
    ["each session id once", { current: x1, history: [x1, x2, x1] }, ["X1", "X2"]],
  ])("gives %s", (_name, input, expected) => {
    expect(recordedSessions(input).map((s) => s.sessionId)).toEqual(expected);
  });
});

describe("transcriptFile", () => {
  it("names the copy under interactive-transcripts/", () => {
    expect(transcriptFile("X1")).toBe("interactive-transcripts/X1.jsonl");
  });

  it.each([".", "..", "../../x", "a/b", "a\\b", "", "-X1", ".X1"])(
    "names no copy for the unsafe id %j: no path is built from it",
    (id) => {
      expect(isSafeSessionId(id)).toBe(false);
      expect(transcriptFile(id)).toBeNull();
    },
  );

  it.each(["X1", "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "session_X1.part-2"])(
    "takes the safe id %j",
    (id) => {
      expect(isSafeSessionId(id)).toBe(true);
      expect(transcriptFile(id)).toBe(`interactive-transcripts/${id}.jsonl`);
    },
  );
});

describe("sha256Hex", () => {
  it("hashes a sequence that is not valid UTF-8 as the file holding it is hashed", () => {
    const bytes = Uint8Array.from([0x7b, 0xff, 0xfe, 0x0a, 0xc3, 0x28, 0x7d, 0x0a]);
    const dir = mkdtempSync(join(tmpdir(), "phax-sha256-"));
    try {
      const file = join(dir, "X1.jsonl");
      writeFileSync(file, bytes);
      const expected = createHash("sha256").update(readFileSync(file)).digest("hex");
      expect(sha256Hex(bytes)).toBe(expected);
      // Decoding to a string first would have replaced the invalid bytes.
      const lossy = createHash("sha256").update(new TextDecoder().decode(bytes)).digest("hex");
      expect(sha256Hex(bytes)).not.toBe(lossy);
    } finally {
      removeTempDir(dir);
    }
  });

  it("gives a 64-character lowercase hex digest", () => {
    expect(sha256Hex(new TextEncoder().encode("{}\n"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
