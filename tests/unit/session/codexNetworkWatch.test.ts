import { describe, expect, it } from "vitest";
import {
  CODEX_NETWORK_WATCH_START,
  type CodexNetworkWatch,
  codexNetworkFailure,
  stepCodexNetworkWatch,
} from "../../../src/domain/session/codexNetworkWatch.js";

const error = (message: string): string => JSON.stringify({ type: "error", message });
const reconnect = (n: number): string =>
  error(`Reconnecting... ${n}/5 (stream disconnected before completion: error sending request)`);
const waiting = error("Reconnecting... waiting for network (Connection failed: dns error)");
const turnStarted = JSON.stringify({ type: "turn.started" });

const run = (lines: readonly string[]): CodexNetworkWatch =>
  lines.reduce(stepCodexNetworkWatch, CODEX_NETWORK_WATCH_START);

const networkRun = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => (i < 5 ? reconnect(i + 1) : waiting));

describe("stepCodexNetworkWatch — the threshold", () => {
  it.each([
    { name: "7 network events do not trip", lines: networkRun(7), count: 7, tripped: false },
    { name: "8 network events trip", lines: networkRun(8), count: 8, tripped: true },
    {
      name: "another event resets the count",
      lines: [...networkRun(7), turnStarted, ...networkRun(7)],
      count: 7,
      tripped: false,
    },
    {
      name: "a non-network error resets the count",
      lines: [...networkRun(7), error("boom"), reconnect(1)],
      count: 1,
      tripped: false,
    },
    {
      name: "a line that does not decode resets the count",
      lines: [...networkRun(7), "not json", reconnect(1)],
      count: 1,
      tripped: false,
    },
    {
      name: "an error without a message resets the count",
      lines: [...networkRun(7), JSON.stringify({ type: "error" }), reconnect(1)],
      count: 1,
      tripped: false,
    },
  ])("$name", ({ lines, count, tripped }) => {
    const watch = run(lines);
    expect(watch.count).toBe(count);
    expect(watch.tripped).toBe(tripped);
  });
});

describe("stepCodexNetworkWatch — what counts as a network event", () => {
  it.each([
    { message: "Reconnecting... 3/5 (stream disconnected before completion)", counts: true },
    { message: "Reconnecting... waiting for network (Connection failed: …)", counts: true },
    {
      message: "error sending request for url (https://api.openai.com/v1/responses)",
      counts: true,
    },
    { message: "stream disconnected before completion: Connection refused", counts: true },
    { message: "rate limit exceeded", counts: false },
    { message: "You've hit your usage limit", counts: false },
    { message: "model not found", counts: false },
  ])("$message → $counts", ({ message, counts }) => {
    expect(stepCodexNetworkWatch(CODEX_NETWORK_WATCH_START, error(message)).count).toBe(
      counts ? 1 : 0,
    );
  });
});

describe("codexNetworkFailure", () => {
  it("reports network with the last network message and the thread id", () => {
    const watch = run([
      JSON.stringify({ type: "thread.started", thread_id: "tid-net" }),
      turnStarted,
      ...networkRun(8),
    ]);
    expect(codexNetworkFailure(watch)).toEqual({
      provider: "codex-cli",
      kind: "network",
      message: "Reconnecting... waiting for network (Connection failed: dns error)",
      sessionId: "tid-net",
      resetAt: null,
    });
  });

  it("has no session id when the stream gave no thread", () => {
    expect(codexNetworkFailure(run(networkRun(8))).sessionId).toBeNull();
  });
});
