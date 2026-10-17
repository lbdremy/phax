// The estimate's text view on made-up reports, rendered in UTC: the risky
// layout, thin history, unavailable windows, no subscription, uncalibrated
// windows, a last sample's age and a phase routed to another provider.
import { describe, expect, it } from "vitest";
import type { EstimateReport } from "../../../src/domain/cost/estimate.js";
import { renderEstimate } from "../../../src/domain/cost/estimateRender.js";

const NOW = "2026-10-16T10:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const opts = { timeZone: "UTC", nowMs: NOW_MS };

const history = { phases: 410, required: 60, halfLifeDays: 30, unledgeredRuns: 0 } as const;
const notEstimated = ["plan-extraction", "plan-auditor", "interactive-code-review"] as const;

const phases = [
  {
    id: "phase-01",
    provider: "claude-code",
    model: "claude-opus-5-5",
    effort: "high",
    estimate: { p10: 4.5, p50: 7.83, p90: 15.14 },
  },
  {
    id: "phase-02",
    provider: "claude-code",
    model: "claude-sonnet-5-5",
    effort: "medium",
    estimate: { p10: 0.67, p50: 1.1, p90: 2.13 },
  },
] as const;

const run = { p10: 6.2, p50: 9.4, p90: 17.9, runLevel: 0.54 };

const windows = {
  source: "probe",
  observedAt: NOW,
  fiveHour: { utilization: 15, resetsAt: "2026-10-16T14:50:00.000Z", capacityUsd: 37 },
  sevenDay: { utilization: 29, resetsAt: "2026-10-18T17:00:00.000Z", capacityUsd: 534 },
} as const;

const risky: EstimateReport = {
  history,
  notEstimated,
  burnRateUsdPerHour: 18.5,
  warnings: [],
  verdict: "risky",
  phases,
  run,
  windows,
  windowsUnavailable: null,
  uncalibrated: [],
  scenarios: {
    p50: { pauses: [], endsAt: "2026-10-16T12:04:00.000Z" },
    p90: {
      pauses: [
        {
          phase: "phase-02",
          window: "five-hour",
          at: "2026-10-16T12:22:00.000Z",
          resumesAt: "2026-10-16T14:50:00.000Z",
        },
      ],
      endsAt: "2026-10-16T15:30:00.000Z",
    },
  },
};

describe("renderEstimate", () => {
  it("renders the risky layout", () => {
    expect(renderEstimate(risky, opts)).toBe(
      [
        "History: 410 phases, sized by planned-file bytes, recent runs weighted (half-life 30d)",
        "",
        "phase      model              effort   P10   P50    P90",
        "phase-01   claude-opus-5-5    high    4.50  7.83  15.14",
        "phase-02   claude-sonnet-5-5  medium  0.67  1.10   2.13",
        "run-level  compliance review          0.54  0.54   0.54",
        "run        API-list $                 6.20  9.40  17.90",
        "Not estimated: plan extraction, plan auditor, interactive code review.",
        "",
        "Subscription (probe):",
        "  five-hour  15% used, resets Fri 16 Oct 14:50   ≈ $37/window, $31 left",
        "  seven-day  29% used, resets Sun 18 Oct 17:00   ≈ $534/window, $379 left",
        "",
        "P50: fits — agent time ends ≈ 12:04",
        "P90: five-hour exhausted in phase-02 ≈ 12:22, resumes 14:50",
        "Verdict: risky — fits at P50, a pause is possible at P90",
      ].join("\n"),
    );
  });

  it("drops the run-level row when there is no run-level cost", () => {
    const text = renderEstimate({ ...risky, run: { ...run, runLevel: 0 } }, opts);
    expect(text).not.toContain("run-level");
  });

  it("suggests phax cost backfill for unledgered runs", () => {
    const text = renderEstimate({ ...risky, history: { ...history, unledgeredRuns: 3 } }, opts);
    expect(text.split("\n")[1]).toContain("phax cost backfill");
  });

  it("renders thin history with no table", () => {
    const report: EstimateReport = {
      history: { ...history, phases: 12 },
      notEstimated,
      burnRateUsdPerHour: null,
      warnings: [],
      verdict: "thin-history",
      phases: [],
      run: null,
      windows: {
        ...windows,
        fiveHour: { ...windows.fiveHour, capacityUsd: null },
        sevenDay: { ...windows.sevenDay, capacityUsd: null },
      },
      windowsUnavailable: null,
      uncalibrated: [],
      scenarios: null,
    };
    expect(renderEstimate(report, opts)).toBe(
      [
        "History: 12 phases — an estimate needs 60; none printed",
        "",
        "Subscription (probe):",
        "  five-hour  15% used, resets Fri 16 Oct 14:50",
        "  seven-day  29% used, resets Sun 18 Oct 17:00",
        "",
        "Verdict: thin-history — 12 sized phases, an estimate needs 60",
      ].join("\n"),
    );
  });

  it("renders unavailable windows with the probe's reason", () => {
    const report: EstimateReport = {
      ...risky,
      verdict: "windows-unavailable",
      windows: null,
      windowsUnavailable: "the probe ended without a rate-limit event",
      scenarios: null,
    };
    const lines = renderEstimate(report, opts).split("\n");
    expect(lines).toContain(
      "Subscription: windows unavailable — the probe ended without a rate-limit event",
    );
    expect(lines.at(-1)).toBe("Verdict: windows-unavailable — estimate only");
    expect(lines.some((line) => line.startsWith("P50:"))).toBe(false);
  });

  it("renders no subscription", () => {
    const report: EstimateReport = {
      ...risky,
      verdict: "no-subscription",
      windows: null,
      windowsUnavailable: null,
      scenarios: null,
    };
    const lines = renderEstimate(report, opts).split("\n");
    expect(lines).toContain("Subscription: API-key authentication, no subscription window");
    expect(lines.at(-1)).toBe("Verdict: no-subscription — estimate only");
  });

  it("names what could not be calibrated", () => {
    const report: EstimateReport = {
      ...risky,
      verdict: "uncalibrated",
      windows: { ...windows, fiveHour: { ...windows.fiveHour, capacityUsd: null } },
      uncalibrated: ["five-hour", "burn-rate"],
      scenarios: null,
    };
    const lines = renderEstimate(report, opts).split("\n");
    expect(lines).toContain("  five-hour  15% used, resets Fri 16 Oct 14:50   not calibrated");
    expect(lines).toContain("Not calibrated: five-hour window (no samples in the last 28 days)");
    expect(lines).toContain("Not calibrated: burn rate (no agent time in the last 30 days)");
    expect(lines.at(-1)).toBe(
      "Verdict: uncalibrated — estimate only; not calibrated: five-hour, burn-rate",
    );
  });

  it("gives a last sample's age", () => {
    const report: EstimateReport = {
      ...risky,
      windows: { ...windows, source: "last-sample", observedAt: "2026-10-16T09:18:00.000Z" },
    };
    expect(renderEstimate(report, opts)).toContain(
      "Subscription (last sample, 42 min old — usage since then is not counted):",
    );
  });

  it("names a phase routed to another provider in the Not estimated line", () => {
    const report: EstimateReport = {
      ...risky,
      phases: [
        ...phases,
        {
          id: "phase-03",
          provider: "codex-cli",
          model: "gpt-5.5",
          effort: "high",
          estimate: null,
          notEstimated: "other-provider",
        },
      ],
      notEstimated: [...notEstimated, "compliance-review"],
    };
    const text = renderEstimate(report, opts);
    expect(text).toContain(
      "Not estimated: phase-03 (codex-cli, other provider), plan extraction, plan auditor, interactive code review, compliance review.",
    );
    expect(text).not.toMatch(/^phase-03 /m);
  });

  it("shows the day of an instant more than a day after the reading", () => {
    const report: EstimateReport = {
      ...risky,
      verdict: "wait",
      scenarios: {
        p50: {
          pauses: [
            {
              phase: "phase-01",
              window: "seven-day",
              at: "2026-10-16T11:00:00.000Z",
              resumesAt: "2026-10-18T17:00:00.000Z",
            },
          ],
          endsAt: "2026-10-18T19:00:00.000Z",
        },
        p90: risky.scenarios!.p90,
      },
    };
    expect(renderEstimate(report, opts)).toContain(
      "P50: seven-day exhausted in phase-01 ≈ 11:00, resumes Sun 18 Oct 17:00",
    );
  });
});
