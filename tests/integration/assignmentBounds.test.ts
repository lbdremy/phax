import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  assignmentBoundFindings,
  invalidBoundMessages,
  resolveBoundParts,
} from "../../src/app/assignmentBounds.js";
import { PROVIDER_CONFIG_PATH } from "../../src/app/loadRouting.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { Assignments } from "../../src/schemas/assignments.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const REPO_ROOT = "/repo";
const PROVIDER = "acme-guard architecture";

const PART_BOUND: Assignments[number] = {
  kind: "part",
  part: "core-decide",
  model: "claude-opus-5-5",
  effort: { min: "medium", max: "high" },
};
const GLOBS_BOUND: Assignments[number] = {
  kind: "globs",
  globs: ["src/*/schemas/**"],
  model: "claude-sonnet-5-5",
  effort: { min: "medium", max: "high" },
};

function config(assignments: Assignments | undefined, provider = true): ResolvedConfig {
  return {
    repoRoot: REPO_ROOT,
    ...(assignments !== undefined ? { assignments } : {}),
    ...(provider ? { architecture: { command: PROVIDER } } : {}),
  } as unknown as ResolvedConfig;
}

const REPORT = JSON.stringify({
  $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
  body: "# Architecture — acme-billing",
  parts: [
    {
      id: "core-decide",
      name: "core · decide",
      description: "Pure functions that decide a command against the current state.",
      globs: ["src/core/decide/**"],
    },
  ],
});

function answering(stdout = REPORT, exitCode = 0) {
  const shell = makeFakeShell();
  shell.impl.setResponse(PROVIDER, { exitCode, stdout, stderr: "" });
  return shell;
}

const resolve = (cfg: ResolvedConfig, shell = answering()) =>
  Effect.runPromise(resolveBoundParts(cfg).pipe(Effect.provide(shell.layer)));

describe("resolveBoundParts", () => {
  it("asks the provider once, for the whole repository, from the root", async () => {
    const shell = answering();
    const resolution = await resolve(config([PART_BOUND, GLOBS_BOUND]), shell);
    expect(resolution).toEqual({
      kind: "resolved",
      parts: new Map([["core-decide", ["src/core/decide/**"]]]),
    });
    expect(shell.impl.calls).toHaveLength(1);
    const [call] = shell.impl.calls;
    expect(call!.command).toEqual(["acme-guard", "architecture"]);
    expect(call!.cwd).toBe(REPO_ROOT);
    expect(call!.timeoutMs).toBe(60_000);
    const request = JSON.parse(call!.stdin!) as Record<string, unknown>;
    expect(request["$schema"]).toMatch(
      /^https:\/\/docs\.phax\.run\/schemas\/architecture-request\/\d+\.\d+\.\d+\.json$/,
    );
    expect(request["files"]).toBeNull();
    expect(Object.keys(request)).toEqual(["$schema", "files"]);
  });

  it("runs nothing when only globs bounds are declared, provider configured", async () => {
    const shell = answering();
    expect(await resolve(config([GLOBS_BOUND]), shell)).toEqual({
      kind: "resolved",
      parts: new Map(),
    });
    expect(shell.impl.calls).toEqual([]);
  });

  it("runs nothing when only globs bounds are declared, no provider configured", async () => {
    const shell = answering();
    expect(await resolve(config([GLOBS_BOUND], false), shell)).toEqual({
      kind: "resolved",
      parts: new Map(),
    });
    expect(shell.impl.calls).toEqual([]);
  });

  it("runs nothing when no bounds are declared", async () => {
    const shell = answering();
    await resolve(config(undefined), shell);
    expect(shell.impl.calls).toEqual([]);
  });

  it("is unavailable with a part bound and no provider", async () => {
    const shell = answering();
    expect(await resolve(config([PART_BOUND], false), shell)).toEqual({
      kind: "unavailable",
      cause: "no architecture provider is configured",
    });
    expect(shell.impl.calls).toEqual([]);
  });

  it("is unavailable, with the provider's reason, when the provider fails", async () => {
    expect(await resolve(config([PART_BOUND]), answering("", 3))).toEqual({
      kind: "unavailable",
      cause: "architecture provider exited with code 3",
    });
  });

  it("is unavailable when the provider answers no architecture report", async () => {
    const resolution = await resolve(config([PART_BOUND]), answering('{"body": "x"}'));
    expect(resolution.kind).toBe("unavailable");
  });
});

const findings = (cfg: ResolvedConfig, shell = answering()) =>
  Effect.runPromise(
    assignmentBoundFindings({
      config: cfg,
      phases: [
        {
          id: "phase-01",
          model: "claude-sonnet-5-5",
          effort: "medium",
          plannedFilesToCreate: ["src/core/decide/refund.ts"],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
        },
      ],
      headers: [],
      providerConfig: DEFAULT_PROVIDER_CONFIG,
    }).pipe(Effect.provide(shell.layer)),
  );

const invalid = (cfg: ResolvedConfig, fs = makeFakeFileSystem()) =>
  Effect.runPromise(invalidBoundMessages(cfg).pipe(Effect.provide(fs.layer)));

describe("assignmentBoundFindings", () => {
  it("holds the phase to the part bound the provider resolves", async () => {
    expect(await findings(config([PART_BOUND]))).toEqual([
      {
        severity: "error",
        check: "models",
        phase: "phase-01",
        message:
          "claude-sonnet-5-5 / medium: outside assignments[0] (part core-decide: claude-opus-5-5, medium–high) with no **Assignment reason:** line",
      },
    ]);
  });

  it("reports the provider's failure as an unresolved bound", async () => {
    expect(await findings(config([PART_BOUND]), answering("", 3))).toEqual([
      {
        severity: "error",
        check: "models",
        phase: null,
        message:
          "assignments[0] (part core-decide): unresolved: architecture provider exited with code 3; no phase was compared with the bounds",
      },
    ]);
  });
});

describe("invalidBoundMessages", () => {
  it("is empty without bounds", async () => {
    expect(await invalid(config(undefined))).toEqual([]);
  });

  it("reads the catalog a run reads", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      PROVIDER_CONFIG_PATH,
      JSON.stringify({ ...DEFAULT_PROVIDER_CONFIG, providers: {} }),
    );
    expect(await invalid(config([GLOBS_BOUND]), fs)).toEqual([
      "assignments[0].model: claude-sonnet-5-5 is not in the catalog",
    ]);
  });

  it("names a bound the default catalog lacks", async () => {
    expect(await invalid(config([GLOBS_BOUND, { ...PART_BOUND, model: "claude-opus-9" }]))).toEqual(
      ["assignments[1].model: claude-opus-9 is not in the catalog"],
    );
  });
});
