import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { runThroughOutput } from "../../../src/cli/bridge.js";
import { makeRecordsInitCommand } from "../../../src/cli/definitions/records.js";
import { FAKE_PROMPT_CANCEL, makeFakePrompt } from "../../../src/infra/fakes/prompt.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";
import type { OutputPort } from "../../../src/ports/output.js";
import { isolateGit } from "../../helpers/isolateGit.js";
import { isolatePhaxHome } from "../../helpers/isolatePhaxHome.js";
import { removeTempDir } from "../../helpers/tempGit.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax records init` through makeRecordsInitCommand with a scripted Prompt layer and a fake
// GitHub, in a temporary repository: no real prompt, `gh`, ~/.phax or global git config is read.

function privateGitHub() {
  const github = makeFakeGitHub();
  github.impl.setVisibility("private");
  return github;
}

describe("phax records init answers the file it configured", () => {
  let base: string;
  let repo: string;
  let originalCwd: string;
  let restoreGit: () => void;
  let home: ReturnType<typeof isolatePhaxHome>;

  beforeEach(() => {
    home = isolatePhaxHome();
    restoreGit = isolateGit();
    base = realpathSync(mkdtempSync(join(tmpdir(), "phax-records-init-written-")));
    repo = join(base, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    writeFileSync(
      join(repo, "phax.json"),
      JSON.stringify(
        {
          version: 1,
          name: "acme",
          state: { root: join(base, "state") },
          gateProfiles: {
            fast: [{ command: "true", surface: "local", firing: "every-phase" }],
          },
        },
        null,
        2,
      ) + "\n",
    );
    originalCwd = process.cwd();
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    removeTempDir(base);
    restoreGit();
    home.restore();
  });

  it("answers phax.json's written-file record, from the repository root, with its digest", async () => {
    // Transcript off, then auto-push on: a private repository keeps the destination in-repo.
    const prompt = makeFakePrompt([false, true]);
    const command = makeRecordsInitCommand(prompt.layer, privateGitHub().layer);

    const answer = await Effect.runPromise(
      command.run({
        input: { flags: {} },
        program: {},
        progress: () => Effect.void,
        say: () => Effect.void,
      }),
    );

    expect(answer.kind).toBe("configured");
    if (answer.kind !== "configured") return;
    const bytes = readFileSync(join(repo, "phax.json"));
    expect(answer.written).toHaveLength(1);
    const [file] = answer.written;
    expect(file?.path).toBe("phax.json");
    expect(file?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(file?.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(JSON.parse(bytes.toString("utf8")).records).toEqual({
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: true,
    });
  });

  it("declares no verdict: a sync the clone refuses still exits 0, as before the runner", () => {
    const command = makeRecordsInitCommand(makeFakePrompt([]).layer, privateGitHub().layer);
    expect(command.verdicts).toBeUndefined();
  });

  it("answers aborted with exit 0 when the prompt is cancelled, and writes nothing", async () => {
    const before = readFileSync(join(repo, "phax.json"));
    const prompt = makeFakePrompt([FAKE_PROMPT_CANCEL]);
    const command = makeRecordsInitCommand(prompt.layer, privateGitHub().layer);
    const logs: string[] = [];
    const errors: string[] = [];
    const out: OutputPort = {
      log: (message) => logs.push(message),
      warn: (message) => errors.push(message),
      error: (message) => errors.push(message),
    };

    const code = await runThroughOutput(command, { flags: {} }, out);

    expect(code).toBe(0);
    expect(logs).toEqual(["phax records init aborted — no changes written."]);
    expect(errors).toEqual([]);
    expect(readFileSync(join(repo, "phax.json")).equals(before)).toBe(true);
  });
});
