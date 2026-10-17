// Made-up cost history for the plan-estimate tests: ledger entries, ledgers,
// sized runs, probe stream facts, and a seeded generator of runs whose phases
// follow a known log-linear cost model. Every value is invented.
import type { HistoricalPhasePlan, LedgerSource, SizedRun } from "../../src/domain/cost/history.js";
import type { ClaudeStreamFacts, StreamWindowReading } from "../../src/schemas/claudeStream.js";
import type { CostLedger, CostLedgerEntry, RateLimitSample } from "../../src/schemas/costLedger.js";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** A fixed "now" for every test: 2026-10-17T12:00:00Z. */
export const NOW_MS = Date.parse("2026-10-17T12:00:00.000Z");

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function daysAgo(days: number, nowMs: number = NOW_MS): string {
  return iso(nowMs - days * DAY_MS);
}

export interface EntryTokens {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface EntryInput {
  readonly role?: "phase" | "fix" | "handoff" | "compliance";
  /** Ignored for the compliance role. */
  readonly phase?: string;
  readonly model?: string;
  readonly tokens?: EntryTokens;
  /** Also the model's cost; or `models` for several. */
  readonly costUsd?: number;
  readonly models?: Readonly<Record<string, EntryTokens & { readonly costUsd: number }>>;
  readonly agentMs?: number;
  readonly endedAt?: string;
  readonly completeness?: "complete" | "partial";
  readonly samples?: readonly RateLimitSample[];
}

function modelCost(tokens: EntryTokens, costUsd: number) {
  return {
    inputTokens: tokens.inputTokens ?? 0,
    outputTokens: tokens.outputTokens ?? 0,
    cacheReadTokens: tokens.cacheReadTokens ?? 0,
    cacheWriteTokens: tokens.cacheWriteTokens ?? 0,
    costUsd,
  };
}

/** One ledger entry; defaults to a complete phase-01 turn on claude-opus-5-5. */
export function ledgerEntry(input: EntryInput = {}): CostLedgerEntry {
  const costUsd =
    input.costUsd ??
    Object.values(input.models ?? {}).reduce((sum, model) => sum + model.costUsd, 0);
  const models =
    input.models !== undefined
      ? Object.fromEntries(
          Object.entries(input.models).map(([id, model]) => [id, modelCost(model, model.costUsd)]),
        )
      : { [input.model ?? "claude-opus-5-5"]: modelCost(input.tokens ?? {}, costUsd) };
  const fields = {
    completeness: input.completeness ?? "complete",
    provider: "claude-code",
    sessionId: "00000000-0000-4000-8000-000000000001",
    models,
    costUsd,
    agentMs: input.agentMs ?? 600_000,
    endedAt: input.endedAt ?? iso(NOW_MS),
    rateLimitSamples: input.samples ?? [],
  } as const;
  const role = input.role ?? "phase";
  return role === "compliance"
    ? { role, phase: null, ...fields }
    : { role, phase: input.phase ?? "phase-01", ...fields };
}

export function ledger(entries: readonly CostLedgerEntry[]): CostLedger {
  return { entries };
}

export function ledgerSource(runKey: string, entries: readonly CostLedgerEntry[]): LedgerSource {
  return { runKey, ledger: ledger(entries) };
}

export function rateLimitSample(
  window: "five-hour" | "seven-day",
  utilization: number,
  resetsAt: string,
  runCostUsd: number,
): RateLimitSample {
  return { window, utilization, resetsAt, runCostUsd };
}

export function historicalPhase(input: Partial<HistoricalPhasePlan> = {}): HistoricalPhasePlan {
  return {
    id: "phase-01",
    model: "claude-opus-5-5",
    effort: "high",
    editBytes: 8000,
    optionalBytes: 2000,
    createCount: 1,
    ...input,
  };
}

export function sizedRun(
  runKey: string,
  startedAt: string,
  phases: readonly HistoricalPhasePlan[],
): SizedRun {
  return { runKey, startedAt, phases };
}

/** A probe's stream facts: rate-limit events (each a list of readings), an API key source, undecoded events. */
export function streamFacts(
  input: {
    readonly rateLimits?: ReadonlyArray<readonly StreamWindowReading[]>;
    readonly apiKeySource?: string | null;
    readonly undecodedRateLimitEvents?: number;
  } = {},
): ClaudeStreamFacts {
  return {
    claudeCodeVersion: [2, 1, 302],
    sessionId: "00000000-0000-4000-8000-0000000000aa",
    apiKeySource: input.apiKeySource ?? "none",
    undecodedRateLimitEvents: input.undecodedRateLimitEvents ?? 0,
    events: (input.rateLimits ?? []).map((readings) => ({ kind: "rate-limit", readings })),
    result: {
      durationMs: 1200,
      modelUsage: {
        "claude-haiku-5-5": {
          inputTokens: 10,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.000002,
        },
      },
    },
  };
}

/** The mulberry32 generator: uniform draws in [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw (Box–Muller). */
function normal(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** One unit of the generated phases' token mix; it costs $1.204 at claude-opus-5-5. */
const UNIT_TOKENS = [1000, 20_000, 2_000_000, 50_000] as const;
const UNIT_REFERENCE_USD = 1.204;

/** Integer tokens of the unit mix whose claude-opus-5-5 price (1h cache writes) is about `usd`. */
export function tokensForUsd(usd: number): Required<EntryTokens> {
  const scale = usd / UNIT_REFERENCE_USD;
  return {
    inputTokens: Math.round(UNIT_TOKENS[0] * scale),
    outputTokens: Math.round(UNIT_TOKENS[1] * scale),
    cacheReadTokens: Math.round(UNIT_TOKENS[2] * scale),
    cacheWriteTokens: Math.round(UNIT_TOKENS[3] * scale),
  };
}

/** The known model: log reference USD from effort and sizes, as `features` builds them. */
export const TRUE_BETA = [0.4, 0.3, 0.6, 0.9, 1.2, 0.35, 0.1, 0.2] as const;

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface GeneratedRun {
  readonly source: LedgerSource;
  readonly sized: SizedRun;
  /** The run's actual cost, USD at claude-opus-5-5. */
  readonly actualUsd: number;
}

/**
 * `runs` runs of `phasesPerRun` phases each, spread evenly over `spanDays`
 * up to `nowMs` (oldest first), every phase on claude-opus-5-5 with a
 * reference cost exp(TRUE_BETA·x + σ·N(0,1)). Each phase's tokens are split
 * between a turn and a handoff entry.
 */
export function generateHistory(input: {
  readonly runs: number;
  readonly phasesPerRun: number;
  readonly seed: number;
  readonly sigma?: number;
  readonly spanDays?: number;
  readonly nowMs?: number;
}): GeneratedRun[] {
  const random = seededRandom(input.seed);
  const sigma = input.sigma ?? 0.35;
  const spanDays = input.spanDays ?? 120;
  const nowMs = input.nowMs ?? NOW_MS;
  const out: GeneratedRun[] = [];
  for (let r = 0; r < input.runs; r++) {
    const startMs = nowMs - spanDays * DAY_MS + ((r + 0.5) * spanDays * DAY_MS) / input.runs;
    const runKey = `demo.generated.run-${String(r).padStart(3, "0")}`;
    const phases: HistoricalPhasePlan[] = [];
    const entries: CostLedgerEntry[] = [];
    let actualUsd = 0;
    for (let p = 0; p < input.phasesPerRun; p++) {
      const id = `phase-${String(p + 1).padStart(2, "0")}`;
      const effortIndex = Math.floor(random() * EFFORTS.length);
      const plan = historicalPhase({
        id,
        effort: EFFORTS[effortIndex]!,
        editBytes: Math.round(500 + random() * 60_000),
        optionalBytes: Math.round(random() * 20_000),
        createCount: Math.floor(random() * 6),
      });
      phases.push(plan);
      const x = [
        1,
        effortIndex === 1 ? 1 : 0,
        effortIndex === 2 ? 1 : 0,
        effortIndex === 3 ? 1 : 0,
        effortIndex === 4 ? 1 : 0,
        Math.log1p(plan.editBytes / 1000),
        Math.log1p(plan.optionalBytes / 1000),
        Math.log1p(plan.createCount),
      ];
      const logUsd = x.reduce((sum, value, i) => sum + value * TRUE_BETA[i]!, 0);
      const usd = Math.exp(logUsd + sigma * normal(random));
      actualUsd += usd;
      const endedMs = startMs + (p + 1) * HOUR_MS;
      entries.push(
        ledgerEntry({
          role: "phase",
          phase: id,
          tokens: tokensForUsd(usd * 0.8),
          costUsd: usd * 0.8,
          endedAt: iso(endedMs - 10 * 60_000),
        }),
        ledgerEntry({
          role: "handoff",
          phase: id,
          tokens: tokensForUsd(usd * 0.2),
          costUsd: usd * 0.2,
          agentMs: 60_000,
          endedAt: iso(endedMs),
        }),
      );
    }
    out.push({
      source: ledgerSource(runKey, entries),
      sized: sizedRun(runKey, iso(startMs), phases),
      actualUsd,
    });
  }
  return out;
}
