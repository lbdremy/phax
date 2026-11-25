import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  ensurePhaxContextDir,
  readPhaxContextFile,
  removePhaxContextEntry,
  writePhaxContextFile,
} from "../../src/app/phaxContext.js";
import { PhaxContextRefusedError } from "../../src/domain/errors.js";
import { type FakeFileSystemImpl, makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { FileSystem } from "../../src/ports/fs.js";

// The `.phax-context` guard's decisions, with the fake filesystem: every kind
// of entry at `.phax-context` and at a folder under it leads to create, use or
// refuse, and nothing is created, written or removed past a refused level.

const WORKTREE = "/state/worktrees/example.invoice-export/phase-01";
const CONTEXT = `${WORKTREE}/.phax-context`;
const BRIEFS = `${CONTEXT}/briefs`;
const OUTSIDE = "/outside";

type Kind = "absent" | "directory" | "file" | "symlink" | "other";

function place(impl: FakeFileSystemImpl, path: string, kind: Kind): void {
  switch (kind) {
    case "absent":
      return;
    case "directory":
      impl.addDir(path);
      return;
    case "file":
      impl.setFile(path, "agent bytes");
      return;
    case "symlink":
      impl.setSymlink(path, OUTSIDE);
      return;
    case "other":
      impl.setOther(path);
      return;
  }
}

const EXPECTED: Record<Kind, "create" | "use" | "refuse"> = {
  absent: "create",
  directory: "use",
  file: "refuse",
  symlink: "refuse",
  other: "refuse",
};

const KINDS: readonly Kind[] = ["absent", "directory", "file", "symlink", "other"];

function run<A, E>(impl: FakeFileSystemImpl, effect: Effect.Effect<A, E, FileSystem>) {
  return Effect.runSync(Effect.result(effect.pipe(Effect.provideService(FileSystem, impl))));
}

function freshFs(): FakeFileSystemImpl {
  const { impl } = makeFakeFileSystem();
  impl.addDir(WORKTREE);
  impl.addDir(OUTSIDE);
  return impl;
}

describe("ensurePhaxContextDir", () => {
  it.each(KINDS)("at .phax-context: %s", (kind) => {
    const impl = freshFs();
    place(impl, CONTEXT, kind);
    const result = run(impl, ensurePhaxContextDir(WORKTREE));
    if (EXPECTED[kind] === "refuse") {
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(PhaxContextRefusedError);
        expect(result.failure).toMatchObject({ path: CONTEXT, kind });
      }
    } else {
      expect(result).toEqual(Result.succeed(CONTEXT));
      expect(impl.dirs.has(CONTEXT)).toBe(true);
    }
  });

  it.each(KINDS)("at .phax-context/briefs: %s", (kind) => {
    const impl = freshFs();
    impl.addDir(CONTEXT);
    place(impl, BRIEFS, kind);
    const result = run(impl, ensurePhaxContextDir(WORKTREE, "briefs"));
    if (EXPECTED[kind] === "refuse") {
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toMatchObject({ path: BRIEFS, kind });
    } else {
      expect(result).toEqual(Result.succeed(BRIEFS));
      expect(impl.dirs.has(BRIEFS)).toBe(true);
    }
  });

  it("refuses at .phax-context before looking at briefs, creating nothing in the link's target", () => {
    const impl = freshFs();
    impl.setSymlink(CONTEXT, OUTSIDE);
    const result = run(impl, ensurePhaxContextDir(WORKTREE, "briefs"));
    expect(Result.isFailure(result)).toBe(true);
    expect(impl.dirs.has(`${OUTSIDE}/briefs`)).toBe(false);
    expect(impl.dirs.has(BRIEFS)).toBe(false);
  });

  it("names .phax-context and the link's target in its message", () => {
    const impl = freshFs();
    impl.setSymlink(CONTEXT, OUTSIDE);
    const result = run(impl, ensurePhaxContextDir(WORKTREE));
    expect(Result.isFailure(result) ? result.failure.message : "").toBe(
      [
        `.phax-context is a symbolic link (→ ${OUTSIDE}), not a directory`,
        "phax writes and reads .phax-context only as a real directory; remove the link from the branch it came from, then run phax reset-phase and phax resume.",
      ].join("\n"),
    );
    expect(Result.isFailure(result) && result.failure).toMatchObject({ linkTarget: OUTSIDE });
  });

  it("names a file at .phax-context/briefs", () => {
    const impl = freshFs();
    impl.addDir(CONTEXT);
    impl.setFile(BRIEFS, "x");
    const result = run(impl, ensurePhaxContextDir(WORKTREE, "briefs"));
    expect(Result.isFailure(result) ? result.failure.message.split("\n")[0] : "").toBe(
      ".phax-context/briefs is a file, not a directory",
    );
  });
});

describe("readPhaxContextFile", () => {
  it.each([
    ["absent", { kind: "absent" }],
    ["file", { kind: "file", text: "agent bytes" }],
    ["symlink", { kind: "linked", path: `${CONTEXT}/plan.md`, target: OUTSIDE }],
    ["directory", { kind: "not-a-file", path: `${CONTEXT}/plan.md` }],
    ["other", { kind: "not-a-file", path: `${CONTEXT}/plan.md` }],
  ] as const)("a %s at the file", (kind, expected) => {
    const impl = freshFs();
    impl.addDir(CONTEXT);
    place(impl, `${CONTEXT}/plan.md`, kind);
    expect(run(impl, readPhaxContextFile(WORKTREE, ".phax-context/plan.md"))).toEqual(
      Result.succeed(expected),
    );
  });

  it("reads a missing .phax-context as absent and refuses a linked one", () => {
    const missing = freshFs();
    expect(run(missing, readPhaxContextFile(WORKTREE, ".phax-context/plan.md"))).toEqual(
      Result.succeed({ kind: "absent" }),
    );
    const linked = freshFs();
    linked.setSymlink(CONTEXT, OUTSIDE);
    linked.setFile(`${OUTSIDE}/plan.md`, "outside bytes");
    const result = run(linked, readPhaxContextFile(WORKTREE, ".phax-context/plan.md"));
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("writePhaxContextFile and removePhaxContextEntry", () => {
  it("writes under a real directory, creating it", () => {
    const impl = freshFs();
    expect(
      Result.isSuccess(run(impl, writePhaxContextFile(WORKTREE, ".phax-context/plan.md", "plan"))),
    ).toBe(true);
    expect(impl.getFile(`${CONTEXT}/plan.md`)).toBe("plan");
  });

  it("writes nothing through a linked .phax-context", () => {
    const impl = freshFs();
    impl.setSymlink(CONTEXT, OUTSIDE);
    const result = run(impl, writePhaxContextFile(WORKTREE, ".phax-context/plan.md", "plan"));
    expect(Result.isFailure(result)).toBe(true);
    expect(impl.getFile(`${OUTSIDE}/plan.md`)).toBeUndefined();
    expect(impl.getFile(`${CONTEXT}/plan.md`)).toBeUndefined();
  });

  it("removes a linked file itself, and refuses to remove under a linked .phax-context", () => {
    const impl = freshFs();
    impl.addDir(CONTEXT);
    impl.setFile(`${OUTSIDE}/handoff.md`, "outside bytes");
    impl.setSymlink(`${CONTEXT}/correction-handoff.md`, `${OUTSIDE}/handoff.md`);
    expect(
      Result.isSuccess(
        run(impl, removePhaxContextEntry(WORKTREE, ".phax-context/correction-handoff.md")),
      ),
    ).toBe(true);
    expect(impl.symlinks.has(`${CONTEXT}/correction-handoff.md`)).toBe(false);
    expect(impl.getFile(`${OUTSIDE}/handoff.md`)).toBe("outside bytes");

    const linked = freshFs();
    linked.setSymlink(CONTEXT, OUTSIDE);
    linked.setFile(`${OUTSIDE}/correction-handoff.md`, "outside bytes");
    const result = run(
      linked,
      removePhaxContextEntry(WORKTREE, ".phax-context/correction-handoff.md"),
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(linked.getFile(`${OUTSIDE}/correction-handoff.md`)).toBe("outside bytes");
  });
});
