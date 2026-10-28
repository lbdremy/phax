import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { extractVibeExportUsage } from "../../src/domain/records/usage.js";
import { decodeVibeExportText, decodeVibeOutcomeText } from "../../src/schemas/vibeExport.js";
import {
  VIBE3_EXPORT_LONG,
  VIBE3_EXPORT_SHORT,
  VIBE3_SESSION_ID,
  vibe3ExportText,
} from "../helpers/vibe3Fixtures.js";

function refusalOf(text: string) {
  const decoded = decodeVibeExportText(text);
  if (Either.isRight(decoded)) throw new Error("expected a refusal");
  return decoded.left;
}

describe("decodeVibeExportText", () => {
  it("decodes the probe's exports with their config, ignoring limits, steps, journal_dir and timestamps", () => {
    const decoded = decodeVibeExportText(vibe3ExportText(VIBE3_EXPORT_LONG));
    if (Either.isLeft(decoded)) throw new Error(decoded.left.detail);
    expect(decoded.right).toEqual({
      schema_version: 1,
      session_id: VIBE3_SESSION_ID,
      usage: {
        input_tokens: 34588,
        output_tokens: 288,
        cached_input_tokens: 9600,
        total_tokens: 34876,
      },
      cost_usd: 0.054042,
      outcome: "finished",
      exit_code: 0,
      vibe_version: "3.0.3",
      config: { active_model: "mistral-medium-3.5" },
    });
  });

  it("accepts a document that carries only the keys phax reads", () => {
    const { schema_version, session_id, usage, cost_usd, outcome, exit_code, vibe_version } =
      VIBE3_EXPORT_SHORT;
    const minimal = {
      schema_version,
      session_id,
      usage,
      cost_usd,
      outcome,
      exit_code,
      vibe_version,
    };
    expect(Either.isRight(decodeVibeExportText(JSON.stringify(minimal)))).toBe(true);
  });

  it.each([
    ["a schema_version other than 1", { ...VIBE3_EXPORT_SHORT, schema_version: 2 }],
    ["a missing schema_version", { ...VIBE3_EXPORT_SHORT, schema_version: undefined }],
    ["an empty session_id", { ...VIBE3_EXPORT_SHORT, session_id: "" }],
    ["a missing usage", { ...VIBE3_EXPORT_SHORT, usage: undefined }],
    [
      "a missing cached_input_tokens",
      {
        ...VIBE3_EXPORT_SHORT,
        usage: { ...VIBE3_EXPORT_SHORT.usage, cached_input_tokens: undefined },
      },
    ],
    [
      "a missing total_tokens",
      { ...VIBE3_EXPORT_SHORT, usage: { ...VIBE3_EXPORT_SHORT.usage, total_tokens: undefined } },
    ],
    [
      "a negative token count",
      { ...VIBE3_EXPORT_SHORT, usage: { ...VIBE3_EXPORT_SHORT.usage, input_tokens: -1 } },
    ],
    [
      "a token count that is not a number",
      { ...VIBE3_EXPORT_SHORT, usage: { ...VIBE3_EXPORT_SHORT.usage, output_tokens: "3" } },
    ],
    ["a missing cost_usd", { ...VIBE3_EXPORT_SHORT, cost_usd: undefined }],
    ["a missing outcome", { ...VIBE3_EXPORT_SHORT, outcome: undefined }],
    ["a missing exit_code", { ...VIBE3_EXPORT_SHORT, exit_code: undefined }],
    ["a missing vibe_version", { ...VIBE3_EXPORT_SHORT, vibe_version: undefined }],
  ])("refuses %s with a typed error", (_name, document) => {
    expect(refusalOf(JSON.stringify(document)).reason).toBe("not-an-export");
    expect(refusalOf(JSON.stringify(document)).detail).not.toBe("");
  });

  it("refuses text that is not JSON as not-json", () => {
    expect(refusalOf("{not json").reason).toBe("not-json");
    expect(refusalOf("").reason).toBe("not-json");
  });

  it.each([["null"], ["[]"], ["42"], ['"export"'], ["true"]])(
    "refuses the JSON value %s as not an export",
    (text) => {
      expect(refusalOf(text).reason).toBe("not-an-export");
    },
  );
});

// A seeded generator: the same corpus on every run.
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function mutate(text: string, next: () => number): string {
  const at = Math.floor(next() * text.length);
  switch (Math.floor(next() * 4)) {
    case 0:
      return text.slice(0, at);
    case 1:
      return text.slice(0, at) + text.slice(at + 1);
    case 2:
      return text.slice(0, at) + String.fromCharCode(Math.floor(next() * 0xffff)) + text.slice(at);
    default:
      return text.slice(0, at) + "null" + text.slice(at + 3);
  }
}

describe("decodeVibeOutcomeText", () => {
  const failureExport = {
    schema_version: 1,
    session_id: null,
    usage: null,
    cost_usd: null,
    outcome: "infrastructure_failure",
    exit_code: 2,
    error: { message: "All connection attempts failed", code: "backend_error" },
    vibe_version: "3.0.3",
    steps: null,
    config: null,
  };

  it("decodes a failure export whose session id, usage, cost, steps and config are null", () => {
    const decoded = decodeVibeOutcomeText(JSON.stringify(failureExport));
    if (Either.isLeft(decoded)) throw new Error(decoded.left.detail);
    expect(decoded.right).toEqual({
      schema_version: 1,
      session_id: null,
      usage: null,
      cost_usd: null,
      outcome: "infrastructure_failure",
      exit_code: 2,
      error: { message: "All connection attempts failed", code: "backend_error" },
      vibe_version: "3.0.3",
      config: null,
    });
  });

  it("reads an error with a null code, and a null error", () => {
    const noCode = decodeVibeOutcomeText(
      JSON.stringify({ ...failureExport, error: { message: "boom", code: null } }),
    );
    const noError = decodeVibeOutcomeText(JSON.stringify({ ...failureExport, error: null }));
    if (Either.isLeft(noCode) || Either.isLeft(noError)) throw new Error("expected both to decode");
    expect(noCode.right.error).toEqual({ message: "boom", code: null });
    expect(noError.right.error).toBeNull();
  });

  it("decodes every export decodeVibeExportText decodes, with the same values", () => {
    for (const exported of [VIBE3_EXPORT_SHORT, VIBE3_EXPORT_LONG]) {
      const text = vibe3ExportText(exported);
      const strict = decodeVibeExportText(text);
      const outcome = decodeVibeOutcomeText(text);
      if (Either.isLeft(strict) || Either.isLeft(outcome)) throw new Error("expected both");
      expect(outcome.right).toEqual(strict.right);
    }
  });

  it.each([
    ["an error without a message", { ...failureExport, error: { code: "backend_error" } }],
    ["a schema_version other than 1", { ...failureExport, schema_version: 2 }],
    ["an empty session_id", { ...failureExport, session_id: "" }],
    ["a missing outcome", { ...failureExport, outcome: undefined }],
  ])("refuses %s", (_name, exported) => {
    expect(Either.isLeft(decodeVibeOutcomeText(JSON.stringify(exported)))).toBe(true);
  });

  it("refuses text that is not JSON", () => {
    expect(Either.isLeft(decodeVibeOutcomeText("{ not json"))).toBe(true);
  });

  it("leaves the strict decode, and the usage read from it, as they were", () => {
    const text = JSON.stringify(failureExport);
    expect(Either.isLeft(decodeVibeExportText(text))).toBe(true);
    expect(extractVibeExportUsage(text)).toBeUndefined();
    expect(extractVibeExportUsage(vibe3ExportText(VIBE3_EXPORT_SHORT))).toEqual({
      provider: "mistral-vibe",
      inputTokens: 10987,
      cachedInputTokens: 3200,
      outputTokens: 3,
      costUsd: 0.016503,
    });
  });
});

describe("decodeVibeExportText fuzz", () => {
  it("never throws on mutated exports and arbitrary strings: it decodes or refuses", () => {
    const next = generator(20261028);
    const valid = vibe3ExportText(VIBE3_EXPORT_SHORT);
    for (let round = 0; round < 400; round++) {
      let text = valid;
      for (let step = 0; step <= Math.floor(next() * 4); step++) text = mutate(text, next);
      const decoded = decodeVibeExportText(text);
      expect(Either.isLeft(decoded) || Either.isRight(decoded)).toBe(true);
    }
    for (let round = 0; round < 200; round++) {
      const length = Math.floor(next() * 64);
      let text = "";
      for (let at = 0; at < length; at++) text += String.fromCharCode(Math.floor(next() * 0xffff));
      expect(Either.isLeft(decodeVibeExportText(text))).toBe(true);
    }
  });
});
