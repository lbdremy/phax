import { describe, expect, it } from "vitest";
import {
  acceptanceFindings,
  type AcceptanceCheckPhase,
} from "../../src/domain/plan/acceptanceCheck.js";
import { readPhaseHeaders } from "../../src/domain/plan/phaseHeader.js";

interface PlanPhase {
  readonly header?: readonly string[];
  readonly create?: readonly string[];
  readonly edit?: readonly string[];
  readonly optional?: readonly string[];
}

const NO_PROVIDER =
  'acceptance phase declared, but no "acceptance" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)';

function id(index: number): string {
  return `phase-${String(index + 1).padStart(2, "0")}`;
}

function headersOf(phases: readonly PlanPhase[], rest = "") {
  return readPhaseHeaders(
    [
      "# Plan",
      "",
      ...phases.flatMap((p, i) => [
        `## ${id(i)} — Step {#p${i + 1}}`,
        "",
        "**Recommended model:** m",
        "**Recommended effort:** low",
        ...(p.header ?? []),
        "",
        i === 0 ? rest : "",
      ]),
    ].join("\n"),
  );
}

function planned(phases: readonly PlanPhase[]): readonly AcceptanceCheckPhase[] {
  return phases.map((p, i) => ({
    id: id(i),
    plannedFilesToCreate: p.create ?? [],
    plannedFilesToEdit: p.edit ?? [],
    optionalFilesToEdit: p.optional ?? [],
  }));
}

/** The `oracles` rows, every one an error. */
function rowsOf(
  phases: readonly PlanPhase[],
  opts: { providerConfigured?: boolean; parsed?: boolean } = {},
) {
  const all = acceptanceFindings({
    headers: headersOf(phases),
    phases: opts.parsed === false ? null : planned(phases),
    providerConfigured: opts.providerConfigured ?? true,
  });
  expect(all.every((f) => f.severity === "error" && f.check === "acceptance")).toBe(true);
  return all;
}

function messages(
  phases: readonly PlanPhase[],
  opts: { providerConfigured?: boolean; parsed?: boolean } = {},
) {
  return rowsOf(phases, opts).map((f) => `${f.phase}: ${f.message}`);
}

const ORACLE = (files = "`tests/refunds.test.ts`", value = "yes") => [
  `**Acceptance phase:** ${value}`,
  `**Acceptance test files:** ${files}`,
];
const plain: PlanPhase = {};
const oraclePhase = {
  header: ORACLE(),
  create: ["tests/refunds.test.ts", "src/refunds/index.ts"],
} satisfies PlanPhase;

const REPEAT = (path: string) =>
  `phase-01: acceptance test file ${path} is listed more than once on **Acceptance test files:**: list each acceptance test file once`;

describe("acceptanceFindings: a repeated oracle file", () => {
  const two = [{ header: ORACLE("`a.ts`, `a.ts`"), create: ["a.ts"] }, plain];

  it("reports a path listed twice once", () => {
    expect(messages(two)).toEqual([REPEAT("a.ts")]);
  });

  it("reports a path listed three times once", () => {
    expect(
      messages([{ header: ORACLE("`a.ts`, `a.ts`, `a.ts`"), create: ["a.ts"] }, plain]),
    ).toEqual([REPEAT("a.ts")]);
  });

  it("reports two repeated paths in first-appearance order", () => {
    const phases = [
      { header: ORACLE("`b.ts`, `a.ts`, `a.ts`, `b.ts`"), create: ["a.ts", "b.ts"] },
      plain,
    ];
    expect(messages(phases)).toEqual([REPEAT("b.ts"), REPEAT("a.ts")]);
  });

  it("reports a repeated unplanned path once as unplanned", () => {
    expect(messages([{ header: ORACLE("`a.ts`, `a.ts`") }, plain])).toEqual([
      REPEAT("a.ts"),
      "phase-01: acceptance test file a.ts is not among this phase's planned files to create or to edit",
    ]);
  });

  it("still reports the repeat for an unparsed plan", () => {
    expect(messages(two, { parsed: false })).toEqual([REPEAT("a.ts")]);
  });

  it("sits between the empty-list row and the unplanned row", () => {
    const phases = [
      { header: ORACLE("`a.ts`, `a.ts`", "passed by phase-03") },
      { header: ORACLE("", "passed by phase-03") },
      plain,
    ];
    expect(messages(phases)).toEqual([
      "phase-03: passes more than one acceptance phase (phase-01, phase-02): one passing phase per acceptance phase",
      "phase-02: **Acceptance test files:** lists no file: an acceptance phase lists at least one acceptance test file",
      REPEAT("a.ts"),
      "phase-01: acceptance test file a.ts is not among this phase's planned files to create or to edit",
    ]);
  });
});

describe("acceptanceFindings: malformed lines", () => {
  it("gives nothing without an oracle line", () => {
    expect(
      acceptanceFindings({ headers: headersOf([plain]), phases: null, providerConfigured: false }),
    ).toEqual([]);
  });

  it.each([
    [
      "Acceptance phase without Acceptance test files",
      ["**Acceptance phase:** yes"],
      "",
      "**Acceptance phase:** without **Acceptance test files:**",
    ],
    [
      "Acceptance test files without Acceptance phase",
      ["**Acceptance test files:** a.ts"],
      "",
      "**Acceptance test files:** without **Acceptance phase:**",
    ],
    [
      "an unknown Acceptance phase value",
      ["**Acceptance phase:** maybe", "**Acceptance test files:** a.ts"],
      "",
      '"maybe"',
    ],
    [
      "Acceptance test files outside the header",
      ["**Acceptance phase:** yes"],
      "**Acceptance test files:** a.ts",
      "**Acceptance test files:** line sits outside",
    ],
    [
      "Acceptance phase outside the header",
      ["**Acceptance test files:** a.ts"],
      "**Acceptance phase:** yes",
      "**Acceptance phase:** line sits outside",
    ],
    [
      "a repeated Acceptance phase line",
      ["**Acceptance phase:** yes", "**Acceptance phase:** yes", "**Acceptance test files:** a.ts"],
      "",
      "**Acceptance phase:** line appears more than once",
    ],
    [
      "a repeated Acceptance test files line",
      [
        "**Acceptance phase:** yes",
        "**Acceptance test files:** a.ts",
        "**Acceptance test files:** b.ts",
      ],
      "",
      "**Acceptance test files:** line appears more than once",
    ],
  ])("gives exactly one error for %s", (_name, header, rest, fragment) => {
    const findings = acceptanceFindings({
      headers: headersOf([{ header }, plain], rest),
      phases: null,
      providerConfigured: true,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      check: "acceptance",
      phase: "phase-01",
    });
    expect(findings[0]!.message).toContain(fragment);
  });
});

describe("acceptanceFindings: pairs", () => {
  it("a well-formed pair with a provider gives no finding", () => {
    expect(rowsOf([oraclePhase, plain])).toEqual([]);
  });

  it("names the explicit discharging phase of a pair", () => {
    const phases = [
      { ...oraclePhase, header: ORACLE("`tests/refunds.test.ts`", "passed by phase-03") },
      plain,
      plain,
    ];
    expect(messages(phases)).toEqual([]);
  });

  it("§5.6: yes on the last phase", () => {
    expect(messages([plain, { ...oraclePhase }])).toEqual([
      "phase-02: acceptance phase is passed by the next phase, and phase-02 is the last phase",
    ]);
  });

  it("§5.6: a discharging phase that comes before, and the phase itself", () => {
    const before = ORACLE("`tests/refunds.test.ts`", "passed by phase-01");
    const itself = ORACLE("`tests/refunds.test.ts`", "passed by phase-02");
    expect(messages([plain, { ...oraclePhase, header: before }])).toEqual([
      "phase-02: acceptance phase is passed by phase-01, which comes before it",
    ]);
    expect(messages([plain, { ...oraclePhase, header: itself }, plain])).toEqual([
      "phase-02: acceptance phase is passed by phase-02, which is the acceptance phase itself",
    ]);
  });

  it("§5.6: a named phase absent from the plan", () => {
    const missing = ORACLE("`tests/refunds.test.ts`", "passed by phase-09");
    expect(messages([{ ...oraclePhase, header: missing }, plain])).toEqual([
      "phase-01: acceptance phase is passed by phase-09, which is not a phase of this plan",
    ]);
  });

  it("§5.7: one phase in both roles", () => {
    const phases = [
      oraclePhase,
      { ...oraclePhase, create: ["tests/prune.test.ts"], header: ORACLE("`tests/prune.test.ts`") },
      plain,
    ];
    expect(messages(phases)).toEqual([
      "phase-02: is both an acceptance phase and the passing phase of phase-01: a phase takes one acceptance role",
    ]);
  });

  it("§5.7: a phase discharging two oracle phases, reported once", () => {
    const phases = [
      oraclePhase,
      {
        create: ["tests/prune.test.ts"],
        header: ORACLE("`tests/prune.test.ts`", "passed by phase-03"),
      },
      plain,
    ];
    const first = {
      ...oraclePhase,
      header: ORACLE("`tests/refunds.test.ts`", "passed by phase-03"),
    };
    expect(messages([first, phases[1]!, plain])).toEqual([
      "phase-03: passes more than one acceptance phase (phase-01, phase-02): one passing phase per acceptance phase",
    ]);
  });

  it("§5.8: an empty Acceptance test files line", () => {
    expect(messages([{ header: ORACLE("") }, plain])).toEqual([
      "phase-01: **Acceptance test files:** lists no file: an acceptance phase lists at least one acceptance test file",
    ]);
  });

  it("§5.9: an oracle file the phase does not plan; a stub is no oracle file", () => {
    const phases = [
      {
        header: ORACLE("`tests/refunds.test.ts`, `tests/other.test.ts`"),
        create: oraclePhase.create,
      },
      plain,
    ];
    expect(messages(phases)).toEqual([
      "phase-01: acceptance test file tests/other.test.ts is not among this phase's planned files to create or to edit",
    ]);
    // src/refunds/index.ts is planned but not an oracle file: no row for it.
    expect(messages([oraclePhase, plain])).toEqual([]);
  });

  it("§5.9: an oracle file only optional in the oracle phase is not planned", () => {
    const phases = [{ header: ORACLE(), optional: ["tests/refunds.test.ts"] }, plain];
    expect(messages(phases)).toEqual([
      "phase-01: acceptance test file tests/refunds.test.ts is not among this phase's planned files to create or to edit",
    ]);
  });

  it("§5.10: an oracle file planned between the pair, none once moved after", () => {
    const phases = (middle: PlanPhase) => [oraclePhase, middle, plain];
    expect(messages(phases({ optional: ["tests/refunds.test.ts"] }))).toEqual([]);
    const pair = [
      { ...oraclePhase, header: ORACLE("`tests/refunds.test.ts`", "passed by phase-03") },
      { optional: ["tests/refunds.test.ts"] },
      plain,
    ];
    expect(messages(pair)).toEqual([
      "phase-02: plans tests/refunds.test.ts, an acceptance test file of phase-01, before phase-03 passes it",
    ]);
    const after = [
      { ...oraclePhase, header: ORACLE("`tests/refunds.test.ts`", "passed by phase-03") },
      plain,
      plain,
      { edit: ["tests/refunds.test.ts"] },
    ];
    expect(messages(after)).toEqual([]);
  });

  it("§5.10: the discharging phase itself may list the oracle file", () => {
    expect(messages([oraclePhase, { edit: ["tests/refunds.test.ts"] }])).toEqual([]);
  });

  it("an interactive phase inside a pair, even listing an oracle file, gets no finding", () => {
    const header = ORACLE("`tests/refunds.test.ts`", "passed by phase-04");
    const cases: readonly (readonly [string, PlanPhase])[] = [
      ["no oracle file", { header: ["**Mode:** interactive"] }],
      [
        "an optional oracle file",
        { header: ["**Mode:** interactive"], optional: ["tests/refunds.test.ts"] },
      ],
    ];
    for (const [label, interactive] of cases) {
      expect(messages([{ ...oraclePhase, header }, interactive, plain, plain]), label).toEqual([]);
    }
    // A headless phase in the same place is still refused the oracle file.
    expect(
      messages([{ ...oraclePhase, header }, { optional: ["tests/refunds.test.ts"] }, plain, plain]),
    ).toEqual([
      "phase-02: plans tests/refunds.test.ts, an acceptance test file of phase-01, before phase-04 passes it",
    ]);
  });

  it("§5.12: an interactive oracle phase and an interactive discharging phase", () => {
    const interactiveOracle = { ...oraclePhase, header: [...ORACLE(), "**Mode:** interactive"] };
    expect(messages([interactiveOracle, plain])).toEqual([
      "phase-01: an interactive phase takes no acceptance role: it declares an acceptance phase",
    ]);
    expect(messages([oraclePhase, { header: ["**Mode:** interactive"] }])).toEqual([
      "phase-02: an interactive phase takes no acceptance role: it passes phase-01",
    ]);
  });

  it("§5.13: no provider configured, then configured", () => {
    expect(messages([oraclePhase, plain], { providerConfigured: false })).toEqual([
      `phase-01: ${NO_PROVIDER}`,
    ]);
    expect(messages([oraclePhase, plain], { providerConfigured: true })).toEqual([]);
  });

  it("an unparsed plan drops the planned-file rows and keeps the others", () => {
    const phases = [
      {
        header: ORACLE("`tests/refunds.test.ts`, `tests/other.test.ts`", "passed by phase-03"),
        create: oraclePhase.create,
      },
      { optional: ["tests/refunds.test.ts"] },
      plain,
    ];
    expect(messages(phases)).toHaveLength(2);
    expect(messages(phases, { parsed: false })).toEqual([]);
    expect(
      messages([{ header: ORACLE("") }, plain], { parsed: false, providerConfigured: false }),
    ).toEqual([
      "phase-01: **Acceptance test files:** lists no file: an acceptance phase lists at least one acceptance test file",
      `phase-01: ${NO_PROVIDER}`,
    ]);
  });

  it("orders the rows: §5.6, roles, §5.8 … §5.13", () => {
    const phases = [
      { header: ORACLE("", "passed by phase-09") },
      { header: ["**Mode:** interactive", ...ORACLE()], create: ["tests/refunds.test.ts"] },
      plain,
    ];
    const all = acceptanceFindings({
      headers: headersOf(phases),
      phases: planned(phases),
      providerConfigured: false,
    }).map((f) => `${f.phase}: ${f.message}`);
    expect(all).toEqual([
      "phase-01: acceptance phase is passed by phase-09, which is not a phase of this plan",
      "phase-01: **Acceptance test files:** lists no file: an acceptance phase lists at least one acceptance test file",
      "phase-02: an interactive phase takes no acceptance role: it declares an acceptance phase",
      `phase-01: ${NO_PROVIDER}`,
      `phase-02: ${NO_PROVIDER}`,
    ]);
  });
});
