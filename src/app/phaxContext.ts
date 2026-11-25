// The one guard every access to a phase worktree's `.phax-context` goes
// through (SEC-08, SEC-23). The agent under review can commit or create any
// entry there, so phax creates, writes, removes and reads `.phax-context` and
// the folders it uses under it only when lstat finds a real directory, level
// by level, and never reads a linked file there. Anything else is refused with
// a PhaxContextRefusedError before a byte is created, written or removed.
import { Effect } from "effect";
import { join } from "node:path";
import { PhaxContextRefusedError } from "../domain/errors.js";
import { type EntryKind, FileSystem, type FsError } from "../ports/fs.js";

export const PHAX_CONTEXT_DIR = ".phax-context";

/** What the guard does with what lstat finds at one `.phax-context` level. */
type PhaxContextDecision = "create" | "use" | "refuse";

function phaxContextDecision(entry: EntryKind): PhaxContextDecision {
  if (entry.kind === "absent") return "create";
  if (entry.kind === "directory") return "use";
  return "refuse";
}

const KIND_WORDS = {
  symlink: "a symbolic link",
  file: "a file",
  other: "a special file",
} as const;

/** The refusal for the level `name` (worktree-relative) whose entry is not a directory. */
function phaxContextRefusal(
  path: string,
  name: string,
  entry: Exclude<EntryKind, { kind: "absent" } | { kind: "directory" }>,
): PhaxContextRefusedError {
  const linkTarget = entry.kind === "symlink" ? entry.target : null;
  const what = linkTarget === null ? KIND_WORDS[entry.kind] : `a symbolic link (→ ${linkTarget})`;
  const removed = entry.kind === "symlink" ? "the link" : "it";
  return new PhaxContextRefusedError({
    message: [
      `${name} is ${what}, not a directory`,
      `phax writes and reads ${PHAX_CONTEXT_DIR} only as a real directory; remove ${removed} from the branch, then resume.`,
    ].join("\n"),
    path,
    kind: entry.kind,
    linkTarget,
  });
}

// The worktree-relative levels `.phax-context`, `.phax-context/<a>`, … for a
// folder `subdir` under it.
function levels(subdir: string | undefined): readonly string[] {
  const segments = (subdir ?? "").split("/").filter((s) => s !== "" && s !== ".");
  return [PHAX_CONTEXT_DIR, ...segments].map((_, i, all) => all.slice(0, i + 1).join("/"));
}

// A worktree-relative path under `.phax-context`, split into its folder under
// `.phax-context` and its name. A path elsewhere is a defect of the caller.
function splitContextPath(file: string): { readonly subdir: string; readonly name: string } {
  const segments = file.split("/").filter((s) => s !== "" && s !== ".");
  const name = segments.at(-1);
  if (segments[0] !== PHAX_CONTEXT_DIR || segments.length < 2 || name === undefined) {
    throw new Error(`"${file}" is not a path under ${PHAX_CONTEXT_DIR}/`);
  }
  if (segments.includes("..")) throw new Error(`"${file}" leaves ${PHAX_CONTEXT_DIR}/`);
  return { subdir: segments.slice(1, -1).join("/"), name };
}

/**
 * Checks `.phax-context` and each level of `subdir` under it, creating an
 * absent level as a real directory and using an existing real directory.
 * Anything else is refused, and nothing is created at or under it. Returns
 * the folder's path.
 */
export function ensurePhaxContextDir(
  worktree: string,
  subdir?: string,
): Effect.Effect<string, PhaxContextRefusedError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    let path = worktree;
    for (const name of levels(subdir)) {
      path = join(worktree, name);
      const entry = yield* fs.entryKind(path);
      const decision = phaxContextDecision(entry);
      if (decision === "create") yield* fs.mkdirp(path);
      else if (entry.kind !== "absent" && entry.kind !== "directory") {
        return yield* phaxContextRefusal(path, name, entry);
      }
    }
    return path;
  });
}

/**
 * Whether `.phax-context` and each level of `subdir` are real directories
 * (`directory`) or one of them is missing (`absent`), with nothing created.
 * A level that is anything else is refused.
 */
export function phaxContextDirState(
  worktree: string,
  subdir?: string,
): Effect.Effect<"directory" | "absent", PhaxContextRefusedError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    for (const name of levels(subdir)) {
      const path = join(worktree, name);
      const entry = yield* fs.entryKind(path);
      if (entry.kind === "absent") return "absent";
      if (entry.kind !== "directory") return yield* phaxContextRefusal(path, name, entry);
    }
    return "directory";
  });
}

/** A file read under `.phax-context`: its text only when it is a regular file. */
export type PhaxContextFileRead =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly text: string }
  /** A symbolic link: not read; the caller warns and treats the file as absent. */
  | { readonly kind: "linked"; readonly path: string; readonly target: string }
  /** A directory or a special file where a file was expected: not read. */
  | { readonly kind: "not-a-file"; readonly path: string };

/**
 * Reads the worktree-relative `file` under `.phax-context` (e.g.
 * `.phax-context/plan.md`). Its folders must be real directories (refused
 * otherwise); a missing folder or file reads as `absent`. A symbolic link is
 * never followed.
 */
export function readPhaxContextFile(
  worktree: string,
  file: string,
): Effect.Effect<PhaxContextFileRead, PhaxContextRefusedError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { subdir } = splitContextPath(file);
    if ((yield* phaxContextDirState(worktree, subdir)) === "absent") return { kind: "absent" };
    const path = join(worktree, file);
    const entry = yield* fs.entryKind(path);
    if (entry.kind === "absent") return { kind: "absent" };
    if (entry.kind === "symlink") return { kind: "linked", path, target: entry.target };
    if (entry.kind === "file") return { kind: "file", text: yield* fs.readText(path) };
    return { kind: "not-a-file", path };
  });
}

/**
 * Writes the worktree-relative `file` under `.phax-context` through a
 * temporary file renamed into place, after `ensurePhaxContextDir` on its
 * folder. A link at the file itself is replaced, never written through.
 */
export function writePhaxContextFile(
  worktree: string,
  file: string,
  content: string,
): Effect.Effect<void, PhaxContextRefusedError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { subdir } = splitContextPath(file);
    yield* ensurePhaxContextDir(worktree, subdir);
    yield* fs.writeAtomic(join(worktree, file), content);
  });
}

/**
 * Removes the worktree-relative entry `file` under `.phax-context`, the entry
 * itself (a link is unlinked, its target left alone). Nothing happens when its
 * folder is missing; a folder that is not a real directory is refused.
 */
export function removePhaxContextEntry(
  worktree: string,
  file: string,
): Effect.Effect<void, PhaxContextRefusedError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { subdir } = splitContextPath(file);
    if ((yield* phaxContextDirState(worktree, subdir)) === "absent") return;
    const path = join(worktree, file);
    if ((yield* fs.entryKind(path)).kind === "absent") return;
    yield* fs.remove(path);
  });
}
