/**
 * `phax prune` acceptance suite (spec run-prune §8), end to end: real config
 * loading, git, filesystem, lock and registry against throwaway roots. Only
 * the prompt layer (vi.mock on src/infra/prompt.js) and `process.stdin.isTTY`
 * are replaced. Exit codes follow spec §5.20: a kept run exits 3, a lock 7.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRegistry } from "../../packages/schemas/src/index.js";
import { prepareRunBranch } from "../../src/app/worktree.js";
import { runPrune, type PruneCommandOptions } from "../../src/cli/commands/prune.js";
import { decodeShortName } from "../../src/domain/branded.js";
import { formatBytes } from "../../src/domain/prune.js";
import { nextAvailableShortName, runKey } from "../../src/domain/runRef.js";
import { makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeNodeLockLayer } from "../../src/infra/lock.js";
import { Lock } from "../../src/ports/lock.js";
import { Prompt } from "../../src/ports/prompt.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  addBranch,
  addNonArchivedEntry,
  addRecordsBranch,
  addRemoteTrackingRef,
  apparentSize,
  branchExists,
  createPruneRepo,
  findEntry,
  git,
  headOf,
  readRegistryEntries,
  recordingOutput,
  refExists,
  registryPath,
  removePruneRepo,
  seedArchivedRun,
  RECORDS_BRANCH,
  type PruneRepo,
  type SeededRun,
} from "./helpers/pruneRepo.js";

const promptState = vi.hoisted(() => ({ layer: undefined as unknown }));

vi.mock("../../src/infra/prompt.js", () => ({
  makeClackPromptLayer: () => promptState.layer,
}));

let roots: PruneRepo;
let events: string[];
let asks: string[];
let originalCwd: string;
let originalIsTTY: PropertyDescriptor | undefined;
const restoreModes: string[] = [];

/** Script the prompt: each confirm is recorded in `events`, in order with the output. */
function scriptPrompt(answers: (boolean | symbol)[]): void {
  const { impl } = makeFakePrompt(answers as never);
  const confirm = impl.confirm.bind(impl);
  impl.confirm = (opts) => {
    events.push(`prompt: ${opts.message}`);
    return confirm(opts);
  };
  asks = impl.asks;
  promptState.layer = Layer.succeed(Prompt, impl);
}

function setStdinTTY(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
}

async function prune(names: string[], opts: PruneCommandOptions = {}) {
  const out = recordingOutput(events);
  const code = await runPrune(names, opts, out.port);
  return {
    code,
    logs: out.logs,
    errors: out.errors,
    text: [...out.logs, ...out.errors].join("\n"),
  };
}

/** The archive folder's apparent size, formatted as prune renders it. */
function archiveSize(run: SeededRun): string {
  return formatBytes(apparentSize(run.archivePath));
}

function expectRunWhole(run: SeededRun): void {
  expect(findEntry(roots, run.entry.shortName, run.entry.namespace)).toEqual(run.entry);
  expect(existsSync(run.archivePath)).toBe(true);
  for (const branch of run.branches) expect(branchExists(roots, branch), branch).toBe(true);
}

function expectRunGone(run: SeededRun): void {
  expect(findEntry(roots, run.entry.shortName, run.entry.namespace)).toBeUndefined();
  expect(existsSync(run.archivePath)).toBe(false);
  for (const branch of run.branches) expect(branchExists(roots, branch), branch).toBe(false);
}

beforeEach(() => {
  roots = createPruneRepo();
  events = [];
  scriptPrompt([]);
  originalCwd = process.cwd();
  process.chdir(roots.repo);
  originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  setStdinTTY(false);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalIsTTY === undefined) {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  } else {
    Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
  }
  for (const path of restoreModes.splice(0)) {
    if (existsSync(path)) chmodSync(path, 0o755);
  }
  removePruneRepo(roots);
});

describe("phax prune", { timeout: 30_000 }, () => {
  it("deletes an archived run for real and exits 0", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea", withWorktree: true });
    expect(git(["worktree", "list", "--porcelain"], roots.repo)).toContain(roots.stateRoot);
    const size = formatBytes(apparentSize(run.archivePath));

    const result = await prune(["old-idea"], { yes: true });

    expect(result.code).toBe(0);
    expect(run.branches).toHaveLength(4);
    expectRunGone(run);
    expect(git(["worktree", "list", "--porcelain"], roots.repo)).not.toContain(roots.stateRoot);
    expect(result.logs).toContain(
      `✓ acme.old-idea pruned — ${size} freed, 4 local branches deleted`,
    );
  });

  it("accepts a name qualified with the current namespace", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });

    const result = await prune(["acme.old-idea"], { yes: true });

    expect(result.code).toBe(0);
    expectRunGone(run);
  });

  it("--all prunes only the namespace's archived runs", async () => {
    const a = seedArchivedRun(roots, { shortName: "a" });
    const b = seedArchivedRun(roots, { shortName: "b" });
    const c = addNonArchivedEntry(roots, "c", "review_open");
    const d = seedArchivedRun(roots, { shortName: "d", namespace: "other" });

    const result = await prune([], { all: true, yes: true });

    expect(result.code).toBe(0);
    expectRunGone(a);
    expectRunGone(b);
    expect(readRegistryEntries(roots)).toEqual([c, d.entry]);
    expectRunWhole(d);
  });

  it("--all with nothing to prune asks nothing and exits 0", async () => {
    addNonArchivedEntry(roots, "c", "review_open");
    setStdinTTY(true);

    const result = await prune([], { all: true });

    expect(result.code).toBe(0);
    expect(asks).toEqual([]);
    expect(result.text).toContain("Nothing to prune");
  });

  it("refuses with exit 1 unless exactly one selection form is given", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });
    const before = readFileSync(registryPath(roots), "utf8");

    const neither = await prune([], { yes: true });
    const both = await prune(["old-idea"], { all: true, yes: true });

    for (const result of [neither, both]) {
      expect(result.code).toBe(1);
      expect(result.text).toContain("phax prune <short-name>...");
      expect(result.text).toContain("phax prune --all");
    }
    expect(readFileSync(registryPath(roots), "utf8")).toBe(before);
    expectRunWhole(run);
  });

  it("exits 1 outside a phax project and leaves the registry unchanged", async () => {
    seedArchivedRun(roots, { shortName: "old-idea" });
    const before = readFileSync(registryPath(roots), "utf8");
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "phax-prune-elsewhere-")));
    try {
      git(["init", "-q", "-b", "main"], elsewhere);
      disableGitAutoMaintenance(elsewhere);
      process.chdir(elsewhere);

      const result = await prune([], { all: true, yes: true });

      expect(result.code).toBe(1);
      expect(readFileSync(registryPath(roots), "utf8")).toBe(before);
    } finally {
      process.chdir(roots.repo);
      removeTempDir(elsewhere);
    }
  });

  it("refuses the whole command for a non-archived run, naming its state", async () => {
    addNonArchivedEntry(roots, "feature-x", "review_open");
    const run = seedArchivedRun(roots, { shortName: "old-idea" });

    const result = await prune(["feature-x", "old-idea"], { yes: true });

    expect(result.code).toBe(1);
    expect(result.errors).toContain(
      '✗ prune refused: run "acme.feature-x" is review_open, not archived — archive it first: phax archive feature-x',
    );
    expectRunWhole(run);
  });

  it("refuses the whole command for an unknown name", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });

    const result = await prune(["ghost", "old-idea"], { yes: true });

    expect(result.code).toBe(1);
    expect(result.errors).toContain('✗ prune refused: run "acme.ghost" not found');
    expectRunWhole(run);
  });

  it("refuses a run of another namespace", async () => {
    const run = seedArchivedRun(roots, { shortName: "cover-flow", namespace: "louloupapers" });

    const result = await prune(["louloupapers.cover-flow"], { yes: true });

    expect(result.code).toBe(1);
    expect(result.text).toContain('namespace "louloupapers"');
    expect(result.text).toContain("run phax prune from that repository");
    expectRunWhole(run);
  });

  it("refuses with exit 7 when a selected run is locked, pruning neither run", async () => {
    const locked = seedArchivedRun(roots, { shortName: "old-idea" });
    const spare = seedArchivedRun(roots, { shortName: "spare" });
    await Effect.runPromise(
      Effect.flatMap(Lock, (lock) => lock.acquire(runKey(roots.namespace, "old-idea"))).pipe(
        Effect.provide(makeNodeLockLayer(roots.stateRoot)),
      ),
    );

    const result = await prune(["old-idea", "spare"], { yes: true });

    expect(result.code).toBe(7);
    expect(result.text).toContain("acme.old-idea");
    expect(result.text).toContain("phax unlock old-idea");
    expectRunWhole(locked);
    expectRunWhole(spare);
  });

  it("keeps records, remote-tracking refs and neighbouring runs' branches", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });
    const recordsTip = addRecordsBranch(roots);
    addRemoteTrackingRef(roots, "origin/phax/old-idea--phase-02", "phax/old-idea--phase-02");
    addBranch(roots, "phax/old-idea-2");
    addBranch(roots, "phax/old-idea-2--phase-01");

    const result = await prune(["old-idea"], { yes: true });

    expect(result.code).toBe(0);
    expectRunGone(run);
    expect(headOf(roots, RECORDS_BRANCH)).toBe(recordsTip);
    expect(refExists(roots, "refs/remotes/origin/phax/old-idea--phase-02")).toBe(true);
    expect(branchExists(roots, "phax/old-idea-2")).toBe(true);
    expect(branchExists(roots, "phax/old-idea-2--phase-01")).toBe(true);
  });

  it("keeps a run whole when a branch holds unpreserved commits, exiting 3", async () => {
    const run = seedArchivedRun(roots, {
      shortName: "spike",
      unpreserved: { phase: 2, commits: 2 },
    });

    const result = await prune(["spike"], { yes: true });

    expect(result.code).toBe(3);
    expectRunWhole(run);
    expect(result.logs).toContain(
      "○ acme.spike kept — phax/spike--phase-02 holds 2 unpreserved commit(s)",
    );
  });

  it("prunes a run whose commits a remote-tracking ref preserves", async () => {
    const run = seedArchivedRun(roots, {
      shortName: "shipped",
      unpreserved: { phase: 3, commits: 1 },
    });
    addRemoteTrackingRef(roots, "origin/phax/shipped--phase-03", "phax/shipped--phase-03");

    const result = await prune(["shipped"], { yes: true });

    expect(result.code).toBe(0);
    expectRunGone(run);
    expect(refExists(roots, "refs/remotes/origin/phax/shipped--phase-03")).toBe(true);
  });

  it("--force discards unpreserved commits and exits 0", async () => {
    const run = seedArchivedRun(roots, {
      shortName: "spike",
      unpreserved: { phase: 2, commits: 2 },
    });

    const result = await prune(["spike"], { force: true, yes: true });

    expect(result.code).toBe(0);
    expectRunGone(run);
    expect(result.logs).toContain(
      "  discarded: phax/spike--phase-02 holds 2 unpreserved commit(s)",
    );
  });

  it("keeps a run whose branch is checked out, even with --force, exiting 3", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });
    git(["checkout", "-q", "phax/old-idea--phase-03"], roots.repo);

    const result = await prune(["old-idea"], { force: true, yes: true });

    expect(result.code).toBe(3);
    expectRunWhole(run);
    expect(result.logs).toContain(
      `○ acme.old-idea kept — phax/old-idea--phase-03 is checked out in ${roots.repo}`,
    );
  });

  it("--dry-run previews every run and deletes nothing", async () => {
    const a = seedArchivedRun(roots, { shortName: "a" });
    const b = seedArchivedRun(roots, { shortName: "b", unpreserved: { phase: 1, commits: 1 } });
    setStdinTTY(true);

    const result = await prune(["a", "b"], { dryRun: true });

    expect(result.code).toBe(0);
    expect(asks).toEqual([]);
    expect(result.logs[0]).toBe('Prune from namespace "acme":');
    expect(result.logs[1]).toBe(
      `  acme.a  prune  ${archiveSize(a)}  branches: phax/a, phax/a--phase-01, phax/a--phase-02, phax/a--phase-03 (4)`,
    );
    expect(result.logs[2]).toBe(
      `  acme.b  keep   ${archiveSize(b)}  phax/b--phase-01 holds 1 unpreserved commit(s) (--force discards them)`,
    );
    expectRunWhole(a);
    expectRunWhole(b);
  });

  it("deletes nothing when the operator declines the prompt, exiting 1", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });
    setStdinTTY(true);
    scriptPrompt([false]);

    const result = await prune(["old-idea"]);

    expect(result.code).toBe(1);
    expectRunWhole(run);
    const preview = events.indexOf('log: Prune from namespace "acme":');
    const question = events.findIndex((e) => e.startsWith("prompt: Prune 1 run(s), freeing "));
    expect(preview).toBeGreaterThanOrEqual(0);
    expect(question).toBeGreaterThan(preview);
  });

  it("prunes when the operator accepts the prompt, exiting 0", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });
    setStdinTTY(true);
    scriptPrompt([true]);

    const result = await prune(["old-idea"]);

    expect(result.code).toBe(0);
    expectRunGone(run);
    const preview = events.indexOf('log: Prune from namespace "acme":');
    const question = events.findIndex((e) => e.startsWith("prompt: Prune 1 run(s), freeing "));
    expect(preview).toBeGreaterThanOrEqual(0);
    expect(question).toBeGreaterThan(preview);
  });

  it("refuses without a TTY and without --yes, naming --yes", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea" });

    const result = await prune(["old-idea"]);

    expect(result.code).toBe(1);
    expect(result.logs[0]).toBe('Prune from namespace "acme":');
    expect(result.errors).toContain(
      "✗ prune refused: no TTY to confirm; pass --yes to proceed or --dry-run to preview only",
    );
    expect(asks).toEqual([]);
    expectRunWhole(run);
  });

  it("reports the same bytes as the preview, the branches deleted and a total", async () => {
    const run = seedArchivedRun(roots, {
      shortName: "old-idea",
      payloadBytes: 3_300_000,
      withWorktree: true,
    });
    const size = formatBytes(apparentSize(run.archivePath));

    const result = await prune(["old-idea"], { yes: true });

    expect(result.code).toBe(0);
    expect(result.logs[1]).toContain(`  acme.old-idea  prune  ${size}  branches: `);
    expect(result.logs).toContain(
      `✓ acme.old-idea pruned — ${size} freed, 4 local branches deleted`,
    );
    expect(result.logs.at(-1)).toBe(`Pruned 1 of 1 runs, ${size} freed.`);
  });

  it("flags the remote branches that survive a pruned run", async () => {
    seedArchivedRun(roots, { shortName: "old-idea" });
    addRemoteTrackingRef(roots, "origin/phax/old-idea--phase-03", "phax/old-idea--phase-03");

    const result = await prune(["old-idea"], { yes: true });

    expect(result.code).toBe(0);
    expect(result.logs).toContain(
      "  ! remote branches kept: origin/phax/old-idea--phase-03 — a future run named old-idea will meet them at publish-pr",
    );
  });

  it("completes an interrupted prune, reporting the parts already absent", async () => {
    const run = seedArchivedRun(roots, { shortName: "old-idea", branches: false });
    rmSync(run.archivePath, { recursive: true, force: true });

    const result = await prune(["old-idea"], { yes: true });

    expect(result.code).toBe(0);
    expect(findEntry(roots, "old-idea")).toBeUndefined();
    expect(result.logs).toContain(
      "  already absent: archive folder, worktree metadata, branch phax/old-idea, branch phax/old-idea--phase-01, branch phax/old-idea--phase-02, branch phax/old-idea--phase-03",
    );
  });

  it.skipIf(process.getuid?.() === 0)(
    "keeps a run whose folder cannot be removed and prunes the next, exiting 3",
    async () => {
      const a = seedArchivedRun(roots, { shortName: "a" });
      const b = seedArchivedRun(roots, { shortName: "b" });
      chmodSync(a.archivePath, 0o555);
      restoreModes.push(a.archivePath);

      const result = await prune(["a", "b"], { yes: true });

      expect(result.code).toBe(3);
      expect(findEntry(roots, "a")).toEqual(a.entry);
      expectRunGone(b);
      const line = result.logs.find((l) => l.startsWith("○ acme.a kept — "));
      expect(line).toMatch(/^○ acme\.a kept — could not remove archive folder: \S/);
      expect(line).not.toContain("\n");
      expect(result.text).not.toMatch(/^\s+at /m);
    },
  );

  it("--json emits one document and never prompts", async () => {
    const a = seedArchivedRun(roots, { shortName: "a" });
    const b = seedArchivedRun(roots, { shortName: "b", unpreserved: { phase: 2, commits: 2 } });

    const preview = await prune(["a", "b"], { json: true, dryRun: true });

    expect(preview.code).toBe(0);
    expect(preview.logs).toHaveLength(1);
    const doc = JSON.parse(preview.logs[0]!) as {
      namespace: string;
      dryRun: boolean;
      runs: {
        name: string;
        outcome: string;
        archiveBytes: number;
        branchesDeleted: string[];
        kept: { reason: string } | null;
      }[];
      totals: { pruned: number; kept: number; bytesFreed: number };
    };
    expect(doc.namespace).toBe("acme");
    expect(doc.dryRun).toBe(true);
    expect(doc.runs.map((r) => [r.name, r.outcome])).toEqual([
      ["acme.a", "would-prune"],
      ["acme.b", "would-keep"],
    ]);
    expect(doc.runs[0]!.archiveBytes).toBe(apparentSize(a.archivePath));
    expect(doc.runs[0]!.branchesDeleted).toEqual(a.branches);
    expect(doc.runs[1]!.kept?.reason).toBe("unpreserved-commits");
    expect(doc.totals).toEqual({ pruned: 1, kept: 1, bytesFreed: apparentSize(a.archivePath) });

    setStdinTTY(true);
    const onTty = await prune(["a", "b"], { json: true });

    expect(onTty.code).toBe(1);
    expect(asks).toEqual([]);
    expect(onTty.logs).toHaveLength(1);
    expect((JSON.parse(onTty.logs[0]!) as { dryRun: boolean }).dryRun).toBe(false);
    expect(onTty.errors.join("\n")).toContain("--yes");
    expectRunWhole(a);
    expectRunWhole(b);
  });

  it("--json --yes reports the applied outcomes and the bytes freed", async () => {
    const a = seedArchivedRun(roots, { shortName: "a", payloadBytes: 12_345 });
    const size = apparentSize(a.archivePath);

    const result = await prune(["a"], { json: true, yes: true });

    expect(result.code).toBe(0);
    expect(result.logs).toHaveLength(1);
    const doc = JSON.parse(result.logs[0]!) as {
      runs: { outcome: string; archiveBytes: number; branchesDeleted: string[] }[];
      totals: { pruned: number; kept: number; bytesFreed: number };
    };
    expect(doc.runs[0]!.outcome).toBe("pruned");
    expect(doc.runs[0]!.archiveBytes).toBe(size);
    expect(doc.runs[0]!.branchesDeleted).toEqual(a.branches);
    expect(doc.totals).toEqual({ pruned: 1, kept: 0, bytesFreed: size });
  });

  it("keeps the registry's format and leaves every other entry unchanged", async () => {
    seedArchivedRun(roots, { shortName: "old-idea" });
    const spare = seedArchivedRun(roots, { shortName: "spare" });
    const open = addNonArchivedEntry(roots, "feature-x", "review_open");
    const before = JSON.parse(readFileSync(registryPath(roots), "utf8")) as { $schema: string };

    const result = await prune(["old-idea"], { yes: true });

    expect(result.code).toBe(0);
    const raw = JSON.parse(readFileSync(registryPath(roots), "utf8")) as {
      $schema: string;
      runs: unknown[];
    };
    expect(raw.$schema).toBe(before.$schema);
    expect(parseRegistry(raw).ok).toBe(true);
    expect(raw.runs).toEqual([spare.entry, open]);
  });

  it("frees the bare name: the next run gets it and a fresh branch", async () => {
    const run = seedArchivedRun(roots, { shortName: "run-prune", phasesCount: 4 });
    const oldTip = headOf(roots, "phax/run-prune");
    git(["commit", "-q", "--allow-empty", "-m", "chore: move main on"], roots.repo);

    const result = await prune(["run-prune"], { yes: true });

    expect(result.code).toBe(0);
    expectRunGone(run);
    expect(findEntry(roots, "run-prune")).toBeUndefined();
    const runsDir = join(roots.stateRoot, "runs");
    expect(existsSync(join(runsDir, "run-prune"))).toBe(false);

    // The registry-plus-runs-folder predicate `phax run` names a run with.
    const registry = readRegistryEntries(roots);
    const isUsed = (name: string): boolean =>
      registry.some((r) => r.namespace === roots.namespace && r.shortName === name) ||
      existsSync(join(runsDir, name));
    const base = decodeShortName("run-prune");
    if (Either.isLeft(base)) throw new Error(base.left.message);
    const shortName = nextAvailableShortName(base.right, isUsed);
    expect(shortName).toBe("run-prune");

    await Effect.runPromise(
      prepareRunBranch(shortName, "phax/run-prune", roots.repo).pipe(Effect.provide(NodeGitLayer)),
    );
    expect(headOf(roots, "phax/run-prune")).toBe(headOf(roots, "main"));
    expect(headOf(roots, "phax/run-prune")).not.toBe(oldTip);
  });
});
