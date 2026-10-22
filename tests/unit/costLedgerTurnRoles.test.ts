// The cost ledger's two roles for a declared interactive phase's turns (plan
// declared-interactive-stop, phase-01): a closing turn is priced from its own
// stream's assistant messages, never from the result's `modelUsage`, because
// the person may have continued its session and the result then reports cost
// cumulatively; a first turn is priced like any complete entry; the stream
// scanner lists both roles and their `-retry` streams. Every stream, session
// id, usage and price is made up.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { ledgerEntryFor, runStreamsInOrder } from "../../src/domain/cost/ledger.js";
import type { ModelListPrice } from "../../src/domain/routing/prices.js";
import type { ClaudeStreamEvent, ClaudeStreamFacts } from "../../src/schemas/claudeStream.js";
import { readCostLedgerFile, withSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const SESSION = "eeeeeeee-0000-4000-8000-000000000005";
const ENDED_AT = "2026-10-22T14:00:00.000Z";

// $1 per MTok of input, $10 of output, $0.1 of cache read, $1.25 of 5m and $2 of 1h cache write.
const EXAMPLE_PRICE: ModelListPrice = {
  inputUsdPerMTok: 1,
  outputUsdPerMTok: 10,
  cacheReadUsdPerMTok: 0.1,
  cacheWrite5mUsdPerMTok: 1.25,
  cacheWrite1hUsdPerMTok: 2,
};

const priceFor = (model: string): ModelListPrice | undefined =>
  model === "example-model" ? EXAMPLE_PRICE : undefined;

// 30 000 output tokens at $10 per MTok: $0.30.
function message(id: string, outputTokens: number): ClaudeStreamEvent {
  return {
    kind: "message",
    id,
    model: "example-model",
    usage: {
      inputTokens: 0,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
    },
  };
}

function facts(extra: Partial<ClaudeStreamFacts>): ClaudeStreamFacts {
  return {
    claudeCodeVersion: [2, 1, 280],
    sessionId: SESSION,
    apiKeySource: null,
    undecodedRateLimitEvents: 0,
    events: [],
    result: null,
    ...extra,
  };
}

// The person continued the session after the first turn: the result reports
// $1.40 for the whole session, turns the ledger never saw included.
const cumulativeResult = {
  durationMs: 41210,
  modelUsage: {
    "example-model": {
      inputTokens: 100,
      outputTokens: 140000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 1.4,
    },
  },
};

describe("the closing-turn role", () => {
  it("prices a closing turn from its own messages, not from a cumulative result", () => {
    const entry = ledgerEntryFor({
      role: "closing-turn",
      phase: "phase-03",
      facts: facts({
        events: [message("m1", 20000), message("m2", 10000)],
        result: cumulativeResult,
      }),
      earlier: [],
      partialAgentMs: 0,
      endedAt: ENDED_AT,
      priceFor,
    });
    expect(entry?.role).toBe("closing-turn");
    expect(entry?.phase).toBe("phase-03");
    expect(entry?.costUsd).toBe(0.3);
    expect(entry?.models["example-model"]?.outputTokens).toBe(30000);
    expect(entry?.completeness).toBe("complete");
    expect(entry?.agentMs).toBe(41210);
  });

  it("counts a message once even when the stream repeats it", () => {
    const entry = ledgerEntryFor({
      role: "closing-turn",
      phase: "phase-03",
      facts: facts({
        events: [message("m1", 10000), message("m1", 30000)],
        result: cumulativeResult,
      }),
      earlier: [],
      partialAgentMs: 0,
      endedAt: ENDED_AT,
      priceFor,
    });
    expect(entry?.costUsd).toBe(0.3);
  });

  it("never subtracts earlier entries of the same session", () => {
    const first = ledgerEntryFor({
      role: "first-turn",
      phase: "phase-03",
      facts: facts({ result: cumulativeResult }),
      earlier: [],
      partialAgentMs: 0,
      endedAt: ENDED_AT,
      priceFor,
    });
    expect(first).not.toBeNull();
    const closing = ledgerEntryFor({
      role: "closing-turn",
      phase: "phase-03",
      facts: facts({ events: [message("m1", 30000)], result: cumulativeResult }),
      earlier: first === null ? [] : [first],
      partialAgentMs: 0,
      endedAt: ENDED_AT,
      priceFor,
    });
    expect(closing?.costUsd).toBe(0.3);
  });

  it("gives a partial entry, with the measured time, when the stream has no result", () => {
    const entry = ledgerEntryFor({
      role: "closing-turn",
      phase: "phase-03",
      facts: facts({ events: [message("m1", 30000)] }),
      earlier: [],
      partialAgentMs: 5200,
      endedAt: ENDED_AT,
      priceFor,
    });
    expect(entry?.completeness).toBe("partial");
    expect(entry?.costUsd).toBe(0.3);
    expect(entry?.agentMs).toBe(5200);
  });
});

describe("the first-turn role", () => {
  it("is priced like a complete entry, from the result", () => {
    const entry = ledgerEntryFor({
      role: "first-turn",
      phase: "phase-03",
      facts: facts({
        events: [message("m1", 1000)],
        result: {
          durationMs: 18000,
          modelUsage: {
            "example-model": {
              inputTokens: 10,
              outputTokens: 2000,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0.02,
            },
          },
        },
      }),
      earlier: [],
      partialAgentMs: 0,
      endedAt: ENDED_AT,
      priceFor,
    });
    expect(entry?.role).toBe("first-turn");
    expect(entry?.completeness).toBe("complete");
    expect(entry?.costUsd).toBe(0.02);
    expect(entry?.agentMs).toBe(18000);
  });
});

describe("runStreamsInOrder", () => {
  it("lists the first-turn and closing-turn streams and their retries, in run order", () => {
    const streams = runStreamsInOrder({
      entries: ["phase-03", "compliance-review.session.jsonl"],
      phaseEntries: {
        "phase-03": [
          "closing-turn-01.jsonl",
          "first-turn-02.jsonl",
          "first-turn-01-retry.jsonl",
          "first-turn-01.jsonl",
          "closing-turn-01-retry.jsonl",
          "interactive-session.json",
          "first-reading.md",
        ],
      },
    });
    expect(streams.map(({ role, relativePath }) => [role, relativePath])).toEqual([
      ["first-turn", "phase-03/first-turn-01.jsonl"],
      ["first-turn", "phase-03/first-turn-01-retry.jsonl"],
      ["first-turn", "phase-03/first-turn-02.jsonl"],
      ["closing-turn", "phase-03/closing-turn-01.jsonl"],
      ["closing-turn", "phase-03/closing-turn-01-retry.jsonl"],
      ["compliance", "compliance-review.session.jsonl"],
    ]);
    expect(
      streams.every((stream) => stream.role === "compliance" || stream.phase === "phase-03"),
    ).toBe(true);
  });

  it("puts a headless phase's streams between the first and closing turns", () => {
    const streams = runStreamsInOrder({
      entries: ["phase-02"],
      phaseEntries: {
        "phase-02": [
          "closing-turn-01.jsonl",
          "handoff-generation.jsonl",
          "fix-attempt-01.jsonl",
          "output.jsonl",
          "first-turn-01.jsonl",
        ],
      },
    });
    expect(streams.map(({ role }) => role)).toEqual([
      "first-turn",
      "phase",
      "fix",
      "handoff",
      "closing-turn",
    ]);
  });

  it("ignores a name that is not a turn stream", () => {
    const streams = runStreamsInOrder({
      entries: ["phase-03"],
      phaseEntries: { "phase-03": ["first-turn-1.jsonl", "closing-turn-01.json", "turn-01.jsonl"] },
    });
    expect(streams).toEqual([]);
  });
});

describe("reading a cost ledger", () => {
  const entry = {
    role: "closing-turn" as const,
    phase: "phase-03",
    completeness: "complete" as const,
    provider: "claude-code" as const,
    sessionId: SESSION,
    models: {},
    costUsd: 0,
    agentMs: 0,
    endedAt: ENDED_AT,
    rateLimitSamples: [],
  };

  it("reads a ledger with the new roles at the current stamp", () => {
    const read = readCostLedgerFile(
      "cost-ledger.json",
      withSchemaUrl("cost-ledger", {
        entries: [entry, { ...entry, role: "first-turn" as const }],
      }),
    );
    expect(Either.getOrThrow(read).entries.map((e) => e.role)).toEqual([
      "closing-turn",
      "first-turn",
    ]);
  });

  it("reads a 0.25.0 ledger unchanged", () => {
    const older = { ...entry, role: "phase" as const };
    const read = readCostLedgerFile("cost-ledger.json", {
      $schema: schemaUrl("cost-ledger", "0.25.0"),
      entries: [older],
    });
    expect(Either.getOrThrow(read)).toEqual({ entries: [older] });
  });

  it("refuses a first-turn role in a ledger stamped 0.25.0", () => {
    const read = readCostLedgerFile("cost-ledger.json", {
      $schema: schemaUrl("cost-ledger", "0.25.0"),
      entries: [{ ...entry, role: "first-turn" }],
    });
    expect(Either.isLeft(read)).toBe(true);
  });
});
