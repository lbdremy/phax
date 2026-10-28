import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { computeSessionUsage } from "../../src/app/recordPlumbing.js";
import {
  extractClaudeUsage,
  extractCodexUsage,
  extractVibeExportUsage,
  vibeExportDirOf,
  vibeExportFileOf,
} from "../../src/domain/records/usage.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import {
  VIBE3_EXPORT_LONG,
  VIBE3_EXPORT_SHORT,
  VIBE3_SESSION_ID,
  vibe3ExportText,
} from "../helpers/vibe3Fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const codexFixturePath = join(here, "providers", "fixtures", "codex-exec-sample.jsonl");

function claudeResultLine(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    result: "done",
    session_id: "sess-abc",
    is_error: false,
    total_cost_usd: 0.12,
    usage: {
      input_tokens: 41203,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 512,
      output_tokens: 8117,
    },
    ...overrides,
  });
}

describe("extractClaudeUsage", () => {
  it("extracts usage from the result event's usage object and total_cost_usd", () => {
    const usage = extractClaudeUsage([claudeResultLine()]);
    expect(usage).toEqual({
      provider: "claude-code",
      inputTokens: 41203,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 512,
      outputTokens: 8117,
      totalCostUsd: 0.12,
    });
  });

  it("scans backward past assistant/tool lines to find the terminal result event", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      JSON.stringify({ type: "user", message: { content: [] } }),
      claudeResultLine(),
    ];
    expect(extractClaudeUsage(lines)?.inputTokens).toBe(41203);
  });

  it("returns undefined when no result event is present", () => {
    const lines = [JSON.stringify({ type: "assistant", message: { content: [] } })];
    expect(extractClaudeUsage(lines)).toBeUndefined();
  });

  it("returns undefined for a result event missing usage fields", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "done",
      session_id: "sess-abc",
      is_error: false,
    });
    expect(extractClaudeUsage([line])).toBeUndefined();
  });

  it("skips malformed JSON lines rather than throwing", () => {
    expect(extractClaudeUsage(["not json", claudeResultLine()])?.outputTokens).toBe(8117);
  });
});

describe("extractCodexUsage", () => {
  it("extracts usage from turn.completed in a real fixture transcript", () => {
    const lines = readFileSync(codexFixturePath, "utf8").split("\n").filter(Boolean);
    const usage = extractCodexUsage(lines);
    expect(usage).toEqual({
      provider: "codex-cli",
      inputTokens: 31299,
      cachedInputTokens: 2432,
      outputTokens: 5,
      reasoningOutputTokens: 0,
    });
  });

  it("returns undefined when no turn.completed event is present", () => {
    const lines = [JSON.stringify({ type: "thread.started", thread_id: "abc" })];
    expect(extractCodexUsage(lines)).toBeUndefined();
  });

  it("returns undefined for a turn.completed event missing usage fields", () => {
    const lines = [JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10 } })];
    expect(extractCodexUsage(lines)).toBeUndefined();
  });
});

describe("vibeExportDirOf and vibeExportFileOf", () => {
  it.each([
    ["output.jsonl", "output.vibe-export"],
    ["fix-01.jsonl", "fix-01.vibe-export"],
    ["first-turn-01.jsonl", "first-turn-01.vibe-export"],
    ["retry-output.jsonl", "retry-output.vibe-export"],
    ["/runs/r1/phase-01/output.jsonl", "/runs/r1/phase-01/output.vibe-export"],
  ])("names the export directory of %s beside it: %s", (transcript, exportDir) => {
    expect(vibeExportDirOf(transcript)).toBe(exportDir);
    expect(vibeExportFileOf(transcript)).toBe(`${exportDir}/export.json`);
  });

  it("replaces only a trailing .jsonl", () => {
    expect(vibeExportDirOf("a.jsonl.d/output.jsonl")).toBe("a.jsonl.d/output.vibe-export");
  });
});

describe("extractVibeExportUsage", () => {
  it("maps the export's usage and cost to the recorded usage, ignoring the keys phax does not read", () => {
    expect(extractVibeExportUsage(vibe3ExportText(VIBE3_EXPORT_SHORT))).toEqual({
      provider: "mistral-vibe",
      inputTokens: 10987,
      cachedInputTokens: 3200,
      outputTokens: 3,
      costUsd: 0.016503,
    });
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a schema_version other than 1", JSON.stringify({ ...VIBE3_EXPORT_SHORT, schema_version: 2 })],
    ["no usage", JSON.stringify({ ...VIBE3_EXPORT_SHORT, usage: undefined })],
    ["an empty text", ""],
  ])("returns undefined for %s rather than throwing", (_name, text) => {
    expect(extractVibeExportUsage(text)).toBeUndefined();
  });
});

describe("computeSessionUsage on mistral-vibe", () => {
  const FOLDER = "/work/phase-01";

  function usageOf(
    exports: Readonly<Record<string, string>>,
    transcripts: readonly string[],
  ): Promise<unknown> {
    const fs = makeFakeFileSystem();
    for (const [path, text] of Object.entries(exports)) fs.impl.setFile(`${FOLDER}/${path}`, text);
    return Effect.runPromise(
      computeSessionUsage({
        provider: "mistral-vibe",
        folder: FOLDER,
        turns: transcripts.map((transcript) => ({ transcript, sessionId: VIBE3_SESSION_ID })),
      }).pipe(Effect.provide(fs.layer)),
    );
  }

  it("sums two turns of one session field by field, with no tool-call counts", async () => {
    const usage = await usageOf(
      {
        "output.vibe-export/export.json": vibe3ExportText(VIBE3_EXPORT_SHORT),
        "retry-output.vibe-export/export.json": vibe3ExportText(VIBE3_EXPORT_LONG),
      },
      ["output.jsonl", "retry-output.jsonl"],
    );
    expect(usage).toEqual({
      available: true,
      usage: {
        provider: "mistral-vibe",
        inputTokens: 45575,
        cachedInputTokens: 12800,
        outputTokens: 291,
        costUsd: 0.070545,
      },
    });
  });

  it("counts a turn once per export, never deduplicating by session id", async () => {
    const usage = await usageOf(
      {
        "output.vibe-export/export.json": vibe3ExportText(VIBE3_EXPORT_SHORT),
        "fix-01.vibe-export/export.json": vibe3ExportText(VIBE3_EXPORT_SHORT),
      },
      ["output.jsonl", "fix-01.jsonl"],
    );
    expect(usage).toMatchObject({
      available: true,
      usage: { inputTokens: 21974, outputTokens: 6 },
    });
  });

  it("is unavailable when one turn's export is missing", async () => {
    const usage = await usageOf(
      { "output.vibe-export/export.json": vibe3ExportText(VIBE3_EXPORT_SHORT) },
      ["output.jsonl", "retry-output.jsonl"],
    );
    expect(usage).toEqual({ available: false });
  });

  it("is unavailable when one turn's export does not decode", async () => {
    const usage = await usageOf(
      {
        "output.vibe-export/export.json": vibe3ExportText(VIBE3_EXPORT_SHORT),
        "retry-output.vibe-export/export.json": "{not json",
      },
      ["output.jsonl", "retry-output.jsonl"],
    );
    expect(usage).toEqual({ available: false });
  });
});
