import { describe, expect, it } from "vitest";
import {
  transitionCommitMessage,
  transitionWriteSet,
} from "../../../src/domain/artifact/writeSet.js";
import type { ArtifactKind, ArtifactStatus } from "../../../src/domain/artifact/status.js";

const SPEC = "docs/specs/2609101221-foo.md";
const SPEC_RECORD = "docs/specs/approvals/2609101221-foo.json";
const SPEC_ARCHIVE = "docs/specs/archive/2609101221-foo.md";
const PLAN = "docs/plans/2609101240-thing-plan.md";
const PLAN_RECORD = "docs/plans/approvals/2609101240-thing-plan.json";
const PLAN_ARCHIVE = "docs/plans/archive/2609101240-thing-plan.md";

const NONE = { hasSidecar: false, hasRecordFile: false };
const RECORDED = { hasSidecar: false, hasRecordFile: true };

describe("transitionWriteSet", () => {
  // The exists rule, per kind × target: [kind, target, without record, with record].
  it.each<[ArtifactKind, ArtifactStatus, readonly string[], readonly string[]]>([
    ["spec", "Approved", [SPEC, SPEC_RECORD], [SPEC, SPEC_RECORD]],
    ["spec", "Stale", [SPEC], [SPEC]],
    ["spec", "Draft", [SPEC], [SPEC]],
    ["spec", "Abandoned", [SPEC, SPEC_ARCHIVE], [SPEC, SPEC_RECORD, SPEC_ARCHIVE]],
    ["spec", "Completed", [SPEC, SPEC_ARCHIVE], [SPEC, SPEC_RECORD, SPEC_ARCHIVE]],
    ["plan", "Approved", [PLAN, PLAN_RECORD], [PLAN, PLAN_RECORD]],
    ["plan", "Stale", [PLAN], [PLAN]],
    ["plan", "Draft", [PLAN], [PLAN, PLAN_RECORD]],
    ["plan", "Abandoned", [PLAN, PLAN_ARCHIVE], [PLAN, PLAN_RECORD, PLAN_ARCHIVE]],
    ["plan", "Completed", [PLAN, PLAN_ARCHIVE], [PLAN, PLAN_RECORD, PLAN_ARCHIVE]],
  ])("%s → %s lists its own record file per the exists rule", (kind, target, without, with_) => {
    const path = kind === "spec" ? SPEC : PLAN;
    expect(transitionWriteSet(kind, path, target, NONE)).toEqual(without);
    expect(transitionWriteSet(kind, path, target, RECORDED)).toEqual(with_);
  });

  it("never lists an old ledger or another artifact's record file", () => {
    for (const [kind, path, own] of [
      ["spec", SPEC, SPEC_RECORD],
      ["plan", PLAN, PLAN_RECORD],
    ] as const) {
      for (const target of ["Approved", "Stale", "Draft", "Abandoned", "Completed"] as const) {
        for (const p of transitionWriteSet(kind, path, target, RECORDED)) {
          if (p.includes("approvals")) expect(p).toBe(own);
        }
      }
    }
  });

  it("a never-approved Draft spec's abandon lists no record path", () => {
    expect(transitionWriteSet("spec", SPEC, "Abandoned", NONE)).toEqual([SPEC, SPEC_ARCHIVE]);
  });

  describe("with a sidecar", () => {
    const specJson = "docs/specs/2609101221-foo.json";
    const planJson = "docs/plans/2609101240-thing-plan.json";
    const SIDECAR = { hasSidecar: true, hasRecordFile: true };

    it.each<[ArtifactStatus, readonly string[]]>([
      ["Draft", [SPEC, specJson]],
      ["Approved", [SPEC, specJson, SPEC_RECORD]],
      ["Stale", [SPEC, specJson]],
      [
        "Abandoned",
        [SPEC, specJson, SPEC_RECORD, SPEC_ARCHIVE, "docs/specs/archive/2609101221-foo.json"],
      ],
      [
        "Completed",
        [SPEC, specJson, SPEC_RECORD, SPEC_ARCHIVE, "docs/specs/archive/2609101221-foo.json"],
      ],
    ])("spec → %s adds the sidecar beside every artifact path", (target, expected) => {
      expect(transitionWriteSet("spec", SPEC, target, SIDECAR)).toEqual(expected);
    });

    it.each<[ArtifactStatus, readonly string[]]>([
      ["Draft", [PLAN, planJson, PLAN_RECORD]],
      ["Approved", [PLAN, planJson, PLAN_RECORD]],
      ["Stale", [PLAN, planJson]],
      [
        "Abandoned",
        [
          PLAN,
          planJson,
          PLAN_RECORD,
          PLAN_ARCHIVE,
          "docs/plans/archive/2609101240-thing-plan.json",
        ],
      ],
      [
        "Completed",
        [
          PLAN,
          planJson,
          PLAN_RECORD,
          PLAN_ARCHIVE,
          "docs/plans/archive/2609101240-thing-plan.json",
        ],
      ],
    ])("plan → %s adds the sidecar beside every artifact path", (target, expected) => {
      expect(transitionWriteSet("plan", PLAN, target, SIDECAR)).toEqual(expected);
    });
  });
});

describe("transitionCommitMessage", () => {
  it.each([
    ["Approved", "approve"],
    ["Stale", "stale"],
    ["Draft", "reopen"],
    ["Abandoned", "abandon"],
    ["Completed", "complete"],
  ] as const)("maps target %s to verb %s", (target, verb) => {
    const { subject } = transitionCommitMessage(
      "plan",
      target,
      "docs/plans/2609101240-thing-plan.md",
    );
    expect(subject).toBe(`chore(plans): ${verb} thing`);
  });

  it("scopes the subject to specs for spec kind", () => {
    const { subject } = transitionCommitMessage("spec", "Approved", "docs/specs/2609101221-foo.md");
    expect(subject).toBe("chore(specs): approve foo");
  });

  it("names an archived spec by its bare slug", () => {
    const { subject } = transitionCommitMessage(
      "spec",
      "Completed",
      "docs/specs/archive/2609091040-artifact-timestamp-naming.md",
    );
    expect(subject).toBe("chore(specs): complete artifact-timestamp-naming");
  });

  it("body names the transition and the repo-relative path", () => {
    const { body } = transitionCommitMessage(
      "plan",
      "Completed",
      "docs/plans/2609101240-thing-plan.md",
    );
    expect(body).toContain("docs/plans/2609101240-thing-plan.md");
    expect(body).toContain("Completed");
  });

  it("names the bare slug — no stamp, no -plan suffix, no .md", () => {
    const { subject } = transitionCommitMessage(
      "plan",
      "Approved",
      "docs/plans/2609101245-typescript-7-migration-plan.md",
    );
    expect(subject).toBe("chore(plans): approve typescript-7-migration");
  });
});
