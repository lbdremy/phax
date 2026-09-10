import { describe, expect, it } from "vitest";
import {
  transitionCommitMessage,
  transitionWriteSet,
} from "../../../src/domain/artifact/writeSet.js";
import {
  APPROVALS_FILE_PATH,
  SPEC_APPROVALS_FILE_PATH,
} from "../../../src/domain/artifact/lineage.js";

describe("transitionWriteSet", () => {
  it("spec approve: artifact path plus the spec approvals file", () => {
    expect(transitionWriteSet("spec", "docs/specs/2609101221-foo.md", "Approved")).toEqual([
      "docs/specs/2609101221-foo.md",
      SPEC_APPROVALS_FILE_PATH,
    ]);
  });

  it("spec abandon: artifact path, spec approvals file, and archive destination", () => {
    expect(transitionWriteSet("spec", "docs/specs/2609101221-foo.md", "Abandoned")).toEqual([
      "docs/specs/2609101221-foo.md",
      SPEC_APPROVALS_FILE_PATH,
      "docs/specs/archive/2609101221-foo.md",
    ]);
  });

  it("spec complete: artifact path, spec approvals file, and archive destination", () => {
    expect(transitionWriteSet("spec", "docs/specs/2609101221-foo.md", "Completed")).toEqual([
      "docs/specs/2609101221-foo.md",
      SPEC_APPROVALS_FILE_PATH,
      "docs/specs/archive/2609101221-foo.md",
    ]);
  });

  it("plan approve: artifact path plus the approvals file", () => {
    expect(transitionWriteSet("plan", "docs/plans/2609101240-thing-plan.md", "Approved")).toEqual([
      "docs/plans/2609101240-thing-plan.md",
      APPROVALS_FILE_PATH,
    ]);
  });

  it("plan stale: just the artifact path (not Approved, not terminal)", () => {
    expect(transitionWriteSet("plan", "docs/plans/2609101240-thing-plan.md", "Stale")).toEqual([
      "docs/plans/2609101240-thing-plan.md",
    ]);
  });

  it("plan reopen (Draft): artifact path plus the approvals file", () => {
    expect(transitionWriteSet("plan", "docs/plans/2609101240-thing-plan.md", "Draft")).toEqual([
      "docs/plans/2609101240-thing-plan.md",
      APPROVALS_FILE_PATH,
    ]);
  });

  it("spec reopen (Draft): just the artifact path, no approvals file", () => {
    expect(transitionWriteSet("spec", "docs/specs/2609101221-foo.md", "Draft")).toEqual([
      "docs/specs/2609101221-foo.md",
    ]);
  });

  it("plan abandon: artifact path, approvals file, and archive destination", () => {
    expect(transitionWriteSet("plan", "docs/plans/2609101240-thing-plan.md", "Abandoned")).toEqual([
      "docs/plans/2609101240-thing-plan.md",
      APPROVALS_FILE_PATH,
      "docs/plans/archive/2609101240-thing-plan.md",
    ]);
  });

  it("plan complete: artifact path, approvals file, and archive destination", () => {
    expect(transitionWriteSet("plan", "docs/plans/2609101240-thing-plan.md", "Completed")).toEqual([
      "docs/plans/2609101240-thing-plan.md",
      APPROVALS_FILE_PATH,
      "docs/plans/archive/2609101240-thing-plan.md",
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
