import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { parseHoldValue, resolveHold, type HoldRequest } from "../../src/domain/hold.js";

type Phase = Parameters<typeof resolveHold>[1][number];

const headless = (id: string): Phase => ({ id, mode: "headless", acceptance: null });
const interactive = (id: string): Phase => ({ id, mode: "interactive", acceptance: null });
const acceptancePhase = (id: string, passedBy: string): Phase => ({
  id,
  mode: "headless",
  acceptance: { passedBy, files: ["tests/refunds.test.ts"] },
});

// The made-up invoice-export plan: six phases, phase-03 interactive.
const INVOICE_EXPORT: readonly Phase[] = [
  headless("phase-01"),
  headless("phase-02"),
  interactive("phase-03"),
  headless("phase-04"),
  headless("phase-05"),
  headless("phase-06"),
];

// Its oracle variant: four phases, phase-02 pins files that phase-03 discharges.
const ORACLE_VARIANT: readonly Phase[] = [
  headless("phase-01"),
  {
    id: "phase-02",
    mode: "headless",
    acceptance: { passedBy: "phase-03", files: ["tests/invoiceRow.test.ts"] },
  },
  headless("phase-03"),
  headless("phase-04"),
];

const FORMS = "give no value, acceptance, or phase ids such as phase-02,phase-04";
const refusal = (value: string) => `--hold '${value}' is not a hold selection: ${FORMS}`;
const NAME_HINT = "(put the run's name before --hold, or write --hold=<selection>)";

const refusalOf = (value: string) => Either.getOrThrow(Either.flip(parseHoldValue(value)));
const resolve = (request: HoldRequest, phases: readonly Phase[] = INVOICE_EXPORT) =>
  resolveHold(request, phases);

describe("parseHoldValue", () => {
  it.each<readonly [string, true | string, HoldRequest]>([
    ["a bare flag", true, { kind: "all" }],
    ["the acceptance keyword", "acceptance", { kind: "acceptance" }],
    ["one phase id", "phase-02", { kind: "listed", phases: ["phase-02"] }],
    [
      "a list of phase ids",
      "phase-02,phase-04",
      { kind: "listed", phases: ["phase-02", "phase-04"] },
    ],
  ])("accepts %s", (_label, value, request) => {
    expect(parseHoldValue(value)).toEqual(Either.right(request));
  });

  it.each<readonly [string, string, string]>([
    ["a one-digit id", "phase-2", refusal("phase-2")],
    ["a three-digit id", "phase-100", refusal("phase-100")],
    [
      "acceptance mixed into a list",
      "acceptance,phase-02",
      "--hold 'acceptance,phase-02' is not a hold selection: acceptance stands alone",
    ],
    [
      "the retired oracle keyword",
      "oracle",
      "--hold 'oracle' is no longer read: write --hold acceptance",
    ],
    [
      "the retired oracle keyword in a list",
      "oracle,phase-02",
      "--hold 'oracle' is no longer read: write --hold acceptance",
    ],
    [
      "the retired oracle keyword after a phase id",
      "phase-02,oracle",
      "--hold 'oracle' is no longer read: write --hold acceptance",
    ],
    ["an empty item", "phase-02,,phase-04", refusal("phase-02,,phase-04")],
    ["a repeated id", "phase-02,phase-02", refusal("phase-02,phase-02")],
    ["the empty string", "", refusal("")],
    ["a run name", "invoice-export", `${refusal("invoice-export")}\n${NAME_HINT}`],
  ])("refuses %s", (_label, value, message) => {
    expect(parseHoldValue(value)).toEqual(Either.left(message));
  });

  it("adds the run-name hint only to a one-word value", () => {
    expect(refusalOf("invoice-export")).toContain(NAME_HINT);
    expect(refusalOf("phase-2")).not.toContain(NAME_HINT);
    expect(refusalOf("phase-02,,phase-04")).not.toContain(NAME_HINT);
    expect(refusalOf("")).not.toContain(NAME_HINT);
  });
});

describe("resolveHold", () => {
  it("resolves none to a hold of nothing", () => {
    expect(resolve({ kind: "none" })).toEqual({ hold: { selection: "none" }, findings: [] });
  });

  it("resolves all to every headless phase but the final one, in plan order", () => {
    expect(resolve({ kind: "all" })).toEqual({
      hold: { selection: "all", phases: ["phase-01", "phase-02", "phase-04", "phase-05"] },
      findings: [],
    });
  });

  it("resolves a list to its phases in plan order", () => {
    expect(resolve({ kind: "listed", phases: ["phase-05", "phase-01"] })).toEqual({
      hold: { selection: "listed", phases: ["phase-01", "phase-05"] },
      findings: [],
    });
  });

  it("resolves acceptance to the acceptance phases", () => {
    expect(resolve({ kind: "acceptance" }, ORACLE_VARIANT)).toEqual({
      hold: { selection: "acceptance", phases: ["phase-02"] },
      findings: [],
    });
  });

  it("resolves acceptance to every acceptance phase of a plan, in plan order", () => {
    const plan: readonly Phase[] = [
      headless("phase-01"),
      headless("phase-02"),
      acceptancePhase("phase-03", "phase-04"),
      headless("phase-04"),
      acceptancePhase("phase-05", "phase-06"),
      headless("phase-06"),
    ];
    expect(resolve({ kind: "acceptance" }, plan)).toEqual({
      hold: { selection: "acceptance", phases: ["phase-03", "phase-05"] },
      findings: [],
    });
  });

  it("resolves all on the oracle variant to the pair's phases too", () => {
    expect(resolve({ kind: "all" }, ORACLE_VARIANT)).toEqual({
      hold: { selection: "all", phases: ["phase-01", "phase-02", "phase-03"] },
      findings: [],
    });
  });

  it("resolves a list of the pair's phases with no finding", () => {
    expect(resolve({ kind: "listed", phases: ["phase-03", "phase-02"] }, ORACLE_VARIANT)).toEqual({
      hold: { selection: "listed", phases: ["phase-02", "phase-03"] },
      findings: [],
    });
  });

  it.each<readonly [string, HoldRequest, readonly Phase[], readonly (string | null)[], string]>([
    [
      "an absent phase",
      { kind: "listed", phases: ["phase-09"] },
      INVOICE_EXPORT,
      ["phase-09"],
      "is not a phase of this plan",
    ],
    [
      "an interactive phase",
      { kind: "listed", phases: ["phase-03"] },
      INVOICE_EXPORT,
      ["phase-03"],
      "is interactive: it already stops for review; remove it from --hold",
    ],
    [
      "the final phase",
      { kind: "listed", phases: ["phase-06"] },
      INVOICE_EXPORT,
      ["phase-06"],
      "is the final phase: it already stays open in review_open",
    ],
    [
      "acceptance with no acceptance phase",
      { kind: "acceptance" },
      INVOICE_EXPORT,
      [null],
      "--hold acceptance selects no phase: the plan declares no acceptance phase",
    ],
    [
      "a bare hold on a one-phase plan",
      { kind: "all" },
      [headless("phase-01")],
      [null],
      "--hold selects no phase: the plan has no headless phase before its final phase",
    ],
  ])("refuses %s", (_label, request, phases, ids, message) => {
    const result = resolve(request, phases);
    expect(result.hold).toBeNull();
    expect(result.findings.map((f) => f.phase)).toEqual(ids);
    expect(result.findings[0]?.message).toBe(message);
  });

  it("reports one finding per defect, in the order given", () => {
    const result = resolve({ kind: "listed", phases: ["phase-09", "phase-03", "phase-06"] });
    expect(result.findings.map((f) => f.phase)).toEqual(["phase-09", "phase-03", "phase-06"]);
  });
});
