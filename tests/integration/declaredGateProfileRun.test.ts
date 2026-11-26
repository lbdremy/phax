/**
 * `phax run` and its dry run gate with the plan's declared gate profile, whatever
 * its position in phax.json, and refuse an undefined one before any state exists
 * (spec §5.5 to §5.7, §5.12).
 *
 * A made-up plan under docs/plans/ is approved with `phax artifact approve --by
 * operator` and run through the real `phax run` in a temporary git repository
 * with its own state root: real config loading, extraction, approval and
 * staleness gates, git, shell and run loop. Only the HOME-derived loaders and
 * the provider backend are replaced, and the PHAX home is a temporary directory.
 *
 * phax.json lists `standard` first, whose step always fails, and `light` second,
 * whose step appends the phase it gates to a marker file outside the repository.
 * A run gated by `standard` could not pass a phase.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Effect, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeClaudeSessionId } from "../../src/domain/branded.js";
import { AgentInvocationError } from "../../src/domain/errors.js";
import type { AgentRunOptions, BackendOps } from "../../src/ports/backend.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { phaxCall } from "../helpers/runnerCall.js";
import {
  createPreflightRepo,
  git,
  type PreflightRepo,
  removePreflightRepo,
  snapshotRepo,
} from "./helpers/preflightRepo.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);
vi.mock("../../src/app/loadTelemetryConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadTelemetryConfig.js")>();
  const effect = await import("effect");
  return { ...actual, loadTelemetryConfig: vi.fn(() => effect.Result.succeed({ enabled: false })) };
});
// The routing loaders read ~/.phax; serve the built-in defaults instead.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const effect = await import("effect");
  const defaults = await import("../../src/domain/routing/defaults.js");
  return {
    ...actual,
    loadModelRouting: vi.fn(() => effect.Effect.succeed(defaults.DEFAULT_MODEL_ROUTING)),
    loadProviderConfig: vi.fn(() => effect.Effect.succeed(defaults.DEFAULT_PROVIDER_CONFIG)),
  };
});
// No test may reach a real provider CLI: every session is played by `builderBackend`.
vi.mock("../../src/infra/providers/dispatcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/infra/providers/dispatcher.js")>();
  const effect = await import("effect");
  const { Backend } = await import("../../src/ports/backend.js");
  return {
    ...actual,
    makeNodeBackendLayer: vi.fn(() => effect.Layer.succeed(Backend, builderBackend())),
  };
});

const HANDOFF = [
  "## What was delivered",
  "- The step.",
  "## Key decisions and why",
  "- None.",
  "## Exact locations (file paths and exported names)",
  "- src/",
  "## What the next phase needs to know",
  "- Nothing.",
  "",
].join("\n");

const phaseOf = (options: AgentRunOptions): string =>
  basename(options.phaseFolderPath ?? options.cwd);

/** A headless run writes its phase's planned file; a resume writes the phase's handoff. */
function builderBackend(): BackendOps {
  const unused = () => Effect.fail(new AgentInvocationError({ message: "not played here" }));
  return {
    runAgent: (_prompt, options) =>
      Effect.sync(() => {
        const n = phaseOf(options).slice("phase-".length);
        mkdirSync(join(options.cwd, "src"), { recursive: true });
        writeFileSync(join(options.cwd, "src", `step-${n}.ts`), `export const step = ${n};\n`);
        return {
          sessionId: Result.getOrThrow(decodeClaudeSessionId(`S-${n}`)),
          outputPath: "",
          finalText: "",
          structured: null,
        };
      }),
    resumeAgentSession: (sessionId, _prompt, options) =>
      Effect.sync(() => {
        writeFileSync(join(options.cwd, ".phax-context", "phase-handoff.md"), HANDOFF);
        return { sessionId, outputPath: "", finalText: "", structured: null };
      }),
    complete: unused,
    probe: unused,
    captureTranscript: () =>
      Effect.succeed({ status: "missing", reason: "not-found", detail: "not played here" }),
  };
}

// light appends the phase's folder name to the marker; standard always fails. A step's
// command is split on whitespace, never by a shell, so each is a script of the repository.
const LIGHT_SCRIPT =
  "import { appendFileSync } from 'node:fs';\n" +
  "import { basename } from 'node:path';\n" +
  "appendFileSync(process.argv[2], basename(process.cwd()) + '\\n');\n";
const FAIL_SCRIPT = "process.exit(1);\n";

type Profile = "light" | "standard";

function phaxJson(r: PreflightRepo, marker: string, profiles: readonly Profile[]): string {
  const steps: Record<Profile, readonly object[]> = {
    light: [
      {
        command: `node scripts/light-gate.mjs ${marker}`,
        surface: "local",
        firing: "every-phase",
      },
    ],
    standard: [{ command: "node scripts/fail-gate.mjs", surface: "local", firing: "every-phase" }],
  };
  return (
    JSON.stringify(
      {
        version: 1,
        name: r.namespace,
        state: { root: r.stateRoot },
        gateProfiles: Object.fromEntries(profiles.map((id) => [id, steps[id]])),
        publish: { auto: false },
        review: { compliance: { enabled: false } },
      },
      null,
      2,
    ) + "\n"
  );
}

const PLAN = "docs/plans/2611251300-foo-plan.md";

/** The fixture plan.md as a Draft artifact plan declaring `profile`. */
function artifactPlan(planMd: string, profile: Profile): string {
  const declared = planMd
    .replace("status: Approved\n", "status: Draft\n")
    .replace("## Gate profile\n\n`standard`\n", `## Gate profile\n\n\`${profile}\`\n`);
  if (!declared.includes("status: Draft\n") || !declared.includes(`\`${profile}\``)) {
    throw new Error("the fixture plan.md is not the shape this test rewrites");
  }
  return declared;
}

let phaxHome: ReturnType<typeof isolatePhaxHome>;
let roots: PreflightRepo | undefined;
let origCwd: string;

beforeEach(() => {
  phaxHome = isolatePhaxHome();
  origCwd = process.cwd();
});

afterEach(() => {
  process.chdir(origCwd);
  removePreflightRepo(roots);
  roots = undefined;
  phaxHome.restore();
});

interface Project {
  readonly r: PreflightRepo;
  readonly marker: string;
  readonly runKey: string;
  readonly runPath: string;
}

/**
 * A repository whose phax.json defines `profiles` in that order, holding the
 * two-phase plan at PLAN declaring `declared`, approved by the operator.
 */
async function approvedProject(profiles: readonly Profile[], declared: Profile): Promise<Project> {
  const r = createPreflightRepo({
    plan: { phases: [{}, {}] },
    files: {
      ".gitignore": ".phax-context/\n",
      "scripts/light-gate.mjs": LIGHT_SCRIPT,
      "scripts/fail-gate.mjs": FAIL_SCRIPT,
    },
  });
  roots = r;
  const marker = join(r.stateRoot, "light-gate-marker");
  writeFileSync(join(r.repo, "phax.json"), phaxJson(r, marker, profiles));
  mkdirSync(join(r.repo, "docs", "plans"), { recursive: true });
  writeFileSync(
    join(r.repo, PLAN),
    artifactPlan(readFileSync(join(r.repo, "plan.md"), "utf8"), declared),
  );
  git(["add", "-A"], r.repo);
  git(["commit", "-q", "-m", "chore: gate profiles and the plan"], r.repo);
  process.chdir(r.repo);

  const approved = await phaxCall(["artifact", "approve", PLAN, "--by", "operator"]);
  expect({ code: approved.code, err: approved.err }).toEqual({ code: 0, err: "" });
  expect(git(["status", "--porcelain"], r.repo)).toBe("");
  const runKey = `${r.namespace}.foo`;
  return { r, marker, runKey, runPath: join(r.stateRoot, "runs", runKey) };
}

/** Every gate attempt log of a phase folder, in name order. */
function gateLogs(phaseFolder: string): readonly string[] {
  if (!existsSync(phaseFolder)) return [];
  return readdirSync(phaseFolder)
    .filter((name) => /^checks-attempt-\d+\.log$/.test(name))
    .toSorted()
    .map((name) => readFileSync(join(phaseFolder, name), "utf8"));
}

describe("phax run gates with the plan's declared gate profile", { timeout: 120_000 }, () => {
  // ac-second-profile
  it("gates every phase with light although standard is listed first, and records light", async () => {
    const { marker, runPath } = await approvedProject(["standard", "light"], "light");

    const run = await phaxCall(["run", "--plan", PLAN]);

    expect(run.code).toBe(0);
    expect(run.err).toContain("The run reached review — 2 phase(s) complete.");
    // light's step gated each phase; standard's always-failing step never ran.
    expect(readFileSync(marker, "utf8")).toBe("phase-01\nphase-02\n");
    for (const phase of ["phase-01", "phase-02"]) {
      const logs = gateLogs(join(runPath, phase));
      expect(logs.length, phase).toBeGreaterThan(0);
      for (const log of logs) {
        expect(log).toContain("light-gate.mjs");
        expect(log).not.toContain("fail-gate.mjs");
      }
    }
    const status: unknown = JSON.parse(readFileSync(join(runPath, "run-status.json"), "utf8"));
    expect(status).toMatchObject({ gateProfileId: "light" });
    expect(readFileSync(join(runPath, "review-handoff.md"), "utf8")).toContain(
      "- **Gate Profile**: light\n",
    );
  });

  // ac-dry-run
  it("dry run names light while phax.json lists standard first", async () => {
    const { r, marker } = await approvedProject(["standard", "light"], "light");
    const before = snapshotRepo(r);

    const dry = await phaxCall(["run", "--plan", PLAN, "--dry-run"]);

    expect({ code: dry.code, err: dry.err }).toEqual({ code: 0, err: "" });
    expect(dry.out).toContain("  Gate profile: light\n");
    expect(dry.out).toContain(`node scripts/light-gate.mjs ${marker}`);
    expect(dry.out).not.toContain("fail-gate.mjs");
    expect(snapshotRepo(r)).toEqual(before);
  });

  // ac-preflight
  it("refuses light when only standard is defined, before any worktree, branch or run folder", async () => {
    const { r, marker, runKey, runPath } = await approvedProject(["standard"], "light");
    const before = snapshotRepo(r);

    for (const args of [
      ["run", "--plan", PLAN],
      ["run", "--plan", PLAN, "--dry-run"],
    ]) {
      const refused = await phaxCall(args);

      expect(refused.code, args.join(" ")).toBe(2);
      expect(refused.out).toBe("");
      expect(refused.err).toBe(
        [
          'gate profile "light" is not defined in phax.json (defined: standard)',
          "  the plan declares it under ## Gate profile; no worktree was created",
          "",
        ].join("\n"),
      );
    }
    expect(existsSync(join(r.stateRoot, "worktrees", runKey))).toBe(false);
    expect(existsSync(runPath)).toBe(false);
    expect(git(["branch", "--list", "phax/*"], r.repo)).toBe("");
    expect(existsSync(marker)).toBe(false);
    expect(snapshotRepo(r)).toEqual(before);
  });

  // ac-approval
  it("an edited declaration reads as edited since approval and is refused, then runs under light once approved", async () => {
    const { r } = await approvedProject(["standard", "light"], "standard");
    const planPath = join(r.repo, PLAN);
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf8").replace(
        "## Gate profile\n\n`standard`\n",
        "## Gate profile\n\n`light`\n",
      ),
    );
    git(["commit", "-q", "-am", "docs: declare light"], r.repo);

    const status = await phaxCall(["artifact", "status", PLAN]);
    expect(status.code).toBe(0);
    expect(status.out).toContain("Status:            Approved\n");
    expect(status.out).toContain("Edited since:      yes\n");

    const refused = await phaxCall(["run", "--plan", PLAN]);
    expect(refused.code).not.toBe(0);
    expect(refused.err).toBe(
      `${PLAN} is stale (self-changed: the plan itself changed since approval) — re-approve with "phax artifact approve ${PLAN}"\n`,
    );
    expect(snapshotRepo(r).runs).toEqual([]);

    const approved = await phaxCall(["artifact", "approve", PLAN, "--by", "operator"]);
    expect({ code: approved.code, err: approved.err }).toEqual({ code: 0, err: "" });

    const dry = await phaxCall(["run", "--plan", PLAN, "--dry-run"]);
    expect({ code: dry.code, err: dry.err }).toEqual({ code: 0, err: "" });
    expect(dry.out).toContain("  Gate profile: light\n");
  });
});
