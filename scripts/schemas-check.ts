// Checks the schemas package's derived files against their sources:
// packages/schemas/src/generated/index.ts against the root package.json
// version and the lowest release-named snapshot, packages/schemas/history.lock.json
// against the bytes of every frozen module under phax's src/schemas/history/
// (keyed by repo-relative path), and every format's JSON Schema snapshots
// under packages/schemas/snapshots/<format id>/ against the schema its
// current decoder renders.
// Check: pnpm exec tsx scripts/schemas-check.ts
// Write: pnpm exec tsx scripts/schemas-check.ts --write
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WRITE_COMMAND,
  refreshLock,
  renderGeneratedIndex,
  renderLock,
  type HistoryLock,
} from "../packages/schemas/build/generated.js";
import {
  FORMAT_DEFINITIONS,
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
} from "../packages/schemas/build/jsonSchemas.js";
import {
  SNAPSHOTS_DIR,
  checkSnapshots,
  firstSupportedRelease,
  planSnapshotWrites,
  type SnapshotFormat,
} from "../packages/schemas/build/snapshots.js";
import { FORMAT_IDS } from "../src/schemas/schemaUrl.js";

const PACKAGE_DIR = "packages/schemas";
const GENERATED_INDEX = "src/generated/index.ts";
const HISTORY_DIR = "src/schemas/history";
const LOCK_FILE = "history.lock.json";
const LOCK_PATH = `${PACKAGE_DIR}/${LOCK_FILE}`;

/** Everything the check reads, so it can run on an injected state. */
export interface SchemasState {
  readonly packageVersion: string;
  /** The lowest release-named snapshot across every format, or null when none exists. */
  readonly firstSupportedRelease: string | null;
  /** The committed generated index, or undefined when absent. */
  readonly generatedIndex: string | undefined;
  readonly lock: HistoryLock;
  /** Repo-relative path → bytes, for every module under `src/schemas/history/`. */
  readonly historyFiles: ReadonlyMap<string, Uint8Array>;
  /** Directory name under `packages/schemas/snapshots` → file name → content. */
  readonly snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The names of the files directly under `packages/schemas/snapshots`. */
  readonly snapshotRootFiles: ReadonlyArray<string>;
  /** Every format id's current shape name and rendered JSON Schema. */
  readonly formats: ReadonlyArray<SnapshotFormat>;
}

function readSnapshots(root: string): Pick<SchemasState, "snapshots" | "snapshotRootFiles"> {
  const snapshots = new Map<string, Map<string, string>>();
  if (!existsSync(root)) return { snapshots, snapshotRootFiles: [] };
  const entries = readdirSync(root, { withFileTypes: true });
  const snapshotRootFiles = entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const dirs = entries.filter((entry) => entry.isDirectory());
  for (const dir of dirs.map((entry) => entry.name).toSorted()) {
    const files = new Map<string, string>();
    for (const file of listFiles(join(root, dir)).toSorted()) {
      files.set(relative(join(root, dir), file).split("\\").join("/"), readFileSync(file, "utf8"));
    }
    snapshots.set(dir, files);
  }
  return { snapshots, snapshotRootFiles };
}

function renderFormats(): SnapshotFormat[] {
  const { files, failures } = renderJsonSchemas(JSON_SCHEMA_FORMATS);
  return FORMAT_IDS.map((id): SnapshotFormat => {
    const content = files.get(`${id}.schema.json`);
    const failure = failures.find((entry) => entry.format === id);
    return {
      id,
      currentShape: FORMAT_DEFINITIONS[id].current.name,
      generated:
        content !== undefined
          ? { ok: true, content }
          : { ok: false, reason: failure?.reason ?? "no JSON Schema rendered" },
    };
  });
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(root, entry.name)) : [join(root, entry.name)],
  );
}

export function readSchemasState(repoRoot: string): SchemasState {
  const packageDir = join(repoRoot, PACKAGE_DIR);
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const indexPath = join(packageDir, GENERATED_INDEX);
  const lockPath = join(packageDir, LOCK_FILE);
  const historyFiles = new Map<string, Uint8Array>();
  for (const file of listFiles(join(repoRoot, HISTORY_DIR)).toSorted()) {
    historyFiles.set(relative(repoRoot, file).split("\\").join("/"), readFileSync(file));
  }
  const snapshots = readSnapshots(join(repoRoot, SNAPSHOTS_DIR));
  return {
    packageVersion: rootManifest.version,
    firstSupportedRelease: firstSupportedRelease(snapshots.snapshots),
    generatedIndex: existsSync(indexPath) ? readFileSync(indexPath, "utf8") : undefined,
    lock: existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, "utf8")) as HistoryLock) : {},
    historyFiles,
    ...snapshots,
    formats: renderFormats(),
  };
}

function generatedIndexOf(state: SchemasState): string {
  return renderGeneratedIndex({
    packageVersion: state.packageVersion,
    firstSupportedRelease: state.firstSupportedRelease,
  });
}

/** Every finding, one `✗ …` line each; empty when the derived files are current. */
export function checkSchemas(state: SchemasState): string[] {
  const findings: string[] = [];
  const index = `${PACKAGE_DIR}/${GENERATED_INDEX}`;
  if (state.generatedIndex !== generatedIndexOf(state)) {
    findings.push(
      `✗ ${index} does not match package.json version ${state.packageVersion} and first ` +
        `supported release ${state.firstSupportedRelease ?? "(none)"} — run ${WRITE_COMMAND}`,
    );
  }
  const { mismatched } = refreshLock(state.lock, state.historyFiles);
  for (const path of state.historyFiles.keys()) {
    if (state.lock[path] === undefined) {
      findings.push(`✗ ${path} has no ${LOCK_PATH} entry — run ${WRITE_COMMAND}`);
    }
  }
  for (const path of mismatched) {
    findings.push(
      `✗ ${path} differs from its ${LOCK_PATH} entry — a frozen module never changes; ` +
        `restore it, or, before its first release only, delete its entry and run ${WRITE_COMMAND}`,
    );
  }
  for (const path of Object.keys(state.lock)) {
    if (!state.historyFiles.has(path)) {
      findings.push(`✗ ${LOCK_PATH} names ${path}, which does not exist — restore the module`);
    }
  }
  return [...findings, ...checkSnapshots(state)];
}

/**
 * What `--write` produces: the generated index, the lock with missing
 * entries added, and the snapshot files to write (repo-relative path →
 * content) or remove. `mismatched` lists the lock entries it refused to
 * change; when it is non-empty nothing is written.
 */
export function writeSchemas(state: SchemasState): {
  generatedIndex: string;
  lock: string;
  mismatched: ReadonlyArray<string>;
  snapshotWrites: ReadonlyMap<string, string>;
  snapshotRemovals: ReadonlyArray<string>;
} {
  const { lock, mismatched } = refreshLock(state.lock, state.historyFiles);
  const { writes, removals } = planSnapshotWrites(state);
  return {
    generatedIndex: generatedIndexOf(state),
    lock: renderLock(lock),
    mismatched,
    snapshotWrites: writes,
    snapshotRemovals: removals,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  const state = readSchemasState(repoRoot);
  if (process.argv.includes("--write")) {
    const written = writeSchemas(state);
    if (written.mismatched.length > 0) {
      for (const path of written.mismatched) {
        console.error(`✗ ${path} differs from its ${LOCK_PATH} entry — nothing written`);
      }
      process.exit(1);
    }
    const indexPath = join(repoRoot, PACKAGE_DIR, GENERATED_INDEX);
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, written.generatedIndex);
    writeFileSync(join(repoRoot, LOCK_PATH), written.lock);
    console.log(`Wrote ${PACKAGE_DIR}/${GENERATED_INDEX} and ${LOCK_PATH}`);
    for (const [path, content] of written.snapshotWrites) {
      const target = join(repoRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      console.log(`Wrote ${path}`);
    }
    for (const path of written.snapshotRemovals) {
      rmSync(join(repoRoot, path));
      console.log(`Removed ${path}`);
    }
  } else {
    const findings = checkSchemas(state);
    for (const finding of findings) console.error(finding);
    if (findings.length > 0) process.exit(1);
    console.log("Schemas package derived files are current");
  }
}
