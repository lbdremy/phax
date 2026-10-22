// A cost ledger entry from one Claude invocation's stream facts. Pure. A
// stream with a result event gives a complete entry, read from its per-model
// usage and corrected when Claude Code reports a resumed session
// cumulatively; a stream without one gives a partial entry, priced from its
// assistant messages. A closing turn is always priced from its own stream's
// messages: the person may have continued its session, and the result then
// reports cost cumulatively, including turns the ledger never saw. Every rate-limit reading becomes a sample of the run's
// cost so far. The reference is the spike spikes/plan-estimate/phax_estimate.py
// (`scan_streams`, `per_invocation`).
import type {
  ClaudeStreamFacts,
  StreamMessageUsage,
  StreamModelUsage,
} from "../../schemas/claudeStream.js";
import type { CostLedger, CostLedgerEntry, RateLimitSample } from "../../schemas/costLedger.js";
import { listPriceFor, type ModelListPrice } from "../routing/prices.js";

/** The first Claude Code release that reports a resumed session's `modelUsage` cumulatively. */
export const CUMULATIVE_SINCE = [2, 1, 268] as const;

/** Whether a stream of this Claude Code version reports a resumed session cumulatively. */
export function reportsCumulative(version: readonly [number, number, number] | null): boolean {
  if (version === null) return false;
  for (let i = 0; i < 3; i++) {
    const difference = version[i]! - CUMULATIVE_SINCE[i]!;
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/** One assistant message's API-list cost, USD. */
export function messageCostUsd(usage: StreamMessageUsage, price: ModelListPrice): number {
  const write5m = Math.max(0, usage.cacheWriteTokens - usage.cacheWrite1hTokens);
  return (
    (usage.inputTokens * price.inputUsdPerMTok +
      usage.outputTokens * price.outputUsdPerMTok +
      usage.cacheReadTokens * price.cacheReadUsdPerMTok +
      write5m * price.cacheWrite5mUsdPerMTok +
      usage.cacheWrite1hTokens * price.cacheWrite1hUsdPerMTok) /
    1e6
  );
}

/**
 * Which invocation an entry records: a phase's turn, fix, handoff, or an
 * interactive phase's first or closing turn, or the run's compliance review.
 */
export type InvocationRole =
  | {
      readonly role: "phase" | "fix" | "handoff" | "first-turn" | "closing-turn";
      readonly phase: string;
    }
  | { readonly role: "compliance"; readonly phase: null };

type LedgerEntryInput = InvocationRole & {
  readonly facts: ClaudeStreamFacts;
  /** The ledger's entries before this one. */
  readonly earlier: ReadonlyArray<CostLedgerEntry>;
  /** The wall-clock milliseconds phax measured around the invocation: a partial entry's `agentMs`. */
  readonly partialAgentMs: number;
  /** The ISO instant the invocation ended. */
  readonly endedAt: string;
  readonly priceFor?: (model: string) => ModelListPrice | undefined;
};

type ModelCost = StreamModelUsage;

const ZERO: ModelCost = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function add(a: ModelCost, b: ModelCost): ModelCost {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

function subtractFloored(a: ModelCost, b: ModelCost): ModelCost {
  return {
    inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
    outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
    cacheReadTokens: Math.max(0, a.cacheReadTokens - b.cacheReadTokens),
    cacheWriteTokens: Math.max(0, a.cacheWriteTokens - b.cacheWriteTokens),
    costUsd: Math.max(0, a.costUsd - b.costUsd),
  };
}

function rounded(cost: ModelCost): ModelCost {
  return { ...cost, costUsd: roundUsd(cost.costUsd) };
}

function isZero(cost: ModelCost): boolean {
  return (
    cost.inputTokens === 0 &&
    cost.outputTokens === 0 &&
    cost.cacheReadTokens === 0 &&
    cost.cacheWriteTokens === 0 &&
    cost.costUsd === 0
  );
}

/** The per-model sums of entries. */
function modelSums(entries: ReadonlyArray<CostLedgerEntry>): Map<string, ModelCost> {
  const sums = new Map<string, ModelCost>();
  for (const entry of entries) {
    for (const [model, cost] of Object.entries(entry.models)) {
      sums.set(model, add(sums.get(model) ?? ZERO, cost));
    }
  }
  return sums;
}

/** A complete entry's models: the result's, less the session's earlier entries when cumulative. */
function completeModels(
  modelUsage: Readonly<Record<string, StreamModelUsage>>,
  previous: ReadonlyMap<string, ModelCost>,
): Record<string, ModelCost> {
  const models: Record<string, ModelCost> = {};
  for (const [model, reported] of Object.entries(modelUsage)) {
    const before = previous.get(model);
    const own = rounded(before === undefined ? reported : subtractFloored(reported, before));
    if (!isZero(own)) models[model] = own;
  }
  return models;
}

/** The stream's assistant messages, deduplicated by id with the last occurrence winning. */
function lastMessages(
  facts: ClaudeStreamFacts,
): Map<string, { readonly model: string; readonly usage: StreamMessageUsage }> {
  const messages = new Map<string, { model: string; usage: StreamMessageUsage }>();
  for (const event of facts.events) {
    if (event.kind === "message")
      messages.set(event.id, { model: event.model, usage: event.usage });
  }
  return messages;
}

/** A partial entry's models: its deduplicated messages' tokens and priced cost, by model. */
function partialModels(
  facts: ClaudeStreamFacts,
  priceFor: (model: string) => ModelListPrice | undefined,
): Record<string, ModelCost> {
  const sums = new Map<string, ModelCost>();
  for (const { model, usage } of lastMessages(facts).values()) {
    const price = priceFor(model);
    sums.set(
      model,
      add(sums.get(model) ?? ZERO, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: price === undefined ? 0 : messageCostUsd(usage, price),
      }),
    );
  }
  const models: Record<string, ModelCost> = {};
  for (const [model, cost] of sums) {
    const own = rounded(cost);
    if (!isZero(own)) models[model] = own;
  }
  return models;
}

function isoInstant(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** One sample per window reading, each with the run's cost when the stream reported it. */
function samples(
  facts: ClaudeStreamFacts,
  earlierCostUsd: number,
  priceFor: (model: string) => ModelListPrice | undefined,
): RateLimitSample[] {
  const seen = new Map<string, number>();
  let streamCostUsd = 0;
  const out: RateLimitSample[] = [];
  for (const event of facts.events) {
    if (event.kind === "message") {
      const price = priceFor(event.model);
      streamCostUsd -= seen.get(event.id) ?? 0;
      const cost = price === undefined ? 0 : messageCostUsd(event.usage, price);
      seen.set(event.id, cost);
      streamCostUsd += cost;
      continue;
    }
    for (const reading of event.readings) {
      out.push({
        window: reading.window,
        utilization: Math.min(100, Math.max(0, round2(reading.fraction * 100))),
        resetsAt: isoInstant(reading.resetsAtEpochSeconds),
        runCostUsd: roundUsd(Math.max(0, earlierCostUsd + streamCostUsd)),
      });
    }
  }
  return out;
}

/**
 * The ledger entry of one invocation, or null when its stream never started
 * (no session id). Complete when the stream has a result: its per-model
 * usage, less the per-model sums of the earlier entries of the same session
 * when Claude Code reports cumulatively (each field floored at 0, an all-zero
 * model dropped). Partial otherwise: its assistant messages, deduplicated by
 * id and priced with `priceFor` (an unpriced model counts $0). A closing-turn
 * stream is priced that way whether or not it has a result, and never
 * subtracts earlier entries; it is complete when it has a result, and its
 * `agentMs` is then the result's duration. USD values are rounded to 6
 * decimals.
 */
export function ledgerEntryFor(input: LedgerEntryInput): CostLedgerEntry | null {
  const { facts, earlier, partialAgentMs, endedAt } = input;
  const priceFor = input.priceFor ?? listPriceFor;
  const sessionId = facts.sessionId;
  if (sessionId === null) return null;

  let models: Record<string, ModelCost>;
  let agentMs: number;
  if (input.role === "closing-turn") {
    models = partialModels(facts, priceFor);
    agentMs =
      facts.result !== null
        ? Math.round(facts.result.durationMs)
        : Math.max(0, Math.round(partialAgentMs));
  } else if (facts.result !== null) {
    const sameSession = earlier.filter((entry) => entry.sessionId === sessionId);
    const previous =
      reportsCumulative(facts.claudeCodeVersion) && sameSession.length > 0
        ? modelSums(sameSession)
        : new Map<string, ModelCost>();
    models = completeModels(facts.result.modelUsage, previous);
    agentMs = Math.round(facts.result.durationMs);
  } else {
    models = partialModels(facts, priceFor);
    agentMs = Math.max(0, Math.round(partialAgentMs));
  }

  const earlierCostUsd = earlier.reduce((sum, entry) => sum + entry.costUsd, 0);
  const ref: InvocationRole =
    input.role === "compliance"
      ? { role: input.role, phase: null }
      : { role: input.role, phase: input.phase };
  return {
    ...ref,
    completeness: facts.result !== null ? "complete" : "partial",
    provider: "claude-code",
    sessionId,
    models,
    costUsd: roundUsd(Object.values(models).reduce((sum, cost) => sum + cost.costUsd, 0)),
    agentMs,
    endedAt,
    rateLimitSamples: samples(facts, earlierCostUsd, priceFor),
  };
}

/** The ledger with `entry` appended. */
export function appendEntry(ledger: CostLedger, entry: CostLedgerEntry): CostLedger {
  return { ...ledger, entries: [...ledger.entries, entry] };
}

/** A run folder's entry names, and the entry names of each of its phase folders. */
export type RunFolderListing = {
  readonly entries: readonly string[];
  /** Keyed by phase folder name (`phase-01`, `phase-01.reset-<stamp>`). */
  readonly phaseEntries: Readonly<Record<string, readonly string[]>>;
};

/** One kept invocation stream of a run, its path relative to the run folder. */
export type RunStream = InvocationRole & { readonly relativePath: string };

const PHASE_FOLDER = /^phase-(\d{2,})(?:\.reset-(.+))?$/;
const FIX_STREAM = /^fix-attempt-(\d{2,})\.jsonl$/;
const TURN_STREAM = /^(first-turn|closing-turn)-(\d{2,})(-retry)?\.jsonl$/;
const COMPLIANCE_STREAM = "compliance-review.session.jsonl";

/** Whether a run folder entry is a phase folder, live (`phase-01`) or reset (`phase-01.reset-<stamp>`). */
export function isPhaseFolderName(name: string): boolean {
  return PHASE_FOLDER.test(name);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * An interactive phase's turn streams of one role, in the order they ran:
 * turn number ascending, each turn's corrective `-retry` stream after it.
 */
function turnStreams(
  folder: string,
  phase: string,
  names: readonly string[],
  role: "first-turn" | "closing-turn",
): RunStream[] {
  return names
    .flatMap((name) => {
      const match = TURN_STREAM.exec(name);
      if (match?.[1] !== role || match[2] === undefined) return [];
      return [{ name, turn: Number(match[2]), retry: match[3] !== undefined }];
    })
    .toSorted((a, b) => a.turn - b.turn || Number(a.retry) - Number(b.retry))
    .map(({ name }) => ({ role, phase, relativePath: `${folder}/${name}` }));
}

/**
 * A phase folder's streams in run order: an interactive phase's first turns,
 * its turn, its fix attempts ascending, its handoff, then its closing turns.
 */
function phaseFolderStreams(folder: string, phase: string, names: readonly string[]): RunStream[] {
  const streams: RunStream[] = turnStreams(folder, phase, names, "first-turn");
  if (names.includes("output.jsonl")) {
    streams.push({ role: "phase", phase, relativePath: `${folder}/output.jsonl` });
  }
  const fixes = names
    .flatMap((name) => {
      const match = FIX_STREAM.exec(name);
      return match?.[1] === undefined ? [] : [{ name, attempt: Number(match[1]) }];
    })
    .toSorted((a, b) => a.attempt - b.attempt);
  for (const { name } of fixes) {
    streams.push({ role: "fix", phase, relativePath: `${folder}/${name}` });
  }
  if (names.includes("handoff-generation.jsonl")) {
    streams.push({ role: "handoff", phase, relativePath: `${folder}/handoff-generation.jsonl` });
  }
  streams.push(...turnStreams(folder, phase, names, "closing-turn"));
  return streams;
}

/**
 * A run folder's kept Claude invocation streams in the order the run wrote
 * them: phases by id, each phase's `.reset-<stamp>` folders in ascending stamp
 * order before its live folder, and the compliance review last. Any other
 * name is ignored.
 */
export function runStreamsInOrder(runFolder: RunFolderListing): RunStream[] {
  const folders = runFolder.entries
    .flatMap((name) => {
      const match = PHASE_FOLDER.exec(name);
      if (match?.[1] === undefined) return [];
      return [{ name, number: Number(match[1]), phase: `phase-${match[1]}`, stamp: match[2] }];
    })
    .toSorted((a, b) => {
      if (a.number !== b.number) return a.number - b.number;
      if (a.stamp === undefined) return b.stamp === undefined ? 0 : 1;
      if (b.stamp === undefined) return -1;
      return compareText(a.stamp, b.stamp);
    });
  const streams = folders.flatMap((folder) =>
    phaseFolderStreams(folder.name, folder.phase, runFolder.phaseEntries[folder.name] ?? []),
  );
  if (runFolder.entries.includes(COMPLIANCE_STREAM)) {
    streams.push({ role: "compliance", phase: null, relativePath: COMPLIANCE_STREAM });
  }
  return streams;
}

/** One kept stream's decoded facts, in run order, with the instant it ended. */
export type KeptStream = InvocationRole & {
  readonly facts: ClaudeStreamFacts;
  readonly endedAt: string;
};

/**
 * The ledger the run would have written from its kept streams, folded in run
 * order. A partial entry carries no duration (`agentMs` 0); a stream that
 * never started (no Claude session id) adds nothing.
 */
export function ledgerFromStreams(
  streams: ReadonlyArray<KeptStream>,
  priceFor: (model: string) => ModelListPrice | undefined = listPriceFor,
): CostLedger {
  let ledger: CostLedger = { entries: [] };
  for (const stream of streams) {
    const role: InvocationRole =
      stream.role === "compliance"
        ? { role: stream.role, phase: null }
        : { role: stream.role, phase: stream.phase };
    const entry = ledgerEntryFor({
      ...role,
      facts: stream.facts,
      earlier: ledger.entries,
      partialAgentMs: 0,
      endedAt: stream.endedAt,
      priceFor,
    });
    if (entry !== null) ledger = appendEntry(ledger, entry);
  }
  return ledger;
}
