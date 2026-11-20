import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RECORDS_BRANCH_NAME } from "../../../src/app/writeRecord.js";
import { removeTempDir } from "../../helpers/tempGit.js";

// Writes any number of seed records on a repository's records branch through ONE `git fast-import`
// process, as the commits phax's own `commitRecordTree` writes for the same key, origin, artifact,
// date, identity and parent: each commit's tree holds only its own record (`<key>/note.md` and
// `<key>/record.json`, both 100644), author and committer are the identity at the record's date,
// the message is what `git commit-tree -m` stores, and every commit but the first parents on the
// one before. The caller isolates git first (tests/helpers/isolateGit.ts).

const BRANCH_REF = `refs/heads/${RECORDS_BRANCH_NAME}`;
const MANIFEST_FILE = "record.json";

/** The artifact file every seed record holds, and its text. */
export const SEED_ARTIFACT_NAME = "note.md";
export const SEED_ARTIFACT_TEXT = "A record's artifact.\n";

/** The manifest of a seed record: what `record.json` holds, before it is serialised. */
export function seedRecordManifest(
  key: string,
  origin: string,
): { readonly kind: "seed"; readonly key: string; readonly origin: string } {
  return { kind: "seed", key, origin };
}

/** The commit message of a seed record, as `git commit-tree -m` receives it (no trailing newline). */
export function seedRecordMessage(key: string, origin: string): string {
  return [
    "records(phase-01): committed",
    "",
    `Run-Id: ${key.split("/")[0]}`,
    "Phase-Id: phase-01",
    `Origin: ${origin}`,
  ].join("\n");
}

export interface BulkRecord {
  readonly key: string;
  readonly origin: string;
  /** Author and committer date, whole seconds. */
  readonly date: Date;
}

export interface BulkRecordsInput {
  /** The repository (bare or not) whose records branch is written. */
  readonly repo: string;
  /**
   * The commit the first record parents on. Null makes the first record a root commit: an existing
   * records branch is then replaced, not continued.
   */
  readonly parent: string | null;
  readonly identity: { readonly name: string; readonly email: string };
  readonly records: readonly BulkRecord[];
}

function dataCommand(text: string): Buffer[] {
  const bytes = Buffer.from(text, "utf8");
  return [Buffer.from(`data ${bytes.length}\n`), bytes, Buffer.from("\n")];
}

function checkPlain(label: string, value: string, forbidden: RegExp): void {
  if (forbidden.test(value))
    throw new Error(`bulk records: ${label} ${JSON.stringify(value)} is not plain`);
}

/** The whole fast-import stream: one commit per record on the records branch, then `done`. */
function buildStream(input: BulkRecordsInput): Buffer {
  checkPlain("identity name", input.identity.name, /[<>\n]/);
  checkPlain("identity email", input.identity.email, /[<>\n]/);
  const parts: Buffer[] = [];
  const push = (text: string): void => {
    parts.push(Buffer.from(text, "utf8"));
  };
  if (input.parent === null) push(`reset ${BRANCH_REF}\n`);
  input.records.forEach((record, index) => {
    checkPlain("key", record.key, /["\\\n]|^\/|\/$|\/\/|^$/);
    const seconds = Math.floor(record.date.getTime() / 1000);
    const who = `${input.identity.name} <${input.identity.email}> ${seconds} +0000`;
    push(`commit ${BRANCH_REF}\nmark :${index + 1}\nauthor ${who}\ncommitter ${who}\n`);
    // `git commit-tree -m <message>` ends the message with one newline.
    parts.push(...dataCommand(`${seedRecordMessage(record.key, record.origin)}\n`));
    if (index === 0 && input.parent !== null) push(`from ${input.parent}\n`);
    push("deleteall\n");
    const manifest = `${JSON.stringify(seedRecordManifest(record.key, record.origin), null, 2)}\n`;
    for (const [name, text] of [
      [SEED_ARTIFACT_NAME, SEED_ARTIFACT_TEXT],
      [MANIFEST_FILE, manifest],
    ] as const) {
      push(`M 100644 inline ${record.key}/${name}\n`);
      parts.push(...dataCommand(text));
    }
    push("\n");
  });
  push("done\n");
  return Buffer.concat(parts);
}

function runFastImport(repo: string, marksFile: string, stream: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["fast-import", "--quiet", "--date-format=raw", "--done", `--export-marks=${marksFile}`],
      { cwd: repo, env: process.env, stdio: ["pipe", "ignore", "pipe"] },
    );
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    // A failed import closes stdin early; the exit code and stderr say why.
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `git fast-import failed (exit ${code}) in ${repo}: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
      }
    });
    child.stdin.end(stream);
  });
}

/**
 * Commit every record on the records branch of `input.repo` with one `git fast-import` process, and
 * answer the commit ids, oldest first. Zero records start no process and write no ref.
 */
export async function writeRecordsInBulk(input: BulkRecordsInput): Promise<readonly string[]> {
  if (input.records.length === 0) return [];
  const scratch = mkdtempSync(join(tmpdir(), "phax-bulk-records-"));
  try {
    const marksFile = join(scratch, "marks");
    await runFastImport(input.repo, marksFile, buildStream(input));
    const commits = new Map<number, string>();
    for (const line of readFileSync(marksFile, "utf8").split("\n")) {
      const [, mark, sha] = /^:(\d+) ([0-9a-f]+)$/.exec(line) ?? [];
      if (mark !== undefined && sha !== undefined) commits.set(Number(mark), sha);
    }
    return input.records.map((_, index) => {
      const commit = commits.get(index + 1);
      if (commit === undefined)
        throw new Error(`git fast-import exported no commit for mark :${index + 1}`);
      return commit;
    });
  } finally {
    removeTempDir(scratch);
  }
}
