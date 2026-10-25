// readEstimateHistory on the fake FileSystem and Git with made-up runs: kept
// active and archived runs, pruned copies, unledgered and unreadable runs,
// another namespace's run and runs that cannot be sized.
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { readEstimateHistory, type EstimateHistory } from "../../src/app/estimateHistory.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import type { RegistryEntry } from "../../src/schemas/registry.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import {
  daysAgo,
  ledgerEntry,
  ledgerJson,
  phaxPlanJson,
  registryEntry,
  registryJson,
} from "../helpers/costHistory.js";

const STATE = "/state";
const REPO = "/repo";
const BASE = "b".repeat(40);

function setup() {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const read = (): Promise<EstimateHistory> =>
    Effect.runPromise(
      readEstimateHistory({ stateRoot: STATE, repoRoot: REPO, namespace: "demo" }).pipe(
        Effect.provide(Layer.merge(fs.layer, git.layer)),
      ),
    );
  return { fs: fs.impl, git: git.impl, read };
}

const active = registryEntry({
  shortName: "alpha",
  runId: "run-a",
  createdAt: daysAgo(10),
});
const activeFolder = `${STATE}/runs/demo.alpha`;

const archived = registryEntry({
  shortName: "beta",
  runId: "run-b",
  state: "archived",
  archivePath: `${STATE}/archive/demo.beta`,
  createdAt: daysAgo(5),
});
const archivedFolder = `${STATE}/archive/demo.beta/runs`;

function writeRegistry(fs: ReturnType<typeof setup>["fs"], entries: readonly RegistryEntry[]) {
  fs.setFile(`${STATE}/registry.json`, registryJson(entries));
}

/**
 * `phaxPlanJson`'s plan as an older phax wrote it: stamped 0.25.0 with no
 * mode, oracle or testLines, or stamped 0.26.0 with no testLines.
 */
function olderPhaxPlanJson(
  stamp: "0.25.0" | "0.26.0",
  phases: Parameters<typeof phaxPlanJson>[0],
): string {
  const plan = JSON.parse(phaxPlanJson(phases)) as { phases: Array<Record<string, unknown>> };
  return JSON.stringify({
    ...plan,
    $schema: schemaUrl("phax-plan", stamp),
    phases: plan.phases.map(({ mode, oracle, testLines: _lines, ...phase }) =>
      stamp === "0.26.0" ? { ...phase, mode, oracle } : phase,
    ),
  });
}

describe("readEstimateHistory", () => {
  // Literal releases: the answer must not change when a release is cut.
  it.each(["0.25.0", "0.26.0"] as const)(
    "sizes a run whose phax-plan.json an older phax stamped %s, read lifted",
    async (stamp) => {
      const { fs, git, read } = setup();
      writeRegistry(fs, [archived]);
      fs.setFile(`${archivedFolder}/cost-ledger.json`, ledgerJson([ledgerEntry({ costUsd: 5 })]));
      fs.setFile(
        `${archivedFolder}/phax-plan.json`,
        olderPhaxPlanJson(stamp, [{ id: "phase-01", edit: ["a.ts"] }]),
      );
      git.addDatedCommit(BASE, daysAgo(20), { "a.ts": 1000 });

      const history = await read();

      expect(history.sizedRuns.map((run) => run.runKey)).toEqual(["demo.beta.run-b"]);
      expect(history.sizedRuns[0]!.phases).toMatchObject([{ id: "phase-01", editBytes: 1000 }]);
    },
  );

  it("reads kept active and archived runs, sizes them, and adds a pruned copy", async () => {
    const { fs, git, read } = setup();
    writeRegistry(fs, [active, archived]);
    fs.setFile(`${activeFolder}/cost-ledger.json`, ledgerJson([ledgerEntry({ costUsd: 3 })]));
    fs.setFile(
      `${activeFolder}/phax-plan.json`,
      phaxPlanJson([
        { id: "phase-01", effort: "medium", edit: ["a.ts", "b.ts"], optional: ["c.ts"] },
        { id: "phase-02", mode: "interactive", create: ["new.ts", "other.ts"], edit: ["a.ts"] },
      ]),
    );
    fs.setFile(`${archivedFolder}/cost-ledger.json`, ledgerJson([ledgerEntry({ costUsd: 5 })]));
    fs.setFile(`${archivedFolder}/phax-plan.json`, phaxPlanJson([{ id: "phase-01" }]));
    fs.setFile(
      `${STATE}/cost-ledgers/demo.gamma.run-c.json`,
      ledgerJson([ledgerEntry({ costUsd: 7 })]),
    );
    git.addDatedCommit(BASE, daysAgo(20), { "a.ts": 1000, "b.ts": 200, "c.ts": 30 });

    const history = await read();

    expect(history.ledgers.map((source) => source.runKey)).toEqual([
      "demo.alpha.run-a",
      "demo.beta.run-b",
      "demo.gamma.run-c",
    ]);
    expect(history.ledgers.map((source) => source.ledger.entries[0]!.costUsd)).toEqual([3, 5, 7]);
    expect(history.sizedRuns).toEqual([
      {
        runKey: "demo.alpha.run-a",
        startedAt: active.createdAt,
        phases: [
          {
            id: "phase-01",
            model: "claude-opus-5-5",
            effort: "medium",
            mode: "headless",
            editBytes: 1200,
            optionalBytes: 30,
            createCount: 0,
          },
          {
            id: "phase-02",
            model: "claude-opus-5-5",
            effort: "high",
            mode: "interactive",
            editBytes: 1000,
            optionalBytes: 0,
            createCount: 2,
          },
        ],
      },
      {
        runKey: "demo.beta.run-b",
        startedAt: archived.createdAt,
        phases: [
          {
            id: "phase-01",
            model: "claude-opus-5-5",
            effort: "high",
            mode: "headless",
            editBytes: 0,
            optionalBytes: 0,
            createCount: 0,
          },
        ],
      },
    ]);
    expect(git.calls).toContainEqual({
      method: "commitBefore",
      repo: REPO,
      instant: active.createdAt,
    });
    expect(git.calls).toContainEqual({
      method: "blobSizes",
      repo: REPO,
      commit: BASE,
      paths: ["a.ts", "b.ts", "c.ts"],
    });
    expect(history.unledgeredRuns).toBe(0);
    expect(history.skipped).toEqual([]);
  });

  it("ignores a pruned copy whose run a registered run already gave", async () => {
    const { fs, git, read } = setup();
    writeRegistry(fs, [active]);
    fs.setFile(`${activeFolder}/cost-ledger.json`, ledgerJson([ledgerEntry({ costUsd: 3 })]));
    fs.setFile(`${activeFolder}/phax-plan.json`, phaxPlanJson([{ id: "phase-01" }]));
    fs.setFile(
      `${STATE}/cost-ledgers/demo.alpha.run-a.json`,
      ledgerJson([ledgerEntry({ costUsd: 99 })]),
    );
    git.addDatedCommit(BASE, daysAgo(20));

    const history = await read();

    expect(history.ledgers).toHaveLength(1);
    expect(history.ledgers[0]!.ledger.entries[0]!.costUsd).toBe(3);
  });

  it("counts a run folder without a ledger as unledgered, and ignores a missing folder", async () => {
    const { fs, read } = setup();
    const gone = registryEntry({ shortName: "gone", runId: "run-g" });
    writeRegistry(fs, [active, gone]);
    fs.setFile(`${activeFolder}/run-status.json`, "{}");

    const history = await read();

    expect(history.unledgeredRuns).toBe(1);
    expect(history.ledgers).toEqual([]);
    expect(history.sizedRuns).toEqual([]);
  });

  it("skips an undecodable ledger and a non-JSON pruned copy by path, without failing", async () => {
    const { fs, read } = setup();
    writeRegistry(fs, [active]);
    fs.setFile(`${activeFolder}/cost-ledger.json`, JSON.stringify({ entries: "nope" }));
    fs.setFile(`${STATE}/cost-ledgers/demo.delta.run-d.json`, "not json at all");

    const history = await read();

    expect(history.ledgers).toEqual([]);
    expect(history.skipped).toEqual([
      { path: `${activeFolder}/cost-ledger.json`, reason: "the cost ledger could not be decoded" },
      {
        path: `${STATE}/cost-ledgers/demo.delta.run-d.json`,
        reason: "the pruned cost ledger could not be decoded",
      },
    ]);
  });

  it("skips a ledger it cannot read by path and goes on with the rest", async () => {
    const { fs, read } = setup();
    writeRegistry(fs, [active]);
    // A directory where a file is expected: it exists, but reading it fails.
    fs.addDir(activeFolder);
    fs.addDir(`${activeFolder}/cost-ledger.json`);
    fs.setFile(`${STATE}/cost-ledgers/demo.delta.run-d.json/stray`, "");
    fs.setFile(
      `${STATE}/cost-ledgers/demo.gamma.run-c.json`,
      ledgerJson([ledgerEntry({ costUsd: 7 })]),
    );

    const history = await read();

    expect(history.ledgers.map((source) => source.runKey)).toEqual(["demo.gamma.run-c"]);
    expect(history.skipped).toEqual([
      { path: `${activeFolder}/cost-ledger.json`, reason: "the cost ledger could not be read" },
      {
        path: `${STATE}/cost-ledgers/demo.delta.run-d.json`,
        reason: "the pruned cost ledger could not be read",
      },
    ]);
  });

  it("reads another namespace's run for its ledger only", async () => {
    const { fs, git, read } = setup();
    const other = registryEntry({ namespace: "elsewhere", shortName: "omega", runId: "run-o" });
    writeRegistry(fs, [other]);
    const folder = `${STATE}/runs/elsewhere.omega`;
    fs.setFile(`${folder}/cost-ledger.json`, ledgerJson([ledgerEntry({ costUsd: 4 })]));
    fs.setFile(`${folder}/phax-plan.json`, phaxPlanJson([{ id: "phase-01", edit: ["a.ts"] }]));
    git.addDatedCommit(BASE, daysAgo(400), { "a.ts": 10 });

    const history = await read();

    expect(history.ledgers.map((source) => source.runKey)).toEqual(["elsewhere.omega.run-o"]);
    expect(history.sizedRuns).toEqual([]);
    expect(git.calls).toEqual([]);
  });

  it("leaves a run unsized when no commit precedes it, keeping its ledger", async () => {
    const { fs, git, read } = setup();
    writeRegistry(fs, [active]);
    fs.setFile(`${activeFolder}/cost-ledger.json`, ledgerJson([ledgerEntry({ costUsd: 3 })]));
    fs.setFile(`${activeFolder}/phax-plan.json`, phaxPlanJson([{ id: "phase-01" }]));
    git.addDatedCommit(BASE, daysAgo(1));

    const history = await read();

    expect(history.ledgers.map((source) => source.runKey)).toEqual(["demo.alpha.run-a"]);
    expect(history.sizedRuns).toEqual([]);
    expect(history.skipped).toEqual([
      {
        path: `${activeFolder}/phax-plan.json`,
        reason: `no commit before ${active.createdAt}: the run is not sized`,
      },
    ]);
  });

  it("leaves a run unsized on a missing plan or a git failure, keeping its ledger", async () => {
    const { fs, git, read } = setup();
    writeRegistry(fs, [active, archived]);
    fs.setFile(`${activeFolder}/cost-ledger.json`, ledgerJson([ledgerEntry({ costUsd: 3 })]));
    fs.setFile(`${archivedFolder}/cost-ledger.json`, ledgerJson([ledgerEntry({ costUsd: 5 })]));
    fs.setFile(`${archivedFolder}/phax-plan.json`, phaxPlanJson([{ id: "phase-01" }]));
    git.addDatedCommit(BASE, daysAgo(20));
    git.failBlobSizes(BASE);

    const history = await read();

    expect(history.ledgers).toHaveLength(2);
    expect(history.sizedRuns).toEqual([]);
    expect(history.skipped).toEqual([
      { path: `${activeFolder}/phax-plan.json`, reason: "no phax-plan.json: the run is not sized" },
      {
        path: `${archivedFolder}/phax-plan.json`,
        reason: "git could not size the planned files",
      },
    ]);
  });
});
