// The every-command table of command-contracts: each command of `phax --usage` has a row, either
// a call that answers without a provider, network or person, or the path of the family test that
// proves the command with fakes. The table fails on a command with neither, and on a row naming a
// command the usage spec does not list. A runnable row holds `--json` to §5.2 and §5.3: one value
// on stdout, indented by two spaces with one trailing newline, `$schema` first when it has one,
// and only message lines on stderr. A command that always prompts is refused with 64 (§5.20).
// The catalogue of `phax --json-schema` holds one entry per command, each equal to the command's
// own `--json-schema`.
//   ac-json-every-command, ac-no-person and ac-catalogue.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runner } from "../../src/cli/commandLibrary/commander/index.js";
import { memoryIo } from "../../src/cli/commandLibrary/contract/conformance/memoryIo.js";
import type { ExitCode } from "../../src/cli/commandLibrary/contract/index.js";
import { makeResetPhaseCommand } from "../../src/cli/definitions/resetPhase.js";
import { makeResumeCommand } from "../../src/cli/definitions/resume.js";
import { makeRunCommand } from "../../src/cli/definitions/run.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { makeRunCommandsRepo, type RunCommandsRepo } from "../fixtures/run/runCommandsRepo.js";
import { phaxCall } from "../helpers/runnerCall.js";
import { usageDeclarations } from "../helpers/usageKdl.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

/** The project root, read before any test points the working directory at a fixture. */
const ROOT = process.cwd();
const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];

/** The commands of the committed usage spec: every declared path that is no group. */
function usageCommands(): ReadonlyArray<string> {
  const keys = [...usageDeclarations(readFileSync(join(ROOT, "phax.usage.kdl"), "utf8")).keys()];
  return keys.filter((key) => key !== "" && !keys.some((other) => other.startsWith(`${key} `)));
}

let repo: RunCommandsRepo;
beforeEach(async () => {
  repo = await makeRunCommandsRepo();
  vi.spyOn(process, "cwd").mockReturnValue(repo.repoDir);
});
afterEach(() => {
  vi.restoreAllMocks();
  repo.dispose();
});

interface Called {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** The runnable commands that need fakes: the run family, over the fixture's fake layers. */
async function callRunFamily(argv: ReadonlyArray<string>): Promise<Called> {
  const fakes = repo.fakes();
  const program = repo.program([
    makeRunCommand(fakes.deps),
    makeResumeCommand(fakes.deps),
    makeResetPhaseCommand(),
  ]);
  const memory = memoryIo({ argv });
  const code = await Effect.runPromise(runner.run(program, memory.io) as Effect.Effect<ExitCode>);
  return { code, out: memory.out(), err: memory.err() };
}

async function callPhax(argv: ReadonlyArray<string>): Promise<Called> {
  const { code, out, err } = await phaxCall(argv);
  return { code, out, err };
}

interface Row {
  /** The command's words, as `phax --usage` lists them. */
  readonly command: string;
  /** A call that answers without a provider, network or person, with its `--json` form. */
  readonly call?: (json: boolean) => ReadonlyArray<string>;
  /** Where the call runs: the real program, or the run family over fake layers. */
  readonly through?: "phax" | "run-family";
  /** The family test that proves the command with fakes. */
  readonly provedBy?: string;
  /** The command always prompts: refused with 64 under `--json`. */
  readonly refusedUnderJson?: ReadonlyArray<string>;
}

const withJson = (argv: ReadonlyArray<string>) => (json: boolean) =>
  json ? [...argv, "--json"] : argv;

const ROWS: ReadonlyArray<Row> = [
  { command: "validate", call: withJson(["validate"]) },
  { command: "ls", call: withJson(["ls"]) },
  { command: "artifact schema", call: withJson(["artifact", "schema", "spec"]) },
  { command: "plans lint", call: withJson(["plans", "lint", "plan.md"]) },
  {
    command: "run",
    through: "run-family",
    call: (json) => ["run", "--plan", "plan.md", "--dry-run", ...(json ? ["--json"] : [])],
  },
  {
    command: "resume",
    through: "run-family",
    call: (json) => ["resume", "RUN", ...(json ? ["--json"] : [])],
  },
  { command: "enter", refusedUnderJson: ["enter", "some-run"] },
  { command: "enter-phase", refusedUnderJson: ["enter-phase", "some-run"] },
  { command: "shell", refusedUnderJson: ["shell", "some-run"] },
  { command: "open", refusedUnderJson: ["open", "some-run"] },
  { command: "adjust-plan", refusedUnderJson: ["adjust-plan", "plan.md", "--landed", "x"] },
  { command: "review-code", refusedUnderJson: ["review-code", "some-run"] },
  { command: "unlock", provedBy: "tests/integration/lifecycleCommandsJson.test.ts" },
  { command: "session-info", provedBy: "tests/integration/inspectionCommandsJson.test.ts" },
  { command: "path", provedBy: "tests/integration/inspectionCommandsJson.test.ts" },
  { command: "archive", provedBy: "tests/integration/lifecycleCommandsJson.test.ts" },
  { command: "prune", provedBy: "tests/integration/lifecycleCommandsJson.test.ts" },
  { command: "cost backfill", provedBy: "tests/integration/groupCommandsJson.test.ts" },
  { command: "review-handoff", provedBy: "tests/integration/reviewCommandsJson.test.ts" },
  { command: "publish-pr", provedBy: "tests/integration/reviewCommandsJson.test.ts" },
  { command: "review-compliance", provedBy: "tests/integration/reviewCommandsJson.test.ts" },
  { command: "brief", provedBy: "tests/integration/inspectionCommandsJson.test.ts" },
  { command: "architecture", provedBy: "tests/integration/inspectionCommandsJson.test.ts" },
  { command: "init", provedBy: "tests/integration/lifecycleCommandsJson.test.ts" },
  { command: "report", provedBy: "tests/integration/inspectionCommandsJson.test.ts" },
  { command: "completions", provedBy: "tests/integration/inspectionCommandsJson.test.ts" },
  { command: "reset-phase", provedBy: "tests/integration/stoppedRunCommands.test.ts" },
  { command: "agent models", provedBy: "tests/integration/agentGroupJson.test.ts" },
  { command: "agent resolve", provedBy: "tests/integration/agentGroupJson.test.ts" },
  { command: "agent probe", provedBy: "tests/integration/agentGroupJson.test.ts" },
  { command: "agent setup mistral-vibe", provedBy: "tests/integration/agentGroupJson.test.ts" },
  { command: "agent setup providers", provedBy: "tests/integration/agentGroupJson.test.ts" },
  { command: "security status", provedBy: "tests/integration/groupCommandsJson.test.ts" },
  { command: "skills install", provedBy: "tests/integration/groupCommandsJson.test.ts" },
  { command: "schema upgrade", provedBy: "tests/integration/groupCommandsJson.test.ts" },
  { command: "artifact status", provedBy: "tests/integration/artifactStatusJson.test.ts" },
  { command: "artifact approve", provedBy: "tests/integration/artifactTransitionsJson.test.ts" },
  { command: "artifact stale", provedBy: "tests/integration/artifactTransitionsJson.test.ts" },
  { command: "artifact abandon", provedBy: "tests/integration/artifactTransitionsJson.test.ts" },
  { command: "artifact complete", provedBy: "tests/integration/artifactTransitionsJson.test.ts" },
  { command: "artifact reopen", provedBy: "tests/integration/artifactTransitionsJson.test.ts" },
  {
    command: "artifact decide",
    provedBy: "tests/integration/artifactDecideVerdictsCommand.test.ts",
  },
  {
    command: "artifact revise",
    provedBy: "tests/integration/artifactReviseCommand.test.ts",
  },
  {
    command: "artifact new spec",
    provedBy: "tests/integration/artifactNewHeadlessCommand.test.ts",
  },
  {
    command: "artifact new plan",
    provedBy: "tests/integration/artifactNewHeadlessCommand.test.ts",
  },
  {
    command: "artifact migrate-approvals",
    provedBy: "tests/integration/lifecycleCommandsJson.test.ts",
  },
  { command: "artifact migrate-documents", provedBy: "tests/integration/migrateDocuments.test.ts" },
  { command: "plans status", provedBy: "tests/integration/plansInspectionJson.test.ts" },
  { command: "plans overlap", provedBy: "tests/integration/plansOverlapCommand.test.ts" },
  { command: "plans overview", provedBy: "tests/integration/plansAnswersJson.test.ts" },
  { command: "plans estimate", provedBy: "tests/integration/plansEstimateCommand.test.ts" },
  { command: "records init", provedBy: "tests/integration/recordsJsonContracts.test.ts" },
  { command: "records sync", provedBy: "tests/integration/recordsJsonContracts.test.ts" },
  { command: "records status", provedBy: "tests/integration/recordsJsonContracts.test.ts" },
  { command: "records list", provedBy: "tests/integration/recordsJsonContracts.test.ts" },
  { command: "records explain", provedBy: "tests/integration/recordsJsonContracts.test.ts" },
];

describe("the every-command table", () => {
  const commands = usageCommands();

  it("has a row for each command of phax --usage, and none for a command it does not list", () => {
    const rowed = ROWS.map((row) => row.command);
    expect(commands.filter((command) => !rowed.includes(command))).toEqual([]);
    expect(rowed.filter((command) => !commands.includes(command))).toEqual([]);
    expect(new Set(rowed).size).toBe(rowed.length);
  });

  it("gives each row a call, a refusal or an existing family test", () => {
    for (const row of ROWS) {
      const proofs = [row.call, row.refusedUnderJson, row.provedBy].filter((p) => p !== undefined);
      expect(proofs, row.command).toHaveLength(1);
      if (row.provedBy !== undefined) {
        expect(existsSync(join(ROOT, row.provedBy)), `${row.command}: ${row.provedBy}`).toBe(true);
      }
    }
  });

  describe.each(ROWS.filter((row) => row.call !== undefined))("$command --json", (row) => {
    it("answers one value on stdout, indented by two spaces, and only message lines on stderr", async () => {
      const call = row.through === "run-family" ? callRunFamily : callPhax;
      const argv = (row.call as (json: boolean) => ReadonlyArray<string>)(true).map((word) =>
        word === "RUN" ? repo.runShortName : word,
      );
      const result = await call(argv);
      expect(result.out, `${row.command}: stderr ${result.err}`).not.toBe("");
      const value = JSON.parse(result.out) as unknown;
      expect(result.out).toBe(`${JSON.stringify(value, null, 2)}\n`);
      if (typeof value === "object" && value !== null && "$schema" in value) {
        expect(Object.keys(value)[0]).toBe("$schema");
      }
      for (const line of result.err.split("\n").filter((each) => each !== "")) {
        const message = JSON.parse(line) as { kind?: string };
        expect(MESSAGE_KINDS).toContain(message.kind);
      }
    });
  });

  describe.each(ROWS.filter((row) => row.refusedUnderJson !== undefined))(
    "$command --json",
    (row) => {
      // ac-no-person
      it("is refused with 64 before anything starts", async () => {
        const result = await callPhax([
          ...(row.refusedUnderJson as ReadonlyArray<string>),
          "--json",
        ]);
        expect(result.code).toBe(64);
        expect(result.out).toBe("");
        const lines = result.err.split("\n").filter((each) => each !== "");
        expect(lines).toHaveLength(1);
        expect((JSON.parse(lines[0] as string) as { kind: string }).kind).toBe("refused");
      });
    },
  );
});

describe("the catalogue of phax --json-schema", () => {
  // ac-catalogue
  it("lists exactly the commands of phax.usage.kdl, each equal to its own --json-schema", async () => {
    const whole = await callPhax(["--json-schema"]);
    expect(whole.code).toBe(0);
    const catalogue = JSON.parse(whole.out) as {
      program: string;
      version: string;
      exits: Record<string, number>;
      commands: ReadonlyArray<{ name: ReadonlyArray<string> }>;
      messages: Record<string, unknown>;
    };
    expect(catalogue.program).toBe("phax");
    expect(catalogue.version).toBe(PHAX_RELEASE);
    expect(catalogue.exits).toMatchObject({ refused: 64, defect: 70 });
    expect(Object.keys(catalogue.messages).toSorted()).toEqual([...MESSAGE_KINDS].toSorted());
    expect(catalogue.commands.map((entry) => entry.name.join(" ")).toSorted()).toEqual(
      [...usageCommands()].toSorted(),
    );
    for (const entry of catalogue.commands) {
      const own = await callPhax([...entry.name, "--json-schema"]);
      expect(own.code, entry.name.join(" ")).toBe(0);
      expect(JSON.parse(own.out), entry.name.join(" ")).toEqual(entry);
    }
  });
});
