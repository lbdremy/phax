import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { Command } from "commander";
import {
  registerArtifactCommand,
  runArtifactStatus,
  runArtifactTransition,
  runArtifactArchiveRefusal,
  runArtifactSchema,
  runCreateArtifact,
  runCreateArtifactHeadless,
} from "../../../src/cli/commands/artifact.js";
import {
  ArtifactCommitFailedError,
  ArtifactCreationError,
  ArtifactDirtyWriteSetError,
  ArtifactValidationError,
  AuthoringDocumentError,
  InvalidArtifactTransitionError,
  RateLimitError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
} from "../../../src/domain/errors.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";

vi.mock("../../../src/app/artifactStatus.js", () => ({
  inspectArtifact: vi.fn(),
  transitionArtifact: vi.fn(),
}));

vi.mock("../../../src/app/createArtifact.js", () => ({
  createArtifact: vi.fn(),
}));

vi.mock("../../../src/app/authorArtifact.js", () => ({
  authorArtifact: vi.fn(),
}));

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/loadRouting.js", () => ({
  loadModelRouting: vi.fn(),
  loadProviderConfig: vi.fn(),
}));

vi.mock("../../../src/domain/routing/resolve.js", () => ({
  resolveModel: vi.fn(),
}));

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => errors.push(m),
  };
  return { out, lines, errors };
}

describe("runArtifactStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names kind, status, and legal transitions, exits 0", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.succeed({
        kind: "plan",
        status: "Approved",
        legalTargets: ["Approved", "Stale", "Abandoned", "Completed"],
        approval: { kind: "none" },
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactStatus(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      out,
    );

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Kind:");
    expect(text).toContain("plan");
    expect(text).toContain("Status:");
    expect(text).toContain("Approved");
    expect(text).toContain("Legal transitions:");
    expect(text).toContain("Stale, Abandoned, Completed");
  });

  it("returns exit code 12 and surfaces the validation message on failure", async () => {
    const { inspectArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    inspectArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactValidationError({
          path: "docs/plans/foo.md",
          message:
            "docs/plans/foo.md has no frontmatter block — lifecycle metadata must be YAML frontmatter",
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactStatus("docs/plans/foo.md", out);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("has no frontmatter block");
  });
});

describe("runArtifactTransition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve: logs the resulting status without a path line, exits 0", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Approved");
    expect(lines.some((l) => l.startsWith("Path:"))).toBe(false);
  });

  it("complete: logs the resulting status and the new archived path", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Completed",
        path: "docs/specs/archive/2608091526-artifact-lifecycle-status.md",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/specs/2608091526-artifact-lifecycle-status.md",
      "Completed",
      out,
    );

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Completed");
    expect(text).toContain("docs/specs/archive/2608091526-artifact-lifecycle-status.md");
  });

  it("returns exit code 12 and names the legal targets on an illegal transition", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new InvalidArtifactTransitionError({
          kind: "plan",
          from: "Draft",
          to: "Stale",
          legalTargets: ["Approved", "Abandoned"],
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Stale",
      out,
    );

    expect(code).toBe(12);
    const text = errors.join("\n");
    expect(text).toContain("Approved, Abandoned");
  });

  it("approve of a plan with a captured baseline logs the short sha", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
        approvedBaseline: "abcdef1234567890abcdef1234567890abcdef12",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(0);
    expect(lines.some((l) => l === "Baseline: abcdef1")).toBe(true);
  });

  it("returns exit code 12 when the declared spec is not approved", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new SpecNotApprovedError({
          planPath: "docs/plans/2607101056-typescript-7-migration-plan.md",
          specPath: "docs/specs/2609101222-foo.md",
          specStatus: "Draft",
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("approve the spec first");
  });

  it("returns exit code 12 when spec retirement is blocked by a live dependent", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new SpecRetirementBlockedError({
          specPath: "docs/specs/2609101222-foo.md",
          dependents: [
            { path: "docs/plans/2607101056-typescript-7-migration-plan.md", status: "Approved" },
          ],
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition("docs/specs/2609101222-foo.md", "Completed", out);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("abandon or complete them first");
  });

  it("always passes commit: true to the use case", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
      }),
    );

    const { out } = makeOutput();
    await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(transitionArtifact).toHaveBeenCalledWith(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      expect.objectContaining({ commit: true }),
    );
  });

  it("renders the Commit: line with hash and subject when a commit was created", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
        commit: {
          hash: "3f2a1c9abcdef1234567890abcdef1234567890",
          subject: "chore(plans): approve typescript-7-migration",
        },
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(0);
    expect(
      lines.some((l) => l === "Commit: 3f2a1c9 — chore(plans): approve typescript-7-migration"),
    ).toBe(true);
  });

  it("archive refusal: writes the refusal naming complete and returns exit code 1", () => {
    const { out, errors, lines } = makeOutput();
    const code = runArtifactArchiveRefusal(out);

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(
      'unknown transition "archive" — the completion transition is: phax artifact complete <path>',
    );
    expect(lines).toHaveLength(0);
  });

  it("omits the Commit: line when no commit was created", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.succeed({
        status: "Approved",
        path: "docs/plans/2607101056-typescript-7-migration-plan.md",
      }),
    );

    const { out, lines } = makeOutput();
    await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(lines.some((l) => l.startsWith("Commit:"))).toBe(false);
  });

  it("returns exit code 12 when the write-set target is dirty", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactDirtyWriteSetError({
          paths: ["docs/plans/2607101056-typescript-7-migration-plan.md"],
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("commit or stash them first");
  });

  it("returns a non-zero exit code when the transition commit fails", async () => {
    const { transitionArtifact } = vi.mocked(await import("../../../src/app/artifactStatus.js"));
    transitionArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactCommitFailedError({
          paths: ["docs/plans/2607101056-typescript-7-migration-plan.md"],
          cause: "pre-commit hook failed",
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runArtifactTransition(
      "docs/plans/2607101056-typescript-7-migration-plan.md",
      "Approved",
      out,
    );

    expect(code).not.toBe(0);
    expect(code).not.toBe(12);
    expect(errors.join("\n")).toContain("commit failed");
  });
});

describe("runCreateArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spec: logs the created path with (Draft), exits 0", async () => {
    const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
    createArtifact.mockReturnValue(
      Effect.succeed({ path: "docs/specs/2609091412-plan-prune.md", sourceSpec: null }),
    );

    const { out, lines } = makeOutput();
    const code = await runCreateArtifact("spec", "plan-prune", undefined, out);

    expect(code).toBe(0);
    expect(lines).toEqual(["created docs/specs/2609091412-plan-prune.md (Draft)"]);
  });

  it("plan: logs the created path with the bound source-spec, exits 0", async () => {
    const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
    createArtifact.mockReturnValue(
      Effect.succeed({
        path: "docs/plans/2609101030-plan-prune-plan.md",
        sourceSpec: "docs/specs/2609091412-plan-prune.md",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runCreateArtifact(
      "plan",
      "plan-prune",
      "docs/specs/2609091412-plan-prune.md",
      out,
    );

    expect(code).toBe(0);
    expect(lines).toEqual([
      "created docs/plans/2609101030-plan-prune-plan.md (Draft, source-spec docs/specs/2609091412-plan-prune.md)",
    ]);
  });

  it("plan: logs source-spec null when no --spec is given", async () => {
    const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
    createArtifact.mockReturnValue(
      Effect.succeed({ path: "docs/plans/2609101031-catalog-refresh-plan.md", sourceSpec: null }),
    );

    const { out, lines } = makeOutput();
    const code = await runCreateArtifact("plan", "catalog-refresh", undefined, out);

    expect(code).toBe(0);
    expect(lines).toEqual([
      "created docs/plans/2609101031-catalog-refresh-plan.md (Draft, source-spec null)",
    ]);
  });

  it("returns exit code 12 and surfaces the refusal message on a bad slug", async () => {
    const { createArtifact } = vi.mocked(await import("../../../src/app/createArtifact.js"));
    createArtifact.mockReturnValue(
      Effect.fail(
        new ArtifactCreationError({
          message: 'slug "Plan_Prune" does not match [a-z0-9]+(-[a-z0-9]+)*',
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runCreateArtifact("spec", "Plan_Prune", undefined, out);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("Plan_Prune");
  });
});

describe("runArtifactSchema", () => {
  it.each([
    ["spec", "phax spec document (experimental)"],
    ["plan", "phax plan document (experimental)"],
  ] as const)(
    "%s: prints the document JSON Schema, titled experimental, exits 0",
    (kind, title) => {
      const { out, lines, errors } = makeOutput();
      const code = runArtifactSchema(kind, out);

      expect(code).toBe(0);
      expect(errors).toEqual([]);
      expect(lines).toHaveLength(1);
      const schema = JSON.parse(lines[0]!) as { title: string; properties: { kind: unknown } };
      expect(schema.title).toBe(title);
      expect(schema.properties.kind).toEqual({ type: "string", enum: [kind] });
      // Pretty-printed, not a single line.
      expect(lines[0]).toContain('\n  "');
    },
  );

  it("an unknown kind is a Commander usage error", async () => {
    const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
    const { out, lines } = makeOutput();
    registerArtifactCommand(program, out);

    await expect(
      program.parseAsync(["node", "phax", "artifact", "schema", "idea"]),
    ).rejects.toMatchObject({ code: "commander.invalidArgument" });
    expect(lines).toEqual([]);
  });
});

const FAKE_SECURITY: ResolvedConfig["security"] = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

function makeHeadlessConfig(
  authoring: ResolvedConfig["authoring"] = {
    spec: { model: "config-spec-model", effort: "medium" },
    plan: { model: "config-plan-model", effort: "medium" },
  },
): ResolvedConfig {
  return {
    raw: {} as ResolvedConfig["raw"],
    namespace: "test-project",
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: FAKE_SECURITY,
    publish: {
      auto: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: { enabled: false, model: "claude-sonnet-5", effort: "medium" },
    codeReview: { model: "claude-opus-5-5", effort: "high" },
    authoring,
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
  };
}

const FAKE_RESOLUTION = {
  requested: { model: "config-spec-model", family: "claude-opus", effort: "medium" },
  selected: {
    provider: "claude-code",
    family: "claude-opus",
    concreteModel: "config-spec-model",
    thinking: "medium",
  },
  relationship: "exact",
  reason: "exact match",
} as const;

describe("runCreateArtifactHeadless", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function mockHappyPathConfig(authoring?: ResolvedConfig["authoring"]): Promise<void> {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeHeadlessConfig(authoring)));

    const { loadModelRouting, loadProviderConfig } = vi.mocked(
      await import("../../../src/app/loadRouting.js"),
    );
    loadModelRouting.mockReturnValue(Effect.succeed({ families: [], providerPriority: [] }));
    loadProviderConfig.mockReturnValue(Effect.succeed({ providers: {} }));

    const { resolveModel } = vi.mocked(await import("../../../src/domain/routing/resolve.js"));
    resolveModel.mockReturnValue(FAKE_RESOLUTION);
  }

  it("exits 12 without calling authorArtifact when --brief is missing", async () => {
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));

    const { out, errors } = makeOutput();
    const code = await runCreateArtifactHeadless("spec", "plan-prune", undefined, {}, out);

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("--brief");
    expect(authorArtifact).not.toHaveBeenCalled();
  });

  it("success: prints the four lines and exits 0", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.succeed({
        path: "docs/specs/2609230835-plan-prune.md",
        sidecarPath: "docs/specs/2609230835-plan-prune.json",
        commit: { hash: "a1b2c3d4e5f6", subject: "docs(specs): draft plan-prune" },
        authoringId: "2609230835-plan-prune",
        sessionFolder: "/fake-state/authoring/2609230835-plan-prune",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "-" },
      out,
      { readStdin: async () => "write a spec about plan pruning" },
    );

    expect(code).toBe(0);
    expect(lines).toEqual([
      "authoring spec plan-prune — config-spec-model / medium",
      "created docs/specs/2609230835-plan-prune.md (Draft, headless)",
      "sidecar docs/specs/2609230835-plan-prune.json",
      "commit a1b2c3d — docs(specs): draft plan-prune",
    ]);
  });

  it("failure: AuthoringDocumentError prints the message and exits 5", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.fail(
        new AuthoringDocumentError({
          kind: "spec",
          slug: "plan-prune",
          message:
            'spec document rejected — acceptanceCriteria[2].refs[0]: "5.9" names no requirement',
        }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "-" },
      out,
      { readStdin: async () => "brief" },
    );

    expect(code).toBe(5);
    expect(errors.join("\n")).toContain("names no requirement");
    expect(errors.join("\n")).toContain("✗ authoring failed:");
  });

  it("failure: ArtifactCreationError (existing target) exits 12", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.fail(new ArtifactCreationError({ message: "docs/specs/foo.md already exists" })),
    );

    const { out, errors } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "-" },
      out,
      { readStdin: async () => "brief" },
    );

    expect(code).toBe(12);
    expect(errors.join("\n")).toContain("already exists");
  });

  it("failure: RateLimitError exits 8", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.fail(new RateLimitError({ message: "rate limited", rawMessage: "rate limited" })),
    );

    const { out, errors } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "-" },
      out,
      { readStdin: async () => "brief" },
    );

    expect(code).toBe(8);
    expect(errors.join("\n")).toContain("rate limited");
  });

  it("precedence: flag wins over config over catalog default for model and effort", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.succeed({
        path: "docs/specs/2609230835-plan-prune.md",
        sidecarPath: "docs/specs/2609230835-plan-prune.json",
        commit: { hash: "a1b2c3d4e5f6", subject: "docs(specs): draft plan-prune" },
        authoringId: "2609230835-plan-prune",
        sessionFolder: "/fake-state/authoring/2609230835-plan-prune",
      }),
    );

    const { out } = makeOutput();
    await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "-", model: "flag-model", effort: "high" },
      out,
      { readStdin: async () => "brief" },
    );

    expect(authorArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ model: "flag-model", effort: "high" }),
    );
  });

  it("precedence: config wins over catalog default when no flag is given", async () => {
    await mockHappyPathConfig();
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));
    authorArtifact.mockReturnValue(
      Effect.succeed({
        path: "docs/specs/2609230835-plan-prune.md",
        sidecarPath: "docs/specs/2609230835-plan-prune.json",
        commit: { hash: "a1b2c3d4e5f6", subject: "docs(specs): draft plan-prune" },
        authoringId: "2609230835-plan-prune",
        sessionFolder: "/fake-state/authoring/2609230835-plan-prune",
      }),
    );

    const { out } = makeOutput();
    await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "-" },
      out,
      { readStdin: async () => "brief" },
    );

    expect(authorArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ model: "config-spec-model", effort: "medium" }),
    );
  });

  it("invalid --effort refuses before calling authorArtifact", async () => {
    const { authorArtifact } = vi.mocked(await import("../../../src/app/authorArtifact.js"));

    const { out, errors } = makeOutput();
    const code = await runCreateArtifactHeadless(
      "spec",
      "plan-prune",
      undefined,
      { headless: true, brief: "-", effort: "extreme" },
      out,
    );

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Invalid --effort value");
    expect(authorArtifact).not.toHaveBeenCalled();
  });
});
