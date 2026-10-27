// The cost ledger's run-level code-review role (plan headless-code-review,
// phase-02): it joins the compliance role with `phase: null`, its stream is
// kept as `code-review.session.jsonl` after the compliance review's, and a
// ledger stamped before it (0.26.0, 0.25.0) still reads through its frozen
// decoder and is rewritten at the current stamp when an entry is appended.
// Every stream, session id, usage and price is made up.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { nextLedger, type InvocationCostOptions } from "../../src/app/costLedger.js";
import { decodeRunId } from "../../src/domain/branded.js";
import { ledgerFromStreams, runStreamsInOrder } from "../../src/domain/cost/ledger.js";
import type { ModelListPrice } from "../../src/domain/routing/prices.js";
import type { ClaudeStreamFacts } from "../../src/schemas/claudeStream.js";
import { decodeCostLedgerFile } from "../../src/schemas/costLedger.js";
import {
  currentSchemaUrl,
  readCostLedgerFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const SESSION = "eeeeeeee-0000-4000-8000-000000000007";
const ENDED_AT = "2026-10-27T14:00:00.000Z";

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
const facts: ClaudeStreamFacts = {
  claudeCodeVersion: [2, 1, 280],
  sessionId: SESSION,
  apiKeySource: null,
  undecodedRateLimitEvents: 0,
  events: [
    {
      kind: "message",
      id: "m1",
      model: "example-model",
      usage: {
        inputTokens: 0,
        outputTokens: 30000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
      },
    },
  ],
  result: null,
};

const entry = {
  completeness: "partial" as const,
  provider: "claude-code" as const,
  sessionId: SESSION,
  models: {},
  costUsd: 0,
  agentMs: 0,
  endedAt: ENDED_AT,
  rateLimitSamples: [],
};

describe("the code-review cost entry", () => {
  it("decodes with phase null, beside a compliance entry", () => {
    const decoded = decodeCostLedgerFile(
      withSchemaUrl("cost-ledger", {
        entries: [
          { ...entry, role: "compliance", phase: null },
          { ...entry, role: "code-review", phase: null },
        ],
      }),
    );
    expect(Either.getOrThrow(decoded).entries.map((e) => [e.role, e.phase])).toEqual([
      ["compliance", null],
      ["code-review", null],
    ]);
  });

  it("is refused with a phase id", () => {
    const decoded = decodeCostLedgerFile(
      withSchemaUrl("cost-ledger", {
        entries: [{ ...entry, role: "code-review", phase: "phase-01" }],
      }),
    );
    expect(Either.isLeft(decoded)).toBe(true);
  });
});

describe("the code-review stream", () => {
  it("is listed after the compliance review's stream", () => {
    const streams = runStreamsInOrder({
      entries: ["code-review.session.jsonl", "phase-01", "compliance-review.session.jsonl"],
      phaseEntries: { "phase-01": ["output.jsonl"] },
    });
    expect(streams).toEqual([
      { role: "phase", phase: "phase-01", relativePath: "phase-01/output.jsonl" },
      { role: "compliance", phase: null, relativePath: "compliance-review.session.jsonl" },
      { role: "code-review", phase: null, relativePath: "code-review.session.jsonl" },
    ]);
  });

  it("is backfilled as an entry with phase null", () => {
    const ledger = ledgerFromStreams(
      [
        { role: "compliance", phase: null, facts, endedAt: ENDED_AT },
        { role: "code-review", phase: null, facts, endedAt: ENDED_AT },
      ],
      priceFor,
    );
    expect(ledger.entries.map((e) => [e.role, e.phase, e.costUsd])).toEqual([
      ["compliance", null, 0.3],
      ["code-review", null, 0.3],
    ]);
  });
});

const CODE_REVIEW_INVOCATION: InvocationCostOptions = {
  role: "code-review",
  phase: null,
  runId: Either.getOrThrow(decodeRunId("run-1")),
  runPath: "/run",
  provider: "claude-code",
  streamPath: "/run/code-review.session.jsonl",
};

describe("nextLedger for the code-review role", () => {
  const STREAM = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: SESSION,
    claude_code_version: "2.1.280",
  });

  it("appends an entry with phase null", () => {
    const text = nextLedger(CODE_REVIEW_INVOCATION, STREAM, { entries: [] }, 1200, ENDED_AT);
    const written = JSON.parse(text ?? "null") as {
      $schema: string;
      entries: Array<{ role: string; phase: unknown; sessionId: string }>;
    };
    expect(written.$schema).toBe(currentSchemaUrl("cost-ledger"));
    expect(written.entries).toMatchObject([
      { role: "code-review", phase: null, sessionId: SESSION },
    ]);
  });
});

describe("a ledger stamped before the code-review role", () => {
  const phaseEntry = { ...entry, role: "first-turn" as const, phase: "phase-01" };
  const closing = { ...phaseEntry, role: "closing-turn" as const };

  const append = (ledger: { entries: ReadonlyArray<unknown> }) =>
    JSON.parse(
      nextLedger(
        CODE_REVIEW_INVOCATION,
        JSON.stringify({ type: "system", subtype: "init", session_id: SESSION }),
        ledger as never,
        0,
        ENDED_AT,
      ) ?? "null",
    ) as { $schema: string; entries: Array<{ role: string }> };

  it("stamped 0.26.0 reads with its first-turn and closing-turn entries, and is rewritten at the current stamp", () => {
    const read = readCostLedgerFile("cost-ledger.json", {
      $schema: schemaUrl("cost-ledger", "0.26.0"),
      entries: [phaseEntry, closing],
    });
    const ledger = Either.getOrThrow(read);
    expect(ledger.entries.map((e) => e.role)).toEqual(["first-turn", "closing-turn"]);
    const rewritten = append(ledger);
    expect(rewritten.$schema).toBe(currentSchemaUrl("cost-ledger"));
    expect(rewritten.entries.map((e) => e.role)).toEqual([
      "first-turn",
      "closing-turn",
      "code-review",
    ]);
  });

  it("stamped 0.25.0 reads through the 0.25.0 decoder, refuses a first-turn entry, and is rewritten at the current stamp", () => {
    const handoff = { ...phaseEntry, role: "handoff" as const };
    const read = readCostLedgerFile("cost-ledger.json", {
      $schema: schemaUrl("cost-ledger", "0.25.0"),
      entries: [handoff],
    });
    const rewritten = append(Either.getOrThrow(read));
    expect(rewritten.$schema).toBe(currentSchemaUrl("cost-ledger"));
    expect(rewritten.entries.map((e) => e.role)).toEqual(["handoff", "code-review"]);

    const refused = readCostLedgerFile("cost-ledger.json", {
      $schema: schemaUrl("cost-ledger", "0.25.0"),
      entries: [phaseEntry],
    });
    expect(Either.isLeft(refused)).toBe(true);
  });
});
