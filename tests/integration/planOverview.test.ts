// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { planOverview, type PlanOverviewFailure } from "../../src/app/planOverview.js";
import type { PlanOverview } from "../../src/domain/plan/overview.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { encodeSpecDocumentFile, type SpecDocument } from "../../src/schemas/specDocument.js";

const REPO_ROOT = "/repo";
const PLAN_REL = "docs/plans/2610240900-invoice-export-plan.md";
const PLAN_PATH = `${REPO_ROOT}/${PLAN_REL}`;
const SPEC_REL = "docs/specs/2610231100-invoice-export.md";
const SPEC_JSON_REL = "docs/specs/2610231100-invoice-export.json";
const PROVIDER = "acme-guard architecture";

const baseConfig = {
  stateRoot: "/home/user/.phax",
  namespace: "test-project",
  extractPlanModel: "claude-sonnet-4-6",
  extractPlanEffort: "medium",
  raw: { version: 1, name: "test-project", gateProfiles: {} },
  repoRoot: REPO_ROOT,
} as unknown as ResolvedConfig;

const withProvider = { ...baseConfig, architecture: { command: PROVIDER } } as ResolvedConfig;

interface PhaseSpec {
  readonly create?: readonly string[];
  readonly edit?: readonly string[];
  readonly oracle?: boolean;
  readonly lines?: readonly string[];
}

const bullets = (files: readonly string[] | undefined): string =>
  files === undefined || files.length === 0 ? "- (none)" : files.map((f) => `- ${f}`).join("\n");

function planMd(
  phases: readonly PhaseSpec[],
  frontmatter = `---\nstatus: Draft\nsource-spec: ${SPEC_REL}\ncompletes-spec: true\n---\n`,
): string {
  const blocks = phases.map((phase, index) => {
    const id = `phase-0${index + 1}`;
    const oracle =
      phase.oracle === true
        ? `\n**Oracle phase:** yes\n**Oracle files:** ${(phase.create ?? [])[0]}`
        : "";
    return `## ${id} — Phase ${index + 1} {#${id}-part}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium${oracle}

### Planned files to create

${bullets(phase.create)}

### Planned files to edit

${bullets(phase.edit)}

### Optional files that may be edited

- (none)

### Test strategy

${(phase.lines ?? ["- (none)"]).join("\n")}

### Commit subject

feat(export): part ${index + 1}

### Commit body

Does part ${index + 1}.
`;
  });
  return `${frontmatter}# Invoice export

## Required commands

- (none)

${blocks.join("\n")}`;
}

const line = (guarantee: string, loop: "in-phase" | "oracle", criterion?: string): string =>
  `- ${guarantee} — small · example · the findings · ${loop}${criterion === undefined ? "" : ` · ${criterion}`}`;

const reportJson = (parts: readonly object[]): string =>
  JSON.stringify({
    $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
    body: "# Architecture — acme-billing",
    parts,
  });

const PARTS = [
  {
    id: "export-core",
    name: "export · core",
    description: "The export logic.",
    globs: ["src/export/core/**"],
  },
  {
    id: "export-cli",
    name: "export · cli",
    description: "The command.",
    globs: ["src/export/cli/**"],
  },
];

function specJson(criteria: readonly string[]): string {
  const spec: SpecDocument = {
    kind: "spec",
    title: "Invoice export",
    ground: [],
    context: "Invoices are exported by hand.",
    problem: "Export is manual.",
    productGoal: {
      statement: "Export invoices with one command.",
      guidingRule: "One command, one file.",
    },
    terminology: [],
    requirements: [
      {
        id: "R-export",
        title: "Export",
        pattern: "event",
        statement: "WHEN an export is requested THE system SHALL write a file.",
      },
    ],
    surface: [],
    nonGoals: [],
    acceptanceCriteria: criteria.map((id) => ({
      id,
      name: `Criterion ${id}`,
      given: "an invoice",
      when: "it is exported",
      then: "a file is written",
      refs: ["R-export"],
    })) as unknown as SpecDocument["acceptanceCriteria"],
    openQuestions: [],
    arbitratedQuestions: [],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "an internal fixture" },
  };
  return JSON.stringify(encodeSpecDocumentFile(withSchemaUrl("spec-document", spec)), null, 2);
}

interface Run {
  readonly result: Either.Either<PlanOverview, PlanOverviewFailure>;
  readonly shellCalls: ReadonlyArray<{
    readonly command: readonly string[];
    readonly stdin?: string;
  }>;
}

async function run(
  files: Readonly<Record<string, string>>,
  opts: {
    readonly config?: ResolvedConfig;
    readonly provider?: { readonly stdout: string; readonly exitCode: number };
    readonly repoRelPath?: string;
  } = {},
): Promise<Run> {
  const fakeFs = makeFakeFileSystem();
  for (const [path, content] of Object.entries(files)) fakeFs.impl.setFile(path, content);
  const fakeShell = makeFakeShell();
  if (opts.provider !== undefined) {
    fakeShell.impl.setResponse(PROVIDER, { ...opts.provider, stderr: "" });
  }
  const repoRelPath = opts.repoRelPath ?? PLAN_REL;
  const result = await Effect.runPromise(
    planOverview({
      planMdPath: `${REPO_ROOT}/${repoRelPath}`,
      reportPath: repoRelPath,
      repoRelPath,
      config: opts.config ?? baseConfig,
    }).pipe(Effect.either, Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
  );
  return { result, shellCalls: fakeShell.impl.calls };
}

const overviewOf = ({ result }: Run): PlanOverview => {
  if (Either.isLeft(result)) throw new Error(`expected an overview, got ${result.left.line}`);
  return result.right;
};

const failureOf = ({ result }: Run): PlanOverviewFailure => {
  if (Either.isRight(result)) throw new Error("expected a failure");
  return result.left;
};

const TWO_PHASES = [
  {
    oracle: true,
    create: ["tests/unit/export.test.ts"],
    lines: [line("exports are listed", "oracle", "ac-a")],
  },
  {
    create: ["src/export/core/write.ts", "scripts/export.sh"],
    edit: ["tests/unit/export.test.ts"],
    lines: [line("exports are written", "in-phase", "ac-b")],
  },
];

describe("planOverview", () => {
  it("groups the planned files by the parts of one provider call", async () => {
    const outcome = await run(
      { [PLAN_PATH]: planMd(TWO_PHASES) },
      {
        config: withProvider,
        provider: { stdout: reportJson(PARTS), exitCode: 0 },
      },
    );
    const overview = overviewOf(outcome);

    expect(overview.architecture).toEqual({ kind: "parts" });
    expect(overview.phases[1]!.placement).toEqual([
      { part: "export-core", files: ["src/export/core/write.ts"] },
      { part: null, files: ["scripts/export.sh", "tests/unit/export.test.ts"] },
    ]);
    expect(outcome.shellCalls).toHaveLength(1);
    const request = JSON.parse(outcome.shellCalls[0]!.stdin!) as { files: string[] };
    expect(request.files).toEqual([
      "tests/unit/export.test.ts",
      "src/export/core/write.ts",
      "scripts/export.sh",
    ]);
    expect(outcome.shellCalls[0]!.command).toEqual(["acme-guard", "architecture"]);
  });

  it("asks for the whole repository when the plan plans no file", async () => {
    const outcome = await run(
      { [PLAN_PATH]: planMd([{ lines: ["- (none)"] }]) },
      { config: withProvider, provider: { stdout: reportJson(PARTS), exitCode: 0 } },
    );
    overviewOf(outcome);
    expect(outcome.shellCalls).toHaveLength(1);
    expect((JSON.parse(outcome.shellCalls[0]!.stdin!) as { files: unknown }).files).toBeNull();
  });

  it("runs no provider when none is configured", async () => {
    const outcome = await run({ [PLAN_PATH]: planMd(TWO_PHASES) });
    const overview = overviewOf(outcome);

    expect(overview.architecture).toEqual({ kind: "none" });
    expect(outcome.shellCalls).toHaveLength(0);
    expect(overview.phases[0]!.placement).toEqual([
      { part: null, files: ["tests/unit/export.test.ts"] },
    ]);
  });

  it("degrades to the planned files when the provider exits non-zero, after one call", async () => {
    const outcome = await run(
      { [PLAN_PATH]: planMd(TWO_PHASES) },
      { config: withProvider, provider: { stdout: "", exitCode: 1 } },
    );
    const overview = overviewOf(outcome);

    expect(overview.architecture.kind).toBe("failed");
    expect(overview.architecture).toMatchObject({ message: expect.stringContaining("1") });
    expect(outcome.shellCalls).toHaveLength(1);
    expect(overview.phases[1]!.placement).toEqual([
      {
        part: null,
        files: ["src/export/core/write.ts", "scripts/export.sh", "tests/unit/export.test.ts"],
      },
    ]);
  });

  it("degrades when the provider answers something that is not a report", async () => {
    const outcome = await run(
      { [PLAN_PATH]: planMd(TWO_PHASES) },
      { config: withProvider, provider: { stdout: "not json", exitCode: 0 } },
    );
    expect(overviewOf(outcome).architecture.kind).toBe("failed");
    expect(outcome.shellCalls).toHaveLength(1);
  });

  it("reads the criteria from the source spec's sidecar", async () => {
    const outcome = await run({
      [PLAN_PATH]: planMd(TWO_PHASES),
      [`${REPO_ROOT}/${SPEC_REL}`]: "# Invoice export\n",
      [`${REPO_ROOT}/${SPEC_JSON_REL}`]: specJson(["ac-a", "ac-b", "ac-c"]),
    });
    const overview = overviewOf(outcome);

    expect(overview.name).toBe("invoice-export");
    expect(overview.status).toBe("Draft");
    expect(overview.sourceSpec).toEqual({ path: SPEC_REL, slug: "invoice-export" });
    expect(overview.coverage).toMatchObject({
      kind: "criteria",
      slug: "invoice-export",
      uncovered: ["ac-c"],
    });
  });

  it("says why no criterion is known when the spec has no sidecar", async () => {
    const outcome = await run({
      [PLAN_PATH]: planMd(TWO_PHASES),
      [`${REPO_ROOT}/${SPEC_REL}`]: "# Invoice export\n",
    });
    expect(overviewOf(outcome).coverage).toMatchObject({
      kind: "no-criterion-ids",
      reason: "no-sidecar",
    });
  });

  it("shows a plan without a source spec with no coverage", async () => {
    const outcome = await run({
      [PLAN_PATH]: planMd(TWO_PHASES, "---\nstatus: Draft\nsource-spec: null\n---\n"),
    });
    const overview = overviewOf(outcome);
    expect(overview.sourceSpec).toBeNull();
    expect(overview.coverage).toEqual({ kind: "no-source-spec" });
  });

  it("names a loose plan.md after its run, with its frontmatter status or none", async () => {
    const loose = planMd(TWO_PHASES, "---\nstatus: Approved\nsource-spec: null\n---\n");
    const withFrontmatter = overviewOf(
      await run({ [`${REPO_ROOT}/plan.md`]: loose }, { repoRelPath: "plan.md" }),
    );
    expect(withFrontmatter.name).toBe("invoice-export");
    expect(withFrontmatter.status).toBe("Approved");

    const bare = overviewOf(
      await run({ [`${REPO_ROOT}/plan.md`]: planMd(TWO_PHASES, "") }, { repoRelPath: "plan.md" }),
    );
    expect(bare.status).toBeNull();
    expect(bare.sourceSpec).toBeNull();
  });

  describe("failures", () => {
    it("is unparsable for a plan with a heading missing its anchor, and spawns nothing", async () => {
      const broken = planMd(TWO_PHASES).replace("{#phase-01-part}", "");
      const outcome = await run({ [PLAN_PATH]: broken }, { config: withProvider });

      expect(failureOf(outcome)).toEqual({
        kind: "unparsable",
        line: `${PLAN_REL}: the plan does not parse — run phax plans lint ${PLAN_REL}`,
      });
      expect(outcome.shellCalls).toHaveLength(0);
    });

    it("is unparsable for a plan with a test line off the format", async () => {
      const departing = planMd([{ ...TWO_PHASES[1]!, lines: ["- it works, probably"] }]);
      const outcome = await run({ [PLAN_PATH]: departing }, { config: withProvider });

      expect(failureOf(outcome).kind).toBe("unparsable");
      expect(outcome.shellCalls).toHaveLength(0);
    });

    it("is invalid-artifact for an unknown frontmatter status, with the validation error", async () => {
      const invalid = planMd(TWO_PHASES, "---\nstatus: Bogus\nsource-spec: null\n---\n");
      const outcome = await run({ [PLAN_PATH]: invalid }, { config: withProvider });
      const failure = failureOf(outcome);

      expect(failure.kind).toBe("invalid-artifact");
      expect(failure.line).toContain(PLAN_REL);
      expect(failure.line).toContain("invalid frontmatter");
      expect(failure.line).not.toContain("phax plans lint");
      expect(failure.line).not.toContain("\n");
      expect(outcome.shellCalls).toHaveLength(0);
    });

    it("is unreadable for a plan file that is not there", async () => {
      const outcome = await run({});
      const failure = failureOf(outcome);

      expect(failure.kind).toBe("unreadable");
      expect(failure.line.startsWith(`${PLAN_REL}: cannot be read (`)).toBe(true);
    });
  });
});
