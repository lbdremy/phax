/**
 * The hold step of `freshRunPreflight`: a selection the plan cannot honour is
 * refused with exit 11 before anything is written, and a valid one comes back
 * resolved for `createRunFolder`. Fake filesystem, git and shell: the routing
 * load reads an in-memory filesystem, so the developer's ~/.phax is never read.
 */
import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { freshRunPreflight, type FreshRunPreflightInput } from "../../src/app/runPreflight.js";
import { HoldPreflightError } from "../../src/domain/errors.js";
import type { HoldRequest } from "../../src/domain/hold.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";
import { planMdFor } from "../helpers/planMarkdown.js";

const NAMESPACE = "example";

function phase(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Phase ${id}`,
    model: "claude-opus-5-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    commit: { subject: "feat: invoice export", body: "Exports invoices." },
    mode: "headless",
    oracle: null,
    ...extra,
  };
}

// The made-up invoice-export plan: phase-02 pins files that phase-03 discharges.
function makePlan(): PhaxPlan {
  return {
    version: 1,
    run: {
      shortName: "invoice-export",
      title: "Invoice export",
      branch: "phax/invoice-export",
      requiredCommands: [],
    },
    phases: [
      phase("phase-01"),
      phase("phase-02", {
        oracle: { dischargedBy: "phase-03", files: ["tests/invoiceRow.test.ts"] },
      }),
      phase("phase-03"),
      phase("phase-04"),
    ],
  } as unknown as PhaxPlan;
}

function makeConfig(): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: "/state" },
      gateProfiles: {
        standard: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
      },
    },
    stateRoot: "/state",
    namespace: NAMESPACE,
    repoRoot: "/repo",
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
  } as unknown as ResolvedConfig;
}

async function preflight(hold: HoldRequest, plan: PhaxPlan = makePlan()) {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const input: FreshRunPreflightInput = {
    plan,
    planMd: planMdFor(plan),
    planPath: "docs/plans/invoice-export.md",
    config: makeConfig(),
    gateProfileId: "standard",
    namespace: NAMESPACE,
    allowSkillEdits: false,
    allowDirty: false,
    hold,
  };
  const result = await Effect.runPromise(
    Effect.either(
      freshRunPreflight(input).pipe(
        Effect.provide(fs.layer),
        Effect.provide(git.layer),
        Effect.provide(makeFakeShell().layer),
      ),
    ),
  );
  return { result, git };
}

describe("the hold step of freshRunPreflight", () => {
  it("resolves no hold to none", async () => {
    const { result } = await preflight({ kind: "none" });
    expect(Either.isRight(result) && result.right.hold).toEqual({ selection: "none" });
  });

  it("resolves a list to the phases in plan order, ready for createRunFolder", async () => {
    const { result } = await preflight({ kind: "listed", phases: ["phase-04", "phase-01"] });
    // phase-04 is the final phase, so this is refused; see the next test for the valid case.
    expect(Either.isLeft(result)).toBe(true);
    const ok = await preflight({ kind: "listed", phases: ["phase-01"] });
    expect(Either.isRight(ok.result) && ok.result.right.hold).toEqual({
      selection: "listed",
      phases: ["phase-01"],
    });
  });

  it("resolves oracle and the pair's phases with no finding", async () => {
    const oracle = await preflight({ kind: "oracle" });
    expect(Either.isRight(oracle.result) && oracle.result.right.hold).toEqual({
      selection: "oracle",
      phases: ["phase-02"],
    });
    const pair = await preflight({ kind: "listed", phases: ["phase-03", "phase-02"] });
    expect(Either.isRight(pair.result) && pair.result.right.hold).toEqual({
      selection: "listed",
      phases: ["phase-02", "phase-03"],
    });
  });

  it("refuses with exit 11, printing every error with its phase", async () => {
    const { result, git } = await preflight({
      kind: "listed",
      phases: ["phase-09", "phase-04", "phase-02"],
    });
    if (Either.isRight(result)) throw new Error("expected a refusal");
    expect(result.left).toBeInstanceOf(HoldPreflightError);
    expect(exitCodeForError(result.left)).toBe(11);
    expect(result.left.message).toBe(
      [
        "Hold preflight failed: 2 error(s).",
        "  phase-09  is not a phase of this plan",
        "  phase-04  is the final phase: it already stays open in review_open",
      ].join("\n"),
    );
    // The hold comes before the clean-tree check: git was never asked.
    expect(git.impl.calls).toEqual([]);
  });

  it("prints a dash for a selection-wide error", async () => {
    const plan = { ...makePlan(), phases: [makePlan().phases[0]!] } as PhaxPlan;
    const { result } = await preflight({ kind: "all" }, plan);
    if (Either.isRight(result)) throw new Error("expected a refusal");
    expect(result.left.message).toBe(
      [
        "Hold preflight failed: 1 error(s).",
        "  -  --hold selects no phase: the plan has no headless phase before its final phase",
      ].join("\n"),
    );
  });
});
