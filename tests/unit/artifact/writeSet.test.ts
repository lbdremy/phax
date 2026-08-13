import { describe, expect, it } from "vitest";
import {
  transitionCommitMessage,
  transitionWriteSet,
} from "../../../src/domain/artifact/writeSet.js";
import { APPROVALS_FILE_PATH } from "../../../src/domain/artifact/lineage.js";

describe("transitionWriteSet", () => {
  it("spec approve: just the artifact path", () => {
    expect(transitionWriteSet("spec", "docs/specs/21-foo.md", "Approved")).toEqual([
      "docs/specs/21-foo.md",
    ]);
  });

  it("spec abandon: artifact path plus archive destination, no approvals file", () => {
    expect(transitionWriteSet("spec", "docs/specs/21-foo.md", "Abandoned")).toEqual([
      "docs/specs/21-foo.md",
      "docs/specs/archive/21-foo.md",
    ]);
  });

  it("spec complete: artifact path plus archive destination, no approvals file", () => {
    expect(transitionWriteSet("spec", "docs/specs/21-foo.md", "Completed")).toEqual([
      "docs/specs/21-foo.md",
      "docs/specs/archive/21-foo.md",
    ]);
  });

  it("plan approve: artifact path plus the approvals file", () => {
    expect(transitionWriteSet("plan", "docs/plans/40-plan.md", "Approved")).toEqual([
      "docs/plans/40-plan.md",
      APPROVALS_FILE_PATH,
    ]);
  });

  it("plan stale: just the artifact path (not Approved, not terminal)", () => {
    expect(transitionWriteSet("plan", "docs/plans/40-plan.md", "Stale")).toEqual([
      "docs/plans/40-plan.md",
    ]);
  });

  it("plan reopen (Draft): just the artifact path", () => {
    expect(transitionWriteSet("plan", "docs/plans/40-plan.md", "Draft")).toEqual([
      "docs/plans/40-plan.md",
    ]);
  });

  it("plan abandon: artifact path, approvals file, and archive destination", () => {
    expect(transitionWriteSet("plan", "docs/plans/40-plan.md", "Abandoned")).toEqual([
      "docs/plans/40-plan.md",
      APPROVALS_FILE_PATH,
      "docs/plans/archive/40-plan.md",
    ]);
  });

  it("plan complete: artifact path, approvals file, and archive destination", () => {
    expect(transitionWriteSet("plan", "docs/plans/40-plan.md", "Completed")).toEqual([
      "docs/plans/40-plan.md",
      APPROVALS_FILE_PATH,
      "docs/plans/archive/40-plan.md",
    ]);
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
    const { subject } = transitionCommitMessage("plan", target, "docs/plans/40-plan.md");
    expect(subject).toBe(`chore(plans): ${verb} 40-plan`);
  });

  it("scopes the subject to specs for spec kind", () => {
    const { subject } = transitionCommitMessage("spec", "Approved", "docs/specs/21-foo.md");
    expect(subject).toBe("chore(specs): approve 21-foo");
  });

  it("body names the transition and the repo-relative path", () => {
    const { body } = transitionCommitMessage("plan", "Completed", "docs/plans/40-plan.md");
    expect(body).toContain("docs/plans/40-plan.md");
    expect(body).toContain("Completed");
  });

  it("strips the .md extension from the slug", () => {
    const { subject } = transitionCommitMessage(
      "plan",
      "Approved",
      "docs/plans/45-typescript-7-migration-plan.md",
    );
    expect(subject).toBe("chore(plans): approve 45-typescript-7-migration-plan");
  });
});
