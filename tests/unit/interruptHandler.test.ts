import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRunInterruptContext,
  setRunInterruptContext,
  setupInterruptHandlers,
} from "../../src/cli/interruptHandler.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import type { RunStatus } from "../../src/schemas/status.js";
import { removeTempDir } from "../helpers/tempGit.js";

// A SIGTERM while the made-up garden-sync run runs: the handler's sentence goes
// through the writer `phax run` and `phax resume` hand it (their progress, so a
// note line under --json), never straight to the process's stderr.

const NAMESPACE = "example";
const SHORT = "garden-sync";

let root: string;
let before: { readonly SIGTERM: readonly Function[]; readonly SIGINT: readonly Function[] };

beforeEach(() => {
  before = { SIGTERM: process.listeners("SIGTERM"), SIGINT: process.listeners("SIGINT") };
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-interrupt-handler-test-")));
  const runPath = join(root, "runs", `${NAMESPACE}.${SHORT}`);
  mkdirSync(runPath, { recursive: true });
  const run: RunStatus = {
    namespace: NAMESPACE,
    shortName: SHORT,
    runId: "garden-sync-1792667922832",
    state: "running",
    createdAt: "2026-10-22T09:00:00.000Z",
    updatedAt: "2026-10-22T09:00:00.000Z",
    phasesCount: 2,
    currentPhaseIndex: 0,
    hold: { selection: "none" },
  };
  writeFileSync(
    join(runPath, "run-status.json"),
    JSON.stringify(withSchemaUrl("run-status", run), null, 2),
  );
});

afterEach(() => {
  clearRunInterruptContext();
  // Only the handlers this test added go: the worker's own stay.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!before[signal].includes(listener)) process.removeListener(signal, listener);
    }
  }
  vi.restoreAllMocks();
  removeTempDir(root);
});

describe("the interrupt handler", () => {
  it("writes its sentence through the run's writer and exits 130", () => {
    const written: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    setupInterruptHandlers();
    setRunInterruptContext(SHORT, NAMESPACE, root, (text) => written.push(text));

    process.emit("SIGTERM", "SIGTERM");

    expect(written).toEqual([
      `\nRun "${NAMESPACE}.${SHORT}" interrupted — state saved. Resume with: phax resume ${SHORT} --yes`,
    ]);
    expect(stderr).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(130);
  });
});
