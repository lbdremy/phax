// `phax plans estimate`'s text view. Pure: it reads an `EstimateReport` and
// returns the lines the operator sees — the history line, the phase table and
// the run line, what is not estimated, the subscription windows, the P50 and
// P90 scenarios, and the verdict. `nowMs` serves only the age of a last
// sample; instants are shown in the given time zone. Warnings are not
// rendered here: the command prints them on stderr.
import type { EstimateReport } from "./estimate.js";

export interface RenderEstimateOptions {
  /** An IANA time zone, e.g. "UTC" or "Europe/Paris". */
  readonly timeZone: string;
  readonly nowMs: number;
}

type ReportWindows = NonNullable<EstimateReport["windows"]>;
type ReportWindow = ReportWindows["fiveHour"];
type Scenario = NonNullable<EstimateReport["scenarios"]>["p50"];
type NotEstimatedPart = EstimateReport["notEstimated"][number];
type UncalibratedPart = EstimateReport["uncalibrated"][number];

const DAY_MS = 24 * 60 * 60 * 1000;

const PART_LABEL: Readonly<Record<NotEstimatedPart, string>> = {
  "plan-extraction": "plan extraction",
  "plan-auditor": "plan auditor",
  "interactive-code-review": "interactive code review",
  "compliance-review": "compliance review",
};

const UNCALIBRATED_LABEL: Readonly<Record<UncalibratedPart, string>> = {
  "five-hour": "five-hour window (no samples in the last 28 days)",
  "seven-day": "seven-day window (no samples in the last 28 days)",
  "burn-rate": "burn rate (no agent time in the last 30 days)",
};

const NOT_ESTIMATED_REASON = {
  "other-provider": "other provider",
  "no-list-price": "no list price",
  "thin-interactive-history": "too few past interactive phases",
} as const;

const INTERACTIVE_NOTE =
  "Interactive phases: first and closing turns only; the person's work is not estimated.";

function part(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((p) => p.type === type)?.value ?? "";
}

function formatParts(ms: number, timeZone: string): readonly Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
}

/** `Fri 16 Oct 14:50`. */
function dayTime(ms: number, timeZone: string): string {
  const parts = formatParts(ms, timeZone);
  return `${part(parts, "weekday")} ${part(parts, "day")} ${part(parts, "month")} ${clock(ms, timeZone)}`;
}

/** `14:50`. */
function clock(ms: number, timeZone: string): string {
  const parts = formatParts(ms, timeZone);
  return `${part(parts, "hour")}:${part(parts, "minute")}`;
}

/** `HH:MM` within a day of the reading, else the weekday and date too. */
function when(isoInstant: string, observedMs: number, timeZone: string): string {
  const ms = Date.parse(isoInstant);
  return ms - observedMs < DAY_MS ? clock(ms, timeZone) : dayTime(ms, timeZone);
}

function usd(value: number): string {
  return value.toFixed(2);
}

function wholeUsd(value: number): string {
  return `$${Math.round(value)}`;
}

function historyLines(report: EstimateReport): string[] {
  const { history } = report;
  const lines =
    report.verdict === "thin-history"
      ? [`History: ${history.phases} phases — an estimate needs ${history.required}; none printed`]
      : [
          `History: ${history.phases} phases, sized by planned-file bytes, recent runs weighted (half-life ${history.halfLifeDays}d)`,
        ];
  if (history.unledgeredRuns > 0) {
    lines.push(
      `  ${history.unledgeredRuns} kept runs have no cost ledger: run \`phax cost backfill\` to add them`,
    );
  }
  return lines;
}

function tableLines(report: EstimateReport): string[] {
  if (report.run === null) return [];
  const rows: string[][] = [["phase", "model", "effort", "P10", "P50", "P90"]];
  for (const phase of report.phases) {
    if (phase.estimate === null) continue;
    const { p10, p50, p90 } = phase.estimate;
    // An interactive phase is sized by its turns alone, whatever its effort.
    const effort = phase.mode === "interactive" ? "interactive" : phase.effort;
    rows.push([phase.id, phase.model, effort, usd(p10), usd(p50), usd(p90)]);
  }
  const { run } = report;
  if (run.runLevel > 0) {
    const level = usd(run.runLevel);
    rows.push(["run-level", "compliance review", "", level, level, level]);
  }
  rows.push(["run", "API-list $", "", usd(run.p10), usd(run.p50), usd(run.p90)]);

  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) =>
    row
      .map((cell, column) =>
        column < 3 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!),
      )
      .join("  ")
      .trimEnd(),
  );
}

function notEstimatedLine(report: EstimateReport): string {
  const named = report.phases.flatMap((phase) =>
    "notEstimated" in phase
      ? [`${phase.id} (${phase.provider}, ${NOT_ESTIMATED_REASON[phase.notEstimated]})`]
      : [],
  );
  const parts = report.notEstimated.map((p) => PART_LABEL[p]);
  return `Not estimated: ${[...named, ...parts].join(", ")}.`;
}

function windowLine(
  label: string,
  window: ReportWindow,
  showCapacity: boolean,
  timeZone: string,
): string {
  const head = `  ${label}  ${window.utilization}% used, resets ${dayTime(Date.parse(window.resetsAt), timeZone)}`;
  if (!showCapacity) return head;
  if (window.capacityUsd === null) return `${head}   not calibrated`;
  const left = Math.max(0, (window.capacityUsd * (100 - window.utilization)) / 100);
  return `${head}   ≈ ${wholeUsd(window.capacityUsd)}/window, ${wholeUsd(left)} left`;
}

function subscriptionLines(report: EstimateReport, opts: RenderEstimateOptions): string[] {
  if (report.verdict === "no-subscription") {
    return ["Subscription: API-key authentication, no subscription window"];
  }
  if (report.verdict === "windows-unavailable") {
    return [`Subscription: windows unavailable — ${report.windowsUnavailable}`];
  }
  const { windows } = report;
  if (windows === null) return [];
  const header =
    windows.source === "probe"
      ? "Subscription (probe):"
      : `Subscription (last sample, ${Math.max(0, Math.round((opts.nowMs - Date.parse(windows.observedAt)) / 60_000))} min old — usage since then is not counted):`;
  // Thin history calibrates nothing: the windows are shown as read.
  const showCapacity = report.verdict !== "thin-history";
  return [
    header,
    windowLine("five-hour", windows.fiveHour, showCapacity, opts.timeZone),
    windowLine("seven-day", windows.sevenDay, showCapacity, opts.timeZone),
  ];
}

function scenarioLine(
  label: string,
  scenario: Scenario,
  observedMs: number,
  timeZone: string,
): string {
  if (scenario.pauses.length === 0) {
    return `${label}: fits — agent time ends ≈ ${when(scenario.endsAt, observedMs, timeZone)}`;
  }
  const pauses = scenario.pauses.map(
    (pause) =>
      `${pause.window} exhausted in ${pause.phase} ≈ ${when(pause.at, observedMs, timeZone)}, resumes ${when(pause.resumesAt, observedMs, timeZone)}`,
  );
  return `${label}: ${pauses.join("; ")}`;
}

function verdictLine(report: EstimateReport): string {
  switch (report.verdict) {
    case "fits":
      return "Verdict: fits — no pause expected, even at P90";
    case "risky":
      return "Verdict: risky — fits at P50, a pause is possible at P90";
    case "wait":
      return "Verdict: wait — a pause is expected at P50; starting after the next reset avoids it";
    case "thin-history":
      return `Verdict: thin-history — ${report.history.phases} sized phases, an estimate needs ${report.history.required}`;
    case "no-subscription":
      return "Verdict: no-subscription — estimate only";
    case "windows-unavailable":
      return "Verdict: windows-unavailable — estimate only";
    case "uncalibrated":
      return `Verdict: uncalibrated — estimate only; not calibrated: ${report.uncalibrated.join(", ")}`;
  }
}

/** The report as the operator reads it, one line per entry. */
export function renderEstimate(report: EstimateReport, opts: RenderEstimateOptions): string {
  const blocks: string[][] = [historyLines(report)];
  if (report.run !== null) {
    const estimatedInteractive = report.phases.some(
      (phase) => phase.mode === "interactive" && phase.estimate !== null,
    );
    blocks.push([
      ...tableLines(report),
      ...(estimatedInteractive ? [INTERACTIVE_NOTE] : []),
      notEstimatedLine(report),
    ]);
  }

  const subscription = subscriptionLines(report, opts);
  if (report.verdict === "uncalibrated") {
    subscription.push(
      ...report.uncalibrated.map((p) => `Not calibrated: ${UNCALIBRATED_LABEL[p]}`),
    );
  }
  if (subscription.length > 0) blocks.push(subscription);

  const tail: string[] = [];
  if (report.scenarios !== null && report.windows !== null) {
    const observedMs = Date.parse(report.windows.observedAt);
    tail.push(scenarioLine("P50", report.scenarios.p50, observedMs, opts.timeZone));
    tail.push(scenarioLine("P90", report.scenarios.p90, observedMs, opts.timeZone));
  }
  tail.push(verdictLine(report));
  blocks.push(tail);

  return blocks.map((block) => block.join("\n")).join("\n\n");
}
