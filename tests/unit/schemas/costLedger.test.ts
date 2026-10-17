// The cost ledger at decode level: a ledger shaped like spec §6, plus
// `endedAt`, decodes through the file decoder and the bridge; every key is
// required, and an unknown key, a role and phase that do not match, an
// out-of-range utilization and a missing $schema are refused. Every document
// is made up.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeCostLedgerFile } from "../../../src/schemas/costLedger.js";
import { currentSchemaUrl, readCostLedgerFile } from "../../../src/schemas/persisted.js";

type Doc = Record<string, unknown>;

function handoffEntry(extra: Doc = {}): Doc {
  return {
    phase: "phase-02",
    role: "handoff",
    completeness: "complete",
    provider: "claude-code",
    sessionId: "11111111-2222-4333-8444-555555555555",
    models: {
      "claude-opus-5-5": {
        inputTokens: 6,
        outputTokens: 2378,
        cacheReadTokens: 947932,
        cacheWriteTokens: 5578,
        costUsd: 0.28,
      },
    },
    costUsd: 0.28,
    agentMs: 41210,
    endedAt: "2026-10-15T14:02:11.250Z",
    rateLimitSamples: [
      {
        window: "five-hour",
        utilization: 21,
        resetsAt: "2026-10-15T18:10:00Z",
        runCostUsd: 8.98,
      },
    ],
    ...extra,
  };
}

function complianceEntry(extra: Doc = {}): Doc {
  return {
    ...handoffEntry(),
    role: "compliance",
    phase: null,
    completeness: "partial",
    rateLimitSamples: [],
    ...extra,
  };
}

function ledger(entries: ReadonlyArray<Doc>): Doc {
  return { $schema: currentSchemaUrl("cost-ledger"), entries };
}

function sample(utilization: number): ReadonlyArray<Doc> {
  return [{ window: "seven-day", utilization, resetsAt: "2026-10-20T00:00:00Z", runCostUsd: 1 }];
}

function accepts(input: unknown): boolean {
  return Either.isRight(decodeCostLedgerFile(input));
}

describe("cost-ledger", () => {
  it("decodes a ledger of a phase entry and a run-level entry", () => {
    expect(accepts(ledger([handoffEntry(), complianceEntry()]))).toBe(true);
    expect(accepts(ledger([]))).toBe(true);
  });

  it("is read through the bridge without its $schema", () => {
    const read = readCostLedgerFile("cost-ledger.json", ledger([handoffEntry()]));
    expect(Either.isRight(read)).toBe(true);
    if (Either.isRight(read)) {
      expect(Object.keys(read.right)).toEqual(["entries"]);
      expect(read.right.entries[0]?.role).toBe("handoff");
    }
  });

  it("refuses an unknown key, in the file and in an entry", () => {
    expect(accepts({ ...ledger([]), owner: "example" })).toBe(false);
    expect(accepts(ledger([handoffEntry({ owner: "example" })]))).toBe(false);
  });

  it("refuses a compliance entry with a phase", () => {
    expect(accepts(ledger([complianceEntry({ phase: "phase-01" })]))).toBe(false);
  });

  it("refuses a phase, fix or handoff entry with a null phase", () => {
    for (const role of ["phase", "fix", "handoff"]) {
      expect(accepts(ledger([handoffEntry({ role, phase: null })])), role).toBe(false);
    }
  });

  it("refuses a utilization above 100 or below 0", () => {
    expect(accepts(ledger([handoffEntry({ rateLimitSamples: sample(100) })]))).toBe(true);
    expect(accepts(ledger([handoffEntry({ rateLimitSamples: sample(100.5) })]))).toBe(false);
    expect(accepts(ledger([handoffEntry({ rateLimitSamples: sample(-1) })]))).toBe(false);
  });

  it("refuses a missing key of an entry", () => {
    for (const key of Object.keys(handoffEntry())) {
      const { [key]: _dropped, ...rest } = handoffEntry();
      expect(accepts(ledger([rest])), key).toBe(false);
    }
  });

  it("refuses a negative cost and a fractional token count", () => {
    expect(accepts(ledger([handoffEntry({ costUsd: -0.01 })]))).toBe(false);
    const fractional = {
      "claude-opus-5-5": {
        inputTokens: 1.5,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
    };
    expect(accepts(ledger([handoffEntry({ models: fractional })]))).toBe(false);
  });

  it("refuses a ledger without $schema, through the decoder and the bridge", () => {
    const { $schema: _schema, ...unstamped } = ledger([]);
    expect(accepts(unstamped)).toBe(false);
    const read = readCostLedgerFile("cost-ledger.json", unstamped);
    expect(Either.isLeft(read)).toBe(true);
    if (Either.isLeft(read)) expect(read.left.message).toContain("has no $schema");
  });

  it("refuses through the bridge a ledger stamped newer than this phax", () => {
    const newer = {
      ...ledger([]),
      $schema: "https://docs.phax.run/schemas/cost-ledger/99.0.0.json",
    };
    const read = readCostLedgerFile("cost-ledger.json", newer);
    expect(Either.isLeft(read)).toBe(true);
    if (Either.isLeft(read)) expect(read.left.message).toContain("newer than this phax");
  });
});
