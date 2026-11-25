/**
 * `phax resume` gates with the profile the run recorded (spec §5.10, §5.11).
 *
 * A made-up three-phase plan runs through the real `phax run --hold phase-02`
 * in a temporary git repository with its own state root: real config loading,
 * extraction, git, shell and run loop. Only the HOME-derived loaders and the
 * provider backend are replaced, and the PHAX home is a temporary directory.
 *
 * phax.json lists `light` first, whose step appends the phase it gates to a
 * marker file outside the repository, and `standard` second, whose step always
 * fails. The run records `light` and stops awaiting review at phase-02; phax.json
 * is then rewritten, and `phax resume --yes` either keeps `light` or refuses.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

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

// light appends the phase's folder name to the marker; standard always fails.
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

/** The fixture plan.md with its `## Gate profile` declaring light in place of standard. */
function withGateProfile(planMd: string): string {
  const declared = planMd.replace(
    "## Gate profile\n\n`standard`\n",
    "## Gate profile\n\n`light`\n",
  );
  if (declared === planMd) throw new Error("the fixture plan.md declares no standard profile");
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

interface HeldAtPhase02 {
  readonly r: PreflightRepo;
  readonly marker: string;
  readonly runKey: string;
  readonly runPath: string;
  /** phase-02's gate attempt logs when the run stopped. */
  readonly logsAtHold: Readonly<Record<string, string>>;
}

/** `phax run --hold phase-02` of the three-phase plan, stopped awaiting review at phase-02. */
async function heldAtPhase02(): Promise<HeldAtPhase02> {
  const r = createPreflightRepo({
    plan: { phases: [{}, {}, {}] },
    files: {
      ".gitignore": ".phax-context/\n",
      "scripts/light-gate.mjs": LIGHT_SCRIPT,
      "scripts/fail-gate.mjs": FAIL_SCRIPT,
    },
  });
  roots = r;
  const marker = join(r.stateRoot, "light-gate-marker");
  writeFileSync(join(r.repo, "phax.json"), phaxJson(r, marker, ["light", "standard"]));
  const planPath = join(r.repo, "plan.md");
  writeFileSync(planPath, withGateProfile(readFileSync(planPath, "utf8")));
  git(["commit", "-q", "-am", "chore: gate profiles"], r.repo);
  process.chdir(r.repo);

  const run = await phaxCall(["run", "--plan", "plan.md", "--hold=phase-02"]);
  expect({ code: run.code, err: run.err }).toEqual({ code: 13, err: "" });
  const runKey = `${r.namespace}.foo`;
  const runPath = join(r.stateRoot, "runs", runKey);
  expect(readJson(join(runPath, "run-status.json"))).toMatchObject({ gateProfileId: "light" });
  // The held phase stops after its own gate ran: light gated phase-01 and phase-02.
  expect(readFileSync(marker, "utf8")).toBe("phase-01\nphase-02\n");
  return { r, marker, runKey, runPath, logsAtHold: phase02GateLogs(runPath) };
}

/**
 * phase-02's gate attempt logs, by path under its folder: the agent's attempts
 * and those of the held close, which resume runs in `review-gate/`.
 */
function phase02GateLogs(runPath: string): Readonly<Record<string, string>> {
  const logs: Record<string, string> = {};
  for (const sub of ["", "review-gate"]) {
    const folder = join(runPath, "phase-02", sub);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) {
      if (!/^checks-attempt-\d+\.log$/.test(name)) continue;
      logs[join(sub, name)] = readFileSync(join(folder, name), "utf8");
    }
  }
  return logs;
}

/** The gate attempt logs phase-02 gained since the hold. */
function newPhase02GateLogs(held: HeldAtPhase02): readonly string[] {
  return Object.entries(phase02GateLogs(held.runPath))
    .filter(([name]) => !(name in held.logsAtHold))
    .map(([, log]) => log);
}

describe("phax resume gates with the recorded gate profile", { timeout: 120_000 }, () => {
  it("keeps light after phax.json is reordered to list standard first", async () => {
    const held = await heldAtPhase02();
    const { r, marker } = held;
    writeFileSync(join(r.repo, "phax.json"), phaxJson(r, marker, ["standard", "light"]));

    const resumed = await phaxCall(["resume", "foo", "--yes"]);

    expect(resumed.err).not.toContain("gate profile");
    expect(readFileSync(marker, "utf8")).toMatch(/^phase-01\nphase-02\nphase-02\n/);
    const closing = newPhase02GateLogs(held);
    expect(closing).toHaveLength(1);
    expect(closing[0]).toContain("light-gate.mjs");
    expect(closing[0]).not.toContain("fail-gate.mjs");
  });

  it("refuses a recorded light that phax.json no longer defines, before phase-02's gate", async () => {
    const held = await heldAtPhase02();
    const { r, marker, runKey, runPath } = held;
    writeFileSync(join(r.repo, "phax.json"), phaxJson(r, marker, ["standard"]));
    const statusBefore = readFileSync(join(runPath, "run-status.json"), "utf8");

    const resumed = await phaxCall(["resume", "foo", "--yes"]);

    expect(resumed.code).toBe(2);
    expect(resumed.err).toBe(
      [
        'gate profile "light" is not defined in phax.json (defined: standard)',
        `  the run recorded it when it started; restore it in phax.json, or archive the run with \`phax archive ${runKey} --force\``,
        "",
      ].join("\n"),
    );
    expect(readFileSync(marker, "utf8")).toBe("phase-01\nphase-02\n");
    expect(newPhase02GateLogs(held)).toEqual([]);
    expect(readFileSync(join(runPath, "run-status.json"), "utf8")).toBe(statusBefore);
  });

  it("refuses a run that recorded no gate profile with the archive remedy", async () => {
    const held = await heldAtPhase02();
    const { r, marker, runKey, runPath } = held;
    const statusPath = join(runPath, "run-status.json");
    const status = readJson(statusPath);
    if (typeof status !== "object" || status === null) throw new Error("run-status.json");
    const withoutProfile = Object.entries(status).filter(([key]) => key !== "gateProfileId");
    expect(withoutProfile).toHaveLength(Object.keys(status).length - 1);
    writeFileSync(statusPath, JSON.stringify(Object.fromEntries(withoutProfile), null, 2));

    const resumed = await phaxCall(["resume", "foo", "--yes"]);

    expect(resumed.code).toBe(2);
    expect(resumed.err).toBe(
      `the run recorded no gate profile — an older phax started it. Finish it with the phax release that started it, or archive it with \`phax archive ${runKey} --force\` and run its plan again.\n`,
    );
    expect(readFileSync(marker, "utf8")).toBe("phase-01\nphase-02\n");
    expect(newPhase02GateLogs(held)).toEqual([]);
    expect(existsSync(join(r.stateRoot, "runs", runKey))).toBe(true);
    expect(snapshotRepo(r).runs).toEqual([runKey]);
  });
});
