import { describe, expect, it } from "vitest";
import {
  assignmentFindings,
  boundCatalogProblems,
  type BoundedPhase,
  type PartResolution,
} from "../../src/domain/plan/assignmentCheck.js";
import type { PhaseHeader } from "../../src/domain/plan/phaseHeader.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import type { AssignmentBound, Assignments } from "../../src/schemas/assignments.js";
import type { Effort } from "../../src/schemas/phaxPlan.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";

// The fixture catalog: a copy of the default one, so a test can reorder an
// entry's efforts in its own copy.
const CATALOG: ProviderConfig = structuredClone(DEFAULT_PROVIDER_CONFIG) as ProviderConfig;

// The spec §6 bounds and parts, for a made-up acme-billing repository.
const CORE: AssignmentBound = {
  kind: "part",
  part: "core-decide",
  model: "claude-opus-5-5",
  effort: { min: "medium", max: "high" },
};
const SCHEMAS: AssignmentBound = {
  kind: "globs",
  globs: ["src/*/schemas/**"],
  model: "claude-sonnet-5-5",
  effort: { min: "medium", max: "high" },
};
const DOCS: AssignmentBound = {
  kind: "part",
  part: "docs",
  model: "claude-haiku-5-5",
  effort: { min: "low", max: "medium" },
};
const BOUNDS: Assignments = [CORE, SCHEMAS, DOCS];

const PARTS: PartResolution = {
  kind: "resolved",
  parts: new Map([
    ["core-decide", ["src/core/decide/**"]],
    ["http-requests", ["src/http/requests/**"]],
    ["docs", ["docs/**", "*.md"]],
  ]),
};

const B0 = "assignments[0] (part core-decide: claude-opus-5-5, medium–high)";
const B1 = "assignments[1] (globs src/*/schemas/**: claude-sonnet-5-5, medium–high)";
const B2 = "assignments[2] (part docs: claude-haiku-5-5, low–medium)";
const NO_REASON = "with no **Assignment reason:** line";

function phase(
  model: string,
  effort: Effort,
  files: {
    readonly create?: readonly string[];
    readonly edit?: readonly string[];
    readonly optional?: readonly string[];
  } = {},
  id = "phase-01",
): BoundedPhase {
  return {
    id,
    model,
    effort,
    plannedFilesToCreate: files.create ?? [],
    plannedFilesToEdit: files.edit ?? [],
    optionalFilesToEdit: files.optional ?? [],
  };
}

function header(
  phaseId: string,
  assignmentReason: string | null,
  hasModelReason = false,
): PhaseHeader {
  return {
    phase: phaseId,
    assignmentReason,
    hasModelReason,
    mode: null,
    oraclePhase: null,
    oracleFiles: null,
    repeated: [],
    misplaced: [],
  };
}

function check(
  phases: readonly BoundedPhase[],
  opts: {
    readonly bounds?: Assignments | undefined;
    readonly headers?: readonly PhaseHeader[];
    readonly parts?: PartResolution;
    readonly providerConfig?: ProviderConfig;
  } = {},
) {
  return assignmentFindings({
    bounds: "bounds" in opts ? opts.bounds : BOUNDS,
    phases,
    headers: opts.headers ?? [],
    parts: opts.parts ?? PARTS,
    providerConfig: opts.providerConfig ?? CATALOG,
  });
}

const REFUND = { create: ["src/core/decide/refund.ts"], edit: ["src/http/schemas/refund.ts"] };

describe("assignmentFindings: the governing bound", () => {
  it("the first bound that matches any planned file governs", () => {
    expect(check([phase("claude-sonnet-5-5", "medium", REFUND)])).toEqual([
      {
        severity: "error",
        check: "models",
        phase: "phase-01",
        message: `claude-sonnet-5-5 / medium: outside ${B0} ${NO_REASON}`,
      },
    ]);
  });

  it("a phase at the first bound's model and range conforms", () => {
    expect(check([phase("claude-opus-5-5", "medium", REFUND)])).toEqual([]);
  });

  it("a later bound governs when no earlier one matches", () => {
    expect(
      check([phase("claude-sonnet-5-5", "high", { edit: ["src/http/schemas/refund.ts"] })]),
    ).toEqual([]);
  });

  it("optional files count", () => {
    const findings = check([
      phase("claude-haiku-5-5", "low", {
        edit: ["docs/refunds.md"],
        optional: ["src/core/decide/refund.ts"],
      }),
    ]);
    expect(findings.map((f) => f.message)).toEqual([
      `claude-haiku-5-5 / low: outside ${B0} ${NO_REASON}`,
    ]);
  });

  it("a part bound covers its part's every glob", () => {
    expect(check([phase("claude-haiku-5-5", "medium", { edit: ["README.md"] })])).toEqual([]);
  });
});

describe("assignmentFindings: the effort range", () => {
  it.each(["low", "xhigh", "max"] as const)("%s is outside medium–high", (effort) => {
    const findings = check([phase("claude-opus-5-5", effort, REFUND)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "error", phase: "phase-01" });
    expect(findings[0]!.message).toBe(`claude-opus-5-5 / ${effort}: outside ${B0} ${NO_REASON}`);
  });

  it.each(["medium", "high"] as const)("%s is inside medium–high", (effort) => {
    expect(check([phase("claude-opus-5-5", effort, REFUND)])).toEqual([]);
  });

  it("an effort the model does not offer is outside any range", () => {
    expect(check([phase("claude-opus-5-5", "ultra", REFUND)]).map((f) => f.severity)).toEqual([
      "error",
    ]);
  });

  it("reads the range in the bound model's catalog order", () => {
    const reordered = structuredClone(CATALOG) as ProviderConfig;
    for (const provider of Object.values(reordered.providers)) {
      for (const family of Object.values(provider.families ?? {})) {
        for (const entry of family.models) {
          if (entry.id === "claude-opus-5-5") {
            (entry as unknown as { efforts: string[] }).efforts = ["high", "low", "medium"];
          }
        }
      }
    }
    const bounds: Assignments = [
      {
        kind: "globs",
        globs: ["src/**"],
        model: "claude-opus-5-5",
        effort: { min: "high", max: "low" },
      },
    ];
    const at = (effort: Effort) =>
      check([phase("claude-opus-5-5", effort, { edit: ["src/a.ts"] })], {
        bounds,
        providerConfig: reordered,
      });
    expect(at("high")).toEqual([]);
    expect(at("low")).toEqual([]);
    expect(at("medium").map((f) => f.severity)).toEqual(["error"]);
  });

  it("prints a range whose min equals its max as one effort", () => {
    const bounds: Assignments = [
      {
        kind: "globs",
        globs: ["src/**", "docs/**"],
        model: "claude-opus-5-5",
        effort: { min: "high", max: "high" },
      },
    ];
    expect(
      check([phase("claude-opus-5-5", "medium", { edit: ["src/a.ts"] })], { bounds })[0]!.message,
    ).toBe(
      `claude-opus-5-5 / medium: outside assignments[0] (globs src/**, docs/**: claude-opus-5-5, high) ${NO_REASON}`,
    );
  });
});

describe("assignmentFindings: the reason", () => {
  it("a stated departure is a warning that quotes the reason", () => {
    expect(
      check([phase("claude-sonnet-5-5", "low", { edit: ["docs/refunds.md"] })], {
        headers: [header("phase-01", "the page embeds a generated table no gate checks")],
      }),
    ).toEqual([
      {
        severity: "warning",
        check: "models",
        phase: "phase-01",
        message: `claude-sonnet-5-5 / low: outside ${B2}: "the page embeds a generated table no gate checks"`,
      },
    ]);
  });

  it("a conforming phase with a reason is a warning naming its bound", () => {
    expect(
      check([phase("claude-sonnet-5-5", "medium", { edit: ["src/http/schemas/refund.ts"] })], {
        headers: [header("phase-01", "Mechanical.")],
      }),
    ).toEqual([
      {
        severity: "warning",
        check: "models",
        phase: "phase-01",
        message: `conforms to ${B1} but carries an **Assignment reason:** line`,
      },
    ]);
  });

  it("reads each phase's reason from its own header", () => {
    const findings = check(
      [
        phase("claude-sonnet-5-5", "medium", REFUND, "phase-01"),
        phase("claude-sonnet-5-5", "medium", REFUND, "phase-02"),
      ],
      { headers: [header("phase-02", "Renames only.")] },
    );
    expect(findings.map((f) => [f.phase, f.severity])).toEqual([
      ["phase-01", "error"],
      ["phase-02", "warning"],
    ]);
  });

  it("a phase whose only reason line is **Model reason:** departs without a reason", () => {
    expect(
      check([phase("claude-sonnet-5-5", "medium", REFUND)], {
        headers: [header("phase-01", null, true)],
      }).map((f) => [f.severity, f.message]),
    ).toEqual([["error", `claude-sonnet-5-5 / medium: outside ${B0} ${NO_REASON}`]]);
  });
});

describe("assignmentFindings: bounds that cannot be compared", () => {
  it("an unavailable report makes every part bound an error, and no phase is compared", () => {
    expect(
      check([phase("claude-sonnet-5-5", "medium", REFUND)], {
        parts: { kind: "unavailable", cause: "architecture provider exited 3" },
      }),
    ).toEqual([
      {
        severity: "error",
        check: "models",
        phase: null,
        message:
          "assignments[0] (part core-decide): unresolved: architecture provider exited 3; no phase was compared with the bounds",
      },
      {
        severity: "error",
        check: "models",
        phase: null,
        message:
          "assignments[2] (part docs): unresolved: architecture provider exited 3; no phase was compared with the bounds",
      },
    ]);
  });

  it("a report without the bound's part makes that bound an error, and no phase is compared", () => {
    expect(
      check([phase("claude-sonnet-5-5", "medium", REFUND)], {
        parts: { kind: "resolved", parts: new Map([["core-decide", ["src/core/decide/**"]]]) },
      }),
    ).toEqual([
      {
        severity: "error",
        check: "models",
        phase: null,
        message:
          "assignments[2] (part docs): unresolved: the architecture report has no part docs; no phase was compared with the bounds",
      },
    ]);
  });

  it("an unknown model is one error, and no phase is compared", () => {
    const bounds: Assignments = [CORE, { ...SCHEMAS, model: "claude-opus-9" }];
    expect(check([phase("claude-sonnet-5-5", "medium", REFUND)], { bounds })).toEqual([
      {
        severity: "error",
        check: "models",
        phase: null,
        message: "assignments[1].model: claude-opus-9 is not in the catalog",
      },
    ]);
  });

  it("a min after max is one error, and no phase is compared", () => {
    const bounds: Assignments = [{ ...CORE, effort: { min: "high", max: "medium" } }, SCHEMAS];
    expect(check([phase("claude-haiku-5-5", "low", { edit: ["docs/a.md"] })], { bounds })).toEqual([
      {
        severity: "error",
        check: "models",
        phase: null,
        message: 'assignments[0].effort: min "high" comes after max "medium" for claude-opus-5-5',
      },
    ]);
  });
});

describe("assignmentFindings: the policy default", () => {
  const OFF_DEFAULT =
    "claude-opus-5-5 / high: no bound governs; departs from the policy default (claude-sonnet-5-5 / medium) with no **Assignment reason:** line";
  const AT_DEFAULT_WITH_REASON =
    "no bound governs; takes the policy default (claude-sonnet-5-5 / medium) but carries an **Assignment reason:** line";

  it("with no bounds, an unstated departure from the default is a warning", () => {
    expect(
      check([phase("claude-opus-5-5", "high", REFUND)], {
        bounds: undefined,
        parts: { kind: "resolved", parts: new Map() },
      }),
    ).toEqual([{ severity: "warning", check: "models", phase: "phase-01", message: OFF_DEFAULT }]);
  });

  it("with no bounds, a stated departure from the default has no finding", () => {
    expect(
      check([phase("claude-opus-5-5", "high", REFUND)], {
        bounds: undefined,
        headers: [header("phase-01", "Designs the check.")],
      }),
    ).toEqual([]);
  });

  it("a phase at the default with a reason is a warning", () => {
    expect(
      check([phase("claude-sonnet-5-5", "medium", REFUND)], {
        bounds: undefined,
        headers: [header("phase-01", "Ordinary.")],
      }),
    ).toEqual([
      { severity: "warning", check: "models", phase: "phase-01", message: AT_DEFAULT_WITH_REASON },
    ]);
  });

  it("a phase at the default without a reason has no finding", () => {
    expect(check([phase("claude-sonnet-5-5", "medium", REFUND)], { bounds: undefined })).toEqual(
      [],
    );
  });

  it("a phase no declared bound matches falls under the default", () => {
    expect(check([phase("claude-opus-5-5", "high", { edit: ["src/billing/ledger.ts"] })])).toEqual([
      { severity: "warning", check: "models", phase: "phase-01", message: OFF_DEFAULT },
    ]);
  });

  it("a phase with no planned file falls under the default", () => {
    expect(check([phase("claude-opus-5-5", "high")])).toEqual([
      { severity: "warning", check: "models", phase: "phase-01", message: OFF_DEFAULT },
    ]);
  });
});

describe("boundCatalogProblems", () => {
  it("is empty for the example bounds", () => {
    expect(boundCatalogProblems(BOUNDS, CATALOG)).toEqual([]);
  });

  it("names one problem per invalid bound, in list order", () => {
    const bounds: Assignments = [
      { ...CORE, effort: { min: "high", max: "medium" } },
      { ...SCHEMAS, model: "claude-opus-9" },
      DOCS,
      { ...DOCS, effort: { min: "none", max: "medium" } },
      { ...DOCS, effort: { min: "low", max: "ultra" } },
    ];
    expect(boundCatalogProblems(bounds, CATALOG)).toEqual([
      'assignments[0].effort: min "high" comes after max "medium" for claude-opus-5-5',
      "assignments[1].model: claude-opus-9 is not in the catalog",
      'assignments[3].effort: min "none" is not an effort claude-haiku-5-5 offers',
      'assignments[4].effort: max "ultra" is not an effort claude-haiku-5-5 offers',
    ]);
  });
});
