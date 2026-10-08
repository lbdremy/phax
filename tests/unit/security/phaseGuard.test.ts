import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../../src/cli/program.js";
import {
  PHASE_GUARD_CLASSIFICATION,
  isPhaseWorktree,
  phaseGuardRefusal,
} from "../../../src/domain/security/phaseGuard.js";

// Every command with an action: the leaves of the command tree.
function registeredCommandPaths(cmd: Command, parent = ""): string[] {
  return cmd.commands.flatMap((sub) => {
    const path = parent ? `${parent} ${sub.name()}` : sub.name();
    return sub.commands.length > 0 ? registeredCommandPaths(sub, path) : [path];
  });
}

describe("phase guard — classification", () => {
  it("classifies every command registered in program.ts, and nothing else", () => {
    const registered = registeredCommandPaths(buildProgram()).toSorted();
    expect(Object.keys(PHASE_GUARD_CLASSIFICATION).toSorted()).toEqual(registered);
  });

  it("allows phax brief, schema upgrade and the read-only commands", () => {
    for (const path of [
      "brief",
      "schema upgrade",
      "plans lint",
      "plans status",
      "artifact status",
      "artifact schema",
      "records explain",
      "records status",
      "ls",
      "path",
    ]) {
      expect(phaseGuardRefusal(path), path).toBeUndefined();
    }
  });

  it("refuses the commands that act on phax state or an artifact's lifecycle", () => {
    for (const path of ["run", "resume", "archive", "unlock", "artifact approve", "records sync"]) {
      expect(phaseGuardRefusal(path), path).toBe(
        `✗ phax ${path} is not available inside a phase worktree; run it from the main checkout (inside, only phax brief and read-only commands run)`,
      );
    }
  });

  it("refuses plans status --apply, which flips and commits plan statuses", () => {
    expect(phaseGuardRefusal("plans status", { apply: true })).toBeDefined();
    expect(phaseGuardRefusal("plans status", { json: true })).toBeUndefined();
  });

  it("refuses an unclassified command", () => {
    expect(phaseGuardRefusal("some-new-command")).toBeDefined();
  });
});

describe("phase guard — detection", () => {
  it("is a phase worktree only when linked and holding .phax-context/", () => {
    expect(isPhaseWorktree({ isLinkedWorktree: true, hasPhaxContext: true })).toBe(true);
    expect(isPhaseWorktree({ isLinkedWorktree: true, hasPhaxContext: false })).toBe(false);
    expect(isPhaseWorktree({ isLinkedWorktree: false, hasPhaxContext: true })).toBe(false);
    expect(isPhaseWorktree({ isLinkedWorktree: false, hasPhaxContext: false })).toBe(false);
  });
});
