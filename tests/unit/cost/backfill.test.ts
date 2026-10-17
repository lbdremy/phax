// The backfill's pure functions on made-up run folders and stream facts:
// `runStreamsInOrder` lists a run's kept streams in the order the run wrote
// them, and `ledgerFromStreams` folds them into the ledger the run would have
// written, per-invocation even when Claude Code reports a resumed session
// cumulatively. Every folder, session id, usage and price is made up.
import { describe, expect, it } from "vitest";
import { ledgerFromStreams, runStreamsInOrder } from "../../../src/domain/cost/ledger.js";
import type { ModelListPrice } from "../../../src/domain/routing/prices.js";
import type { ClaudeStreamFacts, StreamModelUsage } from "../../../src/schemas/claudeStream.js";

const SESSION = "eeeeeeee-0000-4000-8000-000000000005";

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

describe("runStreamsInOrder", () => {
  it("orders phases by id, reset folders before the live one, fixes by number, the compliance review last", () => {
    const streams = runStreamsInOrder({
      entries: [
        "compliance-review.session.jsonl",
        "phase-10",
        "phase-02",
        "phase-02.reset-2026-10-15T09-00-00-000Z",
        "phase-02.reset-2026-10-14T09-00-00-000Z",
        "state.json",
        "final-report.md",
      ],
      phaseEntries: {
        "phase-02": [
          "handoff-generation.jsonl",
          "fix-attempt-10.jsonl",
          "output.jsonl",
          "fix-attempt-02.jsonl",
          "checks-attempt-02.log",
          "phase-handoff.md",
        ],
        "phase-02.reset-2026-10-14T09-00-00-000Z": ["output.jsonl"],
        "phase-02.reset-2026-10-15T09-00-00-000Z": ["output.jsonl", "fix-attempt-01.jsonl"],
        "phase-10": ["output.jsonl"],
      },
    });

    expect(streams).toEqual([
      {
        role: "phase",
        phase: "phase-02",
        relativePath: "phase-02.reset-2026-10-14T09-00-00-000Z/output.jsonl",
      },
      {
        role: "phase",
        phase: "phase-02",
        relativePath: "phase-02.reset-2026-10-15T09-00-00-000Z/output.jsonl",
      },
      {
        role: "fix",
        phase: "phase-02",
        relativePath: "phase-02.reset-2026-10-15T09-00-00-000Z/fix-attempt-01.jsonl",
      },
      { role: "phase", phase: "phase-02", relativePath: "phase-02/output.jsonl" },
      { role: "fix", phase: "phase-02", relativePath: "phase-02/fix-attempt-02.jsonl" },
      { role: "fix", phase: "phase-02", relativePath: "phase-02/fix-attempt-10.jsonl" },
      { role: "handoff", phase: "phase-02", relativePath: "phase-02/handoff-generation.jsonl" },
      { role: "phase", phase: "phase-10", relativePath: "phase-10/output.jsonl" },
      { role: "compliance", phase: null, relativePath: "compliance-review.session.jsonl" },
    ]);
  });

  it("returns nothing for a run folder with no stream", () => {
    expect(runStreamsInOrder({ entries: ["state.json"], phaseEntries: {} })).toEqual([]);
  });
});

function usage(outputTokens: number, costUsd: number): StreamModelUsage {
  return { inputTokens: 0, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd };
}

// One resumed session on Claude Code 2.1.280: each result reports the whole
// session so far, 2 → 3 → 3.5 → 3.75 USD.
function resumed(outputTokens: number, costUsd: number, extra: Partial<ClaudeStreamFacts> = {}) {
  return {
    claudeCodeVersion: [2, 1, 280] as const,
    sessionId: SESSION,
    events: [],
    result: { durationMs: 1000, modelUsage: { "example-model": usage(outputTokens, costUsd) } },
    ...extra,
  } satisfies ClaudeStreamFacts;
}

describe("ledgerFromStreams", () => {
  it("gives a resumed session's turn, fixes and handoff each their own cost, summing to the last report", () => {
    const ledger = ledgerFromStreams(
      [
        {
          role: "phase",
          phase: "phase-01",
          facts: resumed(2000, 2),
          endedAt: "2026-10-15T10:00:00.000Z",
        },
        {
          role: "fix",
          phase: "phase-01",
          facts: resumed(3000, 3),
          endedAt: "2026-10-15T10:10:00.000Z",
        },
        {
          role: "fix",
          phase: "phase-01",
          facts: resumed(3500, 3.5),
          endedAt: "2026-10-15T10:20:00.000Z",
        },
        {
          role: "handoff",
          phase: "phase-01",
          facts: resumed(3750, 3.75),
          endedAt: "2026-10-15T10:30:00.000Z",
        },
      ],
      priceFor,
    );

    expect(ledger.entries.map((e) => [e.role, e.costUsd, e.endedAt])).toEqual([
      ["phase", 2, "2026-10-15T10:00:00.000Z"],
      ["fix", 1, "2026-10-15T10:10:00.000Z"],
      ["fix", 0.5, "2026-10-15T10:20:00.000Z"],
      ["handoff", 0.25, "2026-10-15T10:30:00.000Z"],
    ]);
    expect(ledger.entries.at(-1)!.models["example-model"]!.outputTokens).toBe(250);
    expect(ledger.entries.reduce((sum, e) => sum + e.costUsd, 0)).toBeCloseTo(3.75, 6);
  });

  it("chains the samples' run cost across streams, gives a partial entry no duration, and adds nothing for a Codex stream", () => {
    const codex: ClaudeStreamFacts = {
      claudeCodeVersion: null,
      sessionId: null,
      events: [],
      result: null,
    };
    const interrupted: ClaudeStreamFacts = {
      claudeCodeVersion: [2, 1, 280],
      sessionId: "ffffffff-0000-4000-8000-000000000006",
      events: [
        {
          kind: "message",
          id: "msg_1",
          model: "example-model",
          // 100,000 output tokens at $10 per MTok: $1.
          usage: {
            inputTokens: 0,
            outputTokens: 100000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheWrite1hTokens: 0,
          },
        },
        {
          kind: "rate-limit",
          readings: [{ window: "five-hour", fraction: 0.3, resetsAtEpochSeconds: 1792069800 }],
        },
      ],
      result: null,
    };

    const ledger = ledgerFromStreams(
      [
        {
          role: "phase",
          phase: "phase-01",
          facts: resumed(2000, 2),
          endedAt: "2026-10-15T10:00:00.000Z",
        },
        { role: "phase", phase: "phase-02", facts: codex, endedAt: "2026-10-15T10:05:00.000Z" },
        {
          role: "compliance",
          phase: null,
          facts: interrupted,
          endedAt: "2026-10-15T10:10:00.000Z",
        },
      ],
      priceFor,
    );

    expect(ledger.entries).toHaveLength(2);
    const compliance = ledger.entries[1]!;
    expect(compliance).toMatchObject({
      role: "compliance",
      phase: null,
      completeness: "partial",
      agentMs: 0,
      costUsd: 1,
    });
    expect(compliance.rateLimitSamples).toEqual([
      { window: "five-hour", utilization: 30, resetsAt: "2026-10-15T13:10:00Z", runCostUsd: 3 },
    ]);
  });

  it("gives an empty ledger for no stream", () => {
    expect(ledgerFromStreams([])).toEqual({ entries: [] });
  });
});
