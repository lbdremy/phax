// The oracle of byte-for-byte JSON for `plans status`, `plans overlap` and `plans estimate`:
// each fixed value, of the shape the command printed before it moved onto the runner, is
// encoded through the command's output contract and must give exactly
// `JSON.stringify(value, null, 2)` and one newline: same keys, same order, same values.
// Values are written by hand from the domain types, never built by the code under test.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import type { Command } from "../../../src/cli/commandLibrary/contract/index.js";
import { encodedText } from "../../../src/cli/commandLibrary/contract/index.js";
import { plansEstimateCommand } from "../../../src/cli/definitions/plansEstimate.js";
import { plansOverlapCommand } from "../../../src/cli/definitions/plansOverlap.js";
import { plansStatusCommand } from "../../../src/cli/definitions/plansStatus.js";
import type { EstimateReport } from "../../../src/domain/cost/estimate.js";
import type {
  PlanOverlapResult,
  ReadjustmentImpactResult,
} from "../../../src/domain/planOverlap/types.js";

/** What the command printed for `value`: it is encoded through its output contract. */
function printed(command: Command, value: unknown): string {
  const contract = command.output?.contract as Schema.Codec<unknown, unknown> | undefined;
  if (contract === undefined) throw new Error(`${command.name} declares no output`);
  return encodedText(Schema.encodeUnknownSync(contract)(value));
}

/** The bytes the old command printed: `JSON.stringify(value, null, 2)` and a newline. */
const before = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const REPORT = [
  { path: "docs/plans/2609101210-fresh-plan.md", result: { kind: "fresh" } },
  {
    path: "docs/plans/2609101220-stale-plan.md",
    result: {
      kind: "stale",
      evidence: [
        { reason: "spec-changed", specPath: "docs/specs/2609101200-a-spec.md" },
        { reason: "ground-changed", baseline: "abc1234", files: ["src/a.ts", "src/b.ts"] },
        { reason: "self-changed" },
      ],
    },
  },
  {
    path: "docs/plans/2609101230-missing-plan.md",
    result: { kind: "missing-record", detail: "no approval record exists for this plan" },
  },
  {
    path: "docs/plans/2609101240-broken-plan.md",
    result: { kind: "error", message: "docs/plans/2609101240-broken-plan.md: bad frontmatter" },
  },
] as const;

const ORPHANS = [
  {
    recordFile: "docs/plans/approvals/2609101250-gone-plan.md.json",
    artifact: "docs/plans/2609101250-gone-plan.md",
  },
] as const;

describe("plans status output contract", () => {
  it("encodes a report with orphan records to today's bytes", () => {
    const value = { report: REPORT, orphanRecords: ORPHANS };
    expect(printed(plansStatusCommand, value)).toBe(before(value));
  });

  it("encodes a report with no orphan record to today's bytes", () => {
    const value = { report: [], orphanRecords: [] };
    expect(printed(plansStatusCommand, value)).toBe(before(value));
  });

  it("encodes --apply's object with `applied` then `written`", () => {
    const value = {
      report: REPORT,
      orphanRecords: ORPHANS,
      applied: [
        {
          path: "docs/plans/2609101220-stale-plan.md",
          verdict: { kind: "stale", evidence: [{ reason: "self-changed" }] },
        },
        {
          path: "docs/plans/2609101230-missing-plan.md",
          verdict: { kind: "missing-record", detail: "no approval record exists for this plan" },
        },
      ],
      written: [
        {
          path: "docs/plans/2609101220-stale-plan.md",
          format: null,
          digest: `sha256:${"a".repeat(64)}`,
        },
      ],
    };
    const text = printed(plansStatusCommand, value);
    expect(text).toBe(before(value));
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      "report",
      "orphanRecords",
      "applied",
      "written",
    ]);
  });
});

describe("plans overlap output contract", () => {
  it("encodes an overlap result, footprint sets as arrays, to today's bytes", () => {
    const result: PlanOverlapResult = {
      footprints: [
        {
          id: "a",
          label: "a-plan",
          create: new Set(["src/new.ts"]),
          edit: new Set(["src/shared.ts", "README.md"]),
          optional: new Set(),
          all: new Set(["src/new.ts", "src/shared.ts", "README.md"]),
        },
        {
          id: "b",
          label: "b-plan",
          create: new Set(),
          edit: new Set(["src/shared.ts"]),
          optional: new Set(["docs/x.md"]),
          all: new Set(["src/shared.ts", "docs/x.md"]),
        },
      ],
      edges: [
        {
          a: "a",
          b: "b",
          shared: [
            {
              path: "src/shared.ts",
              severity: "medium",
              reason: "both plans edit this source file",
            },
          ],
          severity: "medium",
        },
      ],
      cleanPairs: [["a", "c"]],
      largestParallelSafeSet: ["a", "c"],
      waves: [["a", "c"], ["b"]],
      exhaustiveSearchSkipped: false,
    };
    // Today's resultToJson: footprint sets spread into arrays, in this key order.
    const json = {
      footprints: result.footprints.map((fp) => ({
        id: fp.id,
        label: fp.label,
        create: [...fp.create],
        edit: [...fp.edit],
        optional: [...fp.optional],
        all: [...fp.all],
      })),
      edges: result.edges,
      cleanPairs: result.cleanPairs.map((pair) => [...pair]),
      largestParallelSafeSet: result.largestParallelSafeSet,
      waves: result.waves.map((wave) => [...wave]),
      exhaustiveSearchSkipped: result.exhaustiveSearchSkipped,
    };
    expect(printed(plansOverlapCommand, result)).toBe(before(json));
  });

  it("encodes a readjustment impact to today's bytes", () => {
    const impact: ReadjustmentImpactResult = {
      landedLabel: "ns.landed-run",
      impacted: [
        {
          id: "a",
          label: "a-plan",
          shared: [{ path: "src/x.ts", severity: "hard", reason: "both plans create this file" }],
          severity: "hard",
        },
      ],
      unaffected: ["b"],
    };
    expect(printed(plansOverlapCommand, impact)).toBe(before(impact));
  });
});

const COMMON = {
  history: { phases: 80, required: 60, halfLifeDays: 30, unledgeredRuns: 1 },
  notEstimated: ["plan-extraction", "plan-auditor", "interactive-code-review"],
  burnRateUsdPerHour: 4.2,
  warnings: ["phase-01: only 2 historical phases at effort low; its range is less reliable"],
} as const;

const PHASES = [
  {
    id: "phase-01",
    provider: "claude-code",
    model: "claude-sonnet-5-5",
    effort: "medium",
    mode: "headless",
    estimate: { p10: 1, p50: 2.5, p90: 4 },
  },
  {
    id: "phase-02",
    provider: "codex-cli",
    model: "gpt-x",
    effort: "high",
    mode: "headless",
    estimate: null,
    notEstimated: "other-provider",
  },
  {
    id: "phase-03",
    provider: "claude-code",
    model: "claude-sonnet-5-5",
    effort: "medium",
    mode: "interactive",
    estimate: null,
    notEstimated: "thin-interactive-history",
  },
] as const;

const RUN = { p10: 1, p50: 2.5, p90: 4, runLevel: 0.5 } as const;

const WINDOWS = {
  source: "probe",
  observedAt: "2026-11-04T10:00:00.000Z",
  fiveHour: { utilization: 20, resetsAt: "2026-11-04T14:00:00.000Z", capacityUsd: 40 },
  sevenDay: { utilization: 35, resetsAt: "2026-11-09T10:00:00.000Z", capacityUsd: null },
} as const;

const SCENARIOS = {
  p50: { pauses: [], endsAt: "2026-11-04T11:00:00.000Z" },
  p90: {
    pauses: [
      {
        phase: "phase-02",
        window: "five-hour",
        at: "2026-11-04T10:30:00.000Z",
        resumesAt: "2026-11-04T14:00:00.000Z",
      },
    ],
    endsAt: "2026-11-04T15:00:00.000Z",
  },
} as const;

const ESTIMATES: ReadonlyArray<readonly [string, EstimateReport]> = [
  [
    "thin-history",
    {
      ...COMMON,
      verdict: "thin-history",
      phases: [],
      run: null,
      windows: WINDOWS,
      windowsUnavailable: null,
      uncalibrated: [],
      scenarios: null,
    },
  ],
  [
    "no-subscription",
    {
      ...COMMON,
      phases: PHASES,
      run: RUN,
      verdict: "no-subscription",
      windows: null,
      windowsUnavailable: null,
      uncalibrated: [],
      scenarios: null,
    },
  ],
  [
    "windows-unavailable",
    {
      ...COMMON,
      phases: PHASES,
      run: RUN,
      verdict: "windows-unavailable",
      windows: null,
      windowsUnavailable: "the probe timed out",
      uncalibrated: [],
      scenarios: null,
    },
  ],
  [
    "uncalibrated",
    {
      ...COMMON,
      phases: PHASES,
      run: RUN,
      verdict: "uncalibrated",
      windows: WINDOWS,
      windowsUnavailable: null,
      uncalibrated: ["seven-day", "burn-rate"],
      scenarios: null,
    },
  ],
  [
    "fits",
    {
      ...COMMON,
      phases: PHASES,
      run: RUN,
      verdict: "fits",
      windows: WINDOWS,
      windowsUnavailable: null,
      uncalibrated: [],
      scenarios: SCENARIOS,
    },
  ],
  [
    "risky",
    {
      ...COMMON,
      phases: PHASES,
      run: RUN,
      verdict: "risky",
      windows: WINDOWS,
      windowsUnavailable: null,
      uncalibrated: [],
      scenarios: SCENARIOS,
    },
  ],
  [
    "wait",
    {
      ...COMMON,
      burnRateUsdPerHour: null,
      phases: PHASES,
      run: RUN,
      verdict: "wait",
      windows: WINDOWS,
      windowsUnavailable: null,
      uncalibrated: [],
      scenarios: SCENARIOS,
    },
  ],
];

describe("plans estimate output contract", () => {
  it.each(ESTIMATES)("encodes a %s report to today's bytes", (_verdict, report) => {
    expect(printed(plansEstimateCommand, report)).toBe(before(report));
  });
});
