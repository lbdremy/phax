import { Either } from "effect";
import type { ClaudeTokenUsage, CodexTokenUsage, VibeTokenUsage } from "../../schemas/runRecord.js";
import { decodeVibeExportText, type VibeExport } from "../../schemas/vibeExport.js";

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
 * The directory a headless Vibe turn writes its `export.json` into: the turn's
 * transcript name with a trailing `.jsonl` replaced by `.vibe-export`
 * (`output.jsonl` -> `output.vibe-export`, `fix-01.jsonl` ->
 * `fix-01.vibe-export`). It works on a folder-relative name and a full path
 * alike. The adapter that passes it as `--output-dir` and the usage reader
 * both name it through this one function.
 */
export function vibeExportDirOf(transcriptPath: string): string {
  return transcriptPath.replace(/\.jsonl$/, ".vibe-export");
}

const PHASE_SESSION_TURN = /^(output|handoff-generation|fix-attempt-(\d+))\.(jsonl|vibe-export)$/;

/**
 * The transcripts of a phase's builder session, named from a phase folder's
 * entries (`names`: a turn's stream or its export directory), in run order:
 * its turn (`output.jsonl`), its fix attempts ascending, then its handoff. A
 * Vibe export counts its own turn only, so a phase's usage is the sum over
 * these. Stop turns are other sessions' and are left out.
 */
export function phaseSessionTranscripts(names: readonly string[]): readonly string[] {
  const turns = new Map<string, number>();
  for (const name of names) {
    const match = PHASE_SESSION_TURN.exec(name);
    if (match?.[1] === undefined) continue;
    const rank =
      match[1] === "output"
        ? -1
        : match[1] === "handoff-generation"
          ? Number.MAX_SAFE_INTEGER
          : Number(match[2]);
    turns.set(`${match[1]}.jsonl`, rank);
  }
  return [...turns].toSorted((a, b) => a[1] - b[1]).map(([transcript]) => transcript);
}

/**
 * Whether `name`, an entry of a phase folder, is a Vibe turn's export
 * directory. Its `config` and journal are Vibe's own, so a phase record never
 * carries one.
 */
export function isVibeExportDir(name: string): boolean {
  return name.endsWith(".vibe-export");
}

/** The `export.json` Vibe writes inside a turn's export directory. */
export function vibeExportFileOf(transcriptPath: string): string {
  return `${vibeExportDirOf(transcriptPath)}/export.json`;
}

function vibeUsageOf(exported: VibeExport): VibeTokenUsage {
  return {
    provider: "mistral-vibe",
    inputTokens: exported.usage.input_tokens,
    cachedInputTokens: exported.usage.cached_input_tokens,
    outputTokens: exported.usage.output_tokens,
    costUsd: exported.cost_usd,
  };
}

/**
 * Extract one turn's token usage from the text of the `export.json` Vibe 3
 * writes into its `--output-dir`. Its usage and cost count that turn only: a
 * session's usage is the sum over its turns' exports. Returns `undefined`
 * when the text is not a version-1 export.
 */
export function extractVibeExportUsage(exportJsonText: string): VibeTokenUsage | undefined {
  const decoded = decodeVibeExportText(exportJsonText);
  return Either.isLeft(decoded) ? undefined : vibeUsageOf(decoded.right);
}
