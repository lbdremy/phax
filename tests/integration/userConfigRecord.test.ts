import { execFileSync } from "node:child_process";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import {
  phaseScripts,
  runHeadlessPlan,
  useFakeClaude,
  type PlanRun,
} from "../helpers/projectOnlyHarness.js";

// Acceptance for the record value: a phase record says whether the provider
// loaded the person's user configuration. A claude-code phase runs project-only
// and says `excluded`; a codex-cli phase loads its user layer and says
// `loaded`. A made-up two-phase run, records on the repository's records
// branch, every provider played by the recording stubs.

const fake = useFakeClaude();

const RECORDS_BRANCH = "phax/records/v1";
const CLAUDE_SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";
const CODEX_SESSION = "019a2f6e-0000-4000-8000-000000000002";

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** The committed record.json of `phaseId`: each records commit holds only its own record. */
function manifestOf(run: PlanRun, phaseId: string): Record<string, unknown> {
  const key = `${run.runId as string}/${phaseId}`;
  const commit = gitIn(run.repoRoot, "rev-list", RECORDS_BRANCH)
    .split("\n")
    .filter(Boolean)
    .find((c) =>
      gitIn(run.repoRoot, "ls-tree", "-r", "--name-only", c)
        .split("\n")
        .includes(`${key}/record.json`),
    );
  if (commit === undefined) throw new Error(`no record of ${phaseId}`);
  return JSON.parse(gitIn(run.repoRoot, "show", `${commit}:${key}/record.json`)) as Record<
    string,
    unknown
  >;
}

describe("ac-record", () => {
  it(
    "a claude-code phase record says userConfig excluded and a codex-cli one says loaded, both at 0.34.0",
    { timeout: 60_000 },
    async () => {
      // phase-01 on Claude Code, then phase-02 on Codex: work and handoff turns.
      fake.cli.setScripts([
        ...phaseScripts("phase-01", CLAUDE_SESSION, { fix: false }),
        ...phaseScripts("phase-02", CODEX_SESSION, { fix: false }),
      ]);

      const run = await runHeadlessPlan(fake, {
        phases: [
          { id: "phase-01", model: "claude-opus-5-5" },
          { id: "phase-02", model: "gpt-6-luna" },
        ],
        gate: "pass",
        records: true,
      });

      expect(Result.isSuccess(run.result)).toBe(true);
      expect(fake.launches().map((launch) => launch.executable)).toEqual([
        "claude",
        "claude",
        "codex",
        "codex",
      ]);
      const claude = manifestOf(run, "phase-01");
      const codex = manifestOf(run, "phase-02");
      const stamp = currentSchemaUrl("phase-record-manifest");
      expect(stamp).toContain("0.34.0");
      expect(claude).toMatchObject({ provider: "claude-code", $schema: stamp });
      expect(codex).toMatchObject({ provider: "codex-cli", $schema: stamp });
      expect(claude["userConfig"]).toBe("excluded");
      expect(codex["userConfig"]).toBe("loaded");
    },
  );
});
