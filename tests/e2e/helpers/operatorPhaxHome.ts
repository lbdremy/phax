import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { join, sep } from "node:path";

// The operator's real ~/.phax, read-only. It is found through the account's home directory, not
// HOME, so a suite that moved HOME still looks at the real one.
const operatorPhaxHome = (): string => join(userInfo().homedir, ".phax");

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** Whether `dir` holds the repository under test: the gate may run inside ~/.phax/worktrees. */
function holdsRepositoryUnderTest(dir: string): boolean {
  try {
    const repository = realpathSync(process.cwd());
    const real = realpathSync(dir);
    return repository === real || repository.startsWith(real + sep);
  } catch {
    return false; // a dangling entry holds nothing
  }
}

/**
 * A sorted snapshot of the operator's ~/.phax: `file <name> <sha256>` for every regular file
 * directly under it (the home files, the daily journals, registry and ledgers) and
 * `<runs|worktrees>/<name>` for every entry directly under its runs/ and worktrees/, skipping the
 * entry that holds the repository under test. A missing ~/.phax gives an empty list. A change
 * deep inside an existing run folder is not seen.
 */
export function snapshotOperatorPhaxHome(): readonly string[] {
  const root = operatorPhaxHome();
  if (!existsSync(root)) return [];
  const entries: string[] = [];
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (dirent.isFile()) entries.push(`file ${dirent.name} ${sha256(join(root, dirent.name))}`);
  }
  for (const sub of ["runs", "worktrees"]) {
    const dir = join(root, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (holdsRepositoryUnderTest(join(dir, name))) continue;
      entries.push(`${sub}/${name}`);
    }
  }
  return entries.toSorted();
}

/** The sha256 of the operator's ~/.phax/providers.json, or undefined when it does not exist. */
export function operatorProvidersHash(): string | undefined {
  const file = join(operatorPhaxHome(), "providers.json");
  return existsSync(file) ? sha256(file) : undefined;
}
