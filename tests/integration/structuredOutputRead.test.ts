// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorArtifact, type AuthorArtifactInput } from "../../src/app/authorArtifact.js";
import { seedPaths, writeSeed } from "../../src/app/interactiveFiles.js";
import { runFirstTurn, type FirstTurnInput } from "../../src/app/interactiveStop.js";
import type { RunId } from "../../src/domain/branded.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer, makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Claude Code prints a result's `structured_output` when it was given
// `--json-schema`. These drive the real Claude adapter against the fake
// `claude` executable: the structured value is the answer whatever the result
// text beside it says, and a success with none is read as its text.

const SESSION = "019a2f6e-0000-4000-8000-000000000001";

let root: string;
let cli: FakeProviderCli;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-structured-read-")));
  cli = makeFakeProviderCli(join(root, "cli"));
  for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(root);
});

const providerConfig = (): ProviderConfig => ({
  providers: { "claude-code": { enabled: true, executable: "claude" } },
});

// ── The interactive first turn ─────────────────────────────────────────────

describe("an interactive first turn answered through structured_output", () => {
  const READING = {
    $schema: currentSchemaUrl("first-reading"),
    pattern: ["The InvoiceRow column order"],
    copiedBy: [{ phase: "phase-04", what: "the column order" }],
    toCheck: [],
  };

  let worktree: string;
  let phaseFolder: string;

  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: worktree, stdio: "pipe" }).toString();

  beforeEach(() => {
    worktree = join(root, "worktree");
    phaseFolder = join(root, "runs", "invoice-export", "phase-03");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(phaseFolder, { recursive: true });
    git("init", "--initial-branch=main");
    disableGitAutoMaintenance(worktree);
    git("config", "--local", "user.email", "ada@example.test");
    git("config", "--local", "user.name", "Ada Example");
    writeFileSync(join(worktree, ".gitignore"), ".phax-context/\n");
    writeFileSync(join(worktree, "invoiceRow.ts"), "export const header = 'invoice_no';\n");
    git("add", "-A");
    git("commit", "-m", "base");
  });

  const policy: SecurityPolicy = {
    mode: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "open" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
    failClosed: true,
  };

  async function firstTurn() {
    const input: FirstTurnInput = {
      runId: "invoice-export-1792667922832" as RunId,
      runPath: join(root, "runs", "invoice-export"),
      phaseFolder,
      worktree,
      phase: { id: "phase-03" },
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "medium",
      policy,
      origin: "first-turn",
    };
    const program = Effect.gen(function* () {
      yield* writeSeed(seedPaths(worktree, phaseFolder), "# Interactive review: phase-03\n");
      return yield* runFirstTurn(input);
    });
    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            makeNodeBackendLayer(providerConfig()),
            NodeFileSystemLayer,
            NodeGitLayer,
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    );
  }

  it("accepts the structured first-reading beside a prose result and never parses the prose", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "I read the code. { this is not JSON",
      structuredOutput: READING,
    });

    const result = await firstTurn();

    expect(result.turn).toMatchObject({ outcome: "answered", sessionId: SESSION });
    expect(result.firstReading?.markdown).toContain("The InvoiceRow column order");
    // Answered on the first call: no corrective resume.
    expect(cli.invocations()).toHaveLength(1);
  });

  it("accepts a structured value whose result text is empty or absent", async () => {
    for (const resultText of ["", null] as const) {
      cli.setScript({ sessionId: SESSION, finalText: "", resultText, structuredOutput: READING });
      const result = await firstTurn();
      expect(result.turn).toMatchObject({ outcome: "answered", sessionId: SESSION });
    }
  });
});

function specDocument(refs: readonly string[]) {
  return {
    $schema: currentSchemaUrl("spec-document"),
    kind: "spec",
    title: "Widget export",
    ground: [{ path: "docs/ideas/widget-export.md", note: "the idea this spec makes precise" }],
    context: "Widgets cannot leave the dashboard.",
    problem: "Operators copy widgets by hand.",
    productGoal: {
      statement: "Export a widget as a file.",
      guidingRule: "An export is a file anyone can read.",
    },
    terminology: [{ term: "export", definition: "a widget written to a file" }],
    requirements: [
      {
        id: "5.1",
        title: "Export a widget",
        pattern: "event",
        statement: "WHEN an operator exports a widget THE system SHALL write it to a file.",
      },
    ],
    surface: [
      {
        surface: "cli: `widget export <id>`",
        summary: "An operator can export a widget to a file.",
        binding: "normative",
        before: null,
        after: "widget export w1\n  wrote w1.json\n  $? = 0",
      },
    ],
    nonGoals: ["importing widgets"],
    acceptanceCriteria: [
      {
        id: "AC-1",
        name: "Export writes a file",
        given: "a widget w1",
        when: "`widget export w1` runs",
        then: "w1.json exists",
        refs,
      },
    ],
    openQuestions: [],
    arbitratedQuestions: [],
    planningNote: { settled: ["one file per widget"], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
  };
}

// ── Headless spec authoring ────────────────────────────────────────────────

describe("a headless spec authoring session answered through structured_output", () => {
  const NOW = "2026-10-30T14:12:00.000Z";
  const resolution: RoutingResolution = {
    requested: { model: "claude-opus-5-5", family: "claude-opus", effort: "high" },
    selected: {
      provider: "claude-code",
      family: "claude-opus",
      concreteModel: "claude-opus-5-5",
      thinking: "high",
    },
    relationship: "exact",
    reason: "exact match",
  };
  const security: ResolvedSecurityConfig = {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  };
  const records: ResolvedRecordsConfig = {
    enabled: false,
    transcript: false,
    destination: { kind: "in-repo" },
    autoPush: false,
  };

  const VALID = specDocument(["5.1"]);

  async function author() {
    const repoRoot = join(root, "repo");
    mkdirSync(join(repoRoot, "docs", "specs"), { recursive: true });
    mkdirSync(join(root, "state"), { recursive: true });
    const git = makeFakeGit();
    git.impl.setHeadCommit("3e9a1c4d".repeat(5));
    const warnings: string[] = [];
    const input: AuthorArtifactInput = {
      kind: "spec",
      slug: "widget-export",
      brief: { text: "Export widgets.\n", path: "brief.md" },
      sourceSpec: null,
      completion: { last: false, notLast: false },
      model: "claude-opus-5-5",
      effort: "high",
      resolution,
      skillText: "# phax-spec skill\n",
      security,
      repoRoot,
      stateRoot: join(root, "state"),
      extractPlanModel: "claude-sonnet-5",
      extractPlanEffort: "medium",
      nowIso: NOW,
      records,
      publishRemote: "origin",
      architectureProvider: false,
      assignmentBounds: false,
      oraclesProvider: false,
      output: { warn: (message) => warnings.push(message) },
    };
    const result = await Effect.runPromise(
      Effect.either(
        authorArtifact(input).pipe(
          Effect.provide(
            Layer.mergeAll(
              makeRootedNodeFileSystemLayer(repoRoot),
              git.layer,
              makeFakeGitHub().layer,
              makeNodeBackendLayer(providerConfig()),
            ),
          ),
        ),
      ),
    );
    const specs = join(repoRoot, "docs", "specs");
    const sidecars = readdirSync(specs).filter((name) => name.endsWith(".json"));
    return { result, warnings, specs, sidecars };
  }

  it("refuses a success with a prose result and no structured_output as not JSON, resumes once and writes from the retry", async () => {
    cli.setScripts([
      { sessionId: SESSION, finalText: "I could not produce a valid object after 4 turns." },
      { sessionId: SESSION, finalText: "", structuredOutput: VALID },
    ]);

    const { result, warnings, specs, sidecars } = await author();

    expect(Either.isRight(result)).toBe(true);
    expect(warnings[0]).toContain("spec document refused");
    expect(warnings[0]).toContain("the session's final message is not JSON");
    expect(cli.invocations()).toHaveLength(2);
    expect(cli.invocations()[1]?.argv).toContain("--resume");
    expect(sidecars).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(specs, sidecars[0]!), "utf8")) as unknown;
    expect(written).toEqual(expect.objectContaining({ title: "Widget export" }));
  });

  it("refuses a structured answer that cites a missing requirement, naming the ref, and writes only from the retry", async () => {
    cli.setScripts([
      {
        sessionId: SESSION,
        finalText: "",
        resultText: "",
        structuredOutput: specDocument(["9.9"]),
      },
      { sessionId: SESSION, finalText: "", structuredOutput: VALID },
    ]);

    const { result, warnings, specs, sidecars } = await author();

    expect(Either.isRight(result)).toBe(true);
    expect(warnings[0]).toContain("spec document refused");
    expect(warnings[0]).toContain("9.9");
    expect(cli.invocations()).toHaveLength(2);
    expect(cli.invocations()[1]?.argv).toContain("--resume");
    expect(sidecars).toHaveLength(1);
    const written = readFileSync(join(specs, sidecars[0]!), "utf8");
    expect(written).toContain('"5.1"');
    expect(written).not.toContain("9.9");
  });
});
