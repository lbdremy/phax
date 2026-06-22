import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Either } from "effect";
import { resolveRunRef } from "../../src/app/resolveRunRef.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";

const now = new Date().toISOString();

function makeRunStatus(namespace: string, shortName: string, state = "running"): object {
  return {
    version: 1,
    namespace,
    shortName,
    runId: `${shortName}-id`,
    state,
    createdAt: now,
    updatedAt: now,
    phasesCount: 1,
  };
}

function makePhaseStatus(shortName: string, state = "running"): object {
  return {
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    state,
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: `phax/${shortName}--phase-01`,
    createdAt: now,
    updatedAt: now,
  };
}

function makeRegistryEntry(namespace: string, shortName: string, state = "running"): object {
  return {
    namespace,
    shortName,
    runId: `${shortName}-id`,
    state,
    branch: `phax/${shortName}`,
    projectName: namespace,
    phasesCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeRegistry(entries: object[]): object {
  return { version: 1, runs: entries };
}

function makeConfig(namespace: string, stateRoot: string): ResolvedConfig {
  return {
    namespace,
    stateRoot,
    repoRoot: "/some/repo",
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "medium",
    fileReconciliationMode: "report_only",
    security: {
      enabled: false,
      model: "claude-sonnet-4-6",
      effort: "medium",
      failOn: "high",
    },
    publish: {
      enabled: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: {
      enabled: false,
      model: "claude-sonnet-4-6",
      effort: "medium",
      failOn: "high",
    },
    raw: {
      name: namespace,
      stateRoot: undefined,
      maxFixAttempts: undefined,
      gateProfiles: {},
      workspaces: undefined,
      extractPlan: undefined,
      security: undefined,
      publish: undefined,
      complianceReview: undefined,
    } as unknown as ResolvedConfig["raw"],
  };
}

function writeRun(
  stateRoot: string,
  namespace: string,
  shortName: string,
  runState = "running",
): void {
  const runPath = join(stateRoot, "runs", `${namespace}.${shortName}`);
  mkdirSync(join(runPath, "phase-01"), { recursive: true });
  writeFileSync(
    join(runPath, "run-status.json"),
    JSON.stringify(makeRunStatus(namespace, shortName, runState)),
  );
  writeFileSync(
    join(runPath, "phase-01", "status.json"),
    JSON.stringify(makePhaseStatus(shortName, "running")),
  );
}

describe("resolveRunRef", () => {
  let stateRoot: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-resolve-test-"));
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  describe("unqualified inside a project", () => {
    it("resolves to the current namespace when namespace matches", () => {
      writeRun(stateRoot, "myns", "fixbug");

      const config = makeConfig("myns", stateRoot);
      const result = resolveRunRef("fixbug", config, stateRoot);

      expect(Either.isRight(result)).toBe(true);
      if (Either.isLeft(result)) throw new Error("expected success");
      expect(result.right.namespace).toBe("myns");
      expect(result.right.shortName).toBe("fixbug");
      expect(result.right.info.namespace).toBe("myns");
      expect(result.right.crossProject).toBe(false);
    });

    it("ignores a same-short-name run belonging to a different namespace", () => {
      writeRun(stateRoot, "otherns", "fixbug");

      const config = makeConfig("myns", stateRoot);
      const result = resolveRunRef("fixbug", config, stateRoot);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("expected refusal");
      expect(result.left.variant).toBe("not-found");
      expect(result.left.message).toContain("myns");
    });

    it("returns not-found when no run folder exists", () => {
      const config = makeConfig("myns", stateRoot);
      const result = resolveRunRef("missing", config, stateRoot);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("expected refusal");
      expect(result.left.variant).toBe("not-found");
      expect(result.left.message).toContain("myns.missing");
    });
  });

  describe("unqualified outside a project", () => {
    it("refuses and lists qualified candidates from registry", () => {
      writeRun(stateRoot, "ns-a", "fixbug");
      writeRun(stateRoot, "ns-b", "fixbug");
      writeFileSync(
        join(stateRoot, "registry.json"),
        JSON.stringify(
          makeRegistry([makeRegistryEntry("ns-a", "fixbug"), makeRegistryEntry("ns-b", "fixbug")]),
        ),
      );

      const result = resolveRunRef("fixbug", undefined, stateRoot);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("expected refusal");
      expect(result.left.variant).toBe("ambiguous-outside-project");
      expect(result.left.candidates).toContain("ns-a.fixbug");
      expect(result.left.candidates).toContain("ns-b.fixbug");
      expect(result.left.message).toContain("ns-a.fixbug");
    });

    it("refuses with no-project message when no candidates found", () => {
      const result = resolveRunRef("missing", undefined, stateRoot);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("expected refusal");
      expect(result.left.variant).toBe("ambiguous-outside-project");
      expect(result.left.candidates).toHaveLength(0);
      expect(result.left.message).toContain("No PHAX project is active");
    });
  });

  describe("qualified reference", () => {
    it("resolves the exact (namespace, shortName) via registry", () => {
      writeRun(stateRoot, "myns", "fixbug");
      writeFileSync(
        join(stateRoot, "registry.json"),
        JSON.stringify(makeRegistry([makeRegistryEntry("myns", "fixbug")])),
      );

      const config = makeConfig("myns", stateRoot);
      const result = resolveRunRef("myns.fixbug", config, stateRoot);

      expect(Either.isRight(result)).toBe(true);
      if (Either.isLeft(result)) throw new Error("expected success");
      expect(result.right.namespace).toBe("myns");
      expect(result.right.shortName).toBe("fixbug");
      expect(result.right.crossProject).toBe(false);
    });

    it("resolves cross-project qualified reference and sets crossProject=true", () => {
      writeRun(stateRoot, "otherns", "fixbug");
      writeFileSync(
        join(stateRoot, "registry.json"),
        JSON.stringify(makeRegistry([makeRegistryEntry("otherns", "fixbug")])),
      );

      const config = makeConfig("myns", stateRoot);
      const result = resolveRunRef("otherns.fixbug", config, stateRoot);

      expect(Either.isRight(result)).toBe(true);
      if (Either.isLeft(result)) throw new Error("expected success");
      expect(result.right.namespace).toBe("otherns");
      expect(result.right.crossProject).toBe(true);
    });

    it("resolves qualified reference outside a project (no config)", () => {
      writeRun(stateRoot, "myns", "fixbug");
      writeFileSync(
        join(stateRoot, "registry.json"),
        JSON.stringify(makeRegistry([makeRegistryEntry("myns", "fixbug")])),
      );

      const result = resolveRunRef("myns.fixbug", undefined, stateRoot);

      expect(Either.isRight(result)).toBe(true);
      if (Either.isLeft(result)) throw new Error("expected success");
      expect(result.right.namespace).toBe("myns");
      expect(result.right.crossProject).toBe(false);
    });

    it("returns not-found when registry has no entry for (namespace, shortName)", () => {
      writeRun(stateRoot, "myns", "fixbug");
      writeFileSync(
        join(stateRoot, "registry.json"),
        JSON.stringify(makeRegistry([makeRegistryEntry("otherns", "fixbug")])),
      );

      const result = resolveRunRef("myns.fixbug", undefined, stateRoot);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("expected refusal");
      expect(result.left.variant).toBe("not-found");
      expect(result.left.message).toContain("myns.fixbug");
    });

    it("returns unresolvable-qualified when registry entry exists but files are missing", () => {
      writeFileSync(
        join(stateRoot, "registry.json"),
        JSON.stringify(makeRegistry([makeRegistryEntry("myns", "fixbug")])),
      );

      const result = resolveRunRef("myns.fixbug", undefined, stateRoot);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("expected refusal");
      expect(result.left.variant).toBe("unresolvable-qualified");
      expect(result.left.message).toContain("myns.fixbug");
    });
  });

  describe("invalid input", () => {
    it("returns not-found for empty input", () => {
      const result = resolveRunRef("", makeConfig("myns", stateRoot), stateRoot);
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("expected refusal");
      expect(result.left.variant).toBe("not-found");
    });

    it("returns not-found for input with multiple dots", () => {
      const result = resolveRunRef("a.b.c", makeConfig("myns", stateRoot), stateRoot);
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) throw new Error("expected refusal");
      expect(result.left.variant).toBe("not-found");
    });
  });
});
