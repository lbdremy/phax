import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTempDir } from "./tempGit.js";

// Keeps every git a test runs, the real NodeGitLayer's and the fixtures' own,
// away from the person's configuration and identity: an empty global config,
// no system config, an XDG config home of its own, and no GIT_AUTHOR_* or
// GIT_COMMITTER_* from the environment. Stubbing HOME alone leaves
// GIT_CONFIG_GLOBAL, XDG_CONFIG_HOME and the identity variables in force.

const KEYS = [
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "XDG_CONFIG_HOME",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

// Nested isolations (a second world in one test) share the first one's saved
// environment, which is put back when the last of them is restored, whatever
// order they are restored in.
let depth = 0;
let saved: Partial<Record<(typeof KEYS)[number], string>> = {};
let configDir: string | undefined;

function setOrDelete(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Isolate git from the person's configuration until the returned function is
 * called; that call puts the environment back as it was.
 */
export function isolateGit(): () => void {
  if (depth === 0) {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    configDir = mkdtempSync(join(tmpdir(), "phax-isolated-git-"));
    const globalConfig = join(configDir, "gitconfig");
    writeFileSync(globalConfig, "");
    for (const key of KEYS) delete process.env[key];
    process.env["GIT_CONFIG_GLOBAL"] = globalConfig;
    process.env["GIT_CONFIG_NOSYSTEM"] = "1";
    process.env["XDG_CONFIG_HOME"] = join(configDir, "xdg");
  }
  depth += 1;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    depth -= 1;
    if (depth > 0) return;
    for (const key of KEYS) setOrDelete(key, saved[key]);
    if (configDir !== undefined) removeTempDir(configDir);
    configDir = undefined;
  };
}
