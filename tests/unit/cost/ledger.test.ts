// The cost ledger's pure functions on made-up stream facts (spec §8): a
// resumed session reported cumulatively is corrected by version, a window
// reading becomes a sample of the run's cost so far, a stream without a result
// gives a partial entry priced once per message, an empty stream gives no
// entry, an unpriced model counts $0, and a model whose delta is all zero is
// dropped. Every stream, session id, usage, price and window is made up.
import { describe, expect, it } from "vitest";
import {
  CUMULATIVE_SINCE,
  appendEntry,
  ledgerEntryFor,
  messageCostUsd,
  reportsCumulative,
} from "../../../src/domain/cost/ledger.js";
import type { ModelListPrice } from "../../../src/domain/routing/prices.js";
import type {
  ClaudeStreamEvent,
  ClaudeStreamFacts,
  StreamModelUsage,
} from "../../../src/schemas/claudeStream.js";
import type { CostLedgerEntry } from "../../../src/schemas/costLedger.js";

const SESSION = "cccccccc-0000-4000-8000-000000000003";
const OTHER_SESSION = "dddddddd-0000-4000-8000-000000000004";
const ENDED_AT = "2026-10-15T14:00:00.000Z";

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

function usage(model: Partial<StreamModelUsage>): StreamModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    ...model,
  };
}

function message(id: string, outputTokens: number, model = "example-model"): ClaudeStreamEvent {
  return {
    kind: "message",
    id,
    model,
    usage: {
      inputTokens: 0,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
    },
  };
}

function reading(window: "five-hour" | "seven-day", fraction: number): ClaudeStreamEvent {
  return {
    kind: "rate-limit",
    readings: [{ window, fraction, resetsAtEpochSeconds: 1792069800 }],
  };
}

function facts(extra: Partial<ClaudeStreamFacts>): ClaudeStreamFacts {
  return {
    claudeCodeVersion: [2, 1, 280],
    sessionId: SESSION,
    events: [],
    result: null,
    ...extra,
  };
}

function entry(
  input: Partial<Parameters<typeof ledgerEntryFor>[0]> & { facts: ClaudeStreamFacts },
): CostLedgerEntry {
  const made = ledgerEntryFor({
    role: "phase",
    phase: "phase-01",
    earlier: [],
    partialAgentMs: 0,
    endedAt: ENDED_AT,
    priceFor,
    ...input,
  } as Parameters<typeof ledgerEntryFor>[0]);
  if (made === null) throw new Error("expected an entry");
  return made;
}

const phaseTurn = facts({
  result: {
    durationMs: 52000,
    modelUsage: {
      "example-model": usage({
        inputTokens: 40,
        outputTokens: 9000,
        cacheReadTokens: 3000000,
        cacheWriteTokens: 60000,
        costUsd: 8.61,
      }),
      "example-small": usage({ outputTokens: 500, costUsd: 0.1 }),
    },
  },
});

// The handoff resumes the phase's session: Claude Code reports the whole
// session, 8.99 in all, while the handoff alone cost 0.28.
function handoff(version: readonly [number, number, number]): ClaudeStreamFacts {
  return facts({
    claudeCodeVersion: version,
    result: {
      durationMs: 41210,
      modelUsage: {
        "example-model": usage({
          inputTokens: 46,
          outputTokens: 11378,
          cacheReadTokens: 3947932,
          cacheWriteTokens: 65578,
          costUsd: 8.89,
        }),
        "example-small": usage({ outputTokens: 500, costUsd: 0.1 }),
      },
    },
  });
}

describe("reportsCumulative", () => {
  it("is true from Claude Code 2.1.268, false before, and false for an unknown version", () => {
    expect(CUMULATIVE_SINCE).toEqual([2, 1, 268]);
    expect(reportsCumulative([2, 1, 268])).toBe(true);
    expect(reportsCumulative([2, 1, 280])).toBe(true);
    expect(reportsCumulative([2, 2, 0])).toBe(true);
    expect(reportsCumulative([3, 0, 0])).toBe(true);
    expect(reportsCumulative([2, 1, 267])).toBe(false);
    expect(reportsCumulative([2, 0, 999])).toBe(false);
    expect(reportsCumulative([1, 9, 300])).toBe(false);
    expect(reportsCumulative(null)).toBe(false);
  });
});

describe("messageCostUsd", () => {
  it("prices 5m and 1h cache writes apart", () => {
    const cost = messageCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheReadTokens: 2_000_000,
        cacheWriteTokens: 300_000,
        cacheWrite1hTokens: 100_000,
      },
      EXAMPLE_PRICE,
    );
    // 1 + 1 + 0.2 + 0.2 × 1.25 + 0.1 × 2
    expect(cost).toBeCloseTo(2.65, 10);
  });
});

describe("ledgerEntryFor: a complete entry", () => {
  it("reads the result's models, its duration, and sums the models' cost", () => {
    const made = entry({ facts: phaseTurn });
    expect(made).toEqual({
      role: "phase",
      phase: "phase-01",
      completeness: "complete",
      provider: "claude-code",
      sessionId: SESSION,
      models: {
        "example-model": {
          inputTokens: 40,
          outputTokens: 9000,
          cacheReadTokens: 3000000,
          cacheWriteTokens: 60000,
          costUsd: 8.61,
        },
        "example-small": {
          inputTokens: 0,
          outputTokens: 500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.1,
        },
      },
      costUsd: 8.71,
      agentMs: 52000,
      endedAt: ENDED_AT,
      rateLimitSamples: [],
    });
  });

  it("(a) corrects a resumed session reported cumulatively: the handoff costs 0.28 and the session sums to 8.99", () => {
    const first = entry({ facts: phaseTurn });
    const second = entry({
      facts: handoff([2, 1, 280]),
      role: "handoff",
      earlier: [first],
    });
    expect(second.costUsd).toBe(0.28);
    expect(second.models["example-model"]).toEqual({
      inputTokens: 6,
      outputTokens: 2378,
      cacheReadTokens: 947932,
      cacheWriteTokens: 5578,
      costUsd: 0.28,
    });
    expect(second.agentMs).toBe(41210);
    expect(first.costUsd + second.costUsd).toBeCloseTo(8.99, 10);
  });

  it("(a) keeps the reported value before 2.1.268, and corrects at the 2.1.268 boundary", () => {
    const first = entry({ facts: phaseTurn });
    const before = entry({ facts: handoff([2, 1, 267]), role: "handoff", earlier: [first] });
    expect(before.costUsd).toBe(8.99);
    const boundary = entry({ facts: handoff([2, 1, 268]), role: "handoff", earlier: [first] });
    expect(boundary.costUsd).toBe(0.28);
  });

  it("subtracts the sum of every earlier entry of the same session, and only of it", () => {
    const first = entry({ facts: phaseTurn });
    const fix = entry({
      facts: facts({
        result: {
          durationMs: 1000,
          modelUsage: {
            "example-model": usage({ outputTokens: 10000, costUsd: 8.71 }),
            "example-small": usage({ outputTokens: 500, costUsd: 0.1 }),
          },
        },
      }),
      role: "fix",
      earlier: [first],
    });
    expect(fix.costUsd).toBe(0.1);
    const otherSession = entry({
      facts: facts({
        sessionId: OTHER_SESSION,
        result: { durationMs: 5, modelUsage: { "example-model": usage({ costUsd: 0.5 }) } },
      }),
      role: "phase",
      phase: "phase-02",
      earlier: [first, fix],
    });
    expect(otherSession.costUsd).toBe(0.5);
    const handoffEntry = entry({
      facts: handoff([2, 1, 280]),
      role: "handoff",
      earlier: [first, fix, otherSession],
    });
    // 8.99 reported, less 8.71 and 0.1 of the session's two earlier entries.
    expect(handoffEntry.costUsd).toBe(0.18);
  });

  it("does not correct the first entry of a session, whatever the version", () => {
    const made = entry({ facts: handoff([2, 1, 280]), role: "handoff" });
    expect(made.costUsd).toBe(8.99);
  });

  it("floors each field's delta at 0", () => {
    const first = entry({ facts: phaseTurn });
    const shrunk = entry({
      facts: facts({
        result: {
          durationMs: 10,
          modelUsage: {
            "example-model": usage({ inputTokens: 10, outputTokens: 9500, costUsd: 8 }),
          },
        },
      }),
      role: "fix",
      earlier: [first],
    });
    expect(shrunk.models["example-model"]).toEqual({
      inputTokens: 0,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    });
    expect(shrunk.costUsd).toBe(0);
  });

  it("(f) drops a model whose delta is zero everywhere", () => {
    const first = entry({ facts: phaseTurn });
    const second = entry({ facts: handoff([2, 1, 280]), role: "handoff", earlier: [first] });
    expect(Object.keys(second.models)).toEqual(["example-model"]);
  });

  it("records a compliance review as a run-level entry", () => {
    const made = entry({ facts: phaseTurn, role: "compliance", phase: null });
    expect(made.role).toBe("compliance");
    expect(made.phase).toBeNull();
  });
});

describe("ledgerEntryFor: rate-limit samples", () => {
  it("(b) samples the five-hour window at 21 % after $8.98 of run cost", () => {
    const first = entry({ facts: phaseTurn });
    // 27,000 output tokens at $10 per MTok: $0.27 so far in this stream.
    const made = entry({
      facts: facts({
        events: [message("msg_01", 20000), message("msg_02", 7000), reading("five-hour", 0.21)],
      }),
      role: "handoff",
      earlier: [first],
    });
    expect(made.rateLimitSamples).toEqual([
      {
        window: "five-hour",
        utilization: 21,
        resetsAt: "2026-10-15T13:10:00Z",
        runCostUsd: 8.98,
      },
    ]);
  });

  it("emits one sample per window per event, without deduplication, each at the cost seen so far", () => {
    const made = entry({
      facts: facts({
        events: [
          {
            kind: "rate-limit",
            readings: [
              { window: "five-hour", fraction: 0.1, resetsAtEpochSeconds: 1792069800 },
              { window: "seven-day", fraction: 0.05, resetsAtEpochSeconds: 1792335600 },
            ],
          },
          message("msg_01", 100000),
          reading("five-hour", 0.1),
          reading("five-hour", 0.123456),
        ],
      }),
    });
    expect(made.rateLimitSamples).toEqual([
      { window: "five-hour", utilization: 10, resetsAt: "2026-10-15T13:10:00Z", runCostUsd: 0 },
      { window: "seven-day", utilization: 5, resetsAt: "2026-10-18T15:00:00Z", runCostUsd: 0 },
      { window: "five-hour", utilization: 10, resetsAt: "2026-10-15T13:10:00Z", runCostUsd: 1 },
      { window: "five-hour", utilization: 12.35, resetsAt: "2026-10-15T13:10:00Z", runCostUsd: 1 },
    ]);
  });

  it("clamps an out-of-range utilization to 0..100", () => {
    const made = entry({
      facts: facts({ events: [reading("seven-day", 1.7), reading("seven-day", -0.2)] }),
    });
    expect(made.rateLimitSamples.map((sample) => sample.utilization)).toEqual([100, 0]);
  });

  it("counts a message re-sent under the same id once, at its last usage", () => {
    const made = entry({
      facts: facts({
        events: [message("msg_01", 10000), message("msg_01", 30000), reading("five-hour", 0.3)],
      }),
    });
    expect(made.rateLimitSamples[0]?.runCostUsd).toBe(0.3);
  });
});

describe("ledgerEntryFor: a partial entry", () => {
  it("(c) prices each deduplicated message once and takes the measured duration", () => {
    const made = entry({
      facts: facts({
        events: [
          message("msg_01", 10000),
          message("msg_01", 20000),
          message("msg_02", 5000),
          reading("five-hour", 0.4),
        ],
      }),
      partialAgentMs: 1234.4,
    });
    expect(made.completeness).toBe("partial");
    expect(made.models).toEqual({
      "example-model": {
        inputTokens: 0,
        outputTokens: 25000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.25,
      },
    });
    expect(made.costUsd).toBe(0.25);
    expect(made.agentMs).toBe(1234);
    expect(made.rateLimitSamples[0]?.runCostUsd).toBe(0.25);
  });

  it("(e) counts an unpriced model $0, in the entry and in the samples that follow it", () => {
    const made = entry({
      facts: facts({
        events: [
          message("msg_01", 10000),
          message("msg_02", 50000, "example-unpriced"),
          reading("seven-day", 0.5),
        ],
      }),
    });
    expect(made.models["example-unpriced"]).toEqual({
      inputTokens: 0,
      outputTokens: 50000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    });
    expect(made.costUsd).toBe(0.1);
    expect(made.rateLimitSamples[0]?.runCostUsd).toBe(0.1);
  });

  it("prices with the shipped list prices by default", () => {
    const made = ledgerEntryFor({
      role: "fix",
      phase: "phase-01",
      facts: facts({ events: [message("msg_01", 1_000_000, "claude-opus-5-5[1m]")] }),
      earlier: [],
      partialAgentMs: 0,
      endedAt: ENDED_AT,
    });
    expect(made?.costUsd).toBeGreaterThan(0);
  });

  it("rounds USD values to 6 decimals", () => {
    const made = entry({ facts: facts({ events: [message("msg_01", 1)] }) });
    expect(made.costUsd).toBe(0.00001);
    const tiny = entry({ facts: facts({ events: [message("msg_01", 0.01)] }) });
    expect(tiny.costUsd).toBe(0);
  });
});

describe("ledgerEntryFor: no entry", () => {
  it("(d) gives null for an empty stream", () => {
    expect(
      ledgerEntryFor({
        role: "phase",
        phase: "phase-01",
        facts: { claudeCodeVersion: null, sessionId: null, events: [], result: null },
        earlier: [],
        partialAgentMs: 10,
        endedAt: ENDED_AT,
        priceFor,
      }),
    ).toBeNull();
  });
});

describe("appendEntry", () => {
  it("appends after the existing entries", () => {
    const first = entry({ facts: phaseTurn });
    const second = entry({ facts: handoff([2, 1, 280]), role: "handoff", earlier: [first] });
    expect(appendEntry(appendEntry({ entries: [] }, first), second)).toEqual({
      entries: [first, second],
    });
  });
});
