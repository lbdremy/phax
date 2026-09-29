import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_ID_PLACEHOLDER } from "../../packages/schemas/build/corpus.js";
import { extractHistoryCorpus } from "../../scripts/extract-history-corpus.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "unit",
  "schemasPackage",
  "fixtures",
);

function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=phax test",
      "-c",
      "user.email=test@phax.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: "pipe" },
  );
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .toSorted();
}

function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(listFiles(root).map((f) => [f, readFileSync(join(root, f), "utf8")]));
}

// A real phase status (plan-2 fixture), rewritten to live under the temporary home.
function phaseStatus(home: string): string {
  const fixtures = JSON.parse(
    readFileSync(join(fixturesDir, "phase-status", "v1.json"), "utf8"),
  ) as Record<string, Record<string, unknown>>;
  const [document] = Object.values(fixtures);
  return JSON.stringify({
    ...document,
    worktreePath: `${home}/.phax/worktrees/x/phase-01`,
    claudeSessionId: "3c7080a6-7750-491b-92f1-24d5850b81a0",
  });
}

describe("extractHistoryCorpus", () => {
  // the temporary directory is also the home the documents are scrubbed against
  let home: string;
  let outDir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "phax-history-corpus-"));
    outDir = join(home, "corpus");
    write(home, ".phax/runs/run-a/phase-01/status.json", phaseStatus(home));
  });
  afterEach(() => removeTempDir(home));

  const extract = (records: string[] = []) =>
    extractHistoryCorpus({ records, repos: [], phaxHome: "~/.phax", home, outDir });

  it("writes every document scrubbed, one file per distinct document", () => {
    const result = extract();
    expect(result.failures).toEqual([]);
    expect(result.added).toBe(1);
    expect(result.kept).toBe(0);
    expect(result.perShape).toEqual(new Map([["phase-status/v1", { total: 1, added: 1 }]]));
    const files = listFiles(outDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^phase-status\/v1\/[0-9a-f]{16}\.json$/);
    const content = readFileSync(join(outDir, files[0]!), "utf8");
    expect(content).not.toContain(home);
    const written = JSON.parse(content) as Record<string, unknown>;
    expect(written["worktreePath"]).toBe("~/.phax/worktrees/x/phase-01");
    expect(written["claudeSessionId"]).toBe(SESSION_ID_PLACEHOLDER);
  });

  it("adds nothing on a second run and leaves every file byte-identical", () => {
    extract();
    const before = snapshot(outDir);
    const result = extract();
    expect(result.added).toBe(0);
    expect(result.kept).toBe(1);
    expect(result.perShape).toEqual(new Map([["phase-status/v1", { total: 1, added: 0 }]]));
    expect(snapshot(outDir)).toEqual(before);
  });

  it("keeps a corpus file its sources no longer hold", () => {
    write(outDir, "registry/v1/0123456789abcdef.json", '{"kept":true}\n');
    extract();
    expect(listFiles(outDir)).toContain("registry/v1/0123456789abcdef.json");
    expect(readFileSync(join(outDir, "registry/v1/0123456789abcdef.json"), "utf8")).toBe(
      '{"kept":true}\n',
    );
  });

  it("fails naming the unreadable document and writes nothing", () => {
    const records = join(home, "records");
    mkdirSync(records);
    git(records, ["init", "-q", "-b", "phax/records/v1"]);
    disableGitAutoMaintenance(records);
    write(records, "run-a/phase-01/record.json", '{"version":1,"runId":7}\n');
    git(records, ["add", "-A"]);
    git(records, ["commit", "-q", "-m", "invalid record"]);
    const result = extract(["~/records"]);
    expect(result.added).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      source: "~/records@git:run-a/phase-01/record.json",
      format: "phase-record-manifest",
    });
    expect(existsSync(outDir)).toBe(false);
  });
});
