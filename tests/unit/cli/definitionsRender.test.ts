// The four command definitions on the runner: each render gives today's text from its document
// alone, and through the runner a declared failure keeps today's sentence and code, a note is
// today's line without --json and a note line with it, and `ls --complete` writes its
// completion lines and nothing else. The use cases are mocked; the runner runs over memory.
import { Effect, Result } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runner } from "../../../src/cli/commandLibrary/commander/index.js";
import type { Io } from "../../../src/cli/commandLibrary/contract/index.js";
import { renderArtifactStatus } from "../../../src/cli/definitions/artifactStatus.js";
import { renderRunList } from "../../../src/cli/definitions/ls.js";
import { phaxProgram as guardedProgram } from "../../../src/cli/definitions/program.js";
import { withoutGuard } from "../../helpers/runnerCall.js";

// The phase guard reads the process's cwd, which may be a phase worktree: proved on its own.
const phaxProgram = withoutGuard(guardedProgram);
import { ConfigValidationError } from "../../../src/domain/errors.js";
import type { PlanOverview } from "../../../src/domain/plan/overview.js";
import type { ArtifactStatusFile } from "../../../src/schemas/artifactStatusDocument.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";
import type { RegistryEntry } from "../../../src/schemas/registry.js";
import type { RunListFile, RunListRow } from "../../../src/schemas/runList.js";

vi.mock("../../../src/app/loadConfig.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/loadConfig.js")>()),
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/registry.js", () => ({
  readRegistry: vi.fn(),
}));

vi.mock("../../../src/app/resolveRunInfo.js", () => ({
  resolveRun: vi.fn(() => Result.fail("not found")),
  findCurrentPhase: vi.fn(() => undefined),
  readPullRequestUrl: vi.fn(() => undefined),
}));

vi.mock("../../../src/app/lintPlan.js", () => ({
  lintPlan: vi.fn(),
}));

vi.mock("../../../src/app/planOverview.js", () => ({
  planOverview: vi.fn(),
}));

vi.mock("../../../src/app/artifactStatus.js", () => ({
  inspectArtifact: vi.fn(),
}));

// ── Renders ─────────────────────────────────────────────────────────────────────

function row(overrides: Partial<RunListRow> = {}): RunListRow {
  return {
    qualifiedName: "acme.alpha",
    namespace: "acme",
    shortName: "alpha",
    state: "review_open",
    branch: "phax/alpha",
    currentPhase: "3/3",
    gateProfile: "fast",
    updatedAt: "2026-11-01 10:00",
    lockState: "none",
    recordsPending: null,
    archivePath: null,
    stop: null,
    pullRequest: null,
    ...overrides,
  };
}

const list = (runs: ReadonlyArray<RunListRow>): RunListFile => ({
  $schema: currentSchemaUrl("run-list"),
  runs,
});

/** A review stop as the table reads it: its cause and its phase's id. */
const stopAt = (cause: "declared" | "held", phase: string): RunListRow["stop"] =>
  ({ cause, phase: { id: phase } }) as unknown as RunListRow["stop"];

describe("renderRunList", () => {
  it("says (no runs) for an empty list", () => {
    expect(renderRunList(list([]))).toBe("(no runs)");
  });

  it("writes today's table, unknown values as -, and no RECORDS column without a count", () => {
    const text = renderRunList(
      list([
        row(),
        row({
          qualifiedName: "other.beta",
          shortName: "beta",
          currentPhase: null,
          gateProfile: null,
        }),
      ]),
    );
    expect(text.split("\n")).toEqual([
      "NAME        STATE        BRANCH      PHASE  PROFILE  UPDATED           LOCK",
      "----------  -----------  ----------  -----  -------  ----------------  ----",
      "acme.alpha  review_open  phax/alpha  3/3    fast     2026-11-01 10:00  none",
      "other.beta  review_open  phax/alpha  -      -        2026-11-01 10:00  none",
    ]);
  });

  it("adds the RECORDS column when a row carries a count, - for a row without", () => {
    const lines = renderRunList(
      list([
        row({ recordsPending: 2 }),
        row({ qualifiedName: "other.beta", recordsPending: null }),
      ]),
    ).split("\n");
    expect(lines[0]?.endsWith("  RECORDS")).toBe(true);
    expect(lines[2]?.endsWith("  2      ")).toBe(true);
    expect(lines[3]?.endsWith("  -      ")).toBe(true);
  });

  it("labels a run waiting at a stop with its cause and its stopped phase", () => {
    const lines = renderRunList(
      list([
        row({ state: "awaiting_review", currentPhase: "2/3", stop: stopAt("held", "phase-02") }),
      ]),
    ).split("\n");
    expect(lines[2]).toContain("awaiting_review (held)");
    expect(lines[2]).toContain("2/3 phase-02");
  });
});

function status(overrides: Partial<ArtifactStatusFile> = {}): ArtifactStatusFile {
  return {
    $schema: currentSchemaUrl("artifact-status"),
    path: "docs/specs/2611011200-garden-sync.md",
    kind: "spec",
    status: "Draft",
    legalTransitions: ["Approved", "Abandoned"],
    approval: { kind: "none" },
    authoring: { kind: "interactive" },
    questions: { kind: "none" },
    ...overrides,
  };
}

describe("renderArtifactStatus", () => {
  it("writes today's lines for a headless spec with an open question", () => {
    const text = renderArtifactStatus(
      status({
        authoring: {
          kind: "headless",
          sidecar: "docs/specs/2611011200-garden-sync.json",
          agreement: "in-sync",
        },
        questions: { kind: "parsed", open: ["q-cadence"], arbitrated: ["q-store"], lifted: [] },
      }),
    );
    expect(text.split("\n")).toEqual([
      "Path:              docs/specs/2611011200-garden-sync.md",
      "Kind:              spec",
      "Status:            Draft",
      "Authored:          headless — sidecar docs/specs/2611011200-garden-sync.json (in sync)",
      "Questions:         2 — open 1 (q-cadence) · arbitrated 1 (0 lifted)",
      "  decide with `phax artifact decide docs/specs/2611011200-garden-sync.md`",
      "Legal transitions: Approved (once no question is open), Abandoned",
    ]);
  });

  it("writes a recorded approval with its approver, and a terminal status", () => {
    const lines = renderArtifactStatus(
      status({
        status: "Completed",
        legalTransitions: [],
        approval: {
          kind: "recorded",
          date: "2026-11-02",
          baseline: "0123456",
          approver: { kind: "operator", name: "Ada Example" },
          editedSinceApproval: true,
        },
      }),
    ).split("\n");
    expect(lines).toContain("Approved:          2026-11-02 @ 0123456 by operator (Ada Example)");
    expect(lines).toContain("Edited since:      yes");
    expect(lines.at(-1)).toBe("Legal transitions: (none — terminal)");
  });

  it("names an unrecorded approval, a stamped sidecar and a departing §9", () => {
    const lines = renderArtifactStatus(
      status({
        approval: { kind: "unrecorded" },
        authoring: {
          kind: "headless",
          sidecar: "docs/specs/x.json",
          agreement: { kind: "stamped", format: "spec-document", shape: "pre-schema" },
        },
        questions: { kind: "departs", line: 12, text: "**Q1**" },
      }),
    );
    expect(lines).toContain(
      "Authored:          headless — sidecar docs/specs/x.json (spec-document written before $schema — migrate with `phax artifact migrate-documents`)",
    );
    expect(lines).toContain(
      "Questions:         does not parse — line 12 departs from the §9 format: **Q1**",
    );
    expect(lines).toContain(
      "Approved:          (unrecorded — run phax artifact approve to record)",
    );
    expect(lines).toContain(
      "Legal transitions: Approved (once §9 parses and no question is open), Abandoned",
    );
  });
});

// ── Through the runner ──────────────────────────────────────────────────────────

interface Called {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function call(argv: ReadonlyArray<string>): Promise<Called> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    argv,
    stdin: Effect.succeed(""),
    stdinIsTerminal: false,
    readFile: () => Effect.fail("no file"),
    writeFile: () => Effect.fail("no write"),
    env: {},
    terminal: { columns: 80, color: false },
    out: (text) => Effect.sync(() => void out.push(text)),
    err: (text) => Effect.sync(() => void err.push(text)),
  };
  const code = await Effect.runPromise(runner.run(phaxProgram, io));
  return { code, out: out.join(""), err: err.join("") };
}

const errLines = (err: string): ReadonlyArray<Record<string, unknown>> =>
  err
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const CONFIG = {
  namespace: "acme",
  stateRoot: "/fake-state",
  repoRoot: process.cwd(),
  records: { enabled: false },
} as unknown as ResolvedConfig;

async function configIs(config: Result.Result<ResolvedConfig, ConfigValidationError>) {
  const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
  loadConfig.mockReturnValue(config);
}

function entry(shortName: string, state: RegistryEntry["state"]): RegistryEntry {
  return {
    namespace: "acme",
    shortName,
    runId: `run-${shortName}`,
    state,
    branch: `phax/${shortName}`,
    projectName: "acme",
    phasesCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T12:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("phax ls --complete", () => {
  it("writes one short-name:state line per run and nothing else, with and without --json", async () => {
    await configIs(Result.succeed(CONFIG));
    const { readRegistry } = vi.mocked(await import("../../../src/app/registry.js"));
    readRegistry.mockReturnValue(
      Effect.succeed({ runs: [entry("alpha", "review_open"), entry("beta", "failed")] }) as never,
    );

    for (const argv of [
      ["ls", "--complete"],
      ["ls", "--complete", "--json"],
    ]) {
      const called = await call(argv);
      expect(called).toEqual({ code: 0, out: "alpha:review_open\nbeta:failed\n", err: "" });
    }
  });
});

describe("a declared failure", () => {
  it("writes today's sentence and code without --json, and one error line with it", async () => {
    await configIs(Result.fail(new ConfigValidationError({ message: "bad phax.json" })));

    for (const [argv, code] of [
      [["plans", "lint", "plan.md"], 2],
      [["plans", "overview", "plan.md"], 2],
      [["ls"], 1],
    ] as const) {
      const text = await call(argv);
      expect(text).toEqual({ code, out: "", err: "Config error: bad phax.json\n" });
      const json = await call([...argv, "--json"]);
      expect(json.code).toBe(code);
      expect(json.out).toBe("");
      expect(errLines(json.err)).toEqual([
        {
          kind: "error",
          error: "ConfigValidationError",
          exit: code,
          fields: { message: "bad phax.json" },
          written: [],
        },
      ]);
    }
  });

  it("keeps the overview's one line for a plan it cannot lay out, exit 1", async () => {
    await configIs(Result.succeed(CONFIG));
    const { planOverview } = vi.mocked(await import("../../../src/app/planOverview.js"));
    const line = "plan.md: the plan does not parse — run phax plans lint plan.md";
    planOverview.mockReturnValue(Effect.fail({ kind: "unparsable", line }) as never);

    expect(await call(["plans", "overview", "plan.md"])).toEqual({
      code: 1,
      out: "",
      err: `${line}\n`,
    });
  });
});

describe("plans lint's verdict", () => {
  it("exits 1 when a finding is an error, in both modes, and 0 on warnings alone", async () => {
    await configIs(Result.succeed(CONFIG));
    const { lintPlan } = vi.mocked(await import("../../../src/app/lintPlan.js"));
    const finding = { check: "models", phase: "phase-01", message: "nope" } as const;
    lintPlan.mockReturnValue(
      Effect.succeed({ plan: "plan.md", findings: [{ severity: "error", ...finding }] }),
    );
    expect((await call(["plans", "lint", "plan.md"])).code).toBe(1);
    expect((await call(["plans", "lint", "plan.md", "--json"])).code).toBe(1);

    lintPlan.mockReturnValue(
      Effect.succeed({ plan: "plan.md", findings: [{ severity: "warning", ...finding }] }),
    );
    expect((await call(["plans", "lint", "plan.md"])).code).toBe(0);
  });
});

describe("the notes", () => {
  it("writes the overview's architecture failure as today's line, and as a note under --json", async () => {
    await configIs(Result.succeed(CONFIG));
    const overview: PlanOverview = {
      plan: "plan.md",
      name: "widget",
      title: "Made-up widget",
      frontmatter: { kind: "decoded", status: "Draft" },
      sourceSpec: null,
      architecture: { kind: "failed", message: "boom" },
      phases: [],
      coverage: { kind: "no-source-spec" },
    };
    const { planOverview } = vi.mocked(await import("../../../src/app/planOverview.js"));
    planOverview.mockReturnValue(Effect.succeed(overview));

    const text = await call(["plans", "overview", "plan.md"]);
    expect(text.code).toBe(0);
    expect(text.err).toBe("Warning: architecture provider failed: boom\n");
    const json = await call(["plans", "overview", "plan.md", "--json"]);
    expect(errLines(json.err)).toEqual([
      { kind: "note", text: "Warning: architecture provider failed: boom" },
    ]);
  });

  it("writes artifact status's orphan records as today's warnings, and as notes under --json", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.succeed({
        kind: "spec",
        status: "Draft",
        legalTargets: ["Approved", "Abandoned"],
        approval: { kind: "none" },
        authoring: { kind: "interactive" },
        questions: { kind: "none" },
        orphanRecords: [
          {
            recordFile: "docs/specs/approvals/2601010000-gone.json",
            artifact: "docs/specs/2601010000-gone.md",
          },
        ],
      }),
    );
    const warning =
      "warning: orphan approval record docs/specs/approvals/2601010000-gone.json — docs/specs/2601010000-gone.md does not exist; delete the record file";

    const text = await call(["artifact", "status", "docs/specs/2611011200-garden-sync.md"]);
    expect(text.code).toBe(0);
    expect(text.err).toBe(`${warning}\n`);
    expect(text.out.startsWith("Path:              docs/specs/2611011200-garden-sync.md\n")).toBe(
      true,
    );
    const json = await call([
      "artifact",
      "status",
      "docs/specs/2611011200-garden-sync.md",
      "--json",
    ]);
    expect(errLines(json.err)).toEqual([{ kind: "note", text: warning }]);
    expect(JSON.parse(json.out)).toMatchObject({
      $schema: currentSchemaUrl("artifact-status"),
      path: "docs/specs/2611011200-garden-sync.md",
    });
  });
});
