import {
  constants,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Dirent,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll } from "vitest";
import { isolateGit } from "../../helpers/isolateGit.js";
import { removeTempDir } from "../../helpers/tempGit.js";

// A world is a directory tree a test builds once per test file and then copies for each test.
// The cache is this module's own state: vitest loads a test file's modules afresh (its default
// per-file isolation), so every file has its own cache, and the `afterAll` registered below, while
// the file is collected, removes it when the file ends.

/** Builds of this test file, by name: the world's build path, once the build is done. */
const worlds = new Map<string, Promise<string>>();
let cacheRoot: string | undefined;

function root(): string {
  cacheRoot ??= realpathSync(mkdtempSync(join(tmpdir(), "phax-world-cache-")));
  return cacheRoot;
}

function assertSafeName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`world name ${JSON.stringify(name)} is not a safe single path segment`);
  }
}

async function buildWorld(
  name: string,
  build: (buildPath: string) => Promise<void>,
): Promise<string> {
  const buildPath = join(root(), name);
  const release = isolateGit();
  try {
    await build(buildPath);
  } catch (error) {
    removeTempDir(buildPath);
    throw error;
  } finally {
    release();
  }
  return buildPath;
}

/**
 * The build path of the world cached under `name` in this test file. `build` runs once, at the
 * first request, with a path that does not exist yet, under `isolateGit()` (released before this
 * answers). Concurrent requests share the build; a failed build removes its directory, is
 * forgotten, and rejects with the build's error.
 */
export function cachedWorld(
  name: string,
  build: (buildPath: string) => Promise<void>,
): Promise<string> {
  assertSafeName(name);
  const existing = worlds.get(name);
  if (existing !== undefined) return existing;
  const pending = buildWorld(name, build);
  worlds.set(name, pending);
  pending.catch(() => {
    if (worlds.get(name) === pending) worlds.delete(name);
  });
  return pending;
}

/**
 * A private recursive copy of the world at `buildPath`, modes kept, copy-on-write where the
 * filesystem has it and a plain copy where it does not. Never a hard link, never a symlink to the
 * cache.
 */
export function copyWorld(buildPath: string, copyPath: string): void {
  cpSync(buildPath, copyPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
    mode: constants.COPYFILE_FICLONE,
  });
}

function* regularFiles(dir: string): Generator<string> {
  const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* regularFiles(path);
    else if (entry.isFile()) yield path;
  }
}

/**
 * Throw when a regular file of the copy (`.git` directories and bare repositories included) holds
 * `buildPath` in its raw bytes: the copy would still point at the cached world.
 */
export function assertNoBuildPath(copyPath: string, buildPath: string): void {
  const needle = Buffer.from(buildPath);
  for (const file of regularFiles(copyPath)) {
    if (readFileSync(file).includes(needle)) {
      throw new Error(
        `world copy ${copyPath} still holds the build path\n  ${buildPath}\n  in ${relative(copyPath, file)}`,
      );
    }
  }
}

afterAll(async () => {
  const pending = [...worlds.values()];
  worlds.clear();
  await Promise.allSettled(pending);
  removeTempDir(cacheRoot);
  cacheRoot = undefined;
});
