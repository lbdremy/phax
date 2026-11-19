import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_ROUTING_PATH, PROVIDER_CONFIG_PATH } from "../../src/app/loadRouting.js";
import { makeAgentGroup } from "../../src/cli/definitions/agent.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { runnerCall } from "../helpers/runnerCall.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// ac-setup-removed: the agent group through the command runner, over a fake Shell and the real
// file system under an isolated PHAX home. `agent setup mistral-vibe` is gone.

function call(argv: ReadonlyArray<string>) {
  const group = makeAgentGroup({ shell: makeFakeShell().layer, fileSystem: NodeFileSystemLayer });
  return runnerCall([group], ["agent", ...argv]);
}

beforeEach(() => {
  for (const path of [PROVIDER_CONFIG_PATH, MODEL_ROUTING_PATH]) {
    rmSync(path, { force: true });
    mkdirSync(dirname(path), { recursive: true });
  }
});

describe("agent setup without the Vibe alias installer", () => {
  it("ac-setup-removed: `agent setup mistral-vibe` is an unknown command", async () => {
    const result = await call(["setup", "mistral-vibe"]);
    expect(result.code).not.toBe(0);
    expect(result.err + result.out).toMatch(/unknown command.*mistral-vibe/i);
  });

  it("ac-setup-removed: `agent setup --help` lists providers and no mistral-vibe", async () => {
    const result = await call(["setup", "--help"]);
    const text = result.out + result.err;
    expect(text).toContain("providers");
    expect(text).not.toContain("mistral-vibe");
  });
});
