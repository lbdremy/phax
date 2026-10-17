// `phax prune` keeps a pruned run's cost ledger: before the archive folder is
// deleted, runs/cost-ledger.json is copied byte for byte to
// <stateRoot>/cost-ledgers/<namespace>.<short-name>.<run-id>.json. A dry run
// copies nothing, and a failed copy keeps the run with part `cost ledger`.
// Fake ports and a made-up state root; the ledger content is made up.
import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { prune, type PruneInput } from "../../src/app/prune.js";
import type { PruneResult } from "../../src/domain/prune.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import { FileSystem, FsError, type FileSystemOps } from "../../src/ports/fs.js";
import type { RegistryEntry } from "../../src/schemas/registry.js";

const stateRoot = "/state";
const repoRoot = "/repo";
const ns = "phax";
const archive = `${stateRoot}/archive/${ns}.old-idea`;
const ledgerPath = `${archive}/runs/cost-ledger.json`;
const keptPath = `${stateRoot}/cost-ledgers/${ns}.old-idea.old-idea-2026-10-01.json`;
// Deliberately not how phax would format it: the copy must not re-serialise.
const LEDGER = '{"$schema":"x",  "entries": []}\n';

function makeEnv(opts: { failKeptWrite?: boolean } = {}) {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const lock = makeFakeLock();
  const prompt = makeFakePrompt([]);
  git.impl.addExistingBranch("main");
  git.impl.addWorktreeEntry({ path: repoRoot, branch: "main", prunable: false });

  const entry: RegistryEntry = {
    namespace: ns,
    shortName: "old-idea",
    runId: "old-idea-2026-10-01",
    state: "archived",
    branch: "phax/old-idea",
    projectName: "phax",
    phasesCount: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    archivePath: archive,
  };
  fs.impl.setFile(`${stateRoot}/registry.json`, JSON.stringify({ version: 1, runs: [entry] }));
  fs.impl.setFile(`${archive}/runs/run-status.json`, "{}");
  fs.impl.setFile(ledgerPath, LEDGER);
  git.impl.addExistingBranch("phax/old-idea");
  git.impl.addExistingBranch("phax/old-idea--phase-01");

  // A view of the fake whose writes under cost-ledgers/ fail.
  const ops: FileSystemOps = Object.assign(Object.create(fs.impl) as FileSystemOps, {
    writeAtomic: (path: string, content: string) =>
      opts.failKeptWrite === true && path.startsWith(`${stateRoot}/cost-ledgers/`)
        ? Effect.fail(new FsError({ message: "EACCES: permission denied, open" }))
        : fs.impl.writeAtomic(path, content),
  });
  const layer = Layer.mergeAll(Layer.succeed(FileSystem, ops), git.layer, lock.layer, prompt.layer);

  const run = (input: Partial<PruneInput> = {}) =>
    Effect.runPromise(
      Effect.either(
        prune({
          namespace: ns,
          stateRoot,
          repoRoot,
          selection: { kind: "names", refs: ["old-idea"] },
          force: false,
          confirmation: "yes",
          onPreview: () => Effect.void,
          ...input,
        }).pipe(Effect.provide(layer)),
      ),
    );

  return { fs, run };
}

function applied(result: Either.Either<PruneResult, unknown>) {
  const value = Either.getOrThrow(result);
  if (value.kind !== "applied") throw new Error(`expected applied, got ${value.kind}`);
  return value;
}

describe("prune keeps the cost ledger", () => {
  it("copies the ledger byte for byte under cost-ledgers/ and removes the archive folder", async () => {
    const env = makeEnv();

    const result = applied(await env.run());

    expect(result.report.runs[0]).toMatchObject({ outcome: "pruned", kept: null });
    expect(env.fs.impl.getFile(keptPath)).toBe(LEDGER);
    expect(await Effect.runPromise(env.fs.impl.exists(archive))).toBe(false);
  });

  it("copies nothing on a dry run", async () => {
    const env = makeEnv();

    const result = Either.getOrThrow(await env.run({ confirmation: "dry-run" }));

    expect(result.kind).toBe("previewed");
    expect(env.fs.impl.getFile(keptPath)).toBeUndefined();
    expect(env.fs.impl.getFile(ledgerPath)).toBe(LEDGER);
  });

  it("keeps the whole run when the copy fails", async () => {
    const env = makeEnv({ failKeptWrite: true });

    const result = applied(await env.run());

    expect(result.report.runs[0]).toMatchObject({
      outcome: "kept",
      bytesFreed: 0,
      kept: {
        reason: "removal-failed",
        part: "cost ledger",
        message: "EACCES: permission denied, open",
      },
    });
    expect(env.fs.impl.getFile(ledgerPath)).toBe(LEDGER);
    expect(env.fs.impl.getFile(keptPath)).toBeUndefined();
  });

  it("copies nothing for a run without a ledger", async () => {
    const env = makeEnv();
    await Effect.runPromise(env.fs.impl.remove(ledgerPath));

    applied(await env.run());

    expect(await Effect.runPromise(env.fs.impl.exists(`${stateRoot}/cost-ledgers`))).toBe(false);
  });
});
