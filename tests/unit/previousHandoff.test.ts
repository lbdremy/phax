import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { readPreviousHandoff, type InjectionPhase } from "../../src/app/handoffInjection.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";

// A made-up run of three headless phases; phase-03's prompt reads phase-02.
const runPath = "/example/runs/acme.invoice-export";
const phases: readonly InjectionPhase[] = ["phase-01", "phase-02", "phase-03"].map((id) => ({
  id,
  mode: "headless",
}));
const now = "2026-10-25T09:00:00.000Z";

function read(setup: (set: (path: string, content: string) => void) => void, index = 2) {
  const fs = makeFakeFileSystem();
  setup((path, content) => fs.impl.setFile(path, content));
  return Effect.runSync(readPreviousHandoff(runPath, phases, index).pipe(Effect.provide(fs.layer)));
}

function status(phaseId: string, state: PhaseStatus["state"]): string {
  return JSON.stringify(
    phaseStatusFile({
      phaseId,
      phaseIndex: 1,
      state,
      model: "claude-sonnet-5-5",
      effort: "medium",
      branchName: `phax/invoice-export--${phaseId}`,
      base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      createdAt: now,
      updatedAt: now,
    }),
  );
}

describe("readPreviousHandoff", () => {
  it("is first-phase before the first phase", () => {
    expect(read(() => {}, 0)).toEqual({ kind: "first-phase" });
  });

  it("is the handoff's text when the previous phase's file is present", () => {
    expect(
      read((set) => {
        set(`${runPath}/phase-02/status.json`, status("phase-02", "cleaned_up"));
        set(`${runPath}/phase-02/phase-handoff.md`, "## What was delivered\n\nExports.");
      }),
    ).toEqual({ kind: "present", text: "## What was delivered\n\nExports." });
  });

  it("is skipped, not missing, when the previous phase produced no changes", () => {
    expect(
      read((set) => set(`${runPath}/phase-02/status.json`, status("phase-02", "skipped"))),
    ).toEqual({ kind: "skipped", phaseId: "phase-02" });
  });

  it("is missing when the previous phase committed but holds no handoff", () => {
    expect(
      read((set) => set(`${runPath}/phase-02/status.json`, status("phase-02", "cleaned_up"))),
    ).toEqual({ kind: "missing", phaseId: "phase-02" });
  });
});
