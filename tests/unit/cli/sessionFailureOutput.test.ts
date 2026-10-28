import { describe, expect, it } from "vitest";
import { RateLimitError, UsageLimitError } from "../../../src/domain/errors.js";
import { sessionFailureError } from "../../../src/domain/session/failureError.js";
import { FAILURE_KINDS, type SessionFailure } from "../../../src/domain/session/outcome.js";
import {
  renderSessionFailure,
  retryCommandLine,
  type SessionFailureError,
} from "../../../src/cli/commands/sessionFailureOutput.js";
import { exitCodeForError } from "../../../src/cli/commands/runLayers.js";

const files = {
  agentErrorLog: "/runs/r/phase-02/agent-error.log",
  transcript: "/runs/r/phase-02/output.jsonl",
};

const failureOf = (kind: SessionFailure["kind"], sessionId: string | null): SessionFailure => ({
  provider: "claude-code",
  kind,
  message: "API Error: boom",
  sessionId,
  resetAt: null,
});

describe("renderSessionFailure", () => {
  it.each(FAILURE_KINDS)("names the provider, the %s kind and the provider message", (kind) => {
    const err = sessionFailureError(failureOf(kind, "sess-1"), files) as SessionFailureError;

    expect(renderSessionFailure(err, null)[0]).toBe(
      `✗ claude-code session failed (${kind}): API Error: boom`,
    );
  });

  it("prints the session, the files by name and the retry for a network failure", () => {
    const err = sessionFailureError(failureOf("network", "sess-1"), files) as SessionFailureError;

    expect(renderSessionFailure(err, "phax run plan.md")).toEqual([
      "✗ claude-code session failed (network): API Error: boom",
      "  session: sess-1",
      "  See /runs/r/phase-02/agent-error.log and output.jsonl",
      "  Retry once the network is back: phax run plan.md",
    ]);
  });

  it("names the transcript by its full path when it sits elsewhere", () => {
    const err = sessionFailureError(failureOf("provider-error", null), {
      agentErrorLog: "/runs/r/agent-error.log",
      transcript: "/store/t.jsonl",
    }) as SessionFailureError;

    expect(renderSessionFailure(err, "phax run plan.md")).toEqual([
      "✗ claude-code session failed (provider-error): API Error: boom",
      "  See /runs/r/agent-error.log and /store/t.jsonl",
    ]);
  });

  it("names whichever file exists, and none when there is none", () => {
    const logOnly = sessionFailureError(failureOf("killed", null), {
      agentErrorLog: "/runs/r/agent-error.log",
      transcript: null,
    }) as SessionFailureError;
    const neither = sessionFailureError(failureOf("killed", null), {
      agentErrorLog: null,
      transcript: null,
    }) as SessionFailureError;

    expect(renderSessionFailure(logOnly, null)[1]).toBe("  See /runs/r/agent-error.log");
    expect(renderSessionFailure(neither, null)).toHaveLength(1);
  });

  it("prints a limit's failure line and its files, with no retry", () => {
    const limit = sessionFailureError(failureOf("usage-limit", null), files);

    expect(limit).toBeInstanceOf(UsageLimitError);
    expect(renderSessionFailure(limit as UsageLimitError, "phax run plan.md")).toEqual([
      "✗ claude-code session failed (usage-limit): API Error: boom",
      "  See /runs/r/phase-02/agent-error.log and output.jsonl",
    ]);
    expect(
      renderSessionFailure(
        new RateLimitError({ message: "limited", rawMessage: "limited", agentErrorLog: null }),
        null,
      ),
    ).toEqual(["✗ limited"]);
  });
});

describe("exitCodeForError for a failed session", () => {
  it.each(FAILURE_KINDS)("maps %s to its exit code", (kind) => {
    const expected = kind === "network" ? 14 : kind.endsWith("-limit") ? 8 : 5;

    expect(exitCodeForError(sessionFailureError(failureOf(kind, null), files))).toBe(expected);
  });
});

describe("retryCommandLine", () => {
  it("prefixes phax and quotes only the words a shell needs quoted", () => {
    expect(
      retryCommandLine(["artifact", "decide", "docs/specs/a b.md", "--verdicts", "v.json"]),
    ).toBe("phax artifact decide 'docs/specs/a b.md' --verdicts v.json");
  });

  it("escapes a single quote and quotes an empty word", () => {
    expect(retryCommandLine(["x", "it's", ""])).toBe("phax x 'it'\\''s' ''");
  });
});
