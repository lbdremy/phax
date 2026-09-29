// Keeps every committed fixture and corpus file public-safe: no home-directory
// path, and no session id other than the placeholder scrubDocument writes.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SESSION_ID_FIELDS,
  SESSION_ID_PLACEHOLDER,
} from "../../../packages/schemas/build/corpus.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const ROOTS = [join(here, "fixtures"), join(repoRoot, "packages/schemas/corpus")];

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(root, entry.name)) : [join(root, entry.name)],
  );
}

const files = ROOTS.flatMap(listFiles)
  .map((file) => relative(repoRoot, file))
  .toSorted();

// `/Users/<name>` or `/home/<name>` where a path starts: at the start of the
// text or after a character that cannot sit inside a path segment, and
// continuing with another path segment. A real leaked absolute path always
// continues past the username (worktree, archive, repo paths); requiring
// that excludes the bare example usernames (`/Users/<name>`, `/Users/other`)
// that this very plan's own prose uses to describe the scrubbing rule.
const HOME_PATH = /(?:^|[^\w.~/-])\/(?:Users|home)\/[^/\s"'\\<>]+\/[^\s"'\\]/m;

const SESSION_IDS: ReadonlySet<string> = new Set(SESSION_ID_FIELDS);

/** Every value of a SESSION_ID_FIELDS key, at any depth. */
function sessionIds(value: unknown, into: unknown[] = []): unknown[] {
  if (Array.isArray(value)) for (const item of value) sessionIds(item, into);
  else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (SESSION_IDS.has(key)) into.push(child);
      else sessionIds(child, into);
    }
  }
  return into;
}

const home = homedir();

describe("committed fixtures and corpus files hold no private data", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s", (file) => {
    const text = readFileSync(join(repoRoot, file), "utf8");
    expect(HOME_PATH.exec(text)?.[0], `${file} holds a home-directory path`).toBeUndefined();
    if (home.length > 1) {
      expect(text.includes(home), `${file} holds this machine's home directory`).toBe(false);
    }
    if (file.endsWith(".json")) {
      for (const id of sessionIds(JSON.parse(text))) {
        expect(id, `${file} holds a session id`).toBe(SESSION_ID_PLACEHOLDER);
      }
    }
  });
});
