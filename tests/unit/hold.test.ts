import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { parseHoldValue, resolveHold, type HoldRequest } from "../../src/domain/hold.js";

type Phase = Parameters<typeof resolveHold>[1][number];

const headless = (id: string): Phase => ({ id, mode: "headless", oracle: null });
const interactive = (id: string): Phase => ({ id, mode: "interactive", oracle: null });

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
    oracle: { dischargedBy: "phase-03", files: ["tests/invoiceRow.test.ts"] },
  },
  headless("phase-03"),
  headless("phase-04"),
];

const FORMS = "give no value, oracle, or phase ids such as phase-02,phase-04";
const refusal = (value: string) => `--hold '${value}' is not a hold selection: ${FORMS}`;
const NAME_HINT = "(put the run's name before --hold, or write --hold=<selection>)";

const refusalOf = (value: string) => Either.getOrThrow(Either.flip(parseHoldValue(value)));
const resolve = (request: HoldRequest, phases: readonly Phase[] = INVOICE_EXPORT) =>
  resolveHold(request, phases);

describe("parseHoldValue", () => {
  it.each<readonly [string, true | string, HoldRequest]>([
    ["a bare flag", true, { kind: "all" }],
    ["the oracle keyword", "oracle", { kind: "oracle" }],
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
      "oracle mixed into a list",
      "oracle,phase-02",
      "--hold 'oracle,phase-02' is not a hold selection: oracle stands alone",
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

  it("resolves oracle to the oracle phases (once the interim rule is lifted, they are the pair's)", () => {
    const result = resolve({ kind: "oracle" }, ORACLE_VARIANT);
    expect(result.hold).toBeNull();
    expect(result.findings.map((f) => f.phase)).toEqual(["phase-02"]);
  });

  it("resolves all on the oracle variant, refusing only the pair's phases", () => {
    const result = resolve({ kind: "all" }, ORACLE_VARIANT);
    expect(result.hold).toBeNull();
    expect(result.findings.map((f) => f.phase)).toEqual(["phase-02", "phase-03"]);
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
      "oracle with no oracle phase",
      { kind: "oracle" },
      INVOICE_EXPORT,
      [null],
      "--hold oracle selects no phase: the plan declares no oracle phase",
    ],
    [
      "a bare hold on a one-phase plan",
      { kind: "all" },
      [headless("phase-01")],
      [null],
      "--hold selects no phase: the plan has no headless phase before its final phase",
    ],
    [
      "a phase of an oracle pair",
      { kind: "listed", phases: ["phase-03"] },
      ORACLE_VARIANT,
      ["phase-03"],
      "sits in oracle pair phase-02 → phase-03: this phax does not hold a phase of an oracle pair yet",
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
