import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boundedOutput, GIT_BOUND_MS } from "../helpers/boundedSpawn.js";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempEnv, type TempEnv } from "./helpers/tempEnv.js";
import { E2E_CLI_BOUND_MS, runCli } from "./helpers/runCli.js";
import { printArtifacts } from "./helpers/artifacts.js";
import { probeProvider } from "./helpers/providers.js";
import { snapshotOperatorPhaxHome } from "./helpers/operatorPhaxHome.js";
import { dailyJournalFileName } from "../../src/domain/telemetry/journal.js";

// Explicit opt-in (PHAX_E2E_RUN=1), same as the real run flow, plus a probe for
// the claude CLI headless authoring always spawns through.
const E2E_ENABLED = process.env["PHAX_E2E_RUN"] === "1";
const shouldRun = E2E_ENABLED && probeProvider("claude");

describe.skipIf(!shouldRun)("phax headless authoring E2E", () => {
  let env: TempEnv;
  let failed = false;
  let operatorBefore: readonly string[] = [];
  let startedAt = new Date();

  beforeAll(() => {
    startedAt = new Date();
    operatorBefore = snapshotOperatorPhaxHome();
    env = createTempEnv();
    writeFileSync(
      join(env.repoDir, "brief.md"),
      [
        'Write a tiny spec titled "Headless authoring smoke test".',
        "It documents a no-op CLI flag `--noop` that does nothing and always exits 0.",
        "Keep every section short; this is a throwaway fixture spec, not a real feature.",
      ].join("\n"),
    );
  });

  afterAll(() => {
    if (!env) return;
    expect(snapshotOperatorPhaxHome(), "the operator's ~/.phax should be untouched").toEqual(
      operatorBefore,
    );
    const journals = [startedAt, new Date()].map((day) =>
      join(env.phaxHome, dailyJournalFileName(day)),
    );
    expect(
      journals.some((journal) => existsSync(journal)),
      `today's telemetry journal should be under the temporary phax home: ${journals.join(" or ")}`,
    ).toBe(true);
    if (failed) {
      printArtifacts({ repoDir: env.repoDir, phaxHome: env.phaxHome }, "headless authoring failed");
    } else {
      env.cleanup();
    }
  });

  it(
    "authors a spec from a brief, commits it with its sidecar, and reports in sync",
    { timeout: 300_000 },
    () => {
      const result = runCli(
        [
          "artifact",
          "new",
          "spec",
          "headless-authoring-smoke",
          "--headless",
          "--brief",
          "brief.md",
          // Sonnet, not haiku: the spec document's traceability refinement
          // (every requirement covered by a criterion) is strict enough that
          // haiku at low effort breaks it often, failing the test on model
          // output rather than on phax.
          "--model",
          "claude-sonnet-5",
          "--effort",
          "low",
        ],
        env,
        { boundMs: 290_000 }, // a real provider call: its old timeout
      );

      if (result.exitCode !== 0) {
        failed = true;
        printArtifacts(
          { repoDir: env.repoDir, phaxHome: env.phaxHome },
          `headless authoring failed (exit ${result.exitCode}):\n${result.stdout}\n${result.stderr}`,
        );
      }

      expect(
        result.exitCode,
        `authoring output:\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      ).toBe(0);

      const createdLine = result.stdout.split("\n").find((line) => line.startsWith("created "));
      expect(createdLine, `expected a "created" line in:\n${result.stdout}`).toBeDefined();
      const specPath = (createdLine as string).slice("created ".length).split(" ")[0] as string;
      const sidecarPath = specPath.replace(/\.md$/, ".json");

      expect(existsSync(join(env.repoDir, specPath)), `${specPath} should exist`).toBe(true);
      expect(existsSync(join(env.repoDir, sidecarPath)), `${sidecarPath} should exist`).toBe(true);

      const headFiles = boundedOutput("git", ["show", "--stat", "--name-only", "HEAD"], {
        cwd: env.repoDir,
        boundMs: GIT_BOUND_MS,
      });
      expect(headFiles, "HEAD should list the spec").toContain(specPath);
      expect(headFiles, "HEAD should list the sidecar").toContain(sidecarPath);

      const statusResult = runCli(["artifact", "status", specPath], env, {
        boundMs: E2E_CLI_BOUND_MS,
      });
      expect(statusResult.exitCode, `status output:\n${statusResult.stdout}`).toBe(0);
      expect(statusResult.stdout).toContain("in sync");
    },
  );
});
