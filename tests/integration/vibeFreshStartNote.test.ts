import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readExecutedHandoffs } from "../../src/app/interactiveFiles.js";
import { stopAtDeclaredPhase, type DeclaredStopInput } from "../../src/app/interactiveStop.js";
import { renderStop } from "../../src/cli/commands/stopOutput.js";
import type { ClaudeSessionId, RunId } from "../../src/domain/branded.js";
import type { DeclaredStopReport } from "../../src/domain/errors.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl, withSchemaUrl } from "../../src/schemas/persisted.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { runStatus } from "../helpers/runStatusFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// ac-fresh-note: the made-up invoice-export run stops at phase-03, which its plan declares
// interactive, here run under Mistral Vibe at mistral-medium-3.5 / off. Real git on a temporary
// repository, the real file system, and the fake backend playing the provider.

const SESSION = "4f6c1a52-0000-4000-8000-000000000001" as ClaudeSessionId;

function planPhase(id: string, title: string, mode: "headless" | "interactive"): PhaxPlanPhase {
  return {
    id,
    title,
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode,
    acceptance: null,
    testLines: [],
    commit: { subject: `feat(export): ${title.toLowerCase()}`, body: "Made-up body." },
  };
}

const phases: readonly PhaxPlanPhase[] = [
  planPhase("phase-01", "Export port", "headless"),
  planPhase("phase-02", "Invoice CSV record", "headless"),
  planPhase("phase-03", "Review the export record", "interactive"),
  planPhase("phase-04", "Credit notes export", "headless"),
];

const DETAILED = "Review `InvoiceRow`: the header wording, the column order, the missing tax id.";

const planSections = new Map<string, string>([
  ["phase-01", "## phase-01 — Export port\n\nAdd the export port."],
  ["phase-02", "## phase-02 — Invoice CSV record\n\nWrite one CSV row per invoice."],
  [
    "phase-03",
    [
      "## phase-03 — Review the export record",
      "",
      "Intro line.",
      "",
      "### Detailed instructions",
      "",
      DETAILED,
      "",
      "### Verification",
      "",
      "The standard gate.",
    ].join("\n"),
  ],
  ["phase-04", "## phase-04 — Credit notes export\n\nCopy the invoice row for credit notes."],
]);

const reading = {
  $schema: currentSchemaUrl("first-reading"),
  pattern: ["The InvoiceRow column order", "The header wording `invoice_no`"],
  copiedBy: [{ phase: "phase-04", what: "the column order and the header wording" }],
  toCheck: ["Whether `invoice_no` should read `Invoice number`"],
};

let root: string;
let worktree: string;
let runPath: string;
let phaseFolder: string;

const git = (...args: string[]): string =>
  boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd: worktree });

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-vibe-fresh-note-test-")));
  worktree = join(root, "worktrees", "invoice-export", "phase-03");
  runPath = join(root, "runs", "invoice-export");
  phaseFolder = join(runPath, "phase-03");
  mkdirSync(worktree, { recursive: true });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(worktree);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(worktree, ".gitignore"), ".phax-context/\n");
  mkdirSync(join(worktree, "src"));
  writeFileSync(join(worktree, "src", "invoiceRow.ts"), "export const header = 'invoice_no';\n");
  git("add", "-A");
  git("commit", "-m", "feat(export): invoice CSV record");
  mkdirSync(join(worktree, ".phax-context"));
  writeFileSync(join(worktree, ".phax-context", "plan.md"), "# Invoice export\n");

  writeJson(
    join(runPath, "run-status.json"),
    withSchemaUrl(
      "run-status",
      runStatus({
        namespace: "example",
        shortName: "invoice-export",
        runId: "invoice-export-1792667922832",
        state: "running",
        createdAt: "2026-10-22T09:00:00.000Z",
        updatedAt: "2026-10-22T09:00:00.000Z",
        phasesCount: 4,
        currentPhaseIndex: 2,
      }),
    ),
  );
  writeJson(
    join(phaseFolder, "status.json"),
    phaseStatusFile({
      phaseId: "phase-03",
      phaseIndex: 2,
      state: "running",
      model: "claude-sonnet-5-5",
      effort: "medium",
      branchName: "phax/invoice-export--phase-03",
      base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      worktreePath: worktree,
      createdAt: "2026-10-22T09:00:00.000Z",
      updatedAt: "2026-10-22T09:00:00.000Z",
      mode: "interactive",
    }),
  );
  for (const [id, text] of [
    ["phase-01", "## What was delivered\n- The export port."],
    ["phase-02", "## What was delivered\n- InvoiceRow, header `invoice_no`."],
  ] as const) {
    mkdirSync(join(runPath, id), { recursive: true });
    writeFileSync(join(runPath, id, "phase-handoff.md"), text);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDir(root);
});

function policy(): SecurityPolicy {
  return {
    mode: "secure",
    filesystem: { allowRead: [worktree], allowWrite: [worktree, join(root, "home", ".phax")] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: ["pnpm test"],
    failClosed: true,
  };
}

const providerEntry = { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true };

async function stopInput(): Promise<DeclaredStopInput> {
  const executedHandoffs = await Effect.runPromise(
    readExecutedHandoffs(runPath, phases, 2).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  return {
    runId: "invoice-export-1792667922832" as RunId,
    shortName: "invoice-export",
    runPath,
    mainCheckout: join(root, "repo"),
    phases,
    phase: phases[2]!,
    phaseIndex: 2,
    phaseFolder,
    worktree,
    provider: "mistral-vibe",
    model: "mistral-medium-3.5",
    effort: "off",
    providerEntry,
    policy: policy(),
    agentCommands: ["pnpm test"],
    gateCommands: ["pnpm typecheck", "pnpm test"],
    planSections,
    executedHandoffs,
  };
}

async function vibeStop(): Promise<DeclaredStopReport> {
  const backend = makeFakeBackend();
  backend.impl.addRunResponse({
    sessionId: SESSION,
    outputPath: "",
    finalText: JSON.stringify(reading),
  });
  const layers = Layer.mergeAll(
    backend.layer,
    NodeFileSystemLayer,
    NodeGitLayer,
    makeFakeShell().layer,
    NoopSystemTelemetryLayer,
  );
  const input = await stopInput();
  return Effect.runPromise(stopAtDeclaredPhase(input).pipe(Effect.provide(layers)));
}

describe("a Vibe review stop at mistral-medium-3.5 / off", () => {
  it("ac-fresh-note: prints the default-thinking-level note next to the fresh-start command", async () => {
    const report = await vibeStop();
    const lines = renderStop(report);
    const command = lines.findIndex((line) =>
      line.includes("VIBE_ACTIVE_MODEL='mistral-medium-3.5'"),
    );
    expect(command).toBeGreaterThanOrEqual(0);
    const or = lines.findIndex((line, i) => i > command && line.startsWith("    or: "));
    expect(or).toBeGreaterThan(command);
    const between = lines.slice(command + 1, or);
    expect(
      between.some((line) => line.includes("default thinking level") && line.includes("off")),
    ).toBe(true);

    // The stop record is unchanged: exactly cwd, argv and env.
    const record = JSON.parse(readFileSync(report.reviewStopPath, "utf8")) as {
      commands: { freshStart: { argv: string[]; env: Record<string, string> } };
    };
    const { freshStart } = record.commands;
    expect(Object.keys(freshStart).toSorted()).toEqual(["argv", "cwd", "env"]);
    expect(freshStart.env).toEqual({ VIBE_ACTIVE_MODEL: "mistral-medium-3.5" });
    expect(freshStart.argv).not.toContain("--model");
    expect(freshStart.argv).not.toContain("--thinking");
  });
});
