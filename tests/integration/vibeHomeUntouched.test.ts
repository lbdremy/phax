import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { createHash } from "node:crypto";
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
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readExecutedHandoffs } from "../../src/app/interactiveFiles.js";
import { stopAtDeclaredPhase, type DeclaredStopInput } from "../../src/app/interactiveStop.js";
import type { RunId } from "../../src/domain/branded.js";
import type { DeclaredStopReport } from "../../src/domain/errors.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl, withSchemaUrl } from "../../src/schemas/persisted.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { runStatus } from "../helpers/runStatusFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  VIBE3_EXPORT_SHORT,
  vibe3Assistant,
  vibe3ExportText,
  vibe3StreamText,
  vibe3Text,
  writeFakeVibe,
} from "../helpers/vibe3Fixtures.js";

// ac-no-vibe-write: a Vibe phase run to its review stop, over a fake `vibe`, creates or modifies
// no file under VIBE_HOME and leaves no phax backup, with or without PHAX alias blocks. Real git
// on a temporary repository and the real file system.

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
      "Review `InvoiceRow`: the header wording.",
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
  pattern: ["The InvoiceRow column order"],
  copiedBy: [{ phase: "phase-04", what: "the column order" }],
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
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-vibe-home-test-")));
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
  vi.unstubAllEnvs();
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

const PLAIN = 'active_model = "mistral-medium-3.5"\n';
const WITH_PHAX_BLOCK = `${PLAIN}
# Added by PHAX.
[[models]]
alias = "phax-mistral-medium-3.5-off"
name = "mistral-medium-3.5"
provider = "mistral"
`;

/** Every file under `dir` with its sha256, sorted. */
function listing(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(`${path} ${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
    }
  };
  walk(dir);
  return out.toSorted();
}

describe("a Vibe phase run to its review stop", () => {
  it.each([
    ["with a PHAX alias block", WITH_PHAX_BLOCK],
    ["without one", PLAIN],
  ])("leaves VIBE_HOME as it was, %s", async (_name, toml) => {
    const vibeHome = join(root, "vibe-home");
    mkdirSync(vibeHome, { recursive: true });
    writeFileSync(join(vibeHome, "config.toml"), toml);
    vi.stubEnv("VIBE_HOME", vibeHome);
    const before = listing(vibeHome);

    const fake = writeFakeVibe(join(root, "bin"), {
      stream: vibe3StreamText([vibe3Assistant([vibe3Text(JSON.stringify(reading))])]),
      exportText: vibe3ExportText(VIBE3_EXPORT_SHORT),
    });
    const layers = Layer.mergeAll(
      makeNodeBackendLayer({
        ...DEFAULT_PROVIDER_CONFIG,
        providers: {
          ...DEFAULT_PROVIDER_CONFIG.providers,
          "mistral-vibe": { ...providerEntry, executable: fake.executable },
        },
      }),
      NodeFileSystemLayer,
      NodeGitLayer,
      NodeShellLayer,
      NoopSystemTelemetryLayer,
    );
    const report: DeclaredStopReport = await Effect.runPromise(
      stopAtDeclaredPhase(await stopInput()).pipe(Effect.provide(layers)),
    );

    expect(report.cause).toBe("declared");
    expect(fake.turns()).toBeGreaterThanOrEqual(1);
    expect(listing(vibeHome)).toEqual(before);
    expect(readdirSync(vibeHome).filter((name) => name.includes(".phax-backup-"))).toEqual([]);
  });
});
