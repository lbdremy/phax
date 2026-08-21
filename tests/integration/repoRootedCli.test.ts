import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Effect, Either, type Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/app/loadConfig.js";
import { plansStalenessReport } from "../../src/app/planStaleness.js";
import { makeRepoRootedFileSystemLayer } from "../../src/cli/commands/runLayers.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { FileSystem } from "../../src/ports/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";

// This suite proves the FileSystem port, once rooted at config.repoRoot, keeps
// git's work-from-anywhere contract: relative paths resolve against the repo
// root no matter which subdirectory phax was invoked from, while absolute paths
// pass through untouched. Running from a nested subdirectory with the identity
// layer is the exact condition that produced the spurious `missing-record`.

const PLAN_REL = "docs/plans/40-x.md";
// Deliberately malformed front-matter: validateArtifact rejects it, so
// plansStalenessReport records an error entry without reaching the Backend/Git
// extraction path — keeping this test provider-free while still exercising the
// docs/plans read through the port.
const PLAN_MD = "no front-matter here\n";

let repoDir: string;
let subDir: string;
let tempHome: string;
let originalHome: string | undefined;
let originalCwd: string;
let config: ResolvedConfig;

beforeEach(() => {
  originalCwd = process.cwd();
  repoDir = mkdtempSync(join(tmpdir(), "phax-rooted-repo-"));
  execSync("git init", { cwd: repoDir, stdio: "ignore" });
  tempHome = mkdtempSync(join(tmpdir(), "phax-rooted-home-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  writeFileSync(
    join(repoDir, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "test",
      gateProfiles: { fast: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
    }),
  );
  mkdirSync(join(repoDir, "docs", "plans"), { recursive: true });
  writeFileSync(join(repoDir, PLAN_REL), PLAN_MD);

  subDir = join(repoDir, "packages", "nested");
  mkdirSync(subDir, { recursive: true });

  const configResult = loadConfig(repoDir);
  if (Either.isLeft(configResult)) throw new Error(configResult.left.message);
  config = configResult.right;
});

afterEach(() => {
  // Restore cwd before removing the temp dir so the rm never fails on a
  // still-current working directory.
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(tempHome, { recursive: true, force: true });
});

function readViaLayer(
  layer: Layer.Layer<FileSystem>,
  path: string,
): Promise<Either.Either<string, unknown>> {
  const effect = Effect.gen(function* () {
    const fs = yield* FileSystem;
    return yield* fs.readText(path);
  }).pipe(Effect.provide(layer));
  return Effect.runPromise(Effect.either(effect));
}

describe("repo-rooted FileSystem layer, invoked from a nested subdirectory", () => {
  it("resolves a repo-relative path against repoRoot regardless of cwd", async () => {
    process.chdir(subDir);
    const rooted = makeRepoRootedFileSystemLayer(config);

    const result = await readViaLayer(rooted, PLAN_REL);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right).toBe(PLAN_MD);
  });

  it("passes an absolute path argument through unchanged under the rooted layer", async () => {
    process.chdir(subDir);
    const rooted = makeRepoRootedFileSystemLayer(config);

    const result = await readViaLayer(rooted, join(repoDir, PLAN_REL));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right).toBe(PLAN_MD);
  });

  it("the identity layer from a subdirectory cannot see the repo-relative artifact", async () => {
    process.chdir(subDir);

    const result = await readViaLayer(NodeFileSystemLayer, PLAN_REL);

    // This failure is the bug the rooting fixes: the same relative path the
    // rooted layer reads successfully is unreadable from the subdirectory.
    expect(Either.isLeft(result)).toBe(true);
  });

  it("plans status reads docs/plans from a subdirectory (the sharpest case)", async () => {
    const { layer: gitLayer } = makeFakeGit();
    const { layer: backendLayer } = makeFakeBackend();
    const reportOpts = {
      repoRoot: config.repoRoot,
      stateRoot: config.stateRoot,
      model: "claude-opus-4-8",
      effort: "high",
      nowIso: "2026-08-14T00:00:00.000Z",
    };

    process.chdir(subDir);

    // Rooted layer from the subdirectory: sees docs/plans and reports the entry.
    const rootedReport = await Effect.runPromise(
      Effect.either(
        plansStalenessReport(reportOpts).pipe(
          Effect.provide(makeRepoRootedFileSystemLayer(config)),
          Effect.provide(gitLayer),
          Effect.provide(backendLayer),
        ),
      ),
    );
    expect(Either.isRight(rootedReport)).toBe(true);
    if (Either.isRight(rootedReport)) {
      expect(rootedReport.right.map((e) => e.path)).toEqual([PLAN_REL]);
    }

    // Identity layer from the same subdirectory: docs/plans is invisible, so the
    // report is empty — exactly the disagreement that produced missing-record.
    const identityReport = await Effect.runPromise(
      Effect.either(
        plansStalenessReport(reportOpts).pipe(
          Effect.provide(NodeFileSystemLayer),
          Effect.provide(gitLayer),
          Effect.provide(backendLayer),
        ),
      ),
    );
    expect(Either.isRight(identityReport)).toBe(true);
    if (Either.isRight(identityReport)) {
      expect(identityReport.right).toEqual([]);
    }
  });
});
