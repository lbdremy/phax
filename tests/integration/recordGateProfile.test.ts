/**
 * Every phase record names the gate profile its run was gated by (q-records),
 * and `phax records explain` shows it.
 *
 * A made-up three-phase plan runs through the real `phax run --hold phase-02`
 * in a temporary git repository with its own state root and records on
 * `phax/records/v1` in the repository: real config loading, extraction, git,
 * shell, run loop and record writer. Only the HOME-derived loaders and the
 * provider backend are replaced, and the PHAX home is a temporary directory.
 *
 * phax.json lists `light` first and `standard` second, and the plan declares
 * `light`, so the run records `light` whichever of the two it reads; the
 * records are compared with run-status.json's `gateProfileId`, never with the
 * declaration. phase-01 is recorded by `phax run`, phase-02 and phase-03 by
 * `phax resume`. A record of the frozen 0.34.0 shape, written by hand beside
 * them, reads as not recorded.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Effect, Result, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeBranchName, decodeClaudeSessionId } from "../../src/domain/branded.js";
import { AgentInvocationError } from "../../src/domain/errors.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import type { AgentRunOptions, BackendOps } from "../../src/ports/backend.js";
import { Git } from "../../src/ports/git.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { phaxCall } from "../helpers/runnerCall.js";
import {
  createPreflightRepo,
  git,
  type PreflightRepo,
  removePreflightRepo,
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

const RECORDS_BRANCH = "phax/records/v1";

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
type Json = typeof JsonObject.Type;
const jsonObject = (text: string): Json => Schema.decodeUnknownSync(JsonObject)(JSON.parse(text));

const readJson = (path: string): Json => jsonObject(readFileSync(path, "utf8"));

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

function phaxJson(r: PreflightRepo): string {
  const pass = [{ command: "node -e 0", surface: "local", firing: "every-phase" }];
  return (
    JSON.stringify(
      {
        version: 1,
        name: r.namespace,
        state: { root: r.stateRoot },
        gateProfiles: { light: pass, standard: pass },
        publish: { auto: false },
        review: { compliance: { enabled: false } },
        records: { transcript: false, destination: { kind: "in-repo" }, autoPush: false },
      },
      null,
      2,
    ) + "\n"
  );
}

/** The fixture plan.md with `## Gate profile` declaring light, before `## Required commands`. */
function withGateProfile(planMd: string): string {
  return planMd.replace(
    "## Required commands\n",
    "## Gate profile\n\n`light`\n\n## Required commands\n",
  );
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

interface FinishedRun {
  readonly r: PreflightRepo;
  readonly runPath: string;
  readonly runId: string;
  /** The run's recorded gate profile, as run-status.json holds it. */
  readonly gateProfileId: unknown;
}

/** `phax run --hold phase-02` of the three-phase plan, then `phax resume --yes` to its end. */
async function runAndResume(): Promise<FinishedRun> {
  const r = createPreflightRepo({
    plan: { phases: [{}, {}, {}] },
    files: { ".gitignore": ".phax-context/\n" },
  });
  roots = r;
  writeFileSync(join(r.repo, "phax.json"), phaxJson(r));
  const planPath = join(r.repo, "plan.md");
  writeFileSync(planPath, withGateProfile(readFileSync(planPath, "utf8")));
  git(["commit", "-q", "-am", "chore: gate profiles and records"], r.repo);
  process.chdir(r.repo);

  const run = await phaxCall(["run", "--plan", "plan.md", "--hold=phase-02"]);
  expect({ code: run.code, err: run.err }).toEqual({ code: 13, err: "" });
  const runPath = join(r.stateRoot, "runs", `${r.namespace}.foo`);
  const status = readJson(join(runPath, "run-status.json"));
  expect(recordPaths(r)).toEqual([`${String(status["runId"])}/phase-01/record.json`]);

  const resumed = await phaxCall(["resume", "foo", "--yes"]);
  expect(resumed.err).not.toContain("gate profile");
  return {
    r,
    runPath,
    runId: String(status["runId"]),
    gateProfileId: status["gateProfileId"],
  };
}

/** The commits of the records branch, newest first. */
function recordCommits(r: PreflightRepo): readonly string[] {
  return git(["log", "--format=%H", RECORDS_BRANCH], r.repo)
    .split("\n")
    .filter((sha) => sha !== "");
}

/** Every record.json path a commit of the records branch carries, sorted. */
function recordPaths(r: PreflightRepo): readonly string[] {
  const paths = recordCommits(r).flatMap((sha) =>
    git(["ls-tree", "-r", "--name-only", sha], r.repo)
      .split("\n")
      .filter((path) => path.endsWith("/record.json")),
  );
  return [...new Set(paths)].toSorted();
}

/** The bytes of `path` in the newest records commit that carries it. */
function recordText(r: PreflightRepo, path: string): string {
  const sha = recordCommits(r).find((c) =>
    git(["ls-tree", "-r", "--name-only", c], r.repo).split("\n").includes(path),
  );
  if (sha === undefined) throw new Error(`no record at ${path}`);
  return git(["show", `${sha}:${path}`], r.repo);
}

function recordOf(r: PreflightRepo, path: string): Json {
  return jsonObject(recordText(r, path));
}

/** Commits a phase commit with trailers and, on the records branch, a 0.34.0 record for it. */
async function writeV0_34_0Record(r: PreflightRepo): Promise<string> {
  const runId = "run-older-1786800000000";
  const phaseId = "phase-01";
  const body = [
    "Do the older thing.",
    "",
    "---",
    "",
    `Run-Id: ${runId}`,
    "Short-Name: older",
    `Phase-Id: ${phaseId}`,
    "Phase-Title: Older phase",
    "Model: claude-sonnet-5",
    "Effort: high",
  ].join("\n");
  git(["commit", "-q", "--allow-empty", "-m", "feat: older", "-m", body], r.repo);
  const sha = git(["rev-parse", "HEAD"], r.repo).trim();
  // Written by phax 0.34.0 through 0.42.x: no gateProfile.
  const document = {
    $schema: schemaUrl("phase-record-manifest", "0.34.0"),
    runId,
    phaseId,
    shape: "skeleton",
    sourceSha: sha,
    model: "claude-sonnet-5",
    effort: "high",
    provider: "claude-code",
    userConfig: "loaded",
    outcome: "committed",
    usage: { available: false },
    verifiedSurfaces: ["local"],
    acceptance: null,
    mode: "headless",
    stop: null,
  };
  const branch = Result.getOrThrow(decodeBranchName(RECORDS_BRANCH));
  const files = [
    {
      path: `${runId}/${phaseId}/record.json`,
      content: new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`),
    },
  ];
  const message = [
    `records(${phaseId}): committed`,
    "",
    `Run-Id: ${runId}`,
    `Phase-Id: ${phaseId}`,
    "Shape: skeleton",
  ].join("\n");
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Git, (g) =>
        Effect.flatMap(g.resolveRef(r.repo, `refs/heads/${RECORDS_BRANCH}`), (tip) =>
          g.writeTreeCommit({
            repo: r.repo,
            branch,
            message,
            files,
            parent: tip,
            expectedTip: tip,
          }),
        ),
      ),
      NodeGitLayer,
    ),
  );
  return sha;
}

/** The two lines `records explain` prints for the profile and the gates, in order. */
function profileAndGatesLines(out: string): readonly string[] {
  return out.split("\n").filter((line) => /^(profile|gates) {2,}/.test(line));
}

describe("phase records name the run's gate profile", { timeout: 120_000 }, () => {
  it("writes the run's recorded profile on every record, at run and at resume, and explains it", async () => {
    const { r, runPath, runId, gateProfileId } = await runAndResume();
    expect(gateProfileId).toBe("light");

    // Every phase record of the run, at run (phase-01) and at resume (phase-02, phase-03).
    const paths = recordPaths(r);
    expect(paths).toEqual(
      ["phase-01", "phase-02", "phase-03"].map((phase) => `${runId}/${phase}/record.json`),
    );
    for (const path of paths) {
      const record = recordOf(r, path);
      expect(record["$schema"]).toBe(currentSchemaUrl("phase-record-manifest"));
      expect(record["gateProfile"]).toBe(gateProfileId);
      const keys = Object.keys(record);
      expect(keys[keys.indexOf("userConfig") + 1]).toBe("gateProfile");
    }

    // records explain: the profile line just before the gates line, and --json's gateProfile.
    const phaseSha = String(readJson(join(runPath, "phase-01", "status.json"))["commitHash"]);
    const text = await phaxCall(["records", "explain", phaseSha]);
    expect(text.code).toBe(0);
    const lines = profileAndGatesLines(text.out);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("profile  light");
    expect(lines[1]).toMatch(/^gates {4}committed after/);
    const outLines = text.out.split("\n");
    expect(outLines.indexOf(lines[1] ?? "")).toBe(outLines.indexOf("profile  light") + 1);

    const json = await phaxCall(["records", "explain", phaseSha, "--json"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toMatchObject({
      kind: "phase",
      model: expect.any(String),
      effort: expect.any(String),
      gateProfile: "light",
    });

    // A 0.34.0 record reads as not recorded, and its file is never rewritten.
    const olderSha = await writeV0_34_0Record(r);
    const olderPath = "run-older-1786800000000/phase-01/record.json";
    const olderBytes = recordText(r, olderPath);

    const olderText = await phaxCall(["records", "explain", olderSha]);
    expect(olderText.code).toBe(0);
    expect(profileAndGatesLines(olderText.out)[0]).toBe("profile  (not recorded)");
    const olderJson = await phaxCall(["records", "explain", olderSha, "--json"]);
    expect(olderJson.code).toBe(0);
    expect(JSON.parse(olderJson.out)).toMatchObject({ kind: "phase", gateProfile: null });

    expect(recordText(r, olderPath)).toBe(olderBytes);
    expect(recordOf(r, olderPath)).not.toHaveProperty("gateProfile");
  });
});
