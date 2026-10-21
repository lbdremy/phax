import { describe, expect, it } from "vitest";
import {
  oracleFindings,
  unsupportedOracleFindings,
  type OracleCheckPhase,
} from "../../src/domain/plan/oracleCheck.js";
import { readPhaseHeaders } from "../../src/domain/plan/phaseHeader.js";

interface PlanPhase {
  readonly header?: readonly string[];
  readonly create?: readonly string[];
  readonly edit?: readonly string[];
  readonly optional?: readonly string[];
}

const NO_PROVIDER =
  'oracle phase declared, but no "oracles" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)';
const REFUSAL =
  "declared an oracle phase (**Oracle phase:**): this phax cannot run an oracle phase yet; remove the oracle lines";

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

function planned(phases: readonly PlanPhase[]): readonly OracleCheckPhase[] {
  return phases.map((p, i) => ({
    id: id(i),
    plannedFilesToCreate: p.create ?? [],
    plannedFilesToEdit: p.edit ?? [],
    optionalFilesToEdit: p.optional ?? [],
  }));
}

/** The `oracles` rows without the trailing not-supported refusal rows. */
function rowsOf(
  phases: readonly PlanPhase[],
  opts: { providerConfigured?: boolean; parsed?: boolean } = {},
) {
  const all = oracleFindings({
    headers: headersOf(phases),
    phases: opts.parsed === false ? null : planned(phases),
    providerConfigured: opts.providerConfigured ?? true,
  });
  expect(all.every((f) => f.severity === "error" && f.check === "oracles")).toBe(true);
  const refusals = all.filter((f) => f.message === REFUSAL);
  return { rows: all.filter((f) => f.message !== REFUSAL), refusals };
}

function messages(
  phases: readonly PlanPhase[],
  opts: { providerConfigured?: boolean; parsed?: boolean } = {},
) {
  return rowsOf(phases, opts).rows.map((f) => `${f.phase}: ${f.message}`);
}

const ORACLE = (files = "`tests/refunds.test.ts`", value = "yes") => [
  `**Oracle phase:** ${value}`,
  `**Oracle files:** ${files}`,
];
const plain: PlanPhase = {};
const oraclePhase = {
  header: ORACLE(),
  create: ["tests/refunds.test.ts", "src/refunds/index.ts"],
} satisfies PlanPhase;

describe("unsupportedOracleFindings", () => {
  it("skips a phase whose declaration is malformed", () => {
    expect(unsupportedOracleFindings(headersOf([{ header: ["**Oracle phase:** yes"] }]))).toEqual(
      [],
    );
  });
});

describe("oracleFindings: malformed lines", () => {
  it("gives nothing without an oracle line", () => {
    expect(
      oracleFindings({ headers: headersOf([plain]), phases: null, providerConfigured: false }),
    ).toEqual([]);
  });

  it.each([
    [
      "Oracle phase without Oracle files",
      ["**Oracle phase:** yes"],
      "",
      "**Oracle phase:** without **Oracle files:**",
    ],
    [
      "Oracle files without Oracle phase",
      ["**Oracle files:** a.ts"],
      "",
      "**Oracle files:** without **Oracle phase:**",
    ],
    [
      "an unknown Oracle phase value",
      ["**Oracle phase:** maybe", "**Oracle files:** a.ts"],
      "",
      '"maybe"',
    ],
    [
      "Oracle files outside the header",
      ["**Oracle phase:** yes"],
      "**Oracle files:** a.ts",
      "**Oracle files:** line sits outside",
    ],
    [
      "Oracle phase outside the header",
      ["**Oracle files:** a.ts"],
      "**Oracle phase:** yes",
      "**Oracle phase:** line sits outside",
    ],
    [
      "a repeated Oracle phase line",
      ["**Oracle phase:** yes", "**Oracle phase:** yes", "**Oracle files:** a.ts"],
      "",
      "**Oracle phase:** line appears more than once",
    ],
    [
      "a repeated Oracle files line",
      ["**Oracle phase:** yes", "**Oracle files:** a.ts", "**Oracle files:** b.ts"],
      "",
      "**Oracle files:** line appears more than once",
    ],
  ])("gives exactly one error for %s", (_name, header, rest, fragment) => {
    const findings = oracleFindings({
      headers: headersOf([{ header }, plain], rest),
      phases: null,
      providerConfigured: true,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "error", check: "oracles", phase: "phase-01" });
    expect(findings[0]!.message).toContain(fragment);
  });
});

describe("oracleFindings: pairs", () => {
  it("a well-formed pair with a provider gives only the not-supported refusal", () => {
    const { rows, refusals } = rowsOf([oraclePhase, plain]);
    expect(rows).toEqual([]);
    expect(refusals).toEqual([
      { severity: "error", check: "oracles", phase: "phase-01", message: REFUSAL },
    ]);
  });

  it("names the explicit discharging phase of a pair", () => {
    const phases = [
      { ...oraclePhase, header: ORACLE("`tests/refunds.test.ts`", "discharged by phase-03") },
      plain,
      plain,
    ];
    expect(messages(phases)).toEqual([]);
  });

  it("§5.6: yes on the last phase", () => {
    expect(messages([plain, { ...oraclePhase }])).toEqual([
      "phase-02: oracle phase is discharged by the next phase, and phase-02 is the last phase",
    ]);
  });

  it("§5.6: a discharging phase that comes before, and the phase itself", () => {
    const before = ORACLE("`tests/refunds.test.ts`", "discharged by phase-01");
    const itself = ORACLE("`tests/refunds.test.ts`", "discharged by phase-02");
    expect(messages([plain, { ...oraclePhase, header: before }])).toEqual([
      "phase-02: oracle phase is discharged by phase-01, which comes before it",
    ]);
    expect(messages([plain, { ...oraclePhase, header: itself }, plain])).toEqual([
      "phase-02: oracle phase is discharged by phase-02, which is the oracle phase itself",
    ]);
  });

  it("§5.6: a named phase absent from the plan", () => {
    const missing = ORACLE("`tests/refunds.test.ts`", "discharged by phase-09");
    expect(messages([{ ...oraclePhase, header: missing }, plain])).toEqual([
      "phase-01: oracle phase is discharged by phase-09, which is not a phase of this plan",
    ]);
  });

  it("§5.7: one phase in both roles", () => {
    const phases = [
      oraclePhase,
      { ...oraclePhase, create: ["tests/prune.test.ts"], header: ORACLE("`tests/prune.test.ts`") },
      plain,
    ];
    expect(messages(phases)).toEqual([
      "phase-02: is both an oracle phase and the discharging phase of phase-01: a phase takes one oracle role",
    ]);
  });

  it("§5.7: a phase discharging two oracle phases, reported once", () => {
    const phases = [
      oraclePhase,
      {
        create: ["tests/prune.test.ts"],
        header: ORACLE("`tests/prune.test.ts`", "discharged by phase-03"),
      },
      plain,
    ];
    const first = {
      ...oraclePhase,
      header: ORACLE("`tests/refunds.test.ts`", "discharged by phase-03"),
    };
    expect(messages([first, phases[1]!, plain])).toEqual([
      "phase-03: discharges more than one oracle phase (phase-01, phase-02): one discharging phase per oracle phase",
    ]);
  });

  it("§5.8: an empty Oracle files line", () => {
    expect(messages([{ header: ORACLE("") }, plain])).toEqual([
      "phase-01: **Oracle files:** lists no file: an oracle phase lists at least one oracle file",
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
      "phase-01: oracle file tests/other.test.ts is not among this phase's planned files to create or to edit",
    ]);
    // src/refunds/index.ts is planned but not an oracle file: no row for it.
    expect(messages([oraclePhase, plain])).toEqual([]);
  });

  it("§5.9: an oracle file only optional in the oracle phase is not planned", () => {
    const phases = [{ header: ORACLE(), optional: ["tests/refunds.test.ts"] }, plain];
    expect(messages(phases)).toEqual([
      "phase-01: oracle file tests/refunds.test.ts is not among this phase's planned files to create or to edit",
    ]);
  });

  it("§5.10: an oracle file planned between the pair, none once moved after", () => {
    const phases = (middle: PlanPhase) => [oraclePhase, middle, plain];
    expect(messages(phases({ optional: ["tests/refunds.test.ts"] }))).toEqual([]);
    const pair = [
      { ...oraclePhase, header: ORACLE("`tests/refunds.test.ts`", "discharged by phase-03") },
      { optional: ["tests/refunds.test.ts"] },
      plain,
    ];
    expect(messages(pair)).toEqual([
      "phase-02: plans tests/refunds.test.ts, an oracle file of phase-01, before phase-03 discharges it",
    ]);
    const after = [
      { ...oraclePhase, header: ORACLE("`tests/refunds.test.ts`", "discharged by phase-03") },
      plain,
      plain,
      { edit: ["tests/refunds.test.ts"] },
    ];
    expect(messages(after)).toEqual([]);
  });

  it("§5.10: the discharging phase itself may list the oracle file", () => {
    expect(messages([oraclePhase, { edit: ["tests/refunds.test.ts"] }])).toEqual([]);
  });

  it("§5.11: an interactive phase inside a pair, none once after it", () => {
    const interactive = { header: ["**Mode:** interactive"] };
    const header = ORACLE("`tests/refunds.test.ts`", "discharged by phase-04");
    expect(messages([{ ...oraclePhase, header }, interactive, plain, plain])).toEqual([
      "phase-02: interactive phase sits between oracle phase-01 and its discharging phase phase-04",
    ]);
    expect(messages([{ ...oraclePhase, header }, plain, plain, plain, interactive])).toEqual([]);
  });

  it("§5.12: an interactive oracle phase and an interactive discharging phase", () => {
    const interactiveOracle = { ...oraclePhase, header: [...ORACLE(), "**Mode:** interactive"] };
    expect(messages([interactiveOracle, plain])).toEqual([
      "phase-01: an interactive phase takes no oracle role: it declares an oracle phase",
    ]);
    expect(messages([oraclePhase, { header: ["**Mode:** interactive"] }])).toEqual([
      "phase-02: an interactive phase takes no oracle role: it discharges phase-01",
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
        header: ORACLE("`tests/refunds.test.ts`, `tests/other.test.ts`", "discharged by phase-03"),
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
      "phase-01: **Oracle files:** lists no file: an oracle phase lists at least one oracle file",
      `phase-01: ${NO_PROVIDER}`,
    ]);
  });

  it("orders the rows: §5.6, roles, §5.8 … §5.13, then the refusal", () => {
    const phases = [
      { header: ORACLE("", "discharged by phase-09") },
      { header: ["**Mode:** interactive", ...ORACLE()], create: ["tests/refunds.test.ts"] },
      plain,
    ];
    const all = oracleFindings({
      headers: headersOf(phases),
      phases: planned(phases),
      providerConfigured: false,
    }).map((f) => `${f.phase}: ${f.message}`);
    expect(all).toEqual([
      "phase-01: oracle phase is discharged by phase-09, which is not a phase of this plan",
      "phase-01: **Oracle files:** lists no file: an oracle phase lists at least one oracle file",
      "phase-02: an interactive phase takes no oracle role: it declares an oracle phase",
      `phase-01: ${NO_PROVIDER}`,
      `phase-02: ${NO_PROVIDER}`,
      `phase-01: ${REFUSAL}`,
      `phase-02: ${REFUSAL}`,
    ]);
  });
});
