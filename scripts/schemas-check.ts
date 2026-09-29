// Checks the schemas package's derived files against their sources:
// packages/schemas/src/generated/index.ts against the root package.json
// version; packages/schemas/snapshots/, one JSON Schema snapshot per shape of
// every format, against the schema generated from phax's current decoders
// (a changed shape must be recorded as snapshots/<format id>/next.schema.json);
// and packages/schemas/history.lock.json against the bytes of every frozen
// module under packages/schemas/src/history/ and every released snapshot.
// Check: pnpm exec tsx scripts/schemas-check.ts
// Write: pnpm exec tsx scripts/schemas-check.ts --write
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  SNAPSHOT_FORMATS,
  checkSnapshots,
  isReleasedSnapshotPath,
  writeSnapshots,
  type SnapshotFormat,
} from "../packages/schemas/build/snapshots.js";

const PACKAGE_DIR = "packages/schemas";
const GENERATED_INDEX = "src/generated/index.ts";
const HISTORY_DIR = "src/history";
const SNAPSHOTS_DIR = "snapshots";
const LOCK_FILE = "history.lock.json";

/** Everything the check reads, so it can run on an injected state. */
export interface SchemasState {
  readonly packageVersion: string;
  /** The committed generated index, or undefined when absent. */
  readonly generatedIndex: string | undefined;
  readonly lock: HistoryLock;
  /** Path relative to `packages/schemas` → bytes, for every history module. */
  readonly historyFiles: ReadonlyMap<string, Uint8Array>;
  /** Path relative to `packages/schemas` → content, for every file under `snapshots/`. */
  readonly snapshotFiles: ReadonlyMap<string, string>;
  /** The formats whose snapshots are checked: SNAPSHOT_FORMATS, or a synthetic table. */
  readonly snapshotFormats: ReadonlyArray<SnapshotFormat>;
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(root, entry.name)) : [join(root, entry.name)],
  );
}

function packagePath(packageDir: string, file: string): string {
  return relative(packageDir, file).split("\\").join("/");
}

export function readSchemasState(repoRoot: string): SchemasState {
  const packageDir = join(repoRoot, PACKAGE_DIR);
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const indexPath = join(packageDir, GENERATED_INDEX);
  const lockPath = join(packageDir, LOCK_FILE);
  const historyFiles = new Map<string, Uint8Array>();
  for (const file of listFiles(join(packageDir, HISTORY_DIR)).toSorted()) {
    historyFiles.set(packagePath(packageDir, file), readFileSync(file));
  }
  const snapshotFiles = new Map<string, string>();
  for (const file of listFiles(join(packageDir, SNAPSHOTS_DIR)).toSorted()) {
    snapshotFiles.set(packagePath(packageDir, file), readFileSync(file, "utf8"));
  }
  return {
    packageVersion: rootManifest.version,
    generatedIndex: existsSync(indexPath) ? readFileSync(indexPath, "utf8") : undefined,
    lock: existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, "utf8")) as HistoryLock) : {},
    historyFiles,
    snapshotFiles,
    snapshotFormats: SNAPSHOT_FORMATS,
  };
}

/** Every file history.lock.json pins: the frozen modules and the released snapshots. */
function lockedFiles(
  historyFiles: ReadonlyMap<string, Uint8Array>,
  snapshotFiles: ReadonlyMap<string, string>,
): ReadonlyMap<string, string | Uint8Array> {
  return new Map<string, string | Uint8Array>([
    ...historyFiles,
    ...[...snapshotFiles].filter(([path]) => isReleasedSnapshotPath(path)),
  ]);
}

function isSnapshot(path: string): boolean {
  return path.startsWith(`${SNAPSHOTS_DIR}/`);
}

/** Every finding, one `✗ …` line each; empty when the derived files are current. */
export function checkSchemas(state: SchemasState): string[] {
  const findings: string[] = [];
  const index = `${PACKAGE_DIR}/${GENERATED_INDEX}`;
  if (state.generatedIndex !== renderGeneratedIndex({ packageVersion: state.packageVersion })) {
    findings.push(
      `✗ ${index} does not match package.json version ${state.packageVersion} — run ${WRITE_COMMAND}`,
    );
  }
  const locked = lockedFiles(state.historyFiles, state.snapshotFiles);
  const { mismatched } = refreshLock(state.lock, locked);
  for (const path of locked.keys()) {
    if (state.lock[path] === undefined) {
      findings.push(`✗ ${PACKAGE_DIR}/${path} has no ${LOCK_FILE} entry — run ${WRITE_COMMAND}`);
    }
  }
  for (const path of mismatched) {
    findings.push(
      isSnapshot(path)
        ? `✗ ${PACKAGE_DIR}/${path} differs from its ${LOCK_FILE} entry — a released snapshot never changes; ` +
            `restore it, or, before its first release only, delete it and its entry and run ${WRITE_COMMAND}`
        : `✗ ${PACKAGE_DIR}/${path} differs from its ${LOCK_FILE} entry — a frozen module never changes; ` +
            `restore it, or, before its first release only, delete its entry and run ${WRITE_COMMAND}`,
    );
  }
  for (const path of Object.keys(state.lock)) {
    if (!locked.has(path)) {
      findings.push(
        `✗ ${LOCK_FILE} names ${PACKAGE_DIR}/${path}, which does not exist — ` +
          `restore the ${isSnapshot(path) ? "snapshot" : "module"}`,
      );
    }
  }
  findings.push(...checkSnapshots(state.snapshotFormats, state.snapshotFiles));
  return findings;
}

/**
 * What `--write` produces: the generated index, the snapshots to write
 * (missing released ones, and `next` when a shape changed), and the lock with
 * missing entries added for the frozen modules and the released snapshots,
 * new ones included. `mismatched` lists the entries it refused to change;
 * when it is non-empty nothing is written.
 */
export function writeSchemas(state: SchemasState): {
  generatedIndex: string;
  snapshots: ReadonlyMap<string, string>;
  lock: string;
  mismatched: ReadonlyArray<string>;
} {
  const snapshots = writeSnapshots(state.snapshotFormats, state.snapshotFiles);
  const { lock, mismatched } = refreshLock(
    state.lock,
    lockedFiles(state.historyFiles, new Map([...state.snapshotFiles, ...snapshots])),
  );
  return {
    generatedIndex: renderGeneratedIndex({ packageVersion: state.packageVersion }),
    snapshots,
    lock: renderLock(lock),
    mismatched,
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
        console.error(
          `✗ ${PACKAGE_DIR}/${path} differs from its ${LOCK_FILE} entry — nothing written`,
        );
      }
      process.exit(1);
    }
    const indexPath = join(repoRoot, PACKAGE_DIR, GENERATED_INDEX);
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, written.generatedIndex);
    for (const [path, content] of written.snapshots) {
      const snapshotPath = join(repoRoot, PACKAGE_DIR, path);
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, content);
      console.log(`Wrote ${PACKAGE_DIR}/${path}`);
    }
    writeFileSync(join(repoRoot, PACKAGE_DIR, LOCK_FILE), written.lock);
    console.log(`Wrote ${PACKAGE_DIR}/${GENERATED_INDEX} and ${PACKAGE_DIR}/${LOCK_FILE}`);
  } else {
    const findings = checkSchemas(state);
    for (const finding of findings) console.error(finding);
    if (findings.length > 0) process.exit(1);
    console.log("Schemas package derived files are current");
  }
}
