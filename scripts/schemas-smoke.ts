// Smoke-tests the packed @lbdremy/phax-schemas tarball the way a consumer
// meets it (spec ac-e2e): an empty Node 20 project with no phax installed
// installs the tarball, two made-up phase records written as phax writes them
// sit on a phax/records/v1 branch, one record per commit, and the spec §6
// read-record.mjs script finds the older one by its commit trailers, reads it
// and prints its runId, phaseId, outcome and provider. It also checks the
// installed package's version, that it ships one JSON Schema per format, and
// that node_modules holds only the package, effect and effect's own
// dependencies.
// It needs the network (npm install from the registry), so it runs only in CI
// and in the release workflow, never in a phax gate or check:full. It uses
// only Node 20 APIs. Run it after a build:
//   pnpm build
//   pnpm exec tsx scripts/schemas-smoke.ts
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { withSchemaUrl } from "../src/schemas/persisted.js";
import {
  RunRecordManifestFileSchema,
  type RunRecordManifestFile,
} from "../src/schemas/runRecord.js";
import { FORMAT_IDS } from "../src/schemas/schemaUrl.js";

const PACKAGE_NAME = "@lbdremy/phax-schemas";
const RUN_ID = "run-0001";
const PHASE_ID = "phase-01";
/** A later phase whose record sits at the branch tip, above the one the consumer reads. */
const NEWER_PHASE_ID = "phase-02";

/** The record's key on phax/records/v1: `<runId>/<phaseId>`. */
export const SMOKE_RECORD_KEY = `${RUN_ID}/${PHASE_ID}`;

/**
 * A made-up phase record manifest, written as phax writes it: encoded through
 * phax's own file schema, `$schema` first at the format's current stamp.
 */
export function smokeRecordManifest(phaseId: string = PHASE_ID): RunRecordManifestFile {
  return Schema.encodeSync(RunRecordManifestFileSchema)(
    withSchemaUrl("phase-record-manifest", {
      runId: RUN_ID,
      phaseId,
      shape: "full",
      sourceSha: "abc1234",
      model: "example-model",
      effort: "high",
      provider: "claude-code",
      outcome: "committed",
      usage: {
        available: true,
        usage: {
          provider: "claude-code",
          inputTokens: 1000,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 200,
          outputTokens: 300,
          totalCostUsd: 0.01,
        },
      },
      verifiedSurfaces: ["local", "structural"],
    } as const),
  );
}

/**
 * The spec §6 consumer, `read-record.mjs`: Node 20, phax not installed, only
 * the package. Each commit on phax/records/v1 holds only its own record, so it
 * finds the record's commit by its `Run-Id` and `Phase-Id` trailers and reads
 * the file at that commit — `git show phax/records/v1:<path>` would only see
 * the newest record.
 */
export const CONSUMER_SCRIPT = [
  "// read-record.mjs: Node 20+, phax not installed, only @lbdremy/phax-schemas",
  'import { execFileSync } from "node:child_process";',
  'import { parsePhaseRecordManifest } from "@lbdremy/phax-schemas";',
  "",
  'const [runId, phaseId] = process.argv[2].split("/"); // "<runId>/phase-01"',
  'const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();',
  "",
  "// Each commit on the records branch holds only its own record: find the",
  "// record's commit by its trailers, then read the file at that commit.",
  "const sha = git(",
  '  "log",',
  '  "phax/records/v1",',
  '  "--format=%H",',
  '  "--fixed-strings",',
  '  "--all-match",',
  "  `--grep=Run-Id: ${runId}`,",
  "  `--grep=Phase-Id: ${phaseId}`,",
  '  "-1",',
  ");",
  "if (!sha) {",
  "  console.error(`no record for ${runId}/${phaseId} on phax/records/v1`);",
  "  process.exit(1);",
  "}",
  'const raw = git("show", `${sha}:${runId}/${phaseId}/record.json`);',
  "",
  "const parsed = parsePhaseRecordManifest(JSON.parse(raw));",
  "if (!parsed.ok) {",
  "  console.error(`record.json: ${parsed.error.path}: ${parsed.error.message}`);",
  "  process.exit(1);",
  "}",
  "const { outcome, usage } = parsed.value; // typed PhaseRecord",
  'console.log(runId, phaseId, outcome, usage.available ? usage.usage.provider : "no usage");',
  "",
].join("\n");

/**
 * The message phax gives a phase record's commit (src/app/writeRecord.ts): a
 * subject, then the `Run-Id`, `Phase-Id` and `Shape` trailers a reader finds
 * the commit by.
 */
export function recordCommitMessage(manifest: RunRecordManifestFile): string {
  return [
    `records(${manifest.phaseId}): ${manifest.outcome}`,
    "",
    `Run-Id: ${manifest.runId}`,
    `Phase-Id: ${manifest.phaseId}`,
    `Shape: ${manifest.shape}`,
  ].join("\n");
}

/** The line `CONSUMER_SCRIPT` prints for `manifest`. */
export function expectedConsumerOutput(manifest: RunRecordManifestFile): string {
  const provider = manifest.usage.available ? manifest.usage.usage.provider : "no usage";
  return `${manifest.runId} ${manifest.phaseId} ${manifest.outcome} ${provider}`;
}

/** npm's own entries in a top-level node_modules, never a package. */
const NPM_ENTRIES = new Set([".bin", ".package-lock.json"]);

/**
 * The installed top-level packages (scoped ones as `@scope/name`) other than
 * the schemas package, effect and `allowed`, effect's dependency closure.
 */
export function strayPackages(
  installed: ReadonlyArray<string>,
  allowed: ReadonlySet<string>,
): ReadonlyArray<string> {
  return installed.filter(
    (name) =>
      !NPM_ENTRIES.has(name) && name !== PACKAGE_NAME && name !== "effect" && !allowed.has(name),
  );
}

/** The directory `name` resolves to from `fromDir`, by Node's node_modules lookup. */
function resolvePackageDir(fromDir: string, name: string): string {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error(`cannot resolve ${name} from ${fromDir}`);
  }
}

/**
 * `name` and every package it depends on, transitively, resolved from
 * `fromDir` the way Node resolves them: dependencies, optional and peer
 * dependencies.
 */
export function dependencyClosure(fromDir: string, name: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const visit = (from: string, pkg: string): void => {
    if (seen.has(pkg)) return;
    seen.add(pkg);
    const dir = resolvePackageDir(from, pkg);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      readonly dependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
      readonly peerDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      visit(dir, dependency);
    }
  };
  visit(fromDir, name);
  return seen;
}

/** The top-level entries of `nodeModules`, a scoped package as `@scope/name`. */
function installedPackages(nodeModules: string): ReadonlyArray<string> {
  return readdirSync(nodeModules).flatMap((entry) =>
    entry.startsWith("@")
      ? readdirSync(join(nodeModules, entry)).map((name) => `${entry}/${name}`)
      : [entry],
  );
}

/** A failed smoke check; the main block prints it as a `✗` line. */
class SmokeFailure extends Error {}

function fail(what: string): never {
  throw new SmokeFailure(what);
}

function pass(what: string): void {
  console.log(`✓ ${what}`);
}

/** Runs `command`, its stdout discarded, failing the smoke with `what` when it exits non-zero. */
function run(
  what: string,
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  try {
    execFileSync(command, args, { cwd, env, stdio: ["ignore", "ignore", "inherit"] });
  } catch {
    fail(`${what} (${command} ${args.join(" ")})`);
  }
}

/**
 * The environment the consumer's git runs in: the parent's, without any git
 * location, no system or global config, and a fixed made-up author.
 */
function smokeGitEnv(): NodeJS.ProcessEnv {
  const { GIT_DIR: _dir, GIT_WORK_TREE: _workTree, GIT_INDEX_FILE: _index, ...rest } = process.env;
  return {
    ...rest,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_AUTHOR_NAME: "phax smoke",
    GIT_AUTHOR_EMAIL: "smoke@example.invalid",
    GIT_AUTHOR_DATE: "2026-01-01T09:00:00Z",
    GIT_COMMITTER_NAME: "phax smoke",
    GIT_COMMITTER_EMAIL: "smoke@example.invalid",
    GIT_COMMITTER_DATE: "2026-01-01T09:00:00Z",
  };
}

function smoke(repoRoot: string, workDir: string): void {
  const packageDir = join(repoRoot, "packages/schemas");
  if (!existsSync(join(packageDir, "dist/packages/schemas/src/index.js"))) {
    fail("packages/schemas/dist is missing — run pnpm build first");
  }
  if (!existsSync(join(packageDir, "json"))) {
    fail("packages/schemas/json is missing — run pnpm build first");
  }

  const packDir = join(workDir, "pack");
  mkdirSync(packDir);
  run("npm pack failed", "npm", ["pack", "--pack-destination", packDir], packageDir, process.env);
  const tarballs = readdirSync(packDir).filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1) fail(`npm pack wrote ${tarballs.length} tarballs, expected 1`);
  const tarball = join(packDir, tarballs[0]!);
  pass(`packed ${tarballs[0]}`);

  const consumer = join(workDir, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "phax-schemas-smoke", private: true, type: "module" }, null, 2)}\n`,
  );
  run(
    "npm install of the tarball failed",
    "npm",
    ["install", "--no-audit", "--no-fund", tarball],
    consumer,
    process.env,
  );
  pass(`installed the tarball into an empty Node ${process.versions.node} project`);

  const gitEnv = smokeGitEnv();
  // As phax does, each commit on the records branch holds only its own
  // record. The record the consumer reads is not the newest one, so reading
  // it from the branch tip alone would fail.
  const manifest = smokeRecordManifest();
  const newer = smokeRecordManifest(NEWER_PHASE_ID);
  run("git init failed", "git", ["init", "-q"], consumer, gitEnv);
  run(
    "could not start the records branch",
    "git",
    ["symbolic-ref", "HEAD", "refs/heads/phax/records/v1"],
    consumer,
    gitEnv,
  );
  const recordPaths: Array<string> = [];
  for (const record of [manifest, newer]) {
    const key = `${record.runId}/${record.phaseId}`;
    const recordPath = `${key}/record.json`;
    if (recordPaths.length > 0) {
      run("git rm failed", "git", ["rm", "-q", "-r", "--", RUN_ID], consumer, gitEnv);
    }
    mkdirSync(join(consumer, key), { recursive: true });
    writeFileSync(join(consumer, recordPath), `${JSON.stringify(record, null, 2)}\n`);
    run("git add failed", "git", ["add", "--", recordPath], consumer, gitEnv);
    run(
      "git commit failed",
      "git",
      ["-c", "commit.gpgsign=false", "commit", "-q", "-m", recordCommitMessage(record)],
      consumer,
      gitEnv,
    );
    recordPaths.push(recordPath);
  }
  pass(`committed ${recordPaths.join(" then ")} on phax/records/v1, one record per commit`);

  writeFileSync(join(consumer, "read-record.mjs"), CONSUMER_SCRIPT);
  const consumerRun = spawnSync(process.execPath, ["read-record.mjs", SMOKE_RECORD_KEY], {
    cwd: consumer,
    env: gitEnv,
    encoding: "utf8",
  });
  if (consumerRun.status !== 0) {
    fail(
      `node read-record.mjs ${SMOKE_RECORD_KEY} exited ${consumerRun.status}: ${consumerRun.stderr.trim()}`,
    );
  }
  const expected = `${expectedConsumerOutput(manifest)}\n`;
  if (consumerRun.stdout !== expected) {
    fail(
      `read-record.mjs printed ${JSON.stringify(consumerRun.stdout)}, expected ${JSON.stringify(expected)}`,
    );
  }
  pass(`read-record.mjs printed "${expected.trimEnd()}" and exited 0`);

  const nodeModules = join(consumer, "node_modules");
  const installedDir = join(nodeModules, PACKAGE_NAME);
  const rootVersion = (
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { readonly version: string }
  ).version;
  const installedVersion = (
    JSON.parse(readFileSync(join(installedDir, "package.json"), "utf8")) as {
      readonly version: string;
    }
  ).version;
  if (installedVersion !== rootVersion) {
    fail(`installed ${PACKAGE_NAME} is ${installedVersion}, the root package.json ${rootVersion}`);
  }
  pass(`${PACKAGE_NAME} ${installedVersion} matches the root package.json`);

  const jsonDir = join(installedDir, "json");
  const jsonFiles = new Set(existsSync(jsonDir) ? readdirSync(jsonDir) : []);
  const missing = FORMAT_IDS.filter((id) => !jsonFiles.has(`${id}.schema.json`));
  if (missing.length > 0) fail(`json/ has no JSON Schema for ${missing.join(", ")}`);
  pass(`json/ holds a JSON Schema for each of the ${FORMAT_IDS.length} formats`);

  const stray = strayPackages(
    installedPackages(nodeModules),
    dependencyClosure(installedDir, "effect"),
  );
  if (stray.length > 0) {
    fail(`node_modules holds packages outside ${PACKAGE_NAME} and effect: ${stray.join(", ")}`);
  }
  pass(`node_modules holds only ${PACKAGE_NAME}, effect and effect's dependencies`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  const workDir = mkdtempSync(join(tmpdir(), "phax-schemas-smoke-"));
  try {
    smoke(repoRoot, workDir);
  } catch (error) {
    if (!(error instanceof SmokeFailure)) throw error;
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
