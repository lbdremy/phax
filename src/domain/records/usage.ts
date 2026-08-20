import type { ClaudeTokenUsage, CodexTokenUsage, VibeTokenUsage } from "../../schemas/runRecord.js";

function parseJsonLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Extract token usage from a Claude Code `output.jsonl` transcript.
 *
 * Scans backward for the terminal `result` event, which carries `usage`
 * (input, cache-creation-input, cache-read-input, output tokens) and
 * `total_cost_usd`. Returns `undefined` when no well-formed result event
 * carrying complete usage fields is present.
 */
export function extractClaudeUsage(
  outputJsonlLines: readonly string[],
): ClaudeTokenUsage | undefined {
  for (let i = outputJsonlLines.length - 1; i >= 0; i--) {
    const line = outputJsonlLines[i];
    if (line === undefined) continue;
    const parsed = parseJsonLine(line);
    if (!isRecord(parsed) || parsed["type"] !== "result") continue;

    const usage = parsed["usage"];
    if (!isRecord(usage)) continue;

    const inputTokens = num(usage["input_tokens"]);
    const cacheCreationInputTokens = num(usage["cache_creation_input_tokens"]);
    const cacheReadInputTokens = num(usage["cache_read_input_tokens"]);
    const outputTokens = num(usage["output_tokens"]);
    const totalCostUsd = num(parsed["total_cost_usd"]);

    if (
      inputTokens === undefined ||
      cacheCreationInputTokens === undefined ||
      cacheReadInputTokens === undefined ||
      outputTokens === undefined ||
      totalCostUsd === undefined
    ) {
      continue;
    }

    return {
      provider: "claude-code",
      inputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      outputTokens,
      totalCostUsd,
    };
  }
  return undefined;
}

/**
 * Extract token usage from a codex `output.jsonl` transcript.
 *
 * Scans for `turn.completed`, which carries `usage` (input, cached-input,
 * output, reasoning-output tokens).
 */
export function extractCodexUsage(
  outputJsonlLines: readonly string[],
): CodexTokenUsage | undefined {
  for (const line of outputJsonlLines) {
    const parsed = parseJsonLine(line);
    if (!isRecord(parsed) || parsed["type"] !== "turn.completed") continue;

    const usage = parsed["usage"];
    if (!isRecord(usage)) continue;

    const inputTokens = num(usage["input_tokens"]);
    const cachedInputTokens = num(usage["cached_input_tokens"]);
    const outputTokens = num(usage["output_tokens"]);
    const reasoningOutputTokens = num(usage["reasoning_output_tokens"]);

    if (
      inputTokens === undefined ||
      cachedInputTokens === undefined ||
      outputTokens === undefined ||
      reasoningOutputTokens === undefined
    ) {
      continue;
    }

    return {
      provider: "codex-cli",
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
    };
  }
  return undefined;
}

/**
 * Extract token usage from a vibe session's `meta.json` `.stats` object.
 *
 * vibe's streaming transcript carries no usage at all; phax already reads
 * this same session directory to discover the session id
 * (`findVibeSessionId` in `src/schemas/vibeOutput.ts`). `.stats` is the
 * richest of the three sources: it also carries tool-call agreement counts
 * nothing else exposes.
 */
export function extractVibeUsage(metaJsonText: string): VibeTokenUsage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metaJsonText) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const stats = parsed["stats"];
  if (!isRecord(stats)) return undefined;

  const inputTokens = num(stats["input_tokens"]);
  const outputTokens = num(stats["output_tokens"]);
  const sessionCostUsd = num(stats["session_cost"]);
  const toolCallsAgreed = num(stats["tool_calls_agreed"]);
  const toolCallsRejected = num(stats["tool_calls_rejected"]);
  const toolCallsFailed = num(stats["tool_calls_failed"]);
  const toolCallsSucceeded = num(stats["tool_calls_succeeded"]);

  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    sessionCostUsd === undefined ||
    toolCallsAgreed === undefined ||
    toolCallsRejected === undefined ||
    toolCallsFailed === undefined ||
    toolCallsSucceeded === undefined
  ) {
    return undefined;
  }

  return {
    provider: "mistral-vibe",
    inputTokens,
    outputTokens,
    sessionCostUsd,
    toolCallsAgreed,
    toolCallsRejected,
    toolCallsFailed,
    toolCallsSucceeded,
  };
}
